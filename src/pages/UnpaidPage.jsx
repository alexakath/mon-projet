import { useState, useEffect, useMemo } from 'react'
import {
  getBillingData, unpaidInvoices, overdueDays, totals,
  paymentState, STATUT_LABELS,
} from '../services/invoiceService'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

// Seuls ces deux états peuvent apparaître ici : une facture soldée est écartée
// en amont par `unpaidInvoices`.
const STATE_PILL = {
  impayee: 'state-pill--draft',
  partielle: 'state-pill--pending',
}

const FILTERS = [
  { key: 'toutes', label: 'Toutes' },
  { key: 'retard', label: 'En retard' },
  { key: 'impayee', label: 'Aucun règlement' },
  { key: 'partielle', label: 'Partiellement réglées' },
]

function matchesFilter(invoice, filter) {
  if (filter === 'retard') return invoice.late > 0
  if (filter === 'impayee' || filter === 'partielle') return paymentState(invoice).key === filter
  return true
}

function UnpaidPage() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('toutes')
  const [search, setSearch] = useState('')

  // L'horloge n'est lue qu'au montage : toutes les lignes comptent leur retard
  // depuis le même instant, et la liste ne se recalcule pas à chaque frappe.
  const [now] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    getBillingData()
      .then(setInvoices)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const unpaid = useMemo(
    () => unpaidInvoices(invoices).map((inv) => ({ ...inv, late: overdueDays(inv, now) })),
    [invoices, now]
  )

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return unpaid.filter((inv) => {
      if (!matchesFilter(inv, filter)) return false
      if (!q) return true
      return [inv.ref, inv.client].some((field) => (field || '').toLowerCase().includes(q))
    })
  }, [unpaid, filter, search])

  const due = useMemo(() => totals(unpaid), [unpaid])
  const late = useMemo(() => totals(unpaid.filter((inv) => inv.late > 0)), [unpaid])
  const shownTotal = useMemo(() => totals(shown), [shown])

  if (loading) return <div className="page-state">Chargement des factures...</div>
  if (error) return <div className="page-state page-state--error">Erreur : {error}</div>

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">Vue d'ensemble</p>
          <h1>Factures non payées</h1>
        </div>
        <span className="page-count">
          {shown.length} / {unpaid.length} facture{unpaid.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="summary-row">
        <div className="summary-card">
          <div className="summary-card-value db-value--due">{money(due.remaining)}</div>
          <div className="summary-card-label">Reste à percevoir</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value db-value--due">{money(late.remaining)}</div>
          <div className="summary-card-label">Dont en retard ({late.count})</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value db-value--paid">{money(due.paid)}</div>
          <div className="summary-card-label">Déjà réglé</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{money(due.ttc)}</div>
          <div className="summary-card-label">Facturé TTC</div>
        </div>
      </div>

      <div className="db-section">
        <div className="db-section-head">
          <div>
            <h3 className="db-section-title">Factures en attente de règlement</h3>
            <p className="db-section-sub">Les plus proches de l'échéance en premier.</p>
          </div>
          <span className="page-count">{money(shownTotal.remaining)} restant</span>
        </div>

        <div className="summary-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`rm-btn${filter === f.key ? ' rm-btn--primary' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          className="users-search"
          placeholder="Rechercher une facture ou un client..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {shown.length === 0 ? (
          <p className="db-empty">
            {unpaid.length === 0
              ? 'Aucune facture en attente de règlement.'
              : 'Aucune facture ne correspond à ce filtre.'}
          </p>
        ) : (
          <div className="db-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Facture</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Échéance</th>
                  <th className="db-num">TTC</th>
                  <th className="db-num">Réglé</th>
                  <th className="db-num">Restant</th>
                  <th className="db-num">Retard</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((inv) => {
                  const state = paymentState(inv)
                  return (
                    <tr key={inv.id}>
                      <td className="db-lead">
                        {inv.ref}
                        {inv.statut === '0' && <span className="db-tag db-tag--draft">{STATUT_LABELS[0]}</span>}
                      </td>
                      <td className="muted">{inv.client}</td>
                      <td className="muted">{day(inv.date)}</td>
                      <td className="muted">{day(inv.dateLimite)}</td>
                      <td className="db-num db-strong">{money(inv.ttc)}</td>
                      <td className="db-num db-value--paid">{money(inv.paid)}</td>
                      <td className="db-num db-value--due">{money(inv.remaining)}</td>
                      <td className="db-num">
                        {inv.late === null && <span className="rm-muted">—</span>}
                        {inv.late === 0 && <span className="rm-muted">à échoir</span>}
                        {inv.late > 0 && <span className="state-pill state-pill--refused">{inv.late} j</span>}
                      </td>
                      <td><span className={`state-pill ${STATE_PILL[state.key]}`}>{state.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="db-total">
                  <td colSpan={4}>Total affiché</td>
                  <td className="db-num">{money(shownTotal.ttc)}</td>
                  <td className="db-num db-value--paid">{money(shownTotal.paid)}</td>
                  <td className="db-num db-value--due">{money(shownTotal.remaining)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default UnpaidPage
