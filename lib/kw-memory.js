// BATCH-GEHEUGEN — onthoudt élke Keyword Planner-batch PER MARKT, blijvend.
//
// Waarom: als een stats-tabblad kwijt/kapot is moest Justin de CSV's opnieuw
// in Google Ads opzoeken. Nu wordt elke stap 1-run (mét verplichte markt)
// achter de schermen samengevoegd in één geheugen-tabblad per markt, in een
// Google Sheet (blijvend — Redis is RAM-only en dus alleen voor config/meta).
// Vanuit dat geheugen is met één klik een all-batch-tabblad te maken, en de
// importer haalt er "booming" zoektermen uit (venstervolume komende 4
// maanden) voor betere omschrijvingen.
//
// DE MARKT IS HEILIG: elk tabblad dat via stap 1 of het geheugen ontstaat
// wordt geregistreerd (tabblad → markt); de verdeling weigert te draaien op
// een tabblad waarvan de bekende markt niet klopt met de gekozen markt.
import { createClient } from "redis";
import {
  readRange, readColumnsBatch, addTab, appendRows, updateValues, clearValues,
  getTabIdByTitle, duplicateTab, resizeTabGrid, deleteTab, parseSheetId, a1Tab,
  getSheetSizes,
} from "./sheets";
import { storeProfile } from "./verdeling";

export const MARKETS_LIST = ["USA", "UK", "AUS", "CAN"];

/* ---------------- Redis (config + meta + tabblad→markt register) ---------------- */

let clientPromise = null;
function getRedis() {
  if (!clientPromise) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL env var ontbreekt");
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => console.error("Redis error:", err));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

const CFG_KEY = "kwmem:cfg"; // { USA: {sheetId, url}, ... }
const META_KEY = (m) => `kwmem:meta:${m}`; // { rows, updatedAt, lastBatch, months }
const TABMARKET_KEY = "kwmem:tabmarket"; // hash: "<sheetId>::<tabnaam>" -> markt

function normMarket(m) {
  const v = String(m || "").toUpperCase().trim();
  return MARKETS_LIST.includes(v) ? v : null;
}

export async function getConfig() {
  const r = await getRedis();
  try {
    return JSON.parse((await r.get(CFG_KEY)) || "{}") || {};
  } catch {
    return {};
  }
}

export async function setConfigLink(market, link) {
  const m = normMarket(market);
  if (!m) throw new Error("Onbekende markt");
  const id = parseSheetId(link);
  if (!id || id.length < 20) throw new Error("Dit lijkt geen Google Sheets-link of -ID");
  const r = await getRedis();
  const cfg = await getConfig();
  cfg[m] = { sheetId: id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
  await r.set(CFG_KEY, JSON.stringify(cfg));
  return cfg[m];
}

export async function getMeta(market) {
  const r = await getRedis();
  try {
    return JSON.parse((await r.get(META_KEY(market))) || "null");
  } catch {
    return null;
  }
}

async function setMeta(market, meta) {
  const r = await getRedis();
  await r.set(META_KEY(market), JSON.stringify(meta));
}

const tabKey = (sheetId, tab) => `${parseSheetId(sheetId)}::${String(tab || "").trim().toLowerCase()}`;

export async function registerTabMarket(sheetId, tab, market) {
  const m = normMarket(market);
  if (!m) return;
  const r = await getRedis();
  await r.hSet(TABMARKET_KEY, tabKey(sheetId, tab), m);
}

/** Bekende markt van een tabblad, of null. NOOIT throwen — de verdeling moet
 *  blijven werken als Redis even weg is (dan alleen zonder de strenge check). */
export async function getTabMarket(sheetId, tab) {
  try {
    const r = await getRedis();
    const v = await r.hGet(TABMARKET_KEY, tabKey(sheetId, tab));
    return normMarket(v);
  } catch {
    return null;
  }
}

/* ---------------- maand-kolommen (EN + NL Planner-labels) ---------------- */

const MONTH_IDX = {
  jan: 0, feb: 1, mar: 2, mrt: 2, apr: 3, may: 4, mei: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11,
};
const MONTH_LABEL = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];

// "Searches: Aug 2025" / "Aug 2025" / "okt 2025" → {y: 2025, m: 7, key: "2025-07"}
function parseMonthHeader(h) {
  const s = String(h || "").toLowerCase().replace(/^searches:\s*/, "").trim();
  const mm = s.match(/^([a-z]{3,4})\.?\s+(\d{4})$/);
  if (!mm) return null;
  const idx = MONTH_IDX[mm[1].slice(0, 3)];
  if (idx == null) return null;
  const y = Number(mm[2]);
  return { y, m: idx, key: `${y}-${String(idx).padStart(2, "0")}`, label: `${MONTH_LABEL[idx]} ${y}` };
}

const EXTRA_COLS = ["Competition", "Comp. index", "Top bid low", "Top bid high", "3-mnd verandering %", "YoY verandering %"];
const SEEN_COL = "Laatst gezien";

function parseHeader(header) {
  const lower = header.map((h) => String(h || "").toLowerCase());
  const kwIdx = lower.findIndex((h) => h.startsWith("keyword"));
  const avgIdx = lower.findIndex((h) => h.startsWith("avg"));
  const months = [];
  header.forEach((h, i) => {
    const p = parseMonthHeader(h);
    if (p) months.push({ ...p, i });
  });
  const extraIdx = {};
  for (const name of EXTRA_COLS) {
    extraIdx[name] = lower.findIndex((h) => h === name.toLowerCase() || h.startsWith(name.toLowerCase()));
  }
  const seenIdx = lower.findIndex((h) => h.startsWith("laatst gezien"));
  return { kwIdx, avgIdx, months, extraIdx, seenIdx };
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Eén tabblad volledig inlezen → rijen als {kw, avg, months: {key: val}, extras: {}, seen}. */
async function readStatsTab(sheetId, tab) {
  const headerRows = await readRange(sheetId, `${a1Tab(tab)}!1:1`);
  const header = (headerRows[0] || []).map((h) => String(h || ""));
  if (!header.length) return { header, rows: [], parsed: parseHeader([]) };
  const parsed = parseHeader(header);
  if (parsed.kwIdx === -1) throw new Error(`Kolom "Keyword" niet gevonden in "${tab}"`);
  const wanted = [parsed.kwIdx, parsed.avgIdx, ...parsed.months.map((m) => m.i),
    ...Object.values(parsed.extraIdx), parsed.seenIdx].filter((i) => i >= 0);
  const cols = await readColumnsBatch(sheetId, tab, wanted);
  const nRows = (cols[parsed.kwIdx] || []).length;
  const rows = [];
  for (let r = 0; r < nRows; r++) {
    const kw = String((cols[parsed.kwIdx] || [])[r] || "").toLowerCase().trim();
    if (!kw) continue;
    const months = {};
    for (const m of parsed.months) months[m.key] = num((cols[m.i] || [])[r]);
    const extras = {};
    for (const name of EXTRA_COLS) {
      const i = parsed.extraIdx[name];
      extras[name] = i >= 0 ? String((cols[i] || [])[r] ?? "") : "";
    }
    const seen = parsed.seenIdx >= 0 ? String((cols[parsed.seenIdx] || [])[r] || "") : "";
    rows.push({ kw, avg: parsed.avgIdx >= 0 ? num((cols[parsed.avgIdx] || [])[r]) : 0, months, extras, seen });
  }
  return { header, rows, parsed };
}

/* ---------------- geheugen-tabblad schrijven ---------------- */

const memTabName = (m) => `MEM ${m}`;
const topTabName = (m) => `TOP ${m}`;

async function ensureTabWithGrid(sheetId, title, rows, cols) {
  const grid = { rows: Math.max(2, rows), cols: Math.max(1, cols) };
  const made = await addTab(sheetId, title, grid);
  if (made.ok) return made.tabId;
  const tabId = await getTabIdByTitle(sheetId, title);
  if (tabId === null) throw new Error(made.error || `Tabblad "${title}" niet aan te maken`);
  await resizeTabGrid(sheetId, tabId, grid.rows, grid.cols);
  await clearValues(sheetId, a1Tab(title));
  return tabId;
}

async function writeTable(sheetId, title, header, dataRows) {
  await ensureTabWithGrid(sheetId, title, dataRows.length + 1, header.length);
  await updateValues(sheetId, `${a1Tab(title)}!A1`, [header]);
  const CHUNK = 10000;
  for (let i = 0; i < dataRows.length; i += CHUNK) {
    await appendRows(sheetId, `${a1Tab(title)}!A1`, dataRows.slice(i, i + CHUNK), "RAW");
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- MERGE: batch → geheugen ---------------- */

export async function mergeIntoMemory({ market, srcSheetId, srcTab, label }) {
  const m = normMarket(market);
  if (!m) throw new Error("Kies eerst de markt (USA/UK/AUS/CAN) — die is heilig");
  const cfg = await getConfig();
  const mem = cfg[m];
  if (!mem || !mem.sheetId) {
    return { ok: false, notConfigured: true, market: m };
  }

  const src = await readStatsTab(srcSheetId, srcTab);
  if (!src.rows.length) throw new Error(`"${srcTab}" bevat geen keyword-rijen`);

  let memData = { rows: [], parsed: { months: [] } };
  const memTabId = await getTabIdByTitle(mem.sheetId, memTabName(m));
  if (memTabId !== null) memData = await readStatsTab(mem.sheetId, memTabName(m));

  /* Maand-as: alle bekende maanden (geheugen + nieuwe batch) samen, chronologisch,
     laatste 12. Een oude rij die een nieuwe maand niet heeft krijgt daar een
     lege cel — eerlijk, geen verzonnen nullen. */
  const monthMap = new Map();
  for (const list of [memData.parsed.months, src.parsed.months]) {
    for (const mo of list || []) monthMap.set(mo.key, mo.label);
  }
  const axis = [...monthMap.keys()].sort().slice(-12);
  if (!axis.length) throw new Error(`Geen maandkolommen gevonden in "${srcTab}"`);

  const byKw = new Map();
  for (const row of memData.rows) byKw.set(row.kw, row);
  let added = 0;
  let updated = 0;
  const stamp = today();
  for (const row of src.rows) {
    row.seen = stamp;
    const prev = byKw.get(row.kw);
    if (!prev) {
      byKw.set(row.kw, row);
      added++;
      continue;
    }
    const win = row.avg >= prev.avg ? row : prev;
    const lose = win === row ? prev : row;
    for (const k of Object.keys(lose.months)) if (win.months[k] == null) win.months[k] = lose.months[k];
    for (const name of EXTRA_COLS) if (!win.extras[name]) win.extras[name] = lose.extras[name];
    win.seen = stamp;
    byKw.set(row.kw, win);
    if (win === row) updated++;
  }

  const all = [...byKw.values()].sort((a, b) => b.avg - a.avg);
  const header = ["Keyword", "Avg. monthly search", ...axis.map((k) => monthMap.get(k)), ...EXTRA_COLS, SEEN_COL];
  const dataRows = all.map((r) => [
    r.kw, r.avg,
    ...axis.map((k) => (r.months[k] == null ? "" : r.months[k])),
    ...EXTRA_COLS.map((name) => r.extras[name] ?? ""),
    r.seen || stamp,
  ]);
  await writeTable(mem.sheetId, memTabName(m), header, dataRows);

  // TOP-index voor de importer (booming = venstervolume komende 4 maanden)
  const topInfo = await rebuildTop(m, mem.sheetId, all, axis);

  const meta = {
    rows: all.length, updatedAt: new Date().toISOString(), lastBatch: String(label || srcTab),
    months: axis.map((k) => monthMap.get(k)), added, updated, topRows: topInfo.count, window: topInfo.window,
  };
  await setMeta(m, meta);
  await registerTabMarket(mem.sheetId, memTabName(m), m);
  await registerTabMarket(srcSheetId, srcTab, m);
  return { ok: true, market: m, memSheetUrl: mem.url, added, updated, total: all.length, window: topInfo.window };
}

/* ---------------- TOP-index (booming komende 4 maanden) ---------------- */

function windowKeys(axis) {
  // Komende 4 kalendermaanden vanaf nu; per maand de MEEST RECENTE kolom met
  // die maandnaam (zelfde-maand-vorig-jaar = de voorspelling van de methode).
  const now = new Date();
  const wanted = [1, 2, 3, 4].map((i) => (now.getMonth() + i) % 12);
  const keys = [];
  for (const mi of wanted) {
    const match = [...axis].reverse().find((k) => Number(k.split("-")[1]) === mi);
    if (match) keys.push({ key: match, label: MONTH_LABEL[mi] });
  }
  return keys;
}

async function rebuildTop(market, memSheetId, allRows, axis) {
  const win = windowKeys(axis);
  const scored = [];
  for (const r of allRows) {
    let vol = 0;
    let peak = "";
    let peakV = -1;
    for (const w of win) {
      const v = Number(r.months[w.key]) || 0;
      vol += v;
      if (v > peakV) {
        peakV = v;
        peak = w.label;
      }
    }
    if (vol > 0) scored.push([r.kw, vol, peak, r.avg]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const top = scored.slice(0, 2500);
  await writeTable(memSheetId, topTabName(market), ["Keyword", `Venstervolume (${win.map((w) => w.label).join("-")})`, "Piekmaand", "Avg"], top);
  return { count: top.length, window: win.map((w) => w.label).join("-") };
}

/* ---------------- 1-klik all-batch-tabblad ---------------- */

export async function makeAllBatchTab(market) {
  const m = normMarket(market);
  if (!m) throw new Error("Onbekende markt");
  const cfg = await getConfig();
  const mem = cfg[m];
  if (!mem || !mem.sheetId) throw new Error(`Geen geheugen-sheet gekoppeld voor ${m} — plak eerst een sheet-link in het Geheugen-tabblad`);
  const srcId = await getTabIdByTitle(mem.sheetId, memTabName(m));
  if (srcId === null) throw new Error(`Geheugen voor ${m} is nog leeg — draai eerst een stap 1-run met markt ${m}`);

  // Oude snapshots van deze markt opruimen (regenereerbaar; anders loopt het
  // workbook tegen de 10M-cellenlimiet door stapelende kopieën).
  const d = new Date();
  const name = `ALL ${m} ${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  for (const t of await getSheetSizes(mem.sheetId)) {
    if (t.title.startsWith(`ALL ${m} `) && t.title !== name) await deleteTab(mem.sheetId, t.tabId);
    if (t.title === name) await deleteTab(mem.sheetId, t.tabId);
  }
  const copy = await duplicateTab(mem.sheetId, srcId, name);
  await registerTabMarket(mem.sheetId, name, m);
  const meta = await getMeta(m);
  return {
    ok: true, market: m, tab: name, sheetId: mem.sheetId,
    url: `https://docs.google.com/spreadsheets/d/${mem.sheetId}/edit#gid=${copy.tabId}`,
    rows: meta ? meta.rows : null, memTab: memTabName(m), memSheetUrl: mem.url,
  };
}

/* ---------------- TOP lezen (importer) ---------------- */

const topCache = new Map(); // markt -> {at, rows} — warm-lambda cache (10 min)

// Store-valuta → markt. Vangnet voor stores waarvan het publieke domein niet
// in STORE_PROFILES staat (of alleen het myshopify-domein bekend is): de
// importer draaide dan zonder trend-keywords terwijl het AUS-geheugen vol zat.
const CURRENCY_MARKET = { USD: "USA", GBP: "UK", AUD: "AUS", NZD: "AUS", CAD: "CAN" };

/** Markt bepalen: expliciet → profiel op (publiek) domein → profiel op alt-
 *  domein → valuta. Geeft ook terug WAAROP de keuze is gebaseerd (voor de log). */
export function resolveMarket({ market, domain, altDomain, currency } = {}) {
  let m = normMarket(market);
  if (m) return { market: m, via: "opgegeven" };
  for (const d of [domain, altDomain]) {
    if (!d) continue;
    const p = storeProfile(d);
    if (p && normMarket(p.market)) return { market: normMarket(p.market), via: `profiel ${p.domain}` };
  }
  const c = String(currency || "").toUpperCase().trim();
  if (c && CURRENCY_MARKET[c]) return { market: CURRENCY_MARKET[c], via: `valuta ${c}` };
  return { market: null, via: null };
}

export async function getTopKeywords({ market, domain, altDomain, currency }) {
  const r = resolveMarket({ market, domain, altDomain, currency });
  const m = r.market;
  if (!m) return { market: null, via: null, rows: [] };
  const hit = topCache.get(m);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return { market: m, via: r.via, rows: hit.rows, window: hit.window };
  const cfg = await getConfig();
  const mem = cfg[m];
  if (!mem || !mem.sheetId) return { market: m, via: r.via, rows: [], notConfigured: true };
  const values = await readRange(mem.sheetId, `${a1Tab(topTabName(m))}!A1:C2501`).catch(() => []);
  if (!values.length) return { market: m, via: r.via, rows: [] };
  const windowLabel = String((values[0] || [])[1] || "").replace(/^Venstervolume \(|\)$/g, "");
  const rows = values.slice(1)
    .map((v) => ({ kw: String(v[0] || ""), vol: num(v[1]), peak: String(v[2] || "") }))
    .filter((r) => r.kw);
  topCache.set(m, { at: Date.now(), rows, window: windowLabel });
  return { market: m, via: r.via, rows, window: windowLabel };
}

export async function memoryStatus() {
  const cfg = await getConfig();
  const out = [];
  for (const m of MARKETS_LIST) {
    out.push({ market: m, sheetUrl: (cfg[m] && cfg[m].url) || null, meta: await getMeta(m) });
  }
  return out;
}
