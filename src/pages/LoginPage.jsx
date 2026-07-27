import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { login, isLoggedIn, getAdminPassword } from '../services/authService'
import './LoginPage.css'

function LoginPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState(getAdminPassword())
  const [error, setError] = useState(null)

  if (isLoggedIn()) return <Navigate to="/dashboard" replace />

  const handleSubmit = (e) => {
    e.preventDefault()
    setError(null)
    try {
      login(password)
      navigate('/dashboard', { replace: true })
    } catch {
      setError('Mot de passe incorrect')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-name">MonProjet</span>
          <span className="login-brand-sub">Dolibarr</span>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-label">Mot de passe</label>
          <input
            type="password"
            className="login-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-btn">
            Se connecter
          </button>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
