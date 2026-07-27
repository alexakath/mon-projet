import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { isLoggedIn, logout } from '../services/authService'
import Sidebar from '../components/Sidebar'
import './BackLayout.css'

// Back office : menu latéral, accès réservé après authentification.
function BackLayout() {
  const navigate = useNavigate()

  if (!isLoggedIn()) return <Navigate to="/" replace />

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="back-layout">
      <Sidebar onLogout={handleLogout} />
      <main className="back-main">
        <Outlet />
      </main>
    </div>
  )
}

export default BackLayout
