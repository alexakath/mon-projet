import { useState, useEffect, useMemo } from 'react'
import {
  getRemises, createRemise, updateRemise, deleteRemise, resetRemises,
  sortRules, describeRule, computeRemise, daysBetween, findGaps,
} from '../services/remiseService'
import { getBillingData } from '../services/invoiceService'
import './RemisesPage.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const EMPTY_DRAFT = { libelle: '', jours_min: '', jours_max: '', taux: '' }

// « du jour 8 au jour 30 », « à partir du jour 31 » — pour signaler un trou.
const gapLabel = ({ from, to }) => {
  if (to === null) return `à partir du jour ${from}`
  if (to === from) return `le jour ${from}`
  return `du jour ${from} au jour ${to}`
}

function RemisesPage() {
  const [rules, setRules] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)

  const load = () =>
    getRemises()
      .then(setRules)
      .catch((err) => setError(err.message))

  useEffect(() => {
    Promise.all([
      getRemises().then(setRules),
      getBillingData().then(setInvoices).catch(() => setInvoices([])),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const sorted = useMemo(() => sortRules(rules), [rules])
  const gaps = useMemo(() => findGaps(rules), [rules])

  const run = async (action, successMessage) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      await load()
      setNotice(successMessage)
      setEditingId(null)
      setAdding(false)
      setDraft(EMPTY_DRAFT)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const payload = () => ({
    libelle: draft.libelle,
    jours_min: draft.jours_min === '' ? 0 : Number(draft.jours_min),
    jours_max: draft.jours_max === '' ? null : Number(draft.jours_max),
    taux: draft.taux === '' ? 0 : Number(draft.taux),
  })

  const startEdit = (rule) => {
    setAdding(false)
    setEditingId(rule.id)
    setDraft({
      libelle: rule.libelle,
      jours_min: String(rule.jours_min ?? 0),
      jours_max: rule.jours_max === null ? '' : String(rule.jours_max),
      taux: String(rule.taux),
    })
  }

  const startAdd = () => {
    setEditingId(null)
    setAdding(true)
    setDraft(EMPTY_DRAFT)
  }

  const cancel = () => {
    setEditingId(null)
    setAdding(false)
    setDraft(EMPTY_DRAFT)
    setError(null)
  }

  // Aperçu : ce que donnerait le barème pour un règlement intervenant
  // aujourd'hui sur chaque facture encore due.
  const today = Math.floor(Date.now() / 1000)
  const preview = useMemo(
    () =>
      invoices
        .filter((inv) => inv.remaining > 0.01)
        .map((inv) => {
          const days = daysBetween(inv.date, today)
          const { rule, rate, discount, net } = computeRemise(rules, days, inv.remaining)
          return { inv, days, rule, rate, discount, net }
        }),
    [invoices, rules, today]
  )

  if (loading) return <div className="page-state">Chargement du barème...</div>

  const editor = (
    <>
      <td>
        <input
          className="rm-input"
          value={draft.libelle}
          onChange={(e) => setDraft({ ...draft, libelle: e.target.value })}
          placeholder="Règlement immédiat"
          autoFocus
        />
      </td>
      <td>
        <input
          className="rm-input rm-input--num"
          type="number"
          min="0"
          step="1"
          value={draft.jours_min}
          onChange={(e) => setDraft({ ...draft, jours_min: e.target.value })}
          placeholder="0"
        />
      </td>
      <td>
        <input
          className="rm-input rm-input--num"
          type="number"
          min="0"
          step="1"
          value={draft.jours_max}
          onChange={(e) => setDraft({ ...draft, jours_max: e.target.value })}
          placeholder="vide = sans fin"
        />
      </td>
      <td>
        <input
          className="rm-input rm-input--num"
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={draft.taux}
          onChange={(e) => setDraft({ ...draft, taux: e.target.value })}
          placeholder="0"
        />
      </td>
      <td className="rm-muted">—</td>
      <td className="rm-actions">
        <button
          className="rm-btn rm-btn--primary"
          disabled={busy}
          onClick={() =>
            editingId
              ? run(() => updateRemise(editingId, payload()), 'Palier modifié.')
              : run(() => createRemise(payload()), 'Palier ajouté.')
          }
        >
          Enregistrer
        </button>
        <button className="rm-btn" onClick={cancel} disabled={busy}>Annuler</button>
      </td>
    </>
  )

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">Configuration</p>
          <h1>Barème de remise</h1>
        </div>
        <span className="page-count">{rules.length} palier{rules.length > 1 ? 's' : ''}</span>
      </div>

      <p className="rm-intro">
        La remise dépend du délai entre la date de facture et la date de règlement.
        Chaque palier couvre un intervalle de jours, <strong>bornes incluses</strong> :
        « du jour 3 au jour 7 » s'applique aux délais de 3, 4, 5, 6 et 7 jours.
        Deux paliers ne peuvent pas se recouvrir — un même délai ne relève jamais
        que d'un seul. Laisser la borne de fin vide crée le palier du bout, sans
        limite supérieure.
      </p>

      {error && <div className="rm-alert rm-alert--error">{error}</div>}
      {notice && <div className="rm-alert rm-alert--ok">{notice}</div>}

      {rules.length === 0 && (
        <div className="rm-alert rm-alert--warn">
          <strong>Aucun palier défini.</strong> Toutes les commandes passent donc à
          0 % de remise, quelle que soit la date de règlement annoncée. Ajoutez un
          palier ou restaurez le barème par défaut ci-dessous.
        </div>
      )}

      {rules.length > 0 && gaps.length > 0 && (
        <div className="rm-alert rm-alert--warn">
          <strong>Délais sans palier : {gaps.map(gapLabel).join(', ')}.</strong>{' '}
          Un règlement tombant dans cet intervalle n'obtient aucune remise. C'est
          peut-être voulu — sinon, étendez un palier voisin ou ajoutez-en un.
        </div>
      )}

      <div className="detail-section">
        <table className="data-table">
          <thead>
            <tr>
              <th>Libellé</th>
              <th className="rm-col-num">Du jour</th>
              <th className="rm-col-num">Au jour</th>
              <th className="rm-col-num">Remise</th>
              <th>Correspond à</th>
              <th className="rm-col-act">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((rule) =>
              editingId === rule.id ? (
                <tr key={rule.id} className="rm-editing">{editor}</tr>
              ) : (
                <tr key={rule.id}>
                  <td className="rm-lead">{rule.libelle}</td>
                  <td className="rm-col-num">{rule.jours_min ?? 0}</td>
                  <td className="rm-col-num">
                    {rule.jours_max === null
                      ? <span className="rm-default">sans fin</span>
                      : rule.jours_max}
                  </td>
                  <td className="rm-col-num">
                    <span className="rm-rate">{rule.taux} %</span>
                  </td>
                  <td className="rm-muted">{describeRule(rule)}</td>
                  <td className="rm-actions">
                    <button className="rm-btn" onClick={() => startEdit(rule)} disabled={busy}>
                      Modifier
                    </button>
                    <button
                      className="rm-btn rm-btn--danger"
                      disabled={busy}
                      onClick={() => run(() => deleteRemise(rule.id), 'Palier supprimé.')}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              )
            )}
            {adding && <tr className="rm-editing">{editor}</tr>}
          </tbody>
        </table>

        <div className="rm-toolbar">
          <button className="rm-btn rm-btn--primary" onClick={startAdd} disabled={busy || adding}>
            Ajouter un palier
          </button>
          <button
            className="rm-btn"
            disabled={busy}
            onClick={() => run(resetRemises, 'Barème par défaut restauré.')}
          >
            Restaurer le barème par défaut
          </button>
        </div>
      </div>

      <div className="detail-section">
        <h3>Aperçu — remise obtenue si le client règle aujourd'hui</h3>
        {preview.length === 0 ? (
          <p className="rm-muted">Aucune facture avec un reste à percevoir.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Facture</th>
                <th>Client</th>
                <th className="rm-col-num">Ancienneté</th>
                <th>Palier appliqué</th>
                <th className="rm-col-num">Reste dû</th>
                <th className="rm-col-num">Remise</th>
                <th className="rm-col-num">Net à payer</th>
              </tr>
            </thead>
            <tbody>
              {preview.map(({ inv, days, rule, rate, discount, net }) => (
                <tr key={inv.id}>
                  <td className="rm-lead">{inv.ref}</td>
                  <td className="rm-muted">{inv.client}</td>
                  <td className="rm-col-num rm-muted">{days === null ? '—' : `${days} j`}</td>
                  <td className="rm-muted">{rule ? rule.libelle : 'Aucun palier'}</td>
                  <td className="rm-col-num">{money(inv.remaining)}</td>
                  <td className="rm-col-num">
                    <span className={rate > 0 ? 'rm-discount' : 'rm-muted'}>
                      {rate > 0 ? `− ${money(discount)} (${rate} %)` : '—'}
                    </span>
                  </td>
                  <td className="rm-col-num rm-net">{money(net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default RemisesPage
