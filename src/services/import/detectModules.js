import { IMPORT_MODULES, IMPORT_MODULE_KEYS } from '../modulesRegistry'

export const normalize = (str) =>
  String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]/g, '')

// Registre partagé entre les étapes d'import : garde la correspondance entre
// les références du CSV (num_facture, ref_detail…) et les ids Dolibarr créés.
export class ImportRegistry {
  constructor() {
    this._store = {}
  }

  set(moduleKey, lookupKey, data) {
    if (!this._store[moduleKey]) this._store[moduleKey] = {}
    this._store[moduleKey][String(lookupKey).trim()] = data
  }

  get(moduleKey, lookupKey) {
    return this._store[moduleKey]?.[String(lookupKey).trim()] ?? null
  }

  has(moduleKey, lookupKey) {
    return !!this.get(moduleKey, lookupKey)
  }

  all(moduleKey) {
    return this._store[moduleKey] ?? {}
  }
}

// Score chaque sous-module face aux en-têtes d'un CSV.
export const detectModulesFromHeaders = (headers) => {
  const results = []

  for (const moduleKey of IMPORT_MODULE_KEYS) {
    const config = IMPORT_MODULES[moduleKey]
    const signatures = config?.csv?.signatures
    if (!signatures) continue

    let score = 0
    const mapping = {}

    for (const header of headers) {
      const norm = normalize(header)
      const weight = signatures[norm]
      if (weight) {
        score += weight
        mapping[header] = norm
      }
    }

    results.push({
      moduleKey,
      label: config.label,
      color: config.color,
      score,
      detected: score >= config.csv.threshold,
      threshold: config.csv.threshold,
      mapping,
      importOrder: config.importOrder,
    })
  }

  return results.sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    return a.importOrder - b.importOrder
  })
}

// Le meilleur candidat pour un fichier, ou null si aucun ne franchit son seuil.
export const bestMatch = (headers) => {
  const [top] = detectModulesFromHeaders(headers)
  return top?.detected ? top : null
}
