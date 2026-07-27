const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const { MODULES } = require('./modules')

const DATA_DIR = path.join(__dirname, 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'monprojet.db'))
db.pragma('journal_mode = WAL')

Object.values(MODULES).forEach((mod) => db.exec(mod.schema))

// `CREATE TABLE IF NOT EXISTS` ne rattrape pas une table déjà créée avec un
// schéma plus ancien : une colonne ajoutée depuis lui resterait inconnue. Les
// modules qui ont évolué déclarent donc un `migrate`, chargé de se reconnaître
// déjà appliqué et de ne rien faire dans ce cas.
Object.values(MODULES).forEach((mod) => mod.migrate?.(db))

// Amorçage des tables de configuration : uniquement si elles sont vides, pour
// ne jamais écraser un barème que l'utilisateur a modifié.
Object.entries(MODULES).forEach(([key, mod]) => {
  if (!mod.seed) return
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${key}`).get()
  if (c > 0) return

  const cols = mod.columns
  const insert = db.prepare(
    `INSERT INTO ${key} (${cols.join(', ')}) VALUES (${cols.map((x) => `@${x}`).join(', ')})`
  )
  db.transaction(() => {
    for (const row of mod.seed) insert.run(mod.mapRow(row))
  })()
})

module.exports = db
