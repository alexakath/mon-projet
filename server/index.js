const express = require('express')
const cors = require('cors')
const { MODULES } = require('./modules')
const db = require('./db')
const makeResourceRouter = require('./routes/resource')

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Une route REST par module déclaré dans server/modules/index.js.
Object.entries(MODULES).forEach(([key, mod]) => {
  app.use(`/api/${key}`, makeResourceRouter(key, mod))
})

app.use('/api/sync', require('./routes/sync'))
app.use('/api/vue-factures', require('./routes/factures'))

app.get('/api/sqlite-modules', (req, res) => {
  const result = Object.entries(MODULES).map(([key, mod]) => ({
    key,
    label: mod.label || key,
    color: mod.color || '#6366f1',
    resetNote: mod.resetNote || null,
    // Les tables de configuration ne sont pas des données importées : la page
    // de réinitialisation les écarte pour ne pas effacer un réglage.
    config: !!mod.config,
    count: db.prepare(`SELECT COUNT(*) as c FROM ${key}`).get().c,
  }))
  res.json(result)
})

app.get('/api/health', (req, res) =>
  res.json({ ok: true, backend: 'mon-projet', db: 'sqlite', modules: Object.keys(MODULES) })
)

app.listen(PORT, () => {
  console.log(`Backend MonProjet → http://localhost:${PORT}`)
  console.log(`Modules            : ${Object.keys(MODULES).join(', ')}`)
})
