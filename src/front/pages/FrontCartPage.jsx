import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getCart, setQuantity, removeFromCart, clearCart, cartTotals } from '../../services/cartService'
import { getRemises, findRule, sortRules } from '../../services/remiseService'
import { createInvoiceFromCart } from '../../services/orderService'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR')

function FrontCartPage({ client, onCartChange }) {
  const navigate = useNavigate()
  const [items, setItems] = useState(() => getCart(client.id))
  const [rules, setRules] = useState([])
  const [mode, setMode] = useState('now') // 'now' | 'later'
  const [days, setDays] = useState('7')
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

  // `plein` est le panier au tarif catalogue : c'est ce montant-là qui sera
  // facturé dans Dolibarr. `totals` est le même panier remisé : c'est ce que le
  // client versera. Les deux sont affichés, parce que les deux existent.
  const plein = useMemo(() => cartTotals(items, 0), [items])
  const totals = useMemo(() => cartTotals(items, rate), [items, rate])

  const dueDate = useMemo(() => {
    const now = new Date()
    return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12) / 1000) + delay * 86400
  }, [delay])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const order = await createInvoiceFromCart({ client, items, days: delay })
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
              <th className="fp-right">Remise {rate > 0 ? `${rate} %` : ''}</th>
              <th className="fp-right">Net HT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              // La remise se lit ligne par ligne, au même taux que le
              // récapitulatif : elle n'est pas propre au produit, elle vient du
              // délai de règlement choisi plus bas.
              const brutHt = item.qty * item.ht
              const remiseHt = (brutHt * rate) / 100

              return (
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
                <td className="fp-right fp-bold">{money(brutHt)}</td>
                <td className="fp-right">
                  {rate > 0 ? <span className="fp-paid">− {money(remiseHt)}</span> : '—'}
                </td>
                <td className="fp-right">{money(brutHt - remiseHt)}</td>
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
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="fp-block">
        <h2 className="fp-block-title">Quand souhaitez-vous régler ?</h2>
        <p className="fp-hint">
          {rules.length === 0
            ? "Aucun barème de remise n'est configuré : la commande sera facturée au prix plein, quelle que soit la date choisie."
            : 'Plus le règlement est rapide, plus la remise est importante.'}
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
                  <span>{r.jours_max === null ? 'au-delà' : `${r.jours_max} j`}</span>
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
          <span>{money(plein.brutHt)}</span>
        </div>
        <div className="fp-recap-row">
          <span>TVA</span>
          <span>{money(plein.tva)}</span>
        </div>

        {/* Le montant qui sera porté sur la facture Dolibarr : le prix plein.
            La remise n'y entrera qu'au règlement, en escompte. */}
        <div className="fp-recap-row">
          <span>
            Montant facturé TTC
            <span className="fp-recap-rule"> — montant porté sur votre facture</span>
          </span>
          <span>{money(plein.ttc)}</span>
        </div>

        <div className="fp-recap-row">
          <span>
            Remise de règlement {rate > 0 ? `${rate} %` : ''}
            {rule && <span className="fp-recap-rule"> — {rule.libelle}</span>}
          </span>
          <span className={rate > 0 ? 'fp-paid' : ''}>
            {rate > 0 ? `− ${money(plein.ttc - totals.ttc)}` : '—'}
          </span>
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
          La facture sera émise à votre nom pour {money(plein.ttc)} TTC, le prix plein.
          {rate > 0
            ? ` La remise de ${rate} % vous sera accordée à l'encaissement : vous ne réglerez que ${money(totals.ttc)}.`
            : ''}
        </p>
      </section>
    </div>
  )
}

export default FrontCartPage
