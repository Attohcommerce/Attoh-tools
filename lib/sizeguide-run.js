// SIZE GUIDE — server-kant van één product: zoeken → tabel → bouwen.
// Gedeeld door /api/size-guide/build (batch), de handmatige AliExpress-URL-
// route en de screenshot-route. Geen Shopify-writes hier (dat doet /write).
import { fetchSizeChart, resolveAliProductId, parseAliProductId } from "./aliexpress.js";
import { searchByImage, imageSearchConfigured } from "./imagesearch.js";
import { pickMatch, readSizeChartImage } from "./sizeguide-ai.js";
import { normalizeChart, buildGuide, standardGuide } from "./sizeguide.js";
import { getCachedMatch, setCachedMatch } from "./sizeguide-cache.js";
import { emptyAiUsage } from "./ai.js";

const MIN_CONFIDENCE = 0.8;

function mergeAi(acc, ai) {
  if (!ai) return acc;
  for (const k of Object.keys(acc)) acc[k] += ai[k] || 0;
  return acc;
}

/**
 * findAliProduct({domain, item, useSearch, force}) → { pid, confidence, title, via, reason, ai } | { pid:null, reason }
 *   via: "manual" | "cache" | "search"
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
  if (!pid) return { pid: null, reason: `kandidaat gevonden maar geen product-ID uit de link te halen${resolveErr ? ` — ${resolveErr}` : ""}`, candidates: [cand], ai };
  const hit = { pid, confidence: pick.confidence, title: cand.title || "", via: "search", reason: pick.reason };
  await setCachedMatch(domain, item.id, hit);
  return { ...hit, ai };
}

/**
 * buildForProduct({domain, item, market, aliInput, useSearch, force, fallbackStandard})
 * → { id, ok, verdict, score, guide, source, match, issues, missing, reason, ai }
 *   item = productSummary() (id, title, family, gender, sizes, image, images)
 */
export async function buildForProduct({ domain, item, market, aliInput = null, useSearch = true, force = false, fallbackStandard = true }) {
  const ai = emptyAiUsage();
  const base = { id: item.id, title: item.title, sizes: item.sizes };
  if (!item.sizes || !item.sizes.length) {
    return { ...base, ok: false, verdict: "none", reason: "geen maten (geen Size-optie / alleen Default Title)", ai };
  }

  const m = await findAliProduct({ domain, item, aliInput, useSearch, force });
  mergeAi(ai, m.ai);
  // Zoekdienst zelf ligt eruit (plan/quota/token) → product NIET aanraken,
  // batch stoppen; de volgende run pakt 'm gewoon weer op.
  if (m.fatal) return { ...base, ok: false, verdict: "red", reason: m.reason, fatal: true, ai };
  let result = null;
  let chartInfo = null;

  if (m.pid) {
    const c = await fetchSizeChart(m.pid);
    if (c.ok) {
      const chart = normalizeChart({ headers: c.headers, rows: c.rows, unitHint: c.unitHint });
      chartInfo = { headers: c.headers, rows: c.rows, unit: chart.unit, via: c.via };
      const b = buildGuide({ chart, product: item, market, source: "aliexpress", confidence: m.confidence });
      if (b.ok) {
        result = { ...base, ok: true, verdict: b.verdict, score: b.score, guide: b.guide, source: "aliexpress", issues: b.issues, missing: b.missing, mode: b.mode };
      } else {
        result = { ...base, ok: false, verdict: "red", reason: b.reason, missing: b.missing || [] };
      }
    } else {
      result = { ...base, ok: false, verdict: "red", reason: c.blocked ? `AliExpress geblokkeerd (${c.error})` : c.error, blocked: !!c.blocked };
    }
  } else {
    result = { ...base, ok: false, verdict: "red", reason: m.reason };
  }
  result.match = { pid: m.pid || null, confidence: m.confidence || 0, title: m.title || "", via: m.via || null, reason: m.reason || "", candidates: m.candidates || null };
  result.chart = chartInfo;

  // Rood + vangnet aan → standaardtabel (expliciet "standard", eigen note)
  if ((!result.ok || result.verdict === "red") && fallbackStandard) {
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
