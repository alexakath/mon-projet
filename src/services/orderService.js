import { createInvoice, addInvoiceLine, validateInvoice } from './invoiceOps'
import { getRemises, findRule } from './remiseService'
import { cartTotals } from './cartService'
import { buildHistorique, saveHistorique } from './historiqueService'

const DAY = 86400

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
// `plein` est le panier au tarif catalogue, `totals` le même panier une fois la
// remise appliquée. Les deux sont rendus parce que les deux sont écrits : le
// prix plein part chez Dolibarr, le net sert de montant à encaisser.
export async function quoteFromDelay(items, days) {
  const rules = await getRemises()
  const rule = findRule(rules, days)
  const rate = rule ? Number(rule.taux) : 0
  return { rules, rule, rate, plein: cartTotals(items, 0), totals: cartTotals(items, rate) }
}

// Note publique de la facture. Elle n'engage plus le taux : celui-ci ne sera
// connu qu'au règlement, et un versement plus tardif que prévu relèvera d'un
// autre palier. Elle dit donc l'estimation, et sous quelle condition elle tient.
//
// Le libellé change volontairement de « Remise de règlement » à « Remise
// estimée » : `invoiceService.remiseRateFromNote` cherche le premier, ne le
// trouve plus, et laisse la facture à son prix plein — ce qu'elle est.
export const noteRemise = (rate, remise, net, delay) =>
  `Remise estimée : ${rate} % (− ${money(remise)} TTC) — net estimé ${money(net)} TTC ` +
  `si le règlement intervient sous ${delay} jour(s). Le taux retenu sera celui du ` +
  `barème à la date de chaque règlement.`

// Validation du panier : crée la facture **au prix plein**, ses lignes non
// remisées, puis la valide.
//
// La remise n'est volontairement pas portée par les lignes. Sur une commande de
// 1 000 TTC remisée à 30 %, un `remise_percent` sur chaque ligne donnerait une
// facture Dolibarr de 700 : le prix réellement facturé disparaîtrait du
// document. Dolibarr reçoit donc les 1 000, et la remise n'y entre qu'au
// règlement, sous forme d'escompte (cf. `setInvoicePaid`). La décomposition
// complète part en parallèle dans l'historique SQLite.
//
// La date de facture est saisie par le client et transmise telle quelle : on ne
// la remplace pas par la date du jour, une commande pouvant être enregistrée
// après coup. À défaut de saisie, on retombe sur aujourd'hui.
export async function createInvoiceFromCart({ client, items, days, date: dateInput, comment }) {
  if (!items.length) throw new Error('Votre panier est vide.')

  const delay = Math.max(0, Math.floor(Number(days) || 0))
  const { rule, rate, plein, totals } = await quoteFromDelay(items, delay)

  const date =
    dateInput == null || dateInput === ''
      ? today()
      : typeof dateInput === 'number'
        ? dateInput
        : fromInputDate(dateInput)
  if (!date) throw new Error('La date de la facture est invalide.')

  const entete = comment ?? `Commande en ligne — règlement annoncé sous ${delay} jour(s)`

  const invoiceId = await createInvoice({
    socid: client.id,
    date,
    dateLimite: date + delay * DAY,
    note: rate > 0
      ? `${entete}\n${noteRemise(rate, plein.ttc - totals.ttc, totals.ttc, delay)}`
      : entete,
  })

  const lines = []
  for (const item of items) {
    const lineId = await addInvoiceLine(invoiceId, {
      desc: item.label,
      label: item.label,
      qty: item.qty,
      subprice: item.ht,
      tva: item.tva,
      // Aucune remise sur la ligne : la facture porte le prix catalogue. Ni
      // celle du barème — qui n'entrera qu'à l'encaissement, en escompte, pour
      // laisser le montant facturé intact — ni la `remiseImport` de l'article,
      // qui n'est qu'une indication relevée sur une facture passée.
      remise: 0,
      productId: item.productId,
    })
    lines.push({ ...item, lineId })
  }

  const validated = await validateInvoice(invoiceId)

  // L'historique est écrit dès la création, avant tout encaissement : rien n'y
  // est encore imputé et aucun taux n'y figure. Le taux ne se décidera qu'au
  // règlement, d'après sa date — deux règlements pourront en porter deux
  // différents. Chaque encaissement complétera cette ligne.
  await saveHistorique(
    buildHistorique({
      invoiceId,
      ref: validated?.ref ?? null,
      socid: client.id,
      client: client.name,
      date,
      montantFacture: plein.ttc,
    })
  )

  return {
    invoiceId, delay, rule, rate, plein, totals, lines, date,
    dueDate: date + delay * DAY,
  }
}
