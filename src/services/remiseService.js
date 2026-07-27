// Barème de remise selon le délai de règlement, stocké en SQLite.
//
// Une règle = un palier, exprimé comme un **intervalle de jours fermé aux deux
// bouts** : « réglé entre `jours_min` et `jours_max` jours après la facture
// → `taux` % de remise ». Les deux bornes sont incluses ; `jours_max` à null
// signifie « sans borne haute ».
//
// Les intervalles ne se recouvrent jamais — le backend refuse une écriture qui
// créerait un chevauchement. Le palier applicable est donc celui qui contient
// le délai, et il est unique : contrairement au modèle précédent, le résultat
// ne dépend plus de l'ordre dans lequel on parcourt le barème.

const BASE = '/backend/api/remises'

const json = async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Backend ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

const send = (method, path, body) =>
  fetch(`${BASE}${path}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }).then(json)

export const getRemises = () => fetch(BASE).then(json)
export const createRemise = (rule) => send('POST', '', rule)
export const updateRemise = (id, rule) => send('PUT', `/${id}`, rule)
export const deleteRemise = (id) => send('DELETE', `/${id}`)
export const resetRemises = () => send('POST', '/reseed')

// ─── Application du barème ───────────────────────────────────────────────────

export const MS_PER_DAY = 86400 * 1000

// Nombre de jours entiers entre deux dates, en ignorant l'heure : deux dates du
// même jour donnent 0, quelle que soit l'heure enregistrée.
export function daysBetween(fromTs, toTs) {
  if (!fromTs || !toTs) return null
  const startOfDay = (ts) => {
    const d = new Date(ts * 1000)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  }
  return Math.round((startOfDay(toTs) - startOfDay(fromTs)) / MS_PER_DAY)
}

// Borne haute d'un palier, `Infinity` quand elle est laissée ouverte.
const upperBound = (rule) => (rule.jours_max === null ? Infinity : rule.jours_max)

const lowerBound = (rule) => rule.jours_min ?? 0

// Trie les paliers par borne basse : c'est l'ordre de lecture du barème.
// Comme les intervalles ne se recouvrent pas, il est sans ambiguïté.
export function sortRules(rules) {
  return [...rules].sort((a, b) => lowerBound(a) - lowerBound(b) || upperBound(a) - upperBound(b))
}

// Retourne le palier contenant `days`, ou null si aucun ne le couvre — barème
// vide, ou délai tombant dans un trou du barème (cf. findGaps).
//
// Un règlement en avance (délai négatif) est ramené à 0 : il relève du palier
// couvrant le jour même, s'il en existe un.
export function findRule(rules, days) {
  if (days === null || days === undefined) return null
  const delay = Math.max(0, days)
  return (
    sortRules(rules).find((r) => delay >= lowerBound(r) && delay <= upperBound(r)) ?? null
  )
}

// Les paliers ne se recouvrent plus, mais rien ne les oblige à se toucher : un
// barème qui commence à 3 jours laisse les jours 0 à 2 sans remise. C'est un
// choix légitime — encore faut-il qu'il soit délibéré, d'où ce relevé des
// intervalles non couverts.
export function findGaps(rules) {
  const gaps = []
  let expected = 0

  for (const rule of sortRules(rules)) {
    const min = lowerBound(rule)
    if (min > expected) gaps.push({ from: expected, to: min - 1 })
    if (rule.jours_max === null) return gaps // couvre jusqu'à l'infini : plus de trou possible
    expected = Math.max(expected, rule.jours_max + 1)
  }

  // Aucun palier ne reste ouvert : tout ce qui suit le dernier est à découvert.
  gaps.push({ from: expected, to: null })
  return gaps
}

// Remise applicable à une facture réglée après `days` jours.
export function computeRemise(rules, days, amount) {
  const rule = findRule(rules, days)
  const rate = rule ? Number(rule.taux) : 0
  const discount = Math.round(((amount * rate) / 100) * 100) / 100
  return {
    rule,
    rate,
    discount,
    net: Math.round((amount - discount) * 100) / 100,
  }
}

// Décrit un palier en clair : « de 3 à 7 jours », « le jour même »…
// Il se lit sur ses seules bornes, sans consulter ses voisins.
export function describeRule(rule) {
  const min = lowerBound(rule)

  if (rule.jours_max === null) {
    return min === 0 ? 'Tous les délais' : `À partir de ${min} jours`
  }
  if (rule.jours_max === min) {
    return min === 0 ? 'Le jour même' : `Le ${min}ᵉ jour uniquement`
  }
  if (min === 0) return `Jusqu'à ${rule.jours_max} jours`
  return `De ${min} à ${rule.jours_max} jours`
}

// Forme courte, pour les tableaux et les listes : « 3 – 7 j », « 31 j et + ».
export function rangeLabel(rule) {
  const min = lowerBound(rule)
  if (rule.jours_max === null) return `${min} j et +`
  if (rule.jours_max === min) return `${min} j`
  return `${min} – ${rule.jours_max} j`
}
