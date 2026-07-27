import { dolibarrList, dolibarrPost } from './dolibarrApi'

// Opérations d'écriture sur les factures Dolibarr, partagées par l'import CSV
// et la validation de panier. Elles portent les contraintes constatées sur
// l'instance : les garder à un seul endroit évite qu'une des deux dérive.

// ─── Corps complet d'une ligne de facture ────────────────────────────────────
//
// api_invoices.class.php lit toutes ces propriétés sans vérifier qu'elles
// existent. Une propriété absente déclenche un avertissement PHP qui, avec
// display_errors actif, est écrit dans la réponse : le JSON devient illisible
// et le flux gzip corrompu fait échouer la requête côté navigateur.

export const EMPTY_LINE_PROPS = {
  label: '',
  remise_percent: '0',
  localtax1_tx: '0',
  localtax2_tx: '0',
  fk_fournprice: null,
  pa_ht: '0',
  date_start: '',
  date_end: '',
  fk_code_ventilation: '0',
  info_bits: '0',
  fk_remise_except: null,
  price_base_type: 'HT',
  rang: '-1',
  special_code: '0',
  origin: '',
  origin_id: null,
  array_options: {},
  situation_percent: '100',
  fk_prev_id: null,
  fk_unit: null,
  ref_ext: '',
  multicurrency_subprice: '0',
}

// ─── Comptes et modes de règlement ───────────────────────────────────────────

export const isCashLabel = (label) => /caiss|espec|liquid|cash/i.test(String(label ?? ''))

export const resolveAccounts = async () => {
  const list = await dolibarrList('/bankaccounts')
  return {
    list,
    byLabel: (raw) => {
      const label = String(raw || '').trim()
      if (!label) return list[0] ?? null

      const exact = list.find(
        (a) =>
          String(a.ref || '').toLowerCase() === label.toLowerCase() ||
          String(a.label || '').toLowerCase() === label.toLowerCase()
      )
      if (exact) return exact

      const wantCash = isCashLabel(label)
      return list.find((a) => String(a.type) === (wantCash ? '2' : '1')) ?? list[0] ?? null
    },
  }
}

// Les identifiants des types de règlement diffèrent d'une instance à l'autre
// (ici VIR=2 et LIQ=4) : on les résout par code plutôt que de les figer.
export const resolvePaymentTypes = async () => {
  const fallback = { bank: '2', cash: '4' }
  try {
    const types = await dolibarrList('/setup/dictionary/payment_types?limit=100')
    const byCode = {}
    for (const t of types) {
      if (t?.code) byCode[String(t.code).toUpperCase()] = String(t.id)
    }
    return {
      bank: byCode.VIR ?? fallback.bank,
      cash: byCode.LIQ ?? fallback.cash,
      all: types.map((t) => ({ id: String(t.id), code: t.code, label: t.label })),
      resolved: Object.keys(byCode).length > 0,
    }
  } catch {
    return { ...fallback, all: [], resolved: false }
  }
}

// ─── Écritures ───────────────────────────────────────────────────────────────

export const createInvoice = ({ socid, date, dateLimite, note }) => {
  const body = { socid: String(socid), type: '0', date, note_public: note ?? '' }
  if (dateLimite) body.date_lim_reglement = dateLimite
  return dolibarrPost('/invoices', body).then(String)
}

export const addInvoiceLine = (invoiceId, line) =>
  dolibarrPost(`/invoices/${invoiceId}/lines`, {
    ...EMPTY_LINE_PROPS,
    desc: line.desc,
    label: line.label ?? line.desc,
    qty: String(line.qty),
    subprice: String(line.subprice),
    tva_tx: String(line.tva ?? 0),
    remise_percent: String(line.remise ?? 0),
    product_type: '0',
    fk_product: line.productId ?? null,
  }).then(String)

// La validation remplace la référence provisoire « (PROVxx) » par la définitive
// et fige la facture.
//
// L'API REST accepte pourtant un règlement sur un brouillon — vérifié, elle ne
// renvoie aucune erreur. L'interface de Dolibarr, elle, ne propose « Saisir
// règlement » qu'après validation, et pour une bonne raison : rattacher un
// paiement à un document encore modifiable et sans référence définitive n'a pas
// de sens comptable. On valide donc toujours avant de payer.
export const validateInvoice = (invoiceId) =>
  dolibarrPost(`/invoices/${invoiceId}/validate`, { notrigger: 0 })

// `paymentsdistributed` accepte un montant partiel, là où /invoices/{id}/payments
// solderait tout le restant dû. `closepaidinvoices` attend littéralement
// "yes"/"no" — "1" renvoie une 400.
export const payInvoice = ({ invoiceId, amount, date, accountId, paymentTypeId, comment }) =>
  dolibarrPost('/invoices/paymentsdistributed', {
    arrayofamounts: { [invoiceId]: { amount: String(amount), multicurrency_amount: '' } },
    datepaye: date,
    paymentid: String(paymentTypeId),
    closepaidinvoices: 'yes',
    accountid: String(accountId),
    comment: comment ?? '',
  }).then(String)
