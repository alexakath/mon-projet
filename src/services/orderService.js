import { createInvoice, addInvoiceLine, validateInvoice } from './invoiceOps'
import { getRemises, findRule } from './remiseService'
import { cartTotals } from './cartService'

const DAY = 86400

// Midi UTC : la date de facture ne doit pas dépendre de l'heure ni du fuseau
// dans lequel le panier est validé.
export const today = () => {
  const now = new Date()
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12) / 1000)
}

// <input type="date"> parle en « AAAA-MM-JJ », Dolibarr en timestamp.
export const toInputDate = (ts) => new Date(ts * 1000).toISOString().slice(0, 10)

export const fromInputDate = (value) => {
  const ts = Math.floor(new Date(`${value}T12:00:00Z`).getTime() / 1000)
  return Number.isFinite(ts) ? ts : null
}

// Le client annonce dans combien de jours il réglera ; le barème en déduit la
// remise. C'est cet engagement qui est facturé, pas le règlement lui-même.
export async function quoteFromDelay(items, days) {
  const rules = await getRemises()
  const rule = findRule(rules, days)
  const rate = rule ? Number(rule.taux) : 0
  return { rules, rule, rate, totals: cartTotals(items, rate) }
}

// Validation du panier : crée la facture, ses lignes remisées, puis la valide.
// La facture est validée dans la foulée : elle y gagne sa référence définitive
// et devient figée, ce qui est la condition d'un règlement propre.
// La date de facture est saisie par le client et transmise telle quelle : on ne
// la remplace pas par la date du jour, une commande pouvant être enregistrée
// après coup. À défaut de saisie, on retombe sur aujourd'hui.
export async function createInvoiceFromCart({ client, items, days, date: dateInput, comment }) {
  if (!items.length) throw new Error('Votre panier est vide.')

  const delay = Math.max(0, Math.floor(Number(days) || 0))
  const { rule, rate, totals } = await quoteFromDelay(items, delay)

  const date =
    dateInput == null || dateInput === ''
      ? today()
      : typeof dateInput === 'number'
        ? dateInput
        : fromInputDate(dateInput)
  if (!date) throw new Error('La date de la facture est invalide.')

  const invoiceId = await createInvoice({
    socid: client.id,
    date,
    dateLimite: date + delay * DAY,
    note: comment ?? `Commande en ligne — règlement annoncé sous ${delay} jour(s)`,
  })

  const lines = []
  for (const item of items) {
    const lineId = await addInvoiceLine(invoiceId, {
      desc: item.label,
      label: item.label,
      qty: item.qty,
      subprice: item.ht,
      tva: item.tva,
      remise: rate,
      productId: item.productId,
    })
    lines.push({ ...item, lineId })
  }

  await validateInvoice(invoiceId)

  return { invoiceId, delay, rule, rate, totals, lines, date, dueDate: date + delay * DAY }
}
