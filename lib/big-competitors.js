// BIG COMPETITORS — opslag, scanner en nachtrun (23-11-2026, projectdoc 205).
//
// Wat het doet: elke nacht (Vercel Cron, ±02:00 NL) en met de knop "Nu
// scannen" leest de tool de openbare Shopify-feed (/products.json) van elke
// actieve big competitor, vergelijkt met wat hij al kende, en zet wat nieuw is
// (hooguit 90 dagen geleden toegevoegd) als import-blad klaar in de Competitor
// Import Sheet van de markt — één blad per store per datum, verdeeld door de
// tool zelf, met onze prijs net onder die van de competitor.
//
// Opzet = de Competitor finder (lib/finder-job.js): toestand in Redis, één
// run tegelijk, elke tick ±26 s werk, daarna opslaan en zichzelf opnieuw
// aanroepen via /api/big-competitors/tick (met geheim). Valt de keten stil,
// dan pakt de status-poll van de pagina of de waakhond-cron hem weer op.
//
// Geheugen per competitor (bc:ids:<domein>): alle product-ID's die de tool
// kent — oud (> 90 dagen), overgeslagen (uitverkocht, kids, geen product) of
// al in een blad gezet. NIET erin: nieuwe producten die nog niet aan de beurt
// waren (max per nacht) — die vindt de volgende scan vanzelf opnieuw, nieuwste
// eerst. De feed is dus zelf de wachtrij; er gaat nooit iets verloren.
//
// Redis (alleen Attoh — Sa Collective heeft deze tool niet):
//   bc:cfg:v1        instellingen + per markt: sheet, onder-de-prijs, max per nacht, stores aan/uit
//   bc:comps:v1      hash domein → competitor (naam, markt, bezoek, status, tellers)
//   bc:ids:<domein>  gezipte ID's (zie lib/bc-logic.js)
//   bc:cand:<domein> nieuwe producten van de laatste scan (3 dagen)
//   bc:job:v1 / bc:job:lock / bc:prog:v1   lopende run
//   bc:timeline:v1   tijdlijn (laatste 300 gebeurtenissen)
//   bc:tabs:v1       aangemaakte datum-bladen (laatste 400)
//   bc:runs:v1       laatste 40 runs
import { getJSON, setJSON, delKey, acquire, release, redis, finderRedisAvailable } from "./finder-redis.js";
import { fetchJson, cleanDomain } from "./scrape";
import { addTab, updateValues, appendRows, a1Tab, parseSheetId, getSheetSizes, spreadsheetBatchUpdate, getServiceAccountEmail } from "./sheets";
import { loadData as loadPythago } from "./pythago-sync";
import { storeProfile } from "./verdeling";
import { BC_MARKETS, BC_MARKET_KEYS, BC_DEFAULTS, BC_EXTRA_STORES, BC_DEFAULT_SHEETS, bcMarket } from "./bc-markets";
import { marketSwitchFor, switchActive, cleanWindow, switchLabel } from "./market-switch";
import { BC_HEADER, amsParts, packIds, unpackIds, addedAtOf, shapeProduct, junkReason, mixGender, roundRobin, perfFromRows, distribute, buildRow, tabTitle } from "./bc-logic";

const K = {
  cfg: "bc:cfg:v1",
  comps: "bc:comps:v1",
  ids: (d) => `bc:ids:${d}`,
  cand: (d) => `bc:cand:${d}`,
  job: "bc:job:v1",
  lock: "bc:job:lock",
  prog: "bc:prog:v1",
  timeline: "bc:timeline:v1",
  tabs: "bc:tabs:v1",
  runs: "bc:runs:v1",
};
const JOB_TTL = 60 * 60 * 24 * 3;
const CAND_TTL = 60 * 60 * 24 * 3;
const LOCK_TTL = 75;
const WORK_MS = 26000; // tot hier starten we nog een ronde (functie-limiet is 60 s, één ronde kan 25 s duren)
const DIST_START_MS = 18000; // een markt verdelen + bladen schrijven alleen met genoeg tijd over
const STALE_MS = 150000;
const CAND_CAP = 400; // nieuwe producten per competitor per scan (nieuwste eerst)
const PAGE_MAX = 240; // 240 × 250 = 60.000 producten
const TIMELINE_MAX = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sheetUrl = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid != null ? `#gid=${gid}` : ""}`;

export function bcAvailable() {
  return finderRedisAvailable();
}
export function bcJobSecret() {
  return process.env.BC_JOB_SECRET || process.env.CF_JOB_SECRET || process.env.SG_JOB_SECRET || process.env.SESSION_SECRET || "dev-only-secret-change-me-in-vercel-env-1234567890";
}
function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* Streng lezen: een Redis-hik mag nooit als "leeg" tellen bij lees-wijzig-
   schrijf (anders overschrijf je de lijst met één regel). getJSON uit
   finder-redis geeft bij een fout de terugvalwaarde — hier gooien we. */
async function readStrict(key, fallback) {
  const c = await redis();
  if (!c) throw new Error("Redis ontbreekt");
  const raw = await c.get(key);
  return raw ? JSON.parse(raw) : fallback;
}

/* ======================================================================
   INSTELLINGEN
   ====================================================================== */
function defaultCfg() {
  return {
    nightly: true,
    maxAgeDays: BC_DEFAULTS.maxAgeDays,
    seeded: false,
    markets: Object.fromEntries(BC_MARKET_KEYS.map((k) => [k, { sheetId: "", undercut: BC_DEFAULTS.undercut, maxPerRun: BC_DEFAULTS.maxPerRun, stores: {} }])),
  };
}
function normCfg(c) {
  const d = defaultCfg();
  const out = { ...d, ...(c || {}) };
  out.markets = {};
  for (const k of BC_MARKET_KEYS) out.markets[k] = { ...d.markets[k], ...(((c || {}).markets || {})[k] || {}) };
  out.maxAgeDays = Math.max(7, Math.min(365, Number(out.maxAgeDays) || BC_DEFAULTS.maxAgeDays));
  return out;
}
export async function getCfg() {
  return normCfg(await getJSON(K.cfg, null));
}
async function writeCfg(cfg) {
  await setJSON(K.cfg, cfg);
  return cfg;
}
export async function saveSettings(patch) {
  const cfg = normCfg(await readStrict(K.cfg, null));
  if (patch && patch.nightly != null) cfg.nightly = !!patch.nightly;
  if (patch && patch.maxAgeDays != null) cfg.maxAgeDays = Math.max(7, Math.min(365, Number(patch.maxAgeDays) || BC_DEFAULTS.maxAgeDays));
  return writeCfg(cfg);
}
/** Per markt: sheet (link of leeg), onder-de-prijs, max per nacht, stores aan/uit. */
export async function saveMarket(marketKey, patch) {
  const m = bcMarket(marketKey);
  if (!m) throw httpErr(400, "Onbekende markt");
  const cfg = normCfg(await readStrict(K.cfg, null));
  const cur = cfg.markets[m.key];
  if (patch.sheet !== undefined) {
    const raw = String(patch.sheet || "").trim();
    const id = raw ? parseSheetId(raw) : "";
    if (raw && (!id || id.length < 20)) throw httpErr(400, "Plak de link van de Competitor Import Sheet (of laat het veld leeg)");
    if (id && id !== cur.sheetId) {
      try {
        await getSheetSizes(id);
      } catch (e) {
        throw httpErr(403, `Geen toegang tot de sheet (${e.message}). Deel hem als Bewerker met ${getServiceAccountEmail() || "attoh-sheets@attoh-tools.iam.gserviceaccount.com"}.`);
      }
    }
    cur.sheetId = id;
  }
  if (patch.undercut !== undefined) cur.undercut = Math.max(0, Math.min(100, Number(patch.undercut) || 0));
  if (patch.maxPerRun !== undefined) cur.maxPerRun = Math.max(5, Math.min(1000, Math.round(Number(patch.maxPerRun) || BC_DEFAULTS.maxPerRun)));
  if (patch.stores && typeof patch.stores === "object") {
    cur.stores = { ...(cur.stores || {}) };
    for (const [d, on] of Object.entries(patch.stores)) {
      const key = cleanDomain(d);
      if (!key) continue;
      if (on === null) delete cur.stores[key];
      else cur.stores[key] = !!on;
    }
  }
  await writeCfg(cfg);
  return cfg;
}

/* ======================================================================
   STORES PER MARKT — store-geheugen (Keywords → Geheugen) + Claude-koppeling
   ====================================================================== */
const CUR_MARKET = { USD: "USA", GBP: "UK", CAD: "CAN" };
function parseHash(h) {
  return Object.values(h || {})
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
function extraFor(domain, publicDomain) {
  for (const [market, list] of Object.entries(BC_EXTRA_STORES)) {
    for (const x of list) {
      if (x.match.includes(domain) || (publicDomain && x.match.includes(publicDomain))) return { market, genders: x.genders || "" };
    }
  }
  return null;
}
/* Market switch (24-11-2026): een store die van markt wisselde (EMC AUS → USA)
   telt vanaf de switchdatum in de nieuwe markt, ook als het geheugen nog de
   oude markt noemt. */
function marketAfterSwitch(st, market) {
  const sw = marketSwitchFor(st);
  if (!sw || !switchActive(st)) return market;
  return !market || market === sw.from.market ? sw.to.market : market;
}
/** Pythago-cijfers van een store voor de verdeler. Net na een market switch
 *  tellen alleen vensters die helemaal in de nieuwe markt vallen (7/14/30
 *  dagen); is er nog geen schoon venster, dan "geen cijfers" → eerlijk verdeeld. */
function perfForStore(s, data) {
  const st = { domain: s.domain, publicDomain: s.publicDomain, name: s.name };
  const win = cleanWindow(st);
  const sw = switchLabel(st);
  if (!win) return { hasData: false, orders: 0, byGarment: {}, window: 0, switch: sw };
  if (!data || !Array.isArray(data.rows)) return { hasData: false, orders: 0, byGarment: {}, window: win, switch: sw };
  return { ...perfFromRows(data.rows, { window: win }), switch: sw };
}

/** Alle eigen stores die de tool kent (zonder credentials). */
export async function allStores() {
  const c = await redis();
  if (!c) return [];
  const out = new Map();
  // 1. store-geheugen van Attoh: markt, geslacht, Big Competitor-sheet
  for (const e of parseHash(await c.hGetAll("geh:stores").catch(() => ({})))) {
    const domain = cleanDomain(e.domain);
    if (!domain) continue;
    const pub = cleanDomain(e.publicDomain || "");
    const extra = extraFor(domain, pub);
    out.set(domain, {
      domain,
      name: String(e.name || pub || domain),
      publicDomain: pub,
      market: marketAfterSwitch({ domain, publicDomain: pub, name: e.name }, String(e.market || "").toUpperCase()),
      extraMarket: extra ? extra.market : "",
      genders: ["M", "V", "MV"].includes(String(e.genders || "").toUpperCase()) ? String(e.genders).toUpperCase() : (extra && extra.genders) || "MV",
      bigCompSheetId: e.bigCompSheetId || "",
      source: "geheugen",
    });
  }
  // 2. Claude-koppeling (/claude): stores die nog niet in het geheugen staan
  for (const s of parseHash(await c.hGetAll("claude:stores").catch(() => ({})))) {
    const domain = cleanDomain(s.domain);
    if (!domain || out.has(domain)) continue;
    const prof = storeProfile(domain);
    const extra = extraFor(domain, prof ? prof.domain : "");
    out.set(domain, {
      domain,
      name: String(s.name || domain),
      publicDomain: prof ? prof.domain : "",
      market: marketAfterSwitch({ domain, publicDomain: prof ? prof.domain : "", name: s.name }, (prof && prof.market) || CUR_MARKET[String(s.currency || "").toUpperCase()] || ""),
      extraMarket: extra ? extra.market : "",
      genders: (prof && prof.genders) || (extra && extra.genders) || "MV",
      bigCompSheetId: "",
      source: "koppeling",
    });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
/** Doet deze store mee in deze markt? Handmatige keuze wint; anders markt uit het geheugen (of de vaste uitzondering). */
function storeOn(s, market, mcfg) {
  const ov = (mcfg.stores || {})[s.domain];
  if (ov === true) return true;
  if (ov === false) return false;
  return s.extraMarket ? s.extraMarket === market : s.market === market;
}
export function storesForMarket(stores, market, cfg) {
  return stores.filter((s) => storeOn(s, market, cfg.markets[market]));
}
/** Sheet van de markt: ingevuld op de pagina, anders de Big Competitor-sheet uit het geheugen
 *  van een store van die markt, anders de vaste sheet van de markt (BC_DEFAULT_SHEETS). */
export function sheetForMarket(stores, market, cfg) {
  const own = cfg.markets[market].sheetId;
  if (own) return { sheetId: own, source: "pagina" };
  const counts = {};
  for (const s of storesForMarket(stores, market, cfg)) if (s.bigCompSheetId) counts[s.bigCompSheetId] = (counts[s.bigCompSheetId] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (top) return { sheetId: top[0], source: "geheugen" };
  const def = BC_DEFAULT_SHEETS[market];
  return def ? { sheetId: def, source: "standaard" } : { sheetId: "", source: "" };
}

/* ======================================================================
   COMPETITORS
   ====================================================================== */
const SEED = [{ domain: "barbaradever.com", name: "Barbara Dever Boutique", market: "USA", visits: 1800000 }];

/** "1.8M" · "353k" · "1.800.000" → getal */
export function parseVisits(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/\s/g, "");
  if (!s) return 0;
  const m = s.match(/^([\d.,]+)([km])?/);
  if (!m) return 0;
  let n;
  if (m[2]) n = Number(m[1].replace(",", ".")) * (m[2] === "m" ? 1e6 : 1e3);
  else n = Number(m[1].replace(/[.,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function seedIfNeeded() {
  const cfg = await getCfg();
  if (cfg.seeded) return;
  const c = await redis();
  if (!c) return;
  const have = await c.hLen(K.comps);
  if (!have) {
    for (const s of SEED) {
      await c.hSet(K.comps, s.domain, JSON.stringify({ ...s, gender: "auto", active: true, addedAt: Date.now() }));
    }
  }
  const fresh = normCfg(await readStrict(K.cfg, null));
  fresh.seeded = true;
  await writeCfg(fresh);
}

export async function listCompetitors() {
  const c = await redis();
  if (!c) return [];
  await seedIfNeeded().catch(() => {});
  const list = parseHash(await c.hGetAll(K.comps));
  const order = Object.fromEntries(BC_MARKET_KEYS.map((k, i) => [k, i]));
  return list.sort((a, b) => (order[a.market] ?? 9) - (order[b.market] ?? 9) || (b.visits || 0) - (a.visits || 0) || String(a.domain).localeCompare(String(b.domain)));
}
export async function getCompetitor(domain) {
  const c = await redis();
  if (!c) return null;
  const v = await c.hGet(K.comps, cleanDomain(domain));
  return v ? JSON.parse(v) : null;
}
/** Eén competitor bijwerken zonder de rest te raken (de scan en de pagina schrijven allebei). */
export async function patchCompetitor(domain, patch) {
  const c = await redis();
  if (!c) return null;
  const key = cleanDomain(domain);
  const v = await c.hGet(K.comps, key);
  if (!v) return null;
  const next = { ...JSON.parse(v), ...(typeof patch === "function" ? patch(JSON.parse(v)) : patch) };
  await c.hSet(K.comps, key, JSON.stringify(next));
  return next;
}

/** Feed even proeven: draait het op Shopify, is de feed open, valuta, aantal producten. */
export async function probeFeed(domain) {
  const dom = cleanDomain(domain);
  const out = { feed: "dicht", status: 0, currency: "", shopName: "", expected: 0 };
  const meta = await fetchJson(`https://${dom}/meta.json`, 9000);
  if (meta.ok && meta.data) {
    out.currency = String(meta.data.currency || "").toUpperCase();
    out.shopName = String(meta.data.name || "");
    out.expected = Number(meta.data.published_products_count) || 0;
  }
  const r = await fetchJson(`https://${dom}/products.json?limit=1`, 12000);
  if (r.ok && r.data && Array.isArray(r.data.products)) out.feed = "open";
  else {
    out.status = r.status || 0;
    const r2 = await fetchJson(`https://${dom}/collections/all/products.json?limit=1`, 12000);
    if (r2.ok && r2.data && Array.isArray(r2.data.products)) out.feed = "open";
  }
  return out;
}

export async function addCompetitor({ market, url, name, visits, gender }) {
  const m = bcMarket(market);
  if (!m) throw httpErr(400, "Kies een markt (USA, UK of Canada)");
  const domain = cleanDomain(url);
  if (!domain || !domain.includes(".")) throw httpErr(400, "Plak de link of het domein van de store");
  const c = await redis();
  if (!c) throw httpErr(422, "Redis ontbreekt");
  if (await c.hExists(K.comps, domain)) throw httpErr(409, `${domain} staat al in de lijst`);
  const probe = await probeFeed(domain);
  const entry = {
    domain,
    name: String(name || probe.shopName || domain).trim().slice(0, 80),
    market: m.key,
    visits: parseVisits(visits),
    gender: ["M", "V", "MV"].includes(String(gender || "").toUpperCase()) ? String(gender).toUpperCase() : "auto",
    active: true,
    addedAt: Date.now(),
    currency: probe.currency,
    expected: probe.expected,
    feed: probe.feed,
    feedStatus: probe.status,
  };
  await c.hSet(K.comps, domain, JSON.stringify(entry));
  await pushTimeline([{ kind: probe.feed === "open" ? "competitor" : "fout", market: m.key, domain, text: probe.feed === "open" ? `${entry.name} toegevoegd — feed open${probe.expected ? `, ±${probe.expected.toLocaleString("nl-NL")} producten` : ""}` : `${entry.name} toegevoegd — feed niet bereikbaar${probe.status ? ` (HTTP ${probe.status})` : ""}; de scan probeert het opnieuw` }]);
  return entry;
}
export async function updateCompetitor(domain, patch) {
  const allowed = {};
  if (patch.active != null) allowed.active = !!patch.active;
  if (patch.name != null) allowed.name = String(patch.name).trim().slice(0, 80);
  if (patch.visits != null) allowed.visits = parseVisits(patch.visits);
  if (patch.gender != null) allowed.gender = ["M", "V", "MV"].includes(String(patch.gender).toUpperCase()) ? String(patch.gender).toUpperCase() : "auto";
  if (patch.market != null && bcMarket(patch.market)) allowed.market = bcMarket(patch.market).key;
  const next = await patchCompetitor(domain, allowed);
  if (!next) throw httpErr(404, "Competitor niet gevonden");
  return next;
}
export async function removeCompetitor(domain) {
  const c = await redis();
  if (!c) return;
  const key = cleanDomain(domain);
  await c.hDel(K.comps, key);
  await c.del(K.ids(key));
  await c.del(K.cand(key));
}
/** Geheugen van één competitor wissen: de volgende scan is weer een eerste scan. */
export async function resetCompetitor(domain) {
  const c = await redis();
  if (!c) return;
  const key = cleanDomain(domain);
  await c.del(K.ids(key));
  await c.del(K.cand(key));
  await patchCompetitor(key, { baselineAt: 0, known: 0, queued: 0, lastStatus: "", lastError: "" });
}

async function loadKnown(domain) {
  const c = await redis();
  const raw = await c.get(K.ids(domain));
  return unpackIds(raw);
}
async function saveKnown(domain, set) {
  const c = await redis();
  await c.set(K.ids(domain), packIds(set));
}

/* ======================================================================
   TIJDLIJN · BLADEN · RUNS
   ====================================================================== */
export async function pushTimeline(events) {
  const list = (events || []).filter(Boolean).map((e) => ({ t: Date.now(), ...e, text: String(e.text || "").slice(0, 400) }));
  if (!list.length) return;
  try {
    const cur = await readStrict(K.timeline, []);
    await setJSON(K.timeline, [...list.reverse(), ...cur].slice(0, TIMELINE_MAX));
  } catch (e) {
    console.error("bc timeline:", e.message);
  }
}
export async function getTimeline(limit = 120) {
  return ((await getJSON(K.timeline, [])) || []).slice(0, limit);
}
export async function listTabs(limit = 120) {
  return ((await getJSON(K.tabs, [])) || []).slice(0, limit);
}
async function registerTab(tab) {
  const cur = await readStrict(K.tabs, []);
  await setJSON(K.tabs, [tab, ...cur].slice(0, 400));
}
export async function markTab(id, patch) {
  const cur = await readStrict(K.tabs, []);
  const t = cur.find((x) => x.id === id);
  if (!t) throw httpErr(404, "Blad niet gevonden");
  if (patch.imported != null) {
    t.imported = !!patch.imported;
    t.importedAt = t.imported ? Date.now() : 0;
  }
  await setJSON(K.tabs, cur);
  return t;
}
export async function listRuns(limit = 12) {
  return ((await getJSON(K.runs, [])) || []).slice(0, limit);
}

/* ======================================================================
   DE RUN
   ====================================================================== */
export async function getJob() {
  return getJSON(K.job, null);
}
async function saveJob(job) {
  job.updatedAt = Date.now();
  await setJSON(K.job, job, JOB_TTL);
}
function pushLog(job, text, cls) {
  job.log.push({ t: Date.now(), text: String(text).slice(0, 400), cls: cls || "" });
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
}
export function publicJob(job, prog) {
  if (!job) return null;
  const { cur, ...rest } = job;
  let live = null;
  if (cur) {
    const { cands, ...c } = cur;
    live = { ...c, fresh: (cands || []).length };
    // tussenstand binnen een tick (elke ronde bijgewerkt)
    if (prog && prog.jobId === job.id && prog.domain === cur.domain && prog.at > (job.updatedAt || 0)) live = { ...live, ...prog.cur };
  }
  return { ...rest, cur: live, stale: job.status === "running" && Date.now() - (job.lastTickAt || job.startedAt) > STALE_MS };
}

/**
 * startJob({ markets?, domains?, baseUrl, label })
 */
export async function startJob(opts = {}) {
  if (!bcAvailable()) return { ok: false, error: "Redis ontbreekt — de scan heeft Redis nodig." };
  const existing = await getJob();
  if (existing && existing.status === "running" && Date.now() - (existing.lastTickAt || existing.startedAt) < STALE_MS) {
    return { ok: false, error: "Er draait al een scan — wacht tot hij klaar is of stop hem eerst." };
  }
  const want = (opts.markets || []).map((k) => (bcMarket(k) || {}).key).filter(Boolean);
  const domains = (opts.domains || []).map(cleanDomain).filter(Boolean);
  const comps = (await listCompetitors()).filter((c) => bcMarket(c.market) && (domains.length ? domains.includes(c.domain) : c.active !== false && (!want.length || want.includes(c.market))));
  if (!comps.length) return { ok: false, error: "Geen actieve competitors om te scannen — voeg er eerst één toe." };
  const markets = BC_MARKET_KEYS.filter((k) => comps.some((c) => c.market === k));
  const job = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    status: "running",
    phase: "scan",
    label: opts.label || "Handmatig",
    baseUrl: opts.baseUrl || "",
    startedAt: Date.now(),
    lastTickAt: 0,
    ticks: 0,
    markets,
    queue: comps.map((c) => ({ domain: c.domain, name: c.name || c.domain, market: c.market, status: "wacht" })),
    qi: 0,
    cur: null,
    distIdx: 0,
    dist: {},
    result: {},
    prog: { seen: 0, fresh: 0, placed: 0, tabs: 0 },
    log: [],
    stopRequested: false,
    error: null,
  };
  pushLog(job, `${job.label}: ${comps.length} competitor${comps.length === 1 ? "" : "s"} scannen (${markets.join(", ")})`, "strong");
  await saveJob(job);
  await pushTimeline([{ kind: "start", text: `${job.label === "Nachtscan" ? "Nachtscan" : "Scan"} gestart — ${comps.length} competitor${comps.length === 1 ? "" : "s"} (${markets.join(", ")})` }]);
  return { ok: true, job: publicJob(job) };
}
export async function stopJob() {
  const job = await getJob();
  if (!job) return { ok: false, error: "geen scan gevonden" };
  if (job.status === "running") {
    job.stopRequested = true;
    pushLog(job, "Stop gevraagd — stopt na deze ronde.", "warn");
    await saveJob(job);
  }
  return { ok: true, job: publicJob(job) };
}
export async function resumeJob() {
  const job = await getJob();
  if (!job) return { ok: false, error: "geen scan gevonden" };
  if (job.status === "done") return { ok: false, error: "deze scan is al klaar" };
  job.status = "running";
  job.stopRequested = false;
  job.error = null;
  pushLog(job, "Hervat.", "muted");
  await saveJob(job);
  return { ok: true, job: publicJob(job) };
}
export async function kickTick(job) {
  if (!job || !job.baseUrl) return false;
  try {
    const res = await fetch(`${job.baseUrl}/api/big-competitors/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bc-job-secret": bcJobSecret() },
      body: JSON.stringify({ id: job.id }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (e) {
    console.error("kickTick (big competitors):", e.message);
    return false;
  }
}
/** Loopt er een run die stil is gevallen? Dan opnieuw aanzwengelen (status-poll en waakhond-cron). */
export async function reviveIfStale() {
  const job = await getJob();
  if (job && job.status === "running" && Date.now() - (job.lastTickAt || job.startedAt) > STALE_MS) return kickTick(job);
  return false;
}

/* ---------------- één competitor scannen ---------------- */
async function fetchPage(domain, feed, page) {
  const base = feed === "collections" ? `https://${domain}/collections/all/products.json` : `https://${domain}/products.json`;
  const url = `${base}?limit=250&page=${page}`;
  let r = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetchJson(url, 12000);
    if (r.ok) return r;
    const retryable = !r.status || r.status === 429 || r.status === 430 || r.status >= 500;
    if (!retryable) return r;
    if (attempt === 0) await sleep(1200);
  }
  return r;
}

function trimCands(list, cap) {
  list.sort((a, b) => (b.a || 0) - (a.a || 0));
  if (list.length > cap) list.length = cap;
  return list;
}

/** Werkt aan job.queue[job.qi] tot de tijd op is of de competitor klaar is. */
async function scanStep(job, started, cfg) {
  const q = job.queue[job.qi];
  const comp = await getCompetitor(q.domain);
  if (!comp) {
    q.status = "weg";
    job.qi++;
    job.cur = null;
    return;
  }
  if (!job.cur || job.cur.domain !== q.domain) {
    job.cur = { domain: q.domain, name: comp.name || q.domain, market: q.market, feed: "products", page: 1, seen: 0, known: 0, old: 0, junk: 0, men: 0, women: 0, newest: 0, fails: 0, cands: [], startedAt: Date.now(), expected: comp.expected || comp.total || 0 };
    q.status = "bezig";
    // valuta + verwacht aantal van de store zelf (klein verzoek, mag mislukken)
    const meta = await fetchJson(`https://${q.domain}/meta.json`, 8000);
    if (meta.ok && meta.data) {
      job.cur.currency = String(meta.data.currency || "").toUpperCase();
      if (Number(meta.data.published_products_count) > 0) job.cur.expected = Number(meta.data.published_products_count);
    }
  }
  const cur = job.cur;
  const known = await loadKnown(q.domain);
  const firstScan = !comp.baselineAt;
  const addKnown = [];
  const candIds = new Set(cur.cands.map((x) => x.id));
  const cutoff = Date.now() - cfg.maxAgeDays * 86400000;
  let done = false;
  let error = "";

  while (!job.stopRequested && Date.now() - started < WORK_MS && !done) {
    const pages = [cur.page, cur.page + 1].filter((p) => p <= PAGE_MAX);
    if (!pages.length) {
      done = true;
      cur.partial = true;
      break;
    }
    const results = await Promise.all(pages.map((p) => fetchPage(q.domain, cur.feed, p)));
    let advanced = 0;
    let roundErr = "";
    let switched = false;
    for (const r of results) {
      const products = r.ok && r.data && Array.isArray(r.data.products) ? r.data.products : null;
      // /products.json dicht of leeg op pagina 1 → één keer de collectie-feed proberen
      if (cur.feed === "products" && cur.seen === 0 && (!products || products.length === 0)) {
        cur.feed = "collections";
        switched = true;
        break;
      }
      if (!products) {
        roundErr = r.status ? `HTTP ${r.status}` : String(r.error || "geen antwoord").slice(0, 80);
        break;
      }
      advanced++;
      for (const p of products) {
        cur.seen++;
        const id = Number(p.id);
        if (!id || candIds.has(id)) continue;
        if (cur.seen <= 3000) {
          // geslachtsmix van de store (steekproef) — voor producten zonder "men's"/"women's"
          const t = `${p.title || ""} ${p.product_type || ""}`;
          if (/\bwom[ae]n'?s?\b|\bladies\b/i.test(t)) cur.women++;
          else if (/\bmen'?s?\b|\bmens\b/i.test(t)) cur.men++;
        }
        if (known.has(id)) {
          cur.known++;
          continue;
        }
        const added = addedAtOf(p);
        if (!added || added < cutoff) {
          known.add(id);
          addKnown.push(id);
          cur.old++;
          continue;
        }
        const rec = shapeProduct(p, q.domain);
        const junk = junkReason(rec);
        if (junk) {
          known.add(id);
          addKnown.push(id);
          cur.junk++;
          continue;
        }
        candIds.add(id);
        cur.cands.push(rec);
        if (added > cur.newest) cur.newest = added;
      }
      if (products.length < 250) {
        done = true;
        break;
      }
    }
    if (switched) continue; // zelfde pagina, andere feed
    cur.page += advanced;
    if (roundErr) {
      // twee mislukte rondes achter elkaar = stoppen met deze competitor (rest volgende scan)
      error = roundErr;
      cur.fails++;
      if (cur.fails >= 2) {
        done = true;
        cur.partial = cur.seen > 0;
      } else {
        await sleep(1500);
      }
    } else {
      cur.fails = 0;
    }
    if (cur.cands.length > CAND_CAP * 2) trimCands(cur.cands, CAND_CAP);
    await setJSON(K.prog, { jobId: job.id, domain: q.domain, at: Date.now(), cur: { page: cur.page, seen: cur.seen, known: cur.known, old: cur.old, junk: cur.junk, fresh: cur.cands.length } }, 600).catch(() => {});
    if (!done) await sleep(200);
  }

  // wat we nu als oud/overgeslagen kennen meteen onthouden — ook bij een halve scan
  if (addKnown.length) await saveKnown(q.domain, known);
  if (!done) return; // tijd op: volgende tick gaat verder op cur.page

  trimCands(cur.cands, CAND_CAP);
  const failed = cur.seen === 0;
  const now = Date.now();
  const autoGender = mixGender(cur.men, cur.women);
  await setJSON(K.cand(q.domain), { jobId: job.id, at: now, list: cur.cands }, CAND_TTL);
  await patchCompetitor(q.domain, (old) => ({
    lastScanAt: now,
    lastStatus: failed ? "fout" : cur.partial ? "deels" : "ok",
    lastError: failed ? error || "feed niet bereikbaar" : cur.partial ? error || "niet alle pagina's gelezen" : "",
    feed: failed ? "dicht" : "open",
    total: failed ? old.total || 0 : cur.seen,
    known: known.size,
    queued: cur.cands.length,
    mixM: cur.men,
    mixV: cur.women,
    autoGender,
    currency: cur.currency || old.currency || "",
    expected: cur.expected || old.expected || 0,
    baselineAt: old.baselineAt || (failed ? 0 : now),
    newestAdded: Math.max(old.newestAdded || 0, cur.newest || 0),
  }));
  q.status = failed ? "fout" : cur.partial ? "deels" : "klaar";
  q.seen = cur.seen;
  q.fresh = cur.cands.length;
  q.firstScan = firstScan;
  q.currency = cur.currency || comp.currency || "";
  q.gender = comp.gender && comp.gender !== "auto" ? comp.gender : autoGender;
  q.error = failed ? error || "feed niet bereikbaar" : "";
  job.prog.seen += cur.seen;
  job.prog.fresh += cur.cands.length;
  const nf = cur.cands.length;
  const text = failed
    ? `${comp.name || q.domain}: feed niet bereikbaar (${q.error}) — volgende scan opnieuw`
    : firstScan
      ? `${comp.name || q.domain}: eerste scan — ${cur.seen.toLocaleString("nl-NL")} producten onthouden, ${nf}${nf >= CAND_CAP ? "+" : ""} van de laatste ${cfg.maxAgeDays} dagen`
      : `${comp.name || q.domain} gescand — ${cur.seen.toLocaleString("nl-NL")} producten, ${nf ? `${nf}${nf >= CAND_CAP ? "+" : ""} nieuw` : "niets nieuws"}${cur.partial ? " (niet alle pagina's gelezen)" : ""}`;
  pushLog(job, text, failed ? "err" : nf ? "ok" : "muted");
  await pushTimeline([{ kind: failed ? "fout" : "scan", market: q.market, domain: q.domain, n: nf, text }]);
  job.qi++;
  job.cur = null;
}

/* ---------------- opmaak van een datum-blad ---------------- */
async function formatBcTab(sheetId, tabId, rowCount) {
  const DARK = { red: 0.11, green: 0.1, blue: 0.09 };
  const GOLD = { red: 0.9, green: 0.76, blue: 0.31 };
  const GOLD_TAB = { red: 0.79, green: 0.64, blue: 0.15 };
  const SOFT = { red: 0.99, green: 0.96, blue: 0.86 };
  const cols = BC_HEADER.length;
  const end = rowCount + 1;
  //            A    B    C    D    E   F   G   H   I    J   K    L   M   N   O   P   Q   R    S   T    U    V
  const WIDTHS = [230, 300, 190, 200, 70, 80, 60, 60, 120, 95, 110, 60, 60, 60, 60, 60, 80, 120, 85, 150, 160, 460];
  const width = (i, px) => ({ updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } });
  const hide = (from, to) => ({ updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: from, endIndex: to }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } });
  await spreadsheetBatchUpdate(sheetId, [
    { updateSheetProperties: { properties: { sheetId: tabId, tabColor: GOLD_TAB, gridProperties: { frozenRowCount: 1 } }, fields: "tabColor,gridProperties.frozenRowCount" } },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
        cell: { userEnteredFormat: { backgroundColor: DARK, textFormat: { bold: true, foregroundColor: GOLD, fontSize: 10 }, verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    },
    { updateDimensionProperties: { range: { sheetId: tabId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: end, startColumnIndex: 0, endColumnIndex: cols },
        cell: { userEnteredFormat: { wrapStrategy: "CLIP", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
      },
    },
    // prijs-kolommen Q · R · S licht gekleurd, twee decimalen
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: end, startColumnIndex: 16, endColumnIndex: 18 },
        cell: { userEnteredFormat: { backgroundColor: SOFT, numberFormat: { type: "NUMBER", pattern: "0.00" }, wrapStrategy: "CLIP", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(backgroundColor,numberFormat,wrapStrategy,verticalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: end, startColumnIndex: 18, endColumnIndex: 19 },
        cell: { userEnteredFormat: { backgroundColor: SOFT, wrapStrategy: "CLIP", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(backgroundColor,wrapStrategy,verticalAlignment)",
      },
    },
    ...WIDTHS.map((px, i) => width(i, px)),
    // lege scraper-kolommen (dubbele foto, literal-twijfel, vraag, signalen, foto-cijfer) inklappen
    hide(6, 8),
    hide(11, 16),
    { setBasicFilter: { filter: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: end, startColumnIndex: 0, endColumnIndex: cols } } } },
    { updateCells: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, rows: [{ values: [{ note: "BIG COMPETITORS — nieuw toegevoegde producten van de big competitors, door Attoh Tools verdeeld. Importeren: Importer → Sheet plakken → dit blad. PRIJS (Q) = onze prijs, net onder de concurrent; KORTING % (S) = doorstreepprijs." }] }], fields: "note" } },
  ]);
}

const OVERVIEW_TAB = "Overzicht";
async function appendOverview(sheetId, rows) {
  try {
    const titles = (await getSheetSizes(sheetId)).map((t) => t.title);
    if (!titles.includes(OVERVIEW_TAB)) {
      const made = await addTab(sheetId, OVERVIEW_TAB, { rows: 400, cols: 7 });
      if (made.ok) await updateValues(sheetId, `${a1Tab(OVERVIEW_TAB)}!A1`, [["DATUM", "TIJD", "STORE", "AANTAL", "BLAD", "LINK", "COMPETITORS"]]);
    }
    await appendRows(sheetId, `${a1Tab(OVERVIEW_TAB)}!A1`, rows, "RAW");
  } catch (e) {
    console.error("bc overzicht:", e.message);
  }
}

/* ---------------- één markt verdelen + bladen schrijven ---------------- */
async function distributeMarket(job, market, cfg) {
  const mcfg = cfg.markets[market];
  const minfo = bcMarket(market);
  const state = (job.dist[market] = job.dist[market] || { done: {}, tabs: [] });
  const entries = job.queue.filter((q) => q.market === market && (q.status === "klaar" || q.status === "deels"));
  const byDomain = {};
  let found = 0;
  for (const q of entries) {
    const cand = await getJSON(K.cand(q.domain), null);
    if (!cand || cand.jobId !== job.id || !Array.isArray(cand.list)) continue;
    byDomain[q.domain] = cand.list;
    found += cand.list.length;
  }
  const res = (job.result[market] = { found, picked: 0, placed: 0, queued: 0, unassigned: 0, stores: [], note: "" });
  if (!found) {
    res.note = entries.length ? "niets nieuws" : "geen competitor gescand";
    if (entries.length) await pushTimeline([{ kind: "verdeling", market, n: 0, text: `${minfo.label}: geen nieuwe producten` }]);
    return;
  }
  const stores = await allStores();
  const mine = storesForMarket(stores, market, cfg);
  const { sheetId } = sheetForMarket(stores, market, cfg);
  const picked = roundRobin(byDomain, mcfg.maxPerRun);
  res.picked = picked.length;
  res.queued = found - picked.length;
  if (!mine.length) {
    res.note = "geen stores aangevinkt voor deze markt";
    pushLog(job, `${minfo.label}: ${found} nieuw gevonden, maar er doet geen store mee in deze markt — niets weggeschreven.`, "warn");
    await pushTimeline([{ kind: "fout", market, text: `${minfo.label}: ${found} nieuwe producten, maar geen store aangevinkt — niets klaargezet` }]);
    return;
  }
  // Pythago-cijfers per store (30 dagen) — mag ontbreken
  const perf = {};
  await Promise.all(
    mine.map(async (s) => {
      try {
        const data = await loadPythago("attoh", s.domain);
        perf[s.domain] = perfForStore(s, data);
      } catch {
        perf[s.domain] = { hasData: false, orders: 0, byGarment: {} };
      }
    })
  );
  const compGender = Object.fromEntries(entries.map((q) => [q.domain, q.gender || "MV"]));
  const compCurrency = Object.fromEntries(entries.map((q) => [q.domain, q.currency || ""]));
  const out = distribute({ products: picked, stores: mine, perf, compGender });
  res.unassigned = out.unassigned.length;
  res.stores = mine.map((s) => ({ domain: s.domain, name: s.name, genders: s.genders, count: out.assigned[s.domain].length, pythago: !!(perf[s.domain] && perf[s.domain].hasData), title: "", url: "" }));
  const split = res.stores.map((s) => `${s.name} ${s.count}`).join(" · ");

  if (!sheetId) {
    res.note = "proefscan — geen Competitor Import Sheet gekoppeld";
    pushLog(job, `${minfo.label}: ${picked.length} nieuw → ${split}. Geen sheet gekoppeld: niets weggeschreven, de producten blijven klaarstaan voor de volgende scan.`, "warn");
    await pushTimeline([{ kind: "fout", market, n: picked.length, text: `${minfo.label}: ${picked.length} nieuwe producten (${split}) — koppel eerst de Competitor Import Sheet, dan zet de volgende scan ze klaar` }]);
    return;
  }

  const stamp = amsParts(job.startedAt);
  const placedIds = {}; // domein competitor → ID's die in een blad staan
  const overviewRows = [];
  for (const s of mine) {
    const items = out.assigned[s.domain];
    if (!items.length) continue;
    if (state.done[s.domain]) {
      // blad stond er al (run werd halverwege hervat): wel meetellen en onthouden, niet nog eens schrijven
      const prev = state.tabs.find((t) => t.domain === s.domain);
      const rs = res.stores.find((x) => x.domain === s.domain);
      if (prev && rs) {
        rs.title = prev.title;
        rs.url = prev.url;
      }
      res.placed += items.length;
      for (const it of items) (placedIds[it.p.d] = placedIds[it.p.d] || []).push(it);
      continue;
    }
    const rows = items.map((it) => buildRow(it, { undercut: mcfg.undercut, storeCurrency: minfo.currency, competitorCurrency: compCurrency[it.p.d] || "" }));
    try {
      const existing = (await getSheetSizes(sheetId)).map((t) => t.title);
      const title = tabTitle(stamp.short, s.name, rows.length, existing);
      const made = await addTab(sheetId, title, { rows: rows.length + 1, cols: BC_HEADER.length });
      if (!made.ok) throw new Error(made.error || "blad aanmaken mislukt");
      await updateValues(sheetId, `${a1Tab(title)}!A1`, [BC_HEADER, ...rows]);
      try {
        await formatBcTab(sheetId, made.tabId, rows.length);
      } catch (e) {
        console.error("bc opmaak:", e.message);
      }
      const url = sheetUrl(sheetId, made.tabId);
      const competitors = [...new Set(items.map((it) => it.p.d))];
      const tab = {
        id: `${job.id}-${made.tabId}`,
        market,
        date: stamp.iso,
        short: stamp.short,
        time: amsParts(Date.now()).time,
        store: s.name,
        storeDomain: s.domain,
        title,
        tabId: made.tabId,
        sheetId,
        url,
        count: rows.length,
        currency: minfo.currency,
        competitors,
        createdAt: Date.now(),
        imported: false,
      };
      await registerTab(tab);
      state.done[s.domain] = true;
      state.tabs.push({ title, url, store: s.name, domain: s.domain, count: rows.length });
      for (const it of items) (placedIds[it.p.d] = placedIds[it.p.d] || []).push(it);
      const rs = res.stores.find((x) => x.domain === s.domain);
      rs.title = title;
      rs.url = url;
      res.placed += rows.length;
      job.prog.placed += rows.length;
      job.prog.tabs++;
      overviewRows.push([stamp.iso, tab.time, s.name, rows.length, title, url, competitors.join(", ")]);
      pushLog(job, `Blad "${title}" klaar — ${rows.length} producten`, "ok");
      await pushTimeline([{ kind: "blad", market, n: rows.length, url, text: `Blad "${title}" staat klaar — ${rows.length} producten voor ${s.name}` }]);
      await saveJob(job); // na elk blad: een herstart maakt dit blad niet nog eens
    } catch (e) {
      const msg = String(e.message || e).slice(0, 200);
      pushLog(job, `${s.name}: blad schrijven mislukt (${msg}) — deze producten komen de volgende scan opnieuw.`, "err");
      await pushTimeline([{ kind: "fout", market, text: `${s.name}: blad schrijven mislukt — ${msg}` }]);
    }
  }
  if (overviewRows.length) await appendOverview(sheetId, overviewRows);

  // Geheugen bijwerken: wat in een blad staat (of nergens past) kennen we nu.
  const today = amsParts(Date.now()).iso;
  for (const q of entries) {
    const placed = placedIds[q.domain] || [];
    const nowhere = out.unassigned.filter((u) => u.p.d === q.domain);
    if (placed.length || nowhere.length) {
      const known = await loadKnown(q.domain);
      for (const it of placed) known.add(it.p.id);
      for (const u of nowhere) known.add(u.p.id);
      await saveKnown(q.domain, known);
      const newest = placed.slice().sort((a, b) => (b.p.a || 0) - (a.p.a || 0))[0];
      await patchCompetitor(q.domain, (old) => {
        const daily = { ...(old.daily || {}) };
        if (placed.length) daily[today] = (daily[today] || 0) + placed.length;
        for (const k of Object.keys(daily).sort().slice(0, -21)) delete daily[k];
        return {
          known: known.size,
          queued: Math.max(0, (byDomain[q.domain] || []).length - placed.length - nowhere.length),
          daily,
          ...(placed.length ? { lastNewAt: Date.now(), lastNewCount: placed.length, lastNewTitle: newest ? newest.p.t : "", lastNewAdded: newest ? newest.p.a : 0 } : {}),
        };
      });
    }
    q.placed = placed.length;
  }
  const tail = `${res.queued ? ` · ${res.queued} schuiven door naar de volgende scan` : ""}${res.unassigned ? ` · ${res.unassigned} passen bij geen store` : ""}`;
  pushLog(job, `${minfo.label} verdeeld: ${split}${tail}`, "strong");
  await pushTimeline([{ kind: "verdeling", market, n: res.placed, text: `${minfo.label} verdeeld: ${split}${tail}` }]);
}

async function finish(job) {
  job.status = "done";
  job.phase = "done";
  job.finishedAt = Date.now();
  const p = job.prog;
  const text = p.placed ? `Klaar — ${p.placed} nieuwe producten in ${p.tabs} blad${p.tabs === 1 ? "" : "en"}` : p.fresh ? `Klaar — ${p.fresh} nieuwe producten gevonden, niets weggeschreven` : "Klaar — niets nieuws gevonden";
  pushLog(job, text, "ok");
  await pushTimeline([{ kind: "klaar", n: p.placed, text }]);
  try {
    const runs = await readStrict(K.runs, []);
    runs.unshift({
      id: job.id,
      label: job.label,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      markets: job.markets,
      prog: job.prog,
      competitors: job.queue.map((q) => ({ domain: q.domain, name: q.name, market: q.market, status: q.status, seen: q.seen || 0, fresh: q.fresh || 0, placed: q.placed || 0, error: q.error || "" })),
      result: job.result,
    });
    await setJSON(K.runs, runs.slice(0, 40));
  } catch (e) {
    console.error("bc runs:", e.message);
  }
  await delKey(K.prog);
}

/* ---------------- de tick ---------------- */
export async function tickJob(id) {
  const started = Date.now();
  const tickId = `${started.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  if (!(await acquire(K.lock, tickId, LOCK_TTL))) return { ok: true, busy: true };
  let job = null;
  let chained = false;
  try {
    job = await getJob();
    if (!job || job.status !== "running") return { ok: true, idle: true };
    if (id && job.id !== id) return { ok: true, idle: true };
    job.ticks++;
    job.lastTickAt = started;
    await saveJob(job);
    const cfg = await getCfg();

    while (!job.stopRequested && job.status === "running") {
      if (job.phase === "scan") {
        if (job.qi >= job.queue.length) {
          job.phase = "distribute";
          job.distIdx = 0;
          await saveJob(job);
          continue;
        }
        if (Date.now() - started >= WORK_MS) break;
        await scanStep(job, started, cfg);
        await saveJob(job);
        continue;
      }
      if (job.phase === "distribute") {
        if (job.distIdx >= job.markets.length) {
          await finish(job);
          await saveJob(job);
          break;
        }
        if (Date.now() - started >= DIST_START_MS) break;
        await distributeMarket(job, job.markets[job.distIdx], cfg);
        job.distIdx++;
        await saveJob(job);
        continue;
      }
      break;
    }

    if (job.stopRequested && job.status === "running") {
      job.status = "stopped";
      pushLog(job, "Gestopt.", "warn");
      await pushTimeline([{ kind: "fout", text: "Scan gestopt" }]);
    }
    await saveJob(job);
    if (job.status === "running") chained = await kickTick(job);
    return { ok: true, job: publicJob(job), chained };
  } catch (e) {
    if (job) {
      job.status = "error";
      job.error = String(e.message || e).slice(0, 300);
      pushLog(job, `Fout: ${job.error}`, "err");
      await saveJob(job).catch(() => {});
      await pushTimeline([{ kind: "fout", text: `Scan afgebroken: ${job.error}` }]);
    }
    return { ok: false, error: String(e.message || e) };
  } finally {
    await release(K.lock, tickId);
  }
}

/* ======================================================================
   VOOR DE PAGINA
   ====================================================================== */
/** Volgende nachtrun (cron staat op 01:00 UTC = 02:00 NL in de winter, 03:00 in de zomer). */
function nextNightly() {
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 1, 0, 0));
  if (next.getTime() <= d.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime();
}

export async function bcStatus({ autoResume = true } = {}) {
  const [job, prog, competitors, timeline, tabs] = await Promise.all([getJob(), getJSON(K.prog, null), listCompetitors(), getTimeline(80), listTabs(80)]);
  let kicked = false;
  if (autoResume && job && job.status === "running" && Date.now() - (job.lastTickAt || job.startedAt) > STALE_MS) kicked = await kickTick(job);
  return { ok: true, job: publicJob(job, prog), competitors, timeline, tabs, kicked, now: Date.now() };
}

export async function bcInfo() {
  const [cfg, stores, competitors, timeline, tabs, runs, job, prog] = await Promise.all([getCfg(), allStores(), listCompetitors(), getTimeline(120), listTabs(120), listRuns(12), getJob(), getJSON(K.prog, null)]);
  // Pythago-cijfers van elke store die ergens meedoet: één keer per store, allemaal tegelijk
  const active = stores.filter((s) => BC_MARKET_KEYS.some((k) => storeOn(s, k, cfg.markets[k])));
  const pyth = {};
  await Promise.all(
    active.map(async (s) => {
      try {
        const data = await loadPythago("attoh", s.domain);
        const pf = perfForStore(s, data);
        if ((data && Array.isArray(data.rows)) || pf.switch) {
          pyth[s.domain] = { hasData: pf.hasData, orders: pf.orders, window: pf.window, switch: pf.switch || "", at: (data && data.syncedAt) || "" };
        }
      } catch {}
    })
  );
  const markets = {};
  for (const m of BC_MARKETS) {
    const sheet = sheetForMarket(stores, m.key, cfg);
    const list = [];
    for (const s of stores) {
      const on = storeOn(s, m.key, cfg.markets[m.key]);
      const native = s.extraMarket ? s.extraMarket === m.key : s.market === m.key;
      if (!on && !native) continue; // stores van andere markten staan onder "andere store toevoegen"
      list.push({ domain: s.domain, name: s.name, publicDomain: s.publicDomain, genders: s.genders, on, native, source: s.source, pythago: on ? pyth[s.domain] || null : null });
    }
    markets[m.key] = {
      ...cfg.markets[m.key],
      sheetId: sheet.sheetId,
      sheetSource: sheet.source,
      sheetUrl: sheet.sheetId ? sheetUrl(sheet.sheetId) : "",
      stores: list,
      others: stores.filter((s) => !list.some((x) => x.domain === s.domain)).map((s) => ({ domain: s.domain, name: s.name, genders: s.genders, market: s.extraMarket || s.market })),
    };
  }
  return {
    ok: true,
    cfg: { nightly: cfg.nightly, maxAgeDays: cfg.maxAgeDays },
    markets,
    competitors,
    timeline,
    tabs,
    runs,
    job: publicJob(job, prog),
    serviceAccount: getServiceAccountEmail() || "attoh-sheets@attoh-tools.iam.gserviceaccount.com",
    redis: bcAvailable(),
    nextRun: nextNightly(),
    now: Date.now(),
  };
}
