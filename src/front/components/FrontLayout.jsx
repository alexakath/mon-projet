import { NavLink, Link } from 'react-router-dom'
import './FrontLayout.css'

// Front office : navigation horizontale, client identifié par son nom.
const LINKS = [
  { to: '/front', label: 'Accueil', end: true },
  { to: '/front/produits', label: 'Produits' },
  { to: '/front/panier', label: 'Panier', badge: true },
  { to: '/front/factures', label: 'Mes factures' },
]

// Initiales pour la pastille : « Jean Rakoto » donne « JR », « Rakoto » donne « R ».
const initials = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

function FrontLayout({ client, cartCount = 0, onLogout, children }) {
  return (
    <div className="fl-shell">
      <nav className="fl-nav">
        <Link to="/front" className="fl-logo">
          MonProjet<span className="fl-logo-dot">.</span>
        </Link>

        <div className="fl-links">
          {LINKS.map(({ to, label, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `fl-link${isActive ? ' active' : ''}`}
            >
              {label}
              {badge && cartCount > 0 && <span className="fl-badge">{cartCount}</span>}
            </NavLink>
          ))}
        </div>

        <div className="fl-account">
          <span className="fl-avatar" aria-hidden="true">{initials(client.name)}</span>
          <span className="fl-name">{client.name}</span>
          <button className="fl-logout" onClick={onLogout}>Déconnexion</button>
        </div>
      </nav>

      <main className="fl-main">{children}</main>
    </div>
  )
}

export default FrontLayout
