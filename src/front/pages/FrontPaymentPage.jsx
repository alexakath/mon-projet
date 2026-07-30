import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import {
  getInvoiceById, getInvoicePayments, paymentState, invoiceVatRate,
} from '../../services/invoiceService'
import {
  resolveAccounts, resolvePaymentTypes, payInvoice, validateInvoice, isCashLabel,
  setInvoicePaid,
} from '../../services/invoiceOps'
import { toInputDate, fromInputDate } from '../../services/orderService'
import { getHistoriqueByInvoice, buildHistorique, saveHistorique } from '../../services/historiqueService'
import { getRemises } from '../../services/remiseService'
import { quoteReglement, imputeFromPayments } from '../../services/paiementRemise'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

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
  const [historique, setHistorique] = useState(null)
  const [rules, setRules] = useState([])
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
    const [inv, pays, acc, pt, hist, bareme] = await Promise.all([
      getInvoiceById(id),
      getInvoicePayments(id).catch(() => []),
      resolveAccounts(),
      resolvePaymentTypes(),
      getHistoriqueByInvoice(),
      getRemises().catch(() => []),
    ])
    const ligne = hist.get(String(id)) ?? null

    setInvoice(inv)
    setPayments(pays)
    setAccounts(acc.list)
    setTypes(pt.all)
    setHistorique(ligne)
    setRules(bareme)

    // Le montant proposé est la **dette restante au prix plein**, pas un net
    // remisé : le taux dépend de la date que le client choisira, il n'est donc
    // pas connu ici. Ce qu'il versera s'affichera une fois la date saisie.
    const impute = ligne
      ? Number(ligne.montant_impute) || 0
      : imputeFromPayments(pays, bareme, inv.date)
    const reste = round2(Math.max(0, inv.ttc - impute))

    setForm((f) => ({
      ...f,
      // Un règlement ne peut pas précéder l'émission de la facture : si la
      // facture est datée dans le futur, c'est elle qui donne la date proposée.
      date: fromInputDate(f.date) < inv.date ? toInputDate(inv.date) : f.date,
      amount: reste > 0 ? reste.toFixed(2) : '',
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

  // Cumuls déjà acquis sur la facture. SQLite fait autorité : c'est lui qui
  // garde la dette éteinte, que la somme versée ne suffit pas à retrouver dès
  // qu'une remise est intervenue. Sans lui, les règlements Dolibarr et le
  // barème la reconstituent — le trop-perçu, lui, reste perdu : il n'a jamais
  // été envoyé à Dolibarr.
  const acquis = useMemo(() => {
    if (!invoice) return { impute: 0, remise: 0, surplus: 0 }
    if (historique) {
      return {
        impute: Number(historique.montant_impute) || 0,
        remise: Number(historique.remise_reglement) || 0,
        surplus: Number(historique.surplus) || 0,
      }
    }
    const impute = imputeFromPayments(payments, rules, invoice.date)
    return { impute, remise: round2(impute - invoice.paid), surplus: 0 }
  }, [invoice, historique, payments, rules])

  // Simulation du règlement en cours de saisie, recalculée à chaque frappe de
  // la date comme du montant : c'est elle qui affiche le montant à verser.
  const quote = useMemo(
    () =>
      quoteReglement({
        ttc: invoice?.ttc ?? 0,
        dejaImpute: acquis.impute,
        rules,
        dateFacture: invoice?.date,
        dateReglement: fromInputDate(form.date),
        montantSaisi: Number(String(form.amount).replace(',', '.')),
      }),
    [invoice, acquis.impute, rules, form.date, form.amount]
  )

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

      const saisi = Number(String(form.amount).replace(',', '.'))
      if (!Number.isFinite(saisi) || saisi <= 0) {
        throw new Error('Saisissez un montant supérieur à zéro.')
      }

      // Le taux se lit sur la date de CE règlement, pas sur la facture : c'est
      // la rapidité de ce versement-là qui est récompensée. Un second règlement
      // plus tardif relèvera d'un autre palier, et c'est voulu.
      //
      // Aucun plafond n'est opposé à la saisie : ce qui dépasse la dette
      // devient un trop-perçu, consigné au lieu d'être refusé.
      const q = quoteReglement({
        ttc: invoice.ttc,
        dejaImpute: acquis.impute,
        rules,
        dateFacture: invoice.date,
        dateReglement: paidAt,
        montantSaisi: saisi,
      })

      // Rien n'est envoyé à Dolibarr quand la dette est déjà éteinte : il
      // refuserait d'encaisser au-delà du restant dû. Le versement est alors
      // intégralement du trop-perçu, écrit en base locale plus bas.
      if (q.verse > 0.005) {
        await payInvoice({
          invoiceId: id,
          amount: q.verse,
          date: paidAt,
          accountId: form.accountId,
          paymentTypeId: form.typeId,
          comment: q.rate > 0
            ? `Règlement en ligne — ${client.name} (remise ${q.rate} % sur ${money(q.impute)} soldés)`
            : `Règlement en ligne — ${client.name}`,
        })
      }

      const cumul = {
        impute: round2(acquis.impute + q.impute),
        verse: round2(invoice.paid + q.verse),
        remise: round2(acquis.remise + q.remise),
        surplus: round2(acquis.surplus + q.surplus),
      }

      // Dette éteinte : l'écart entre le prix plein et l'encaissé devient
      // l'escompte, seule forme sous laquelle la remise entre dans Dolibarr.
      // Il porte le cumul des remises, pas celle du dernier règlement.
      //
      // L'échec de cette clôture est signalé sans être traité comme un échec du
      // règlement : celui-ci est déjà écrit chez Dolibarr, et le relancer
      // encaisserait deux fois.
      let closeError = null
      if (q.solde && cumul.remise > 0.01) {
        try {
          await setInvoicePaid(
            id,
            undefined,
            `Remise de règlement — ${money(cumul.remise)} TTC sur ${money(invoice.ttc)} facturés`
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
          ...cumul,
          taux: q.rate,
          dateReglement: paidAt,
        })
      )

      await load()

      const trop = q.surplus > 0.01
        ? ` ${money(q.surplus)} de trop-perçu ont été enregistrés en base locale.`
        : ''

      if (closeError) {
        setError(
          `Votre règlement de ${money(q.verse)} est bien enregistré, mais la remise de ` +
          `${money(cumul.remise)} n'a pas pu être portée sur la facture (${closeError}). ` +
          `Ne la réglez pas une seconde fois : signalez-le.`
        )
      } else {
        const detail =
          `${money(q.verse)} versés pour ${money(q.impute)} soldés` +
          (q.remise > 0.01 ? `, remise ${q.rate} % (${money(q.remise)})` : '')
        setDone(
          q.solde
            ? `Règlement enregistré : ${detail}. Votre facture est soldée.${trop}`
            : `Règlement enregistré : ${detail}. Il reste ${money(q.resteApres)} à solder.${trop}`
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
  const settled = quote.resteAvant <= 0.01
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

        {/* La facture reste au prix plein. La remise ne s'y applique pas : elle
            s'obtient règlement par règlement, selon la date de chacun. */}
        <div className="fp-recap-row">
          <span>Montant facturé TTC</span>
          <span>{money(invoice.ttc)}</span>
        </div>

        <div className="fp-recap-row">
          <span>Déjà versé</span>
          <span className="fp-paid">{money(invoice.paid)}</span>
        </div>
        {acquis.remise > 0.01 && (
          <div className="fp-recap-row">
            <span>Remises déjà obtenues</span>
            <span className="fp-paid">− {money(acquis.remise)}</span>
          </div>
        )}
        {acquis.surplus > 0.01 && (
          <div className="fp-recap-row">
            <span>Sur plus</span>
            <span className="fp-due">{money(acquis.surplus)}</span>
          </div>
        )}
        {/* La dette se compte au prix plein : versé + remises = dette éteinte. */}
        <div className="fp-recap-row fp-recap-row--total">
          <span>Reste à solder</span>
          <span className={settled ? 'fp-paid' : 'fp-due'}>{money(quote.resteAvant)}</span>
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
                Au plus tôt le {day(invoice.date)}, date d'émission.
                {quote.rule
                  ? ` Palier « ${quote.rule.libelle} » : ${quote.rate} % de remise.`
                  : ' Aucun palier ne couvre ce délai : pas de remise.'}
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
              <span className="fp-field-label">Montant à solder</span>
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
                Part de la facture que vous soldez, au prix plein — il reste
                {' '}{money(quote.resteAvant)}.
              </span>
            </label>
          </div>

          {/* Ce que la saisie donne réellement, recalculé à chaque frappe : le
              client voit ce qu'il décaisse avant de valider, et pourquoi. */}
          <div className="fp-recap-row">
            <span>Soldé sur la facture</span>
            <span>{money(quote.impute)}</span>
          </div>
          {quote.rate > 0 && (
            <div className="fp-recap-row">
              <span>
                Remise du jour choisi — {quote.rate} %
                {quote.rule && <span className="fp-recap-rule"> — {quote.rule.libelle}</span>}
              </span>
              <span className="fp-paid">− {money(quote.remise)}</span>
            </div>
          )}
          {quote.surplus > 0.01 && (
            <div className="fp-recap-row">
              <span>Trop-perçu — au-delà de ce que vous devez</span>
              <span className="fp-due">{money(quote.surplus)}</span>
            </div>
          )}
          <div className="fp-recap-row fp-recap-row--total">
            <span>Montant à verser</span>
            <span>{money(quote.verse + quote.surplus)}</span>
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
