/* HERIMPORT OVERSLAAN (13-10-2026)
   Een run die halverwege stukloopt (credits op, time-out) moet je exact
   opnieuw kunnen draaien zonder dubbele producten. Twee manieren om te zien
   dat een bron-product al in de store staat:
   1. metafield attoh.source_url — vanaf nu op elk geïmporteerd product
   2. voor oudere imports (zonder metafield): de foto-bestandsnamen en SKU's.
      De importer zet de bronfoto's met hun eigen bestandsnaam in Shopify en
      neemt de bron-SKU's over, dus die zijn terug te vinden. */

export const SRC_NS = "attoh";
export const SRC_KEY = "source_url";

/** https://www.Shop.com/collections/x/products/Louisa/?variant=1 → shop.com/products/louisa */
export function normSourceUrl(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const x = new URL(s);
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    let path = decodeURIComponent(x.pathname).toLowerCase();
    const m = path.match(/\/products\/([^/]+)/);
    if (m) path = `/products/${m[1]}`;
    return host + path.replace(/\/+$/, "");
  } catch {
    return s.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

const UUID_TAIL = /[_-][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GENERIC = /^(image|img|photo|picture|pic|product|main|default|untitled|file|download)?[_-]?\d{0,3}$/;

/** Bestandsnaam zonder extensie/uuid — null als hij te algemeen is om op te matchen. */
export function imageStem(src) {
  let f = "";
  try {
    f = new URL(String(src)).pathname.split("/").pop() || "";
  } catch {
    f = String(src || "").split("?")[0].split("/").pop() || "";
  }
  try {
    f = decodeURIComponent(f);
  } catch {}
  let stem = f.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "").replace(UUID_TAIL, "");
  // Shopify-formaatsuffixen (_800x, _1024x1024, _large) weg
  stem = stem.replace(/_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)$/, "");
  if (stem.length < 6 || GENERIC.test(stem)) return null;
  return stem;
}

export function skuKey(sku) {
  const s = String(sku || "").trim().toLowerCase();
  if (s.length < 5 || /^\d{1,6}$/.test(s)) return null;
  return s;
}

/** Index van de store: { urls: [norm url], stems: {stem: productId}, skus: {sku: productId}, titles: {productId: title} } */
export function buildIndex(products, sourceUrls) {
  const stems = {};
  const skus = {};
  const titles = {};
  for (const p of products || []) {
    const id = String(p.id);
    titles[id] = p.title || "";
    for (const im of p.images || []) {
      const st = imageStem(im && im.src);
      if (st && !(st in stems)) stems[st] = id;
    }
    for (const v of p.variants || []) {
      const k = skuKey(v && v.sku);
      if (k && !(k in skus)) skus[k] = id;
    }
  }
  return { urls: [...new Set((sourceUrls || []).map(normSourceUrl).filter(Boolean))], stems, skus, titles };
}

/** Staat dit (gescrapete) bron-product al in de store? → { id, title, via } | null */
export function findExisting(index, product) {
  if (!index || !product) return null;
  const hits = new Map(); // productId → { img, sku }
  const bump = (id, k) => {
    if (!hits.has(id)) hits.set(id, { img: 0, sku: 0 });
    hits.get(id)[k]++;
  };
  const stems = [...new Set((product.images || []).map((im) => imageStem(im && im.src)).filter(Boolean))];
  for (const st of stems) if (index.stems[st]) bump(index.stems[st], "img");
  const skus = [...new Set((product.variants || []).map((v) => skuKey(v && v.sku)).filter(Boolean))];
  for (const k of skus) if (index.skus[k]) bump(index.skus[k], "sku");
  let best = null;
  for (const [id, h] of hits) {
    // genoeg bewijs: 2 foto's (of de enige foto), of 2 SKU's (of de enige SKU)
    const imgOk = h.img >= Math.min(2, stems.length);
    const skuOk = h.sku >= Math.min(2, skus.length);
    if ((h.img && imgOk) || (h.sku && skuOk)) {
      const score = h.img * 2 + h.sku;
      if (!best || score > best.score) best = { id, score, via: h.img && imgOk ? `${h.img} foto${h.img > 1 ? "'s" : ""}` : `${h.sku} SKU${h.sku > 1 ? "'s" : ""}` };
    }
  }
  return best ? { id: best.id, title: index.titles[best.id] || "", via: best.via } : null;
}
