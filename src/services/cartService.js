// Panier du front office.
//
// Il vit dans sessionStorage, séparé par client : deux comptes ouverts dans le
// même navigateur ne se mélangent pas. Rien n'est envoyé à Dolibarr tant que le
// panier n'est pas validé — il n'existe pas d'objet « panier » côté serveur.
//
// Pas de gestion de stock : les quantités ne sont bornées par rien.

const key = (clientId) => `front_cart_${clientId}`

const round = (n) => Math.round(n * 100) / 100

export function getCart(clientId) {
  const raw = sessionStorage.getItem(key(clientId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    sessionStorage.removeItem(key(clientId))
    return []
  }
}

function save(clientId, items) {
  sessionStorage.setItem(key(clientId), JSON.stringify(items))
  return items
}

// Ajouter un produit déjà présent incrémente sa quantité plutôt que de créer
// une seconde ligne pour le même article.
export function addToCart(clientId, product, quantity = 1) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1))
  const items = getCart(clientId)
  const existing = items.find((i) => i.productId === product.id)

  if (existing) {
    existing.qty += qty
    return save(clientId, items)
  }

  return save(clientId, [
    ...items,
    {
      productId: product.id,
      ref: product.ref,
      label: product.label,
      ht: product.ht,
      tva: product.tva,
      // Remise commerciale relevée à l'import pour cet article. Recopiée dans
      // le panier plutôt que relue à l'affichage : le prix consenti est celui
      // du moment de l'ajout, un réimport ne doit pas le changer sous les yeux
      // du client.
      remiseImport: product.remiseImport ?? 0,
      qty,
    },
  ])
}

export function setQuantity(clientId, productId, quantity) {
  const qty = Math.floor(Number(quantity) || 0)
  if (qty <= 0) return removeFromCart(clientId, productId)

  const items = getCart(clientId).map((i) => (i.productId === productId ? { ...i, qty } : i))
  return save(clientId, items)
}

export function removeFromCart(clientId, productId) {
  return save(clientId, getCart(clientId).filter((i) => i.productId !== productId))
}

export function clearCart(clientId) {
  sessionStorage.removeItem(key(clientId))
  return []
}

// Le panier est indexé par identifiant client. Si Dolibarr réattribue un
// nouvel identifiant au même client (tiers supprimé puis recréé), le panier
// doit suivre, sinon il paraîtrait vidé sans raison.
export function moveCart(fromId, toId) {
  if (String(fromId) === String(toId)) return getCart(toId)

  const items = getCart(fromId)
  sessionStorage.removeItem(key(fromId))
  return items.length ? save(toId, items) : getCart(toId)
}

export function cartCount(items) {
  return items.reduce((sum, i) => sum + i.qty, 0)
}

// Totaux du panier, deux remises appliquées **en cascade** et dans cet ordre :
//
//   1. la **remise produit**, relevée à l'import (colonne `remise` du CSV).
//      C'est une remise commerciale attachée à l'article : elle réduit le HT,
//      donc la TVA, donc le montant réellement facturé. C'est celle que porte
//      la ligne F002 du jeu d'essai, à 15,50 %.
//   2. la **remise de règlement**, issue du barème selon le délai annoncé.
//      Elle ne touche pas le montant facturé — la facture reste à son prix — et
//      n'apparaît qu'à l'encaissement, en escompte.
//
// L'ordre compte : 1 800 remisés de 15,50 % puis de 30 % ne font pas 1 800
// remisés de 45,50 %. La seconde s'applique à ce que la première a laissé.
//
// D'où trois montants, et non deux : le brut catalogue (`brutHt`), le facturé
// (`ht`/`ttc` quand `discountRate` vaut 0), et le net à payer (`ttc` avec le
// taux du barème).
export function cartTotals(items, discountRate = 0) {
  const rate = Number(discountRate) || 0

  const totals = items.reduce(
    (acc, item) => {
      const brut = item.qty * item.ht

      // 1. Remise produit → ce qui sera porté sur la facture.
      const tauxProduit = Number(item.remiseImport) || 0
      const remiseProduit = (brut * tauxProduit) / 100
      const factureHt = brut - remiseProduit

      // 2. Remise de règlement → ce qui sera réellement encaissé.
      const ht = factureHt * (1 - rate / 100)
      const ttc = ht * (1 + (item.tva || 0) / 100)

      return {
        brutHt: acc.brutHt + brut,
        remiseImport: acc.remiseImport + remiseProduit,
        factureHt: acc.factureHt + factureHt,
        ht: acc.ht + ht,
        tva: acc.tva + (ttc - ht),
        ttc: acc.ttc + ttc,
        remise: acc.remise + (factureHt - ht),
      }
    },
    { brutHt: 0, remiseImport: 0, factureHt: 0, ht: 0, tva: 0, ttc: 0, remise: 0 }
  )

  // Arrondi une seule fois, à la fin : arrondir chaque cumul intermédiaire
  // ferait dériver le total de quelques centimes sur un panier fourni.
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)]))
}
