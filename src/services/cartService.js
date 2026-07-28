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

// Totaux du panier pour un taux de remise donné. La remise s'applique au HT,
// la TVA vient ensuite — même ordre que Dolibarr.
//
// Une seule remise entre dans le calcul : celle du **barème**, selon le délai
// de règlement annoncé. Un achat au catalogue est facturé au prix du catalogue.
//
// La `remiseImport` que portent les articles n'est **pas** déduite ici, et c'est
// délibéré : c'est un tarif relevé sur une facture passée, pas un prix en
// vigueur. La déduire ferait payer 4 621,55 une commande annoncée à 4 941,00 au
// catalogue. Elle reste affichée à titre indicatif (cf. `remiseImportTotal`),
// et n'a d'effet que là où le CSV l'a écrite : sur les lignes importées.
export function cartTotals(items, discountRate = 0) {
  const rate = Number(discountRate) || 0

  return items.reduce(
    (acc, item) => {
      const brut = item.qty * item.ht
      const ht = brut * (1 - rate / 100)
      const ttc = ht * (1 + (item.tva || 0) / 100)
      return {
        brutHt: round(acc.brutHt + brut),
        ht: round(acc.ht + ht),
        tva: round(acc.tva + (ttc - ht)),
        ttc: round(acc.ttc + ttc),
        remise: round(acc.remise + (brut - ht)),
      }
    },
    { brutHt: 0, ht: 0, tva: 0, ttc: 0, remise: 0 }
  )
}

// Montant qu'aurait représenté la remise produit si elle avait été appliquée.
// Sert uniquement à l'affichage : le panier signale au client le tarif déjà
// consenti sur cet article par le passé, sans toucher au prix de sa commande.
export function remiseImportTotal(items) {
  return round(
    items.reduce((sum, i) => sum + (i.qty * i.ht * (Number(i.remiseImport) || 0)) / 100, 0)
  )
}
