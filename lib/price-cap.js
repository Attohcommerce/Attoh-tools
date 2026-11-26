// KORTING MAXIMEREN (26-11-2026) — "max 50% korting" op een hele store: compare-at-prijzen die meer
// dan X% korting geven worden verlaagd tot de hoogste prijs op ,95 die binnen X% blijft. Prijzen zelf
// blijven gelijk. Eerst proefdraaien (apply=false), dan uitvoeren. Hervatbaar met cursor (tijdslimiet).
import { findStore } from "./claude-link";
import { storeGraphql } from "./shopify";

const Q = `query($after: String) { products(first: 25, after: $after, sortKey: ID) { nodes { id title variants(first: 100) { nodes { id price compareAtPrice } } } pageInfo { hasNextPage endCursor } } }`;
const M = `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { field message } } }`;

// hoogste bedrag op ,95 dat niet boven max ligt
function capAt95(max) {
  const cents = Math.floor(max * 100 + 1e-6);
  let whole = Math.floor((cents - 95) / 100);
  return Math.max(0, whole) + 0.95;
}

export async function priceCap(a, stores) {
  const store = findStore(stores, a.store);
  if (!store) return { ok: false, error: `Store "${a.store}" niet gevonden` };
  const maxPct = Number(a.max_pct);
  if (!(maxPct > 0 && maxPct < 100)) return { ok: false, error: "max_pct tussen 1 en 99" };
  const apply = a.apply === true;
  const factor = 100 / (100 - maxPct); // 50% -> compare-at max 2x prijs
  const started = Date.now();
  let after = a.cursor || null;
  let products = 0, variants = 0, changed = 0, productsChanged = 0;
  const examples = [], errors = [];
  for (;;) {
    const r = await storeGraphql(store, Q, { after });
    if (!r.ok) return { ok: false, error: r.error || "lezen mislukt", cursor: after };
    const page = r.data.products;
    for (const p of page.nodes) {
      products++;
      const upd = [];
      for (const v of p.variants.nodes) {
        variants++;
        const price = Number(v.price), cmp = v.compareAtPrice == null ? null : Number(v.compareAtPrice);
        if (!(price > 0) || cmp == null || !(cmp > price)) continue;
        const limit = price * factor;
        if (cmp <= limit + 1e-6) continue;
        let nc = capAt95(limit);
        if (!(nc > price)) nc = null; // geen zinnige doorgestreepte prijs meer
        upd.push({ id: v.id, compareAtPrice: nc == null ? null : nc.toFixed(2) });
        if (examples.length < 12) examples.push(`${p.title.slice(0, 40)}: ${price} (was ${cmp}) -> ${nc == null ? "geen" : nc.toFixed(2)}`);
      }
      if (upd.length) {
        productsChanged++;
        changed += upd.length;
        if (apply) {
          const u = await storeGraphql(store, M, { p: p.id, v: upd });
          const ue = (u.ok && u.data && u.data.productVariantsBulkUpdate && u.data.productVariantsBulkUpdate.userErrors) || [];
          if (!u.ok || ue.length) errors.push(`${p.title.slice(0, 40)}: ${u.error || ue.map((x) => x.message).join("; ")}`);
        }
      }
    }
    after = page.pageInfo.endCursor;
    if (!page.pageInfo.hasNextPage) return { ok: true, done: true, apply, products, variants, changed, productsChanged, examples, errors: errors.slice(0, 20) };
    if (Date.now() - started > 230000) return { ok: true, done: false, cursor: after, apply, products, variants, changed, productsChanged, examples, errors: errors.slice(0, 20) };
  }
}
