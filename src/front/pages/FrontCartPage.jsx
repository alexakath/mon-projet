import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  getCart, setQuantity, removeFromCart, clearCart, cartTotals, remiseImportTotal,
} from '../../services/cartService'
import { getRemises, findRule, sortRules, rangeLabel } from '../../services/remiseService'
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
  // Indicatif seul : jamais déduit du prix de la commande.
  const remiseProduit = useMemo(() => remiseImportTotal(items), [items])

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
              <th className="fp-right">Remise produit</th>
              <th className="fp-right">Remise règlement {rate > 0 ? `${rate} %` : ''}</th>
              <th className="fp-right">Net HT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              // Seule la remise de règlement entre dans le calcul. Celle de
              // l'article est affichée à côté, sans être déduite : votre
              // commande est facturée au prix du catalogue.
              const brutHt = item.qty * item.ht
              const tauxProduit = Number(item.remiseImport) || 0
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
                  {tauxProduit > 0
                    ? <span className="fp-cart-tva">{tauxProduit} % vu à l'import</span>
                    : '—'}
                </td>
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
        <h2 className="fp-block-title">Quand réglerez-vous ?</h2>
        <p className="fp-hint">
          Ce choix ne fige rien : le taux retenu sera celui du barème à la date
          réelle de votre règlement. Il sert ici à estimer ce que vous verserez.
        </p>

        <div className="fp-form-grid">
          <label className="fp-field">
            <span className="fp-field-label">Échéance envisagée</span>
            <select
              className="fp-input"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              disabled={busy}
            >
              <option value="now">Immédiatement</option>
              <option value="later">Dans un nombre de jours</option>
            </select>
          </label>

          {mode === 'later' && (
            <label className="fp-field">
              <span className="fp-field-label">Sous combien de jours</span>
              <input
                type="number"
                min="0"
                step="1"
                className="fp-input"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                disabled={busy}
              />
              <span className="fp-field-hint">Échéance au {day(dueDate)}.</span>
            </label>
          )}
        </div>

        {rules.length > 0 && !rule && (
          <p className="fp-hint">
            Aucun palier ne couvre {delay} jour(s) : aucune remise ne s'appliquerait
            à cette date.
          </p>
        )}

        {rules.length > 0 && (
          <details className="fp-scale">
            <summary>Voir le barème complet</summary>
            <ul>
              {sortRules(rules).map((r) => (
                <li key={r.id} className={r.id === rule?.id ? 'fp-scale--active' : ''}>
                  <span>{r.libelle}</span>
                  {/* Les deux bornes, pas la seule borne haute : un palier
                      « 8 à 15 j » affiché « 15 j » se lit comme « jusqu'à 15 »
                      et laisse croire à une remise que le barème ne donne pas. */}
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
          <span>Total HT catalogue</span>
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
            Remise estimée {rate > 0 ? `${rate} %` : ''}
            {rule && <span className="fp-recap-rule"> — {rule.libelle} ({rangeLabel(rule)})</span>}
          </span>
          <span className={rate > 0 ? 'fp-paid' : ''}>
            {rate > 0 ? `− ${money(plein.ttc - totals.ttc)}` : '—'}
          </span>
        </div>

        <div className="fp-recap-row fp-recap-row--total">
          <span>Net estimé TTC</span>
          <span>{money(totals.ttc)}</span>
        </div>

        {error && <div className="fp-error">{error}</div>}

        <button className="fp-submit" onClick={submit} disabled={busy}>
          {busy ? 'Création de la facture…' : 'Valider et créer ma facture'}
        </button>
        <p className="fp-hint">
          La facture sera émise à votre nom pour {money(plein.ttc)} TTC, le prix catalogue.
          {rate > 0
            ? ` En réglant sous ${delay} jour(s) vous obtiendriez ${rate} % de remise et ne verseriez que ${money(totals.ttc)}. Un règlement plus tardif relèvera d'un autre palier.`
            : ''}
          {remiseProduit > 0
            ? ` À titre indicatif, ces articles ont déjà été facturés avec une remise produit (${money(remiseProduit)} HT) sur une commande passée ; elle n'est pas reconduite ici.`
            : ''}
        </p>
      </section>
    </div>
  )
}

export default FrontCartPage
