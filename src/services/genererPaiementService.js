import { quoteReglement } from './paiementRemise'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const DAY = 86400

export function buildPayementPlan({
  ttc, dejaImpute = 0, rules, dateFacture, dateDebut, montant, nb, decalage,
}) {
  const total = round2(Math.max(0, Number(montant) || 0))
  const count = Math.max(1, Math.floor(Number(nb) || 0))
  const gap = Math.max(0, Math.floor(Number(decalage) || 0))
  const parVersement = round2(total / count)

  const steps = []
  let imputeCumule = dejaImpute
  let impute = 0
  let verse = 0
  let remise = 0
  let surplus = 0

  for (let i = 1; i <= count; i++) {
    const date = dateDebut + (i - 1) * gap * DAY
    // Le dernier versement absorbe l'écart d'arrondi de la division : la
    // somme des versements saisis reste exactement `montant`.
    const saisi = i === count ? round2(total - parVersement * (count - 1)) : parVersement

    const q = quoteReglement({
      ttc, dejaImpute: imputeCumule, rules, dateFacture, dateReglement: date, montantSaisi: saisi,
    })

    imputeCumule = round2(imputeCumule + q.impute)
    impute = round2(impute + q.impute)
    verse = round2(verse + q.verse)
    remise = round2(remise + q.remise)
    surplus = round2(surplus + q.surplus)

    steps.push({ index: i, date, ...q })
  }

  const last = steps[steps.length - 1]

  return {
    steps, parVersement, total,
    impute, verse, remise, surplus,
    resteApres: last.resteApres, solde: last.solde,
  }
}
