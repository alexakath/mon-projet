import Papa from 'papaparse'
import { normalize } from './detectModules'

// ─── Lecture des fichiers ─────────────────────────────────────────────────────

export const detectDelimiter = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const firstLine = String(e.target.result).split('\n')[0]
      const candidates = [',', ';', '|', '\t']
      let bestSep = ','
      let bestCount = 0
      for (const sep of candidates) {
        const count = firstLine.split(sep).length - 1
        if (count > bestCount) {
          bestCount = count
          bestSep = sep
        }
      }
      resolve({ delimiter: bestSep, count: bestCount })
    }
    reader.onerror = () => reject(new Error('Impossible de lire le fichier'))
    reader.readAsText(file)
  })

export const parseCsvFile = (file, delimiter = ',') =>
  new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      delimiter,
      skipEmptyLines: true,
      complete: (results) => {
        // Papa signale les lignes mal formées sans empêcher la lecture :
        // on rejette seulement si rien n'est exploitable.
        if (results.data.length === 0 && results.errors.length > 0) {
          reject(new Error(`Erreur CSV : ${results.errors[0].message}`))
        } else {
          resolve(results.data)
        }
      },
      error: (err) => reject(err),
    })
  })

// ─── Accès aux colonnes ───────────────────────────────────────────────────────

// Lecture insensible à la casse, aux accents et aux séparateurs :
// "pu_hors_Taxe", "PU Hors Taxe" et "pu_hors_taxe" désignent la même colonne.
export const getCi = (row, ...keys) => {
  for (const key of keys) {
    for (const [k, v] of Object.entries(row)) {
      if (normalize(k) === normalize(key) && v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim()
      }
    }
  }
  return ''
}

// Même lecture, mais pour la **dernière** colonne d'une ligne, où une décimale
// française non protégée par des guillemets est coupée par le séparateur :
//
//   F002,30/07/2026,Caisse1,1622,4
//
// Papa lit alors quatre colonnes — montant = « 1622 » — et range le « 4 » dans
// `__parsed_extra`. Sans recollage, les centimes disparaissent : la facture
// reste due de 0,40 et la remise se calcule sur une assiette fausse.
//
// Le recollage n'a lieu que si tout se lit comme un nombre : une vraie colonne
// surnuméraire (texte, date) reste ignorée plutôt que d'être agglutinée au
// montant.
export const getCiDecimal = (row, ...keys) => {
  const value = getCi(row, ...keys)
  const extra = (row.__parsed_extra ?? []).map((v) => String(v ?? '').trim())

  if (!/^-?\d+$/.test(value)) return value
  if (extra.length === 0 || !extra.every((part) => /^\d+$/.test(part))) return value

  return [value, ...extra].join(',')
}

// ─── Conversions ──────────────────────────────────────────────────────────────

// "1 800,50" et "1800.50" donnent tous deux 1800.5.
export const parseCsvFloat = (str) => {
  const cleaned = String(str ?? '')
    .replace(/\s/g, '')
    .replace(/%/g, '')
    .replace(',', '.')
    .trim()
  const value = parseFloat(cleaned)
  return Number.isFinite(value) ? value : 0
}

// "14,50%" → 14.5 ; "20%" → 20 ; "" → 0
export const parsePercent = (str) => parseCsvFloat(str)

// "21/07/2026" → timestamp Unix (midi UTC pour éviter les décalages de fuseau).
export const parseDateDMY = (str) => {
  if (!str) return null
  const parts = String(str).trim().split(/[/\-.]/)
  if (parts.length !== 3) return null
  let [d, m, y] = parts
  if (y.length === 2) y = `20${y}`
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00Z`
  const ts = Math.floor(new Date(iso).getTime() / 1000)
  return Number.isNaN(ts) ? null : ts
}

export const formatDate = (ts) =>
  ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—'

// ─── Calcul des totaux d'une ligne de facture ─────────────────────────────────

// HT après remise, puis TVA. Même ordre que Dolibarr.
export const computeLineTotals = ({ quantite, pu_ht, taxe, remise }) => {
  const ht = quantite * pu_ht * (1 - (remise || 0) / 100)
  const ttc = ht * (1 + (taxe || 0) / 100)
  return {
    total_ht: Math.round(ht * 100) / 100,
    total_ttc: Math.round(ttc * 100) / 100,
  }
}
