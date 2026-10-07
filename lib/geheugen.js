// GEHEUGEN v2 — de basis voor de aanvulstrategie (Chaim-methode, 7-10-2026).
//
// Twee soorten geheugen, allebei blijvend in Google Sheets (Redis bewaart
// alleen waar ze staan + de kerncijfers):
//
//  1. MARKT-GEHEUGEN — "All keywords" per markt, MAN en VROUW APART.
//     5–10 Keyword Planner-CSV's per geslacht → één nette tab
//     "ALL AUS VROUW" / "ALL AUS MAN" (kolommen A–T: Keyword · Avg · 12
//     maanden · Competition · Comp. index · bids · 3-mnd % · YoY %). Of een
//     bestaand tabblad koppelen. Staat vast voor ±3 maanden; daarna (of bij
//     een seizoenswissel) een verse batch.
//
//  2. STORE-GEHEUGEN — per store één AANVUL-SHEET. Daarin schrijft de tool:
//     - "ORG VROUW" / "ORG MAN": wat er nu op de store staat (live uit
//       Shopify: keyword links van de pipe, aantal producten, collectie, tag)
//       samen met de originele product organization (wat er ooit gepland is)
//     - "COLLECTIES": alle collecties op de store + die uit het origineel,
//       met tag, geslacht en aantallen — basis voor de collectie-herkenning
//     - "INFO": store, markt, geslacht, datum, bronnen
//     Daarna komen in dezelfde sheet de week-tabs van de planning; de
//     scraper leest die als bron.
//
// Markt is heilig: elke batch gaat door de seizoens- en geslachtscheck
// (lib/market-season.js) voordat hij in het geheugen komt.

import { getRedis, registerTabMarket, MARKETS_LIST, resolveMarket } from "./kw-memory";
import {
  readRange, readColumnsBatch, addTab, appendRows, updateValues, clearValues,
  getTabIdByTitle, deleteTab, renameTab, resizeTabGrid, getSheetSizes, parseSheetId,
  a1Tab, spreadsheetBatchUpdate, SHEETS_CELL_LIMIT,
} from "./sheets";
import { listProducts, storeRequest, cleanDomain } from "./shopify";
import { genderInfo, storeProfile } from "./verdeling";
import { seasonCheck, genderCheck, parseMonthLabel } from "./market-season";

const GENDERS = { V: "VROUW", M: "MAN" };
const ALL_CFG = "geh:all:cfg"; // { AUS: { sheetId, url } }
const ALL_META = (m, g) => `geh:all:${m}:${g}`;
const STORES = "geh:stores"; // hash: domein → json (NOOIT credentials)

export const ALL_HEADER_EXTRA = ["Competition", "Comp. index", "Top bid low", "Top bid high", "3-mnd verandering %", "YoY verandering %"];
export const REFRESH_DAYS = 90;

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function normMarket(m) {
  const v = String(m || "").toUpperCase().trim();
  return MARKETS_LIST.includes(v) ? v : null;
}
function normGender(g) {
  const v = String(g || "").toUpperCase().trim();
  return v === "M" || v === "MAN" ? "M" : v === "V" || v === "VROUW" ? "V" : null;
}
export const allTabName = (m, g) => `ALL ${m} ${GENDERS[g]}`;
const sheetUrl = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid != null ? `#gid=${gid}` : ""}`;

async function getJson(key, fallback) {
  try {
    const r = await getRedis();
    const v = await r.get(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
async function setJson(key, val) {
  const r = await getRedis();
  await r.set(key, JSON.stringify(val));
}

/* ======================================================================
   1. MARKT-GEHEUGEN — All keywords per markt, man en vrouw apart
   ====================================================================== */

export async function allStatus() {
  const cfg = await getJson(ALL_CFG, {});
  const out = [];
  for (const m of MARKETS_LIST) {
    const row = { market: m, sheetUrl: (cfg[m] && cfg[m].url) || null };
    for (const g of ["V", "M"]) {
      const meta = await getJson(ALL_META(m, g), null);
      if (meta && meta.savedAt) {
        meta.ageDays = Math.floor((Date.now() - new Date(meta.savedAt).getTime()) / 86400000);
        meta.stale = meta.ageDays >= REFRESH_DAYS;
      }
      row[g] = meta;
    }
    out.push(row);
  }
  return out;
}

export async function setAllSheet(market, link) {
  const m = normMarket(market);
  if (!m) throw httpErr(400, "Kies een markt");
  const id = parseSheetId(link);
  if (!id || id.length < 20) throw httpErr(400, "Dit lijkt geen Google Sheets-link");
  // toegang meteen testen — anders faalt het pas na het uploaden van 100k rijen
  try {
    await getSheetSizes(id);
  } catch (e) {
    throw httpErr(403, `Geen toegang tot deze sheet (${e.message}). Deel hem als Bewerker met attoh-sheets@attoh-tools.iam.gserviceaccount.com.`);
  }
  const cfg = await getJson(ALL_CFG, {});
  cfg[m] = { sheetId: id, url: sheetUrl(id) };
  await setJson(ALL_CFG, cfg);
  return cfg[m];
}

/** Bron van de All keywords voor markt + geslacht (voor planner/scraper). */
export async function getAllSource(market, gender) {
  const m = normMarket(market);
  const g = normGender(gender);
  if (!m || !g) return null;
  return getJson(ALL_META(m, g), null);
}

/**
 * Tab klaarzetten voor een CSV-upload: capaciteit checken, oude tab met
 * dezelfde naam vervangen (via tijdelijke naam, zodat een sheet met maar
 * één tabblad niet stukgaat), header schrijven. De rijen zelf komen daarna
 * in blokken via /api/keywords-sheet (append) — die route bestaat al.
 */
export async function allPrepare({ market, gender, header, rowCount }) {
  const m = normMarket(market);
  const g = normGender(gender);
  if (!m) throw httpErr(400, "Kies de markt — die is heilig");
  if (!g) throw httpErr(400, "Kies Man of Vrouw");
  if (!Array.isArray(header) || header.length < 14) throw httpErr(400, "Header ontbreekt of is te kort");
  const cfg = await getJson(ALL_CFG, {});
  const sheet = cfg[m];
  if (!sheet || !sheet.sheetId) {
    throw httpErr(422, `Nog geen All keywords-sheet gekoppeld voor ${m}. Plak hierboven een (lege) Google Sheet-link en klik "Koppelen".`);
  }
  const title = allTabName(m, g);
  const cols = header.length;
  const rows = Math.max(2, Number(rowCount) + 1);

  const sizes = await getSheetSizes(sheet.sheetId);
  const old = sizes.find((t) => t.title === title);
  const used = sizes.reduce((s, t) => s + (t.title === title ? 0 : t.cells), 0);
  const need = rows * cols;
  if (used + need > SHEETS_CELL_LIMIT) {
    const big = sizes
      .filter((t) => t.title !== title)
      .sort((a, b) => b.cells - a.cells)
      .slice(0, 3)
      .map((t) => `"${t.title}" (${(t.cells / 1e6).toFixed(1)}M)`)
      .join(", ");
    throw httpErr(
      422,
      `De All keywords-sheet van ${m} zit vol: ${(used / 1e6).toFixed(1)}M van 10M cellen in gebruik, deze tab heeft ${(need / 1e6).toFixed(1)}M nodig. Grootste tabs: ${big}. Koppel een nieuwe, lege sheet voor ${m} of verwijder oude tabs.`
    );
  }

  const tmp = old ? `${title} (nieuw)` : title;
  const stale = sizes.find((t) => t.title === tmp);
  if (old && stale) await deleteTab(sheet.sheetId, stale.tabId);
  // Raster klein beginnen: de rijen komen via append (INSERT_ROWS) en laten
  // het tabblad precies meegroeien — een vooraf gereserveerd raster zou
  // anders verdubbelen (lege rijen schuiven mee naar beneden).
  const made = await addTab(sheet.sheetId, tmp, { rows: 2, cols });
  if (!made.ok) throw httpErr(422, made.error);
  let tabId = made.tabId;
  if (old) {
    await deleteTab(sheet.sheetId, old.tabId);
    await renameTab(sheet.sheetId, tabId, title);
  }
  await appendRows(sheet.sheetId, `${a1Tab(title)}!A1`, [header], "RAW");
  return { ok: true, sheetId: sheet.sheetId, sheetUrl: sheet.url, tab: title, tabId, replaced: !!old };
}

export async function allCommit({ market, gender, tab, tabId, rows, months, files, season, genderChk, forced }) {
  const m = normMarket(market);
  const g = normGender(gender);
  if (!m || !g) throw httpErr(400, "Markt of geslacht ontbreekt");
  const cfg = await getJson(ALL_CFG, {});
  const sheet = cfg[m];
  if (!sheet) throw httpErr(422, "Geen All keywords-sheet gekoppeld");
  const meta = {
    source: "csv",
    market: m,
    gender: g,
    sheetId: sheet.sheetId,
    tab: String(tab || allTabName(m, g)),
    url: sheetUrl(sheet.sheetId, tabId),
    rows: Number(rows) || 0,
    months: Array.isArray(months) ? months : [],
    files: Array.isArray(files) ? files.slice(0, 20) : [],
    season: season || null,
    genderChk: genderChk || null,
    forced: !!forced,
    savedAt: new Date().toISOString(),
  };
  await setJson(ALL_META(m, g), meta);
  await registerTabMarket(sheet.sheetId, meta.tab, m).catch(() => {});
  return { ok: true, meta };
}

/**
 * Bestaand tabblad koppelen (bv. "SHAPES WARDROBE - 02/10 - VROUW").
 * Leest het hele tabblad om rijen te tellen en de seizoens- + geslachtscheck
 * te draaien. Kopieert niets — het geheugen wijst ernaar.
 */
export async function allLink({ market, gender, link, tab, force }) {
  const m = normMarket(market);
  const g = normGender(gender);
  if (!m) throw httpErr(400, "Kies de markt — die is heilig");
  if (!g) throw httpErr(400, "Kies Man of Vrouw");
  const sheetId = parseSheetId(link);
  const t = String(tab || "").trim();
  if (!sheetId || sheetId.length < 20) throw httpErr(400, "Plak de link van de sheet met de batch");
  if (!t) throw httpErr(400, "Vul de exacte bladnaam in");

  let head;
  try {
    head = ((await readRange(sheetId, `${a1Tab(t)}!1:1`))[0] || []).map((h) => String(h || "").trim());
  } catch (e) {
    const msg = String(e.message || e);
    if (/unable to parse range|not found/i.test(msg)) throw httpErr(404, `Tabblad "${t}" niet gevonden — kopieer de exacte naam (hoofdletters en spaties tellen mee).`);
    if (/permission|403/i.test(msg)) throw httpErr(403, "Geen toegang — deel de sheet als Bewerker met attoh-sheets@attoh-tools.iam.gserviceaccount.com.");
    throw e;
  }
  const lower = head.map((h) => h.toLowerCase());
  const kwIdx = lower.findIndex((h) => h.startsWith("keyword"));
  const avgIdx = lower.findIndex((h) => h.startsWith("avg"));
  if (kwIdx === -1 || avgIdx === -1) throw httpErr(422, `"${t}" heeft geen kolommen "Keyword" en "Avg. monthly search" in rij 1 — is dit een keyword-batch?`);
  const monthCols = [];
  head.forEach((h, i) => {
    const p = parseMonthLabel(h);
    if (p) monthCols.push({ i, label: h.replace(/^searches:\s*/i, ""), key: p.key });
  });
  if (monthCols.length < 10) throw httpErr(422, `Maar ${monthCols.length} maandkolommen in "${t}" — een All keywords-batch heeft er 12.`);
  const extrasFound = ALL_HEADER_EXTRA.filter((x) => lower.some((h) => h.startsWith(x.toLowerCase())));

  const cols = await readColumnsBatch(sheetId, t, [kwIdx, ...monthCols.map((c) => c.i)]);
  const kws = cols[kwIdx] || [];
  const rows = [];
  for (let r = 0; r < kws.length; r++) {
    const kw = String(kws[r] || "").trim().toLowerCase();
    if (!kw) continue;
    rows.push({ kw, months: monthCols.map((c) => Number(String((cols[c.i] || [])[r] ?? "").replace(/[^\d.-]/g, "")) || 0) });
  }
  if (!rows.length) throw httpErr(422, `"${t}" bevat geen keywords`);

  const labels = monthCols.map((c) => c.label);
  const season = seasonCheck(rows, labels, m);
  const gChk = genderCheck(rows, g);
  if ((!season.ok || !gChk.ok) && !force) {
    return { ok: false, needsForce: true, season, genderChk: gChk, rows: rows.length };
  }

  const tabId = await getTabIdByTitle(sheetId, t).catch(() => null);
  const meta = {
    source: "link",
    market: m,
    gender: g,
    sheetId,
    tab: t,
    url: sheetUrl(sheetId, tabId),
    rows: rows.length,
    months: labels,
    extras: extrasFound,
    files: [],
    season,
    genderChk: gChk,
    forced: !!force && (!season.ok || !gChk.ok),
    savedAt: new Date().toISOString(),
  };
  await setJson(ALL_META(m, g), meta);
  await registerTabMarket(sheetId, t, m).catch(() => {});
  return { ok: true, meta };
}

/* ======================================================================
   2. STORE-GEHEUGEN — aanvul-sheet per store
   ====================================================================== */

const storeKey = (store) => cleanDomain((store && store.domain) || store);

/** Alleen publieke velden — credentials blijven in de browser. */
function publicStore(s) {
  return {
    name: String(s.name || "").trim(),
    domain: cleanDomain(s.domain),
    publicDomain: cleanDomain(s.publicDomain || ""),
    currency: String(s.currency || "").toUpperCase(),
  };
}

export async function storeList() {
  try {
    const r = await getRedis();
    const all = await r.hGetAll(STORES);
    return Object.values(all || {})
      .map((v) => {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } catch {
    return [];
  }
}

export async function getStoreMemory(domain) {
  try {
    const r = await getRedis();
    const v = await r.hGet(STORES, cleanDomain(domain));
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function storeDefaults(pub) {
  const prof = storeProfile(pub.publicDomain) || storeProfile(pub.domain);
  const res = resolveMarket({ domain: pub.publicDomain, altDomain: pub.domain, currency: pub.currency });
  return { market: res.market || null, genders: (prof && prof.genders) || "MV" };
}

export async function storeSave({ store, market, genders, aanvul, orgSheet, orgTab }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const pub = publicStore(store);
  const def = storeDefaults(pub);
  const prev = (await getStoreMemory(pub.domain)) || {};
  const aId = parseSheetId(aanvul || "");
  if (!aId || aId.length < 20) throw httpErr(400, "Plak de link van de aanvul-sheet van deze store");
  try {
    await getSheetSizes(aId);
  } catch (e) {
    throw httpErr(403, `Geen toegang tot de aanvul-sheet (${e.message}). Deel hem als Bewerker met attoh-sheets@attoh-tools.iam.gserviceaccount.com.`);
  }
  const g = ["M", "V", "MV"].includes(String(genders || "").toUpperCase()) ? String(genders).toUpperCase() : def.genders;
  const entry = {
    ...prev,
    ...pub,
    market: normMarket(market) || prev.market || def.market,
    genders: g,
    aanvulSheetId: aId,
    aanvulUrl: sheetUrl(aId),
    orgSheetId: orgSheet ? parseSheetId(orgSheet) : prev.orgSheetId || "",
    orgTab: orgTab != null ? String(orgTab).trim() : prev.orgTab || "",
    savedAt: new Date().toISOString(),
  };
  if (!entry.market) throw httpErr(422, "Markt van deze store onbekend — kies hem zelf");
  const r = await getRedis();
  await r.hSet(STORES, pub.domain, JSON.stringify(entry));
  return entry;
}

/* ---------- keyword + canon (regels uit de aanvulstrategie, sectie 2b) ---------- */

const GENDER_PHRASES = [
  /\bfor (women|ladies|men|guys)\b/g,
  /\b(women's|womens|women|woman's|womans|woman|ladies'|ladies|lady's|lady|female)\b/g,
  /\b(men's|mens|men|man's|male|guys|guy's|gents|unisex)\b/g,
];
const KEEP_PLURAL = new Set([
  "shorts", "jeans", "pants", "sandals", "trousers", "leggings", "joggers", "chinos", "boardies",
  "thongs", "bathers", "trunks", "briefs", "slacks", "overalls", "dungarees", "heels", "flats",
  "loafers", "sneakers", "boots", "slides", "mules", "clogs", "pumps", "espadrilles", "trainers",
  "glasses", "sunglasses", "pajamas", "pyjamas", "scrubs", "culottes", "capris",
]);

/** Titel → keyword zoals hij links van de pipe staat, zonder geslachtswoorden. */
export function keywordFromTitle(title) {
  let s = String(title || "").split("|")[0].toLowerCase().replace(/[’`]/g, "'");
  for (const re of GENDER_PHRASES) s = s.replace(re, " ");
  return s.replace(/[^a-z0-9&'\- ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Canon voor de uitsluitlijst: kleine letters, geen geslacht, enkelvoud, tee → t shirt. */
export function canonOf(kw) {
  let s = keywordFromTitle(kw).replace(/'/g, "");
  s = s.replace(/\bt-?shirts?\b|\btshirts?\b|\btees?\b/g, "t shirt");
  const out = [];
  for (let t of s.split(/[\s\-]+/)) {
    if (!t) continue;
    if (!KEEP_PLURAL.has(t)) {
      if (/(sses|shes|ches|xes)$/.test(t)) t = t.slice(0, -2);
      else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
    }
    out.push(t);
  }
  return out.join(" ").trim();
}

/* ---------- Shopify: collecties uitlezen en regels toepassen ---------- */

async function listAll(store, path, key) {
  const out = [];
  let since = 0;
  for (let page = 0; page < 20; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await storeRequest(store, `${path}${sep}limit=250&since_id=${since}`);
    if (!r.ok) throw httpErr(r.status || 500, `Shopify: ${r.error}`);
    const list = (r.data && r.data[key]) || [];
    out.push(...list);
    if (list.length < 250) break;
    since = list[list.length - 1].id;
  }
  return out;
}

const SUPPORTED = new Set(["tag", "type", "title", "vendor"]);

function ruleMatch(rule, p) {
  const cond = String(rule.condition || "").toLowerCase();
  const rel = String(rule.relation || "");
  let field;
  if (rule.column === "tag") {
    const tags = p._tags;
    if (rel === "equals") return tags.includes(cond);
    if (rel === "not_equals") return !tags.includes(cond);
    if (rel === "contains") return tags.some((t) => t.includes(cond));
    if (rel === "not_contains") return !tags.some((t) => t.includes(cond));
    if (rel === "starts_with") return tags.some((t) => t.startsWith(cond));
    if (rel === "ends_with") return tags.some((t) => t.endsWith(cond));
    return false;
  }
  if (rule.column === "type") field = String(p.product_type || "").toLowerCase();
  else if (rule.column === "title") field = String(p.title || "").toLowerCase();
  else if (rule.column === "vendor") field = String(p.vendor || "").toLowerCase();
  else return false;
  if (rel === "equals") return field === cond;
  if (rel === "not_equals") return field !== cond;
  if (rel === "contains") return field.includes(cond);
  if (rel === "not_contains") return !field.includes(cond);
  if (rel === "starts_with") return field.startsWith(cond);
  if (rel === "ends_with") return field.endsWith(cond);
  return false;
}

function collectionGender(title) {
  const t = String(title || "").toLowerCase();
  if (/\b(women|womens|women's|ladies|her)\b/.test(t)) return "V";
  if (/\b(men|mens|men's|him|guys)\b/.test(t)) return "M";
  return null;
}

function productGender(p, coll, storeGenders) {
  if (storeGenders === "M" || storeGenders === "V") return storeGenders;
  const tags = p._tags;
  if (tags.some((t) => /^(women|womens|women's|ladies|woman|female|dames|vrouw)$/.test(t))) return "V";
  if (tags.some((t) => /^(men|mens|men's|male|man|heren)$/.test(t))) return "M";
  const cg = coll ? collectionGender(coll) : null;
  if (cg) return cg;
  return genderInfo(String(p.title || "").split("|")[0].toLowerCase(), "MV").g;
}

/* ---------- originele organization (Keywords-tool-formaat) ---------- */

async function readOrgRows(sheetId, tab, storeGenders) {
  const rows = await readRange(sheetId, `${a1Tab(tab)}!A1:J`);
  if (!rows.length) throw httpErr(422, `Organization-tabblad "${tab}" is leeg of bestaat niet`);
  const head = (rows[0] || []).map((h) => String(h || "").toLowerCase());
  const iKw = head.findIndex((h) => h.startsWith("keyword"));
  const iCol = head.findIndex((h) => h.startsWith("collectie"));
  const iG = head.findIndex((h) => h.startsWith("groep"));
  const iN = head.findIndex((h) => h.startsWith("aantal"));
  if (iKw === -1 || iCol === -1) throw httpErr(422, `"${tab}" mist de kolommen Keyword/Collectie — is dit de originele organization?`);
  const gHead = iG >= 0 ? head[iG] : "";
  const fixed = /alleen heren/.test(gHead) ? "M" : /alleen dames/.test(gHead) ? "V" : storeGenders === "M" || storeGenders === "V" ? storeGenders : null;
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const kw = String(r[iKw] || "").trim().toLowerCase();
    if (!kw || kw === "keyword" || r.join(" ").toUpperCase().includes("UNDERDOG KEYWORDS")) continue;
    const n = iN >= 0 ? Number(r[iN]) || 0 : 0;
    if (iN >= 0 && !Number.isFinite(Number(r[iN])) && !Number.isFinite(Number(r[0]))) continue;
    const gv = iG >= 0 ? String(r[iG] || "").trim().toUpperCase() : "";
    const g = fixed || (gv === "M" ? "M" : gv === "V" ? "V" : genderInfo(kw, "MV").g);
    out.push({ kw, n, col: String(r[iCol] || "").trim(), g });
  }
  return out;
}

/* ---------- tabs schrijven met nette opmaak ---------- */

const NAVY = { red: 0x1e / 255, green: 0x3a / 255, blue: 0x5f / 255 };
const WHITE = { red: 1, green: 1, blue: 1 };
const BAND = { red: 0xf2 / 255, green: 0xf2 / 255, blue: 0xf2 / 255 };

async function writeTable(sheetId, title, header, rows, widths) {
  const nRows = Math.max(2, rows.length + 1);
  const nCols = header.length;
  let tabId = await getTabIdByTitle(sheetId, title);
  if (tabId === null) {
    const made = await addTab(sheetId, title, { rows: nRows, cols: nCols });
    if (!made.ok) throw httpErr(422, made.error);
    tabId = made.tabId;
  } else {
    await clearValues(sheetId, a1Tab(title));
    await resizeTabGrid(sheetId, tabId, nRows, nCols);
  }
  await updateValues(sheetId, `${a1Tab(title)}!A1`, [header, ...rows]);
  const reqs = [
    { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontFamily: "Arial", fontSize: 10 } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: nRows, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { textFormat: { fontFamily: "Arial", fontSize: 10 } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
    { setBasicFilter: { filter: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: nRows, startColumnIndex: 0, endColumnIndex: nCols } } } },
  ];
  (widths || []).forEach((px, i) => {
    if (!px) return;
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    });
  });
  // om de rij grijs (zoals de organization sheet van Chaim)
  const bands = [];
  for (let r = 2; r < nRows && bands.length < 4000; r += 2) {
    bands.push({
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nCols },
        cell: { userEnteredFormat: { backgroundColor: BAND } },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  }
  try {
    await spreadsheetBatchUpdate(sheetId, reqs);
    if (bands.length) await spreadsheetBatchUpdate(sheetId, bands);
  } catch {
    /* opmaak is nice-to-have */
  }
  return tabId;
}

/* ---------- de snapshot zelf ---------- */

/**
 * Store-geheugen bijwerken: Shopify live uitlezen + de originele organization
 * erbij, en in de aanvul-sheet van de store wegschrijven (ORG VROUW, ORG MAN,
 * COLLECTIES, INFO).
 * store = volledig store-object uit de browser (mét credentials, alleen voor
 * deze request; er wordt niets van opgeslagen).
 */
export async function storeSnapshot({ store }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const entry = await getStoreMemory(store.domain);
  if (!entry || !entry.aanvulSheetId) throw httpErr(422, "Sla eerst de aanvul-sheet van deze store op");
  const storeGenders = entry.genders || "MV";
  const warnings = [];

  /* 1 · Shopify: producten + collecties */
  const prod = await listProducts(store, 5000, { fields: "id,title,tags,status,product_type,vendor" });
  if (!prod.ok) throw httpErr(502, `Producten ophalen mislukt: ${prod.error}`);
  const products = (prod.products || []).filter((p) => p.status !== "archived");
  for (const p of products) {
    p._tags = String(p.tags || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  }
  if (prod.products && prod.products.length >= 5000) warnings.push("Store heeft 5000+ producten — alleen de eerste 5000 zijn meegenomen");

  let smart = [];
  let custom = [];
  try {
    smart = await listAll(store, "/smart_collections.json?fields=id,title,handle,rules,disjunctive", "smart_collections");
    custom = await listAll(store, "/custom_collections.json?fields=id,title,handle", "custom_collections");
  } catch (e) {
    warnings.push(`Collecties uitlezen deels mislukt: ${e.message}`);
  }

  // Per smart collection: welke producten vallen erin (alleen regels op
  // tag/type/titel/vendor — prijs/voorraad-regels zijn "verzamel"-collecties)
  const colls = smart.map((c) => {
    const rules = c.rules || [];
    const usable = rules.length > 0 && rules.every((r) => SUPPORTED.has(r.column));
    const tagRule = rules.find((r) => r.column === "tag" && r.relation === "equals");
    return { id: c.id, title: c.title, handle: c.handle, kind: usable ? "smart" : "smart (prijs/voorraad-regel)", usable, rules, disjunctive: !!c.disjunctive, tag: tagRule ? tagRule.condition : "", members: 0 };
  });
  for (const c of custom) colls.push({ id: c.id, title: c.title, handle: c.handle, kind: "handmatig", usable: false, rules: [], tag: "", members: 0 });

  const byTitle = new Map(colls.map((c) => [c.title.toLowerCase(), c]));
  const prodColls = new Map(); // product id → [coll]
  for (const p of products) {
    const hits = [];
    for (const c of colls) {
      if (!c.usable) continue;
      const ok = c.disjunctive ? c.rules.some((r) => ruleMatch(r, p)) : c.rules.every((r) => ruleMatch(r, p));
      if (ok) hits.push(c);
    }
    // vangnet: tag die exact gelijk is aan een collectietitel (zo importeert de tool)
    for (const t of p._tags) {
      const c = byTitle.get(t);
      if (c && !hits.includes(c)) hits.push(c);
    }
    for (const c of hits) c.members++;
    prodColls.set(p.id, hits);
  }
  // verzamelcollecties (Sale, New In, All…) tellen niet als "de" collectie
  const catchAll = new Set(colls.filter((c) => products.length >= 20 && c.members > products.length * 0.6).map((c) => c.id));

  /* 2 · per product: keyword, canon, geslacht, collectie */
  const agg = { V: new Map(), M: new Map() };
  const bump = (g, canon, patch) => {
    const map = agg[g];
    let row = map.get(canon);
    if (!row) {
      row = { canon, names: new Map(), onStore: 0, planned: 0, colls: new Map(), tags: new Map(), origCol: "" };
      map.set(canon, row);
    }
    if (patch.name) row.names.set(patch.name, (row.names.get(patch.name) || 0) + 1);
    if (patch.onStore) row.onStore += patch.onStore;
    if (patch.planned) row.planned += patch.planned;
    if (patch.coll) row.colls.set(patch.coll, (row.colls.get(patch.coll) || 0) + 1);
    if (patch.tag) row.tags.set(patch.tag, (row.tags.get(patch.tag) || 0) + 1);
    if (patch.origCol && !row.origCol) row.origCol = patch.origCol;
    return row;
  };
  const collGender = new Map(); // coll title → {V, M}
  let noColl = 0;
  for (const p of products) {
    const name = keywordFromTitle(p.title);
    if (!name) continue;
    const canon = canonOf(name);
    const hits = (prodColls.get(p.id) || []).filter((c) => !catchAll.has(c.id));
    hits.sort((a, b) => a.members - b.members || a.title.localeCompare(b.title));
    const coll = hits[0] || null;
    if (!coll) noColl++;
    const g = productGender(p, coll && coll.title, storeGenders);
    bump(g, canon, { name, onStore: 1, coll: coll ? coll.title : "", tag: coll ? coll.tag || coll.title : "" });
    if (coll) {
      const cg = collGender.get(coll.title) || { V: 0, M: 0 };
      cg[g]++;
      collGender.set(coll.title, cg);
    }
  }

  /* 3 · originele organization erbij */
  let orgRows = [];
  if (entry.orgSheetId && entry.orgTab) {
    try {
      orgRows = await readOrgRows(entry.orgSheetId, entry.orgTab, storeGenders);
    } catch (e) {
      warnings.push(`Originele organization niet gelezen: ${e.message}`);
    }
  }
  const orgColls = new Map(); // titel → {planned, V, M}
  for (const o of orgRows) {
    const canon = canonOf(o.kw);
    if (!canon) continue;
    bump(o.g, canon, { name: keywordFromTitle(o.kw), planned: o.n, origCol: o.col });
    if (o.col) {
      const oc = orgColls.get(o.col) || { planned: 0, V: 0, M: 0 };
      oc.planned += o.n;
      oc[o.g] += o.n;
      orgColls.set(o.col, oc);
    }
  }

  /* 4 · tabellen bouwen */
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  const today = new Date().toISOString().slice(0, 10);
  const collTotals = new Map();
  for (const c of colls) collTotals.set(c.title, c.members);
  const tables = {};
  const counts = {};
  for (const g of ["V", "M"]) {
    const list = [...agg[g].values()].map((r) => {
      const name = (top(r.names) || [r.canon])[0];
      const coll = (top(r.colls) || [r.origCol || ""])[0];
      const tag = (top(r.tags) || [coll])[0];
      const bron = r.onStore && r.planned ? "store + origineel" : r.onStore ? "alleen store" : "alleen origineel (niet op store)";
      return { name, canon: r.canon, onStore: r.onStore, planned: r.planned, coll, tag, bron };
    });
    list.sort((a, b) => (collTotals.get(b.coll) || 0) - (collTotals.get(a.coll) || 0) || a.coll.localeCompare(b.coll) || b.onStore - a.onStore || b.planned - a.planned);
    tables[g] = list;
    counts[g] = { keywords: list.length, products: list.reduce((s, r) => s + r.onStore, 0), planned: list.reduce((s, r) => s + r.planned, 0) };
  }

  const ORG_HEADER = ["Keyword", "Op store (producten)", "Gepland in origineel", "Collectie", "Tag", "Bron", "Canon"];
  const ORG_WIDTHS = [230, 130, 140, 200, 180, 210, 200];
  const written = [];
  for (const g of ["V", "M"]) {
    if (storeGenders !== "MV" && storeGenders !== g && !tables[g].length) continue;
    const rows = tables[g].map((r) => [r.name, r.onStore, r.planned, r.coll || "(geen collectie)", r.tag || "", r.bron, r.canon]);
    const title = `ORG ${GENDERS[g]}`;
    await writeTable(entry.aanvulSheetId, title, ORG_HEADER, rows, ORG_WIDTHS);
    written.push(title);
  }

  // COLLECTIES: alles van de store + wat alleen in het origineel staat
  const collRows = [];
  const seen = new Set();
  for (const c of [...colls].sort((a, b) => b.members - a.members || a.title.localeCompare(b.title))) {
    seen.add(c.title.toLowerCase());
    const cg = collGender.get(c.title) || { V: 0, M: 0 };
    const g = cg.V && cg.M ? "MV" : cg.M ? "M" : cg.V ? "V" : collectionGender(c.title) || "";
    const oc = orgColls.get(c.title);
    const kind = catchAll.has(c.id) ? `${c.kind} — verzamelcollectie` : c.kind;
    collRows.push([c.title, c.tag || (c.usable ? "" : "-"), kind, g, c.members, cg.V, cg.M, oc ? oc.planned : 0, "ja", c.handle || ""]);
  }
  for (const [title, oc] of orgColls) {
    if (seen.has(title.toLowerCase())) continue;
    const g = oc.V && oc.M ? "MV" : oc.M ? "M" : "V";
    collRows.push([title, title, "alleen in origineel", g, 0, 0, 0, oc.planned, "NEE — wordt aangemaakt bij import (tag)", ""]);
  }
  await writeTable(
    entry.aanvulSheetId,
    "COLLECTIES",
    ["Collectie", "Tag (regel)", "Soort", "Geslacht", "Producten op store", "Producten V", "Producten M", "Gepland in origineel", "Bestaat op store", "Handle"],
    collRows,
    [220, 180, 230, 80, 140, 100, 100, 150, 260, 180]
  );
  written.push("COLLECTIES");

  // INFO: alles wat de planner (of Claude) moet weten over deze store
  const allV = await getAllSource(entry.market, "V");
  const allM = await getAllSource(entry.market, "M");
  const allLine = (a) => (a ? `${a.tab} · ${a.rows} keywords · ${(a.months || [])[0] || "?"} – ${(a.months || []).slice(-1)[0] || "?"} · opgeslagen ${String(a.savedAt).slice(0, 10)} · ${a.url}` : "nog niet in het geheugen");
  const info = [
    ["Store", entry.name || entry.domain],
    ["Domein", entry.publicDomain || entry.domain],
    ["Shopify-domein", entry.domain],
    ["Markt", entry.market],
    ["Geslacht store", storeGenders === "MV" ? "man + vrouw" : storeGenders === "M" ? "alleen heren" : "alleen dames"],
    ["Snapshot", today],
    ["Producten op store (niet gearchiveerd)", products.length],
    ["Keywords op store — vrouw", `${counts.V.keywords} keywords · ${counts.V.products} producten`],
    ["Keywords op store — man", `${counts.M.keywords} keywords · ${counts.M.products} producten`],
    ["Producten zonder collectie", noColl],
    ["Collecties op store", colls.length],
    ["Verzamelcollecties (genegeerd voor toewijzing)", colls.filter((c) => catchAll.has(c.id)).map((c) => c.title).join(", ") || "-"],
    ["Originele organization", entry.orgSheetId && entry.orgTab ? `${entry.orgTab} · ${orgRows.length} keywords · ${sheetUrl(entry.orgSheetId)}` : "niet gekoppeld"],
    ["All keywords — vrouw", allLine(allV)],
    ["All keywords — man", allLine(allM)],
    ["Waarschuwingen", warnings.join(" | ") || "-"],
  ];
  await writeTable(entry.aanvulSheetId, "INFO", ["Veld", "Waarde"], info, [300, 700]);
  written.push("INFO");

  const snapshot = {
    at: new Date().toISOString(),
    products: products.length,
    vrouw: counts.V,
    man: counts.M,
    collections: colls.length,
    noCollection: noColl,
    origRows: orgRows.length,
    warnings,
  };
  const r = await getRedis();
  await r.hSet(STORES, storeKey(store), JSON.stringify({ ...entry, snapshot }));
  await registerTabMarket(entry.aanvulSheetId, "ORG VROUW", entry.market).catch(() => {});
  await registerTabMarket(entry.aanvulSheetId, "ORG MAN", entry.market).catch(() => {});

  const topColls = colls
    .filter((c) => !catchAll.has(c.id) && c.members)
    .sort((a, b) => b.members - a.members)
    .slice(0, 8)
    .map((c) => `${c.title} ${c.members}`);
  return { ok: true, url: entry.aanvulUrl, written, snapshot, topColls, allV: !!allV, allM: !!allM };
}
