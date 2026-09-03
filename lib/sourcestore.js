// BRON-STORE MAATTABELLEN — de concurrent waar het product vandaan komt.
//
// Onze producten zijn geïmporteerd uit publieke Shopify-stores (products.json).
// Shopify houdt bij het importeren de originele bestandsnamen van de foto's,
// dus via de foto-bestandsnamen (en SKU's) vinden we het bronproduct terug
// zónder dat we de bron-URL ooit hebben opgeslagen. Daar staat vaak een
// maattabel: als HTML-tabel in de omschrijving, of als afbeelding (in de
// omschrijving of als laatste productfoto) → AI leest 'm over.
//
// Geen anti-bot (Shopify storefront-JSON is publiek), geen Apify-kosten.
//
// Domeinen: de scraper-lijst (localStorage `sa_competitor_stores`, komt van
// de client mee) + alle domeinen uit de vaste Geheugen-sheet (kolom A = elke
// ooit gescrapete productlink). Per domein een compacte index in Redis (24 u):
// { h:[handles], img:{hash(fotosleutel):idx}, sku:{sku:idx} } — ±150 KB per store.
import { readRange, getSheetSizes, a1Tab } from "./sheets.js";
import { cacheGetJson, cacheSetJson } from "./sizeguide-cache.js";
import { imageStemKey, stemWeight, specificSku } from "./sizeguide.js";
import { pickSizeTables, imageSrcsFrom } from "./htmltable.js";
import { readSizeChartImage } from "./sizeguide-ai.js";
import { emptyAiUsage } from "./ai.js";

export const MEMORY_SHEET = "1gbu2XAZMPBIbyr47B_rBvoHDcWoVaTNUuBNwmp9ucJg"; // Geheugen (A Link, B Keyword, C Datum)
export const WORKBOOK_SHEET = "1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE"; // Import-werkboek (importlijsten: kolom A = bron-URL)
const IDX_TTL = 60 * 60 * 24; // 24 u
const DOM_TTL = 60 * 60 * 6;
const MAX_PAGES = 12; // 12 × 250 = 3.000 producten per domein
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export function cleanDomain(input) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, text: await res.text() };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Domeinen uit de Geheugen-sheet (kolom A) én uit álle tabbladen van het
 * Import-werkboek (kolom A van elke importlijst = bron-URL's) — gecachet 6 u.
 * Zo zijn ook de stores van vroegere imports (vóór de geheugen-sheet) bekend.
 */
export async function memoryDomains() {
  const k = "sg:srcdomains:v2";
  const c = await cacheGetJson(k);
  if (c && Array.isArray(c.domains)) return c.domains;
  const domains = new Set();
  const harvest = (rows) => {
    for (const r of rows || []) {
      const v = String((r && r[0]) || "").trim();
      if (!/^https?:\/\//i.test(v)) continue;
      const d = cleanDomain(v);
      if (d && d.includes(".")) domains.add(d);
    }
  };
  try {
    harvest(await readRange(MEMORY_SHEET, "A:A"));
  } catch {
    /* sheet niet bereikbaar → verder met de rest */
  }
  try {
    const tabs = await getSheetSizes(WORKBOOK_SHEET);
    for (const t of tabs.slice(0, 40)) {
      if (!t.title || /^(import-log|sizeguide|doctor)/i.test(t.title)) continue;
      try {
        harvest(await readRange(WORKBOOK_SHEET, `${a1Tab(t.title)}!A1:A3000`));
      } catch {
        /* tabblad overslaan */
      }
    }
  } catch {
    /* werkboek niet bereikbaar */
  }
  const list = [...domains];
  if (list.length) await cacheSetJson(k, { domains: list, at: Date.now() }, DOM_TTL);
  return list;
}

const idxKey = (d) => `sg:srcidx:${d}`;

// Indexen per warme serverless-instance in het geheugen houden (10 min):
// 3 producten per build-call × 50 domeinen zouden anders 150 Redis-GETs zijn.
const idxMemo = new Map(); // domein → { at, promise }
const MEMO_TTL = 10 * 60 * 1000;
function loadIndex(d) {
  const m = idxMemo.get(d);
  if (m && Date.now() - m.at < MEMO_TTL) return m.promise;
  const promise = cacheGetJson(idxKey(d)).catch(() => null);
  idxMemo.set(d, { at: Date.now(), promise });
  return promise;
}

/** Korte hash van een fotosleutel (FNV-1a, 2 varianten → ~11 tekens base36) — houdt de Redis-index klein */
export function hashKey(stem) {
  const s = String(stem || "");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

/** Index van één domein bouwen (products.json) en cachen → { ok, n, pages } */
export async function buildSourceIndex(domain, { force = false } = {}) {
  const d = cleanDomain(domain);
  if (!d) return { ok: false, error: "leeg domein" };
  if (!force) {
    const c = await cacheGetJson(idxKey(d));
    if (c && Array.isArray(c.h)) return { ok: true, n: c.h.length, cached: true };
  }
  const handles = [];
  const img = {};
  const sku = {};
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchJson(`https://${d}/products.json?limit=250&page=${page}`);
    if (!r.ok || !r.data || !Array.isArray(r.data.products)) break;
    pages++;
    for (const p of r.data.products) {
      if (!p || !p.handle) continue;
      const i = handles.push(p.handle) - 1;
      for (const im of (p.images || []).slice(0, 8)) {
        const stem = imageStemKey(im && im.src);
        if (!stem || !stemWeight(stem)) continue; // generieke namen niet indexeren
        const key = hashKey(stem);
        if (img[key] == null) img[key] = i;
      }
      for (const v of p.variants || []) {
        const sk = String((v && v.sku) || "").trim();
        if (specificSku(sk) && sku[sk] == null) sku[sk] = i;
      }
    }
    if (r.data.products.length < 250) break;
  }
  if (!handles.length) {
    // Onthouden dat dit domein niets geeft (offline/geen Shopify) — 6 u, niet elke run opnieuw proberen
    await cacheSetJson(idxKey(d), { h: [], img: {}, sku: {}, at: Date.now(), empty: true }, DOM_TTL);
    return { ok: false, error: "geen producten (geen Shopify-store of offline)", n: 0 };
  }
  await cacheSetJson(idxKey(d), { h: handles, img, sku, at: Date.now() }, IDX_TTL);
  idxMemo.delete(d);
  return { ok: true, n: handles.length, pages };
}

/**
 * findSourceProducts(item, domains, {maxCandidates}) → [{ domain, handle, url, hits, how }]
 *   item = productSummary() met imageKeys/skus. Alleen domeinen met een index in de cache.
 */
export async function findSourceProducts(item, domains, { maxCandidates = 3 } = {}) {
  const keys = (item.imageKeys || []).filter(Boolean);
  const skus = (item.skus || []).filter(Boolean);
  if (!keys.length && !skus.length) return { candidates: [], indexed: 0 };
  const cands = [];
  let indexed = 0;
  for (const dom of domains || []) {
    const d = cleanDomain(dom);
    if (!d) continue;
    const idx = await loadIndex(d);
    if (!idx || !Array.isArray(idx.h) || !idx.h.length) continue;
    indexed++;
    const tally = {};
    const bump = (i, w, how) => {
      if (i == null) return;
      tally[i] = tally[i] || { hits: 0, how: new Set() };
      tally[i].hits += w;
      tally[i].how.add(how);
    };
    for (const k of keys) bump(idx.img && idx.img[hashKey(k)], stemWeight(k), "foto");
    for (const sk of skus) bump(idx.sku && idx.sku[sk], 2, "sku");
    for (const [i, t] of Object.entries(tally)) {
      const handle = idx.h[Number(i)];
      if (!handle) continue;
      // ≥2 punten: twee specifieke foto's, één vrijwel unieke (AliExpress/MD5-)naam of een echte SKU
      if (t.hits >= 2) cands.push({ domain: d, handle, url: `https://${d}/products/${handle}`, hits: t.hits, how: [...t.how].join("+") });
    }
  }
  cands.sort((a, b) => b.hits - a.hits);
  return { candidates: cands.slice(0, maxCandidates), indexed };
}

const CHART_HINT = /size|chart|maat|measure|guide|tabel|dimension|cm|inch/i;

/**
 * sourceChartCandidates(domain, handle) → { ok, tables:[{headers,rows,unitHint,where}], images:[url], reason }
 *   tables: uit de omschrijving (products.json) én uit de productpagina — size-chart-
 *   apps (ESC, Clean Size Charts, Avada …) zetten hun tabel als server-side app-block
 *   in de HTML. images: kandidaat-afbeeldingen (omschrijving eerst, dan foto's die op
 *   een tabel lijken, dan de laatste productfoto's) — leest de aanroeper lui met AI.
 */
export async function sourceChartCandidates(domain, handle, { maxImages = 4 } = {}) {
  const d = cleanDomain(domain);
  const r = await fetchJson(`https://${d}/products/${encodeURIComponent(handle)}.json`);
  if (!r.ok || !r.data || !r.data.product) return { ok: false, tables: [], images: [], reason: `bronproduct niet op te halen (${r.status || r.error || "?"})` };
  const p = r.data.product;
  const body = String(p.body_html || "");
  const tables = pickSizeTables(body).map((t) => ({ ...t, where: "omschrijving" }));
  const pg = await fetchText(`https://${d}/products/${encodeURIComponent(handle)}`);
  if (pg.ok) for (const t of pickSizeTables(pg.text)) tables.push({ ...t, where: "productpagina" });
  const descImgs = imageSrcsFrom(body);
  const prodImgs = (p.images || []).map((im) => im && im.src).filter(Boolean);
  const looksChart = (src, alt) => CHART_HINT.test(alt || "") || CHART_HINT.test(decodeURIComponent(String(src).split("/").pop() || ""));
  const hinted = (p.images || []).filter((im) => im && im.src && looksChart(im.src, im.alt)).map((im) => im.src);
  const ordered = [...descImgs, ...hinted, ...prodImgs.slice(-3).reverse()];
  const seen = new Set();
  const images = ordered.filter((u) => (seen.has(u) ? false : (seen.add(u), true))).slice(0, maxImages);
  return { ok: true, tables, images, title: p.title || "" };
}

/** Eén afbeelding met AI lezen → { ok, chart, ai } | { ok:false, reason, ai } */
export async function readChartImage(url) {
  const rr = await readSizeChartImage({ imageUrl: url });
  if (rr.ok && rr.rows.length >= 2) return { ok: true, chart: { headers: rr.headers, rows: rr.rows, unitHint: rr.unit }, ai: rr.ai };
  return { ok: false, reason: rr.error || "geen leesbare maattabel", ai: rr.ai };
}

/** Eigen foto's die op een maattabel lijken → chart (AI leest) */
export async function chartFromOwnImages(item, { maxImages = 3 } = {}) {
  const ai = emptyAiUsage();
  const cands = (item.chartImages || []).slice(0, maxImages);
  for (const url of cands) {
    const rr = await readSizeChartImage({ imageUrl: url });
    for (const k of Object.keys(ai)) ai[k] += (rr.ai && rr.ai[k]) || 0;
    if (rr.ok && rr.rows.length >= 2) return { ok: true, chart: { headers: rr.headers, rows: rr.rows, unitHint: rr.unit }, how: "own-image", imageUrl: url, ai };
  }
  return { ok: false, reason: cands.length ? "eigen foto's bevatten geen leesbare maattabel" : "geen eigen maattabel-foto", ai };
}
