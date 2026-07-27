const express = require('express')
const router = express.Router()
const db = require('../db')

// Vue consolidée facture → lignes → règlements, calculée en SQL.
// Sert à contrôler les totaux importés sans réinterroger Dolibarr.
router.get('/', (req, res) => {
  const factures = db.prepare(`
    SELECT f.*,
           (SELECT COUNT(*) FROM facture_lignes l WHERE l.num_facture = f.num_facture) AS nb_lignes,
           (SELECT IFNULL(SUM(l.total_ht), 0) FROM facture_lignes l WHERE l.num_facture = f.num_facture) AS lignes_ht,
           (SELECT IFNULL(SUM(l.total_ttc), 0) FROM facture_lignes l WHERE l.num_facture = f.num_facture) AS lignes_ttc,
           (SELECT IFNULL(SUM(p.montant), 0) FROM paiements p WHERE p.num_facture = f.num_facture) AS regle
    FROM factures f
    ORDER BY f.num_facture ASC
  `).all()

  res.json(factures.map((f) => ({
    ...f,
    reste: Number((f.lignes_ttc - f.regle).toFixed(2)),
    statut: f.regle <= 0 ? 'impayee' : f.regle + 0.005 >= f.lignes_ttc ? 'payee' : 'partielle',
  })))
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
