// Remise appliquée règlement par règlement.
//
// Le barème ne se lit plus à la création de la facture mais à chaque
// encaissement : c'est la date de CE versement-là qui donne le palier, donc le
// taux. Une même facture peut ainsi porter 30 % sur son premier règlement et
// 15 % sur le second.
//
// Quatre montants circulent, et les confondre fausse tout :
//
//   saisi    ce que le client demande à solder, au prix plein de la facture
//   imputé   la part du saisi qui trouve encore de la dette en face
//   versé    ce qu'il décaisse réellement : imputé − remise
//   surplus  le saisi qui ne trouve plus de dette : un trop-perçu
//
// La facture reste chez Dolibarr à son prix plein. Dolibarr n'encaisse que le
// versé ; l'écart devient l'escompte quand la dette est éteinte.

import { daysBetween, findRule } from './remiseService'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Taux applicable à un règlement, d'après sa seule date.
export function rateAt(rules, dateFacture, dateReglement) {
  const delai = daysBetween(dateFacture, dateReglement) ?? 0
  const rule = findRule(rules, delai)
  return { delai, rule, rate: rule ? Number(rule.taux) : 0 }
}

// Simule un règlement sans rien écrire : la page de règlement s'en sert pour
// afficher le montant à verser avant validation, l'import pour le calculer.
//
// `dejaImpute` est la dette déjà éteinte, pas la somme déjà versée. C'est cette
// distinction qui rend le cumul juste quand les taux diffèrent d'un règlement à
// l'autre : 500 soldés à 30 % puis 100 soldés à 15 % éteignent 600 de dette,
// pour 435 encaissés.
export function quoteReglement({
  ttc, dejaImpute = 0, rules, dateFacture, dateReglement, montantSaisi,
}) {
  const { delai, rule, rate } = rateAt(rules, dateFacture, dateReglement)

  const resteAvant = round2(Math.max(0, ttc - dejaImpute))
  const saisi = round2(Math.max(0, Number(montantSaisi) || 0))

  // Au-delà de la dette, le saisi n'a plus rien à éteindre : c'est un
  // trop-perçu. Il ne reçoit aucune remise — on ne récompense pas la rapidité
  // sur une somme qui n'était pas due — et il ne part pas chez Dolibarr, qui
  // refuse d'encaisser au-delà du restant dû.
  const impute = round2(Math.min(saisi, resteAvant))
  const surplus = round2(saisi - impute)

  const verse = round2(impute * (1 - rate / 100))
  const remise = round2(impute - verse)
  const resteApres = round2(resteAvant - impute)

  return {
    delai, rule, rate, resteAvant, saisi, impute, surplus, verse, remise,
    resteApres, solde: resteApres <= 0.01,
  }
}

// Variante pour un règlement dont on connaît le montant **versé**, et non la
// part de dette que le client entend solder.
//
// C'est le cas de l'import CSV : il relate des encaissements déjà intervenus,
// son `montant` est de l'argent reçu. Le prendre pour une imputation ferait
// éteindre 1 400 de dette là où 1 400 versés à 30 % en éteignent 2 000 — la
// facture ne se solderait jamais.
//
// Le raisonnement est donc inversé : le versé remonte à l'imputé, et le
// trop-perçu est le liquide qui excède ce qu'il fallait verser pour tout
// éteindre.
export function quoteVersement({
  ttc, dejaImpute = 0, rules, dateFacture, dateReglement, montantVerse,
}) {
  const { delai, rule, rate } = rateAt(rules, dateFacture, dateReglement)

  const resteAvant = round2(Math.max(0, ttc - dejaImpute))
  const cash = round2(Math.max(0, Number(montantVerse) || 0))

  // Ce qu'il suffirait de verser, au taux du jour, pour éteindre toute la
  // dette restante. Au-delà, le client paie ce qu'il ne doit plus.
  const verseNecessaire = round2(resteAvant * (1 - rate / 100))

  const verse = round2(Math.min(cash, verseNecessaire))
  const surplus = round2(cash - verse)

  // Le `min` borne l'arrondi : sans lui, verse === verseNecessaire pourrait
  // rendre un imputé de quelques centimes au-dessus de la dette.
  const impute = rate >= 100
    ? resteAvant
    : round2(Math.min(resteAvant, verse / (1 - rate / 100)))

  const remise = round2(impute - verse)
  const resteApres = round2(resteAvant - impute)

  return {
    delai, rule, rate, resteAvant, saisi: cash, impute, surplus, verse, remise,
    resteApres, solde: resteApres <= 0.01,
  }
}

// Reconstitue la dette éteinte à partir des seuls règlements Dolibarr, quand
// SQLite ne peut pas la fournir — backend éteint, ou historique perdu.
//
// Chaque versement porte sa date : elle redonne son taux, et le versé remonte à
// l'imputé par la division inverse. Le trop-perçu, lui, reste irrécupérable :
// il n'a jamais été envoyé à Dolibarr.
export function imputeFromPayments(payments, rules, dateFacture) {
  return round2(
    (payments ?? []).reduce((total, p) => {
      const { rate } = rateAt(rules, dateFacture, paymentDate(p.date))
      const verse = Number(p.amount) || 0
      return total + (rate >= 100 ? verse : verse / (1 - rate / 100))
    }, 0)
  )
}

// Dolibarr date ses règlements en « AAAA-MM-JJ HH:MM:SS ». On ne garde que le
// jour, ramené à midi UTC : sans cela le palier changerait selon le fuseau du
// navigateur.
export function paymentDate(value) {
  if (value == null) return null
  if (typeof value === 'number') return value
  const ts = Math.floor(new Date(`${String(value).slice(0, 10)}T12:00:00Z`).getTime() / 1000)
  return Number.isFinite(ts) ? ts : null
}
