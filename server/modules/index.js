// Source de vérité pour tous les modules SQLite.
// Pour ajouter un module : ajouter une entrée ici avec schema + columns + mapRow.
// Les routes (/api/<clé>) et les tables sont créées automatiquement.

// Un nombre de jours, ou null quand la borne est laissée ouverte. Le champ vide
// d'un formulaire arrive en chaîne vide, pas en null : les trois cas se valent.
const toDays = (value) =>
  value === null || value === undefined || value === '' ? null : Number(value)

// « 0 à 7 j », « 31 j et au-delà » — utilisé dans les messages d'erreur.
const rangeLabel = (r) =>
  r.jours_max === null ? `${r.jours_min} j et au-delà` : `${r.jours_min} à ${r.jours_max} j`

const MODULES = {
  // ── Configuration ──────────────────────────────────────────────────────────
  //
  // Barème de remise selon le délai de règlement. Le nombre de paliers est
  // libre : on ajoute ou retire des lignes sans toucher au code.
  //
  // Un palier est un **intervalle de jours fermé aux deux bouts** :
  // « un règlement intervenu entre `jours_min` et `jours_max` jours après la
  // facture donne `taux` % de remise ». Les deux bornes sont incluses, et
  // `jours_max` à NULL signifie « sans borne haute » — le palier du bout.
  //
  // Les bornes sont saisies, pas déduites. Une version précédente ne stockait
  // que `jours_max` et faisait commencer chaque palier au lendemain du
  // précédent : le barème ne se lisait qu'en entier, et déplacer un seuil
  // décalait silencieusement son voisin. Ici « de 3 à 7 jours » se lit sur sa
  // seule ligne, et deux paliers ne peuvent pas revendiquer le même jour
  // (cf. `conflict`).

  remises: {
    label: 'Barème de remise',
    color: '#7c3aed',
    config: true,
    crud: true,
    orderBy: 'jours_min ASC, jours_max IS NULL, jours_max ASC',
    schema: `
      CREATE TABLE IF NOT EXISTS remises (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        libelle    TEXT NOT NULL,
        jours_min  INTEGER NOT NULL DEFAULT 0,
        jours_max  INTEGER,
        taux       REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `,
    // Bases créées avant les intervalles explicites : la colonne manque, et les
    // bornes basses n'existent que dans la tête du lecteur. On les matérialise
    // une fois — chaque palier démarre au lendemain du précédent, c'est-à-dire
    // exactement ce que l'ancien code calculait à chaque lecture.
    migrate: (db) => {
      const columns = db.prepare('PRAGMA table_info(remises)').all().map((c) => c.name)
      if (columns.includes('jours_min')) return

      db.exec('ALTER TABLE remises ADD COLUMN jours_min INTEGER NOT NULL DEFAULT 0')

      const rows = db
        .prepare('SELECT id, jours_max FROM remises ORDER BY jours_max IS NULL, jours_max ASC')
        .all()
      const update = db.prepare('UPDATE remises SET jours_min = ? WHERE id = ?')

      db.transaction(() => {
        let floor = 0
        for (const row of rows) {
          update.run(floor, row.id)
          if (row.jours_max !== null) floor = row.jours_max + 1
        }
      })()
    },
    columns: ['libelle', 'jours_min', 'jours_max', 'taux'],
    // Les bornes sont **incluses des deux côtés** (cf. findRule : `delay >= min
    // && delay <= max`). « 7 jours ou moins » se saisit donc 1 → 7, le jour 7
    // compris, et le palier suivant démarre à 8. Les libellés disent « ou
    // moins » et non « moins de » pour que l'étiquette et la borne s'accordent.
    seed: [
      { libelle: 'Règlement immédiat', jours_min: 0, jours_max: 0, taux: 30 },
      { libelle: '7 jours ou moins', jours_min: 1, jours_max: 7, taux: 20 },
      { libelle: '15 jours ou moins', jours_min: 8, jours_max: 15, taux: 15 },
      { libelle: '30 jours ou moins', jours_min: 16, jours_max: 30, taux: 10 },
      { libelle: 'Au-delà de 30 jours', jours_min: 31, jours_max: null, taux: 0 },
    ],
    validate: (row) => {
      const libelle = String(row.libelle ?? '').trim()
      if (!libelle) return 'Le libellé est obligatoire.'

      const taux = Number(row.taux)
      if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
        return 'Le taux doit être compris entre 0 et 100.'
      }

      const min = toDays(row.jours_min) ?? 0
      if (!Number.isInteger(min) || min < 0) {
        return 'Le début doit être un nombre entier de jours, positif ou nul.'
      }

      const max = toDays(row.jours_max)
      if (max !== null) {
        if (!Number.isInteger(max) || max < 0) {
          return 'La fin doit être un nombre entier de jours, positif ou nul.'
        }
        if (max < min) {
          return `La fin (${max} j) ne peut pas précéder le début (${min} j).`
        }
      }
      return null
    },
    // Deux paliers ne peuvent pas revendiquer le même jour. Sans cette garde,
    // un délai de 5 jours relèverait aussi bien de « 0 à 7 » que de « 3 à 10 »,
    // et la remise obtenue dépendrait de l'ordre de lecture — donc du hasard.
    conflict: (row, others) => {
      const upper = (r) => (r.jours_max === null ? Infinity : r.jours_max)
      const clash = others.find(
        (other) => row.jours_min <= upper(other) && other.jours_min <= upper(row)
      )
      if (!clash) return null
      return `Chevauchement avec « ${clash.libelle} » (${rangeLabel(clash)}) : un même délai ne peut pas relever de deux paliers.`
    },
    mapRow: (r) => ({
      libelle: String(r.libelle ?? '').trim(),
      jours_min: toDays(r.jours_min) ?? 0,
      jours_max: toDays(r.jours_max),
      taux: Number(r.taux) || 0,
    }),
  },

  // ── Staging de l'import série 4 ────────────────────────────────────────────
  // On conserve les lignes CSV telles qu'importées : traçabilité, rejeu, et
  // contrôle des totaux sans redemander Dolibarr.

  factures: {
    label: 'Factures importées',
    color: '#d946ef',
    resetNote: 'Vide les factures importées depuis les CSV (ne touche pas Dolibarr)',
    orderBy: 'num_facture ASC',
    schema: `
      CREATE TABLE IF NOT EXISTS factures (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        num_facture           TEXT NOT NULL UNIQUE,
        date_facture          TEXT,
        date_limite_reglement TEXT,
        code_client           TEXT,
        nom_client            TEXT,
        dolibarr_id           INTEGER,
        dolibarr_ref          TEXT,
        socid                 INTEGER,
        total_ht              REAL DEFAULT 0,
        total_ttc             REAL DEFAULT 0,
        imported_at           TEXT DEFAULT (datetime('now'))
      )
    `,
    columns: ['num_facture', 'date_facture', 'date_limite_reglement', 'code_client', 'nom_client', 'dolibarr_id', 'dolibarr_ref', 'socid', 'total_ht', 'total_ttc'],
    conflictKey: 'num_facture',
    mapRow: (f) => ({
      num_facture: String(f.num_facture ?? '').trim(),
      date_facture: f.date_facture ?? null,
      date_limite_reglement: f.date_limite_reglement ?? null,
      code_client: f.code_client ?? null,
      nom_client: f.nom_client ?? null,
      dolibarr_id: f.dolibarr_id != null ? Number(f.dolibarr_id) : null,
      dolibarr_ref: f.dolibarr_ref ?? null,
      socid: f.socid != null ? Number(f.socid) : null,
      total_ht: Number(f.total_ht) || 0,
      total_ttc: Number(f.total_ttc) || 0,
    }),
  },

  facture_lignes: {
    label: 'Lignes de facture',
    color: '#a855f7',
    resetNote: 'Vide les lignes de facture importées',
    orderBy: 'CAST(ref_detail AS INTEGER) ASC',
    schema: `
      CREATE TABLE IF NOT EXISTS facture_lignes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_detail   TEXT NOT NULL UNIQUE,
        num_facture  TEXT,
        ref_produit  TEXT,
        produit      TEXT,
        quantite     REAL DEFAULT 0,
        pu_ht        REAL DEFAULT 0,
        taxe         REAL DEFAULT 0,
        remise       REAL DEFAULT 0,
        total_ht     REAL DEFAULT 0,
        total_ttc    REAL DEFAULT 0,
        dolibarr_id  INTEGER,
        imported_at  TEXT DEFAULT (datetime('now'))
      )
    `,
    columns: ['ref_detail', 'num_facture', 'ref_produit', 'produit', 'quantite', 'pu_ht', 'taxe', 'remise', 'total_ht', 'total_ttc', 'dolibarr_id'],
    conflictKey: 'ref_detail',
    mapRow: (l) => ({
      ref_detail: String(l.ref_detail ?? '').trim(),
      num_facture: l.num_facture ?? null,
      ref_produit: l.ref_produit ?? null,
      produit: l.produit ?? null,
      quantite: Number(l.quantite) || 0,
      pu_ht: Number(l.pu_ht) || 0,
      taxe: Number(l.taxe) || 0,
      remise: Number(l.remise) || 0,
      total_ht: Number(l.total_ht) || 0,
      total_ttc: Number(l.total_ttc) || 0,
      dolibarr_id: l.dolibarr_id != null ? Number(l.dolibarr_id) : null,
    }),
  },

  paiements: {
    label: 'Règlements importés',
    color: '#f59e0b',
    resetNote: 'Vide les règlements importés depuis les CSV',
    orderBy: 'id ASC',
    schema: `
      CREATE TABLE IF NOT EXISTS paiements (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        paiement_key   TEXT NOT NULL UNIQUE,
        num_facture    TEXT,
        date_reglement TEXT,
        caisse         TEXT,
        montant        REAL DEFAULT 0,
        dolibarr_id    INTEGER,
        accountid      INTEGER,
        imported_at    TEXT DEFAULT (datetime('now'))
      )
    `,
    // Le CSV des règlements désignait la ligne de facture, il désigne désormais
    // la facture. La colonne `ref_detail` n'a plus d'objet et la clé
    // d'idempotence changeait de base : on reconstruit la table. Les lignes
    // déjà importées sont conservées — elles portaient déjà `num_facture`,
    // renseigné à l'époque par remontée depuis la ligne.
    migrate: (db) => {
      const columns = db.prepare('PRAGMA table_info(paiements)').all().map((c) => c.name)
      if (!columns.includes('ref_detail')) return

      const anciens = db
        .prepare('SELECT * FROM paiements WHERE num_facture IS NOT NULL')
        .all()

      db.exec(`
        CREATE TABLE paiements_migres (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          paiement_key   TEXT NOT NULL UNIQUE,
          num_facture    TEXT,
          date_reglement TEXT,
          caisse         TEXT,
          montant        REAL DEFAULT 0,
          dolibarr_id    INTEGER,
          accountid      INTEGER,
          imported_at    TEXT DEFAULT (datetime('now'))
        )
      `)

      // La clé est reconstruite par `mapRow`, et non en SQL : bâtie autrement,
      // elle différerait sur le formatage des montants (« 1400.0 » côté SQLite
      // contre « 1400 » côté JavaScript) et un réimport dupliquerait au lieu de
      // mettre à jour.
      //
      // OR IGNORE : deux règlements que l'ancienne clé distinguait par leur
      // ligne peuvent se confondre une fois ramenés à la facture. Le premier
      // est conservé — c'est exactement ce que ferait un réimport.
      const insert = db.prepare(`
        INSERT OR IGNORE INTO paiements_migres
          (paiement_key, num_facture, date_reglement, caisse, montant, dolibarr_id, accountid, imported_at)
        VALUES
          (@paiement_key, @num_facture, @date_reglement, @caisse, @montant, @dolibarr_id, @accountid, @imported_at)
      `)

      db.transaction(() => {
        for (const row of anciens) {
          insert.run({ ...MODULES.paiements.mapRow(row), imported_at: row.imported_at })
        }
      })()

      db.exec('DROP TABLE paiements')
      db.exec('ALTER TABLE paiements_migres RENAME TO paiements')
    },
    columns: ['paiement_key', 'num_facture', 'date_reglement', 'caisse', 'montant', 'dolibarr_id', 'accountid'],
    conflictKey: 'paiement_key',
    mapRow: (p) => ({
      // Une facture peut recevoir plusieurs règlements : la clé inclut la date
      // et le montant pour rester idempotente sans écraser les précédents.
      paiement_key: [p.num_facture, p.date_reglement, p.montant].join('|'),
      num_facture: p.num_facture ?? null,
      date_reglement: p.date_reglement ?? null,
      caisse: p.caisse ?? null,
      montant: Number(p.montant) || 0,
      dolibarr_id: p.dolibarr_id != null ? Number(p.dolibarr_id) : null,
      accountid: p.accountid != null ? Number(p.accountid) : null,
    }),
  },

  // ── Historique des règlements remisés ──────────────────────────────────────
  //
  // Dolibarr porte désormais la facture **au prix plein** : ses lignes ne sont
  // plus remisées, et la remise n'apparaît qu'à l'encaissement, quand la
  // facture est classée « payée » sur un montant inférieur au total facturé —
  // l'escompte de règlement. Dolibarr garde ainsi le montant réel de la
  // facture, mais il ne garde pas la décomposition qui y a mené : le taux
  // consenti, la remise en valeur, le net attendu.
  //
  // Cette table la conserve, ligne par facture : 1000 facturés, 30 %, 300 de
  // remise, 700 encaissés, 0 restant. C'est l'historique de ce qui a été
  // réellement payé, indépendant de Dolibarr et rejouable sans lui.

  historique_remises: {
    label: 'Historique des règlements remisés',
    color: '#0ea5e9',
    resetNote: "Vide l'historique des règlements remisés (ne touche pas Dolibarr)",
    orderBy: 'id DESC',
    schema: `
      CREATE TABLE IF NOT EXISTS historique_remises (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        dolibarr_id      INTEGER NOT NULL UNIQUE,
        facture_ref      TEXT,
        socid            INTEGER,
        nom_client       TEXT,
        date_facture     TEXT,
        montant_facture  REAL DEFAULT 0,
        taux_remise      REAL DEFAULT 0,
        remise_reglement REAL DEFAULT 0,
        net_a_payer      REAL DEFAULT 0,
        paye_reel        REAL DEFAULT 0,
        reste_a_payer    REAL DEFAULT 0,
        date_reglement   TEXT,
        imported_at      TEXT DEFAULT (datetime('now'))
      )
    `,
    columns: [
      'dolibarr_id', 'facture_ref', 'socid', 'nom_client', 'date_facture',
      'montant_facture', 'taux_remise', 'remise_reglement', 'net_a_payer',
      'paye_reel', 'reste_a_payer', 'date_reglement',
    ],
    conflictKey: 'dolibarr_id',
    mapRow: (h) => ({
      dolibarr_id: Number(h.dolibarr_id),
      facture_ref: h.facture_ref ?? null,
      socid: h.socid != null ? Number(h.socid) : null,
      nom_client: h.nom_client ?? null,
      date_facture: h.date_facture ?? null,
      montant_facture: Number(h.montant_facture) || 0,
      taux_remise: Number(h.taux_remise) || 0,
      remise_reglement: Number(h.remise_reglement) || 0,
      net_a_payer: Number(h.net_a_payer) || 0,
      paye_reel: Number(h.paye_reel) || 0,
      reste_a_payer: Number(h.reste_a_payer) || 0,
      date_reglement: h.date_reglement ?? null,
    }),
  },

  // ── Miroir local de Dolibarr ───────────────────────────────────────────────

  tiers: {
    label: 'Tiers (miroir Dolibarr)',
    color: '#2563eb',
    resetNote: 'Vide la copie locale des tiers synchronisée depuis Dolibarr',
    orderBy: 'name ASC',
    schema: `
      CREATE TABLE IF NOT EXISTS tiers (
        id          INTEGER PRIMARY KEY,
        name        TEXT,
        code_client TEXT,
        client      TEXT,
        email       TEXT,
        data_json   TEXT,
        synced_at   TEXT DEFAULT (datetime('now'))
      )
    `,
    columns: ['id', 'name', 'code_client', 'client', 'email', 'data_json'],
    mapRow: (t) => ({
      id: Number(t.id),
      name: t.name ?? null,
      code_client: t.code_client ?? null,
      client: t.client ?? null,
      email: t.email ?? null,
      data_json: JSON.stringify(t),
    }),
  },

  produits: {
    label: 'Produits (miroir Dolibarr)',
    color: '#16a34a',
    resetNote: 'Vide la copie locale des produits synchronisée depuis Dolibarr',
    orderBy: 'ref ASC',
    schema: `
      CREATE TABLE IF NOT EXISTS produits (
        id        INTEGER PRIMARY KEY,
        ref       TEXT,
        label     TEXT,
        price     REAL,
        tva_tx    REAL,
        data_json TEXT,
        synced_at TEXT DEFAULT (datetime('now'))
      )
    `,
    columns: ['id', 'ref', 'label', 'price', 'tva_tx', 'data_json'],
    mapRow: (p) => ({
      id: Number(p.id),
      ref: p.ref ?? null,
      label: p.label ?? null,
      price: Number(p.price) || 0,
      tva_tx: Number(p.tva_tx) || 0,
      data_json: JSON.stringify(p),
    }),
  },
}

module.exports = { MODULES }
