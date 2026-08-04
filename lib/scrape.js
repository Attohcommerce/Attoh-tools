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

// Match een product tegen een keyword. Retourneert null of {source, literal}
export function matchKeyword(p, keyword) {
  const kw = normText(keyword);
  if (!kw) return null;
  const kwWords = kw.split(" ").filter(Boolean);

  const title = normText(p.title);
  const type = normText(p.productType);
  const desc = normText(p.bodyHtml + " " + p.productType + " " + p.tags);
  const imgText = normText(
    (p.images || []).map((im) => `${im.alt || ""} ${imageFilename(im.src).replace(/[-_.]/g, " ")}`).join(" ")
  );

  // HARDE EIS: het producttype uit het keyword (laatste woord, bv. "dress",
  // "heels", "jeans") moet in de TITEL of het product_type staan. Anders is het
  // een ander soort product — een loafer met "elegant dress" in de omschrijving
  // telt dus niet meer mee.
  const noun = kwWords[kwWords.length - 1];
  const nounStem = noun.endsWith("s") && noun.length > 3 ? noun.slice(0, -1) : noun;
  if (!title.includes(nounStem) && !type.includes(nounStem)) return null;

  const inAll = (hay) => kwWords.every((w) => hay.includes(w));
  const literal = (hay) => hay.includes(kw);

  if (inAll(title)) return { source: "Titel", literal: literal(title) };
  if (inAll(desc)) return { source: "Omschrijving", literal: literal(desc) };
  if (inAll(imgText)) return { source: "Foto's", literal: literal(imgText) };
  return null;
}

// Catalogus van een store ophalen, best selling eerst (met fallback).
export async function fetchCatalog(domain, maxPages = 8) {
  const dom = cleanDomain(domain);
  const products = [];
  let usedBestSelling = true;

  // Poging 1: /collections/all/products.json met best-selling sortering
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchJson(
      `https://${dom}/collections/all/products.json?sort_by=best-selling&limit=250&page=${page}`
    );
    if (!r.ok || !r.data || !Array.isArray(r.data.products)) {
      if (page === 1) usedBestSelling = false;
      break;
    }
    products.push(...r.data.products);
    if (r.data.products.length < 250) break;
  }

  // Fallback: /products.json (nieuwste eerst)
  if (products.length === 0) {
    usedBestSelling = false;
    for (let page = 1; page <= maxPages; page++) {
      const r = await fetchJson(`https://${dom}/products.json?limit=250&page=${page}`);
      if (!r.ok || !r.data || !Array.isArray(r.data.products)) break;
      products.push(...r.data.products);
      if (r.data.products.length < 250) break;
    }
  }

  return {
    domain: dom,
    usedBestSelling,
    products: products.map((p) => ({
      handle: p.handle,
      title: p.title || "",
      bodyHtml: p.body_html || "",
      productType: p.product_type || "",
      tags: Array.isArray(p.tags) ? p.tags.join(", ") : p.tags || "",
      images: (p.images || []).map((im) => ({ src: im.src, alt: im.alt || "" })),
      url: `https://${dom}/products/${p.handle}`,
    })),
  };
}

export { imageFilename, normText };
