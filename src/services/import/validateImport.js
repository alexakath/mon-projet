import { CANONICAL, IMPORT_MODULES, IMPORT_DEPS, IMPORT_META } from '../modulesRegistry'
import { normalize } from './detectModules'
import { getCi, parseCsvFloat, parsePercent, parseDateDMY, computeLineTotals } from './csvUtils'

// Vérifie que les colonnes obligatoires du sous-module sont présentes.
export const validateHeaders = (moduleKey, headers) => {
  const canonical = CANONICAL[moduleKey]
  if (!canonical) return { ok: false, missing: [], message: `Sous-module inconnu : ${moduleKey}` }

  const present = new Set(headers.map(normalize))
  const missing = canonical.required.filter((col) => !present.has(col))

  return {
    ok: missing.length === 0,
    missing,
    message: missing.length ? `Colonnes obligatoires manquantes : ${missing.join(', ')}` : null,
  }
}

// ─── Normalisation des lignes ────────────────────────────────────────────────
// Chaque CSV est converti en objets métier stables, indépendants de la casse
// et de l'orthographe des en-têtes.

const rowParsers = {
  factures: (row) => ({
    num_facture: getCi(row, 'num_facture'),
    date_facture: getCi(row, 'date_facture'),
    date_limite_reglement: getCi(row, 'date_limite_reglement'),
    code_client: getCi(row, 'code_client'),
    nom_client: getCi(row, 'nom_client'),
  }),
  detail_factures: (row) => {
    const parsed = {
      ref_detail: getCi(row, 'ref_detail'),
      num_facture: getCi(row, 'num_facture'),
      ref_produit: getCi(row, 'ref_produit'),
      produit: getCi(row, 'produit'),
      quantite: parseCsvFloat(getCi(row, 'quantite')),
      pu_ht: parseCsvFloat(getCi(row, 'pu_hors_taxe', 'pu_ht', 'prix_unitaire')),
      taxe: parsePercent(getCi(row, 'taxe', 'tva')),
      remise: parsePercent(getCi(row, 'remise')),
    }
    return { ...parsed, ...computeLineTotals(parsed) }
  },
  paiements: (row) => ({
    num_facture: getCi(row, 'num_facture'),
    date_reglement: getCi(row, 'date_reglement'),
    caisse: getCi(row, 'caisse'),
    montant: parseCsvFloat(getCi(row, 'montant')),
  }),
}

export const parseRows = (moduleKey, rows) => {
  const parser = rowParsers[moduleKey]
  if (!parser) return []
  return rows.map(parser)
}

// ─── Validation d'un plan complet ────────────────────────────────────────────

const EPSILON = 0.01

// `plan` : [{ moduleKey, rows, fileName }] déjà trié dans l'ordre d'import.
export const validatePlan = (plan) => {
  const errors = []
  const warnings = []
  const parsedByModule = {}

  const present = new Set(plan.map((p) => p.moduleKey))

  // Dépendances : on ne peut pas rattacher des lignes sans leurs factures.
  for (const { moduleKey } of plan) {
    for (const dep of IMPORT_DEPS[moduleKey] ?? []) {
      if (!present.has(dep)) {
        errors.push({
          module: moduleKey,
          message: `${IMPORT_META[moduleKey].label} nécessite le fichier « ${IMPORT_META[dep].label} », absent de la sélection.`,
        })
      }
    }
  }

  for (const { moduleKey, rows, fileName } of plan) {
    parsedByModule[moduleKey] = parseRows(moduleKey, rows)

    parsedByModule[moduleKey].forEach((item, i) => {
      const line = i + 2 // +1 en-tête, +1 index 0
      const required = IMPORT_MODULES[moduleKey].csv.required

      for (const col of required) {
        const field = col === 'pu_hors_taxe' ? 'pu_ht' : col
        const value = item[field]
        const empty = value === '' || value === null || value === undefined
        if (empty) {
          errors.push({ module: moduleKey, fileName, line, message: `Colonne « ${col} » vide.` })
        }
      }

      if (moduleKey === 'detail_factures') {
        if (item.quantite <= 0) {
          errors.push({ module: moduleKey, fileName, line, message: `Quantité invalide (${item.quantite}).` })
        }
        if (item.pu_ht <= 0) {
          errors.push({ module: moduleKey, fileName, line, message: `Prix unitaire invalide (${item.pu_ht}).` })
        }
        if (item.remise < 0 || item.remise >= 100) {
          warnings.push({ module: moduleKey, fileName, line, message: `Remise inhabituelle : ${item.remise}%.` })
        }
      }

      if (moduleKey === 'paiements' && item.montant <= 0) {
        errors.push({ module: moduleKey, fileName, line, message: `Montant de règlement invalide (${item.montant}).` })
      }

      if (moduleKey === 'factures' && !parseDateDMY(item.date_facture)) {
        errors.push({ module: moduleKey, fileName, line, message: `Date de facture illisible : « ${item.date_facture} ».` })
      }
    })
  }

  const factures = parsedByModule.factures ?? []
  const lignes = parsedByModule.detail_factures ?? []
  const paiements = parsedByModule.paiements ?? []

  const factureByNum = new Map(factures.map((f) => [f.num_facture, f]))

  // Intégrité référentielle entre fichiers.
  lignes.forEach((l, i) => {
    if (factures.length && !factureByNum.has(l.num_facture)) {
      errors.push({
        module: 'detail_factures',
        line: i + 2,
        message: `Facture « ${l.num_facture} » introuvable dans le fichier des factures.`,
      })
    }
  })

  paiements.forEach((p, i) => {
    if (factures.length && !factureByNum.has(p.num_facture)) {
      errors.push({
        module: 'paiements',
        line: i + 2,
        message: `Facture « ${p.num_facture} » introuvable — le règlement ne peut être rattaché.`,
      })
    }
  })

  // Les lignes donnent le dû de chaque facture, les règlements ce qui a été
  // encaissé dessus. Les deux se rejoignent sur `num_facture`.
  const totauxParFacture = {}
  lignes.forEach((l) => {
    const t = (totauxParFacture[l.num_facture] ??= { ht: 0, ttc: 0, regle: 0 })
    t.ht += l.total_ht
    t.ttc += l.total_ttc
  })

  paiements.forEach((p, i) => {
    const t = (totauxParFacture[p.num_facture] ??= { ht: 0, ttc: 0, regle: 0 })
    t.regle += p.montant

    const facture = factureByNum.get(p.num_facture)
    const dPaiement = parseDateDMY(p.date_reglement)
    const dFacture = facture ? parseDateDMY(facture.date_facture) : null
    if (dPaiement && dFacture && dPaiement < dFacture) {
      warnings.push({
        module: 'paiements',
        line: i + 2,
        message: `Règlement daté du ${p.date_reglement}, antérieur à la facture ${p.num_facture} (${facture.date_facture}) — vérifier l'année.`,
      })
    }
  })

  Object.entries(totauxParFacture).forEach(([num, t]) => {
    if (t.regle > t.ttc + EPSILON) {
      warnings.push({
        module: 'paiements',
        message: `Facture ${num} : réglée ${t.regle.toFixed(2)} pour un TTC de ${t.ttc.toFixed(2)} (trop-perçu).`,
      })
    }
  })

  const summary = {
    factures: factures.length,
    lignes: lignes.length,
    paiements: paiements.length,
    totalHt: Math.round(Object.values(totauxParFacture).reduce((s, t) => s + t.ht, 0) * 100) / 100,
    totalTtc: Math.round(Object.values(totauxParFacture).reduce((s, t) => s + t.ttc, 0) * 100) / 100,
    totalRegle: Math.round(Object.values(totauxParFacture).reduce((s, t) => s + t.regle, 0) * 100) / 100,
    parFacture: totauxParFacture,
  }

  return { ok: errors.length === 0, errors, warnings, parsedByModule, summary }
}
