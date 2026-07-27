// Client du backend SQLite (server/). Le proxy Vite renvoie /backend → :3001.

const BASE = '/backend/api'

const json = async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Backend ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

export const checkBackendHealth = () => fetch(`${BASE}/health`).then(json)

export const getFromSQLite = (module) => fetch(`${BASE}/${module}`).then(json)

export const getCountFromSQLite = (module) => fetch(`${BASE}/${module}/count`).then(json)

export const clearFromSQLite = (module) =>
  fetch(`${BASE}/${module}`, { method: 'DELETE' }).then(json)

export const syncToSQLite = (module, data) =>
  fetch(`${BASE}/sync/${module}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const getSQLiteModules = () => fetch(`${BASE}/sqlite-modules`).then(json)

// Vue consolidée facture → lignes → règlements (calculée en SQL côté backend).
export const getFacturesView = () => fetch(`${BASE}/vue-factures`).then(json)

export const getFactureDetail = (num) =>
  fetch(`${BASE}/vue-factures/${encodeURIComponent(num)}`).then(json)

// Le backend est optionnel : l'application doit rester utilisable sans lui.
export const isBackendUp = async () => {
  try {
    await checkBackendHealth()
    return true
  } catch {
    return false
  }
}
