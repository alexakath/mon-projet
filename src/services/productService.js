import { dolibarrList } from './dolibarrApi'
import { getFromSQLite } from './backend'

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const round2 = (n) => Math.round(n * 100) / 100

// Variantes de prix relevées à l'import, par référence produit.
//
// Le CSV peut facturer la même référence à deux tarifs différents — dans ce
// jeu d'essai, P1 vaut 1 800 HT / 14,50 % sur F001 et 1 600 HT / 20 % sur
// F002. Le produit Dolibarr, lui, ne garde qu'un seul prix : celui de sa
// création, la première fois que la référence a été rencontrée. Les autres
// tarifs ne survivent que sur leur ligne de facture — c'est cette table,
// `facture_lignes`, qui les conserve.
//
// Une variante est distinguée par son couple (prix HT, taux de TVA) : deux
// lignes au même tarif ne comptent que pour une. La remise de chaque variante
// est celle relevée sur **sa propre** ligne — contrairement à l'ancien calcul
// par référence seule, une remise consentie à 1 600 HT ne doit pas s'afficher
// sur la variante à 1 800 HT, qui n'en a jamais porté.
//
// Le backend SQLite est optionnel : sans lui, aucune variante n'est connue et
// chaque produit retombe sur son seul prix catalogue.
async function variantesParProduit() {
  try {
    const lignes = await getFromSQLite('facture_lignes')
    const byRef = new Map()

    for (const ligne of lignes) {
      const ref = ligne.ref_produit ? String(ligne.ref_produit) : null
      if (!ref) continue

      const ht = round2(num(ligne.pu_ht))
      const tva = round2(num(ligne.taxe))
      const remiseImport = num(ligne.remise)
      const dedupeKey = `${ht}|${tva}`

      const variants = byRef.get(ref) ?? new Map()
      const existing = variants.get(dedupeKey)
      // Deux lignes au même tarif : on retient la remise la plus récente
      // (ref_detail croissant, comme l'ancien calcul par référence).
      if (!existing || remiseImport > 0) {
        variants.set(dedupeKey, {
          ht,
          tva,
          ttc: round2(ht * (1 + tva / 100)),
          remiseImport: remiseImport > 0 ? remiseImport : existing?.remiseImport ?? 0,
        })
      }
      byRef.set(ref, variants)
    }

    // Le prix HT maximum en tête : c'est celui affiché par défaut sur la
    // fiche produit, avant tout choix de l'acheteur.
    const sorted = new Map()
    for (const [ref, variants] of byRef) {
      sorted.set(ref, [...variants.values()].sort((a, b) => b.ht - a.ht))
    }
    return sorted
  } catch {
    return new Map()
  }
}

// Catalogue produits. Dolibarr renvoie déjà `price_ttc`, mais il est absent sur
// les produits créés sans TVA : on le recalcule au besoin.
export async function getProducts() {
  const [products, variantes] = await Promise.all([dolibarrList('/products'), variantesParProduit()])

  return products.map((p) => {
    const ht = num(p.price)
    const tva = num(p.tva_tx)
    const ttc = p.price_ttc != null ? num(p.price_ttc) : ht * (1 + tva / 100)
    const catalogue = { ht: round2(ht), tva: round2(tva), ttc: round2(ttc), remiseImport: 0 }

    // Une seule variante connue (ou aucune) : le catalogue fait foi, comme
    // avant. Plusieurs : la première — au HT le plus élevé — devient le prix
    // affiché, les autres restent disponibles au choix avant l'ajout au panier.
    const known = variantes.get(String(p.ref)) ?? []
    const options = known.length > 1 ? known : [catalogue]
    const [defaut] = options

    return {
      id: String(p.id),
      ref: p.ref ?? '',
      label: p.label ?? p.ref ?? 'Sans libellé',
      description: p.description ?? '',
      ht: defaut.ht,
      tva: defaut.tva,
      ttc: defaut.ttc,
      // Remise relevée sur une facture passée, affichée à titre indicatif.
      // Elle n'est **pas** déduite d'une nouvelle commande : le prix qui fait
      // foi reste `ttc`, celui de la variante choisie.
      remiseImport: defaut.remiseImport,
      // Présent seulement s'il y a un choix réel à faire.
      variants: options.length > 1 ? options : null,
      onSale: String(p.status) === '1',
      stock: p.stock_reel != null ? num(p.stock_reel) : null,
    }
  })
}
