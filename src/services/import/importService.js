import { dolibarrList, dolibarrPost, dolibarrFetch } from '../dolibarrApi'
import { syncToSQLite, isBackendUp } from '../backend'
import { IMPORT_ORDER, IMPORT_META } from '../modulesRegistry'
import {
  addInvoiceLine, validateInvoice, payInvoice, setInvoicePaid,
  resolveAccounts, resolvePaymentTypes, isCashLabel,
} from '../invoiceOps'
import { getRemises } from '../remiseService'
import { quoteReglement } from '../paiementRemise'
import { buildHistorique, saveHistorique } from '../historiqueService'
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

      // `ttc` et `paye` sont renseignés à l'étape des règlements, qui a besoin
      // du total facturé pour asseoir la remise et du cumulé pour savoir quand
      // le net est atteint.
      registry.set('factures', row.num_facture, {
        id,
        num_facture: row.num_facture,
        socid: tiers.id,
        nom_client: row.nom_client ?? tiers.name ?? null,
        date: dateFacture,
        ttc: null,
        impute: 0,
        verse: 0,
        remise: 0,
        surplus: 0,
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
//
// Le barème de remise s'applique **ici comme au front office**, et pour la même
// raison : la remise récompense la rapidité du règlement, elle ne se connaît
// donc qu'au moment où celui-ci est enregistré. Le délai est mesuré entre la
// date de facture et la date de règlement portées par le CSV.
//
// La facture reste chez Dolibarr à son prix plein ; le règlement encaisse le
// net remisé, et l'écart est fermé en escompte (cf. `setInvoicePaid`). Sans
// cette symétrie, deux factures identiques réglées le même jour afficheraient
// des montants différents selon qu'elles viennent du CSV ou du panier.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Total TTC réel de la facture, lu chez Dolibarr après validation plutôt que
// recalculé depuis le CSV : c'est ce total qui sert d'assiette à la remise, et
// c'est celui que le tableau de bord affichera.
const invoiceTotalTtc = async (invoiceId) => {
  try {
    const inv = await dolibarrFetch(`/invoices/${invoiceId}`)
    return round2(parseFloat(inv.total_ttc) || 0)
  } catch {
    return 0
  }
}

const importPaiements = async (rows, registry, onProgress) => {
  const results = { success: 0, errors: [], warnings: [], stored: [] }

  const accounts = await resolveAccounts().catch(() => ({ list: [], byLabel: () => null }))
  if (accounts.list.length === 0) {
    results.warnings.push({ message: 'Aucun compte bancaire lisible — les règlements seront ignorés.' })
  }

  // Barème vide ou backend éteint : tout est réglé au prix plein, sans remise.
  const rules = await getRemises().catch(() => [])
  if (rules.length === 0) {
    results.warnings.push({
      message: 'Barème de remise illisible — les règlements sont enregistrés au prix plein.',
    })
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
      const paidAt = parseDateDMY(row.date_reglement) ?? Math.floor(Date.now() / 1000)

      // Assiette de la dette : le total TTC de la facture, lu une fois puis
      // mémorisé — une facture peut recevoir plusieurs règlements.
      if (facture.ttc == null) facture.ttc = await invoiceTotalTtc(facture.id)

      // Le `montant` du CSV est la **part de dette que le client solde**, au
      // prix plein de la facture — exactement ce que la page de règlement du
      // front office fait saisir. C'est donc `quoteReglement`, et l'import et
      // le panier partagent la même lecture : 3 100 soldés éteignent 3 100 de
      // dette, le client n'en décaissant que 2 480 si le palier donne 20 %.
      //
      // Le prendre pour un décaissement (`quoteVersement`) donnerait l'inverse
      // — 3 100 versés éteindraient 3 875 — et le reste dû de F001 tomberait à
      // 510,53 au lieu de 1 462,00.
      //
      // Le barème s'applique à la date de CE règlement : deux règlements d'une
      // même facture peuvent relever de deux paliers.
      const q = quoteReglement({
        ttc: facture.ttc,
        dejaImpute: facture.impute,
        rules,
        dateFacture: facture.date,
        dateReglement: paidAt,
        montantSaisi: Number(row.montant) || 0,
      })

      // Un trop-perçu n'interrompt plus rien : la part qui dépasse la dette est
      // consignée en base locale, et seule la part imputée part chez Dolibarr,
      // qui refuserait le reste.
      if (q.surplus > 0.01) {
        results.warnings.push({
          message: `Règlement ${row.num_facture} du ${row.date_reglement} : ${q.surplus} de trop-perçu enregistré en base locale (dette restante ${q.resteAvant}).`,
        })
      }

      let paiementId = null
      if (q.verse > 0.005) {
        paiementId = await payInvoice({
          invoiceId: facture.id,
          amount: q.verse,
          date: paidAt,
          accountId: compte.id,
          paymentTypeId: isCashLabel(row.caisse) ? payTypes.cash : payTypes.bank,
          comment: q.rate > 0
            ? `Import CSV — ${row.num_facture} (remise ${q.rate} % sur ${q.impute} soldés)`
            : `Import CSV — ${row.num_facture}`,
        })
      }

      facture.impute = round2(facture.impute + q.impute)
      facture.verse = round2(facture.verse + q.verse)
      facture.remise = round2(facture.remise + q.remise)
      facture.surplus = round2(facture.surplus + q.surplus)

      // Dette éteinte : l'écart avec le prix plein devient l'escompte, pour le
      // cumul des remises. Son échec n'annule pas le règlement, déjà écrit.
      if (q.solde && facture.remise > 0.01) {
        try {
          await setInvoicePaid(
            facture.id,
            undefined,
            `Remise de règlement — ${facture.remise} TTC sur ${facture.ttc} facturés`
          )
        } catch (err) {
          results.warnings.push({
            message: `Escompte non porté sur ${row.num_facture} : ${err.message?.slice(0, 150)}`,
          })
        }
      }

      await saveHistorique(
        buildHistorique({
          invoiceId: facture.id,
          ref: row.num_facture,
          socid: facture.socid,
          client: facture.nom_client ?? null,
          date: facture.date,
          montantFacture: facture.ttc,
          impute: facture.impute,
          verse: facture.verse,
          remise: facture.remise,
          surplus: facture.surplus,
          taux: q.rate,
          dateReglement: paidAt,
        })
      )

      results.stored.push({
        ...row,
        // Le montant conservé est celui réellement encaissé, remise déduite :
        // la copie locale doit refléter l'écriture, pas l'intention du CSV.
        montant: q.verse,
        dolibarr_id: paiementId != null ? Number(paiementId) : null,
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
