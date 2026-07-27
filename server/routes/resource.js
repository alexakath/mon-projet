const express = require('express')
const db = require('../db')

// Un même routeur sert toutes les tables. Les modules qui déclarent `crud: true`
// gagnent en plus la création, la modification et la suppression unitaire.
const makeResourceRouter = (key, mod) => {
  const router = express.Router()
  const orderBy = mod.orderBy || 'id DESC'

  router.get('/', (req, res) =>
    res.json(db.prepare(`SELECT * FROM ${key} ORDER BY ${orderBy}`).all())
  )

  router.get('/count', (req, res) =>
    res.json(db.prepare(`SELECT COUNT(*) as count FROM ${key}`).get())
  )

  router.delete('/', (req, res) => {
    const info = db.prepare(`DELETE FROM ${key}`).run()
    res.json({ deleted: info.changes, message: `Table ${key} vidée.` })
  })

  if (!mod.crud) return router

  const cols = mod.columns
  const check = (row) => (mod.validate ? mod.validate(row) : null)

  // Une ligne peut être valide isolément et contredire celles déjà en base —
  // deux paliers de remise qui se recouvrent, par exemple. Cette règle-là
  // dépend du module : elle vit dans sa définition, le routeur ne fait que la
  // solliciter en lui passant les autres lignes. `excludeId` écarte la ligne
  // en cours de modification, qui ne saurait entrer en conflit avec elle-même.
  const guard = (mapped, excludeId) => {
    if (!mod.conflict) return null
    const others = excludeId
      ? db.prepare(`SELECT * FROM ${key} WHERE id != ?`).all(excludeId)
      : db.prepare(`SELECT * FROM ${key}`).all()
    return mod.conflict(mapped, others)
  }

  router.post('/', (req, res) => {
    const error = check(req.body)
    if (error) return res.status(400).json({ error })

    const mapped = mod.mapRow(req.body)
    const conflict = guard(mapped)
    if (conflict) return res.status(409).json({ error: conflict })

    const info = db
      .prepare(`INSERT INTO ${key} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`)
      .run(mapped)

    res.status(201).json(db.prepare(`SELECT * FROM ${key} WHERE id = ?`).get(info.lastInsertRowid))
  })

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id)
    const existing = db.prepare(`SELECT * FROM ${key} WHERE id = ?`).get(id)
    if (!existing) return res.status(404).json({ error: 'Ligne introuvable.' })

    const error = check(req.body)
    if (error) return res.status(400).json({ error })

    const mapped = mod.mapRow(req.body)
    const conflict = guard(mapped, id)
    if (conflict) return res.status(409).json({ error: conflict })

    db.prepare(`UPDATE ${key} SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
      .run({ ...mapped, id })

    res.json(db.prepare(`SELECT * FROM ${key} WHERE id = ?`).get(id))
  })

  router.delete('/:id', (req, res) => {
    const info = db.prepare(`DELETE FROM ${key} WHERE id = ?`).run(Number(req.params.id))
    if (info.changes === 0) return res.status(404).json({ error: 'Ligne introuvable.' })
    res.json({ deleted: info.changes })
  })

  // Remet le barème livré par défaut, sans passer par quatre suppressions.
  router.post('/reseed', (req, res) => {
    if (!mod.seed) return res.status(400).json({ error: 'Aucune valeur par défaut définie.' })

    const restore = db.transaction(() => {
      db.prepare(`DELETE FROM ${key}`).run()
      const insert = db.prepare(
        `INSERT INTO ${key} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
      )
      for (const row of mod.seed) insert.run(mod.mapRow(row))
    })

    restore()
    res.json(db.prepare(`SELECT * FROM ${key} ORDER BY ${orderBy}`).all())
  })

  return router
}

module.exports = makeResourceRouter
