// MERKNAAM OMZETTEN IN POLICIES EN PAGINA'S (26-11-2026) — voor een domein- of naamswitch (zoals
// Lady Glam Boutique → Season of Style). Zoek/vervang over de shop policies en alle pagina's van één
// store. Standaard een proefdraai: per policy en pagina hoeveel er zou veranderen, met voorbeelden.
// apply: true schrijft het weg. Achter de gewone login (/api/rebrand).
// replace: [[van, naar], ...]; een derde waarde "re" maakt van "van" een reguliere expressie.
import { findStore } from "./claude-link";
import { storeGraphql } from "./shopify";

const Q_POL = `{ shop { name email contactEmail shopPolicies { type title body } } }`;
const Q_PAGES = `query($after: String) { pages(first: 100, after: $after) { nodes { id title handle body } pageInfo { hasNextPage endCursor } } }`;
const M_POL = `mutation($p: ShopPolicyInput!) { shopPolicyUpdate(shopPolicy: $p) { shopPolicy { type } userErrors { field message } } }`;
const M_PAGE = `mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id } userErrors { field message } } }`;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compile(pairs) {
  return (Array.isArray(pairs) ? pairs : [])
    .filter((p) => Array.isArray(p) && p[0])
    .map(([from, to, kind]) => [new RegExp(kind === "re" ? from : esc(from), "g"), String(to == null ? "" : to)]);
}

function swap(text, rules) {
  let out = String(text || "");
  let n = 0;
  const ex = [];
  for (const [re, to] of rules) {
    out = out.replace(re, (m) => {
      n++;
      if (ex.length < 3 && !ex.includes(`${m} → ${to}`)) ex.push(`${m} → ${to}`);
      return to;
    });
  }
  return { out, n, ex };
}

const errs = (r, key) => (r.ok ? (r.data && r.data[key] && r.data[key].userErrors) || [] : [{ message: r.error }]);

export async function rebrand(a, stores) {
  const store = findStore(stores, a.store);
  if (!store) return { ok: false, error: `Store "${a.store}" niet gevonden` };
  const rules = compile(a.replace);
  if (!rules.length) return { ok: false, error: 'Geef replace: [["van", "naar"], ...]' };
  const doIt = a.apply === true;
  const res = { ok: true, apply: doIt, policies: [], pages: [] };

  const p = await storeGraphql(store, Q_POL, {});
  if (!p.ok) return { ok: false, error: p.error };
  const shop = p.data.shop;
  res.shop = { name: shop.name, email: shop.email, contactEmail: shop.contactEmail };

  for (const pol of shop.shopPolicies || []) {
    const r = swap(pol.body, rules);
    const row = { type: pol.type, hits: r.n, ex: r.ex };
    if (doIt && r.n) {
      const e = errs(await storeGraphql(store, M_POL, { p: { type: pol.type, body: r.out } }), "shopPolicyUpdate");
      row.saved = !e.length;
      if (e.length) row.error = e.map((x) => x.message).join("; ");
    }
    res.policies.push(row);
  }

  let after = null;
  for (let i = 0; i < 5; i++) {
    const q = await storeGraphql(store, Q_PAGES, { after });
    if (!q.ok) { res.pagesError = q.error; break; }
    for (const pg of q.data.pages.nodes) {
      const rb = swap(pg.body, rules);
      const rt = swap(pg.title, rules);
      if (!rb.n && !rt.n) continue;
      const row = { handle: pg.handle, hits: rb.n + rt.n, ex: rb.ex.concat(rt.ex).slice(0, 3) };
      if (doIt) {
        const page = {};
        if (rb.n) page.body = rb.out;
        if (rt.n) page.title = rt.out;
        const e = errs(await storeGraphql(store, M_PAGE, { id: pg.id, page }), "pageUpdate");
        row.saved = !e.length;
        if (e.length) row.error = e.map((x) => x.message).join("; ");
      }
      res.pages.push(row);
    }
    if (!q.data.pages.pageInfo.hasNextPage) break;
    after = q.data.pages.pageInfo.endCursor;
  }
  return res;
}
