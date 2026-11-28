// IMPORTPLANNEN (28-11-2026) — Justin: "Ik wil in de chat met Claude het
// plan maken (welke keywords, hoeveel producten, per store, deze week) en dat
// in één klik via de tool doorvoeren voor alle stores tegelijk — net als de
// prijsplannen in de Store Doctor."
//
// Werkwijze
//   1. CLAUDE (chat, via de Attoh-connector /api/mcp):
//      - keywords_lookup  → zoekvolumes per maand uit ALL KEYWORDS (per markt,
//                            man/vrouw) zodat het plan op echte vraag rust
//      - store_memory      → per store markt, geslacht, TPK-sheet, collecties
//      - import_plan put   → zet het plan klaar (Redis)
//   2. JUSTIN (tool, pagina Importplannen): plan bekijken per store →
//      "Zet in de TPK-sheets" → per store een weekblad (bv. "Plan W49") in de
//      TPK-sheet, exact in het scraper-formaat (A–J zoals de Scraper W-tabs).
//   3. Product Scraper → TPK-sheet + dat blad → importlijst → Importer.
//
// Planvorm (JSON):
// {
//   id, name, week: "W49", note, source: "Hanish winterlijst 27-11",
//   stores: [
//     { store: "Soul Society Boutique", tab: "Plan W49",
//       rows: [ { keyword:"fleece lined leggings", collection:"Leggings",
//                 gender:"V"|"M", count:6, type:"Direct", uitleg:"…",
//                 vol: 12100, peak:"Dec" } ] }
//   ]
// }

import { getJSON, setJSON, delKey } from "./finder-redis.js";
import { readRange, readColumnsBatch, updateValues, clearValues, addTab, getTabIdByTitle, resizeTabGrid, spreadsheetBatchUpdate, a1Tab, parseSheetId } from "./sheets";
import { getAllSource, storeList, getStoreMemory } from "./geheugen";
import { parseMonthLabel } from "./market-season";
import { SCRAPER_HEADER } from "./scraper-tabs";

const PLAN_INDEX = "importplan:index";
const PLAN_KEY = (id) => `importplan:${id}`;
const MONTHS = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
const intOf = (v) => Number(String(v ?? "").replace(/[^\d]/g, "")) || 0;
const low = (s) => String(s || "").toLowerCase().trim();

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ======================================================================
   1. KEYWORDS LOOKUP — All keywords per markt + geslacht
   ====================================================================== */

const memCache = new Map(); // `${m}:${g}` → { at, rows:[{kw, m:[12 maanden oud→nieuw], labels}] }
const CACHE_MS = 15 * 60 * 1000;

async function loadAll(market, gender) {
  const key = `${market}:${gender}`;
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const src = await getAllSource(market, gender);
  if (!src || !src.sheetId || !src.tab) throw httpErr(404, `Geen ALL KEYWORDS-sheet voor ${market} ${gender === "M" ? "MAN" : "VROUW"} in het geheugen`);
  const head = ((await readRange(src.sheetId, `${a1Tab(src.tab)}!1:1`))[0] || []).map((h) => String(h || "").trim());
  const kwIdx = head.findIndex((h) => low(h).startsWith("keyword"));
  const monthCols = [];
  head.forEach((h, i) => {
    const p = parseMonthLabel(h);
    if (p) monthCols.push({ i, m: p.m, y: p.y, label: `${MONTHS[p.m]} ${String(p.y).slice(-2)}` });
  });
  monthCols.sort((a, b) => a.y - b.y || a.m - b.m);
  const last12 = monthCols.slice(-12);
  if (kwIdx < 0 || !last12.length) throw httpErr(422, "ALL KEYWORDS-blad mist de kolom Keyword of maandkolommen");
  const cols = await readColumnsBatch(src.sheetId, src.tab, [kwIdx, ...last12.map((c) => c.i)]);
  const kws = cols[kwIdx] || [];
  const rows = [];
  for (let r = 0; r < kws.length; r++) {
    const kw = low(kws[r]);
    if (!kw) continue;
    rows.push({ kw, m: last12.map((c) => intOf((cols[c.i] || [])[r])) });
  }
  const out = { at: Date.now(), rows, months: last12.map((c) => ({ m: c.m, y: c.y, label: c.label })), tab: src.tab, sheetId: src.sheetId };
  memCache.set(key, out);
  return out;
}

/** Venster = de komende `ahead` maanden (vorig jaar, zelfde maanden). */
function windowIdx(months, ahead = 3) {
  const now = new Date();
  const want = Array.from({ length: ahead }, (_, i) => (now.getMonth() + i) % 12);
  return want.map((mi) => months.findIndex((x) => x.m === mi)).filter((i) => i >= 0);
}

/**
 * keywordsLookup({ market, gender, terms?, contains?, limit?, ahead? })
 *  - terms: exacte keywords (lijst) → per term de cijfers (of "niet gevonden")
 *  - contains: woord(en) die er allemaal in moeten zitten ("puffer jacket")
 *  → per keyword: venstervolume (komende maanden, vorig jaar), jaargemiddelde,
 *    piekmaand en de 12 maanden.
 */
export async function keywordsLookup({ market, gender, terms = [], contains = "", limit = 40, ahead = 3, top = 0 } = {}) {
  const m = String(market || "").toUpperCase();
  const g = String(gender || "").toUpperCase().startsWith("M") ? "M" : "V";
  const data = await loadAll(m, g);
  const win = windowIdx(data.months, Math.max(1, Math.min(6, Number(ahead) || 3)));
  const shape = (r) => {
    const avg = Math.round(r.m.reduce((a, b) => a + b, 0) / (r.m.length || 1));
    const winVol = win.reduce((a, i) => a + (r.m[i] || 0), 0);
    let pk = 0;
    r.m.forEach((v, i) => {
      if (v > r.m[pk]) pk = i;
    });
    return { keyword: r.kw, window: winVol, avg, peak: data.months[pk] ? MONTHS[data.months[pk].m] : "", months: Object.fromEntries(data.months.map((x, i) => [x.label, r.m[i]])) };
  };
  const out = { market: m, gender: g, window: win.map((i) => data.months[i].label).join(" + "), totalKeywords: data.rows.length };
  if (Array.isArray(terms) && terms.length) {
    const idx = new Map(data.rows.map((r) => [r.kw, r]));
    out.terms = terms.slice(0, 200).map((t) => {
      const r = idx.get(low(t));
      return r ? shape(r) : { keyword: low(t), notFound: true };
    });
  }
  if (Number(top) > 0) {
    // top N op venstervolume (compact: alleen keyword, venster, gem., piek)
    const all = data.rows.map((r) => {
      const x = shape(r);
      return [x.keyword, x.window, x.avg, x.peak];
    });
    all.sort((a, b) => b[1] - a[1]);
    out.top = all.slice(0, Math.min(5000, Number(top)));
  }
  if (contains) {
    const words = low(contains).split(/\s+/).filter(Boolean);
    const hits = data.rows.filter((r) => words.every((w) => r.kw.includes(w))).map(shape);
    hits.sort((a, b) => b.window - a.window);
    out.contains = contains;
    out.matches = hits.length;
    out.results = hits.slice(0, Math.max(1, Math.min(200, Number(limit) || 40)));
  }
  return out;
}

/* ======================================================================
   2. STORES — wat Claude moet weten om te plannen
   ====================================================================== */

export async function storeMemoryOverview() {
  const list = await storeList();
  return list.map((e) => ({
    name: e.name,
    domain: e.publicDomain || e.domain,
    shopDomain: e.domain,
    market: e.market,
    genders: e.genders, // "V" | "M" | "MV"
    tpkSheet: e.tpkUrl || "",
    orgSheet: e.orgSheetId ? `https://docs.google.com/spreadsheets/d/${e.orgSheetId}/edit` : "",
    importSheet: e.importUrl || "",
    snapshot: e.snapshot ? { at: e.snapshot.at, products: e.snapshot.products, vrouw: e.snapshot.vrouw, man: e.snapshot.man, collections: e.snapshot.collections } : null,
  }));
}

/* ======================================================================
   3. PLANNEN — opslaan / lijst / ophalen
   ====================================================================== */

function cleanPlan(p) {
  if (!p || typeof p !== "object") throw httpErr(400, "Plan ontbreekt");
  const stores = (Array.isArray(p.stores) ? p.stores : []).map((s) => ({
    store: String(s.store || "").trim(),
    tab: String(s.tab || `Plan ${p.week || ""}`).trim().slice(0, 90),
    note: String(s.note || "").slice(0, 500),
    rows: (Array.isArray(s.rows) ? s.rows : [])
      .map((r) => ({
        keyword: String(r.keyword || "").trim(),
        collection: String(r.collection || "").trim(),
        gender: String(r.gender || "V").toUpperCase().startsWith("M") ? "M" : "V",
        count: Math.max(1, Math.min(50, Math.round(Number(r.count) || 1))),
        type: String(r.type || "Direct").trim(),
        uitleg: String(r.uitleg || "").trim().slice(0, 400),
        vol: intOf(r.vol),
        avg: intOf(r.avg),
        peak: String(r.peak || "").trim(),
      }))
      .filter((r) => r.keyword),
  }));
  if (!stores.length || !stores.some((s) => s.rows.length)) throw httpErr(400, "Plan heeft geen stores met keywords");
  for (const s of stores) if (!s.store) throw httpErr(400, "Elke store in het plan heeft een naam/domein nodig");
  return {
    id: String(p.id || `plan-${Date.now()}`).replace(/[^a-z0-9-_]/gi, "-").slice(0, 60),
    name: String(p.name || "Importplan").slice(0, 120),
    week: String(p.week || "").slice(0, 20),
    note: String(p.note || "").slice(0, 2000),
    source: String(p.source || "").slice(0, 300),
    createdAt: p.createdAt || new Date().toISOString(),
    stores,
  };
}

export async function putPlan(plan) {
  const p = cleanPlan(plan);
  await setJSON(PLAN_KEY(p.id), p, 60 * 60 * 24 * 90);
  const idx = (await getJSON(PLAN_INDEX, [])).filter((x) => x.id !== p.id);
  idx.unshift({ id: p.id, name: p.name, week: p.week, createdAt: p.createdAt, stores: p.stores.length, products: p.stores.reduce((a, s) => a + s.rows.reduce((b, r) => b + r.count, 0), 0) });
  await setJSON(PLAN_INDEX, idx.slice(0, 60), 60 * 60 * 24 * 365);
  return { ok: true, id: p.id, stores: p.stores.map((s) => ({ store: s.store, tab: s.tab, keywords: s.rows.length, products: s.rows.reduce((b, r) => b + r.count, 0) })) };
}

export async function listPlans() {
  return getJSON(PLAN_INDEX, []);
}

export async function getPlan(id) {
  const p = await getJSON(PLAN_KEY(id), null);
  if (!p) throw httpErr(404, `Plan "${id}" niet gevonden`);
  return p;
}

export async function deletePlan(id) {
  await delKey(PLAN_KEY(id));
  const idx = (await getJSON(PLAN_INDEX, [])).filter((x) => x.id !== id);
  await setJSON(PLAN_INDEX, idx, 60 * 60 * 24 * 365);
  return { ok: true };
}

/* ======================================================================
   4. DOORVOEREN — per store een weekblad in de TPK-sheet (scraper-formaat)
   ====================================================================== */

function matchStore(list, ref) {
  const r = low(ref).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return (
    list.find((e) => low(e.publicDomain) === r || low(e.domain) === r) ||
    list.find((e) => low(e.name) === r) ||
    list.find((e) => low(e.name).includes(r) || r.includes(low(e.name))) ||
    null
  );
}

const NAVY = { red: 0.12, green: 0.16, blue: 0.29 };
const WHITE = { red: 1, green: 1, blue: 1 };

async function writePlanTab(sheetId, tab, rows, { genders }) {
  const title = String(tab || "").trim();
  if (!title || /^(overzicht|log)$/i.test(title)) throw httpErr(400, `Ongeldige bladnaam "${title}"`);
  const header = SCRAPER_HEADER.slice(0, 10).slice();
  if (genders === "M") header[3] = "Groep — alleen heren";
  if (genders === "V") header[3] = "Groep — alleen dames";
  const sorted = rows.slice().sort((a, b) => b.count - a.count || b.vol - a.vol);
  const values = [header];
  sorted.forEach((r, i) => {
    // heren-zoekterm = "mens " + keyword (zelfde regel als TPK / Scraper W-tabs)
    const zoek = r.gender === "M" && genders !== "M" && !/^mens?\b|\bmen'?s\b/i.test(r.keyword) ? `mens ${r.keyword}` : r.keyword;
    values.push([i + 1, zoek, r.collection, r.gender, r.avg || "", r.vol || "", r.peak, r.count, r.type, r.uitleg]);
  });
  let tabId = await getTabIdByTitle(sheetId, title);
  let replaced = false;
  if (tabId === null) {
    const made = await addTab(sheetId, title, { rows: values.length + 5, cols: 10 });
    if (!made.ok) throw httpErr(422, made.error);
    tabId = made.tabId;
  } else {
    replaced = true;
    await clearValues(sheetId, a1Tab(title));
    await resizeTabGrid(sheetId, tabId, values.length + 5, 10).catch(() => {});
  }
  await updateValues(sheetId, `${a1Tab(title)}!A1`, values);
  await spreadsheetBatchUpdate(sheetId, [
    { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontFamily: "Arial", fontSize: 10 }, wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy)",
      },
    },
    ...[50, 220, 180, 70, 90, 110, 80, 95, 95, 420].map((px, i) => ({
      updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" },
    })),
  ]).catch(() => {});
  // terug-lezen = dezelfde check als de scraper (kop B/D/H)
  const back = await readRange(sheetId, `${a1Tab(title)}!A1:J`);
  const h = (back[0] || []).map(low);
  const ok = h[1]?.startsWith("keyword") && h[3]?.startsWith("groep") && h[7]?.startsWith("aantal");
  return { tab: title, tabId, replaced, rows: sorted.length, products: sorted.reduce((a, r) => a + r.count, 0), scrapeReady: !!ok };
}

/* ======================================================================
   5. WEEKRUN (28-11-2026) — Justin: "per week maar 1 workflow in plaats van 8"
   Eén TPK-sheet en één import-sheet voor ALLE stores (in het geheugen).
   Per store een eigen blad: "<blad van het plan> · <store>", zodat de
   scraper en de importer altijd weten welk product bij welke store hoort.
   Niet ingevuld → valt terug op de eigen TPK-/import-sheet van elke store.
   Het geheugen tegen dubbel scrapen blijft PER STORE (eigen geheugen-sheet).
   ====================================================================== */

const WR_CFG = "weekrun:cfg";
const sheetUrl = (id) => (id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : "");

export async function getWeekrunCfg() {
  const c = await getJSON(WR_CFG, {});
  return { tpkSheetId: c.tpkSheetId || "", importSheetId: c.importSheetId || "", tpkUrl: sheetUrl(c.tpkSheetId), importUrl: sheetUrl(c.importSheetId), savedAt: c.savedAt || "" };
}

export async function setWeekrunCfg({ tpk, importSheet } = {}) {
  const prev = await getJSON(WR_CFG, {});
  const next = { ...prev, savedAt: new Date().toISOString() };
  if (tpk !== undefined) next.tpkSheetId = tpk ? parseSheetId(tpk) || "" : "";
  if (importSheet !== undefined) next.importSheetId = importSheet ? parseSheetId(importSheet) || "" : "";
  if (tpk && !next.tpkSheetId) throw httpErr(400, "TPK-link niet herkend — plak de volledige Google Sheet-link");
  if (importSheet && !next.importSheetId) throw httpErr(400, "Import-link niet herkend — plak de volledige Google Sheet-link");
  await setJSON(WR_CFG, next, 60 * 60 * 24 * 3650);
  return getWeekrunCfg();
}

/** Bladnaam in de gedeelde weekrun-sheets: "Plan W49 Winter · SoulSocietyBoutique" (max 95 tekens). */
export function weekrunTab(tab, storeName) {
  return `${String(tab || "Plan").trim()} · ${String(storeName || "").trim()}`.replace(/[\[\]*?:\/\\']/g, "").slice(0, 95);
}

/** Per store van het plan: waar de scraper leest/schrijft en de importer leest. */
export async function weekrunInfo(id) {
  const plan = await getPlan(id);
  const cfg = await getWeekrunCfg();
  const list = await storeList();
  const stores = [];
  for (const s of plan.stores) {
    const e = matchStore(list, s.store);
    if (!e) {
      stores.push({ store: s.store, ok: false, error: "Store niet gevonden in Keywords → Geheugen" });
      continue;
    }
    const mem = (await getStoreMemory(e.domain)) || e;
    const shared = weekrunTab(s.tab, e.name || s.store);
    const tpk = cfg.tpkSheetId ? { sheetId: cfg.tpkSheetId, tab: shared, shared: true } : mem.tpkSheetId ? { sheetId: mem.tpkSheetId, tab: s.tab, shared: false } : null;
    const imp = cfg.importSheetId ? { sheetId: cfg.importSheetId, tab: shared, shared: true } : mem.importSheetId ? { sheetId: mem.importSheetId, tab: s.tab, shared: false } : null;
    stores.push({
      store: s.store,
      name: e.name || s.store,
      domain: e.domain,
      market: mem.market || e.market || "",
      genders: mem.genders || e.genders || "MV",
      products: s.rows.reduce((a, r) => a + r.count, 0),
      keywords: s.rows.length,
      tpk: tpk ? { ...tpk, url: sheetUrl(tpk.sheetId) } : null,
      import: imp ? { ...imp, url: sheetUrl(imp.sheetId) } : null,
      memSheetId: mem.memSheetId || "",
      ok: !!(tpk && imp),
      error: !tpk ? "Geen TPK-sheet (store of weekrun)" : !imp ? "Geen import-sheet (store of weekrun)" : "",
    });
  }
  return { id: plan.id, name: plan.name, week: plan.week, applied: !!plan.appliedAt, cfg, stores };
}

/** applyPlan({ id, stores?: ["SSB", …] }) → per store resultaat */
export async function applyPlan({ id, stores: only } = {}) {
  const plan = await getPlan(id);
  const list = await storeList();
  const cfg = await getWeekrunCfg();
  const out = [];
  for (const s of plan.stores) {
    if (Array.isArray(only) && only.length && !only.some((o) => low(o) === low(s.store))) continue;
    const e = matchStore(list, s.store);
    if (!e) {
      out.push({ store: s.store, ok: false, error: "Store niet gevonden in Keywords → Geheugen" });
      continue;
    }
    const mem = (await getStoreMemory(e.domain)) || e;
    if (!mem.tpkSheetId && !cfg.tpkSheetId) {
      out.push({ store: e.name, ok: false, error: "Geen TPK-sheet gekoppeld (Keywords → Geheugen)" });
      continue;
    }
    try {
      // Weekrun-TPK (één sheet voor alle stores) + de eigen TPK-sheet van de store
      let shared = null;
      if (cfg.tpkSheetId) {
        const r2 = await writePlanTab(cfg.tpkSheetId, weekrunTab(s.tab, e.name || s.store), s.rows, { genders: mem.genders });
        shared = { tab: r2.tab, sheet: `${sheetUrl(cfg.tpkSheetId)}#gid=${r2.tabId}`, scrapeReady: r2.scrapeReady };
      }
      const r = mem.tpkSheetId ? await writePlanTab(mem.tpkSheetId, s.tab, s.rows, { genders: mem.genders }) : null;
      const base = r || { tab: shared.tab, rows: s.rows.length, products: s.rows.reduce((a, x) => a + x.count, 0), scrapeReady: shared.scrapeReady };
      out.push({ store: e.name, ok: true, ...base, sheet: r ? `${sheetUrl(mem.tpkSheetId)}#gid=${r.tabId}` : shared.sheet, shared });
    } catch (err) {
      out.push({ store: e.name, ok: false, error: String(err.message || err) });
    }
  }
  const p = await getPlan(id);
  p.appliedAt = new Date().toISOString();
  p.applied = out;
  await setJSON(PLAN_KEY(id), p, 60 * 60 * 24 * 90);
  return { id, results: out };
}
