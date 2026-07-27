import { useState, useEffect, useMemo } from 'react'
import { getResetStats, deleteAll } from '../services/resetService'
import './ResetPage.css'

const CONFIRM_WORD = 'SUPPRIMER'

function ResetPage() {
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState(null)

  const load = () => {
    setLoading(true)
    getResetStats()
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const ordered = useMemo(
    () => Object.entries(stats).sort(([, a], [, b]) => (a.order || 0) - (b.order || 0)),
    [stats]
  )

  const dolibarrMods = ordered.filter(([, s]) => s.section === 'dolibarr')
  const sqliteMods = ordered.filter(([, s]) => s.section === 'sqlite')
  const total = ordered.reduce((sum, [, s]) => sum + s.count, 0)

  const run = async () => {
    setRunning(true)
    setResults(null)
    try {
      setResults(await deleteAll(stats, setProgress))
      setConfirm('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  if (loading) return <div className="page-state">Lecture des données...</div>
  if (error) return <div className="page-state page-state--error">Erreur : {error}</div>

  // Chaque ligne annonce ce qui disparaîtra, dans l'ordre où ce sera fait.
  const renderRows = (list) =>
    list.map(([key, s], index) => (
      <tr key={key} className={s.count === 0 ? 'rst-row--empty' : undefined}>
        <td className="rst-step">{index + 1}</td>
        <td>
          <span className="dash-dot" style={{ background: s.color }} />
          <span className="dash-module-name">{s.label}</span>
          {s.note && <span className="rst-note">{s.note}</span>}
        </td>
        <td className="rst-count">
          {s.count > 0 ? (
            <span className="rst-badge">{s.count} à supprimer</span>
          ) : (
            <span className="rst-badge rst-badge--none">déjà vide</span>
          )}
        </td>
      </tr>
    ))

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">Données</p>
          <h1>Réinitialisation</h1>
        </div>
        <span className="page-count">{total} enregistrement{total > 1 ? 's' : ''} au total</span>
      </div>

      <div className="rst-warning">
        Tout ce qui figure ci-dessous sera supprimé, dans cet ordre. La suppression
        est définitive et sans sauvegarde préalable. L'ordre n'est pas modifiable :
        Dolibarr refuse de supprimer un enregistrement encore référencé par un autre.
      </div>

      <div className="detail-section">
        <h3>Dolibarr</h3>
        <table className="data-table">
          <tbody>{renderRows(dolibarrMods)}</tbody>
        </table>
      </div>

      <div className="detail-section">
        <h3>SQLite (base locale)</h3>
        {sqliteMods.length === 0 ? (
          <p className="imp-hint">
            Backend SQLite injoignable. Démarrez-le avec <code>npm start</code> dans <code>server/</code>.
          </p>
        ) : (
          <table className="data-table">
            <tbody>{renderRows(sqliteMods)}</tbody>
          </table>
        )}
        <p className="rst-config-note">
          Le barème de remise n'apparaît pas ici : c'est une configuration, pas une
          donnée importée. Sa page propose « Restaurer le barème par défaut ».
        </p>
      </div>

      <div className="detail-section">
        <h3>Confirmation</h3>
        <p className="imp-hint">
          Saisissez <strong>{CONFIRM_WORD}</strong> pour débloquer le bouton.
        </p>
        <input
          type="text"
          className="users-search"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={CONFIRM_WORD}
          disabled={running}
        />
        <button
          className="rst-run"
          onClick={run}
          disabled={running || confirm !== CONFIRM_WORD || total === 0}
        >
          {running
            ? 'Suppression en cours…'
            : total === 0
              ? 'Rien à supprimer'
              : `Tout supprimer — ${total} enregistrement${total > 1 ? 's' : ''}`}
        </button>

        {progress && (
          <p className="rst-progress">
            {progress.done}/{progress.total} — {progress.label}
          </p>
        )}
      </div>

      {results && (
        <div className="detail-section">
          <h3>Résultat</h3>
          {results.success.map((r) => (
            <p key={r.module} className="rst-result">
              <span className="state-pill state-pill--active">{r.count}</span> {r.label} supprimé(s)
              {r.errors > 0 && <span className="rst-result-err"> — {r.errors} échec(s)</span>}
            </p>
          ))}
          {results.errors.map((r) => (
            <p key={r.module} className="rst-result rst-result-err">
              {r.label} : {r.error}
            </p>
          ))}
          {results.success.flatMap((r) =>
            (r.failures ?? []).map((f, i) => (
              <p key={`${r.module}-${i}`} className="imp-detail-error">
                {r.label} #{f.id}{f.ref ? ` (${f.ref})` : ''} : {f.message}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default ResetPage
