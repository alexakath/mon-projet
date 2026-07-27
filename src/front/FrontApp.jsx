import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { getClientSession, logoutClient, refreshClientSession } from '../services/clientAuthService'
import { getCart, cartCount } from '../services/cartService'
import FrontLayout from './components/FrontLayout'
import FrontLoginPage from './pages/FrontLoginPage'
import FrontHomePage from './pages/FrontHomePage'
import FrontProductsPage from './pages/FrontProductsPage'
import FrontCartPage from './pages/FrontCartPage'
import FrontInvoicesPage from './pages/FrontInvoicesPage'
import FrontPaymentPage from './pages/FrontPaymentPage'

function FrontApp() {
  const [client, setClient] = useState(getClientSession)
  // Le panier vit dans sessionStorage ; ce compteur n'est là que pour rafraîchir
  // la pastille de la barre de navigation quand il change.
  const [count, setCount] = useState(() => {
    const session = getClientSession()
    return session ? cartCount(getCart(session.id)) : 0
  })

  // L'identifiant du tiers conservé en session peut être périmé (base
  // réinitialisée ou réimportée depuis l'onglet d'administration). On le
  // revalide ici, avant que le client ne tente de créer une facture.
  const clientId = client?.id
  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    refreshClientSession()
      .then((session) => {
        if (cancelled || !session || session.id === clientId) return
        setClient(session)
        setCount(cartCount(getCart(session.id)))
      })
      .catch(() => {
        /* Dolibarr indisponible : la session reste en l'état. */
      })

    return () => {
      cancelled = true
    }
  }, [clientId])

  if (!client) {
    return (
      <FrontLoginPage
        onLogin={(session) => {
          setClient(session)
          setCount(cartCount(getCart(session.id)))
        }}
      />
    )
  }

  const handleLogout = () => {
    logoutClient()
    setClient(null)
    setCount(0)
  }

  const onCartChange = (items) => setCount(cartCount(items))

  return (
    <FrontLayout client={client} cartCount={count} onLogout={handleLogout}>
      <Routes>
        <Route index element={<FrontHomePage client={client} />} />
        <Route
          path="produits"
          element={<FrontProductsPage client={client} onCartChange={onCartChange} />}
        />
        <Route
          path="panier"
          element={<FrontCartPage client={client} onCartChange={onCartChange} />}
        />
        <Route path="factures" element={<FrontInvoicesPage client={client} />} />
        <Route path="paiement/:id" element={<FrontPaymentPage client={client} />} />
        <Route path="*" element={<Navigate to="/front" replace />} />
      </Routes>
    </FrontLayout>
  )
}

export default FrontApp
