// POKÉMON TOOL — concurrenten scrapen (07-11-2026).
//
// Drie manieren, automatisch gekozen:
//  1. Shopify      → /products.json (alles in één keer, 250 per pagina)
//  2. WooCommerce  → /wp-json/wc/store/v1/products (100 per pagina)
//  3. Overig       → sitemap.xml → productpagina's → JSON-LD "Product"
//                    (Lightspeed, CCV, Magento, eigen bouw …). Gaat in
//                    porties van ±30 pagina's per aanroep; de pagina roept
//                    de route opnieuw aan tot alles binnen is.
//
// Resultaat per product (vorm gelijk voor alle drie):
//   { id, domain, url, handle, title, body, productType, vendor, tags,
//     images[], price, compareAt, currency, available, variants[], gtin }
import { classify, isPokemon, stripHtml } from "./catalog";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export function cleanDomain(input) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

async function get(url, { timeout = 15000, accept = "application/json" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en,nl;q=0.8" }, signal: ctrl.signal, redirect: "follow" });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, finalUrl: res.url };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url, opts) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await get(url, opts);
    if (r.ok) {
      try {
        return { ok: true, data: JSON.parse(r.text), status: r.status };
      } catch {
        return { ok: false, status: r.status, error: "geen JSON" };
      }
    }
    if (r.status && r.status !== 429 && r.status < 500) return { ok: false, status: r.status };
    await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
  }
  return { ok: false, status: 0 };
}

/* ---------- Platform herkennen ---------- */

export async function detectPlatform(domain) {
  const d = cleanDomain(domain);
  const s = await getJson(`https://${d}/products.json?limit=1`, { timeout: 10000 });
  if (s.ok && s.data && Array.isArray(s.data.products)) return "shopify";
  const w = await getJson(`https://${d}/wp-json/wc/store/v1/products?per_page=1`, { timeout: 10000 });
  if (w.ok && Array.isArray(w.data)) return "woocommerce";
  return "generic";
}

/* ---------- 1. Shopify ---------- */

async function currencyShopify(d) {
  const r = await getJson(`https://${d}/cart.js`, { timeout: 8000 });
  return (r.ok && r.data && r.data.currency) || "";
}

function shapeShopify(d, p, currency) {
  const variants = (p.variants || []).map((v) => ({
    title: v.title,
    option1: v.option1,
    option2: v.option2,
    option3: v.option3,
    price: Number(v.price) || 0,
    compareAt: Number(v.compare_at_price) || 0,
    sku: v.sku || "",
    available: v.available !== false,
  }));
  const prices = variants.map((v) => v.price).filter((n) => n > 0);
  return {
    id: `${d}:${p.id}`,
    domain: d,
    url: `https://${d}/products/${p.handle}`,
    handle: p.handle,
    title: String(p.title || "").trim(),
    body: String(p.body_html || "").slice(0, 6000),
    productType: p.product_type || "",
    vendor: p.vendor || "",
    tags: Array.isArray(p.tags) ? p.tags.join(", ") : String(p.tags || ""),
    images: (p.images || []).map((im) => String(im.src || "").split("?")[0]).filter(Boolean).slice(0, 12),
    options: (p.options || []).map((o) => ({ name: o.name, values: o.values })),
    variants: variants.slice(0, 30),
    price: prices.length ? Math.min(...prices) : 0,
    compareAt: Math.max(0, ...variants.map((v) => v.compareAt)),
    currency,
    available: variants.some((v) => v.available),
    publishedAt: p.published_at || p.created_at || null,
  };
}

async function scrapeShopify(d, deadline) {
  const currency = await currencyShopify(d);
  const out = [];
  let partial = false;
  for (let page = 1; page <= 80; page++) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    let r = await getJson(`https://${d}/products.json?limit=250&page=${page}`);
    if (!r.ok && page === 1) r = await getJson(`https://${d}/collections/all/products.json?limit=250&page=${page}`);
    if (!r.ok || !r.data || !Array.isArray(r.data.products)) {
      partial = page > 1 && !r.ok;
      break;
    }
    out.push(...r.data.products.map((p) => shapeShopify(d, p, currency)));
    if (r.data.products.length < 250) break;
  }
  return { products: out, partial, currency };
}

/* ---------- 2. WooCommerce (Store API, publiek) ---------- */

function shapeWoo(d, p) {
  const pr = p.prices || {};
  const minor = Number(pr.currency_minor_unit ?? 2);
  const money = (v) => (v == null || v === "" ? 0 : Number(v) / Math.pow(10, minor));
  const price = money(pr.price);
  const regular = money(pr.regular_price);
  const permalink = String(p.permalink || "");
  const handle = p.slug || permalink.replace(/\/+$/, "").split("/").pop();
  return {
    id: `${d}:${p.id}`,
    domain: d,
    url: permalink || `https://${d}/?p=${p.id}`,
    handle,
    title: stripHtml(p.name || ""),
    body: String(p.description || p.short_description || "").slice(0, 6000),
    productType: (p.categories || []).map((c) => stripHtml(c.name)).join(", "),
    vendor: "",
    tags: (p.tags || []).map((t) => stripHtml(t.name)).join(", "),
    images: (p.images || []).map((im) => String(im.src || "").split("?")[0]).filter(Boolean).slice(0, 12),
    options: [],
    variants: [],
    price,
    compareAt: regular > price ? regular : 0,
    currency: pr.currency_code || "",
    available: p.is_in_stock !== false && p.is_purchasable !== false,
    gtin: "",
    sku: p.sku || "",
    publishedAt: null,
  };
}

async function scrapeWoo(d, deadline) {
  const out = [];
  let partial = false;
  for (let page = 1; page <= 100; page++) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    const r = await getJson(`https://${d}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!r.ok || !Array.isArray(r.data)) {
      partial = page > 1 && !r.ok && r.status !== 400;
      break;
    }
    out.push(...r.data.map((p) => shapeWoo(d, p)));
    if (r.data.length < 100) break;
  }
  return { products: out, partial, currency: (out[0] && out[0].currency) || "" };
}

/* ---------- 3. Overig: sitemap + JSON-LD ---------- */

function locs(xml) {
  return [...String(xml).matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
}

const PRODUCT_URL_RE = /\/(products?|produkt|produit|artikel|item|p|shop)\/|[-_]p\d+|\.html$|\/\d{4,}/i;
const POKE_URL_RE = /pokemon|pok%c3%a9mon|ptcg|booster|elite-trainer|etb|tin|blister|collection/i;

/** Alle product-URL's uit de sitemap(s). Pokémon-URL's eerst. */
export async function sitemapProductUrls(domain, { max = 4000 } = {}) {
  const d = cleanDomain(domain);
  const starts = [`https://${d}/sitemap.xml`, `https://${d}/sitemap_index.xml`, `https://${d}/product-sitemap.xml`];
  // robots.txt kan extra sitemaps noemen
  const robots = await get(`https://${d}/robots.txt`, { timeout: 8000, accept: "text/plain" });
  if (robots.ok) for (const m of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) starts.unshift(m[1]);
  const seen = new Set();
  const urls = new Set();
  const queue = [...new Set(starts)];
  let fetched = 0;
  while (queue.length && fetched < 40 && urls.size < max) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const r = await get(sm, { timeout: 12000, accept: "application/xml,text/xml" });
    fetched++;
    if (!r.ok) continue;
    const list = locs(r.text);
    if (/<sitemapindex/i.test(r.text)) {
      // product-sitemaps eerst, pagina's/blogs overslaan
      const subs = list.filter((u) => !/(post|page|blog|categor|tag|author|news)[-_]?sitemap/i.test(u));
      subs.sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a)));
      queue.push(...subs);
    } else {
      for (const u of list) {
        if (/\.(jpe?g|png|webp|gif|pdf)(\?|$)/i.test(u)) continue;
        try {
          if (cleanDomain(new URL(u).hostname) !== d) continue;
        } catch {
          continue;
        }
        urls.add(u);
      }
    }
  }
  let all = [...urls];
  // Liefst alleen product-URL's; heeft de winkel geen herkenbaar patroon, dan alles
  const prod = all.filter((u) => PRODUCT_URL_RE.test(new URL(u).pathname));
  if (prod.length >= 5) all = prod;
  all.sort((a, b) => Number(POKE_URL_RE.test(b)) - Number(POKE_URL_RE.test(a)));
  return all.slice(0, max);
}

function jsonLdBlocks(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      // sommige winkels zetten ongeldige JSON (trailing komma's) — overslaan
    }
  }
  return out;
}

function findProductLd(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findProductLd(n);
      if (f) return f;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const t = node["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return node;
  if (node["@graph"]) return findProductLd(node["@graph"]);
  return null;
}

function metaContent(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = String(html).match(re) || String(html).match(re2);
  return m ? m[1] : "";
}

function shapeLd(d, url, ld, html) {
  const imgs = [];
  const pushImg = (x) => {
    if (!x) return;
    if (typeof x === "string") imgs.push(x);
    else if (Array.isArray(x)) x.forEach(pushImg);
    else if (x.url || x.contentUrl) imgs.push(x.url || x.contentUrl);
  };
  pushImg(ld.image);
  if (!imgs.length) pushImg(metaContent(html, "og:image"));
  let offers = ld.offers || {};
  if (Array.isArray(offers)) offers = offers[0] || {};
  if (offers["@type"] === "AggregateOffer") offers = { ...offers, price: offers.lowPrice || offers.price };
  const avail = String(offers.availability || "");
  const price = Number(String(offers.price || (offers.priceSpecification && offers.priceSpecification.price) || "0").replace(",", ".")) || 0;
  const handle = new URL(url).pathname.replace(/\/+$/, "").split("/").pop().replace(/\.html?$/, "");
  return {
    id: `${d}:${handle}`,
    domain: d,
    url,
    handle,
    title: stripHtml(ld.name || metaContent(html, "og:title")),
    body: String(ld.description || metaContent(html, "og:description") || "").slice(0, 6000),
    productType: typeof ld.category === "string" ? ld.category : "",
    vendor: (ld.brand && (ld.brand.name || ld.brand)) || "",
    tags: "",
    images: [...new Set(imgs.map((s) => String(s).trim()).filter((s) => /^https?:/i.test(s)))].slice(0, 12),
    options: [],
    variants: [],
    price,
    compareAt: 0,
    currency: offers.priceCurrency || "",
    available: !/OutOfStock|SoldOut|Discontinued/i.test(avail),
    gtin: ld.gtin13 || ld.gtin || ld.gtin12 || ld.ean || "",
    sku: ld.sku || "",
    publishedAt: null,
  };
}

/** Eén portie productpagina's lezen (parallel 6). */
export async function scrapeGenericChunk(domain, urls, deadline) {
  const d = cleanDomain(domain);
  const out = [];
  const done = [];
  let i = 0;
  async function worker() {
    while (i < urls.length && Date.now() < deadline) {
      const url = urls[i++];
      const r = await get(url, { timeout: 12000, accept: "text/html" });
      done.push(url);
      if (!r.ok) continue;
      const ld = findProductLd(jsonLdBlocks(r.text));
      if (!ld) continue;
      try {
        const p = shapeLd(d, url, ld, r.text);
        if (p.title) out.push(p);
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return { products: out, done };
}

/* ---------- Samen ---------- */

/** Shopify/Woo in één keer. (Generic gaat via scrapeGenericChunk in porties.) */
export async function scrapeApi(domain, platform, { budgetMs = 45000 } = {}) {
  const d = cleanDomain(domain);
  const deadline = Date.now() + budgetMs;
  if (platform === "shopify") return scrapeShopify(d, deadline);
  if (platform === "woocommerce") return scrapeWoo(d, deadline);
  return { products: [], partial: false, currency: "" };
}

/** Alleen Pokémon (tenzij alles=true) + indelen (type/set/taal/sleutel). */
export function filterAndClassify(products, { all = false } = {}) {
  return products.filter((p) => all || isPokemon(p)).map((p) => classify(p));
}
