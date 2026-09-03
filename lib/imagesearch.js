// SEARCH-BY-IMAGE op AliExpress via Apify (env APIFY_TOKEN).
//
// Onze producten komen van concurrent-Shopify-stores, dus er is geen bron-
// ID: het AliExpress-product wordt op de hoofdfoto gezocht. AliExpress'
// eigen image-search is bot-beschermd en vraagt een upload; de Apify-actor
// neemt dat over (pay-per-result, ±$1,20 per 1.000 resultaten).
//
// Actor instelbaar via env APIFY_IMAGE_ACTOR (default freecamp008's
// "aliexpress-search-by-image-actor"; input = { imageUrl }). Resultaten
// worden genormaliseerd naar {title, link, image, price, pid} zodat een
// andere actor/provider later alleen hier aangepast hoeft te worden.

import { parseAliProductId } from "./aliexpress.js";

const DEFAULT_ACTOR = "freecamp008~aliexpress-search-by-image-actor";

export function imageSearchConfigured() {
  return !!process.env.APIFY_TOKEN;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

export function normalizeCandidate(item) {
  const o = item || {};
  const link = pick(o, ["productLink", "productUrl", "link", "url", "detailUrl", "itemUrl"]);
  let image = pick(o, ["productImage", "imageUrl", "image", "mainImage", "thumbnail", "pic"]);
  if (!image && Array.isArray(o.images) && o.images.length) image = o.images[0];
  if (image && typeof image === "object") image = image.url || image.src || null;
  if (image && String(image).startsWith("//")) image = "https:" + image;
  const idRaw = pick(o, ["productId", "itemId", "product_id", "item_id", "id"]);
  const pid = parseAliProductId(idRaw != null ? String(idRaw) : "") || parseAliProductId(link || "");
  const price = pick(o, ["price", "salePrice", "minPrice", "productPrice"]);
  return {
    title: String(pick(o, ["productTitle", "title", "name", "subject"]) || "").trim(),
    link: link ? String(link) : null,
    image: image ? String(image) : null,
    price: price != null ? (typeof price === "object" ? price.value || price.min || JSON.stringify(price) : String(price)) : "",
    pid,
    orders: pick(o, ["orderCount", "orders", "sold"]),
    rating: pick(o, ["rating", "evaluateRate", "starRating"]),
  };
}

/**
 * searchByImage(imageUrl, {limit}) → { ok, candidates[], raw } | { ok:false, error }
 * Synchrone Apify-run (run-sync-get-dataset-items); timeout past binnen de
 * Vercel-functie (maxDuration 60 → de build-route doet 2 producten per call).
 */
export async function searchByImage(imageUrl, opts = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN ontbreekt (Vercel → Environment Variables)" };
  const actor = process.env.APIFY_IMAGE_ACTOR || DEFAULT_ACTOR;
  const limit = Math.max(1, Math.min(12, Number(opts.limit) || 6));
  const url =
    `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&timeout=${Number(opts.timeout) || 45}&clean=true&limit=${limit}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (Number(opts.timeout) || 45) * 1000 + 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl, maxResults: limit, limit }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      let msg = (data && data.error && (data.error.message || data.error.type)) || text.slice(0, 200) || `HTTP ${res.status}`;
      // "Actor run did not succeed (run ID: …, status: FAILED)" zegt niets —
      // de echte reden staat in de run zelf (bv. "Free plan: daily limit of
      // 5 searches reached"). Even ophalen, en bij een plan/quota-fout de
      // hele batch stoppen (fatal) i.p.v. 200× hetzelfde te proberen.
      const runId = (String(msg).match(/run ID:\s*([A-Za-z0-9]+)/) || [])[1];
      if (runId) {
        try {
          const rr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
          const rj = await rr.json().catch(() => null);
          const sm = rj && rj.data && rj.data.statusMessage;
          if (sm) msg = sm;
        } catch {}
      }
      const fatal = /daily limit|upgrade|subscription|quota|insufficient|credit|payment|rent|not enough/i.test(String(msg)) || res.status === 401 || res.status === 402 || res.status === 403;
      return { ok: false, error: `Apify: ${msg}`, fatal };
    }
    const items = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : [];
    const candidates = items.map(normalizeCandidate).filter((c) => c.link || c.pid);
    return { ok: true, candidates: candidates.slice(0, limit), raw: items.length };
  } catch (e) {
    return { ok: false, error: `Apify: ${String(e.name === "AbortError" ? "timeout" : e.message || e)}` };
  } finally {
    clearTimeout(t);
  }
}
