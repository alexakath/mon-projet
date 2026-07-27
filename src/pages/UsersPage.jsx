import { useState, useEffect, useMemo } from 'react'
import { getUsers } from '../services/userService'
import './UsersPage.css'

function userTypeLabel(user) {
  if (user.employee === '1') return 'Employé'
  if (user.fk_soc && user.fk_soc !== '0') return 'Externe'
  return 'Interne'
}

function userTypePillClass(user) {
  if (user.employee === '1') return 'state-pill--approved'
  if (user.fk_soc && user.fk_soc !== '0') return 'state-pill--pending'
  return 'state-pill--draft'
}

function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    getUsers()
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      [u.login, u.lastname, u.firstname, u.email]
        .some((field) => (field || '').toLowerCase().includes(q))
    )
  }, [users, search])

  if (loading) return <div className="page-state">Chargement des utilisateurs...</div>
  if (error) return <div className="page-state page-state--error">Erreur : {error}</div>

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">GRH</p>
          <h1>Utilisateurs</h1>
        </div>
        <span className="page-count">
          {filtered.length} / {users.length} utilisateur{users.length !== 1 ? 's' : ''}
        </span>
      </div>

      <input
        type="search"
        className="users-search"
        placeholder="Rechercher un utilisateur..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Login</th>
              <th>Nom</th>
              <th>Prénom</th>
              <th>Email</th>
              <th>Type</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user, i) => (
              <tr key={user.id} className="table-row">
                <td className="id-cell">{i + 1}</td>
                <td className="title-cell"><span className="row-title">{user.login}</span></td>
                <td className="muted">{user.lastname || '—'}</td>
                <td className="muted">{user.firstname || '—'}</td>
                <td className="muted">{user.email || '—'}</td>
                <td><span className={`state-pill ${userTypePillClass(user)}`}>{userTypeLabel(user)}</span></td>
                <td>
                  <span className={`state-pill ${user.statut === '1' ? 'state-pill--active' : 'state-pill--inactive'}`}>
                    {user.statut === '1' ? 'Actif' : 'Inactif'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="table-empty">Aucun utilisateur trouvé.</div>}
      </div>
    </div>
  )
}

export default UsersPage
