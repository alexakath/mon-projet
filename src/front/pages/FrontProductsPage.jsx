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

  const add = (product) => {
    onCartChange(addToCart(client.id, product, 1))
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
          {visible.map((p) => (
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
                <span className="fp-price-ttc">{money(p.ttc)}</span>
                <span className="fp-price-unit">TTC max</span>
              </div>

              <div className="fp-product-detail">
                {money(p.ht)} HT · TVA {p.tva} %
              </div>

              {/* Remise commerciale relevée à l'import : elle est acquise dès
                  l'ajout au panier, contrairement à celle du barème. */}
              {p.remiseImport > 0 && (
                <div className="fp-product-detail fp-paid">
                  Remise produit {p.remiseImport} % · facturé {money(p.ttcRemise)} TTC
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
          ))}
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
