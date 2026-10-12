// Geslacht van een hele store uit STORE_PROFILES ("M" heren-only, "V"
// dames-only, "MV" beide). Store Doctor en Size Guide gebruiken dit zodat
// een product zonder "men's"/"women's" in de titel niet stilletjes op dames
// terugvalt — op EMC (heren-only) kreeg elke herenschoen zo een
// damesschoenentabel (7-10-2026).
import { storeProfile } from "./verdeling";
import { getShopInfo } from "./shopify";

const cache = new Map(); // myshopify-domein → STORE_PROFILES-entry | null

// Volledig store-profiel (market, genders, shoeLabels, …) of null.
export async function storeProfileOf(store) {
  if (!store || !store.domain) return null;
  const key = String(store.domain).toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let prof = storeProfile(store.publicDomain) || storeProfile(store.domain) || null;
  if (!prof) {
    // oudere store-koppelingen hebben geen publicDomain → primair domein opvragen
    try {
      const s = await getShopInfo(store);
      if (s.ok) prof = storeProfile(s.shop.domain) || null;
    } catch {
      /* geen profiel = per product bepalen, zoals altijd */
    }
  }
  cache.set(key, prof);
  return prof;
}

export async function storeGendersOf(store) {
  const p = await storeProfileOf(store);
  return (p && p.genders) || null;
}

// "us-eu" = schoenmaten als "US 7 (EU 40)" (SSB); anders null.
export async function storeShoeLabelsOf(store) {
  const p = await storeProfileOf(store);
  return (p && p.shoeLabels) || null;
}
