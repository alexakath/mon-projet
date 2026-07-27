const express = require('express')
const router = express.Router()
const db = require('../db')
const { MODULES } = require('../modules')

// Upsert générique : les tables de staging se dédoublonnent sur leur clé
// métier (num_facture, ref_detail…), les tables miroir sur l'id Dolibarr.
router.post('/:moduleKey', (req, res) => {
  const { moduleKey } = req.params
  const mod = MODULES[moduleKey]

  if (!mod) return res.status(404).json({ error: `Module '${moduleKey}' non enregistré.` })
  if (!mod.mapRow) return res.status(400).json({ error: `Module '${moduleKey}' n'a pas de mapRow.` })
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Le body doit être un tableau.' })

  const cols = mod.columns
  const conflictKey = mod.conflictKey || 'id'
  const stampCol = mod.schema.includes('synced_at') ? 'synced_at' : 'imported_at'

  const colsList = cols.join(', ')
  const valsList = cols.map((c) => `@${c}`).join(', ')
  const updateSet = cols
    .filter((c) => c !== conflictKey)
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')

  const upsert = db.prepare(`
    INSERT INTO ${moduleKey} (${colsList}, ${stampCol})
    VALUES (${valsList}, datetime('now'))
    ON CONFLICT(${conflictKey}) DO UPDATE SET
      ${updateSet},
      ${stampCol} = datetime('now')
  `)

  const insertMany = db.transaction((rows) => {
    for (const item of rows) upsert.run(mod.mapRow(item))
  })

  try {
    insertMany(req.body)
    res.json({ stored: req.body.length, message: `${req.body.length} ${moduleKey} stocké(s) dans SQLite.` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
