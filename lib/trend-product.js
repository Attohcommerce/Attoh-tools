// TREND-PRODUCT — één AliExpress/Temu-product ophalen in exact dezelfde vorm
// als scrapeProduct() (lib/scrape.js), zodat de rest van de importer
// (AI-titel, prijsbanden, upload, varianten, verify) ongewijzigd werkt.
//
// Extra t.o.v. een Shopify-bron (27-11-2026, Justin): "foto's met Chinese
// shit gelijk eruit, alleen de goede foto's importeren". Daarom gaat elke
// foto eerst door pickCleanSupplierImages (Haiku-vision). Blijven er te weinig
// goede over, dan krijgt het product needsAiPhotos = true en de fotoscore —
// de importer zet zo'n product dan voor de Higgsfield-foto-wachtrij klaar.

import { apifyRunSync } from "./apify.js";
import { getJSON, setJSON } from "./finder-redis.js";
import { pickCleanSupplierImages } from "./ai.js";

export function trendSourceOf(url) {
  const s = String(url || "").toLowerCase();
  if (/aliexpress\.(com|us|ru)|a\.aliexpress|s\.click\.aliexpress/.test(s)) return "aliexpress";
  if (/temu\.com/.test(s)) return "temu";
  return null;
}

export function isTrendUrl(url) {
  return !!trendSourceOf(url);
}

function idOf(source, url) {
  const s = String(url || "");
  if (source === "aliexpress") return (s.match(/\/item\/(\d{8,20})/) || s.match(/(\d{13,20})/) || [])[1] || "";
  return (s.match(/goods_id=(\d+)/) || s.match(/-g-(\d{6,})\.html/) || s.match(/(\d{10,})/) || [])[1] || "";
}

const abs = (u) => {
  const s = String((u && typeof u === "object" ? u.url || u.src : u) || "").trim();
  return s.startsWith("//") ? "https:" + s : s;
};
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/* Variant-attributen uit de vele actor-vormen halen:
   - {attributes:"Color:White;Size:M"}            (webdatalabs)
   - {attributes:[{name:"Color",value:"White"}]}
   - {color:"White", size:"M"}
   - {properties:[{name/key:"Color", value:"White"}]} / {specs:[...]}             */
function variantAttrs(v) {
  const out = {};
  const put = (k, val) => {
    const key = String(k || "").trim();
    const value = String(val ?? "").trim();
    if (key && value) out[/colou?r/i.test(key) ? "Color" : /size/i.test(key) ? "Size" : key] = value;
  };
  const a = v.attributes ?? v.properties ?? v.specs ?? v.props ?? v.skuAttr ?? null;
  if (typeof a === "string") {
    for (const part of a.split(/[;,|]/)) {
      const [k, ...rest] = part.split(":");
      if (rest.length) put(k, rest.join(":"));
    }
  } else if (Array.isArray(a)) {
    for (const p of a) put(p.name || p.key || p.specKey || p.attrName, p.value || p.specValue || p.attrValue || p.valueName);
  } else if (a && typeof a === "object") {
    for (const [k, val] of Object.entries(a)) put(k, val);
  }
  if (v.color) put("Color", v.color);
  if (v.size) put("Size", v.size);
  return out;
}

/** Detail-item van de actor → scrapeProduct()-vorm (zonder foto-check). */
export function toImporterProduct(source, url, d) {
  const gallery = [];
  const pushImg = (u) => {
    const s = abs(u);
    if (s && /^https?:/.test(s) && !gallery.includes(s)) gallery.push(s);
  };
  pushImg(d.image || d.imageUrl || d.primaryImage || d.mainImage);
  for (const u of d.images || d.gallery || d.imageUrls || d.galleryImages || []) pushImg(u);

  const rawVariants = d.variants || d.skus || d.skuList || d.sku || [];
  const variants = [];
  const optionValues = {};
  const varImage = [];
  for (const v of Array.isArray(rawVariants) ? rawVariants : []) {
    const attrs = variantAttrs(v);
    const names = Object.keys(attrs).slice(0, 3);
    names.forEach((n) => {
      optionValues[n] = optionValues[n] || [];
      if (!optionValues[n].includes(attrs[n])) optionValues[n].push(attrs[n]);
    });
    const img = abs(v.image || v.imageUrl || v.skuImage || v.img);
    if (img) pushImg(img);
    varImage.push(img || null);
    variants.push({ attrs, price: num(v.price ?? v.salePrice ?? v.skuPrice ?? d.price), compareAtPrice: num(v.originalPrice ?? v.marketPrice) || null, available: v.available !== false && v.stock !== 0, sku: String(v.skuId || v.sku || v.id || "") });
  }
  const optionNames = Object.keys(optionValues).slice(0, 3);
  const images = gallery.map((src, i) => ({ id: i + 1, src, alt: "", position: i + 1, variantIds: [] }));
  const idxOf = (src) => (src ? gallery.indexOf(src) + 1 : null);
  let shopVariants = variants.map((v, i) => ({
    title: optionNames.map((n) => v.attrs[n] || "").filter(Boolean).join(" / ") || "Default Title",
    option1: optionNames[0] ? v.attrs[optionNames[0]] || null : "Default Title",
    option2: optionNames[1] ? v.attrs[optionNames[1]] || null : null,
    option3: optionNames[2] ? v.attrs[optionNames[2]] || null : null,
    price: String(v.price || num(d.price) || 0),
    compareAtPrice: v.compareAtPrice ? String(v.compareAtPrice) : null,
    sku: v.sku,
    grams: 0,
    available: v.available,
    imageId: idxOf(varImage[i]) || null,
  }));
  // Zelfde kleur = zelfde foto (AliExpress geeft de foto vaak maar bij één maat)
  const ci = optionNames.indexOf("Color");
  if (ci >= 0) {
    const key = `option${ci + 1}`;
    const colorImg = {};
    for (const v of shopVariants) if (v.imageId && v[key] && !colorImg[v[key]]) colorImg[v[key]] = v.imageId;
    for (const v of shopVariants) if (!v.imageId && colorImg[v[key]]) v.imageId = colorImg[v[key]];
  }
  if (!shopVariants.length) {
    shopVariants = [{ title: "Default Title", option1: "Default Title", option2: null, option3: null, price: String(num(d.price) || 0), compareAtPrice: null, sku: "", grams: 0, available: true, imageId: null }];
  }
  const desc = d.description || d.descriptionHtml || d.descriptionText || "";
  const specs = Array.isArray(d.specifications) ? d.specifications.map((s) => `${s.name || s.key || ""}: ${s.value || ""}`).join("<br>") : "";
  return {
    sourceUrl: url,
    handle: `${source}-${idOf(source, url) || Date.now()}`,
    title: String(d.title || d.name || "").trim(),
    bodyHtml: [typeof desc === "string" ? desc : "", specs].filter(Boolean).join("<br>"),
    vendor: "",
    productType: String((d.category && (d.category.name || d.category)) || d.categoryName || ""),
    tags: "",
    options: optionNames.length ? optionNames.map((n) => ({ name: n, values: optionValues[n] })) : [{ name: "Title", values: ["Default Title"] }],
    variants: shopVariants,
    images,
    sourceCurrency: d.currency || "USD",
    trendSource: source,
    trendSold: num(d.soldCount ?? d.soldQuantity ?? d.sold ?? d.orders),
  };
}

/** Foto's opschonen: alleen de goede houden, variant-koppelingen bijwerken. */
export async function cleanTrendImages(product) {
  const imgs = (product.images || []).slice(0, 18);
  if (!imgs.length) return { product, photo: { kept: 0, dropped: 0, score: 0, needsAiPhotos: true, reasons: {} }, ai: null };
  const r = await pickCleanSupplierImages(imgs.map((im, i) => ({ index: i, url: im.src })));
  const keepSet = new Set(r.keep);
  let kept = imgs.filter((_, i) => keepSet.has(i));
  // Geen enkele schone foto: de best scorende houden als REFERENTIE voor de
  // AI-foto (Higgsfield) — product staat als draft en krijgt needsAiPhotos.
  let referenceOnly = false;
  if (!kept.length) {
    const best = imgs.map((im, i) => ({ im, s: r.scores[i] || 0 })).sort((a, b) => b.s - a.s)[0];
    if (best) {
      kept = [best.im];
      referenceOnly = true;
    }
  }
  const reasons = {};
  for (const d of r.drop) reasons[d.reason] = (reasons[d.reason] || 0) + 1;
  const keptIds = new Set(kept.map((im) => im.id));
  const variants = product.variants.map((v) => (v.imageId && !keptIds.has(v.imageId) ? { ...v, imageId: null } : v));
  const scores = kept.map((_, j) => r.scores[imgs.indexOf(kept[j])] || 5);
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  // Beste foto eerst (hoogste score), positie hernummeren
  const order = kept
    .map((im) => ({ im, s: r.scores[imgs.indexOf(im)] || 5 }))
    .sort((a, b) => b.s - a.s)
    .map((x, i) => ({ ...x.im, position: i + 1 }));
  const needsAiPhotos = referenceOnly || order.length < 2 || avg < 6;
  return {
    product: { ...product, images: order, variants, photoScore: avg, needsAiPhotos, photoReferenceOnly: referenceOnly },
    photo: { kept: referenceOnly ? 0 : order.length, dropped: imgs.length - (referenceOnly ? 0 : order.length), score: avg, needsAiPhotos, referenceOnly, reasons },
    ai: r.ai,
  };
}

const DETAIL_DEFAULTS = {
  aliexpress: { env: "TREND_ALI_DETAIL_ACTOR", actor: "webdatalabs~aliexpress-product-intelligence" },
  temu: { env: "TREND_TEMU_DETAIL_ACTOR", actor: "memo23~temu-scraper" },
};

function detailInput(source, url) {
  if (source === "aliexpress") return { mode: "product", productUrls: [url], useApifyProxy: true, maxProducts: 1, currency: "USD", language: "en" };
  return { productUrls: [url], includeDetails: true, maxItems: 1 };
}

/**
 * scrapeTrendProduct(url) → { ok, product, photo } | { ok:false, error }
 * Cache 7 dagen in Redis (zelfde product 2× importeren in verschillende stores
 * kost dan maar één Apify-run).
 */
export async function scrapeTrendProduct(url, { cleanPhotos = true } = {}) {
  const source = trendSourceOf(url);
  if (!source) return { ok: false, error: "Geen AliExpress/Temu-URL" };
  const id = idOf(source, url);
  const cacheKey = `trend:prod:${source}:${id || url}`;
  let detail = await getJSON(cacheKey, null);
  if (!detail) {
    const cfg = DETAIL_DEFAULTS[source];
    const actor = process.env[cfg.env] || cfg.actor;
    const r = await apifyRunSync(actor, detailInput(source, url), { timeoutSecs: 50, memory: 1024, abortMs: 55000, limit: 3 });
    if (!r.ok) return { ok: false, error: r.error };
    detail = (r.items || []).find((x) => x && typeof x === "object" && !x.error && (x.title || x.name)) || null;
    if (!detail) return { ok: false, error: `${source}: geen productdetails teruggekregen` };
    await setJSON(cacheKey, detail, 60 * 60 * 24 * 7).catch(() => {});
  }
  let product = toImporterProduct(source, url, detail);
  if (!product.title) return { ok: false, error: `${source}: product zonder titel` };
  let photo = null;
  if (cleanPhotos) {
    try {
      const c = await cleanTrendImages(product);
      product = c.product;
      photo = c.photo;
    } catch (e) {
      photo = { error: String(e.message || e) };
    }
  }
  if (!product.images.length) return { ok: false, error: `${source}: product zonder foto's`, photo };
  return { ok: true, product, photo };
}
