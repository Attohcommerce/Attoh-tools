// Scraping-helpers voor publieke Shopify-stores (products.json endpoints).

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function cleanDomain(input) {
  let d = String(input || "").trim();
  d = d.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "");
  return d.toLowerCase();
}

export function productUrlToJsonUrl(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    const m = u.pathname.match(/\/products\/([a-z0-9\-_%.]+)/i);
    if (!m) return null;
    return `${u.origin}/products/${m[1]}.json`;
  } catch {
    return null;
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// Valuta van een store via /cart.js (publiek endpoint)
export async function getStoreCurrency(domain) {
  const r = await fetchJson(`https://${cleanDomain(domain)}/cart.js`);
  if (r.ok && r.data && r.data.currency) return r.data.currency;
  return null;
}

// Eén product scrapen van een product-URL
export async function scrapeProduct(url) {
  const jsonUrl = productUrlToJsonUrl(url);
  if (!jsonUrl) return { ok: false, error: "Geen geldige product-URL" };
  const r = await fetchJson(jsonUrl);
  if (!r.ok || !r.data || !r.data.product) {
    return { ok: false, error: `Product niet op te halen (${r.status || r.error || "?"})` };
  }
  const p = r.data.product;
  const origin = new URL(jsonUrl).origin;
  const currency = await getStoreCurrency(origin);
  return {
    ok: true,
    product: {
      sourceUrl: url,
      handle: p.handle,
      title: p.title,
      bodyHtml: p.body_html || "",
      vendor: p.vendor || "",
      productType: p.product_type || "",
      tags: typeof p.tags === "string" ? p.tags : (p.tags || []).join(", "),
      options: (p.options || []).map((o) => ({ name: o.name, values: o.values })),
      variants: (p.variants || []).map((v) => ({
        title: v.title,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        price: v.price,
        compareAtPrice: v.compare_at_price,
        sku: v.sku || "",
        grams: v.grams || 0,
        available: v.available !== false,
        imageId: v.image_id || null, // bron-foto van deze variant (kleur)
      })),
      images: (p.images || []).map((im) => ({
        id: im.id, // nodig om variant→foto te koppelen
        src: im.src,
        alt: im.alt || "",
        position: im.position,
        variantIds: im.variant_ids || [],
      })),
      sourceCurrency: currency,
    },
  };
}

// ---------- Store-catalogus doorzoeken op keyword ----------

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9à-ÿ\s'\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function imageFilename(src) {
  try {
    const u = new URL(src);
    let f = u.pathname.split("/").pop() || "";
    f = f.toLowerCase();
    // Shopify size-suffixen en versies strippen: foo_600x600.jpg → foo.jpg
    f = f.replace(/_(\d+x\d*|\d*x\d+|x\d+|\d+x|small|medium|large|grande|original|master|compact|icon|thumb)(?=\.)/g, "");
    return f;
  } catch {
    return String(src || "").toLowerCase();
  }
}

const MALE_HINTS = ["men", "men's", "mens", "man", "male", "heren", "gentleman", "him", "guys", "boy"];
const FEMALE_HINTS = ["women", "women's", "womens", "woman", "female", "dames", "lady", "ladies", "her", "girl", "dress", "blouse", "skirt", "gown", "bra", "legging"];

export function guessGender(p) {
  const text = normText([p.title, p.productType, p.tags, p.bodyHtml].join(" "));
  const words = new Set(text.split(" "));
  let m = 0;
  let f = 0;
  for (const h of MALE_HINTS) if (words.has(h)) m++;
  for (const h of FEMALE_HINTS) if (words.has(h)) f++;
  if (m > 0 && f === 0) return "Man";
  if (f > 0 && m === 0) return "Vrouw";
  if (f > m) return "Vrouw";
  if (m > f) return "Man";
  return "Onbekend";
}

// Matching is verhuisd naar de fashion-engine (lib/fashion.js):
// vaste volgorde titel → omschrijving → foto's, met mode-synoniemen
// en besmettings-detectie in omschrijvingen.
export { matchKeyword, analyzeKeyword, matchProduct } from "./fashion";

// Catalogus-cache: dezelfde store wordt binnen één run voor elk keyword
// opnieuw gevraagd — die halen we maar één keer op per 10 minuten.
const catalogCache = new Map(); // domain → { at, data }
const CATALOG_TTL = 10 * 60 * 1000;

async function fetchHtml(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ECHTE best-selling volgorde. Shopify's products.json NEGEERT sort_by
// stilletjes (je krijgt vaak gewoon A-Z terug). De enige betrouwbare bron
// is de winkelpagina zelf: /collections/all?sort_by=best-selling — precies
// wat een bezoeker ziet. Daaruit halen we de product-handles op volgorde.
export function parseHandlesFromHtml(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(
    /href="[^"]*?\/products\/([a-zA-Z0-9\-_%.]+)/g
  )) {
    let h = m[1].toLowerCase();
    try {
      h = decodeURIComponent(h);
    } catch {}
    h = h.replace(/\.(json|js|xml)$/, "");
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

async function fetchBestSellingRank(dom, maxPages = 6) {
  const rank = new Map(); // handle → positie
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchHtml(
      `https://${dom}/collections/all?sort_by=best-selling&page=${page}`
    );
    if (!html) break;
    const before = rank.size;
    for (const h of parseHandlesFromHtml(html)) {
      if (!rank.has(h)) rank.set(h, rank.size);
    }
    // Geen nieuwe handles meer → laatste pagina (of herhaal-pagina) bereikt
    if (rank.size === before) break;
    if (rank.size >= 600) break;
  }
  return rank;
}

// Catalogus van een store ophalen: volledige data uit products.json,
// gesorteerd volgens de échte best-selling volgorde van de winkelpagina.
export async function fetchCatalog(domain, maxPages = 8) {
  const dom = cleanDomain(domain);
  const cached = catalogCache.get(dom);
  if (cached && Date.now() - cached.at < CATALOG_TTL) return cached.data;

  // 1. Alle productdata (volledig, maar volgorde onbetrouwbaar)
  const products = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchJson(`https://${dom}/products.json?limit=250&page=${page}`);
    if (!r.ok || !r.data || !Array.isArray(r.data.products)) break;
    products.push(...r.data.products);
    if (r.data.products.length < 250) break;
  }
  if (products.length === 0) {
    for (let page = 1; page <= maxPages; page++) {
      const r = await fetchJson(
        `https://${dom}/collections/all/products.json?limit=250&page=${page}`
      );
      if (!r.ok || !r.data || !Array.isArray(r.data.products)) break;
      products.push(...r.data.products);
      if (r.data.products.length < 250) break;
    }
  }

  let shaped = products.map((p, i) => ({
    idx: i,
    handle: p.handle,
    title: p.title || "",
    bodyHtml: p.body_html || "",
    productType: p.product_type || "",
    tags: Array.isArray(p.tags) ? p.tags.join(", ") : p.tags || "",
    images: (p.images || []).map((im) => ({ src: im.src, alt: im.alt || "" })),
    url: `https://${dom}/products/${p.handle}`,
  }));

  // 2. Best-selling volgorde van de echte winkelpagina eroverheen leggen
  let usedBestSelling = false;
  if (shaped.length > 0) {
    const rank = await fetchBestSellingRank(dom);
    if (rank.size >= 8) {
      usedBestSelling = true;
      const UNRANKED = 1e9;
      shaped.sort((a, b) => {
        const ra = rank.has(String(a.handle).toLowerCase())
          ? rank.get(String(a.handle).toLowerCase())
          : UNRANKED + a.idx;
        const rb = rank.has(String(b.handle).toLowerCase())
          ? rank.get(String(b.handle).toLowerCase())
          : UNRANKED + b.idx;
        return ra - rb;
      });
    }
  }
  shaped = shaped.map(({ idx, ...rest }) => rest);

  const data = { domain: dom, usedBestSelling, products: shaped };

  catalogCache.set(dom, { at: Date.now(), data });
  if (catalogCache.size > 24) {
    catalogCache.delete(catalogCache.keys().next().value);
  }
  return data;
}

export { imageFilename, normText };
