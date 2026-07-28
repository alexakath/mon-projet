import { dolibarrList } from './dolibarrApi'
import { getFromSQLite } from './backend'

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Remise commerciale de chaque produit, relevée dans les lignes de facture
// importées (colonne `remise` du CSV).
//
// Dolibarr n'attache pas de remise à un produit : elle vit sur la ligne de
// facture, donc elle se déduit de l'historique. Les lignes arrivent triées par
// `ref_detail` croissant et l'écrasement successif retient donc **la dernière
// remise non nulle** relevée pour l'article — le prix consenti le plus récent.
// Une référence jamais remisée reste absente de la table, donc à 0 %.
//
// Le backend SQLite est optionnel : sans lui, aucune remise produit n'est
// connue et le catalogue s'affiche au prix plein.
async function remisesParProduit() {
  try {
    const lignes = await getFromSQLite('facture_lignes')
    const byRef = new Map()
    for (const ligne of lignes) {
      const taux = num(ligne.remise)
      if (taux > 0 && ligne.ref_produit) byRef.set(String(ligne.ref_produit), taux)
    }
    return byRef
  } catch {
    return new Map()
  }
}

// Catalogue produits. Dolibarr renvoie déjà `price_ttc`, mais il est absent sur
// les produits créés sans TVA : on le recalcule au besoin.
export async function getProducts() {
  const [products, remises] = await Promise.all([dolibarrList('/products'), remisesParProduit()])

  return products.map((p) => {
    const ht = num(p.price)
    const tva = num(p.tva_tx)
    const ttc = p.price_ttc != null ? num(p.price_ttc) : ht * (1 + tva / 100)
    const remiseImport = remises.get(String(p.ref)) ?? 0

    return {
      id: String(p.id),
      ref: p.ref ?? '',
      label: p.label ?? p.ref ?? 'Sans libellé',
      description: p.description ?? '',
      ht,
      tva,
      ttc: Math.round(ttc * 100) / 100,
      // Remise commerciale de l'article, appliquée **avant** celle du barème.
      remiseImport,
      // Prix effectivement facturé une fois la remise produit déduite. Le prix
      // catalogue reste `ttc` : c'est le maximum, remise non comprise.
      ttcRemise: Math.round(ttc * (1 - remiseImport / 100) * 100) / 100,
      onSale: String(p.status) === '1',
      stock: p.stock_reel != null ? num(p.stock_reel) : null,
    }
  })
}
