// ─── Source de vérité unique pour tous les modules Dolibarr ──────────────────
//
// Pour brancher un nouveau module : UNE ENTRÉE ici, puis
//   1. un service dans src/services/<module>Service.js
//   2. une page dans src/pages/
//   3. sa route dans App.jsx
//
// Le menu latéral et le tableau de bord se dérivent automatiquement d'ici.
//
//   key        identifiant interne
//   label      libellé affiché
//   group      section du menu latéral
//   color      couleur d'accent du module
//   dolibarr   nom du module côté Dolibarr (cf. GET /setup/modules)
//   endpoint   route de l'API REST — null si le module n'expose aucune API
//   pingQuery  query utilisée pour tester l'endpoint (défaut : limit=1)
//   route      chemin dans l'application React — null tant qu'il n'y a pas de page
//   icon       clé de la table PATHS de components/icons.jsx
//   enabled    module activé dans Dolibarr
//   note       remarque affichée sur le tableau de bord
//
// État vérifié sur l'instance Dolibarr 23.0.3 le 26/07/2026
// (GET /setup/modules + GET /explorer/swagger.json).

export const DOLIBARR_MODULES = {
  // ── Finance ───────────────────────────────────────────────────────────────
  accountancy: {
    label: 'Comptabilité double',
    group: 'Finance',
    color: '#4f46e5',
    dolibarr: 'accounting',
    endpoint: '/accountancy/exportdata',
    pingQuery: 'period=currentyear&notnotifiedasexport=1',
    route: null,
    icon: 'ledger',
    enabled: true,
    note: "Export du grand livre uniquement — pas de CRUD sur les écritures.",
  },
  bankaccounts: {
    label: 'Banque et caisse',
    group: 'Finance',
    color: '#f59e0b',
    dolibarr: 'banque',
    endpoint: '/bankaccounts',
    route: null,
    icon: 'bank',
    enabled: true,
    note: 'Comptes, lignes, soldes et virements.',
  },
  salaries: {
    label: 'Salaires',
    group: 'Finance',
    color: '#7c3aed',
    dolibarr: 'salaries',
    endpoint: '/salaries',
    route: null,
    icon: 'money',
    enabled: true,
    note: 'Salaires et paiements (/salaries/payments).',
  },
  tax: {
    label: 'Taxes et dépenses spéciales',
    group: 'Finance',
    color: '#dc2626',
    dolibarr: 'tax',
    endpoint: null,
    route: null,
    icon: 'receipt',
    enabled: true,
    note: "Module actif dans Dolibarr mais aucune API REST — passer par la base ou l'interface Dolibarr.",
  },
  invoices: {
    label: 'Factures et avoirs',
    group: 'Finance',
    color: '#d946ef',
    dolibarr: 'facture',
    endpoint: '/invoices',
    route: null,
    icon: 'invoice',
    enabled: true,
    note: 'Les avoirs sont les factures de type 2.',
  },

  // ── GRH ───────────────────────────────────────────────────────────────────
  users: {
    label: 'Utilisateurs',
    group: 'GRH',
    color: '#ec4899',
    dolibarr: 'user',
    endpoint: '/users',
    route: '/users',
    icon: 'users',
    enabled: true,
  },
  holidays: {
    label: 'Congés',
    group: 'GRH',
    color: '#059669',
    dolibarr: 'holiday',
    endpoint: '/holidays',
    route: null,
    icon: 'calendar',
    enabled: true,
  },
  expensereports: {
    label: 'Notes de frais',
    group: 'GRH',
    color: '#ea580c',
    dolibarr: 'expensereport',
    endpoint: '/expensereports',
    route: null,
    icon: 'receipt',
    enabled: true,
  },

  // ── Commercial ────────────────────────────────────────────────────────────
  thirdparties: {
    label: 'Tiers',
    group: 'Commercial',
    color: '#2563eb',
    dolibarr: 'societe',
    endpoint: '/thirdparties',
    route: null,
    icon: 'building',
    enabled: true,
  },
  contacts: {
    label: 'Contacts',
    group: 'Commercial',
    color: '#0891b2',
    dolibarr: 'societe',
    endpoint: '/contacts',
    route: null,
    icon: 'contact',
    enabled: true,
  },

  // ── Stock ─────────────────────────────────────────────────────────────────
  products: {
    label: 'Produits',
    group: 'Stock',
    color: '#16a34a',
    dolibarr: 'product',
    endpoint: '/products',
    route: null,
    icon: 'box',
    enabled: true,
  },
  warehouses: {
    label: 'Entrepôts',
    group: 'Stock',
    color: '#0d9488',
    dolibarr: 'stock',
    endpoint: '/warehouses',
    route: null,
    icon: 'warehouse',
    enabled: true,
  },

  // ── Outils ────────────────────────────────────────────────────────────────
  agendaevents: {
    label: 'Agenda',
    group: 'Outils',
    color: '#6366f1',
    dolibarr: 'agenda',
    endpoint: '/agendaevents',
    route: null,
    icon: 'agenda',
    enabled: true,
  },
}

// ─── Sous-modules d'import CSV (série 4) ─────────────────────────────────────
//
// Un fichier CSV est rattaché à un sous-module par score : chaque en-tête
// reconnu ajoute son poids, le fichier est retenu si le total atteint
// `threshold`. Les poids servent à départager les fichiers qui partagent des
// colonnes : `num_facture` figure dans les trois, mais il pèse 5 pour les
// factures — dont il est la clé — et seulement 2 pour les lignes et les
// règlements, où il n'est qu'une référence. Un fichier ne peut donc pas être
// pris pour un autre sur cette seule colonne.
//
// Pour ajouter un type de fichier : une entrée ici + sa fonction dans
// import/importService.js.

export const IMPORT_MODULES = {
  factures: {
    label: 'Factures',
    color: '#d946ef',
    importOrder: 1,
    dependsOn: [],
    sqliteTable: 'factures',
    csv: {
      signatures: { num_facture: 5, date_facture: 5, date_limite_reglement: 4, code_client: 4, nom_client: 4 },
      required: ['num_facture', 'date_facture', 'nom_client'],
      optional: ['date_limite_reglement', 'code_client'],
      threshold: 10,
    },
  },
  detail_factures: {
    label: 'Lignes de facture',
    color: '#a855f7',
    importOrder: 2,
    dependsOn: ['factures'],
    sqliteTable: 'facture_lignes',
    csv: {
      signatures: { ref_detail: 4, ref_produit: 5, produit: 4, quantite: 5, pu_hors_taxe: 5, taxe: 3, remise: 3, num_facture: 2 },
      required: ['ref_detail', 'num_facture', 'quantite', 'pu_hors_taxe'],
      optional: ['ref_produit', 'produit', 'taxe', 'remise'],
      threshold: 12,
    },
  },
  paiements: {
    label: 'Règlements',
    color: '#f59e0b',
    // Un règlement désigne sa facture : il n'a besoin que du fichier des
    // factures, pas de celui des lignes. Il reste importé en dernier — la
    // facture doit porter ses lignes avant d'être validée puis réglée.
    importOrder: 3,
    dependsOn: ['factures'],
    sqliteTable: 'paiements',
    csv: {
      signatures: { date_reglement: 5, caisse: 5, montant: 4, num_facture: 2 },
      required: ['num_facture', 'date_reglement', 'montant'],
      optional: ['caisse'],
      threshold: 10,
    },
  },
}

const importEntries = Object.entries(IMPORT_MODULES)

export const IMPORT_MODULE_KEYS = importEntries.map(([key]) => key)

export const IMPORT_ORDER = importEntries
  .slice()
  .sort(([, a], [, b]) => a.importOrder - b.importOrder)
  .map(([key]) => key)

export const IMPORT_DEPS = Object.fromEntries(
  importEntries.filter(([, m]) => m.dependsOn.length > 0).map(([key, m]) => [key, m.dependsOn])
)

export const IMPORT_META = Object.fromEntries(
  importEntries.map(([key, m]) => [key, { label: m.label, color: m.color, sqliteTable: m.sqliteTable }])
)

export const CANONICAL = Object.fromEntries(
  importEntries.map(([key, m]) => [key, { required: m.csv.required, optional: m.csv.optional }])
)

// ─── Dérivés automatiques — NE PAS MODIFIER MANUELLEMENT ─────────────────────

const entries = Object.entries(DOLIBARR_MODULES)

export const MODULE_KEYS = entries.map(([key]) => key)

// Tous les modules déclarés, dans l'ordre de déclaration.
export const ALL_MODULES = entries.map(([key, m]) => ({ key, ...m }))

// Modules actifs disposant d'un endpoint API interrogeable.
export const API_MODULES = ALL_MODULES.filter((m) => m.enabled && m.endpoint)

// Modules ayant déjà une page dans l'application (utilisés par le menu).
export const ROUTED_MODULES = ALL_MODULES.filter((m) => m.enabled && m.route)

// Menu latéral : modules routés, regroupés par section, dans l'ordre de déclaration.
export const MENU_GROUPS = ROUTED_MODULES.reduce((groups, mod) => {
  const group = groups.find((g) => g.module === mod.group)
  if (group) group.items.push(mod)
  else groups.push({ module: mod.group, items: [mod] })
  return groups
}, [])

export const getModule = (key) => DOLIBARR_MODULES[key]
