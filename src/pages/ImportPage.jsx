import { useState, useCallback } from 'react'
import { detectDelimiter, parseCsvFile } from '../services/import/csvUtils'
import { bestMatch, detectModulesFromHeaders } from '../services/import/detectModules'
import { validateHeaders, validatePlan } from '../services/import/validateImport'
import { importMultiModule, buildImportPlan } from '../services/import/importService'
import { IMPORT_META } from '../services/modulesRegistry'
import './ImportPage.css'

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function ImportPage() {
  const [files, setFiles] = useState([])
  const [validation, setValidation] = useState(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({})
  const [report, setReport] = useState(null)
  const [readError, setReadError] = useState(null)

  const handleFiles = useCallback(async (fileList) => {
    setReadError(null)
    setReport(null)
    const analysed = []

    for (const file of Array.from(fileList)) {
      try {
        const { delimiter } = await detectDelimiter(file)
        const rows = await parseCsvFile(file, delimiter)
        if (rows.length === 0) {
          analysed.push({ fileName: file.name, error: 'Fichier vide.' })
          continue
        }

        const headers = Object.keys(rows[0])
        const match = bestMatch(headers)

        if (!match) {
          const scores = detectModulesFromHeaders(headers)
            .map((s) => `${s.label} ${s.score}/${s.threshold}`)
            .join(', ')
          analysed.push({ fileName: file.name, error: `Type non reconnu (${scores}).`, headers })
          continue
        }

        const headerCheck = validateHeaders(match.moduleKey, headers)
        analysed.push({
          fileName: file.name,
          moduleKey: match.moduleKey,
          label: match.label,
          color: match.color,
          score: match.score,
          rows,
          error: headerCheck.ok ? null : headerCheck.message,
        })
      } catch (err) {
        analysed.push({ fileName: file.name, error: err.message })
      }
    }

    setFiles(analysed)

    const usable = analysed.filter((f) => f.moduleKey && !f.error)
    if (usable.length === 0) {
      setValidation(null)
      return
    }

    const plan = buildImportPlan(usable)
    const result = validatePlan(plan)
    setValidation({ ...result, plan })
  }, [])

  const runImport = async () => {
    if (!validation?.plan) return
    setRunning(true)
    setProgress({})
    setReport(null)

    const planWithParsed = validation.plan.map((entry) => ({
      ...entry,
      parsed: validation.parsedByModule[entry.moduleKey],
    }))

    try {
      const { report: result, backendUp } = await importMultiModule(
        planWithParsed,
        (key, pct) => setProgress((p) => ({ ...p, [key]: pct })),
        (key) => setProgress((p) => ({ ...p, [key]: 100 }))
      )
      setReport({ result, backendUp })
    } catch (err) {
      setReadError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const reset = () => {
    setFiles([])
    setValidation(null)
    setReport(null)
    setProgress({})
    setReadError(null)
  }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">Données</p>
          <h1>Import CSV</h1>
        </div>
        {files.length > 0 && (
          <button className="back-btn" style={{ marginBottom: 0 }} onClick={reset}>
            Recommencer
          </button>
        )}
      </div>

      <div className="detail-section">
        <h3>Fichiers</h3>
        <p className="imp-hint">
          Déposez <code>facture.csv</code>, <code>detail_facture.csv</code> et <code>paiement.csv</code>.
          Le type de chaque fichier est reconnu à partir de ses en-têtes — l'ordre de sélection n'a pas d'importance.
        </p>
        <input
          type="file"
          multiple
          accept=".csv,text/csv"
          className="imp-file"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={running}
        />
        {readError && <p className="page-state--error">{readError}</p>}
      </div>

      {files.length > 0 && (
        <div className="detail-section">
          <h3>Détection</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Fichier</th>
                <th>Type reconnu</th>
                <th>Score</th>
                <th>Lignes</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.fileName}>
                  <td className="title-cell"><span className="row-title">{f.fileName}</span></td>
                  <td>
                    {f.label ? (
                      <>
                        <span className="dash-dot" style={{ background: f.color }} />
                        {f.label}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted">{f.score ?? '—'}</td>
                  <td className="muted">{f.rows?.length ?? '—'}</td>
                  <td>
                    {f.error
                      ? <span className="state-pill state-pill--refused">{f.error}</span>
                      : <span className="state-pill state-pill--active">Prêt</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {validation && (
        <div className="detail-section">
          <h3>Contrôle des données</h3>

          <div className="summary-row">
            <div className="summary-card">
              <div className="summary-card-value">{validation.summary.factures}</div>
              <div className="summary-card-label">Factures</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-value">{validation.summary.lignes}</div>
              <div className="summary-card-label">Lignes</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-value">{fmt(validation.summary.totalTtc)}</div>
              <div className="summary-card-label">Total TTC</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-value">{fmt(validation.summary.totalRegle)}</div>
              <div className="summary-card-label">Total réglé</div>
            </div>
          </div>

          {Object.keys(validation.summary.parFacture).length > 0 && (
            <table className="data-table imp-table">
              <thead>
                <tr>
                  <th>Facture</th>
                  <th>Total HT</th>
                  <th>Total TTC</th>
                  <th>Réglé</th>
                  <th>Reste</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(validation.summary.parFacture).map(([num, t]) => (
                  <tr key={num}>
                    <td className="title-cell"><span className="row-title">{num}</span></td>
                    <td className="muted">{fmt(t.ht)}</td>
                    <td className="muted">{fmt(t.ttc)}</td>
                    <td className="muted">{fmt(t.regle)}</td>
                    <td>
                      <span className={`state-pill ${t.regle >= t.ttc - 0.01 ? 'state-pill--paid' : t.regle > 0 ? 'state-pill--pending' : 'state-pill--draft'}`}>
                        {fmt(t.ttc - t.regle)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {validation.errors.length > 0 && (
            <div className="imp-issues imp-issues--error">
              <strong>{validation.errors.length} erreur(s) — import bloqué</strong>
              <ul>
                {validation.errors.slice(0, 15).map((e, i) => (
                  <li key={i}>
                    {e.fileName ? `${e.fileName} ` : ''}{e.line ? `ligne ${e.line} : ` : ''}{e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="imp-issues imp-issues--warn">
              <strong>{validation.warnings.length} avertissement(s)</strong>
              <ul>
                {validation.warnings.slice(0, 15).map((w, i) => (
                  <li key={i}>{w.line ? `ligne ${w.line} : ` : ''}{w.message}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            className="login-btn imp-run"
            onClick={runImport}
            disabled={!validation.ok || running}
          >
            {running ? 'Import en cours…' : 'Lancer l’import vers Dolibarr'}
          </button>
        </div>
      )}

      {running && (
        <div className="detail-section">
          <h3>Progression</h3>
          {Object.entries(progress).map(([key, pct]) => (
            <div key={key} className="imp-progress-row">
              <span className="imp-progress-label">{IMPORT_META[key]?.label ?? key}</span>
              <span className="imp-progress-bar">
                <span className="imp-progress-fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="imp-progress-pct">{pct}%</span>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="detail-section">
          <h3>Résultat</h3>
          {!report.backendUp && (
            <p className="imp-hint">Backend SQLite éteint — aucune copie locale n'a été enregistrée.</p>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th>Étape</th>
                <th>Importés</th>
                <th>Erreurs</th>
                <th>Avertissements</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.result).map(([key, r]) => (
                <tr key={key}>
                  <td className="title-cell"><span className="row-title">{IMPORT_META[key]?.label ?? key}</span></td>
                  <td><span className="state-pill state-pill--active">{r.success}</span></td>
                  <td>
                    {r.errors.length > 0
                      ? <span className="state-pill state-pill--refused">{r.errors.length}</span>
                      : <span className="muted">0</span>}
                  </td>
                  <td className="muted">{r.warnings.length}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {Object.entries(report.result).flatMap(([key, r]) =>
            r.errors.map((e, i) => (
              <p key={`${key}-${i}`} className="imp-detail-error">
                {IMPORT_META[key]?.label} — ligne {e.line} : {e.message}
              </p>
            ))
          )}
          {Object.entries(report.result).flatMap(([key, r]) =>
            r.warnings.map((w, i) => (
              <p key={`w-${key}-${i}`} className="imp-detail-warn">
                {IMPORT_META[key]?.label} — {w.message}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default ImportPage
