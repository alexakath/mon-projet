import { useState, useEffect, useCallback } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import {
  getInvoiceById, getInvoicePayments, paymentState, invoiceVatRate, decomposeInvoice,
} from '../../services/invoiceService'
import {
  resolveAccounts, resolvePaymentTypes, payInvoice, validateInvoice, isCashLabel,
  setInvoicePaid,
} from '../../services/invoiceOps'
import { toInputDate, fromInputDate } from '../../services/orderService'
import { getHistoriqueByInvoice, buildHistorique, saveHistorique } from '../../services/historiqueService'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

// L'historique SQLite fait autorité sur le taux consenti quand il est
// disponible : il a été écrit à la commande, à partir du barème appliqué.
const decompose = (invoice, historique) =>
  decomposeInvoice(invoice, historique ? Number(historique.taux_remise) || 0 : null)

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
  const [historique, setHistorique] = useState(null)
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
    vatRate: '',
  })

  const load = useCallback(async () => {
    const [inv, pays, acc, pt, hist] = await Promise.all([
      getInvoiceById(id),
      getInvoicePayments(id).catch(() => []),
      resolveAccounts(),
      resolvePaymentTypes(),
      getHistoriqueByInvoice(),
    ])
    const ligne = hist.get(String(id)) ?? null

    setInvoice(inv)
    setPayments(pays)
    setAccounts(acc.list)
    setTypes(pt.all)
    setHistorique(ligne)

    // Le montant proposé est le **net** restant — remise déduite —, pas le
    // restant dû de Dolibarr : la facture y est au prix plein, et proposer
    // 1 000 quand le client en doit 700 le ferait payer la remise.
    const { netRemaining } = decompose(inv, ligne)

    setForm((f) => ({
      ...f,
      // Un règlement ne peut pas précéder l'émission de la facture : si la
      // facture est datée dans le futur, c'est elle qui donne la date proposée.
      date: fromInputDate(f.date) < inv.date ? toInputDate(inv.date) : f.date,
      amount: netRemaining > 0 ? netRemaining.toFixed(2) : '',
      accountId: f.accountId || String(acc.list[0]?.id ?? ''),
      typeId: f.typeId || pt.bank,
      // Le taux de la facture est proposé par défaut. `f.vatRate ||` préserve
      // une saisie en cours lors d'un rechargement après écriture.
      vatRate: f.vatRate || String(invoiceVatRate(inv).rate),
    }))
    return { inv, ligne }
  }, [id])

  useEffect(() => {
    load()
      .then(({ inv }) => setTwoSteps(inv.statut === '0'))
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
      const { inv: refreshed } = await load()
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
      const { rate, remise, net, netRemaining } = decompose(invoice, historique)

      const amount = Number(String(form.amount).replace(',', '.'))
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Saisissez un montant supérieur à zéro.')
      }
      // Le plafond est le net remisé, pas le total facturé : au-delà, le client
      // paierait une remise qui lui a été accordée.
      if (amount > netRemaining + 0.01) {
        throw new Error(`Le montant dépasse le reste à payer (${money(netRemaining)}).`)
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

      const paye = round2(invoice.paid + amount)
      const solde = paye + 0.01 >= net

      // Le net est atteint mais Dolibarr voit encore la remise comme un impayé,
      // la facture y étant au prix plein. On la classe « payée » avec le motif
      // escompte : c'est l'écriture par laquelle la remise entre dans Dolibarr,
      // et elle ne peut se faire qu'ici, une fois l'encaissement enregistré.
      //
      // L'échec de cette clôture est signalé sans être traité comme un échec du
      // règlement : celui-ci est déjà écrit chez Dolibarr, et le relancer
      // encaisserait deux fois. La facture reste alors ouverte pour le montant
      // de la remise, à solder depuis Dolibarr.
      let closeError = null
      if (solde && remise > 0.01) {
        try {
          await setInvoicePaid(
            id,
            undefined,
            `Remise de règlement ${rate} % — ${money(remise)} TTC sur ${money(invoice.ttc)} facturés`
          )
        } catch (err) {
          closeError = err.message
        }
      }

      await saveHistorique(
        buildHistorique({
          invoiceId: id,
          ref: invoice.ref,
          socid: invoice.socid,
          client: client.name,
          date: invoice.date,
          montantFacture: invoice.ttc,
          taux: rate,
          paye,
          dateReglement: paidAt,
        })
      )

      await load()

      if (closeError) {
        setError(
          `Votre règlement de ${money(amount)} est bien enregistré, mais la remise de ` +
          `${money(remise)} n'a pas pu être portée sur la facture (${closeError}). ` +
          `Ne la réglez pas une seconde fois : signalez-le.`
        )
      } else {
        setDone(
          solde
            ? remise > 0.01
              ? `Règlement enregistré : ${money(amount)} versés, ${money(remise)} de remise de règlement. Votre facture est soldée.`
              : 'Règlement enregistré. Votre facture est soldée.'
            : `Règlement enregistré. Il reste ${money(round2(net - paye))} à payer.`
        )
      }
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
  const { rate, remise, net, netRemaining } = decompose(invoice, historique)
  const settled = netRemaining <= 0.01
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
        {/* Les trois montants que la facture met en jeu : ce qui est facturé
            au prix plein, ce qui en est remisé, ce qui reste à verser. */}
        <div className="fp-recap-row">
          <span>Montant facturé TTC</span>
          <span>{money(invoice.ttc)}</span>
        </div>

        {rate > 0 && (
          <>
            <div className="fp-recap-row">
              <span>
                Remise de règlement {rate} %
                <span className="fp-recap-rule"> — accordée à l'encaissement</span>
              </span>
              <span className="fp-paid">− {money(remise)}</span>
            </div>
            <div className="fp-recap-row">
              <span>Net à payer</span>
              <span>{money(net)}</span>
            </div>
          </>
        )}

        <div className="fp-recap-row">
          <span>Déjà réglé</span>
          <span className="fp-paid">{money(invoice.paid)}</span>
        </div>
        <div className="fp-recap-row fp-recap-row--total">
          <span>Reste à payer</span>
          <span className={settled ? 'fp-paid' : 'fp-due'}>{money(netRemaining)}</span>
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
                Reste à payer : {money(netRemaining)} — un montant inférieur est accepté.
                {rate > 0 && ` La remise de ${rate} % est déjà déduite.`}
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
