import { dolibarrList } from './dolibarrApi'

const num = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Catalogue produits. Dolibarr renvoie déjà `price_ttc`, mais il est absent sur
// les produits créés sans TVA : on le recalcule au besoin.
export async function getProducts() {
  const products = await dolibarrList('/products')

  return products.map((p) => {
    const ht = num(p.price)
    const tva = num(p.tva_tx)
    const ttc = p.price_ttc != null ? num(p.price_ttc) : ht * (1 + tva / 100)

    return {
      id: String(p.id),
      ref: p.ref ?? '',
      label: p.label ?? p.ref ?? 'Sans libellé',
      description: p.description ?? '',
      ht,
      tva,
      ttc: Math.round(ttc * 100) / 100,
      onSale: String(p.status) === '1',
      stock: p.stock_reel != null ? num(p.stock_reel) : null,
    }
  })
}
