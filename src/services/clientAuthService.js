import { dolibarrFetch, dolibarrList, dolibarrPost } from './dolibarrApi'
import { moveCart } from './cartService'

// Session du front office : un client s'identifie par son nom. S'il n'existe
// pas encore comme tiers dans Dolibarr, il est créé à la volée.
//
// Attention : l'identification se fait sur le seul nom, sans mot de passe.
// C'est suffisant pour une démonstration en local, pas pour une mise en ligne —
// n'importe qui pourrait consulter les factures d'un autre en saisissant son nom.

const STORAGE_KEY = 'front_client'

// Comparaison tolérante à la casse, aux accents et aux espaces : « rakoto »,
// « Rakoto » et « RAKOTO  » désignent le même client.
const normalize = (str) =>
  String(str ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

// Le nom saisi est rapproché des tiers existants ; sans correspondance, le
// tiers est créé. `code_client: 'auto'` laisse Dolibarr générer le code : un
// code libre serait refusé par son masque de numérotation.
async function resolveThirdparty(name) {
  const thirdparties = await dolibarrList('/thirdparties')
  const match = thirdparties.find((t) => normalize(t.name) === normalize(name))

  if (match) return { id: String(match.id), name: match.name, registered: false }

  const id = String(
    await dolibarrPost('/thirdparties', {
      name,
      client: '1',
      status: '1',
      code_client: 'auto',
    })
  )

  return { id, name, registered: true }
}

export async function loginClient(rawName) {
  const name = String(rawName ?? '').trim()
  if (!name) throw new Error('Saisissez votre nom pour continuer.')

  return saveSession(await resolveThirdparty(name))
}

// Le tiers peut disparaître pendant que l'onglet garde sa session : une
// réinitialisation ou un réimport supprime les tiers et les recrée avec de
// nouveaux identifiants. La session pointerait alors dans le vide et la
// validation du panier échouerait sur « Thirdparty with id=… not found ».
// On revalide donc l'identifiant à l'ouverture du front, en le réalignant sur
// le tiers portant le même nom — recréé au besoin.
export async function refreshClientSession() {
  const session = getClientSession()
  if (!session) return null

  try {
    await dolibarrFetch(`/thirdparties/${session.id}`)
    return session
  } catch (err) {
    // Seul un 404 dit « ce tiers n'existe plus ». Dolibarr injoignable ou en
    // erreur : on garde la session telle quelle plutôt que de recréer un tiers
    // en double ; l'erreur se manifestera au moment de l'opération réelle.
    if (!/\(404\)/.test(err.message)) return session
  }

  const resolved = await resolveThirdparty(session.name)
  moveCart(session.id, resolved.id)
  return saveSession(resolved)
}

function saveSession(session) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, at: Date.now() }))
  return session
}

export function getClientSession() {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function logoutClient() {
  sessionStorage.removeItem(STORAGE_KEY)
}
