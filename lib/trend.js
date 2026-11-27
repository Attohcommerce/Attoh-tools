// TREND SCRAPER — AliExpress + Temu (27-11-2026, idee Justin n.a.v. Hanish' winterlijst)
//
// Doel: producten vinden die NU trending zijn op AliExpress en Temu (veel
// verkocht, goede rating), zodat we die via de importer op de stores zetten —
// wat op AliExpress/Temu verkoopt, verkoopt ook via Google Ads.
//
// Werking (basis):
//   1. Zoekopdrachten = een preset (bv. "Winter · Hanish 27-11") of eigen keywords,
//      per bron (aliexpress / temu), gesorteerd op "meest verkocht".
//   2. Per bron start de tool één ASYNCHRONE Apify-run (alle keywords in één run);
//      de UI pollt tot de runs klaar zijn (net als Competitor finder).
//   3. Resultaten worden genormaliseerd naar één vorm, gefilterd (kids, rommel,
//      niet-kleding, te weinig verkocht) en gescoord (trendscore).
//   4. Aangevinkte producten → import-wachtrij (Redis) → Importer, tab "Trending".
//      De importer haalt per product de details (varianten + foto's) op via
//      lib/trend-product.js en gooit foto's met Chinese tekst / maattabellen /
//      collages eruit vóór de upload.
//
// Env:
//   APIFY_TOKEN                — verplicht (staat er al voor Competitor finder / Size Guide)
//   TREND_ALI_SEARCH_ACTOR     — default leoworks~aliexpress-search-scraper
//   TREND_TEMU_SEARCH_ACTOR    — default memo23~temu-scraper
//   TREND_ALI_DETAIL_ACTOR     — default webdatalabs~aliexpress-product-intelligence
//   TREND_TEMU_DETAIL_ACTOR    — default memo23~temu-scraper (productUrls + includeDetails)
// De actor-namen staan in env zodat we zonder code-wijziging kunnen wisselen
// als een actor slechter wordt of duurder; de normalizer leest de gangbare
// veldnamen van alle grote AliExpress/Temu-actors.

import { apifyConfigured, apifyStartRun, apifyRunInfo, apifyDatasetItems } from "./apify.js";
import { getJSON, setJSON, delKey, finderRedisAvailable } from "./finder-redis.js";

export const TREND_SOURCES = {
  aliexpress: { key: "aliexpress", label: "AliExpress", envSearch: "TREND_ALI_SEARCH_ACTOR", defSearch: "leoworks~aliexpress-search-scraper" },
  temu: { key: "temu", label: "Temu", envSearch: "TREND_TEMU_SEARCH_ACTOR", defSearch: "memo23~temu-scraper" },
};

export const TREND_MARKETS = {
  US: { label: "USA", country: "US", currency: "USD" },
  UK: { label: "UK", country: "GB", currency: "GBP" },
  CA: { label: "Canada", country: "CA", currency: "CAD" },
  EU: { label: "Europa", country: "DE", currency: "EUR" },
  AU: { label: "Australië", country: "AU", currency: "AUD" },
};

/* PRESETS — één klik = een hele zoeklijst. Eerste preset = de winterlijst van
   Hanish (GUY Ads, Slack 27-11-2026): thermal layers, winterjassen, schoenen &
   accessoires, loungewear. Per keyword het geslacht (V/M/U = unisex). */
export const TREND_PRESETS = {
  "winter-hanish": {
    label: "Winter · Hanish 27-11 (US/UK/CA/EU)",
    groups: [
      {
        name: "Thermal Layers & Cold-Weather Essentials",
        items: [
          ["fleece lined leggings women", "V"], ["thermal trousers men", "M"], ["thermal base layer set women", "V"], ["thermal base layer set men", "M"],
          ["long sleeve thermal shirt women", "V"], ["heat retaining top women", "V"], ["brushed fleece quarter zip men", "M"], ["heavyweight hoodie men", "M"],
          ["thermal vest women", "V"], ["long sleeve bodysuit women winter", "V"], ["fleece lined tights", "V"], ["leg warmers women", "V"],
        ],
      },
      {
        name: "Everyday Winter Jackets & Outerwear",
        items: [
          ["quilted barn jacket women", "V"], ["quilted barn jacket men", "M"], ["padded utility coat women", "V"], ["oversized field jacket men", "M"],
          ["short puffer jacket women", "V"], ["hooded padded coat men", "M"], ["waxed jacket men", "M"], ["lined shacket women", "V"],
          ["heavyweight overshirt men", "M"], ["belted winter jacket women", "V"], ["faux leather aviator jacket fur lined", "U"], ["sherpa lined coat women", "V"],
          ["longline fleece jacket women", "V"],
        ],
      },
      {
        name: "Practical Footwear & Cold-Weather Accessories",
        items: [
          ["insulated hiking boots women", "V"], ["waterproof winter boots men", "M"], ["mid calf snow boots women", "V"], ["lace up padded ankle boots women", "V"],
          ["fleece lined sneakers women", "V"], ["warm slip on shoes men", "M"], ["touchscreen winter gloves", "U"], ["leather gloves women warm", "V"],
          ["oversized scarf women", "V"], ["knitted balaclava", "U"], ["thermal beanie", "U"], ["earmuffs women", "V"],
        ],
      },
      {
        name: "Winter Comfort, Loungewear & At-Home",
        items: [
          ["fleece lined joggers women", "V"], ["fleece lined joggers men", "M"], ["matching hoodie sweatpants set women", "V"], ["thermal pajama set women", "V"],
          ["brushed cotton pajamas men", "M"], ["sherpa zip up hoodie women", "V"], ["oversized fleece pullover women", "V"], ["knitted lounge set women", "V"],
          ["fleece robe women", "V"], ["warm indoor slippers women", "V"], ["plush tracksuit women", "V"],
        ],
      },
    ],
  },
};

export function presetKeywords(presetKey) {
  const p = TREND_PRESETS[presetKey];
  if (!p) return [];
  const out = [];
  for (const g of p.groups) for (const [kw, gender] of g.items) out.push({ kw, gender, group: g.name });
  return out;
}

/* ---------- filters ---------- */
const KIDS_RE = /\b(kids?|child(ren)?|toddler|baby|babies|infant|boys?|girls?'?s?|newborn|junior|teen)\b/i;
const NON_FASHION_RE = /\b(phone|case|charger|cable|toy|sticker|keychain|tool|kitchen|car |auto|pet|dog|cat|wig|hair extension|lashes|nail|makeup|costume|cosplay|lingerie|sexy|erotic|underwear set|bra set)\b/i;

export function trendJunkReason(it) {
  const t = String(it.title || "");
  if (!t) return "geen titel";
  if (KIDS_RE.test(t)) return "kids/baby";
  if (NON_FASHION_RE.test(t)) return "geen kleding/accessoire";
  if (!it.image) return "geen foto";
  return null;
}

/* ---------- normaliseren ---------- */
function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).toLowerCase().replace(/,/g, "").trim();
  const m = s.match(/([\d.]+)\s*([km])?/);
  if (!m) return 0;
  let n = parseFloat(m[1]) || 0;
  if (m[2] === "k") n *= 1000;
  if (m[2] === "m") n *= 1000000;
  return n;
}
function absUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) return "https:" + s;
  return s;
}
function firstImage(x) {
  const c = x.imageUrl || x.image || x.primaryImage || x.mainImage || x.img || x.thumbnail || (Array.isArray(x.images) && x.images[0]) || (Array.isArray(x.imageUrls) && x.imageUrls[0]);
  return absUrl(typeof c === "object" && c ? c.url || c.src : c);
}

export function normalizeTrendItem(source, x) {
  if (!x || typeof x !== "object" || x.error || x.type === "rank") return null;
  const url = absUrl(x.productUrl || x.url || x.link || x.detailUrl || "");
  const id = String(x.globalProductId || x.productId || x.goodsId || x.goods_id || x.itemId || x.id || "").trim() || (url.match(/(\d{8,20})/) || [])[1] || "";
  if (!url && !id) return null;
  const finalUrl = url || (source === "aliexpress" ? `https://www.aliexpress.com/item/${id}.html` : `https://www.temu.com/goods.html?goods_id=${id}`);
  const sold = num(x.soldCount ?? x.soldQuantity ?? x.sold ?? x.orders ?? x.salesCount ?? x.soldText);
  const rating = num(x.rating ?? x.averageRating ?? x.starRating);
  const reviews = num(x.reviewCount ?? x.reviews ?? x.ratingCount);
  const price = num(x.price ?? x.salePrice ?? x.priceValue);
  return {
    source,
    id,
    url: finalUrl,
    title: String(x.title || x.name || x.productTitle || "").trim(),
    image: firstImage(x),
    price,
    currency: x.currency || "USD",
    sold,
    soldText: x.sold && typeof x.sold === "string" ? x.sold : x.soldText || (sold ? `${sold}+ sold` : ""),
    rating,
    reviews,
    keyword: x.keyword || x.searchKeyword || x.sourceInput || "",
    isAd: !!x.isAd,
  };
}

/* TRENDSCORE 0–100: verkocht (log-schaal, zwaarst), rating, reviews.
   Een product met 10k+ sold en 4,7★ scoort ±90; 50 sold ±30. */
export function trendScore(it) {
  const s = Math.min(1, Math.log10(1 + (it.sold || 0)) / 4.3); // 20k ≈ 1
  const r = it.rating ? Math.max(0, Math.min(1, (it.rating - 3.8) / 1.1)) : 0.4;
  const v = Math.min(1, Math.log10(1 + (it.reviews || 0)) / 3.5);
  return Math.round((s * 0.65 + r * 0.2 + v * 0.15) * 100);
}

/* ---------- Apify-input per bron ---------- */
function searchInput(source, keywords, { perKeyword, market }) {
  const m = TREND_MARKETS[market] || TREND_MARKETS.US;
  if (source === "aliexpress") {
    return {
      keywords,
      maxResultsPerKeyword: perKeyword,
      maxPages: Math.max(1, Math.ceil(perKeyword / 60)),
      sort: "orders",
      country: m.country,
      currency: "USD",
      includeAds: false,
      rankHistoryStore: "",
      maxConcurrency: 4,
      residentialFallback: true,
      proxyConfiguration: { useApifyProxy: true },
    };
  }
  return {
    searchQueries: keywords,
    maxItemsPerSearch: Math.min(100, perKeyword),
    maxItems: Math.min(5000, perKeyword * keywords.length),
    sort: "top_sales",
    minRating: 4,
  };
}

/* ---------- job (Redis) ---------- */
const JOB_KEY = "trend:job";
const RESULTS_KEY = "trend:results";
const QUEUE_KEY = "trend:queue";

export function trendAvailable() {
  return { apify: apifyConfigured(), redis: finderRedisAvailable() };
}

export async function getTrendJob() {
  return getJSON(JOB_KEY, null);
}

/** startTrendJob({ sources, market, preset, keywords:[{kw,gender,group}], perKeyword, minSold }) */
export async function startTrendJob(opts = {}) {
  if (!apifyConfigured()) throw new Error("APIFY_TOKEN ontbreekt in Vercel");
  const sources = (opts.sources || ["aliexpress", "temu"]).filter((s) => TREND_SOURCES[s]);
  if (!sources.length) throw new Error("Kies minimaal één bron");
  let kws = Array.isArray(opts.keywords) && opts.keywords.length ? opts.keywords : presetKeywords(opts.preset || "winter-hanish");
  kws = kws.filter((k) => k && String(k.kw || "").trim()).slice(0, 80);
  if (!kws.length) throw new Error("Geen keywords");
  const perKeyword = Math.max(5, Math.min(60, Number(opts.perKeyword) || 20));
  const market = TREND_MARKETS[opts.market] ? opts.market : "US";
  const runs = [];
  for (const src of sources) {
    const def = TREND_SOURCES[src];
    const actor = process.env[def.envSearch] || def.defSearch;
    const r = await apifyStartRun(actor, searchInput(src, kws.map((k) => k.kw), { perKeyword, market }), { timeoutSecs: 900, memory: 1024 });
    runs.push(r.ok ? { source: src, actor, runId: r.runId, datasetId: r.datasetId, status: r.status || "RUNNING" } : { source: src, actor, error: r.error, status: "FAILED" });
  }
  const job = {
    id: `t${Date.now()}`,
    startedAt: new Date().toISOString(),
    market,
    preset: opts.preset || null,
    perKeyword,
    minSold: Math.max(0, Number(opts.minSold) || 0),
    keywords: kws,
    runs,
    done: false,
  };
  await setJSON(JOB_KEY, job, 60 * 60 * 24 * 3);
  return job;
}

/** Poll alle runs; als alles klaar is: resultaten ophalen, filteren, scoren, opslaan. */
export async function tickTrendJob() {
  const job = await getTrendJob();
  if (!job) return { job: null };
  if (job.done) return { job, results: await getJSON(RESULTS_KEY, null) };
  let allDone = true;
  for (const run of job.runs) {
    if (!run.runId || ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) continue;
    const info = await apifyRunInfo(run.runId);
    if (info.ok) {
      run.status = info.status;
      run.statusMessage = info.statusMessage;
      if (info.datasetId) run.datasetId = info.datasetId;
    }
    if (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) allDone = false;
  }
  if (!allDone) {
    await setJSON(JOB_KEY, job, 60 * 60 * 24 * 3);
    return { job };
  }
  // Alles klaar → verzamelen
  const kwGender = new Map(job.keywords.map((k) => [k.kw.toLowerCase(), k]));
  const items = [];
  const skipped = {};
  const seen = new Set();
  for (const run of job.runs) {
    if (!run.datasetId) continue;
    const d = await apifyDatasetItems(run.datasetId, { limit: 10000 });
    if (!d.ok) {
      run.error = d.error;
      continue;
    }
    run.count = d.items.length;
    for (const raw of d.items) {
      const it = normalizeTrendItem(run.source, raw);
      if (!it) continue;
      const k = `${it.source}:${it.id || it.url}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const junk = trendJunkReason(it) || (job.minSold && it.sold < job.minSold ? `< ${job.minSold} verkocht` : null);
      if (junk) {
        skipped[junk] = (skipped[junk] || 0) + 1;
        continue;
      }
      const meta = kwGender.get(String(it.keyword || "").toLowerCase()) || null;
      it.gender = meta ? meta.gender : "U";
      it.group = meta ? meta.group : "";
      it.score = trendScore(it);
      items.push(it);
    }
  }
  items.sort((a, b) => b.score - a.score || b.sold - a.sold);
  const results = { jobId: job.id, finishedAt: new Date().toISOString(), market: job.market, total: items.length, skipped, items: items.slice(0, 3000) };
  job.done = true;
  job.finishedAt = results.finishedAt;
  await setJSON(RESULTS_KEY, results, 60 * 60 * 24 * 14);
  await setJSON(JOB_KEY, job, 60 * 60 * 24 * 14);
  return { job, results };
}

export async function stopTrendJob() {
  await delKey(JOB_KEY);
  return { ok: true };
}

export async function getTrendResults() {
  return getJSON(RESULTS_KEY, null);
}

/* ---------- import-wachtrij ---------- */
export async function getTrendQueue() {
  return getJSON(QUEUE_KEY, []);
}
/** items: [{url, source, title, keyword, gender, group, image, score}] — dubbele URL's tellen één keer */
export async function addToTrendQueue(items) {
  const q = await getTrendQueue();
  const have = new Set(q.map((x) => x.url));
  let added = 0;
  for (const it of items || []) {
    if (!it || !it.url || have.has(it.url)) continue;
    have.add(it.url);
    q.push({
      url: it.url,
      source: it.source,
      title: it.title || "",
      keyword: it.keyword || "",
      gender: it.gender || "U",
      group: it.group || "",
      image: it.image || "",
      score: it.score || 0,
      sold: it.sold || 0,
      addedAt: new Date().toISOString(),
    });
    added++;
  }
  await setJSON(QUEUE_KEY, q, 60 * 60 * 24 * 30);
  return { added, total: q.length };
}
export async function removeFromTrendQueue(urls) {
  const set = new Set(urls || []);
  const q = (await getTrendQueue()).filter((x) => !set.has(x.url));
  await setJSON(QUEUE_KEY, q, 60 * 60 * 24 * 30);
  return { total: q.length };
}
export async function clearTrendQueue() {
  await delKey(QUEUE_KEY);
  return { total: 0 };
}

/* ---------- trending keywords (voor de Keywords-tool) ----------
   Haalt uit de best scorende titels de terugkerende 2- en 3-woordcombinaties:
   dat zijn de productsoorten die nu verkopen. */
const STOP = new Set("women womens woman men mens man ladies female male for with and the a of in new 2024 2025 2026 autumn fall winter warm casual fashion style plus size thick thickened clothing clothes top quality high".split(" "));
export function trendingKeywords(items, { limit = 60 } = {}) {
  const count = new Map();
  for (const it of (items || []).slice(0, 800)) {
    const words = String(it.title || "")
      .toLowerCase()
      .replace(/[^a-z\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w && w.length > 2);
    const seenHere = new Set();
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const g = words.slice(i, i + n);
        if (STOP.has(g[0]) || STOP.has(g[g.length - 1])) continue;
        const k = g.join(" ");
        if (seenHere.has(k)) continue;
        seenHere.add(k);
        count.set(k, (count.get(k) || 0) + 1 + (it.score || 0) / 100);
      }
    }
  }
  return [...count.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([kw, c]) => ({ kw, weight: Math.round(c * 10) / 10 }));
}
