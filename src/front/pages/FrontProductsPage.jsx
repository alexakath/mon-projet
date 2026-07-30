import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getProducts } from '../../services/productService'
import { addToCart } from '../../services/cartService'
import './FrontPages.css'

const money = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function FrontProductsPage({ client, onCartChange }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [added, setAdded] = useState(null)
  // Variante choisie par produit, quand plusieurs tarifs coexistent (cf.
  // productService.getProducts). Index dans `p.variants` ; 0 par défaut, le
  // HT le plus élevé — c'est celui déjà affiché sur la fiche avant tout choix.
  const [variantIndex, setVariantIndex] = useState({})

  useEffect(() => {
    getProducts()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) =>
      [p.ref, p.label, p.description].some((f) => String(f).toLowerCase().includes(q))
    )
  }, [products, search])

  // Le produit ajouté au panier porte le tarif de la variante choisie, pas
  // forcément celui affiché par défaut (`p.ht`/`p.tva`) : sans ce recalcul, le
  // choix de l'acheteur n'aurait aucun effet sur ce qui part au panier.
  const add = (product) => {
    const variant = product.variants?.[variantIndex[product.id] ?? 0]
    const item = variant ? { ...product, ...variant } : product
    onCartChange(addToCart(client.id, item, 1))
    setAdded(product.id)
    window.setTimeout(() => setAdded((current) => (current === product.id ? null : current)), 1600)
  }

  if (loading) return <div className="fp-state">Chargement du catalogue...</div>
  if (error) return <div className="fp-state fp-state--error">Erreur : {error}</div>

  return (
    <div className="fp-wrap">
      <header className="fp-head">
        <div>
          <p className="fp-eyebrow">Catalogue</p>
          <h1 className="fp-title fp-title--sm">Nos produits</h1>
          <p className="fp-hint">
            Prix maximum TTC, avant remise. Le taux accordé se décide au panier,
            selon le délai de règlement que vous choisirez.
          </p>
        </div>
        <input
          type="search"
          className="fp-search"
          placeholder="Rechercher un produit..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </header>

      {products.length === 0 ? (
        <p className="fp-empty">Aucun produit au catalogue pour le moment.</p>
      ) : visible.length === 0 ? (
        <p className="fp-empty">Aucun produit ne correspond à « {search} ».</p>
      ) : (
        <ul className="fp-cards">
          {visible.map((p) => {
            const idx = variantIndex[p.id] ?? 0
            const current = p.variants?.[idx] ?? p
            return (
              <li key={p.id} className="fp-card fp-product">
                <div className="fp-card-top">
                  <span className="fp-card-ref">{p.ref || '—'}</span>
                  {!p.onSale && <span className="state-pill state-pill--draft">Indisponible</span>}
                </div>

                <div className="fp-product-name">{p.label}</div>
                {p.description && <p className="fp-product-desc">{p.description}</p>}

                {/* Prix plein, taxes comprises : c'est le maximum que le produit
                    puisse coûter, et le montant qui sera porté sur la facture.
                    La remise, elle, dépend du délai de règlement choisi au panier
                    et ne se connaît donc pas ici. */}
                <div className="fp-product-price">
                  <span className="fp-price-ttc">{money(current.ttc)}</span>
                  <span className="fp-price-unit">TTC max</span>
                </div>

                <div className="fp-product-detail">
                  {money(current.ht)} HT · TVA {current.tva} %
                </div>

                {/* Remise relevée sur une facture passée. Indicative : la
                    commande reste facturée au prix catalogue ci-dessus. */}
                {current.remiseImport > 0 && (
                  <div className="fp-product-detail">
                    Déjà remisé {current.remiseImport} % à l'import
                  </div>
                )}

                {/* Plusieurs tarifs relevés à l'import pour cette référence :
                    le HT le plus élevé est proposé par défaut, mais l'acheteur
                    choisit avant l'ajout au panier — le prix suit son choix. */}
                {p.variants && (
                  <div className="fp-variant-picker">
                    <span className="fp-field-label">Tarif</span>
                    {p.variants.map((v, i) => (
                      <label key={`${v.ht}-${v.tva}`} className="fp-variant-option">
                        <input
                          type="radio"
                          name={`variant-${p.id}`}
                          checked={idx === i}
                          onChange={() => setVariantIndex((m) => ({ ...m, [p.id]: i }))}
                        />
                        {money(v.ht)} HT · TVA {v.tva} %
                      </label>
                    ))}
                  </div>
                )}

                <button
                  className={`fp-add${added === p.id ? ' fp-add--done' : ''}`}
                  onClick={() => add(p)}
                  disabled={!p.onSale}
                >
                  {added === p.id ? 'Ajouté au panier' : 'Ajouter au panier'}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {added && (
        <p className="fp-note">
          <Link to="/front/panier" className="fp-cta">Voir mon panier</Link>
        </p>
      )}

      {visible.length > 0 && (
        <p className="fp-note">
          {visible.length} produit{visible.length > 1 ? 's' : ''} affiché{visible.length > 1 ? 's' : ''}
          {visible.length !== products.length ? ` sur ${products.length}` : ''}.
        </p>
      )}
    </div>
  )
}
export default FrontProductsPage
