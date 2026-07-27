const ADMIN_LOGIN = import.meta.env.VITE_ADMIN_LOGIN;
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

const STORAGE_KEY = "dolibarr_auth";

export function login(password) {
  if (password === ADMIN_PASSWORD) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      login: ADMIN_LOGIN,
      timestamp: Date.now(),
    }));
    return true;
  }
  throw new Error("Mot de passe incorrect");
}

export function getAdminLogin() {
  return ADMIN_LOGIN;
}

export function getAdminPassword() {
  return ADMIN_PASSWORD;
}

export function isLoggedIn() {
  return sessionStorage.getItem(STORAGE_KEY) !== null;
}

export function getSession() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function logout() {
  sessionStorage.removeItem(STORAGE_KEY);
}
