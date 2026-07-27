import { useState } from 'react'
import { loginClient } from '../../services/clientAuthService'
import './FrontLogin.css'

function FrontLoginPage({ onLogin }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      onLogin(await loginClient(name))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="fc-page">
      <form className="fc-card" onSubmit={submit}>
        <div className="fc-brand">
          <span className="fc-brand-name">MonProjet<span className="fc-dot">.</span></span>
          <span className="fc-brand-sub">Espace client</span>
        </div>

        <p className="fc-intro">
          Entrez votre nom pour accéder à vos factures et au catalogue.
          Si vous n'êtes pas encore client, votre compte sera créé automatiquement.
        </p>

        <label className="fc-label" htmlFor="fc-name">Votre nom</label>
        <input
          id="fc-name"
          className="fc-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rakoto"
          autoComplete="name"
          autoFocus
          required
          disabled={busy}
        />

        {error && <div className="fc-error">{error}</div>}

        <button type="submit" className="fc-btn" disabled={busy || !name.trim()}>
          {busy ? 'Connexion…' : 'Continuer'}
        </button>
      </form>
    </div>
  )
}

export default FrontLoginPage
