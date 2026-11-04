// COMPETITOR FINDER (03-11-2026) — Justins wekelijkse competitor research,
// maar dan door de tool:
//   1. per markt zoeken op Google via Apify (countryCode = het land, dus
//      géén VPN nodig) met dezelfde zoekopdrachten die Justin met de hand
//      intikt (categorie-keyword + dropship-stijl producttitel);
//   2. alle winkels uit organisch + advertenties + "Gesponsorde producten"
//      verzamelen, merken/marketplaces/social eruit;
//   3. nieuw t.o.v. de competitor-sheet, de Redis-lijst en het "al gezien"-
//      geheugen → store-audit + dropship-score (lib/dropship-score.js);
//   4. gekozen winkels in de sheet zetten (juiste marktblok) + in de
//      permanente competitor-lijst van de Product Scraper.
// De job zelf (ticks, voortgang) staat in lib/finder-job.js.
import { apifyRunSync, apifyConfigured, apifyStartRun, apifyRunInfo, apifyDatasetItems } from "./apify.js";

export { apifyRunInfo, apifyDatasetItems };
import { getClient, addAiUsage, CHEAP_MODEL, emptyAiUsage } from "./ai.js";
import { getJSON, setJSON, delKey } from "./finder-redis.js";
import { getPool, seedQueries, toQueryText } from "./finder-pool.js";
import { MARKETS, marketByKey, DEFAULT_QUERIES_EN, isEnglishMarket } from "./finder-markets.js";
import { readRange, updateValues, appendRows, getTabIdByTitle, spreadsheetBatchUpdate, listTabs } from "./sheets.js";
import { getStoreList } from "./catalog-cache.js";

export { apifyConfigured };

const SEARCH_ACTOR = process.env.APIFY_SEARCH_ACTOR || "apify~google-search-scraper";

/* ---------------- domeinen ---------------- */

export function cleanDomain(input) {
  let d = String(input || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/:\d+$/, "");
  return d;
}

/* Alles wat nooit een dropship-concurrent is: zoekmachines, social,
   marketplaces, grote retailers en merken, tools. Op domein (eindigt op) —
   dus "amazon.co.uk" valt onder "amazon.". Deze lijst mag groeien; wat
   Justin in de UI "negeert" komt in Redis (cf:seen) en hoeft hier niet. */
const EXCLUDE_HOSTS = `
google. googleadservices. googleusercontent. youtube. youtu.be facebook. fb.com instagram. tiktok. pinterest. reddit. twitter. x.com linkedin. snapchat. threads.net
wikipedia. wikihow. quora. medium. tumblr. blogspot. wordpress. yelp. trustpilot. sitejabber. reviews.io
amazon. ebay. etsy. aliexpress. alibaba. temu. shein. wish. dhgate. taobao. shopee. lazada. rakuten. zalando. bol.com bol.be allegro. otto. ceneo. idealo. kelkoo. pricerunner. prisjakt. heureka. compari. arukereso. emag. olx. marktplaats. vinted. depop. poshmark. mercari. wehkamp. coolblue. fnac. cdiscount. veepee. privalia. galerieslafayette. elcorteingles. lyst. farfetch. ssense. net-a-porter. mytheresa. yoox. zara. hm.com www2.hm.com bershka. pullandbear. stradivarius. massimodutti. mango. uniqlo. asos. boohoo. prettylittlething. missguided. nastygal. nakd. na-kd. shein. romwe. zaful. lulus. revolve. nordstrom. macys. kohls. target. walmart. costco. jcpenney. dillards. bloomingdales. saks. neimanmarcus. anthropologie. urbanoutfitters. freepeople. gap. oldnavy. bananarepublic. jcrew. express. loft. anntaylor. abercrombie. hollister. aeropostale. americaneagle. ae.com forever21. torrid. lanebryant. modcloth. shopbop. bonprix. c-and-a. c-a.com primark. peek-cloppenburg. aboutyou. breuninger. esprit. s-oliver. tomtailor. gerryweber. comma-store. hunkemoller. vero-moda. only.com jackjones. bestseller. next.co.uk next.com marksandspencer. johnlewis. debenhams. houseoffraser. selfridges. harrods. newlook. riverisland. topshop. monsoon. phase-eight. hobbs. whistles. reiss. tedbaker. karenmillen. coast-stores. quiz. dorothyperkins. wallis. evans. matalan. tkmaxx. tjmaxx. marshalls. winners. simons. hudsonsbay. thebay. aritzia. lululemon. roots. canadagoose. nike. adidas. puma. reebok. newbalance. converse. vans. skechers. clarks. ecco. geox. drmartens. timberland. ugg. birkenstock. crocs. hunter. levi. levis. wrangler. lee.com diesel. guess. calvinklein. tommy. ralphlauren. lacoste. hugoboss. armani. gucci. prada. louisvuitton. chanel. dior. burberry. versace. balenciaga. moncler. northface. thenorthface. patagonia. columbia. jackwolfskin. superdry. gant. scotch-soda. g-star. pepejeans. mexx. theiconic. myer. davidjones. cottonon. countryroad. witchery. seed. glassons. kmart. bigw. catch.com.au thewarehouse. farmers. ezibuy. showpo. meshki. princesspolly. hellomolly. petalandpup. beginningboutique. tigermist. whitefoxboutique. peppermayo. dissh. aje. zimmermann. lkbennett. bodenusa. boden. joules. fatface. whitestuff. seasalt. hushhomewear. hush-uk. mintvelvet. jigsaw. oasis. warehousefashion. veromoda. pieces. selected. noisymay. jdsports. footlocker. schuh. office. zalando-lounge. answear. modivo. eobuwie. ccc.eu reserved. mohito. sinsay. cropp. housebrand. orsay. deichmann. van-haren. vanharen. scapino. bristol. ziengs. sacha. manfield. nelson. omoda. durlinger. decathlon. intersport. sportsdirect. sportscheck. defshop. snipes. aboutyou. zalando. vinted. wish. joom. lightinthebox. miniinthebox. banggood. gearbest. dresslily. rosegal. zaful. floryday. noracora. stylewe. justfashionnow. modlily. rotita. chicme. bellelily. newchic. berrylook. yoins. cupshe. halara. lovevery. tiktok. pinterest. yahoo. bing. duckduckgo. apple. microsoft. shopify. myshopify. squarespace. wix. bigcommerce. woocommerce. klaviyo. judge.me loox. trustpilot. similarweb. semrush. ahrefs. statista. glamour. vogue. elle. harpersbazaar. cosmopolitan. refinery29. whowhatwear. buzzfeed. nytimes. theguardian. bbc. cnn. forbes. businessinsider. nbcnews. independent. telegraph. dailymail. mirror. thesun. metro. standard. nu.nl ad.nl nos.nl telegraaf. volkskrant. nrc. rtl. libelle. flair. margriet. linda. grazia. marieclaire. instyle. people. today. goodhousekeeping. realsimple. thespruce. brides. theknot. weddingwire. zola. hitched. bruiloft. pinterest.
`.split(/\s+/).filter(Boolean);

const EXCLUDE_EXACT = new Set(["google.com", "google.nl", "google.co.uk", "google.com.au", "google.ca", "google.de", "google.fr", "google.es"]);

export function isExcludedDomain(domain) {
  const d = cleanDomain(domain);
  if (!d || !d.includes(".")) return true;
  if (EXCLUDE_EXACT.has(d)) return true;
  for (const h of EXCLUDE_HOSTS) {
    if (h.endsWith(".")) {
      // "amazon." → amazon.com, amazon.co.uk, sub.amazon.de
      const base = h.slice(0, -1);
      if (d === base || d.startsWith(base + ".") || d.includes("." + base + ".")) return true;
    } else if (d === h || d.endsWith("." + h)) {
      return true;
    }
  }
  return false;
}

/** Domein uit een resultaat-URL; Google-advertentie-redirects (aclk?adurl=…)
 *  worden uitgepakt. null als er geen bruikbaar domein in zit. */
export function domainFromUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let url;
  try {
    url = new URL(s.startsWith("http") ? s : "https://" + s);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (/(^|\.)google\.|googleadservices\.|googlesyndication\./.test(host)) {
    for (const k of ["adurl", "url", "q", "u"]) {
      const v = url.searchParams.get(k);
      if (v && /^https?:\/\//i.test(v)) return domainFromUrl(v);
    }
    return null;
  }
  return cleanDomain(host);
}

/* ---------------- Apify: Google per land ---------------- */

/**
 * searchGoogle(market, queries, {pages}) → { ok, hits: [{domain, source, title, query, merchant, url}], error, fatal }
 *   source: "organic" | "ad" | "product" (= Gesponsorde producten / shopping)
 */
/* Snelheid van een Apify-run: de Google-scraper schaalt met geheugen en
   maxConcurrency. Op 1 GB (standaard) deed hij ±3,5 s per zoekopdracht, in
   serie → 60 zoekopdrachten = 3,5 min. Met 4 GB + 20 parallel en de
   zoekopdrachten verdeeld over meerdere runs per markt is het ±1 min. */
export const APIFY_RUN_MEMORY_MB = 4096;
export const APIFY_RUN_CONCURRENCY = 20;

/** Apify-input voor één run met alle zoekopdrachten van een markt. */
export function searchInput(market, queries, pages = 1) {
  const m = typeof market === "string" ? marketByKey(market) : market;
  const originals = (queries || []).map((q) => String(q || "").trim()).filter(Boolean);
  const list = [...new Set(originals.map(toQueryText).filter(Boolean))];
  return {
    market: m,
    count: list.length,
    input: {
      queries: list.join("\n"),
      countryCode: m ? m.gl : "us",
      languageCode: m ? m.hl : "en",
      maxPagesPerQuery: Math.max(1, Math.min(3, Number(pages) || 1)),
      resultsPerPage: 10,
      mobileResults: false,
      includeUnfilteredResults: false,
      focusOnPaidAds: true,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
      includeIcons: false,
      maxConcurrency: APIFY_RUN_CONCURRENCY,
      aiOverview: { scrapeFullAiOverview: false },
    },
  };
}

/** Run starten (antwoordt meteen) → { ok, runId, count } | { ok:false, error, fatal } */
export async function startSearchRun(market, queries, opts = {}) {
  const si = searchInput(market, queries, opts.pages);
  if (!si.market) return { ok: false, error: "Onbekende markt", fatal: true };
  if (!si.count) return { ok: false, error: "Geen zoekopdrachten" };
  const memory = Math.max(512, Number(opts.memory) || APIFY_RUN_MEMORY_MB);
  let r = await apifyStartRun(SEARCH_ACTOR, si.input, { timeoutSecs: opts.timeoutSecs || 900, memory });
  // Geheugenlimiet van het Apify-plan bereikt → nog één keer kleiner proberen
  if (!r.ok && memory > 1024 && /memory|limit|exceed/i.test(String(r.error || ""))) {
    r = await apifyStartRun(SEARCH_ACTOR, si.input, { timeoutSecs: opts.timeoutSecs || 900, memory: 1024 });
    if (r.ok) r.memoryFallback = true;
  }
  if (!r.ok) return r;
  return { ok: true, runId: r.runId, datasetId: r.datasetId, count: si.count, memory: r.memoryFallback ? 1024 : memory };
}

/* Zoekopdrachten van een scan verdelen over Apify-runs:
   - per markt meerdere runs van ±QUERIES_PER_RUN zoekopdrachten (parallel),
   - totaal geheugen onder APIFY_MEM_BUDGET_MB (Apify-plan) → bij veel markten
     minder runs per markt en/of minder geheugen per run.
   perMarket = { markt: [zoekopdrachten] } → [{ market, queries, memory }] */
export const APIFY_MEM_BUDGET_MB = 40 * 1024;
export const QUERIES_PER_RUN = 15;
export const MAX_RUNS_PER_MARKET = 4;
export function planSearchRuns(perMarket) {
  const markets = Object.entries(perMarket).filter(([, qs]) => qs && qs.length);
  if (!markets.length) return [];
  const maxRunsTotal = Math.max(markets.length, Math.floor(APIFY_MEM_BUDGET_MB / APIFY_RUN_MEMORY_MB));
  let runsPerMarket = Math.max(1, Math.min(MAX_RUNS_PER_MARKET, Math.floor(maxRunsTotal / markets.length)));
  const plan = [];
  for (const [market, qs] of markets) {
    const n = Math.max(1, Math.min(runsPerMarket, Math.ceil(qs.length / QUERIES_PER_RUN)));
    const size = Math.ceil(qs.length / n);
    for (let i = 0; i < qs.length; i += size) plan.push({ market, queries: qs.slice(i, i + size) });
  }
  const memory = Math.max(1024, Math.min(APIFY_RUN_MEMORY_MB, Math.floor(APIFY_MEM_BUDGET_MB / plan.length / 256) * 256));
  for (const r of plan) r.memory = memory;
  return plan;
}

/* ---------- Maandbezoek (SimilarWeb via Apify) ----------
   TrendTrack heeft geen API; SimilarWeb-cijfers via de Apify-actor
   curious_coder~similarweb-scraper ($0,001–0,003 per domein) geven hetzelfde
   soort schatting. Kleine sites (< ±5.000 bezoek/mnd) hebben bij SimilarWeb
   vaak geen data → dan tellen we 0 = onder de grens. */
export const VISITS_ACTOR = "curious_coder~similarweb-scraper";

export async function startVisitsRun(domains, opts = {}) {
  const list = [...new Set((domains || []).map(cleanDomain).filter(Boolean))];
  if (!list.length) return { ok: false, error: "Geen domeinen" };
  const r = await apifyStartRun(VISITS_ACTOR, { domains: list }, { timeoutSecs: opts.timeoutSecs || 600, memory: 1024 });
  if (!r.ok) return r;
  return { ok: true, runId: r.runId, datasetId: r.datasetId, count: list.length, domains: list };
}

/** Dataset-items van de SimilarWeb-actor → { domein: { visits, months[], rank, noData } } */
export function parseVisitsItems(items) {
  const out = {};
  for (const it of items || []) {
    if (!it || typeof it !== "object") continue;
    const d = cleanDomain(it.domain || it.url || it.site || "");
    if (!d) continue;
    let v = Number(it.visits);
    let months = [];
    const emv = it.estimatedMonthlyVisits;
    if (emv && typeof emv === "object") {
      const keys = Object.keys(emv).sort();
      months = keys.slice(-3).map((k) => Math.round(Number(emv[k]) || 0));
      if (!(v > 0)) v = months[months.length - 1] || 0;
    }
    const visits = Math.round(v > 0 ? v : 0);
    out[d] = { visits, months, rank: it.globalRank != null && it.globalRank !== "" ? Number(it.globalRank) : null, noData: !(visits > 0) };
  }
  return out;
}

/** Dataset-items (één per zoekpagina) → hits/unresolved — zelfde parser als searchGoogle. */
export function parseSearchItems(items) {
  const hits = [];
  let unresolved = 0;
  const unresolvedNames = new Map();
  for (const item of items || []) {
    const q = (item.searchQuery && (item.searchQuery.term || item.searchQuery.query)) || "";
    const push = (source, arr) => {
      for (const x of arr || []) {
        const url = x.url || x.link || x.displayedUrl || "";
        const domain = domainFromUrl(url) || domainFromUrl(x.displayedUrl || "");
        const merchant = String(x.source || x.merchant || x.seller || x.shop || x.store || "").trim();
        if (!domain) {
          if (source === "product") {
            unresolved++;
            if (merchant && merchant.length <= 60) unresolvedNames.set(merchant, (unresolvedNames.get(merchant) || 0) + 1);
          }
          continue;
        }
        hits.push({ domain, source, title: String(x.title || "").slice(0, 140), query: q, merchant, url: String(url).slice(0, 300) });
      }
    };
    push("organic", item.organicResults);
    push("ad", item.paidResults);
    push("product", item.paidProducts);
  }
  return { hits, pages: (items || []).length, unresolved, unresolvedNames: [...unresolvedNames.entries()] };
}

export async function searchGoogle(market, queries, opts = {}) {
  const m = typeof market === "string" ? marketByKey(market) : market;
  if (!m) return { ok: false, error: "Onbekende markt", fatal: true };
  const si = searchInput(m, queries, opts.pages);
  if (!si.count) return { ok: true, hits: [], pages: 0 };
  const input = si.input;
  const list = input.queries.split("\n");
  const pages = input.maxPagesPerQuery;
  const timeoutSecs = Math.max(20, Math.min(280, Number(opts.timeoutSecs) || 40 + list.length * pages * 12));
  const r = await apifyRunSync(SEARCH_ACTOR, input, { timeoutSecs, limit: list.length * pages + 5 });
  if (!r.ok) return { ok: false, error: r.error, fatal: !!r.fatal };
  return { ok: true, ...parseSearchItems(r.items) };
}


/* Justins eigen stores (en die van Sa Collective) nooit als concurrent tonen.
   Aan te vullen via Instellingen → "Eigen stores" (cfg.ownStores, komma's). */
export const OWN_STORES_DEFAULT = [
  "soulsocietyboutique.com", "ladyglamboutique.com", "evermanclothing.com", "shapeswardrobe.com", "cloveandcloth.com", "lilyandluce.com",
  "emilyneill.com", "alessandramariano.com", "juliaraven.com", "dunhill-lily.com", "clarajames.co.uk", "clararosevancouver.com",
  "evelyngracelondon.co.uk",
];
export function ownStoreSet(cfg) {
  const extra = String((cfg && cfg.ownStores) || "").split(/[,\s]+/).map(cleanDomain).filter(Boolean);
  return new Set([...OWN_STORES_DEFAULT, ...extra]);
}

/* ---------------- zoekopdrachten per markt ---------------- */

const kwKey = (marketKey) => `cf:kw:v1:${String(marketKey || "").toUpperCase()}`;

/** Zoekopdrachten van een markt, in deze volgorde:
 *    1. handmatig opgeslagen set (cf:kw) — alleen als Justin zelf iets invulde
 *    2. de pool (cf:pool) — titels van de beste sheet-stores + startset
 *    3. de startset uit de code (lib/finder-queries.js + Engelse standaard)
 *  Een pool wordt hier NIET gebouwd (dat doet de scan zelf); dit is voor de
 *  UI en voor startJob. */
export async function getMarketQueries(marketKey) {
  const m = marketByKey(marketKey);
  if (!m) return { queries: [], source: "none" };
  const saved = await getJSON(kwKey(m.key));
  if (saved && Array.isArray(saved.queries) && saved.queries.length) return { queries: saved.queries, source: saved.source || "handmatig", at: saved.at || 0, override: true };
  const pool = await getPool(m.key);
  if (pool && Array.isArray(pool.titles) && pool.titles.length) return { queries: pool.titles, source: pool.source || "pool", at: pool.at || 0, stores: pool.stores || [] };
  const seed = seedQueries(m.key);
  return { queries: seed, source: "startset" };
}

export async function clearMarketQueries(marketKey) {
  const m = marketByKey(marketKey);
  if (!m) throw new Error("Onbekende markt");
  await delKey(kwKey(m.key));
  return true;
}

export async function setMarketQueries(marketKey, queries, source = "handmatig") {
  const m = marketByKey(marketKey);
  if (!m) throw new Error("Onbekende markt");
  const list = [...new Set((queries || []).map((q) => String(q || "").trim()).filter(Boolean))].slice(0, 200);
  await setJSON(kwKey(m.key), { queries: list, source, at: Date.now() });
  return list;
}

/** AI: de Engelse standaardset omzetten naar hoe LOKALE dropshippers hun
 *  titels schrijven (geen woordenboekvertaling). Eén call per markt;
 *  resultaat wordt opgeslagen en is daarna in de UI aan te passen. */
export async function localizeQueries(marketKey, baseQueries) {
  const m = marketByKey(marketKey);
  if (!m) throw new Error("Onbekende markt");
  const base = (baseQueries && baseQueries.length ? baseQueries : DEFAULT_QUERIES_EN).slice(0, 120);
  const ai = emptyAiUsage();
  const list = base.map((q, i) => `${i}: ${q}`).join("\n");
  const res = await getClient().messages.create({
    model: CHEAP_MODEL,
    max_tokens: 4000,
    system: `You localize Google search queries used to find dropshipping fashion webshops in ${m.lang}.
Each input line is either a short category keyword ("women's cocktail dress") or a product title in the attribute style dropshippers use ("Women's Cocktail Dress | Square Neck Corset Bodycon Mini").
Rules:
- Write each one the way a LOCAL Shopify dropshipping store in ${m.lang} would write it in a product title or a shopper would type it in Google. Not a dictionary translation.
- Keep English loanwords locals actually use (jeans, hoodie, blazer, oversized, bodycon, loafers…).
- Keep the "Type | attribute attribute attribute" structure for the title-style lines; keep the gender word if the language uses one.
- Keep the same order and count. One output per input line.
Return ONLY JSON: {"map": {"0": "…", "1": "…", …}} keyed by index.`,
    messages: [{ role: "user", content: list }],
  });
  addAiUsage(ai, CHEAP_MODEL, res);
  const text = res.content.map((c) => c.text || "").join("");
  let out = {};
  try {
    const mm = text.match(/\{[\s\S]*\}/);
    out = mm ? JSON.parse(mm[0]) : {};
  } catch {
    out = {};
  }
  const result = [];
  for (let i = 0; i < base.length; i++) {
    const v = out.map && out.map[String(i)];
    if (v && String(v).trim()) result.push(String(v).trim());
  }
  if (result.length < Math.min(10, base.length)) throw new Error("AI-lokalisatie gaf te weinig regels terug — probeer opnieuw");
  const saved = await setMarketQueries(m.key, result, "ai");
  return { queries: saved, ai };
}

/* ---------------- instellingen + "al gezien" ---------------- */

const CFG_KEY = "cf:cfg:v1";
const SEEN_KEY = "cf:seen:v1"; // domein → { verdict, score, at, note, products, ignored }

export const DEFAULT_CFG = {
  minVisits: 8000,
  pages: 1,
  queriesPerMarket: 60, // per scan; de pool roteert, dus elke week andere titels
  aliCheck: true,
  weekly: true, // elke maandag automatisch (Vercel-cron → /api/competitor-finder/cron)
  weeklyMarkets: "USA,UK,AUS,CANADA,NL/BE,FR,PL",
  ownStores: "", // extra eigen domeinen, komma-gescheiden
  sheetId: "1oZ_F0JktM0uuICiZIAO_ZaVCbentEvUpiDjEtivsKe4",
  sheetTab: "Google competitors",
};

export async function getConfig() {
  const c = (await getJSON(CFG_KEY)) || {};
  return { ...DEFAULT_CFG, ...c };
}
export async function setConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULT_CFG)) continue;
    if (v === undefined || v === null) continue;
    if (v === "" && typeof DEFAULT_CFG[k] !== "string") continue;
    next[k] = typeof DEFAULT_CFG[k] === "number" ? Number(v) || DEFAULT_CFG[k] : typeof DEFAULT_CFG[k] === "boolean" ? !!v : String(v);
  }
  await setJSON(CFG_KEY, next);
  return next;
}

export async function getSeen() {
  return (await getJSON(SEEN_KEY)) || {};
}
export async function markSeen(patch) {
  const cur = await getSeen();
  for (const [d, v] of Object.entries(patch || {})) {
    const k = cleanDomain(d);
    if (!k) continue;
    cur[k] = { ...(cur[k] || {}), ...v, at: Date.now() };
  }
  // nooit eindeloos groeien: oudste eruit boven 20.000
  const keys = Object.keys(cur);
  if (keys.length > 20000) {
    keys.sort((a, b) => (cur[a].at || 0) - (cur[b].at || 0));
    for (const k of keys.slice(0, keys.length - 20000)) delete cur[k];
  }
  await setJSON(SEEN_KEY, cur);
  return cur;
}

/* ---------------- competitor-sheet: lezen + schrijven ---------------- */

const DOMAIN_RE = /^(https?:\/\/)?(www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i;

/** Alle domeinen die al in de sheet staan — ÁLLE tabbladen (ook de ruwe
 *  lijst en "Google Stores (nieuw …)"), zodat niets dubbel gevonden wordt. */
export async function readSheetDomains(sheetId, tab) {
  let tabs = [];
  try {
    tabs = (await listTabs(sheetId)).map((t) => t.title);
  } catch {
    tabs = [tab];
  }
  if (tab && !tabs.includes(tab)) tabs.unshift(tab);
  const set = new Set();
  for (const title of tabs) {
    let values = [];
    try {
      values = (await readRange(sheetId, `'${String(title).replace(/'/g, "''")}'!A1:H2000`)) || [];
    } catch {
      continue;
    }
    for (const row of values) {
      for (const c of row || []) {
        const s = String(c || "").trim();
        if (!s || s.length > 1200 || !DOMAIN_RE.test(s)) continue;
        const d = cleanDomain(s);
        if (d && !/(^|\.)google\.|docs\.|sheets\./.test(d)) set.add(d);
      }
    }
  }
  return set;
}

/** Alles wat we al kennen: sheet + Redis-lijst van de scraper + "al gezien". */
export async function knownDomains(sheetId, tab) {
  const known = new Map(); // domein → bron
  try {
    for (const d of await readSheetDomains(sheetId, tab)) known.set(d, "sheet");
  } catch (e) {
    throw new Error(`Competitor-sheet lezen mislukt: ${String(e.message || e)}`);
  }
  for (const d of (await getStoreList()) || []) if (!known.has(d)) known.set(cleanDomain(d), "lijst");
  const seen = await getSeen();
  for (const [d, v] of Object.entries(seen)) if (!known.has(d)) known.set(d, v.ignored ? "genegeerd" : "gezien");
  return known;
}

/* Blokken in de dashboard-tab: een rij met alleen het marktlabel in A
   ("USA", "NL/BE"), daaronder een stats-regel, daaronder de kopregel
   "COMPETITORS …", daaronder de rijen. Lege voorgevulde rijen hebben
   B = "Google" en C = markt, maar geen link in D. */
export function parseBlocks(values) {
  const blocks = [];
  const labels = new Set(MARKETS.map((m) => m.key.toUpperCase()));
  for (let i = 0; i < values.length; i++) {
    const a = String((values[i] || [])[0] || "").trim();
    const rest = (values[i] || []).slice(1, 7).map((c) => String(c || "").trim()).filter(Boolean);
    if (a && !rest.length && labels.has(a.toUpperCase())) {
      blocks.push({ market: a.toUpperCase(), titleRow: i, headerRow: -1, start: -1, end: -1 });
    }
  }
  for (let b = 0; b < blocks.length; b++) {
    const blk = blocks[b];
    const limit = b + 1 < blocks.length ? blocks[b + 1].titleRow : values.length;
    for (let i = blk.titleRow + 1; i < Math.min(limit, blk.titleRow + 6); i++) {
      if (/^competitors$/i.test(String((values[i] || [])[0] || "").trim())) {
        blk.headerRow = i;
        break;
      }
    }
    blk.start = blk.headerRow >= 0 ? blk.headerRow + 1 : blk.titleRow + 1;
    blk.end = limit; // exclusief
  }
  return blocks;
}

function sheetMarketLabel(marketKey) {
  const m = marketByKey(marketKey);
  return m ? m.key : String(marketKey || "").toUpperCase();
}

/**
 * writeToSheet(sheetId, tab, rows) — rows: [{domain, market, name, products, visits, note}]
 *  → per markt in het juiste blok: eerst lege voorgevulde rijen vullen, dan
 *    rijen invoegen (alleen kolommen A:G schuiven — de hulptabel rechts
 *    blijft staan), bestaat het blok niet → nieuw blok onderaan.
 */
export async function writeToSheet(sheetId, tab, rows) {
  const tabName = String(tab || "Google competitors");
  const a1 = `'${tabName.replace(/'/g, "''")}'`;
  const values = (await readRange(sheetId, `${a1}!A1:G2000`)) || [];
  const tabId = await getTabIdByTitle(sheetId, tabName);
  if (tabId == null) throw new Error(`Tabblad "${tabName}" niet gevonden`);
  const byMarket = new Map();
  for (const r of rows) {
    const mk = sheetMarketLabel(r.market);
    if (!byMarket.has(mk)) byMarket.set(mk, []);
    byMarket.get(mk).push(r);
  }
  const written = [];
  const fmt = (r) => [
    String(r.name || r.domain.split(".")[0]),
    "Google",
    sheetMarketLabel(r.market),
    r.domain,
    r.products != null && r.products !== "" ? Number(r.products) : "",
    r.visits != null && r.visits !== "" ? Number(r.visits) : "",
    String(r.note || ""),
  ];

  // Opnieuw inlezen na elke markt, omdat invoegen de rijen verschuift.
  for (const [mk, list] of byMarket) {
    const cur = (await readRange(sheetId, `${a1}!A1:G2000`)) || [];
    const blocks = parseBlocks(cur);
    const blk = blocks.find((b) => b.market === mk);
    if (!blk) {
      // nieuw blok onderaan: lege regel, titel, stats-regel, kopregel, rijen
      const header = ["COMPETITORS", "Platform", "Country", "WEBSHOP LINK", "PRODUCTS", "Monthly visits", "Opmerkingen"];
      const out = [[""], [mk], [`${list.length} stores · finder`], header, ...list.map(fmt)];
      await appendRows(sheetId, `${a1}!A:G`, out, "RAW");
      written.push(...list.map((r) => r.domain));
      continue;
    }
    // lege voorgevulde rijen binnen het blok (geen link in D en geen naam/producten)
    const empties = [];
    for (let i = blk.start; i < blk.end; i++) {
      const row = cur[i] || [];
      const a = String(row[0] || "").trim();
      const d = String(row[3] || "").trim();
      const e = String(row[4] || "").trim();
      const f = String(row[5] || "").trim();
      const isTitleOfNext = a && !d && MARKETS.some((m) => m.key.toUpperCase() === a.toUpperCase());
      if (isTitleOfNext) break;
      if (!d && !e && !f && (!a || /^google$/i.test(a))) empties.push(i);
    }
    // laatste gevulde rij in het blok (om achter in te voegen)
    let lastFilled = blk.start - 1;
    for (let i = blk.start; i < blk.end; i++) {
      const row = cur[i] || [];
      if (String(row[3] || "").trim()) lastFilled = i;
    }
    const queue = [...list];
    const updates = [];
    while (queue.length && empties.length) {
      const i = empties.shift();
      const r = queue.shift();
      updates.push({ range: `${a1}!A${i + 1}:G${i + 1}`, values: [fmt(r)] });
      written.push(r.domain);
    }
    for (const u of updates) await updateValues(sheetId, u.range, u.values);
    if (queue.length) {
      const insertAt = lastFilled + 1; // 0-based rij waar de nieuwe rijen komen
      await spreadsheetBatchUpdate(sheetId, [
        {
          insertRange: {
            range: { sheetId: tabId, startRowIndex: insertAt, endRowIndex: insertAt + queue.length, startColumnIndex: 0, endColumnIndex: 7 },
            shiftDimension: "ROWS",
          },
        },
      ]);
      await updateValues(sheetId, `${a1}!A${insertAt + 1}:G${insertAt + queue.length}`, queue.map(fmt));
      written.push(...queue.map((r) => r.domain));
    }
  }
  return { ok: true, written };
}
