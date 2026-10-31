/* WIJZIGINGSPLAN (31-10-2026) — algemene fixes over een hele store, net als
   het prijsplan: Claude loopt de store na, schrijft een plan naar
   public/change-plans/<naam>.json en Justin zet het door in Store Doctor.

   Dit bestand is PUUR (geen Shopify-calls): het rekent per product uit wat
   er moet veranderen. Het doorvoeren zit in lib/doctor.js (fix
   "apply-change-plan"), de knoppen in components/DoctorPanel.js.

   ── Plan-formaat ──────────────────────────────────────────────────────
   {
     "kind": "change-plan", "version": 1,
     "name": "cc-2026-10-31", "store": "Clove & Cloth", "domain": "cloveandcloth.com",
     "date": "2026-10-31", "note": "korte uitleg",
     "groups": [ { "id": "gender", "label": "…", "desc": "…", "default": true } ],
     "items": [ {
       "id": 1234567890,              // Shopify product-ID
       "title": "huidige titel",      // alleen voor de weergave
       "group": "gender",             // hoort bij één groep (aan/uit te vinken)
       "why": "titel zegt Men's, tags zeggen Women",
       "set":  { "title": "…", "product_type": "…", "status": "draft", "handle": "…", "vendor": "…", "template_suffix": "…" },
       "from": { …dezelfde velden: de waarde die Claude zag… },
       "tagsAdd": ["Men", "Men's Jeans"], "tagsRemove": ["Women", "Jeans"],
       "options": [ { "position": 1, "from": "Colours", "to": "Color" } ],
       "values":  [ { "position": 2, "option": "Size", "from": "XS (Almost sold out)", "to": "XS" } ],
       "body":    [ { "find": "women's", "replace": "men's" } ],   // hele woorden, hoofdletters blijven
       "metafields": [ { "namespace": "custom", "key": "size_guide", "type": "json", "value": "…" } ]
     } ]
   }

   ── Veiligheid ────────────────────────────────────────────────────────
   - Velden met een "from": staat de huidige waarde al op de nieuwe → niets
     doen; wijkt hij af van "from" → heeft iemand het intussen veranderd →
     het HELE product wordt overgeslagen (nooit iemands handwerk overschrijven).
   - Tags: alleen toevoegen/weghalen wat in het plan staat, de rest blijft.
   - Optie-namen/-waarden: een wijziging die twee varianten zou samenvoegen
     (de nieuwe waarde bestaat al) wordt geweigerd.
   - Terugdraaien = hetzelfde plan omgekeerd (set ↔ from, add ↔ remove);
     alleen waar de huidige waarde nog precies de plan-waarde is.
     Omschrijving en metafields gaan niet automatisch terug — de oude
     waarde staat in het backup-tabblad. */

export const CP_FIELDS = ["title", "product_type", "vendor", "status", "template_suffix", "handle"];
const LABEL = {
  title: "titel",
  product_type: "producttype",
  vendor: "vendor",
  status: "status",
  template_suffix: "template",
  handle: "url (handle)",
};

const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const cut = (s, n = 48) => {
  const t = clean(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function tagList(t) {
  const arr = Array.isArray(t) ? t : String(t || "").split(",");
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const v = String(x).trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}
const hasTag = (list, t) => list.some((x) => x.toLowerCase() === String(t).trim().toLowerCase());

/* Hele woorden, apostrof in elke vorm (' ’ &#39; &rsquo; &#8217;). */
const APOS = "(?:['’]|&#39;|&rsquo;|&#8217;)";
function wordRe(find) {
  const esc = String(find)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/'/g, APOS);
  return new RegExp(`(?<![A-Za-z])${esc}(?![A-Za-z])`, "gi");
}
// Vervanging in dezelfde schrijfwijze als het gevonden woord
function caseLike(found, repl) {
  let r = String(repl);
  const letters = found.replace(/[^A-Za-z]/g, "");
  if (letters && letters === letters.toUpperCase() && letters.length > 1) r = r.toUpperCase();
  else if (/^[A-Z]/.test(found)) r = r.charAt(0).toUpperCase() + r.slice(1);
  else r = r.charAt(0).toLowerCase() + r.slice(1);
  const ap = found.match(/’|&#39;|&rsquo;|&#8217;/);
  if (ap) r = r.replace(/'/g, ap[0]);
  return r;
}
export function replaceWords(html, ops) {
  let out = String(html || "");
  let n = 0;
  for (const b of ops || []) {
    if (!b || !b.find) continue;
    out = out.replace(wordRe(b.find), (m) => {
      n++;
      return caseLike(m, b.replace || "");
    });
  }
  return { html: out, n };
}

/** Alle items van de aangevinkte groepen samenvoegen tot één wijziging per product.
 *  → { ids: [productId…], map: { [id]: wijziging }, count: aantal items } */
export function mergePlanItems(plan, groupIds) {
  const want = new Set(groupIds || []);
  const map = {};
  const ids = [];
  let count = 0;
  for (const it of (plan && plan.items) || []) {
    if (!it || it.id == null) continue;
    if (want.size && !want.has(it.group)) continue;
    count++;
    const id = String(it.id);
    if (!map[id]) {
      map[id] = { set: {}, from: {}, tagsAdd: [], tagsRemove: [], options: [], values: [], body: [], metafields: [], why: [] };
      ids.push(id);
    }
    const m = map[id];
    Object.assign(m.set, it.set || {});
    Object.assign(m.from, it.from || {});
    m.tagsAdd.push(...(it.tagsAdd || []));
    m.tagsRemove.push(...(it.tagsRemove || []));
    m.options.push(...(it.options || []));
    m.values.push(...(it.values || []));
    m.body.push(...(it.body || []));
    m.metafields.push(...(it.metafields || []));
    if (it.why) m.why.push(it.why);
  }
  return { ids, map, count };
}

/** Hoeveel producten per groep (voor de vinkjes). */
export function groupCounts(plan) {
  const out = {};
  for (const it of (plan && plan.items) || []) {
    if (!it || it.id == null) continue;
    (out[it.group] = out[it.group] || new Set()).add(String(it.id));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.size]));
}

/** Plan voor de juiste store? (zelfde soepele vergelijking als het prijsplan) */
export function planMatchesStore(plan, store) {
  if (!plan || !store) return true;
  const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hay = squash(`${store.name || ""} ${store.domain || ""} ${store.publicDomain || ""}`);
  const want = squash(String(plan.domain || "").replace(/\.(com|co\.uk|com\.au|nl)$/i, ""));
  const name = squash(plan.store);
  if (!want && !name) return true;
  return (want && (hay.includes(want) || hay.includes(want.slice(0, 8)))) || (name && hay.includes(name));
}

/**
 * Wat moet er bij dit product veranderen?
 *  p   = Shopify REST-product (vers opgehaald, met body_html; p.__mf = huidige metafields)
 *  ch  = samengevoegde wijziging uit mergePlanItems
 *  → { conflict, touched, payload, lines[], metafields[] }
 *     conflict = reden om het hele product over te slaan (null = ok)
 *     payload  = velden voor de product-PUT (Shopify-valkuilen al afgevangen)
 */
export function computeChange(p, ch, opts = {}) {
  const revert = !!opts.revert;
  const lines = [];
  const payload = {};
  const set = (ch && ch.set) || {};
  const from = (ch && ch.from) || {};
  const res = (conflict) => ({ conflict, touched: false, payload: {}, lines: [], metafields: [] });

  // 1 · losse velden
  for (const f of CP_FIELDS) {
    if (!(f in set)) continue;
    const target = revert ? from[f] : set[f];
    const expect = revert ? set[f] : from[f];
    if (target === undefined || target === null) continue; // bij terugdraaien zonder bekende oude waarde
    const cur = p[f] == null ? "" : String(p[f]);
    if (clean(cur) === clean(target)) continue; // stond al goed
    if (expect !== undefined && expect !== null && clean(cur) !== clean(expect)) {
      return res(`${LABEL[f]} is intussen veranderd ("${cut(cur)}" i.p.v. "${cut(expect)}")`);
    }
    payload[f] = String(target);
    lines.push(`${LABEL[f]}: "${cut(cur, 36)}" → "${cut(target, 36)}"`);
  }

  // 2 · tags (alleen wat in het plan staat)
  const add = tagList(revert ? ch.tagsRemove : ch.tagsAdd);
  const rem = tagList(revert ? ch.tagsAdd : ch.tagsRemove);
  if (add.length || rem.length) {
    const orig = tagList(p.tags);
    let next = orig.filter((t) => !hasTag(rem, t));
    for (const t of add) if (!hasTag(next, t)) next.push(t);
    const plus = add.filter((t) => !hasTag(orig, t));
    const min = rem.filter((t) => hasTag(orig, t));
    if (plus.length || min.length) {
      payload.tags = next.join(", ");
      lines.push(`tags: ${[...plus.map((t) => `+${t}`), ...min.map((t) => `−${t}`)].join(" ")}`);
    }
  }

  // 3 · optie-namen
  const options = (p.options || []).map((o) => ({ id: o.id, name: String(o.name || ""), position: o.position }));
  let optChanged = false;
  for (const op of (ch && ch.options) || []) {
    const a = revert ? op.to : op.from;
    const b = revert ? op.from : op.to;
    if (!a || !b) continue;
    const iA = options.findIndex((o) => clean(o.name) === clean(a));
    const iB = options.findIndex((o) => clean(o.name).toLowerCase() === clean(b).toLowerCase());
    if (iA < 0 && iB >= 0) continue; // al hernoemd
    if (iA < 0) return res(`optie "${cut(a, 30)}" niet gevonden`);
    if (iB >= 0 && iB !== iA) return res(`er is al een optie "${b}"`);
    lines.push(`optie: "${cut(options[iA].name, 30)}" → "${b}"`);
    options[iA].name = String(b);
    optChanged = true;
  }

  // 4 · optie-waarden
  const vs = (p.variants || []).map((v) => ({ id: v.id, o: [v.option1, v.option2, v.option3], touched: false }));
  let valChanges = 0;
  for (const vo of (ch && ch.values) || []) {
    let idx = Number(vo.position) > 0 ? Number(vo.position) - 1 : -1;
    if (idx < 0 && vo.option) {
      idx = options.findIndex((o) => clean(o.name).toLowerCase() === clean(vo.option).toLowerCase());
    }
    if (idx < 0 || idx > 2) return res(`optie voor waarde "${cut(vo.from, 30)}" niet gevonden`);
    const a = revert ? vo.to : vo.from;
    const b = revert ? vo.from : vo.to;
    const hitsA = vs.filter((v) => v.o[idx] != null && clean(v.o[idx]) === clean(a));
    const hasB = vs.some((v) => v.o[idx] != null && clean(v.o[idx]) === clean(b));
    if (!hitsA.length && hasB) continue; // al gedaan
    if (!hitsA.length) return res(`waarde "${cut(a, 30)}" niet gevonden`);
    if (hasB) return res(`waarde "${cut(b, 30)}" bestaat al naast "${cut(a, 30)}" — zou varianten samenvoegen`);
    for (const v of hitsA) {
      v.o[idx] = String(b);
      v.touched = true;
    }
    valChanges++;
    lines.push(`${cut(options[idx] ? options[idx].name : `optie ${idx + 1}`, 20)}: "${cut(a, 30)}" → "${cut(b, 30)}"`);
  }
  if (optChanged || valChanges) {
    /* Shopify-valkuilen (zie translate-options in lib/doctor.js):
       1. een variants-array VERVANGT de hele set → altijd ALLE varianten mee,
          onaangeraakte als kale {id};
       2. raakt een variant één optie-waarde, dan wil Shopify ze ALLEMAAL. */
    payload.variants = vs.map((v) => {
      if (!v.touched) return { id: v.id };
      const nv = { id: v.id };
      if (v.o[0] != null) nv.option1 = v.o[0];
      if (v.o[1] != null) nv.option2 = v.o[1];
      if (v.o[2] != null) nv.option3 = v.o[2];
      return nv;
    });
    if (optChanged) payload.options = options.map((o) => ({ id: o.id, name: o.name }));
  }

  // 5 · omschrijving (alleen vooruit)
  const bodyOps = (ch && ch.body) || [];
  if (bodyOps.length) {
    if (revert) {
      lines.push("omschrijving: niet automatisch terug (oude tekst staat in het backup-tabblad)");
    } else {
      const r = replaceWords(p.body_html, bodyOps);
      if (r.n) {
        payload.body_html = r.html;
        lines.push(`omschrijving: ${r.n}× ${bodyOps.map((b) => `"${b.find}"→"${b.replace}"`).join(", ")}`);
      }
    }
  }

  // 6 · metafields (alleen vooruit, alleen als de waarde anders is)
  const mf = [];
  if (!revert) {
    for (const m of (ch && ch.metafields) || []) {
      if (!m || !m.namespace || !m.key) continue;
      const cur = p.__mf ? p.__mf[`${m.namespace}.${m.key}`] : undefined;
      if (cur != null && String(cur) === String(m.value)) continue;
      mf.push(m);
      lines.push(`metafield ${m.namespace}.${m.key}`);
    }
  } else if (((ch && ch.metafields) || []).length) {
    lines.push("metafields: niet automatisch terug (oude waarde staat in het backup-tabblad)");
  }

  const touched = Object.keys(payload).length > 0 || mf.length > 0;
  return { conflict: null, touched, payload, lines, metafields: mf };
}
