import { useState, useEffect, useMemo, useCallback } from 'react'
import { getBillingData, getInvoicePayments, unpaidInvoices } from '../services/invoiceService'
import { getRemises } from '../services/remiseService'
import { getHistoriqueByInvoice, buildHistorique, saveHistorique } from '../services/historiqueService'
import { imputeFromPayments } from '../services/paiementRemise'
import { buildPayementPlan } from '../services/genererPaiementService'
import {
  resolveAccounts, resolvePaymentTypes, payInvoice, setInvoicePaid, isCashLabel,
} from '../services/invoiceOps'
import { toInputDate, fromInputDate } from '../services/orderService'
import './GenererPayement.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR') : '—')

function GenererPayement() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const [invoiceId, setInvoiceId] = useState('')
  const [invoice, setInvoice] = useState(null)
  const [payments, setPayments] = useState([])
  const [accounts, setAccounts] = useState([])
  const [types, setTypes] = useState([])
  const [historique, setHistorique] = useState(null)
  const [rules, setRules] = useState([])

  const [form, setForm] = useState({
    dateDebut: '', montant: '', nb: '1', decalage: '0', accountId: '', typeId: '',
  })

  useEffect(() => {
    getBillingData()
      .then((all) => setInvoices(unpaidInvoices(all)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Recharge tout le contexte de la facture choisie : règlements connus,
  // remise déjà acquise, barème, comptes et modes de règlement Dolibarr.
  const load = useCallback(async () => {
    if (!invoiceId) return
    const [inv, pays, acc, pt, hist, bareme] = await Promise.all([
      getBillingData().then((all) => all.find((i) => i.id === invoiceId)),
      getInvoicePayments(invoiceId).catch(() => []),
      resolveAccounts(),
      resolvePaymentTypes(),
      getHistoriqueByInvoice(),
      getRemises().catch(() => []),
    ])
    if (!inv) throw new Error('Facture introuvable.')

    const ligne = hist.get(String(invoiceId)) ?? null
    const impute = ligne ? Number(ligne.montant_impute) || 0 : imputeFromPayments(pays, bareme, inv.date)
    const reste = round2(Math.max(0, inv.ttc - impute))

    setInvoice(inv)
    setPayments(pays)
    setAccounts(acc.list)
    setTypes(pt.all)
    setHistorique(ligne)
    setRules(bareme)
    setForm((f) => ({
      dateDebut: toInputDate(inv.date),
      
      montant: reste > 0 ? reste.toFixed(2) : '',
      nb: f.nb || '1',
      decalage: f.decalage || '0',
      accountId: f.accountId || String(acc.list[0]?.id ?? ''),
      typeId: f.typeId || pt.bank,
    }))
  }, [invoiceId])

  useEffect(() => {
    setInvoice(null)
    setError(null)
    setNotice(null)
    if (!invoiceId) return
    load().catch((err) => setError(err.message))
  }, [invoiceId, load])

  // Cumuls déjà acquis sur la facture, comme sur la page de règlement client :
  // SQLite fait autorité, et à défaut le barème reconstitue la dette éteinte
  // à partir des seuls règlements Dolibarr.
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

  const plan = useMemo(() => {
    if (!invoice) return null
    const dateDebut = fromInputDate(form.dateDebut)
    if (!dateDebut) return null
    return buildPayementPlan({
      ttc: invoice.ttc,
      dejaImpute: acquis.impute,
      rules,
      dateFacture: invoice.date,
      dateDebut,
      montant: form.montant,
      nb: form.nb,
      decalage: form.decalage,
    })
    console.log(form.dateDebut)
  }, [invoice, acquis.impute, rules, form.dateDebut, form.montant, form.nb, form.decalage])

  const generate = async () => {
    if (!invoice || !plan) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (!form.accountId || !form.typeId) {
        throw new Error('Choisissez un compte et un mode de règlement.')
      }

      // Écrit chaque versement chez Dolibarr, dans l'ordre chronologique du
      // plan. Rien n'est envoyé pour un versement entièrement absorbé par le
      // trop-perçu : Dolibarr refuserait d'encaisser au-delà du restant dû.
      for (const step of plan.steps) {
        if (step.verse > 0.005) {
          await payInvoice({
            invoiceId,
            amount: step.verse,
            date: step.date,
            accountId: form.accountId,
            paymentTypeId: form.typeId,
            comment: step.rate > 0
              ? `Règlement généré ${step.index}/${plan.steps.length} (remise ${step.rate} % sur ${money(step.impute)} soldés)`
              : `Règlement généré ${step.index}/${plan.steps.length}`,
          })
        }
      }

      const cumul = {
        impute: round2(acquis.impute + plan.impute),
        verse: round2(invoice.paid + plan.verse),
        remise: round2(acquis.remise + plan.remise),
        surplus: round2(acquis.surplus + plan.surplus),
      }

      let closeError = null
      if (plan.solde && cumul.remise > 0.01) {
        try {
          await setInvoicePaid(
            invoiceId,
            undefined,
            `Remise de règlement — ${money(cumul.remise)} TTC sur ${money(invoice.ttc)} facturés`
          )
        } catch (err) {
          closeError = err.message
        }
      }

      const dernier = plan.steps[plan.steps.length - 1]
      await saveHistorique(
        buildHistorique({
          invoiceId, ref: invoice.ref, socid: invoice.socid, client: invoice.client,
          date: invoice.date, montantFacture: invoice.ttc,
          ...cumul, taux: dernier.rate, dateReglement: dernier.date,
        })
      )

      await load()

      if (closeError) {
        setError(
          `Les règlements sont bien enregistrés, mais la remise de ${money(cumul.remise)} n'a pas ` +
          `pu être portée sur la facture (${closeError}). Ne les régénérez pas : signalez-le.`
        )
      } else {
        setNotice(
          plan.solde
            ? `${plan.steps.length} règlement(s) généré(s) pour ${money(plan.verse)} versés. La facture est soldée.`
            : `${plan.steps.length} règlement(s) généré(s) pour ${money(plan.verse)} versés. ` +
              `Il reste ${money(plan.resteApres)} à solder : facture partiellement payée.`
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page-state">Chargement des factures...</div>

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">Vue d'ensemble</p>
          <h1>Générer un paiement</h1>
        </div>
      </div>

      <p className="rm-intro">
        
      </p>

      {error && <div className="rm-alert rm-alert--error">{error}</div>}
      {notice && <div className="rm-alert rm-alert--ok">{notice}</div>}

      <div className="detail-section">
        <label className="gp-field">
          <span className="gp-field-label">Facture</span>
          <select
            className="rm-input"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            disabled={busy}
          >
            <option value="">— Choisir une facture —</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.ref} — {inv.client} — reste {money(inv.remaining)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {invoice && (
        <>
          {/* <div className="summary-row">
            <div className="summary-card">
              <div className="summary-card-value">{money(invoice.ttc)}</div>
              <div className="summary-card-label">Facturé TTC</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-value db-value--paid">{money(acquis.impute)}</div>
              <div className="summary-card-label">Déjà imputé</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-value db-value--due">
                {money(round2(invoice.ttc - acquis.impute))}
              </div>
              <div className="summary-card-label">Reste à solder</div>
            </div>
          </div> */}

          <div className="detail-section">
            <h3>Répartition</h3>
            <div className="gp-form-grid">
              <label className="gp-field">
                <span className="gp-field-label">Date début</span>
                <input
                  type="date"
                  className="rm-input"
                  value={form.dateDebut}
                  min={toInputDate(invoice.date)}
                  onChange={(e) => setForm({ ...form, dateDebut: e.target.value })}
                  disabled={busy}
                />
              </label>

              <label className="gp-field">
                <span className="gp-field-label">Montant</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="rm-input"
                  value={form.montant}
                  onChange={(e) => setForm({ ...form, montant: e.target.value })}
                  disabled={busy}
                />
              </label>

              <label className="gp-field">
                <span className="gp-field-label">Nb</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="rm-input"
                  value={form.nb}
                  onChange={(e) => setForm({ ...form, nb: e.target.value })}
                  disabled={busy}
                />
              </label>

              <label className="gp-field">
                <span className="gp-field-label">Décalage (jours)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="rm-input"
                  value={form.decalage}
                  onChange={(e) => setForm({ ...form, decalage: e.target.value })}
                  disabled={busy}
                />
              </label>

              <label className="gp-field">
                <span className="gp-field-label">Mode de règlement</span>
                <select
                  className="rm-input"
                  value={form.typeId}
                  onChange={(e) => setForm({ ...form, typeId: e.target.value })}
                  disabled={busy}
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>{t.label} ({t.code})</option>
                  ))}
                </select>
              </label>

              <label className="gp-field">
                <span className="gp-field-label">Compte à créditer</span>
                <select
                  className="rm-input"
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
            </div>
          </div>

          {plan && (
            <div className="detail-section">
              <h3>Aperçu des versements — {money(plan.parVersement)} chacun</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th className="rm-col-num">Saisi</th>
                    <th>Palier</th>
                    <th className="rm-col-num">Imputé</th>
                    <th className="rm-col-num">Versé</th>
                    <th className="rm-col-num">Remise</th>
                    <th className="rm-col-num">Surplus</th>
                    <th className="rm-col-num">Reste après</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.steps.map((step) => (
                    <tr key={step.index}>
                      <td>{step.index}</td>
                      <td className="muted">{day(step.date)}</td>
                      <td className="rm-col-num">{money(step.saisi)}</td>
                      <td className="rm-muted">
                        {step.rule ? `${step.rule.libelle} (${step.rate} %)` : '—'}
                      </td>
                      <td className="rm-col-num">{money(step.impute)}</td>
                      <td className="rm-col-num db-value--paid">{money(step.verse)}</td>
                      <td className="rm-col-num">{step.remise > 0.01 ? `− ${money(step.remise)}` : '—'}</td>
                      <td className="rm-col-num">{step.surplus > 0.01 ? money(step.surplus) : '—'}</td>
                      <td className="rm-col-num">{money(step.resteApres)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="db-total">
                    <td colSpan={4}>Total généré</td>
                    <td className="rm-col-num">{money(plan.impute)}</td>
                    <td className="rm-col-num db-value--paid">{money(plan.verse)}</td>
                    <td className="rm-col-num">{money(plan.remise)}</td>
                    <td className="rm-col-num">{money(plan.surplus)}</td>
                    <td className="rm-col-num">{money(plan.resteApres)}</td>
                  </tr>
                </tfoot>
              </table>
              <div className="rm-toolbar">
                <button
                  className="rm-btn rm-btn--primary"
                  disabled={busy || plan.total <= 0}
                  onClick={generate}
                >
                  {busy ? 'Génération…' : 'Générer les paiements'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default GenererPayement
