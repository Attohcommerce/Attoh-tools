// LIVE SALES (28-11-2026) — de laatste orders over alle stores, met een plek
// op de wereldbol. Gebruikt door /api/m (action "recent") voor de draaiende
// aardbol + tijdlijn op Dashboard Mobiel.
//
// Locatie: shippingAddress.latitude/longitude (Shopify geocodeert het adres).
// Ontbreekt dat, dan het midden van de staat/provincie, anders van het land.
// Geeft de Orders-app geen toegang tot adressen (protected customer data),
// dan vragen we de orders zonder adres op en vallen we terug op het land van
// de store, zodat de tijdlijn altijd werkt.
import { cleanDomain, resolveToken } from "./shopify";

const COUNTRY = {
  US: [39.8, -98.6], CA: [56.1, -106.3], GB: [54.0, -2.5], AU: [-25.3, 133.8], NZ: [-41.3, 174.0],
  IE: [53.4, -8.2], NL: [52.1, 5.3], BE: [50.5, 4.5], DE: [51.2, 10.4], FR: [46.6, 2.2], ES: [40.4, -3.7],
  IT: [42.8, 12.6], PT: [39.6, -8.0], AT: [47.5, 14.6], CH: [46.8, 8.2], DK: [56.0, 10.0], SE: [62.0, 15.0],
  NO: [61.0, 9.0], FI: [64.0, 26.0], PL: [52.0, 19.4], PR: [18.2, -66.5], MX: [23.6, -102.6],
};
const US = {
  AL: [32.8, -86.8], AK: [61.4, -152.3], AZ: [34.3, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.5], CO: [39.0, -105.5],
  CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.8, -156.3],
  ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3],
  LA: [31.1, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3],
  MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6],
  NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9], SD: [44.4, -100.2],
  TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5],
  WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.6],
};
const CA = {
  AB: [53.9, -116.6], BC: [53.7, -127.6], MB: [53.8, -98.8], NB: [46.5, -66.2], NL: [53.1, -57.7], NS: [44.7, -63.7],
  ON: [50.0, -85.3], PE: [46.5, -63.4], QC: [52.9, -73.5], SK: [52.9, -106.5], NT: [64.8, -124.8], NU: [70.3, -83.1], YT: [64.3, -135.0],
};
const AU = {
  NSW: [-32.2, 147.0], VIC: [-36.9, 144.3], QLD: [-22.6, 144.1], WA: [-25.0, 121.6], SA: [-30.0, 135.8],
  TAS: [-42.0, 146.6], ACT: [-35.5, 149.0], NT: [-19.5, 132.6],
};
const STORE_COUNTRY = { SSB: "US", LGB: "US", EMC: "US", CAC: "US", SW: "AU", CCOU: "CA", COC: "CA", PTL: "GB", SBK: "GB" };

function placeOf(addr, storeKey, seed) {
  const a = addr || {};
  const lat = Number(a.latitude);
  const lng = Number(a.longitude);
  if (a.latitude != null && a.longitude != null && isFinite(lat) && isFinite(lng) && (lat || lng)) {
    return { lat, lng, precise: true };
  }
  const cc = String(a.countryCodeV2 || "").toUpperCase() || STORE_COUNTRY[storeKey] || "";
  const pc = String(a.provinceCode || "").toUpperCase();
  const prov = cc === "US" ? US[pc] : cc === "CA" ? CA[pc] : cc === "AU" ? AU[pc] : null;
  const p = prov || COUNTRY[cc];
  if (!p) return null;
  // kleine spreiding zodat orders uit dezelfde staat niet exact op elkaar vallen
  // vaste spreiding per order (zelfde plek bij elke refresh)
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let n = 0;
  const jitter = () => ((((h >>> (n++ * 8)) & 255) / 255) - 0.5) * (prov ? 1.2 : 3);
  return { lat: p[0] + jitter(), lng: p[1] + jitter(), precise: false };
}

const FIELDS = `
  id name processedAt createdAt test cancelledAt
  currentSubtotalLineItemsQuantity
  currentTotalPriceSet { shopMoney { amount currencyCode } }`;
const WITH_ADDR = `shippingAddress { latitude longitude city provinceCode countryCodeV2 }`;

async function gql(domain, token, query, variables) {
  const res = await fetch(`https://${cleanDomain(domain)}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return { ok: false, error: `HTTP ${res.status}` };
  if (data.errors) {
    const msg = Array.isArray(data.errors) ? data.errors.map((e) => e.message || "").join("; ") : JSON.stringify(data.errors);
    return { ok: false, error: msg.slice(0, 300), data: data.data };
  }
  return { ok: true, data: data.data };
}

async function storeRecent(store, limit, sinceIso) {
  const t = await resolveToken(store);
  if (!t.ok) return { ok: false, error: t.error, orders: [] };
  const q = `processed_at:>='${sinceIso}'`;
  const build = (addr) =>
    `query ($q: String!) { orders(first: ${limit}, query: $q, sortKey: PROCESSED_AT, reverse: true) { edges { node { ${FIELDS} ${addr ? WITH_ADDR : ""} } } } }`;
  let r = await gql(store.domain, t.token, build(true), { q });
  let addrBlocked = false;
  if (!r.ok || !r.data || !r.data.orders) {
    // geen toegang tot adressen → zonder adres opnieuw
    r = await gql(store.domain, t.token, build(false), { q });
    addrBlocked = true;
    if (!r.ok || !r.data || !r.data.orders) return { ok: false, error: r.error || "Orders niet geladen", orders: [] };
  }
  const orders = [];
  for (const { node } of r.data.orders.edges) {
    if (node.test || node.cancelledAt) continue;
    const money = (node.currentTotalPriceSet && node.currentTotalPriceSet.shopMoney) || {};
    const a = node.shippingAddress || null;
    orders.push({
      id: `${cleanDomain(store.domain)}#${node.id}`,
      key: store.key || "",
      store: store.name || store.key || cleanDomain(store.domain),
      domain: store.domain,
      name: node.name,
      at: node.processedAt || node.createdAt,
      amount: Math.round((Number(money.amount) || 0) * 100) / 100,
      currency: String(money.currencyCode || store.currency || ""),
      items: Number(node.currentSubtotalLineItemsQuantity) || 0,
      city: a && a.city ? String(a.city) : "",
      region: a ? [a.provinceCode, a.countryCodeV2].filter(Boolean).join(", ") : "",
      place: placeOf(a, store.key, node.id),
    });
  }
  return { ok: true, orders, addrBlocked };
}

/** Laatste `limit` orders over alle stores (nieuwste eerst), max 48 uur terug. */
export async function recentSales(stores, limit = 15) {
  const sinceIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const results = await Promise.all(
    stores.map((s) => storeRecent(s, limit, sinceIso).catch((e) => ({ ok: false, error: String(e.message || e), orders: [] })))
  );
  const all = [];
  const errors = [];
  results.forEach((r, i) => {
    if (!r.ok) errors.push({ key: stores[i].key || stores[i].name, error: r.error });
    all.push(...r.orders);
  });
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { ok: true, sales: all.slice(0, limit), errors, at: new Date().toISOString() };
}
