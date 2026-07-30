import { Routes, Route, Navigate } from 'react-router-dom'
import BackLayout from './layouts/BackLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import UnpaidPage from './pages/UnpaidPage'
import UsersPage from './pages/UsersPage'
import ImportPage from './pages/ImportPage'
import ResetPage from './pages/ResetPage'
import SQLitePage from './pages/SQLitePage'
import RemisesPage from './pages/RemisesPage'
import SystemPage from './pages/SystemPage'
import FrontApp from './front/FrontApp'
import GenererPayement from './pages/GenererPayement'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />

      {/* Back office — authentifié, menu latéral. */}
      <Route element={<BackLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/impayees" element={<UnpaidPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/remises" element={<RemisesPage />} />
        <Route path="/sqlite" element={<SQLitePage />} />
        <Route path="/reset" element={<ResetPage />} />
        <Route path="/systeme" element={<SystemPage />} />
        <Route path="/generer" element={<GenererPayement/>} />
        {/* Nouveaux modules : ajouter la route ici. */}
      </Route>

      {/* Front office — consultation, navigation horizontale. */}
      <Route path="/front/*" element={<FrontApp />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
