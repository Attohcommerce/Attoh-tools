// ORGANISATIES (20-10-2026) — één Attoh Tools, twee werkruimtes.
//
//  attoh        = ATTOH COMMERCE LTD (Justins eigen stores) — alles zoals het
//                 altijd was: geen prefix op Redis-keys of localStorage, alle
//                 tools in de nav.
//  sacollective = Sa Collective (Chaims stores) — eigen store-koppelingen,
//                 eigen store-geheugen (organization-/import-/TPK-sheet per
//                 store), en alleen de tools die daar nodig zijn: Importer,
//                 Product Scraper, Keywords (alles), Store Doctor (alleen
//                 "laatste producten", zonder maattabellen) en Pythago.
//                 Géén Bills, Niche kiezen, Size Guide, GMC Checklist.
//
// De keuze staat in de cookie `sa_org` (gezet door de switch in de topbar).
// Server (lib/org-server.js) leest hem per request en prefixt het store-
// geheugen in Redis (sc:geh:stores); client (lib/org-client.js) leest hem uit
// document.cookie en prefixt localStorage-keys. GEDEELD tussen beide: het
// markt-geheugen (All keywords per markt + batch-geheugen — dezelfde All
// batch-sheets), concurrentenlijst + catalogi-cache (comp:*, cat:*), To Do-
// board (per gebruiker), size-guide-cache.
//
// Dit bestand is bewust zonder next/headers of window — bruikbaar aan beide
// kanten.

export const ORG_COOKIE = "sa_org";
export const DEFAULT_ORG = "attoh";

const ALL_TOOLS = [
  "/importer", "/scraper", "/keywords", "/niches", "/qa", "/size-guide",
  "/gmc-checklist", "/bills", "/pythago", "/taken", "/instagram",
  "/dashboard", // omzet-dashboard (29-10-2026) — alleen eigen Attoh-stores
];

export const ORGS = {
  attoh: {
    id: "attoh",
    name: "ATTOH COMMERCE LTD",
    short: "Attoh",
    letter: "A",
    prefix: "", // Redis + localStorage ongewijzigd — backwards compatible
    tools: ALL_TOOLS,
    // Store Doctor: hele store of laatste N — vrije keuze, mét maattabellen
    doctor: { latestOnly: false, sizeGuides: true },
    // Product Scraper: vaste geheugen-sheet (permanent, tegen dubbel scrapen)
    memorySheet: {
      name: "Attoh — Geheugen",
      url: "https://docs.google.com/spreadsheets/d/1gbu2XAZMPBIbyr47B_rBvoHDcWoVaTNUuBNwmp9ucJg/edit",
      format: "attoh", // link in kolom A
    },
  },
  sacollective: {
    id: "sacollective",
    name: "Sa Collective",
    short: "Sa Collective",
    letter: "S",
    prefix: "sc:",
    tools: ["/importer", "/scraper", "/keywords", "/qa", "/pythago"],
    // Store Doctor: alleen de laatste N producten, maattabellen uit
    doctor: { latestOnly: true, sizeGuides: false },
    // Product Scraper: één geheugen-sheet voor ELKE Sa Collective-store
    // (Justin 24-10): "GEHEUGEN CHAIM" (eigenaar attoh.gmc, service account
    // attoh-sheets = bewerker). Chaim-formaat: Keyword · Competitor · Match ·
    // Productnaam · URL (E); wij schrijven erbij in hetzelfde formaat.
    // (Was Chaims eigen sheet 1bH7lN9f… — daar had de service account geen
    // schrijfrechten → "The caller does not have permission".)
    memorySheet: {
      name: "GEHEUGEN CHAIM",
      url: "https://docs.google.com/spreadsheets/d/1XPRbzn9fMdCdf0SEdaMcPb_ZR0nD9vtqAF6OxoulJc0/edit",
      format: "chaim",
    },
  },
};

export const ORG_LIST = [ORGS.attoh, ORGS.sacollective];

/** "attoh" | "sacollective" — alles anders (leeg, onbekend) = attoh. */
export function normOrg(v) {
  const s = String(v || "").toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(ORGS, s) ? s : DEFAULT_ORG;
}

export function orgOf(id) {
  return ORGS[normOrg(id)];
}

/** Key met organisatie-prefix ("geh:stores" → "sc:geh:stores" in Sa Collective). */
export function nsKey(orgId, key) {
  return orgOf(orgId).prefix + String(key);
}

/** Mag deze organisatie deze pagina openen? (home, login en api altijd) */
export function toolAllowed(orgId, pathname) {
  const p = String(pathname || "/");
  if (p === "/" || p.startsWith("/login") || p.startsWith("/api/") || p.startsWith("/kw")) return true;
  const org = orgOf(orgId);
  // alleen bekende tool-paden worden beperkt; onbekende paden laten we met rust
  const known = ALL_TOOLS.find((t) => p === t || p.startsWith(t + "/"));
  if (!known) return true;
  return org.tools.includes(known);
}
