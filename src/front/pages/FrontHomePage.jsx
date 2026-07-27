import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getBillingData, totals } from '../../services/invoiceService'
import { getProducts } from '../../services/productService'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

function FrontHomePage({ client }) {
  const [invoices, setInvoices] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([getBillingData(), getProducts()])
      .then(([all, catalogue]) => {
        setInvoices(all.filter((inv) => inv.socid === client.id))
        setProducts(catalogue)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [client.id])

  const mine = useMemo(() => totals(invoices), [invoices])
  const unpaid = useMemo(() => invoices.filter((i) => i.remaining > 0.01), [invoices])

  if (loading) return <div className="fp-state">Chargement de votre espace...</div>
  if (error) return <div className="fp-state fp-state--error">Erreur : {error}</div>

  return (
    <div className="fp-wrap">
      <header className="fp-hero">
        <p className="fp-eyebrow">Espace client</p>
        <h1 className="fp-title">Bonjour {client.name}</h1>
        <p className="fp-lede">
          {client.registered
            ? "Votre compte vient d'être créé. Vos futures factures apparaîtront ici."
            : invoices.length === 0
              ? "Vous n'avez encore aucune facture à votre nom."
              : unpaid.length === 0
                ? 'Toutes vos factures sont réglées. Merci !'
                : `Vous avez ${unpaid.length} facture${unpaid.length > 1 ? 's' : ''} en attente de règlement.`}
        </p>
      </header>

      {invoices.length > 0 && (
        <div className="fp-stats">
          <div className="fp-stat">
            <span className="fp-stat-value">{money(mine.ttc)}</span>
            <span className="fp-stat-label">Total facturé</span>
          </div>
          <div className="fp-stat">
            <span className="fp-stat-value fp-stat-value--paid">{money(mine.paid)}</span>
            <span className="fp-stat-label">Déjà réglé</span>
          </div>
          <div className="fp-stat">
            <span className="fp-stat-value fp-stat-value--due">{money(mine.remaining)}</span>
            <span className="fp-stat-label">Reste à régler</span>
          </div>
        </div>
      )}

      {unpaid.length > 0 && (
        <section className="fp-block">
          <h2 className="fp-block-title">À régler</h2>
          <ul className="fp-months">
            {unpaid.map((inv) => (
              <li key={inv.id} className="fp-month">
                <span className="fp-month-name">{inv.ref}</span>
                <span className="fp-month-count">
                  {inv.dateLimite ? `échéance ${day(inv.dateLimite)}` : `émise le ${day(inv.date)}`}
                </span>
                <span className="fp-month-amount">{money(inv.remaining)}</span>
              </li>
            ))}
          </ul>
          <Link to="/front/factures" className="fp-cta">Voir le détail de mes factures</Link>
        </section>
      )}

      <section className="fp-block">
        <h2 className="fp-block-title">Notre catalogue</h2>
        {products.length === 0 ? (
          <p className="fp-empty">Aucun produit disponible.</p>
        ) : (
          <>
            <ul className="fp-months">
              {products.slice(0, 5).map((p) => (
                <li key={p.id} className="fp-month">
                  <span className="fp-month-name">
                    {p.ref && <span className="fp-line-ref">{p.ref}</span>}
                    {p.label}
                  </span>
                  <span className="fp-month-count">TVA {p.tva} %</span>
                  <span className="fp-month-amount">{money(p.ttc)}</span>
                </li>
              ))}
            </ul>
            <Link to="/front/produits" className="fp-cta">
              Voir les {products.length} produits
            </Link>
          </>
        )}
      </section>
    </div>
  )
}

export default FrontHomePage
