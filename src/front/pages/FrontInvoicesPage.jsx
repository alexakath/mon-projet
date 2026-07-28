import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getBillingData, paymentState, decomposeInvoice } from '../../services/invoiceService'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

const STATE_PILL = {
  payee: 'state-pill--paid',
  partielle: 'state-pill--pending',
  impayee: 'state-pill--draft',
}

function FrontInvoicesPage({ client }) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getBillingData()
      // Le front ne montre que les factures du client identifié.
      .then((all) => setInvoices(all.filter((inv) => inv.socid === client.id)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [client.id])

  // Ce que le client doit réellement : la somme des nets remisés, pas celle des
  // restants dus de Dolibarr, qui portent encore le prix plein.
  const reste = useMemo(
    () => invoices.reduce((sum, inv) => sum + decomposeInvoice(inv).netRemaining, 0),
    [invoices]
  )

  if (loading) return <div className="fp-state">Chargement de vos factures...</div>
  if (error) return <div className="fp-state fp-state--error">Erreur : {error}</div>

  return (
    <div className="fp-wrap">
      <header className="fp-head">
        <div>
          <p className="fp-eyebrow">Votre compte</p>
          <h1 className="fp-title fp-title--sm">Mes factures</h1>
        </div>
        {invoices.length > 0 && (
          <span className="fp-total">{money(reste)} restant</span>
        )}
      </header>

      {invoices.length === 0 ? (
        <p className="fp-empty">Vous n'avez encore aucune facture.</p>
      ) : (
        <ul className="fp-cards">
          {invoices.map((inv) => {
            const state = paymentState(inv)
            // Sans le backend, le taux se lit dans la note de la facture : la
            // liste peut donc annoncer le net dû sans dépendre de SQLite.
            const { rate, remise, netRemaining } = decomposeInvoice(inv)
            const pct = inv.ttc > 0 ? Math.min(100, (inv.paid / inv.ttc) * 100) : 0
            const draft = inv.statut === '0'
            const settled = netRemaining <= 0.01

            return (
              <li key={inv.id} className="fp-card-slot">
                <Link to={`/front/paiement/${inv.id}`} className="fp-card fp-card--link">
                <div className="fp-card-top">
                  <span className="fp-card-ref">{inv.ref}</span>
                  <span className={`state-pill ${STATE_PILL[state.key]}`}>{state.label}</span>
                </div>

                <div className="fp-card-dates">
                  Émise le {day(inv.date)}
                  {inv.dateLimite ? ` · échéance ${day(inv.dateLimite)}` : ''}
                </div>

                {inv.lines.length > 0 && (
                  <ul className="fp-lines">
                    {inv.lines.map((line) => (
                      <li key={line.id} className="fp-line">
                        <span className="fp-line-label">
                          {line.ref && <span className="fp-line-ref">{line.ref}</span>}
                          {line.label}
                        </span>
                        <span className="fp-line-qty">× {line.qty}</span>
                        <span className="fp-line-amount">{money(line.ttc)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="fp-card-bar">
                  <span className="fp-card-bar-fill" style={{ width: `${pct}%` }} />
                </div>

                {/* La facture porte le prix plein ; la remise annoncée n'est
                    acquise qu'au règlement. On montre donc les deux, pour que
                    le montant à verser ne soit pas une surprise. */}
                <div className="fp-card-figures">
                  <span><b>{money(inv.ttc)}</b> TTC facturés</span>
                  {rate > 0 && (
                    <span className="fp-paid">− {money(remise)} de remise ({rate} %)</span>
                  )}
                  <span className="fp-paid">{money(inv.paid)} réglé</span>
                  <span className="fp-due">{money(netRemaining)} restant</span>
                </div>

                <div className="fp-card-action">
                  {draft
                    ? <span className="fp-card-cta">Valider puis régler →</span>
                    : settled
                      ? <span className="fp-card-muted">Voir le détail des règlements</span>
                      : <span className="fp-card-cta">Régler cette facture →</span>}
                </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default FrontInvoicesPage
