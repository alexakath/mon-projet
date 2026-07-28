const express = require('express')
const router = express.Router()
const db = require('../db')

// Vue consolidée facture → lignes → règlements, calculée en SQL.
// Sert à contrôler les totaux importés sans réinterroger Dolibarr.
//
// La remise de règlement entre dans le calcul du reste : une facture au prix
// plein réglée pour son net est soldée, pas « partiellement réglée ». Sans elle,
// une facture de 1 000 encaissée 700 avec 300 d'escompte afficherait 300 de
// reste, alors qu'il n'y a plus rien à percevoir. Elle se lit dans
// `historique_remises`, rapproché par l'identifiant Dolibarr de la facture.
router.get('/', (req, res) => {
  const factures = db.prepare(`
    SELECT f.*,
           (SELECT COUNT(*) FROM facture_lignes l WHERE l.num_facture = f.num_facture) AS nb_lignes,
           (SELECT IFNULL(SUM(l.total_ht), 0) FROM facture_lignes l WHERE l.num_facture = f.num_facture) AS lignes_ht,
           (SELECT IFNULL(SUM(l.total_ttc), 0) FROM facture_lignes l WHERE l.num_facture = f.num_facture) AS lignes_ttc,
           (SELECT IFNULL(SUM(p.montant), 0) FROM paiements p WHERE p.num_facture = f.num_facture) AS regle,
           (SELECT IFNULL(h.remise_reglement, 0) FROM historique_remises h WHERE h.dolibarr_id = f.dolibarr_id) AS remise,
           (SELECT IFNULL(h.taux_remise, 0) FROM historique_remises h WHERE h.dolibarr_id = f.dolibarr_id) AS taux_remise
    FROM factures f
    ORDER BY f.num_facture ASC
  `).all()

  res.json(factures.map((f) => {
    const couvert = f.regle + f.remise
    return {
      ...f,
      reste: Number((f.lignes_ttc - couvert).toFixed(2)),
      statut: f.regle <= 0 ? 'impayee' : couvert + 0.005 >= f.lignes_ttc ? 'payee' : 'partielle',
    }
  }))
})

router.get('/:num', (req, res) => {
  const facture = db.prepare('SELECT * FROM factures WHERE num_facture = ?').get(req.params.num)
  if (!facture) return res.status(404).json({ error: 'Facture introuvable' })

  facture.lignes = db.prepare(
    'SELECT * FROM facture_lignes WHERE num_facture = ? ORDER BY CAST(ref_detail AS INTEGER)'
  ).all(req.params.num)
  facture.paiements = db.prepare(
    'SELECT * FROM paiements WHERE num_facture = ? ORDER BY id'
  ).all(req.params.num)

  res.json(facture)
})

module.exports = router
