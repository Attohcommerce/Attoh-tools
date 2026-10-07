// Geslacht van een hele store uit STORE_PROFILES ("M" heren-only, "V"
// dames-only, "MV" beide). Store Doctor en Size Guide gebruiken dit zodat
// een product zonder "men's"/"women's" in de titel niet stilletjes op dames
// terugvalt — op EMC (heren-only) kreeg elke herenschoen zo een
// damesschoenentabel (7-10-2026).
import { storeProfile } from "./verdeling";
import { getShopInfo } from "./shopify";

const cache = new Map(); // myshopify-domein → genders | null

export async function storeGendersOf(store) {
  if (!store || !store.domain) return null;
  const key = String(store.domain).toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let g = null;
  const p = storeProfile(store.publicDomain) || storeProfile(store.domain);
  if (p && p.genders) g = p.genders;
  if (!g) {
    // oudere store-koppelingen hebben geen publicDomain → primair domein opvragen
    try {
      const s = await getShopInfo(store);
      if (s.ok) {
        const q = storeProfile(s.shop.domain);
        if (q && q.genders) g = q.genders;
      }
    } catch {
      /* geen profiel = per product bepalen, zoals altijd */
    }
  }
  cache.set(key, g);
  return g;
}
