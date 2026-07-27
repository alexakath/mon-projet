import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getCart, setQuantity, removeFromCart, clearCart, cartTotals } from '../../services/cartService'
import { getRemises, findRule, sortRules, rangeLabel } from '../../services/remiseService'
import { createInvoiceFromCart, today, toInputDate, fromInputDate } from '../../services/orderService'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

function FrontCartPage({ client, onCartChange }) {
  const navigate = useNavigate()
  const [items, setItems] = useState(() => getCart(client.id))
  const [rules, setRules] = useState([])
  const [mode, setMode] = useState('now') // 'now' | 'later'
  const [days, setDays] = useState('7')
  const [invoiceDate, setInvoiceDate] = useState(() => toInputDate(today()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getRemises().then(setRules).catch(() => setRules([]))
  }, [])

  const update = (next) => {
    setItems(next)
    onCartChange(next)
  }

  const delay = mode === 'now' ? 0 : Math.max(0, Math.floor(Number(days) || 0))
  const rule = useMemo(() => findRule(rules, delay), [rules, delay])
  const rate = rule ? Number(rule.taux) : 0
  const totals = useMemo(() => cartTotals(items, rate), [items, rate])

  // L'échéance court à partir de la date de facture saisie, pas du jour courant.
  const issuedAt = useMemo(() => fromInputDate(invoiceDate), [invoiceDate])
  const dueDate = useMemo(() => (issuedAt ? issuedAt + delay * 86400 : null), [issuedAt, delay])

  const submit = async () => {
    if (!issuedAt) {
      setError('Saisissez une date de facture valide.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const order = await createInvoiceFromCart({ client, items, days: delay, date: issuedAt })
      update(clearCart(client.id))
      navigate(`/front/paiement/${order.invoiceId}`, { state: { justCreated: true } })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="fp-wrap">
        <header className="fp-head">
          <div>
            <p className="fp-eyebrow">Commande</p>
            <h1 className="fp-title fp-title--sm">Mon panier</h1>
          </div>
        </header>
        <p className="fp-empty">
          Votre panier est vide. <Link to="/front/produits" className="fp-cta">Parcourir le catalogue</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="fp-wrap">
      <header className="fp-head">
        <div>
          <p className="fp-eyebrow">Commande</p>
          <h1 className="fp-title fp-title--sm">Mon panier</h1>
        </div>
        <button className="fp-link-btn" onClick={() => update(clearCart(client.id))} disabled={busy}>
          Vider le panier
        </button>
      </header>

      <section className="fp-block">
        <table className="fp-cart-table">
          <thead>
            <tr>
              <th>Produit</th>
              <th className="fp-right">P.U. HT</th>
              <th className="fp-center">Quantité</th>
              <th className="fp-right">Total HT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.productId}>
                <td>
                  {item.ref && <span className="fp-line-ref">{item.ref}</span>}
                  {item.label}
                  <span className="fp-cart-tva">TVA {item.tva} %</span>
                </td>
                <td className="fp-right">{money(item.ht)}</td>
                <td className="fp-center">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="fp-qty"
                    value={item.qty}
                    disabled={busy}
                    onChange={(e) => update(setQuantity(client.id, item.productId, e.target.value))}
                  />
                </td>
                <td className="fp-right fp-bold">{money(item.qty * item.ht)}</td>
                <td className="fp-right">
                  <button
                    className="fp-link-btn fp-link-btn--danger"
                    onClick={() => update(removeFromCart(client.id, item.productId))}
                    disabled={busy}
                    aria-label={`Retirer ${item.label}`}
                  >
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="fp-block">
        <h2 className="fp-block-title">Date de la facture</h2>
        <div className="fp-form-grid">
          <label className="fp-field">
            <span className="fp-field-label">Émise le</span>
            <input
              type="date"
              className="fp-input"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              disabled={busy}
              required
            />
            <span className="fp-field-hint">
              C'est cette date qui figurera sur la facture, et le point de départ de
              l'échéance. Le règlement ne pourra pas lui être antérieur.
            </span>
          </label>
        </div>
      </section>

      <section className="fp-block">
        <h2 className="fp-block-title">Quand souhaitez-vous régler ?</h2>
        <p className="fp-hint">
          {rules.length === 0
            ? "Aucun barème de remise n'est configuré : la commande sera facturée au prix plein, quelle que soit la date choisie."
            : rule
              ? 'Plus le règlement est rapide, plus la remise est importante.'
              : "Ce délai n'est couvert par aucun palier : la commande serait facturée au prix plein. Voyez le barème ci-dessous pour choisir un délai remisé."}
        </p>

        <div className="fp-choices">
          <label className={`fp-choice${mode === 'now' ? ' fp-choice--on' : ''}`}>
            <input
              type="radio"
              name="paydate"
              checked={mode === 'now'}
              onChange={() => setMode('now')}
              disabled={busy}
            />
            <span className="fp-choice-title">Maintenant</span>
            <span className="fp-choice-sub">Règlement le jour même</span>
          </label>

          <label className={`fp-choice${mode === 'later' ? ' fp-choice--on' : ''}`}>
            <input
              type="radio"
              name="paydate"
              checked={mode === 'later'}
              onChange={() => setMode('later')}
              disabled={busy}
            />
            <span className="fp-choice-title">Dans</span>
            <span className="fp-choice-days">
              <input
                type="number"
                min="1"
                step="1"
                className="fp-qty fp-qty--days"
                value={days}
                onFocus={() => setMode('later')}
                onChange={(e) => setDays(e.target.value)}
                disabled={busy}
              />
              jours
            </span>
            <span className="fp-choice-sub">Échéance au {day(dueDate)}</span>
          </label>
        </div>

        {rules.length > 0 && (
          <details className="fp-scale">
            <summary>Voir le barème complet</summary>
            <ul>
              {sortRules(rules).map((r) => (
                <li key={r.id} className={r.id === rule?.id ? 'fp-scale--active' : ''}>
                  <span>{r.libelle}</span>
                  <span>{rangeLabel(r)}</span>
                  <span className="fp-bold">{r.taux} %</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="fp-block fp-recap">
        <h2 className="fp-block-title">Récapitulatif</h2>

        <div className="fp-recap-row">
          <span>Total HT</span>
          <span>{money(totals.brutHt)}</span>
        </div>
        {/* Sans palier, la remise est nulle — mais pour une raison différente
            d'un palier à 0 % : le délai choisi n'est couvert par aucun palier.
            Les deux cas donnaient le même tiret muet ; on les distingue, sinon
            le client ne peut pas savoir qu'un autre délai le servirait mieux. */}
        <div className="fp-recap-row">
          <span>
            Remise {rate > 0 ? `${rate} %` : ''}
            {rule ? (
              <span className="fp-recap-rule"> — {rule.libelle}</span>
            ) : (
              rules.length > 0 && (
                <span className="fp-recap-rule"> — aucun palier pour ce délai</span>
              )
            )}
          </span>
          <span className={rate > 0 ? 'fp-paid' : ''}>
            {rate > 0 ? `− ${money(totals.remise)}` : '—'}
          </span>
        </div>
        <div className="fp-recap-row">
          <span>Net HT</span>
          <span>{money(totals.ht)}</span>
        </div>
        <div className="fp-recap-row">
          <span>TVA</span>
          <span>{money(totals.tva)}</span>
        </div>
        <div className="fp-recap-row fp-recap-row--total">
          <span>Net à payer TTC</span>
          <span>{money(totals.ttc)}</span>
        </div>

        {error && <div className="fp-error">{error}</div>}

        <button className="fp-submit" onClick={submit} disabled={busy}>
          {busy ? 'Création de la facture…' : 'Valider et créer ma facture'}
        </button>
        <p className="fp-hint">
          La facture sera émise à votre nom, puis vous pourrez enregistrer votre règlement.
        </p>
      </section>
    </div>
  )
}

export default FrontCartPage
