// SIZE GUIDE — server-kant van één product: bronnen afgaan → tabel → bouwen.
// Gedeeld door /api/size-guide/build (batch), de handmatige AliExpress-URL-
// route en de screenshot-route. Geen Shopify-writes hier (dat doet /write).
//
// Volgorde per product (eerste bruikbare tabel wint; alles wordt getoetst
// aan de websitematen — rijen = precies de variantmaten):
//   0. handmatige AliExpress-URL/ID (review-UI)                      → "aliexpress"
//   1. eigen productfoto die een maattabel is (bestandsnaam/alt)      → "source"
//   2. bron-store (concurrent waar het product vandaan komt):
//      HTML-tabel of maattabel-afbeelding in diens omschrijving/foto's → "source"
//   3. AliExpress: cache/zoeken op foto → maattabel-pagina
//      (direct → residential proxy → echte browser in Apify)          → "aliexpress"
//   4. vangnet: soort-specifieke standaardtabel                         → "standard"
import { fetchSizeChart, fetchSizeChartFromLink, resolveAliProductId, parseAliProductId } from "./aliexpress.js";
import { browserFetchConfigured } from "./apify-browser.js";
import { searchByImage, imageSearchConfigured } from "./imagesearch.js";
import { pickMatch, readSizeChartImage } from "./sizeguide-ai.js";
import { normalizeChart, buildGuide, standardGuide } from "./sizeguide.js";
import { getCachedMatch, setCachedMatch } from "./sizeguide-cache.js";
import { findSourceProducts, sourceChartCandidates, readChartImage, chartFromOwnImages } from "./sourcestore.js";
import { emptyAiUsage } from "./ai.js";

const MIN_CONFIDENCE = 0.8;

function mergeAi(acc, ai) {
  if (!ai) return acc;
  for (const k of Object.keys(acc)) acc[k] += ai[k] || 0;
  return acc;
}

/**
 * findAliProduct({domain, item, useSearch, force}) → { pid, confidence, title, via, reason, ai } | { pid:null, link?, reason }
 *   via: "manual" | "cache" | "search"
 *   Zonder pid maar mét `link`: versleutelde link die alleen een echte browser kan volgen.
 */
export async function findAliProduct({ domain, item, aliInput, useSearch = true, force = false }) {
  const ai = emptyAiUsage();
  // 1. Handmatig aangeleverd (URL/ID uit de review-UI)
  if (aliInput) {
    const raw = String(aliInput).trim();
    let pid = null;
    if (/^\d{8,20}$/.test(raw) || /aliexpress\.[a-z]+\/(item|i)\/\d/.test(raw)) {
      pid = parseAliProductId(raw);
    } else {
      const r = await resolveAliProductId(raw); // affiliate/share-link → volgen
      if (r.ok) pid = r.pid;
      if (!pid && /^https?:\/\//i.test(raw)) return { pid: null, link: raw, confidence: 1, title: "", via: "manual", reason: "handmatig (link via browser volgen)", ai };
    }
    if (!pid) return { pid: null, reason: "geen AliExpress product-ID in deze URL/tekst", ai };
    await setCachedMatch(domain, item.id, { pid, confidence: 1, title: "", via: "manual" });
    return { pid, confidence: 1, title: "", via: "manual", reason: "handmatig", ai };
  }
  // 2. Cache
  if (!force) {
    const c = await getCachedMatch(domain, item.id);
    if (c && c.pid) return { ...c, via: "cache", reason: c.reason || "uit cache", ai };
    if (c && c.pid === null && c.noMatch) return { pid: null, reason: "eerder geen match gevonden (cache)", via: "cache", ai };
  }
  if (!useSearch) return { pid: null, reason: "zoeken uitgeschakeld", ai };
  if (!imageSearchConfigured()) return { pid: null, reason: "APIFY_TOKEN ontbreekt — image-search staat uit", ai };
  if (!item.image) return { pid: null, reason: "product heeft geen foto", ai };

  // 3. Search-by-image + AI-keuze
  const s = await searchByImage(item.image, { limit: 6 });
  if (!s.ok) return { pid: null, reason: s.error, fatal: !!s.fatal, ai };
  const cands = s.candidates || [];
  if (!cands.length) return { pid: null, reason: "image-search gaf geen resultaten", ai };

  const pick = await pickMatch({ ourImages: item.images && item.images.length ? item.images : [item.image], ourTitle: item.title, candidates: cands });
  mergeAi(ai, pick.ai);
  if (pick.index < 0 || pick.confidence < MIN_CONFIDENCE) {
    await setCachedMatch(domain, item.id, { pid: null, noMatch: true, reason: pick.reason });
    return { pid: null, reason: `geen betrouwbare match (${pick.confidence.toFixed(2)}): ${pick.reason}`, candidates: cands.slice(0, 3), ai };
  }
  const cand = cands[pick.index];
  let pid = cand.pid;
  let resolveErr = "";
  if (!pid && cand.link) {
    const r = await resolveAliProductId(cand.link);
    if (r.ok) pid = r.pid;
    else resolveErr = r.error || "";
  }
  if (!pid) {
    // Versleutelde link (imagesearchaliexpress.com/product?token=…): server-side
    // niet te volgen → de browser-route neemt 'm mee (link + confidence terug).
    return {
      pid: null,
      link: cand.link || null,
      confidence: pick.confidence,
      title: cand.title || "",
      pickReason: pick.reason,
      reason: `kandidaat gevonden maar geen product-ID uit de link te halen${resolveErr ? ` — ${resolveErr}` : ""}`,
      candidates: [cand],
      ai,
    };
  }
  const hit = { pid, confidence: pick.confidence, title: cand.title || "", via: "search", reason: pick.reason };
  await setCachedMatch(domain, item.id, hit);
  return { ...hit, ai };
}

/** chart + bron → resultaat (of null als de tabel niet op de websitematen past) */
function tryBuild(base, { chart, item, market, source, confidence, via, matchInfo }) {
  const norm = normalizeChart({ headers: chart.headers, rows: chart.rows, unitHint: chart.unitHint });
  const b = buildGuide({ chart: norm, product: item, market, source, confidence });
  const chartInfo = { headers: chart.headers, rows: chart.rows, unit: norm.unit, via };
  if (!b.ok) return { ok: false, reason: b.reason, missing: b.missing || [], chart: chartInfo };
  // Cijfer te laag (verkeerde kolommen voor de soort, te weinig maten) → volgende bron
  if (b.verdict === "red") return { ok: false, reason: `cijfer ${b.score}/10 — ${(b.issues || []).join("; ") || "te weinig bruikbare maten"}`, missing: b.missing || [], chart: chartInfo, issues: b.issues };
  return {
    ...base,
    ok: true,
    verdict: b.verdict,
    score: b.score,
    guide: b.guide,
    source,
    issues: b.issues,
    missing: b.missing,
    mode: b.mode,
    chart: chartInfo,
    match: matchInfo,
  };
}

/**
 * buildForProduct({domain, item, market, aliInput, useSearch, useSource, sourceDomains, force, fallbackStandard, deadline})
 * → { id, ok, verdict, score, guide, source, match, issues, missing, reason, tried[], ai }
 *   item = productSummary() (id, title, family, gender, sizes, image, images, imageKeys, skus, chartImages)
 */
export async function buildForProduct({
  domain,
  item,
  market,
  aliInput = null,
  useSearch = true,
  useSource = true,
  sourceDomains = [],
  force = false,
  fallbackStandard = true,
  deadline = null,
}) {
  const ai = emptyAiUsage();
  const base = { id: item.id, title: item.title, sizes: item.sizes };
  const tried = []; // korte regels voor het log: wat is geprobeerd en waarom het niet doorging
  if (!item.sizes || !item.sizes.length) {
    return { ...base, ok: false, verdict: "none", reason: "geen maten (geen Size-optie / alleen Default Title)", ai };
  }
  const timeLeft = () => (deadline ? deadline - Date.now() : 60000);
  let result = null;
  let lastRed = null;

  /* ---- 0. handmatig: alleen AliExpress ---- */
  if (aliInput) {
    const m = await findAliProduct({ domain, item, aliInput, useSearch: false, force: true });
    mergeAi(ai, m.ai);
    const c = m.pid ? await fetchSizeChart(m.pid, { deadline }) : m.link ? await fetchSizeChartFromLink(m.link, { deadline }) : { ok: false, error: m.reason };
    if (c.ok) {
      if (!m.pid && c.pid) await setCachedMatch(domain, item.id, { pid: c.pid, confidence: 1, title: "", via: "manual" });
      const r = tryBuild(base, { chart: c, item, market, source: "aliexpress", confidence: 1, via: c.via, matchInfo: { pid: m.pid || c.pid, confidence: 1, title: "", via: "manual", reason: "handmatig" } });
      if (r.ok) return { ...r, tried, ai };
      lastRed = { ...base, ok: false, verdict: "red", reason: r.reason, missing: r.missing, chart: r.chart };
    } else {
      lastRed = { ...base, ok: false, verdict: "red", reason: c.blocked ? `AliExpress geblokkeerd (${c.error})` : c.error, blocked: !!c.blocked, fatal: !!c.fatal };
    }
    lastRed.match = { pid: m.pid || null, confidence: 1, title: "", via: "manual", reason: "handmatig" };
    return { ...lastRed, tried, ai };
  }

  /* ---- 1. eigen foto die een maattabel is ---- */
  if (useSource && item.chartImages && item.chartImages.length) {
    const o = await chartFromOwnImages(item);
    mergeAi(ai, o.ai);
    if (o.ok) {
      const r = tryBuild(base, { chart: o.chart, item, market, source: "source", confidence: 0.9, via: "own-image", matchInfo: { via: "own-image", confidence: 0.9, reason: "eigen maattabel-foto", url: o.imageUrl } });
      if (r.ok) return { ...r, tried, ai };
      tried.push(`eigen foto: ${r.reason}`);
    } else tried.push(`eigen foto: ${o.reason}`);
  }

  /* ---- 2. bron-store (concurrent) ---- */
  if (useSource && sourceDomains && sourceDomains.length && timeLeft() > 12000) {
    const f = await findSourceProducts(item, sourceDomains, { maxCandidates: 3 });
    if (!f.candidates.length) {
      tried.push(f.indexed ? `bron-store: geen bronproduct herkend in ${f.indexed} geïndexeerde stores` : "bron-store: geen store-index (eerst indexeren)");
    }
    let imagesRead = 0;
    for (const cand of f.candidates) {
      if (timeLeft() < 12000) break;
      const c = await sourceChartCandidates(cand.domain, cand.handle);
      if (!c.ok) {
        tried.push(`bron ${cand.domain}: ${c.reason}`);
        continue;
      }
      const why = [];
      // a. HTML-tabellen (omschrijving + productpagina), beste eerst — de eerste die op de websitematen past wint
      for (const t of c.tables) {
        const r = tryBuild(base, {
          chart: t,
          item,
          market,
          source: "source",
          confidence: 1,
          via: "source-table",
          matchInfo: { via: "source", confidence: 1, reason: `${cand.domain} (${cand.how}, tabel op ${t.where})`, url: cand.url },
        });
        if (r.ok) return { ...r, tried, ai };
        why.push(`tabel ${t.where}: ${r.reason}`);
        lastRed = { ...base, ok: false, verdict: "red", reason: r.reason, missing: r.missing, chart: r.chart, match: { via: "source", url: cand.url } };
      }
      // b. Afbeeldingen (AI leest) — max 4 per product in totaal
      for (const url of c.images) {
        if (imagesRead >= 4 || timeLeft() < 10000) break;
        imagesRead++;
        const ri = await readChartImage(url);
        mergeAi(ai, ri.ai);
        if (!ri.ok) continue;
        const r = tryBuild(base, {
          chart: ri.chart,
          item,
          market,
          source: "source",
          confidence: 0.9,
          via: "source-image",
          matchInfo: { via: "source", confidence: 0.9, reason: `${cand.domain} (${cand.how}, afbeelding)`, url: cand.url, imageUrl: url },
        });
        if (r.ok) return { ...r, tried, ai };
        why.push(`afbeelding: ${r.reason}`);
        lastRed = { ...base, ok: false, verdict: "red", reason: r.reason, missing: r.missing, chart: r.chart, match: { via: "source", url: cand.url } };
      }
      tried.push(`bron ${cand.domain}: ${why.length ? why.join("; ") : `geen maattabel (${c.tables.length} tabellen, ${c.images.length} foto's bekeken)`}`);
    }
  }

  /* ---- 3. AliExpress ---- */
  const m = await findAliProduct({ domain, item, useSearch, force });
  mergeAi(ai, m.ai);
  // Zoekdienst zelf ligt eruit (plan/quota/token) → product NIET aanraken,
  // batch stoppen; de volgende run pakt 'm gewoon weer op.
  if (m.fatal) return { ...base, ok: false, verdict: "red", reason: m.reason, fatal: true, tried, ai };
  const matchInfo = { pid: m.pid || null, confidence: m.confidence || 0, title: m.title || "", via: m.via || null, reason: m.reason || m.pickReason || "", candidates: m.candidates || null };
  if (m.pid || m.link) {
    let c;
    if (m.pid) c = await fetchSizeChart(m.pid, { deadline });
    else if (browserFetchConfigured()) c = await fetchSizeChartFromLink(m.link, { deadline });
    else c = { ok: false, error: `${m.reason} — browser-route staat uit` };
    if (c.ok) {
      if (!m.pid && c.pid) {
        matchInfo.pid = c.pid;
        matchInfo.via = "search";
        matchInfo.reason = m.pickReason || "";
        await setCachedMatch(domain, item.id, { pid: c.pid, confidence: m.confidence || 0.8, title: m.title || "", via: "search", reason: m.pickReason || "" });
      }
      const r = tryBuild(base, { chart: c, item, market, source: "aliexpress", confidence: m.confidence, via: c.via, matchInfo });
      if (r.ok) return { ...r, tried, ai };
      tried.push(`AliExpress: ${r.reason}`);
      lastRed = { ...base, ok: false, verdict: "red", reason: r.reason, missing: r.missing, chart: r.chart, match: matchInfo };
    } else {
      if (c.fatal) return { ...base, ok: false, verdict: "red", reason: c.error, fatal: true, tried, ai };
      const reason = c.blocked ? `AliExpress geblokkeerd (${c.error})` : c.error;
      tried.push(`AliExpress: ${reason}`);
      lastRed = { ...base, ok: false, verdict: "red", reason, blocked: !!c.blocked, match: matchInfo };
    }
  } else {
    tried.push(`AliExpress: ${m.reason}`);
    lastRed = { ...base, ok: false, verdict: "red", reason: m.reason, match: matchInfo };
  }
  result = lastRed || { ...base, ok: false, verdict: "red", reason: "geen bron gaf een tabel" };

  /* ---- 4. vangnet: standaardtabel (expliciet "standard", eigen note) ---- */
  if (fallbackStandard) {
    const std = standardGuide(item, market);
    if (std.ok) {
      result = {
        ...result,
        ok: true,
        verdict: "standard",
        score: std.score,
        guide: std.guide,
        source: "standard",
        fallbackReason: result.reason || (result.issues || []).join("; ") || "cijfer te laag",
        issues: result.issues || [],
      };
    }
  }
  result.tried = tried;
  result.ai = ai;
  return result;
}

/** Screenshot/afbeelding → tabel → guide (source "image", confidence 1) */
export async function buildFromImage({ item, market, imageUrl, dataUrl }) {
  const ai = emptyAiUsage();
  const base = { id: item.id, title: item.title, sizes: item.sizes };
  const r = await readSizeChartImage({ imageUrl, dataUrl });
  mergeAi(ai, r.ai);
  if (!r.ok) return { ...base, ok: false, verdict: "red", reason: r.error, ai };
  const chart = normalizeChart({ headers: r.headers, rows: r.rows, unitHint: r.unit });
  const b = buildGuide({ chart, product: item, market, source: "image", confidence: 1 });
  if (!b.ok) return { ...base, ok: false, verdict: "red", reason: b.reason, chart: { headers: r.headers, rows: r.rows, unit: chart.unit }, ai };
  return {
    ...base,
    ok: true,
    verdict: b.verdict,
    score: b.score,
    guide: b.guide,
    source: "image",
    issues: b.issues,
    missing: b.missing,
    chart: { headers: r.headers, rows: r.rows, unit: chart.unit },
    ai,
  };
}
