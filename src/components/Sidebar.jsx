import { NavLink } from 'react-router-dom'
import { MENU_GROUPS } from '../services/modulesRegistry'
import { Icon } from './icons'
import './Sidebar.css'

// Entrées fixes, hors modules Dolibarr.
const HEAD_GROUPS = [
  {
    module: "Vue d'ensemble",
    items: [
      { key: 'dashboard', route: '/dashboard', label: 'Tableau de bord', icon: 'dashboard', end: true },
      { key: 'impayees', route: '/impayees', label: 'Factures non payées', icon: 'invoice' },
      { key: 'generer', route: '/generer', label: 'Générer un paiement', icon: 'money' },
    ],
  },
]

const TAIL_GROUPS = [
  {
    module: 'Données',
    items: [
      { key: 'import', route: '/import', label: 'Import CSV', icon: 'upload' },
      { key: 'sqlite', route: '/sqlite', label: 'Base SQLite', icon: 'database' },
      { key: 'reset', route: '/reset', label: 'Réinitialisation', icon: 'trash' },
    ],
  },
  {
    module: 'Configuration',
    items: [
      { key: 'remises', route: '/remises', label: 'Barème de remise', icon: 'percent' },
    ],
  },
  {
    module: 'Système',
    items: [
      { key: 'systeme', route: '/systeme', label: 'État de la connexion', icon: 'plug' },
    ],
  },
]

function Sidebar({ onLogout }) {
  const groups = [...HEAD_GROUPS, ...MENU_GROUPS, ...TAIL_GROUPS]

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-name">MonProjet</span>
        <span className="sidebar-brand-sub">Dolibarr</span>
      </div>

      <nav className="sidebar-nav">
        {groups.map((group) => (
          <div className="sidebar-group" key={group.module}>
            <span className="sidebar-group-label">{group.module}</span>
            <ul className="sidebar-menu">
              {group.items.map(({ key, route, label, icon, end }) => (
                <li key={key}>
                  <NavLink
                    to={route}
                    end={end}
                    className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
                  >
                    <Icon name={icon} />
                    <span>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/front" className="sidebar-front">
          <Icon name="window" />
          Front office
        </NavLink>

        <div className="sidebar-user">
          <span className="sidebar-user-role">Administrateur</span>
          <span className="sidebar-user-ver">Dolibarr 23.0.3</span>
        </div>
        <button className="sidebar-logout" onClick={onLogout}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Déconnexion
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
