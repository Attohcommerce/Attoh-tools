// STORE DOCTOR — "laatste N producten" (19-10-2026).
// Justin wil niet altijd de hele store scannen, maar de laatste 50/100/…/1000
// producten, actief én draft (bv. een verse import die nog op draft staat).
//
// De REST-lijst van Shopify sorteert op ID (oudste eerst) en heeft geen
// betrouwbaar status-filter; daarom:
//   1. GraphQL: ID's van de nieuwste producten, gesorteerd op created_at
//      (nieuwste eerst), alleen status active of draft.
//   2. REST: die producten volledig ophalen op ID (250 per call) — zelfde
//      velden als de gewone scan, zodat runDoctor niets merkt. Ontbreekt er
//      een (bv. draft die de lijst-call niet teruggeeft), dan los ophalen.
//   3. Maattabel-metafield, productcategorie en category-metafields per ID
//      (in plaats van de "eerste N van de store"-lijsten, die bij een grote
//      store de oudste producten zouden pakken).
import { storeGraphql, storeRequest, getProductCategories, getProductMetafieldValues } from "./shopify";

export const LATEST_MAX = 1000;
const FULL_FIELDS =
  "id,title,handle,body_html,tags,status,template_suffix,product_type,vendor,images,variants,options,published_at,created_at";

/** ID's (strings) van de nieuwste n producten met status active of draft, nieuwste eerst. */
export async function latestProductIds(store, n) {
  const want = Math.max(1, Math.min(LATEST_MAX, Math.round(Number(n) || 0)));
  const q = `query Latest($after: String, $q: String) {
    products(first: 250, after: $after, sortKey: CREATED_AT, reverse: true, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes { legacyResourceId status }
    }
  }`;
  const ids = [];
  let after = null;
  for (let page = 0; page < 8 && ids.length < want; page++) {
    const r = await storeGraphql(store, q, { after, q: "status:active OR status:draft" });
    if (!r.ok) return { ok: false, error: `Nieuwste producten ophalen mislukt: ${r.error}` };
    const c = r.data && r.data.products;
    for (const p of (c && c.nodes) || []) {
      const st = String(p.status || "").toUpperCase();
      if (st === "ACTIVE" || st === "DRAFT") ids.push(String(p.legacyResourceId));
      if (ids.length >= want) break;
    }
    if (!c || !c.pageInfo || !c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  return { ok: true, ids, want };
}

/** Volledige REST-producten op ID, in de volgorde van `ids`. */
export async function productsByIdsFull(store, ids) {
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 250) {
    const part = ids.slice(i, i + 250);
    const r = await storeRequest(store, `/products.json?ids=${part.join(",")}&limit=250&fields=${encodeURIComponent(FULL_FIELDS)}`);
    if (!r.ok) return { ok: false, error: r.error };
    for (const p of (r.data && r.data.products) || []) byId.set(String(p.id), p);
  }
  // wat de lijst-call niet gaf (bv. drafts) los ophalen — 6 tegelijk
  const missing = ids.filter((id) => !byId.has(id));
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const id = missing[next++];
      const r = await storeRequest(store, `/products/${id}.json?fields=${encodeURIComponent(FULL_FIELDS)}`);
      if (r.ok && r.data && r.data.product) byId.set(id, r.data.product);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, missing.length) }, worker));
  const products = ids.map((id) => byId.get(id)).filter(Boolean);
  return { ok: true, products, refetched: missing.length, notFound: ids.length - products.length };
}

/** Category-metafields (namespace "shopify") per product-ID — 20 per call (GraphQL-kosten). */
export async function categoryAttrKeysByIds(store, ids) {
  const q = `query AttrsByIds($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id metafields(namespace: "shopify", first: 40) { nodes { key value } } } }
  }`;
  const values = {};
  for (let i = 0; i < ids.length; i += 20) {
    const r = await storeGraphql(store, q, { ids: ids.slice(i, i + 20).map((id) => `gid://shopify/Product/${id}`) });
    if (!r.ok) return { ok: false, error: r.error };
    for (const n of (r.data && r.data.nodes) || []) {
      if (!n || !n.id) continue;
      const id = String(n.id).replace(/^gid:\/\/shopify\/Product\//, "");
      values[id] = ((n.metafields && n.metafields.nodes) || []).filter((m) => m.value && m.value !== "[]").map((m) => m.key);
    }
  }
  return { ok: true, values };
}

/** Maattabel-metafield + categorie (zelfde vorm als listProductCategories: fullName | null) per ID. */
export async function doctorExtrasByIds(store, ids, { namespace, key, skipGuides = false }) {
  const [mf, cats, attrs] = await Promise.all([
    // skipGuides (Sa Collective): maattabel-metafield niet ophalen
    skipGuides
      ? Promise.resolve({ ok: true, values: {} })
      : getProductMetafieldValues(store, ids, { namespace, key }).catch((e) => ({ ok: false, error: String(e.message || e) })),
    getProductCategories(store, ids).catch((e) => ({ ok: false, error: String(e.message || e) })),
    categoryAttrKeysByIds(store, ids).catch((e) => ({ ok: false, error: String(e.message || e) })),
  ]);
  let categories = null;
  if (cats.ok) {
    categories = {};
    for (const [id, v] of Object.entries(cats.values || {})) categories[id] = v ? v.fullName : null;
  }
  return {
    guides: mf.ok ? mf.values : {},
    categories,
    attrKeys: attrs.ok ? attrs.values : null,
  };
}
