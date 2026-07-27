import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { getInvoiceById, getInvoicePayments, paymentState } from '../../services/invoiceService'
import {
  resolveAccounts, resolvePaymentTypes, payInvoice, validateInvoice, isCashLabel,
} from '../../services/invoiceOps'
import { toInputDate, fromInputDate } from '../../services/orderService'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

const STATE_PILL = {
  payee: 'state-pill--paid',
  partielle: 'state-pill--pending',
  impayee: 'state-pill--draft',
}

function FrontPaymentPage({ client }) {
  const { id } = useParams()
  const location = useLocation()
  const justCreated = location.state?.justCreated

  const [invoice, setInvoice] = useState(null)
  const [payments, setPayments] = useState([])
  const [accounts, setAccounts] = useState([])
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  // Mémorisé au premier chargement : sert à numéroter les étapes seulement
  // quand la facture est réellement arrivée en brouillon.
  const [twoSteps, setTwoSteps] = useState(false)

  const [form, setForm] = useState({
    date: toInputDate(Math.floor(Date.now() / 1000)),
    accountId: '',
    typeId: '',
    amount: '',
  })

  const load = useCallback(async () => {
    const [inv, pays, acc, pt] = await Promise.all([
      getInvoiceById(id),
      getInvoicePayments(id).catch(() => []),
      resolveAccounts(),
      resolvePaymentTypes(),
    ])
    setInvoice(inv)
    setPayments(pays)
    setAccounts(acc.list)
    setTypes(pt.all)

    setForm((f) => ({
      ...f,
      // Un règlement ne peut pas précéder l'émission de la facture : si la
      // facture est datée dans le futur, c'est elle qui donne la date proposée.
      date: fromInputDate(f.date) < inv.date ? toInputDate(inv.date) : f.date,
      amount: inv.remaining > 0 ? inv.remaining.toFixed(2) : '',
      accountId: f.accountId || String(acc.list[0]?.id ?? ''),
      typeId: f.typeId || pt.bank,
    }))
    return inv
  }, [id])

  useEffect(() => {
    load()
      .then((inv) => setTwoSteps(inv.statut === '0'))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [load])

  // Une facture en brouillon passe d'abord par la validation : elle y gagne sa
  // référence définitive et devient figée. L'API accepterait un règlement sans
  // cette étape, mais il porterait sur un document encore modifiable.
  const validate = async () => {
    setBusy(true)
    setError(null)
    try {
      await validateInvoice(id)
      const refreshed = await load()
      setDone(`Facture validée sous la référence ${refreshed.ref}. Vous pouvez maintenant la régler.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const amount = Number(String(form.amount).replace(',', '.'))
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Saisissez un montant supérieur à zéro.')
      }
      if (amount > invoice.remaining + 0.01) {
        throw new Error(`Le montant dépasse le reste à payer (${money(invoice.remaining)}).`)
      }

      // Le navigateur applique déjà `min`, mais l'attribut est contournable et
      // Dolibarr accepterait la date sans broncher : on revérifie ici.
      const paidAt = fromInputDate(form.date)
      if (!Number.isFinite(paidAt)) {
        throw new Error('Saisissez une date de règlement valide.')
      }
      if (paidAt < invoice.date) {
        throw new Error(
          `Le règlement ne peut pas être antérieur à l'émission de la facture (${day(invoice.date)}).`
        )
      }

      await payInvoice({
        invoiceId: id,
        amount,
        date: paidAt,
        accountId: form.accountId,
        paymentTypeId: form.typeId,
        comment: `Règlement en ligne — ${client.name}`,
      })

      const refreshed = await load()
      setDone(
        refreshed.remaining <= 0.01
          ? 'Règlement enregistré. Votre facture est soldée.'
          : `Règlement enregistré. Il reste ${money(refreshed.remaining)} à payer.`
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="fp-state">Chargement de la facture...</div>
  if (error && !invoice) return <div className="fp-state fp-state--error">Erreur : {error}</div>

  if (invoice.socid !== client.id) {
    return (
      <div className="fp-wrap">
        <p className="fp-empty">Cette facture n'est pas à votre nom.</p>
      </div>
    )
  }

  const state = paymentState(invoice)
  const settled = invoice.remaining <= 0.01
  const draft = invoice.statut === '0'

  return (
    <div className="fp-wrap">
      <header className="fp-head">
        <div>
          <p className="fp-eyebrow">Règlement</p>
          <h1 className="fp-title fp-title--sm">Facture {invoice.ref}</h1>
        </div>
        <span className={`state-pill ${STATE_PILL[state.key]}`}>{state.label}</span>
      </header>

      {justCreated && (
        <div className="fp-banner">
          Votre facture a bien été créée. Enregistrez votre règlement ci-dessous.
        </div>
      )}

      <section className="fp-block">
        <h2 className="fp-block-title">Détail de la facture</h2>

        <ul className="fp-lines fp-lines--plain">
          {invoice.lines.map((line) => (
            <li key={line.id} className="fp-line">
              <span className="fp-line-label">
                {line.ref && <span className="fp-line-ref">{line.ref}</span>}
                {line.label}
                {line.remise > 0 && <span className="fp-line-remise">− {line.remise} %</span>}
              </span>
              <span className="fp-line-qty">× {line.qty}</span>
              <span className="fp-line-amount">{money(line.ttc)}</span>
            </li>
          ))}
        </ul>

        <div className="fp-recap-row">
          <span>Émise le {day(invoice.date)}</span>
          <span>Échéance {day(invoice.dateLimite)}</span>
        </div>
        <div className="fp-recap-row">
          <span>Total TTC</span>
          <span>{money(invoice.ttc)}</span>
        </div>
        <div className="fp-recap-row">
          <span>Déjà réglé</span>
          <span className="fp-paid">{money(invoice.paid)}</span>
        </div>
        <div className="fp-recap-row fp-recap-row--total">
          <span>Reste à payer</span>
          <span className={settled ? 'fp-paid' : 'fp-due'}>{money(invoice.remaining)}</span>
        </div>
      </section>

      {payments.length > 0 && (
        <section className="fp-block">
          <h2 className="fp-block-title">Règlements déjà enregistrés</h2>
          <ul className="fp-months">
            {payments.map((p) => (
              <li key={p.ref} className="fp-month">
                <span className="fp-month-name">{p.ref}</span>
                <span className="fp-month-count">{p.date?.slice(0, 10)} · {p.type}</span>
                <span className="fp-month-amount">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done && <div className="fp-banner fp-banner--ok">{done}</div>}

      {draft ? (
        <div className="fp-block">
          <h2 className="fp-block-title">Étape 1 sur 2 — Valider la facture</h2>
          <p className="fp-hint">
            Cette facture est encore en brouillon, sous la référence provisoire
            <strong> {invoice.ref}</strong>. La validation lui attribue sa référence
            définitive et la rend réglable. Elle ne pourra plus être modifiée ensuite.
          </p>

          {error && <div className="fp-error">{error}</div>}

          <button className="fp-submit" onClick={validate} disabled={busy}>
            {busy ? 'Validation…' : 'Valider cette facture'}
          </button>
        </div>
      ) : settled ? (
        <p className="fp-note">
          Cette facture est soldée.{' '}
          <Link to="/front/factures" className="fp-cta">Revenir à mes factures</Link>
        </p>
      ) : (
        <form className="fp-block" onSubmit={submit}>
          <h2 className="fp-block-title">
            {twoSteps ? 'Étape 2 sur 2 — Saisir le règlement' : 'Saisir un règlement'}
          </h2>

          <div className="fp-form-grid">
            <label className="fp-field">
              <span className="fp-field-label">Date du règlement</span>
              <input
                type="date"
                className="fp-input"
                value={form.date}
                min={toInputDate(invoice.date)}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                disabled={busy}
                required
              />
              <span className="fp-field-hint">
                Au plus tôt le {day(invoice.date)}, date d'émission de la facture.
              </span>
            </label>

            <label className="fp-field">
              <span className="fp-field-label">Mode de règlement</span>
              <select
                className="fp-input"
                value={form.typeId}
                onChange={(e) => setForm({ ...form, typeId: e.target.value })}
                disabled={busy}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.label} ({t.code})</option>
                ))}
              </select>
            </label>

            <label className="fp-field">
              <span className="fp-field-label">Compte à créditer</span>
              <select
                className="fp-input"
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                disabled={busy}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ref} — {a.label}{isCashLabel(a.label) ? ' (caisse)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="fp-field">
              <span className="fp-field-label">Montant</span>
              <input
                type="text"
                inputMode="decimal"
                className="fp-input fp-input--amount"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                disabled={busy}
                required
              />
              <span className="fp-field-hint">
                Reste à payer : {money(invoice.remaining)} — un montant inférieur est accepté.
              </span>
            </label>
          </div>

          {error && <div className="fp-error">{error}</div>}

          <button type="submit" className="fp-submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer le règlement'}
          </button>
        </form>
      )}
    </div>
  )
}

export default FrontPaymentPage
