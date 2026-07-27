const API_URL = import.meta.env.VITE_DOLIBARR_API_URL;
const API_KEY = import.meta.env.VITE_DOLAPIKEY;

const HEADERS = {
  "DOLAPIKEY": API_KEY,
  "Accept": "application/json",
};

// Une instance Dolibarr en mode développement (display_errors actif) intercale
// des avertissements PHP en HTML dans ses réponses — avant ET après la valeur
// utile. Le corps n'est alors plus du JSON valide.

// Retire les blocs « <br /><b>Warning</b>: … on line <b>N</b><br /> ».
function stripPhpNotices(text) {
  return text
    .replace(
      /<br\s*\/?>\s*<b>(?:Warning|Notice|Deprecated|Strict Standards)<\/b>:[\s\S]*?on line <b>\d+<\/b><br\s*\/?>/gi,
      "",
    )
    .replace(/<br\s*\/?>/gi, "")
    .trim();
}

// Extrait la première valeur JSON équilibrée : le JSON peut être suivi d'autres
// avertissements, ce qui ferait échouer un JSON.parse sur toute la chaîne.
function extractJson(text) {
  const start = text.search(/[{[]/);
  if (start < 0) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function parseTolerant(text, status) {
  try {
    return JSON.parse(text);
  } catch {
    /* corps pollué : on nettoie ci-dessous */
  }

  const json = extractJson(text);
  if (json) {
    try {
      return JSON.parse(json);
    } catch {
      /* bloc incomplet : on continue */
    }
  }

  // Un POST de création renvoie un identifiant nu. On exige que le corps nettoyé
  // soit exactement ce nombre : sinon on risquerait de prendre un numéro de
  // ligne cité dans un avertissement pour l'identifiant créé.
  const cleaned = stripPhpNotices(text);
  if (/^-?\d+$/.test(cleaned)) return Number(cleaned);

  try {
    return JSON.parse(cleaned);
  } catch {
    /* définitivement illisible */
  }

  throw new Error(`Réponse Dolibarr illisible (${status}) : ${cleaned.slice(0, 200)}`);
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { ...HEADERS, ...options.headers },
  });

  const text = await response.text();

  if (!response.ok) {
    // Dolibarr loge le motif utile dans error.1 (ex. ErrorBadCustomerCodeSyntax).
    let detail = text.slice(-300);
    try {
      const parsed = parseTolerant(text, response.status);
      const err = parsed?.error;
      if (err) detail = [err.message, err["1"]].filter(Boolean).join(" — ");
    } catch {
      /* corps non exploitable : on garde le texte brut */
    }
    throw new Error(`Erreur Dolibarr (${response.status}): ${detail}`);
  }

  return parseTolerant(text, response.status);
}

export async function dolibarrFetch(endpoint) {
  return request(endpoint, { method: "GET" });
}

// Lecture d'une collection.
//
// Dolibarr n'est pas homogène sur les listes vides : /invoices et /products
// renvoient `[]` avec un 200, mais /thirdparties renvoie un 404
// « No third parties found ». Ce 404 signifie « rien à lister », pas « route
// inconnue » — une route inconnue renvoie un 501 « API not found ». On peut
// donc le traduire en tableau vide sans masquer de vraie erreur.
export async function dolibarrList(endpoint) {
  try {
    const data = await dolibarrFetch(endpoint);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (/\(404\)/.test(err.message)) return [];
    throw err;
  }
}

export async function dolibarrPost(endpoint, body) {
  return request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function dolibarrPut(endpoint, body) {
  return request(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function dolibarrDelete(endpoint) {
  return request(endpoint, { method: "DELETE" });
}

// Statut de l'instance Dolibarr — sert de test de connexion.
export async function getStatus() {
  const data = await dolibarrFetch("/status");
  return data.success ?? data;
}

// Vérifie qu'un endpoint de module répond sans charger toutes les données.
// Un 404 signale une liste vide, pas un module absent (cf. dolibarrList).
export async function pingEndpoint(endpoint, query = "limit=1") {
  try {
    const response = await fetch(`${API_URL}${endpoint}?${query}`, { headers: HEADERS });
    return { ok: response.ok || response.status === 404, status: response.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}
