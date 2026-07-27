import { dolibarrList, dolibarrDelete, dolibarrPost } from './dolibarrApi'
import { getSQLiteModules, clearFromSQLite } from './backend'

// ─── Modules Dolibarr réinitialisables ───────────────────────────────────────
//
// L'ordre compte : on supprime les dépendants avant leurs dépendances, sinon
// Dolibarr refuse (une facture référencée par un règlement, un tiers portant
// encore des factures…).
//
// Vérifié sur Dolibarr 23.0.3 : une facture ayant reçu un règlement renvoie
// « Invoice not erasable », même repassée en brouillon. Il faut supprimer le
// règlement d'abord — via DELETE /paiements/{id}, et non via /invoices, qui
// n'expose aucune suppression de règlement. D'où l'ordre ci-dessous.

const RESET_MODULES = {
  paiements: {
    label: 'Règlements de facture',
    color: '#f59e0b',
    endpoint: '/paiements',
    order: 1,
    preDelete: 'reopenPaidInvoices',
    note: "À supprimer en premier. Les factures soldées sont rouvertes au préalable, sinon leur règlement n'est pas supprimable.",
  },
  invoices: {
    label: 'Factures et avoirs',
    color: '#d946ef',
    endpoint: '/invoices',
    order: 2,
    // Une facture validée n'est supprimable que si elle est la dernière de sa
    // séquence de numérotation — la loi interdit les trous dans la numérotation.
    // On supprime donc de la plus récente à la plus ancienne : chacune est la
    // dernière au moment où son tour vient. Dans l'ordre inverse, seule la
    // dernière partirait et toutes les autres renverraient « not erasable ».
    sortItems: (items) =>
      [...items].sort((a, b) =>
        String(b.ref ?? '').localeCompare(String(a.ref ?? '')) || Number(b.id) - Number(a.id)
      ),
    note: 'Supprimées de la plus récente à la plus ancienne, sinon Dolibarr refuse de rompre la numérotation.',
  },
  products: {
    label: 'Produits',
    color: '#16a34a',
    endpoint: '/products',
    order: 3,
    note: 'Échoue si le produit est encore référencé par un document.',
  },
  thirdparties: {
    label: 'Tiers',
    color: '#2563eb',
    endpoint: '/thirdparties',
    order: 4,
    note: 'À supprimer après les factures.',
  },
}

export const getResetModules = () => RESET_MODULES

// dolibarrList traduit déjà le 404 « liste vide » en tableau vide ; on ne
// masque ici que l'indisponibilité d'un module, pour que le reste de la page
// reste affichable.
const fetchItems = async (endpoint) => {
  try {
    return await dolibarrList(endpoint)
  } catch {
    return []
  }
}

// ─── Statistiques unifiées (Dolibarr + SQLite) ───────────────────────────────

export async function getResetStats() {
  const stats = {}

  for (const [key, cfg] of Object.entries(RESET_MODULES)) {
    const items = await fetchItems(cfg.endpoint)
    stats[key] = {
      label: cfg.label,
      color: cfg.color,
      count: items.length,
      order: cfg.order,
      note: cfg.note,
      section: 'dolibarr',
    }
  }

  // Les tables SQLite sont découvertes auprès du backend : ajouter un module
  // dans server/modules/index.js suffit à le rendre réinitialisable ici.
  try {
    const sqliteMods = await getSQLiteModules()
    // Les tables de configuration (barème de remise…) restent hors du reset :
    // ce sont des réglages, pas des données importées.
    sqliteMods.filter((mod) => !mod.config).forEach((mod, idx) => {
      stats[`sqlite__${mod.key}`] = {
        label: `${mod.label} (SQLite)`,
        color: mod.color,
        count: mod.count,
        order: 100 + idx,
        note: mod.resetNote,
        section: 'sqlite',
        sqliteKey: mod.key,
      }
    })
  } catch {
    // Backend éteint : on affiche seulement la partie Dolibarr.
  }

  return stats
}

// ─── Suppression d'un module ─────────────────────────────────────────────────

// Une facture soldée (statut 2) verrouille ses règlements : leur suppression
// renvoie une 500. On la repasse en « impayée » d'abord — l'opération est sans
// effet comptable puisque la facture est de toute façon sur le point d'être
// supprimée.
async function reopenPaidInvoices(failures) {
  const invoices = await fetchItems('/invoices')
  for (const invoice of invoices.filter((i) => String(i.statut) === '2')) {
    try {
      await dolibarrPost(`/invoices/${invoice.id}/settounpaid`, {})
    } catch (err) {
      failures.push({
        id: invoice.id,
        ref: invoice.ref,
        message: `réouverture impossible : ${err.message?.slice(0, 120)}`,
      })
    }
  }
}

const PRE_DELETE_ACTIONS = { reopenPaidInvoices }

export async function deleteModule(moduleKey) {
  if (moduleKey.startsWith('sqlite__')) {
    const key = moduleKey.slice('sqlite__'.length)
    const result = await clearFromSQLite(key)
    return { done: result.deleted, errors: 0, total: result.deleted }
  }

  const cfg = RESET_MODULES[moduleKey]
  if (!cfg) throw new Error(`Module inconnu : ${moduleKey}`)

  const preFailures = []
  if (cfg.preDelete && PRE_DELETE_ACTIONS[cfg.preDelete]) {
    await PRE_DELETE_ACTIONS[cfg.preDelete](preFailures)
  }

  const fetched = await fetchItems(cfg.endpoint)
  const items = cfg.sortItems ? cfg.sortItems(fetched) : fetched

  let done = 0
  let errors = 0
  const failures = [...preFailures]

  for (const item of items) {
    try {
      await dolibarrDelete(`${cfg.endpoint}/${item.id}`)
      done++
    } catch (err) {
      errors++
      failures.push({ id: item.id, ref: item.ref, message: err.message?.slice(0, 150) })
    }
  }

  return { done, errors, total: items.length, failures }
}

// ─── Suppression en lot ──────────────────────────────────────────────────────

// Tout est supprimé, dans l'ordre imposé par `order`. Il n'y a pas de sélection
// possible : les modules dépendent les uns des autres, et n'en effacer qu'une
// partie laisserait des enregistrements orphelins ou des suppressions refusées.
export async function deleteAll(stats, onProgress) {
  const results = { success: [], errors: [] }

  const targets = Object.keys(stats).sort(
    (a, b) => (stats[a].order || 0) - (stats[b].order || 0)
  )

  let moduleDone = 0

  for (const key of targets) {
    const label = stats[key]?.label || key
    onProgress?.({ done: moduleDone, total: targets.length, module: key, label, status: 'loading' })
    try {
      const result = await deleteModule(key)
      results.success.push({ module: key, label, count: result.done, errors: result.errors, failures: result.failures })
    } catch (err) {
      results.errors.push({ module: key, label, error: err.message })
    }
    moduleDone++
    onProgress?.({
      done: moduleDone,
      total: targets.length,
      module: key,
      label,
      status: results.errors.some((e) => e.module === key) ? 'error' : 'success',
    })
  }

  return results
}
