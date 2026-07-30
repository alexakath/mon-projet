import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getBillingData, paymentState } from '../../services/invoiceService'
import { getHistoriqueByInvoice } from '../../services/historiqueService'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

const STATE_PILL = {
  payee: 'state-pill--paid',
  partielle: 'state-pill--pending',
  impayee: 'state-pill--draft',
}

// Ce que le client doit encore : le prix plein moins la dette déjà éteinte.
// La somme versée ne suffit pas — une remise éteint de la dette sans être
// encaissée — et c'est SQLite qui garde la trace de l'imputation.
const resteDette = (inv, histo) => {
  const row = histo.get(inv.id)
  const impute = row ? Number(row.montant_impute) || 0 : inv.paid
  return Math.max(0, Math.round((inv.ttc - impute) * 100) / 100)
}

// Le taux affiché doit être celui du palier réellement appliqué, pas
// remise/facturé : sur plusieurs règlements à des taux différents, ce rapport
// retombe sur une moyenne qui n'est nulle part dans le barème (cf.
// historiqueService.buildHistorique). L'historique porte le taux exact ; sans
// lui, on retombe sur l'approximation de invoiceService.
const remiseInfo = (inv, histo) => {
  const row = histo.get(inv.id)
  if (row) return { amount: Number(row.remise_reglement) || 0, rate: Number(row.taux_remise) || 0 }
  return { amount: inv.remiseReglement, rate: inv.remiseRate }
}

function FrontInvoicesPage({ client }) {
  const [invoices, setInvoices] = useState([])
  const [histo, setHisto] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getBillingData()
      // Le front ne montre que les factures du client identifié.
      .then((all) => setInvoices(all.filter((inv) => inv.socid === client.id)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))

    // Le backend reste optionnel : sans lui la liste retombe sur l'encaissé,
    // ce qui est exact tant qu'aucune remise n'est intervenue.
    getHistoriqueByInvoice().then(setHisto).catch(() => setHisto(new Map()))
  }, [client.id])

  const reste = useMemo(
    () => invoices.reduce((sum, inv) => sum + resteDette(inv, histo), 0),
    [invoices, histo]
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
            const du = resteDette(inv, histo)
            // L'avancement se mesure sur la dette éteinte, pas sur l'encaissé :
            // une remise solde une part de la facture sans être versée.
            const pct = inv.ttc > 0 ? Math.min(100, ((inv.ttc - du) / inv.ttc) * 100) : 0
            const draft = inv.statut === '0'
            const settled = du <= 0.01
            const remise = remiseInfo(inv, histo)

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
                  {remise.amount > 0.01 && (
                    <span className="fp-paid">
                      − {money(remise.amount)} de remise ({remise.rate} %)
                    </span>

                  )}
                  <span className="fp-paid">{money(inv.paid)} versé</span>
                  <span className="fp-due">{money(du)} restant</span>
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
