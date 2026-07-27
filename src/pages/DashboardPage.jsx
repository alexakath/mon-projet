import { useState, useEffect, useMemo } from 'react'
import {
  getBillingData, groupByMonth, aggregateProducts, totals,
  paymentState, STATUT_LABELS,
} from '../services/invoiceService'
import './DashboardPage.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const qty = (n) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

const STATE_PILL = {
  payee: 'state-pill--paid',
  partielle: 'state-pill--pending',
  impayee: 'state-pill--draft',
}

// Part réglée d'un montant, bornée pour rester lisible même en cas de trop-perçu.
function ProgressBar({ paid, total }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0
  return (
    <span className="db-bar" title={`${pct.toFixed(0)} % réglé`}>
      <span className="db-bar-fill" style={{ width: `${pct}%` }} />
    </span>
  )
}

function DashboardPage() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [openMonth, setOpenMonth] = useState(null)
  const [openProduct, setOpenProduct] = useState(null)

  useEffect(() => {
    getBillingData()
      .then(setInvoices)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const { months, undated } = useMemo(() => groupByMonth(invoices), [invoices])
  const products = useMemo(() => aggregateProducts(invoices), [invoices])
  const grand = useMemo(() => totals(invoices), [invoices])
  const salesTotal = useMemo(
    () => products.reduce((acc, p) => ({ ht: acc.ht + p.ht, ttc: acc.ttc + p.ttc, qty: acc.qty + p.qty }), { ht: 0, ttc: 0, qty: 0 }),
    [products]
  )

  if (loading) return <div className="page-state">Chargement de la facturation...</div>
  if (error) return <div className="page-state page-state--error">Erreur : {error}</div>

  if (invoices.length === 0) {
    return (
      <div className="page-wrap">
        <div className="page-header">
          <div>
            <p className="page-breadcrumb">Vue d'ensemble</p>
            <h1>Tableau de bord</h1>
          </div>
        </div>
        <div className="db-section">
          <p className="db-empty">
            Aucune facture dans Dolibarr. Importez vos fichiers depuis la page Import CSV.
          </p>
        </div>
      </div>
    )
  }

  const monthRows = [
    ...months,
    ...(undated.length
      ? [{
          key: '__sans_date',
          label: 'Sans date',
          invoices: undated,
          ttc: undated.reduce((s, i) => s + i.ttc, 0),
          paid: undated.reduce((s, i) => s + i.paid, 0),
          remaining: undated.reduce((s, i) => s + i.remaining, 0),
        }]
      : []),
  ]

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">Vue d'ensemble</p>
          <h1>Tableau de bord</h1>
        </div>
        <span className="page-count">
          {grand.count} facture{grand.count > 1 ? 's' : ''}
        </span>
      </div>

      <div className="summary-row">
        <div className="summary-card">
          <div className="summary-card-value">{money(grand.ttc)}</div>
          <div className="summary-card-label">Facturé TTC</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value db-value--paid">{money(grand.paid)}</div>
          <div className="summary-card-label">Réglé</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value db-value--due">{money(grand.remaining)}</div>
          <div className="summary-card-label">Reste à percevoir</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{money(grand.ht)}</div>
          <div className="summary-card-label">Facturé HT</div>
        </div>
      </div>

      {/* ── Facturation par mois ─────────────────────────────── */}

      <div className="db-section">
        <div className="db-section-head">
          <div>
            <h3 className="db-section-title">Facturation par mois</h3>
            <p className="db-section-sub">Cliquez un mois pour voir ses factures.</p>
          </div>
        </div>

        <div className="db-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mois</th>
                <th className="db-num">Factures</th>
                <th className="db-num">Total TTC</th>
                <th className="db-num">Payé</th>
                <th className="db-num">Restant</th>
                <th className="db-bar-col">Avancement</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((month) => {
                const open = openMonth === month.key
                return [
                  <tr
                    key={month.key}
                    className={`db-row${open ? ' db-row--open' : ''}`}
                    onClick={() => setOpenMonth(open ? null : month.key)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenMonth(open ? null : month.key)
                      }
                    }}
                  >
                    <td className="db-lead">
                      <span className={`db-caret${open ? ' db-caret--open' : ''}`} aria-hidden="true">›</span>
                      {month.label}
                    </td>
                    <td className="db-num muted">{month.invoices.length}</td>
                    <td className="db-num db-strong">{money(month.ttc)}</td>
                    <td className="db-num db-value--paid">{money(month.paid)}</td>
                    <td className="db-num db-value--due">{money(month.remaining)}</td>
                    <td className="db-bar-col"><ProgressBar paid={month.paid} total={month.ttc} /></td>
                  </tr>,

                  open && (
                    <tr key={`${month.key}-detail`} className="db-detail-row">
                      <td colSpan={6}>
                        <table className="data-table db-nested">
                          <thead>
                            <tr>
                              <th>Facture</th>
                              <th>Client</th>
                              <th>Date</th>
                              <th>Échéance</th>
                              <th className="db-num">TTC</th>
                              <th className="db-num">Payé</th>
                              <th className="db-num">Restant</th>
                              <th>État</th>
                            </tr>
                          </thead>
                          <tbody>
                            {month.invoices.map((inv) => {
                              const state = paymentState(inv)
                              return (
                                <tr key={inv.id}>
                                  <td className="db-lead">
                                    {inv.ref}
                                    {inv.type === '2' && <span className="db-tag">Avoir</span>}
                                    {inv.statut === '0' && <span className="db-tag db-tag--draft">{STATUT_LABELS[0]}</span>}
                                  </td>
                                  <td className="muted">{inv.client}</td>
                                  <td className="muted">{day(inv.date)}</td>
                                  <td className="muted">{day(inv.dateLimite)}</td>
                                  <td className="db-num db-strong">{money(inv.ttc)}</td>
                                  <td className="db-num db-value--paid">{money(inv.paid)}</td>
                                  <td className="db-num db-value--due">{money(inv.remaining)}</td>
                                  <td><span className={`state-pill ${STATE_PILL[state.key]}`}>{state.label}</span></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
            <tfoot>
              <tr className="db-total">
                <td>Total</td>
                <td className="db-num">{grand.count}</td>
                <td className="db-num">{money(grand.ttc)}</td>
                <td className="db-num db-value--paid">{money(grand.paid)}</td>
                <td className="db-num db-value--due">{money(grand.remaining)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Ventes par produit ───────────────────────────────── */}

      <div className="db-section">
        <div className="db-section-head">
          <div>
            <h3 className="db-section-title">Ventes par produit</h3>
            <p className="db-section-sub">
              Cliquez un produit pour voir le détail de ses ventes.
            </p>
          </div>
          <span className="page-count">{money(salesTotal.ht)} HT</span>
        </div>

        <div className="db-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="db-num">Quantité</th>
                <th className="db-num">Ventes HT</th>
                <th className="db-num">Ventes TTC</th>
                <th className="db-num">Part HT</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const open = openProduct === product.key
                const share = salesTotal.ht > 0 ? (product.ht / salesTotal.ht) * 100 : 0
                return [
                  <tr
                    key={product.key}
                    className={`db-row${open ? ' db-row--open' : ''}`}
                    onClick={() => setOpenProduct(open ? null : product.key)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenProduct(open ? null : product.key)
                      }
                    }}
                  >
                    <td className="db-lead">
                      <span className={`db-caret${open ? ' db-caret--open' : ''}`} aria-hidden="true">›</span>
                      {product.ref && <span className="db-ref">{product.ref}</span>}
                      {product.label}
                    </td>
                    <td className="db-num muted">{qty(product.qty)}</td>
                    <td className="db-num db-strong">{money(product.ht)}</td>
                    <td className="db-num muted">{money(product.ttc)}</td>
                    <td className="db-num muted">{share.toFixed(0)} %</td>
                  </tr>,

                  open && (
                    <tr key={`${product.key}-detail`} className="db-detail-row">
                      <td colSpan={5}>
                        <table className="data-table db-nested">
                          <thead>
                            <tr>
                              <th>Facture</th>
                              <th>Client</th>
                              <th>Date</th>
                              <th className="db-num">Quantité</th>
                              <th className="db-num">P.U. HT</th>
                              <th className="db-num">Total HT</th>
                              <th className="db-num">Total TTC</th>
                            </tr>
                          </thead>
                          <tbody>
                            {product.sales.map((sale, i) => (
                              <tr key={`${sale.invoiceId}-${i}`}>
                                <td className="db-lead">{sale.invoiceRef}</td>
                                <td className="muted">{sale.client}</td>
                                <td className="muted">{day(sale.date)}</td>
                                <td className="db-num muted">{qty(sale.qty)}</td>
                                <td className="db-num muted">{money(sale.unitPrice)}</td>
                                <td className="db-num db-strong">{money(sale.ht)}</td>
                                <td className="db-num muted">{money(sale.ttc)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
            <tfoot>
              <tr className="db-total">
                <td>Total</td>
                <td className="db-num">{qty(salesTotal.qty)}</td>
                <td className="db-num">{money(salesTotal.ht)}</td>
                <td className="db-num">{money(salesTotal.ttc)}</td>
                <td className="db-num">100 %</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

export default DashboardPage
