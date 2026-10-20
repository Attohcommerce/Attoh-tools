// Organisatie aan de browserkant: cookie lezen/zetten en localStorage per
// organisatie. In attoh blijft élke key exact zoals hij was (prefix ""),
// in Sa Collective krijgt alles "sc:" ervoor — zo heeft Chaims kant zijn
// eigen Shopify-koppelingen (sa_stores), Orders-app-sleutels, laatst
// gekozen store/tabblad, Pythago-instellingen, enz.
import { ORG_COOKIE, DEFAULT_ORG, normOrg, nsKey, orgOf } from "./org";

let cached = null;

export function currentOrg() {
  if (cached) return cached;
  if (typeof document === "undefined") return DEFAULT_ORG;
  try {
    // de root layout zet body[data-org] vanuit de cookie (server) — dat is de bron
    const fromBody = document.body && document.body.dataset ? document.body.dataset.org : "";
    if (fromBody) {
      cached = normOrg(fromBody);
      return cached;
    }
    const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + ORG_COOKIE + "=([^;]*)"));
    cached = normOrg(m ? decodeURIComponent(m[1]) : "");
  } catch {
    cached = DEFAULT_ORG;
  }
  return cached;
}

export function currentOrgDef() {
  return orgOf(currentOrg());
}

export function isSaCollective() {
  return currentOrg() === "sacollective";
}

/** Cookie zetten (1 jaar) en naar de homepage — elke pagina leest daarna de nieuwe organisatie. */
export function switchOrg(id) {
  const org = normOrg(id);
  try {
    document.cookie = `${ORG_COOKIE}=${org}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {}
  cached = org;
  window.location.href = "/";
}

/** localStorage met organisatie-prefix. Zelfde API als localStorage zelf. */
export const orgLS = {
  key(k) {
    return nsKey(currentOrg(), k);
  },
  getItem(k) {
    return localStorage.getItem(nsKey(currentOrg(), k));
  },
  setItem(k, v) {
    return localStorage.setItem(nsKey(currentOrg(), k), v);
  },
  removeItem(k) {
    return localStorage.removeItem(nsKey(currentOrg(), k));
  },
};
