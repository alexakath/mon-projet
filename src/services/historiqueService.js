// Historique des règlements remisés, stocké en SQLite.
//
// Dolibarr porte la facture au prix plein et n'apprend la remise qu'à
// l'encaissement, sous la forme d'un escompte. Il sait donc combien a été
// facturé et combien a été encaissé, mais pas ce qui a été consenti : le taux,
// et le net attendu qui en découle. C'est cette décomposition que l'historique
// conserve — et c'est elle que la page de règlement relit pour proposer le bon
// montant avant qu'aucun règlement n'existe.
//
// Le backend est optionnel (cf. README) : toutes les lectures retombent sur une
// liste vide et l'écriture est silencieusement ignorée s'il est absent. Le
// filet de sécurité est le taux inscrit dans la note publique de la facture,
// que `invoiceService` sait relire (cf. `remiseRateFromNote`).

const BASE = '/backend/api'

const json = async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Backend ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Construit la ligne d'historique à partir du prix plein et du taux consenti.
// Les cinq montants sont dérivés d'un seul endroit pour qu'ils ne puissent pas
// se contredire : remise + net = facturé, et payé + reste = net.
export function buildHistorique({
  invoiceId, ref, socid, client, date, montantFacture, taux, paye = 0, dateReglement = null,
}) {
  const facture = round2(montantFacture)
  const rate = Number(taux) || 0
  const remise = round2((facture * rate) / 100)
  const net = round2(facture - remise)
  const regle = round2(paye)

  return {
    dolibarr_id: Number(invoiceId),
    facture_ref: ref ?? null,
    socid: socid != null ? Number(socid) : null,
    nom_client: client ?? null,
    date_facture: date ? new Date(date * 1000).toISOString().slice(0, 10) : null,
    montant_facture: facture,
    taux_remise: rate,
    remise_reglement: remise,
    net_a_payer: net,
    paye_reel: regle,
    // Jamais négatif : un trop-perçu ne se raconte pas comme un reste à payer.
    reste_a_payer: round2(Math.max(0, net - regle)),
    date_reglement: dateReglement ? new Date(dateReglement * 1000).toISOString().slice(0, 10) : null,
  }
}

export const getHistorique = () =>
  fetch(`${BASE}/historique_remises`).then(json).catch(() => [])

// Indexé par identifiant de facture Dolibarr : c'est la clé sous laquelle les
// écrans rapprochent l'historique des factures lues chez Dolibarr.
export async function getHistoriqueByInvoice() {
  const rows = await getHistorique()
  return new Map(rows.map((row) => [String(row.dolibarr_id), row]))
}

// L'upsert générique du backend réécrit toutes les colonnes depuis la ligne
// reçue : on envoie donc toujours la ligne complète, jamais un fragment.
export async function saveHistorique(row) {
  try {
    await fetch(`${BASE}/sync/historique_remises`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([row]),
    }).then(json)
    return true
  } catch {
    // Backend absent ou en erreur : la facture existe déjà chez Dolibarr, et
    // l'écran ne doit pas échouer pour une trace locale manquante.
    return false
  }
}
