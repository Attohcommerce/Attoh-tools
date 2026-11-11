// Welke Shopify-koppelingen (sa_stores in de browser) waar zichtbaar zijn (11-11-2026).
//
// - scope "fashion"  → de gewone tools (Importer, Dashboard, Bills, QA, Pythago, Size guide, Keywords …)
// - scope "pokemon"  → alleen /pokemon (Pull Society)
// - scope "all"      → alles
//
// Een store krijgt zijn soort via `kind` op het store-object; voor bestaande koppelingen zonder
// `kind` beslist de domeinlijst hieronder. Stores in RETIRED_DOMAINS verdwijnen overal uit beeld
// (de koppeling blijft in de browser staan, dus terughalen = domein hier weghalen).

export const POKEMON_DOMAINS = ["viaxhs-ed.myshopify.com"]; // Pull Society TCG
export const RETIRED_DOMAINS = ["xi1vf0-h1.myshopify.com"]; // Clara & James (GBP) — uit het overzicht gehaald op 11-11-2026

export function storeKind(s) {
  if (!s) return "fashion";
  if (s.kind) return s.kind;
  if (POKEMON_DOMAINS.includes(String(s.domain || "").toLowerCase())) return "pokemon";
  return "fashion";
}

export function isRetired(s) {
  return Boolean(s && RETIRED_DOMAINS.includes(String(s.domain || "").toLowerCase()));
}

/** De stores die in deze scope getoond worden. */
export function visibleStores(list, scope = "fashion") {
  return (Array.isArray(list) ? list : []).filter((s) => s && s.domain && !isRetired(s) && (scope === "all" || storeKind(s) === scope));
}

/**
 * Terugschrijven zonder de andere scope kwijt te raken: `full` is de complete lijst uit de browser,
 * `visible` de (bewerkte) lijst van deze scope. Stores van andere scopes blijven staan.
 */
export function mergeStores(full, visible, scope = "fashion") {
  const keep = (Array.isArray(full) ? full : []).filter((s) => s && s.domain && (scope === "all" ? false : storeKind(s) !== scope));
  const mine = (Array.isArray(visible) ? visible : []).filter((s) => s && s.domain).map((s) => (scope === "all" || s.kind ? s : { ...s, kind: scope }));
  return [...keep, ...mine];
}
