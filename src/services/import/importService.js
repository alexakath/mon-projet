import { dolibarrList, dolibarrPost } from '../dolibarrApi'
import { syncToSQLite, isBackendUp } from '../backend'
import { IMPORT_ORDER, IMPORT_META } from '../modulesRegistry'
import {
  addInvoiceLine, validateInvoice, payInvoice,
  resolveAccounts, resolvePaymentTypes, isCashLabel,
} from '../invoiceOps'
import { ImportRegistry } from './detectModules'
import { parseDateDMY } from './csvUtils'
import { parseRows } from './validateImport'

// Les écritures vers Dolibarr (lignes, validation, règlement) et la résolution
// des comptes et modes de règlement vivent dans invoiceOps.js : elles sont
// partagées avec la validation de panier du front office.

// ─── Tiers et produits : réutiliser avant de créer ───────────────────────────

const findOrCreateThirdparty = async (registry, { code_client, nom_client }, results) => {
  const key = code_client || nom_client
  const known = registry.get('tiers', key)
  if (known) return known

  // Pas de .catch() ici : une liste vide remonte déjà en tableau vide, donc une
  // erreur qui subsiste est réelle et doit interrompre l'import plutôt que de
  // faire créer un doublon en silence.
  const existing = await dolibarrList('/thirdparties')
  const match = existing.find(
    (t) =>
      (code_client && String(t.ref_ext || '') === code_client) ||
      String(t.name || '').toLowerCase() === String(nom_client).toLowerCase()
  )

  if (match) {
    const entry = { id: String(match.id), name: match.name, created: false }
    registry.set('tiers', key, entry)
    return entry
  }

  // `code_client` obéit à un masque imposé par le module de numérotation
  // (mod_codeclient_monkey ici) : un code libre venu du CSV est rejeté, et un
  // code absent l'est aussi. On laisse Dolibarr le générer et on conserve le
  // code métier du CSV dans ref_ext, qui sert ensuite de clé de rapprochement.
  const body = { name: nom_client, client: '1', status: '1', code_client: 'auto' }
  if (code_client) body.ref_ext = code_client

  const id = String(await dolibarrPost('/thirdparties', body))
  const entry = { id, name: nom_client, created: true }
  registry.set('tiers', key, entry)
  results.warnings.push({ message: `Tiers « ${nom_client} » créé (id ${id}).` })
  return entry
}

const findOrCreateProduct = async (registry, { ref_produit, produit, pu_ht, taxe }, results) => {
  if (!ref_produit && !produit) return null
  const key = ref_produit || produit
  const known = registry.get('produits', key)
  if (known) return known

  const existing = await dolibarrList('/products')
  const match = existing.find(
    (p) =>
      (ref_produit && String(p.ref || '').toLowerCase() === ref_produit.toLowerCase()) ||
      (produit && String(p.label || '').toLowerCase() === produit.toLowerCase())
  )

  if (match) {
    const entry = { id: String(match.id), ref: match.ref, created: false }
    registry.set('produits', key, entry)
    return entry
  }

  try {
    const id = String(
      await dolibarrPost('/products', {
        ref: ref_produit || produit,
        label: produit || ref_produit,
        type: '0',
        status: '1',
        status_buy: '1',
        price: String(pu_ht ?? 0),
        tva_tx: String(taxe ?? 0),
      })
    )
    const entry = { id, ref: ref_produit, created: true }
    registry.set('produits', key, entry)
    results.warnings.push({ message: `Produit « ${ref_produit || produit} » créé (id ${id}).` })
    return entry
  } catch (err) {
    // Une ligne de facture peut se passer de produit : on retombe en ligne libre.
    results.warnings.push({
      message: `Produit « ${ref_produit || produit} » non créé (${err.message?.slice(0, 120)}) — ligne libre utilisée.`,
    })
    return null
  }
}

// ─── Étape 1 : factures (brouillons) ─────────────────────────────────────────

const importFactures = async (rows, registry, onProgress) => {
  const results = { success: 0, errors: [], warnings: [], stored: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const line = i + 2

    try {
      const tiers = await findOrCreateThirdparty(registry, row, results)
      const dateFacture = parseDateDMY(row.date_facture)
      const dateLimite = parseDateDMY(row.date_limite_reglement)

      const body = {
        socid: tiers.id,
        type: '0',
        date: dateFacture,
        note_public: `Import CSV — ${row.num_facture}`,
      }
      if (dateLimite) body.date_lim_reglement = dateLimite

      const id = String(await dolibarrPost('/invoices', body))

      registry.set('factures', row.num_facture, {
        id,
        num_facture: row.num_facture,
        socid: tiers.id,
        date: dateFacture,
      })
      results.stored.push({ ...row, dolibarr_id: Number(id), socid: Number(tiers.id) })
      results.success++
    } catch (err) {
      results.errors.push({ line, message: err.message?.slice(0, 200) || 'Erreur inconnue', row })
    }
    onProgress?.(Math.round(((i + 1) / rows.length) * 100), results)
  }

  return results
}

// ─── Étape 2 : lignes de facture ─────────────────────────────────────────────

const importDetailFactures = async (rows, registry, onProgress) => {
  const results = { success: 0, errors: [], warnings: [], stored: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const line = i + 2

    const facture = registry.get('factures', row.num_facture)
    if (!facture) {
      results.errors.push({
        line,
        message: `Facture « ${row.num_facture} » non importée — ligne ignorée.`,
        row,
      })
      onProgress?.(Math.round(((i + 1) / rows.length) * 100), results)
      continue
    }

    try {
      const produit = await findOrCreateProduct(registry, row, results)

      const lineId = await addInvoiceLine(facture.id, {
        desc: row.produit || row.ref_produit || `Ligne ${row.ref_detail}`,
        label: row.produit || row.ref_produit || '',
        qty: row.quantite,
        subprice: row.pu_ht,
        tva: row.taxe,
        remise: row.remise || 0,
        productId: produit ? produit.id : null,
      })

      // Correspondance ref CSV → id Dolibarr, comme pour les tiers, les
      // produits et les factures. Aucune étape suivante ne la consulte depuis
      // que les règlements désignent leur facture, mais le registre reste la
      // trace de ce que l'import a créé, et le rapport d'erreur s'y appuie.
      registry.set('lignes', row.ref_detail, {
        id: lineId,
        num_facture: row.num_facture,
        factureId: facture.id,
        total_ttc: row.total_ttc,
      })
      results.stored.push({ ...row, dolibarr_id: Number(lineId) })
      results.success++
    } catch (err) {
      results.errors.push({ line, message: err.message?.slice(0, 200) || 'Erreur inconnue', row })
    }
    onProgress?.(Math.round(((i + 1) / rows.length) * 100), results)
  }

  return results
}

// ─── Étape 3 : règlements ────────────────────────────────────────────────────
//
// Le CSV désigne la facture réglée, ce que Dolibarr attend exactement : les
// règlements s'y enregistrent au niveau de la facture, jamais de la ligne.
// Seule contrainte conservée : valider la facture avant de la régler, un
// règlement devant porter sur un document figé et doté de sa référence
// définitive.

const importPaiements = async (rows, registry, onProgress) => {
  const results = { success: 0, errors: [], warnings: [], stored: [] }

  const accounts = await resolveAccounts().catch(() => ({ list: [], byLabel: () => null }))
  if (accounts.list.length === 0) {
    results.warnings.push({ message: 'Aucun compte bancaire lisible — les règlements seront ignorés.' })
  }

  const payTypes = await resolvePaymentTypes()
  if (!payTypes.resolved) {
    results.warnings.push({
      message: 'Dictionnaire des types de règlement illisible — valeurs par défaut utilisées.',
    })
  }

  // Une facture réglée plusieurs fois ne doit être validée qu'une seule fois.
  const facturesAValider = new Set()
  for (const row of rows) {
    const facture = registry.get('factures', row.num_facture)
    if (facture) facturesAValider.add(facture.id)
  }

  for (const factureId of facturesAValider) {
    try {
      await validateInvoice(factureId)
    } catch (err) {
      results.warnings.push({
        message: `Validation facture ${factureId} : ${err.message?.slice(0, 150)}`,
      })
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const line = i + 2

    const facture = registry.get('factures', row.num_facture)
    if (!facture) {
      results.errors.push({
        line,
        message: `Facture « ${row.num_facture} » non importée — règlement ignoré.`,
        row,
      })
      onProgress?.(Math.round(((i + 1) / rows.length) * 100), results)
      continue
    }

    const compte = accounts.byLabel(row.caisse)
    if (!compte) {
      results.errors.push({ line, message: `Compte « ${row.caisse} » introuvable.`, row })
      onProgress?.(Math.round(((i + 1) / rows.length) * 100), results)
      continue
    }

    try {
      const paiementId = await payInvoice({
        invoiceId: facture.id,
        amount: row.montant,
        date: parseDateDMY(row.date_reglement) ?? Math.floor(Date.now() / 1000),
        accountId: compte.id,
        paymentTypeId: isCashLabel(row.caisse) ? payTypes.cash : payTypes.bank,
        comment: `Import CSV — ${row.num_facture}`,
      })

      results.stored.push({
        ...row,
        dolibarr_id: Number(paiementId),
        accountid: Number(compte.id),
      })
      results.success++
    } catch (err) {
      results.errors.push({ line, message: err.message?.slice(0, 200) || 'Erreur inconnue', row })
    }
    onProgress?.(Math.round(((i + 1) / rows.length) * 100), results)
  }

  return results
}

// ─── Routeur des sous-modules ────────────────────────────────────────────────

const SUB_MODULE_IMPORTERS = {
  factures: importFactures,
  detail_factures: importDetailFactures,
  paiements: importPaiements,
}

// ─── Orchestrateur ───────────────────────────────────────────────────────────

export const importMultiModule = async (plan, onSubModuleProgress, onSubModuleDone) => {
  const registry = new ImportRegistry()
  const report = {}
  const backendUp = await isBackendUp()

  for (const key of IMPORT_ORDER) {
    const entry = plan.find((p) => p.moduleKey === key)
    if (!entry) continue

    const importer = SUB_MODULE_IMPORTERS[key]
    if (!importer) continue

    const rows = entry.parsed ?? parseRows(key, entry.rows)

    const results = await importer(rows, registry, (pct, partial) =>
      onSubModuleProgress?.(key, pct, partial)
    )

    // Copie locale du résultat : traçabilité de l'import, indépendante de Dolibarr.
    if (backendUp && results.stored.length > 0) {
      try {
        await syncToSQLite(IMPORT_META[key].sqliteTable, results.stored)
      } catch (err) {
        results.warnings.push({ message: `Copie SQLite ignorée : ${err.message?.slice(0, 150)}` })
      }
    }

    report[key] = results
    onSubModuleDone?.(key, results)
  }

  return { report, registry, backendUp }
}

// ─── Construction du plan ────────────────────────────────────────────────────

export const buildImportPlan = (detectedEntries) => {
  const byModule = {}
  for (const entry of detectedEntries) {
    if (!byModule[entry.moduleKey]) byModule[entry.moduleKey] = entry
  }
  return IMPORT_ORDER.filter((k) => byModule[k]).map((k) => byModule[k])
}
