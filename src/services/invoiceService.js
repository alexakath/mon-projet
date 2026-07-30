import { dolibarrFetch, dolibarrList } from './dolibarrApi'
import { daysBetween } from './remiseService'

// Dolibarr renvoie ses montants en chaînes ("5562.00000000") et calcule déjà
// `totalpaid` et `remaintopay` : inutile d'interroger les règlements facture
// par facture, tout arrive avec la liste.
const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

export const INVOICE_TYPES = { 0: 'Facture', 1: 'Récurrente', 2: 'Avoir', 3: 'Acompte', 5: 'Situation' }

export async function getInvoices() {
  return dolibarrList('/invoices')
}

export async function getThirdparties() {
  return dolibarrList('/thirdparties')
}

// Une facture seule, normalisée comme celles de getBillingData.
export async function getInvoiceById(id) {
  const [invoice, thirdparties] = await Promise.all([
    dolibarrFetch(`/invoices/${id}`),
    dolibarrList('/thirdparties'),
  ])
  const name = thirdparties.find((t) => String(t.id) === String(invoice.socid))?.name
  return normalizeInvoice(invoice, name)
}

export async function getInvoicePayments(id) {
  const payments = await dolibarrList(`/invoices/${id}/payments`)
  return payments.map((p) => ({
    ref: p.ref,
    amount: num(p.amount),
    type: p.type,
    date: p.date,
  }))
}

// Taux de remise consenti, relu dans la note publique de la facture.
//
// Tant que la facture n'est pas encaissée, Dolibarr ne connaît pas ce taux : la
// facture y est au prix plein et l'escompte n'existera qu'au règlement. Le taux
// est donc écrit dans la note à la création (cf. `orderService.noteRemise`), ce
// qui rend la facture Dolibarr auto-suffisante — et permet à la page de
// règlement de proposer le bon montant même sans le backend SQLite.
export function remiseRateFromNote(note) {
  const found = /Remise de règlement\s*:\s*([\d.,]+)\s*%/i.exec(String(note ?? ''))
  if (!found) return 0
  const rate = Number(found[1].replace(',', '.'))
  return Number.isFinite(rate) && rate > 0 && rate <= 100 ? rate : 0
}

function normalizeInvoice(inv, clientName) {
  const ttc = num(inv.total_ttc)
  const paid = num(inv.totalpaid)
  const note = inv.note_public ?? ''

  // `paye` à 1 — statut 2 dans l'interface — signifie « plus rien à percevoir »,
  // y compris quand l'encaissement est resté inférieur au total facturé. L'écart
  // est alors la remise de règlement (escompte) consentie à l'encaissement :
  // c'est sous cette forme que la remise vit dans Dolibarr, la facture étant
  // émise au prix plein.
  const closed = String(inv.paye ?? '') === '1' || String(inv.statut) === '2'
  const remiseReglement = closed ? Math.max(0, Math.round((ttc - paid) * 100) / 100) : 0

  return {
    id: String(inv.id),
    ref: inv.ref,
    type: String(inv.type),
    typeLabel: INVOICE_TYPES[inv.type] ?? `Type ${inv.type}`,
    statut: String(inv.statut),
    date: inv.date ? Number(inv.date) : null,
    dateLimite: inv.date_lim_reglement ? Number(inv.date_lim_reglement) : null,
    socid: String(inv.socid),
    client: clientName ?? `Tiers ${inv.socid}`,
    note,
    ht: num(inv.total_ht),
    tva: num(inv.total_tva),
    // Montant réellement facturé : le prix plein, remise non déduite.
    ttc,
    paid,
    // Taux annoncé (note) tant que rien n'est encaissé ; une fois la facture
    // close, le taux effectivement obtenu se lit sur les montants.
    remiseRate: closed && ttc > 0
      ? Math.round((remiseReglement / ttc) * 1000) / 10
      : remiseRateFromNote(note),
    remiseReglement,
    // `remaintopay` est absent sur un brouillon : on retombe sur le calcul.
    // Une facture close ne laisse rien à payer, quel que soit ce que Dolibarr
    // renvoie encore comme restant dû.
    remaining: closed ? 0 : inv.remaintopay != null ? num(inv.remaintopay) : ttc - paid,
    lines: (inv.lines ?? []).map((l) => ({
      id: String(l.id),
      productId: l.fk_product ? String(l.fk_product) : null,
      ref: l.product_ref || l.ref || null,
      label: l.product_label || l.label || l.desc || 'Ligne libre',
      qty: num(l.qty),
      unitPrice: num(l.subprice),
      remise: num(l.remise_percent),
      tvaRate: num(l.tva_tx),
      ht: num(l.total_ht),
      tva: num(l.total_tva),
      ttc: num(l.total_ttc),
    })),
  }
}

// ─── Arrondi partagé ─────────────────────────────────────────────────────────

const round2 = (n) => Math.round(n * 100) / 100

// ─── TVA d'une facture ───────────────────────────────────────────────────────

// Le taux à retenir pour ventiler un règlement.
//
// Il se lit sur la facture telle qu'elle est, remise comprise : Dolibarr
// applique la remise au HT puis la TVA sur ce HT réduit, si bien que le rapport
// `total_tva / total_ht` donne déjà le taux effectif — inutile, et faux, de
// repartir du taux catalogue du produit.
//
// Une facture peut mêler plusieurs taux (F001 porte du 14,5 % et du 20 %). Il
// n'existe alors pas de « taux de la facture » : on renvoie le taux moyen
// pondéré, en signalant qu'il est composite pour que l'écran puisse le dire.
export function invoiceVatRate(invoice) {
  const lines = invoice.lines ?? []
  const rates = [...new Set(lines.map((l) => round2(l.tvaRate)).filter((r) => r > 0))]

  if (rates.length === 1) return { rate: rates[0], uniform: true, rates }

  // Sans ligne exploitable — facture chargée sans son détail — le rapport des
  // totaux reste disponible et suffit.
  const rate = invoice.ht > 0 ? round2((invoice.tva / invoice.ht) * 100) : 0
  return { rate, uniform: rates.length === 0, rates }
}

// Ventile un montant TTC au taux donné. Le règlement est saisi TTC : c'est ce
// que le client verse, la part de TVA s'en déduit.
export function splitVat(amountTtc, rate) {
  const ttc = Number(amountTtc) || 0
  const taux = Number(rate) || 0
  const ht = round2(ttc / (1 + taux / 100))
  return { ttc: round2(ttc), ht, tva: round2(ttc - ht) }
}

// Charge tout ce dont le tableau de bord a besoin, en deux requêtes.
export async function getBillingData() {
  const [invoices, thirdparties] = await Promise.all([getInvoices(), getThirdparties()])
  const clientById = new Map(thirdparties.map((t) => [String(t.id), t.name]))
  return invoices.map((inv) => normalizeInvoice(inv, clientById.get(String(inv.socid))))
}

// ─── État de règlement ───────────────────────────────────────────────────────

// Le reste à payer est testé en premier : une facture soldée par un escompte
// n'a plus rien à percevoir, même si l'encaissement reste inférieur au facturé.
export function paymentState(invoice) {
  if (invoice.remaining <= 0.01) return { key: 'payee', label: 'Payée' }
  if (invoice.paid <= 0) return { key: 'impayee', label: 'Impayée' }
  return { key: 'partielle', label: 'Partiellement réglée' }
}

export const STATUT_LABELS = { 0: 'Brouillon', 1: 'Validée', 2: 'Payée', 3: 'Abandonnée' }

// ─── Regroupement par mois ───────────────────────────────────────────────────

export function monthKey(timestamp) {
  const d = new Date(timestamp * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key) {
  const [year, month] = key.split('-')
  return `${MONTHS[Number(month) - 1]} ${year}`
}

// Les factures sans date ne sont rattachables à aucun mois : on les isole
// plutôt que de les faire disparaître du total.
export function groupByMonth(invoices) {
  const months = new Map()
  const undated = []

  for (const invoice of invoices) {
    if (!invoice.date) {
      undated.push(invoice)
      continue
    }
    const key = monthKey(invoice.date)
    if (!months.has(key)) {
      months.set(key, {
        key, label: monthLabel(key), invoices: [],
        ttc: 0, paid: 0, remaining: 0, remise: 0,
      })
    }
    const bucket = months.get(key)
    bucket.invoices.push(invoice)
    bucket.ttc += invoice.ttc
    bucket.paid += invoice.paid
    bucket.remaining += invoice.remaining
    bucket.remise += invoice.remiseReglement
  }

  return {
    months: [...months.values()].sort((a, b) => b.key.localeCompare(a.key)),
    undated,
  }
}

// ─── Ventes par produit ──────────────────────────────────────────────────────

// Une ligne sans produit rattaché reste comptée, regroupée sous son libellé :
// l'écarter fausserait le total des ventes.
export function aggregateProducts(invoices) {
  const products = new Map()

  for (const invoice of invoices) {
    // Un avoir porte des montants négatifs : il vient naturellement en
    // déduction des ventes du produit concerné.
    for (const line of invoice.lines) {
      const key = line.ref || line.label
      if (!products.has(key)) {
        products.set(key, {
          key,
          ref: line.ref,
          label: line.label,
          qty: 0,
          ht: 0,
          ttc: 0,
          sales: [],
        })
      }
      const entry = products.get(key)
      entry.qty += line.qty
      entry.ht += line.ht
      entry.ttc += line.ttc
      entry.sales.push({
        invoiceId: invoice.id,
        invoiceRef: invoice.ref,
        client: invoice.client,
        date: invoice.date,
        qty: line.qty,
        unitPrice: line.unitPrice,
        ht: line.ht,
        ttc: line.ttc,
      })
    }
  }

  return [...products.values()].sort((a, b) => b.ht - a.ht)
}

// ─── Totaux ──────────────────────────────────────────────────────────────────

export function totals(invoices) {
  return invoices.reduce(
    (acc, inv) => ({
      count: acc.count + 1,
      ht: acc.ht + inv.ht,
      ttc: acc.ttc + inv.ttc,
      paid: acc.paid + inv.paid,
      remaining: acc.remaining + inv.remaining,
      remise: acc.remise + inv.remiseReglement,
    }),
    { count: 0, ht: 0, ttc: 0, paid: 0, remaining: 0, remise: 0 }
  )
}

// ─── Impayés ────────────────────────────────────────────────────────────────

// Une facture est due tant qu'il reste un montant à percevoir. Le seuil d'un
// centime évite qu'un arrondi fasse ressortir une facture soldée. Les avoirs
// portent des montants négatifs : ils sont écartés sans test sur le type.
export function isUnpaid(invoice) {
  return invoice.remaining > 0.01
}

// Échéance la plus proche en premier. Une facture sans date limite passe en
// dernier plutôt que de remonter en tête sur une comparaison avec null.
export function unpaidInvoices(invoices) {
  const dueAt = (inv) => inv.dateLimite ?? Number.MAX_SAFE_INTEGER
  return invoices.filter(isUnpaid).sort((a, b) => dueAt(a) - dueAt(b))
}

// Jours de retard : 0 tant que l'échéance n'est pas dépassée, null si la
// facture n'en porte pas. `daysBetween` ramène les dates à minuit, donc une
// facture échue aujourd'hui compte 0 jour de retard et non 1.
export function overdueDays(invoice, nowTs = Math.floor(Date.now() / 1000)) {
  if (!invoice.dateLimite) return null
  return Math.max(0, daysBetween(invoice.dateLimite, nowTs))
}
