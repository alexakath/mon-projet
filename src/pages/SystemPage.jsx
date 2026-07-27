import { useState, useEffect } from 'react'
import { getStatus, pingEndpoint } from '../services/dolibarrApi'
import { ALL_MODULES, API_MODULES } from '../services/modulesRegistry'
import './SystemPage.css'

const API_URL = import.meta.env.VITE_DOLIBARR_API_URL

function apiStatusPill(mod, check) {
  if (!mod.endpoint) return { text: 'Pas d’API REST', cls: 'state-pill--cancelled' }
  if (!check) return { text: 'Test…', cls: 'state-pill--draft' }
  if (check.ok) return { text: 'Disponible', cls: 'state-pill--active' }
  if (check.status === 403) return { text: 'Non autorisé', cls: 'state-pill--pending' }
  if (check.status === 401) return { text: 'Clé refusée', cls: 'state-pill--refused' }
  if (check.status === 501) return { text: 'Non implémenté', cls: 'state-pill--cancelled' }
  if (check.status === 0) return { text: 'Injoignable', cls: 'state-pill--refused' }
  return { text: `Erreur ${check.status}`, cls: 'state-pill--refused' }
}

function SystemPage() {
  const [status, setStatus] = useState(null)
  const [checks, setChecks] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    getStatus()
      .then((s) => { if (!cancelled) setStatus(s) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    Promise.all(
      API_MODULES.map((mod) =>
        pingEndpoint(mod.endpoint, mod.pingQuery).then((res) => [mod.key, res])
      )
    ).then((results) => {
      if (!cancelled) setChecks(Object.fromEntries(results))
    })

    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="page-state">Connexion à Dolibarr...</div>

  if (error) {
    return (
      <div className="page-wrap">
        <div className="page-header">
          <div>
            <p className="page-breadcrumb">Vue d'ensemble</p>
            <h1>Tableau de bord</h1>
          </div>
        </div>
        <div className="dash-section">
          <p className="page-state--error">Connexion à Dolibarr impossible : {error}</p>
          <p className="dash-hint">
            Vérifiez que le serveur répond sur <code>{API_URL}</code> et que la clé
            <code> VITE_DOLAPIKEY</code> du fichier <code>.env</code> est valide.
          </p>
        </div>
      </div>
    )
  }

  const available = API_MODULES.filter((m) => checks[m.key]?.ok).length
  const checked = Object.keys(checks).length

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">Système</p>
          <h1>État de la connexion</h1>
        </div>
        <span className="page-count">Connecté en tant qu'administrateur</span>
      </div>

      <div className="summary-row">
        <div className="summary-card">
          <div className="summary-card-value">{status?.dolibarr_version ?? '—'}</div>
          <div className="summary-card-label">Version Dolibarr</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{status?.environment ?? '—'}</div>
          <div className="summary-card-label">Environnement</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">
            {checked ? `${available}/${ALL_MODULES.length}` : '…'}
          </div>
          <div className="summary-card-label">Modules exploitables</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{status?.date_tz?.slice(0, 10) ?? '—'}</div>
          <div className="summary-card-label">Date serveur</div>
        </div>
      </div>

      <div className="dash-section">
        <div className="dash-section-header">
          <div>
            <h3 className="dash-section-title">État des modules</h3>
            <p className="dash-section-sub">
              Test de chaque endpoint déclaré dans <code>src/services/modulesRegistry.js</code>.
            </p>
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Module</th>
              <th>Groupe</th>
              <th>Endpoint</th>
              <th>API</th>
              <th>Page</th>
            </tr>
          </thead>
          <tbody>
            {ALL_MODULES.map((mod) => {
              const pill = apiStatusPill(mod, checks[mod.key])
              return (
                <tr key={mod.key}>
                  <td>
                    <span className="dash-dot" style={{ background: mod.color }} />
                    <span className="dash-module-name">{mod.label}</span>
                    {mod.note && <span className="dash-note">{mod.note}</span>}
                  </td>
                  <td className="muted">{mod.group}</td>
                  <td className="muted">
                    {mod.endpoint ? <code>{mod.endpoint}</code> : <span className="dash-none">—</span>}
                  </td>
                  <td><span className={`state-pill ${pill.cls}`}>{pill.text}</span></td>
                  <td>
                    {mod.route
                      ? <span className="state-pill state-pill--paid">{mod.route}</span>
                      : <span className="state-pill state-pill--draft">À créer</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="dash-section">
        <h3 className="dash-section-title">Ajouter un module</h3>
        <ol className="dash-steps">
          <li>Déclarer le module dans <code>src/services/modulesRegistry.js</code> (avec sa <code>route</code>).</li>
          <li>Créer <code>src/services/&lt;module&gt;Service.js</code> qui appelle <code>dolibarrFetch</code>.</li>
          <li>Créer la page dans <code>src/pages/</code>.</li>
          <li>Brancher la route dans <code>src/App.jsx</code> — le menu latéral se met à jour tout seul.</li>
        </ol>
      </div>
    </div>
  )
}

export default SystemPage
