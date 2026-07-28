import { useState, useEffect } from 'react'
import { checkBackendHealth, getSQLiteModules, getFromSQLite, getFacturesView } from '../services/backend'
import './SQLitePage.css'

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUT_PILL = {
  payee: 'state-pill--paid',
  partielle: 'state-pill--pending',
  impayee: 'state-pill--draft',
}

const STATUT_LABEL = {
  payee: 'Payée',
  partielle: 'Partielle',
  impayee: 'Impayée',
}

function SQLitePage() {
  const [health, setHealth] = useState(null)
  const [modules, setModules] = useState([])
  const [factures, setFactures] = useState([])
  const [active, setActive] = useState(null)
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([checkBackendHealth(), getSQLiteModules(), getFacturesView()])
      .then(([h, m, f]) => {
        setHealth(h)
        setModules(m)
        setFactures(f)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const openTable = async (key) => {
    setActive(key)
    setRows([])
    try {
      setRows(await getFromSQLite(key))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <div className="page-state">Interrogation du backend SQLite...</div>

  if (error) {
    return (
      <div className="page-wrap">
        <div className="page-header">
          <div>
            <p className="page-breadcrumb">Données</p>
            <h1>Base SQLite</h1>
          </div>
        </div>
        <div className="detail-section">
          <p className="page-state--error">Backend injoignable : {error}</p>
          <p className="imp-hint">
            Démarrez-le avec <code>npm start</code> dans le dossier <code>server/</code>.
            Vite redirige <code>/backend</code> vers <code>http://localhost:3001</code>.
          </p>
        </div>
      </div>
    )
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">Données</p>
          <h1>Base SQLite</h1>
        </div>
        <span className="page-count">{health?.modules?.length ?? 0} table(s)</span>
      </div>

      <div className="summary-row">
        {modules.map((m) => (
          <button
            key={m.key}
            className={`sql-card${active === m.key ? ' sql-card--active' : ''}`}
            onClick={() => openTable(m.key)}
          >
            <span className="summary-card-value" style={{ color: m.color }}>{m.count}</span>
            <span className="summary-card-label">{m.label}</span>
          </button>
        ))}
      </div>

      {factures.length > 0 && (
        <div className="detail-section">
          <h3>Vue consolidée — facture, lignes, règlements</h3>
          <p className="imp-hint">
            Totaux recalculés en SQL à partir des lignes et des règlements importés,
            sans interroger Dolibarr.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Facture</th>
                <th>Client</th>
                <th>Lignes</th>
                <th>Total HT</th>
                <th>Total TTC</th>
                <th>Réglé</th>
                <th>Remise règlement</th>
                <th>Reste</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {factures.map((f) => (
                <tr key={f.num_facture}>
                  <td className="title-cell"><span className="row-title">{f.num_facture}</span></td>
                  <td className="muted">{f.nom_client}</td>
                  <td className="muted">{f.nb_lignes}</td>
                  <td className="muted">{fmt(f.lignes_ht)}</td>
                  <td className="muted">{fmt(f.lignes_ttc)}</td>
                  <td className="muted">{fmt(f.regle)}</td>
                  {/* Le reste tient compte de la remise : sans elle, une
                      facture soldée par escompte paraîtrait impayée. */}
                  <td className="muted">
                    {f.remise > 0.005 ? `${fmt(f.remise)} (${f.taux_remise} %)` : '—'}
                  </td>
                  <td className="muted">{fmt(f.reste)}</td>
                  <td>
                    <span className={`state-pill ${STATUT_PILL[f.statut]}`}>
                      {STATUT_LABEL[f.statut]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active && (
        <div className="detail-section">
          <h3>Table {active}</h3>
          {rows.length === 0 ? (
            <p className="imp-hint">Table vide.</p>
          ) : (
            <div className="sql-scroll">
              <table className="data-table">
                <thead>
                  <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c} className="muted sql-cell">{String(r[c] ?? '—')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SQLitePage
