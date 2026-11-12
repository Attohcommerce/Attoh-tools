// FITNOTE (Store Doctor, 03-11-2026)
//
// Justin: "Model is 5'9" (175 cm) and wears size S" — alleen bij producten
// waar een model het product DRAAGT (geen schoenen, tassen, petjes …).
// Opslag = twee product-metafields, net als de maattabel:
//   custom.model_height_cm  (number_integer)       175
//   custom.model_size       (single_line_text_field) "S"
// Zo is elke fitnote in de Shopify-admin met één tik aan te passen. De
// Liquid-snippet op de productpagina leest die twee velden (zie
// snippets/fit-note.liquid in de projectdocs) en toont ft/in in de VS, cm elders.
//
//   scanFitNotes   → welke kleding-producten hebben nog geen fitnote
//   analyzeFitNotes→ AI kijkt naar de foto's: draagt een model het product?
//                    geslacht, postuur, geschatte lengte → voorstel lengte + maat
//   writeFitNotes  → metafields schrijven (of wissen)
import { storeRequest, storeGraphql, listProductsByIds, setProductMetafields, deleteProductMetafields } from "./shopify";
import { getClient, addAiUsage, thumb, CHEAP_MODEL, emptyAiUsage } from "./ai";
import { storeGendersOf } from "./store-gender";

export const NS = "custom";
export const KEY_HEIGHT = "model_height_cm";
export const KEY_SIZE = "model_size";

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Geen model nodig: schoenen, tassen, hoofddeksels, accessoires
const NO_MODEL_RE =
  /\b(shoes?|boots?|booties|sneakers?|trainers?|sandals?|slides?|flip[ -]?flops?|loafers?|heels?|pumps|flats|mules|clogs|slippers?|moccasins?|oxfords?|bags?|handbags?|purses?|totes?|backpacks?|wallets?|clutch|crossbody|hats?|caps?|beanies?|berets?|scarf|scarves|belts?|gloves?|socks?|jewel(le)?ry|necklaces?|earrings?|bracelets?|rings?|watch(es)?|sunglasses|umbrella|keychain|hair clip|scrunchie)\b/i;

export function needsModel(p) {
  const t = `${p.product_type || ""} ${String(p.title || "").split("|")[0]}`.replace(/\bcap[\s-]?sleeves?\b|\bbelted\b|\bboot[\s-]?cut\b/gi, " ");
  return !NO_MODEL_RE.test(t);
}

function sizeOption(p) {
  const opts = p.options || [];
  const o = opts.find((x) => /^(size|maat|größe|taille)$/i.test(String(x.name || "").trim())) || opts.find((x) => /size/i.test(String(x.name || "")));
  return o ? (o.values || []).map((v) => String(v).trim()).filter(Boolean) : [];
}

async function shopReq(store, path) {
  let r;
  for (let i = 0; i < 6; i++) {
    r = await storeRequest(store, path);
    if (r.ok) return r;
    if (!(r.status === 429 || /exceeded|too many|throttl/i.test(String(r.error || "")))) return r;
    await sleep(800 + i * 700);
  }
  return r;
}

/* Alle producten (actief + draft) met de huidige fitnote-waarden. */
async function allProducts(store, max = 3000) {
  const out = [];
  let since = 0;
  for (let page = 0; page < Math.ceil(max / 250); page++) {
    const r = await shopReq(store, `/products.json?limit=250&since_id=${since}&fields=id,title,product_type,status,options,image`);
    if (!r.ok) throw httpErr(r.status || 500, `Shopify: ${r.error}`);
    const list = (r.data && r.data.products) || [];
    out.push(...list.filter((p) => p.status !== "archived"));
    if (list.length < 250) break;
    since = list[list.length - 1].id;
    await sleep(500);
  }
  return out;
}
async function fitValues(store) {
  const q = `query Fit($after: String) {
    products(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id h: metafield(namespace: "${NS}", key: "${KEY_HEIGHT}") { value } s: metafield(namespace: "${NS}", key: "${KEY_SIZE}") { value } }
    }
  }`;
  const map = new Map();
  let after = null;
  for (let i = 0; i < 20; i++) {
    const r = await storeGraphql(store, q, { after });
    if (!r.ok) throw httpErr(500, `Shopify: ${r.error}`);
    const d = r.data && r.data.products;
    for (const n of (d && d.nodes) || []) {
      if (n.h || n.s) map.set(String(n.id).split("/").pop(), { height: n.h ? Number(n.h.value) : null, size: n.s ? n.s.value : "" });
    }
    if (!d || !d.pageInfo.hasNextPage) break;
    after = d.pageInfo.endCursor;
  }
  return map;
}

/** Overzicht: hoeveel kledingstukken, hoeveel met fitnote, welke missen. */
export async function scanFitNotes(store) {
  if (!store || !store.domain) throw httpErr(400, "Geen store");
  const [products, vals] = await Promise.all([allProducts(store), fitValues(store)]);
  const apparel = products.filter(needsModel);
  const rows = apparel.map((p) => {
    const v = vals.get(String(p.id));
    return {
      id: p.id,
      title: p.title,
      type: p.product_type || "",
      status: p.status,
      img: p.image && p.image.src ? thumbUrl(p.image.src, 120) : "",
      sizes: sizeOption(p),
      height: v ? v.height : null,
      size: v ? v.size : "",
    };
  });
  return {
    ok: true,
    total: products.length,
    skipped: products.length - apparel.length, // schoenen/tassen/accessoires
    apparel: apparel.length,
    withNote: rows.filter((r) => r.height && r.size).length,
    rows,
  };
}
function thumbUrl(src, w) {
  try {
    const u = new URL(src);
    u.searchParams.set("width", String(w));
    return u.toString();
  } catch {
    return src;
  }
}

/* ---------- voorstel: lengte + maat ---------- */
const LETTER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL", "4XL", "5XL"];
const norm = (s) => String(s || "").toUpperCase().replace(/\s+/g, "").replace(/^X{2}L$/, "XXL");
function letterIndex(v) {
  const n = norm(v).replace(/\(.*\)$/, "");
  const m = { XXS: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, "2XL": 6, XXXL: 7, "3XL": 7, "4XL": 8, "5XL": 9 };
  return n in m ? m[n] : -1;
}
/** Kies de maat die het model (logischerwijs) draagt, uit de maten van het product zelf. */
// Supplier (Mia, Kungfubuy, 03-11): tops/sweaters/jassen/jurken vallen 1 maat
// klein, broeken & jeans 1–2 maten (taille/heup) → bij broeken nog een stap extra.
export const BOTTOMS_RE = /\b(pants?|jeans|trousers?|chinos?|joggers?|sweatpants|leggings|slacks|cargos?|shorts|skirts?|skorts?)\b/i;
/* 09-11 Justin (EMC): "model moet ook een maatje groter dragen" → heren
   nu ook +2 (man normaal M → XL). MEN_STEP_OLD = de oude regel (+1), alleen
   nog nodig om oude fitnotes te herkennen (resizeFitNotes). */
export const MEN_STEP = 2;
export const MEN_STEP_OLD = 1;
/* 12-11 Justin (LGB): "Lijkt me onrealistisch dat zij een XL draagt" — slank
   model van 1,67 m met "wears size XL". De maat volgt nu het postuur dat je
   op de foto ZIET (slim / standard / curvy / plus), met de bestaande regel
   "model draagt een maatje groter" erin verwerkt. Doel per postuur:
     vrouw  petite S · slim M · standard L · tall M · curvy XL · plus 2XL
     man    petite L · slim L · standard XL (M + MEN_STEP) · tall XL · curvy XXL · plus XXL
   Een slank model krijgt dus nooit meer een XL. */
const WANT_WOMAN = { petite: 2, slim: 3, standard: 4, tall: 3, curvy: 5, plus: 6 };
const WANT_MAN = (menStep) => ({ petite: 4, slim: 4, standard: 3 + menStep, tall: 3 + menStep, curvy: 6, plus: 6 });
// numerieke maten (jeans 26–34, US 2–16): positie in de reeks per postuur
const POS_WOMAN = { petite: 0.3, slim: 0.45, standard: 0.6, tall: 0.45, curvy: 0.75, plus: 0.9 };
const POS_MAN = (menStep) => ({ petite: 0.5, slim: 0.5, standard: 0.4 + 0.15 * menStep, tall: 0.4 + 0.15 * menStep, curvy: 0.85, plus: 0.9 });
export const BUILDS = ["petite", "slim", "standard", "tall", "curvy", "plus"];
export function pickSize(sizes, gender, build, extra = 0, { menStep = MEN_STEP } = {}) {
  const list = (sizes || []).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  const b = BUILDS.includes(build) ? build : "standard";
  const want = (gender === "man" ? WANT_MAN(menStep)[b] : WANT_WOMAN[b]) + extra;
  const lettered = list.map((v) => ({ v, i: letterIndex(v) })).filter((x) => x.i >= 0);
  if (lettered.length >= Math.ceil(list.length / 2)) {
    let best = lettered[0];
    for (const x of lettered) if (Math.abs(x.i - want) < Math.abs(best.i - want) || (Math.abs(x.i - want) === Math.abs(best.i - want) && x.i > best.i)) best = x;
    return best.v;
  }
  const pos = Math.min(0.95, (gender === "man" ? POS_MAN(menStep)[b] : POS_WOMAN[b]) + extra * 0.15);
  return list[Math.min(list.length - 1, Math.round((list.length - 1) * pos))];
}
const RANGE = {
  woman: { standard: [165, 178, 170], slim: [165, 180, 172], petite: [155, 164, 160], tall: [176, 185, 179], curvy: [160, 175, 168], plus: [160, 175, 167] },
  man: { standard: [178, 191, 184], slim: [176, 191, 183], petite: [170, 178, 175], tall: [188, 196, 190], curvy: [176, 190, 182], plus: [176, 190, 182] }, // 03-11: herenmodellen meestal 1,83–1,85
};
export function pickHeight(gender, build, est) {
  const r = (RANGE[gender] || RANGE.woman)[build] || (RANGE[gender] || RANGE.woman).standard;
  const e = Number(est);
  return Number.isFinite(e) && e > 0 ? Math.round(Math.min(r[1], Math.max(r[0], e))) : r[2];
}
export function heightLabel(cm) {
  const inch = Math.round(cm / 2.54);
  return `${Math.floor(inch / 12)}'${inch % 12}" (${cm} cm)`;
}

function parseJson(text) {
  const s = String(text || "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) return {};
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return {};
  }
}

/** AI: draagt een zichtbaar model het product? + postuur + geschatte lengte. */
async function modelBatch(items) {
  const ai = emptyAiUsage();
  const content = [];
  for (const it of items) {
    content.push({ type: "text", text: `ITEM ${it.index} — "${it.title}"` });
    for (const u of it.urls.slice(0, 2)) content.push({ type: "image", source: { type: "url", url: thumb(u, 420) } });
  }
  content.push({
    type: "text",
    text: `For every item return ONLY JSON: {"results":[{"index":0,"model":true,"person":"woman","build":"standard","height_cm":175,"sure":0.9}]}
- model: true ONLY if a real person is visibly WEARING the product being sold (full or partial body). false for flat lays, mannequins, ghost/invisible mannequin, product-only shots, or if the person only holds it.
- person: "woman" or "man" (who wears it).
- build: "petite" (short, small frame), "slim" (slender / thin, typical fashion-model figure), "standard" (average body, neither slim nor full), "tall" (clearly tall and slender), "curvy" (fuller bust/hips, clearly rounder figure) or "plus" (plus-size). Judge the body you SEE, not the clothing size.
- height_cm: your best estimate of the model's height from body proportions and surroundings (fashion models are usually 170-180 cm women, 183-190 cm men).
- sure: 0-1 confidence that a model wears the product.`,
  });
  const res = await getClient().messages.create({
    model: CHEAP_MODEL,
    max_tokens: 800,
    system: "You check fashion product photos. Report only what you SEE. Return ONLY the JSON object.",
    messages: [{ role: "user", content }],
  });
  addAiUsage(ai, CHEAP_MODEL, res);
  const out = parseJson(res.content.map((c) => c.text || "").join(""));
  return { results: Array.isArray(out.results) ? out.results : [], ai };
}

/** ids (max ~8 per call) → voorstel per product. */
export async function analyzeFitNotes(store, ids) {
  if (!store || !store.domain) throw httpErr(400, "Geen store");
  const list = (ids || []).slice(0, 10);
  if (!list.length) return { ok: true, rows: [], aiUsd: 0 };
  const r = await listProductsByIds(store, list, "id,title,product_type,options,images");
  if (!r.ok) throw httpErr(422, `Shopify: ${r.error}`);
  const storeG = await storeGendersOf(store).catch(() => null);
  const products = (r.products || []).filter(needsModel);
  const items = products
    .map((p, i) => ({
      index: i,
      title: String(p.title || "").slice(0, 90),
      urls: (p.images || []).slice(0, 2).map((im) => im.src).filter((u) => typeof u === "string" && /^https?:\/\//.test(u)),
    }))
    .filter((x) => x.urls.length);
  const out = items.length ? await modelBatch(items) : { results: [], ai: { usd: 0 } };
  const byIndex = new Map(out.results.filter((x) => Number.isInteger(x.index)).map((x) => [x.index, x]));
  const rows = products.map((p, i) => {
    const a = byIndex.get(i);
    const sizes = sizeOption(p);
    const model = !!(a && a.model && (a.sure == null || Number(a.sure) >= 0.6));
    let gender = a && (a.person === "man" || a.person === "woman") ? a.person : null;
    if (storeG === "M") gender = "man";
    else if (storeG === "V") gender = "woman";
    else if (!gender) gender = /\bmen'?s\b/i.test(p.title) && !/women/i.test(p.title) ? "man" : "woman";
    const build = a && BUILDS.includes(a.build) ? a.build : "standard";
    const height = model ? pickHeight(gender, build, a && a.height_cm) : null;
    const bottoms = BOTTOMS_RE.test(`${p.product_type || ""} ${String(p.title || "").split("|")[0]}`);
    void bottoms; // broeken vallen 1–2 maten klein → +2 dekt dat al
    const size = model ? pickSize(sizes, gender, build, 0) : "";
    return {
      id: p.id,
      title: p.title,
      model,
      gender,
      build,
      sizes,
      height,
      size,
      label: model && height && size ? `Model is ${heightLabel(height)} and wears size ${size}` : "",
      why: !a ? "geen foto beoordeeld" : model ? "" : "geen model dat het product draagt",
    };
  });
  return { ok: true, rows, aiUsd: out.ai.usd || 0 };
}

let defsDone = new Set();
async function ensureDefs(store) {
  const key = String(store.domain).toLowerCase();
  if (defsDone.has(key)) return;
  const m = `mutation D($d: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $d) { createdDefinition { id } userErrors { message code } } }`;
  const defs = [
    { namespace: NS, key: KEY_HEIGHT, name: "Fitnote — model height (cm)", type: "number_integer", description: "Lengte van het model in cm (Store Doctor → Fitnotes). Leeg = geen fitnote." },
    { namespace: NS, key: KEY_SIZE, name: "Fitnote — model wears size", type: "single_line_text_field", description: "Maat die het model draagt, bv. S. Leeg = geen fitnote." },
  ];
  for (const d of defs) {
    const r = await storeGraphql(store, m, { d: { ...d, ownerType: "PRODUCT", pin: true, access: { storefront: "PUBLIC_READ" } } });
    const ue = (r.ok && r.data && r.data.metafieldDefinitionCreate && r.data.metafieldDefinitionCreate.userErrors) || [];
    const bad = ue.filter((u) => !/TAKEN|already|exists|in use/i.test(`${u.code || ""} ${u.message || ""}`));
    if (!r.ok || bad.length) {
      // pin/access kan op oudere API-versies ontbreken → zonder opnieuw
      const r2 = await storeGraphql(store, m, { d: { ...d, ownerType: "PRODUCT" } });
      const ue2 = (r2.ok && r2.data && r2.data.metafieldDefinitionCreate && r2.data.metafieldDefinitionCreate.userErrors) || [];
      const bad2 = ue2.filter((u) => !/TAKEN|already|exists|in use/i.test(`${u.code || ""} ${u.message || ""}`));
      if (!r2.ok || bad2.length) throw httpErr(500, `Metafield-definitie ${d.key}: ${r2.error || bad2.map((u) => u.message).join("; ")}`);
    }
  }
  defsDone.add(key);
}

/** rows: [{id, height, size}] — height/size leeg = fitnote wissen. */
export async function writeFitNotes(store, rows) {
  if (!store || !store.domain) throw httpErr(400, "Geen store");
  const set = [];
  const del = [];
  for (const r of rows || []) {
    const h = Math.round(Number(r.height));
    const s = String(r.size || "").trim().slice(0, 30);
    if (h >= 120 && h <= 220 && s) {
      set.push({ productId: r.id, namespace: NS, key: KEY_HEIGHT, type: "number_integer", value: String(h) });
      set.push({ productId: r.id, namespace: NS, key: KEY_SIZE, type: "single_line_text_field", value: s });
    } else {
      del.push({ productId: r.id, namespace: NS, key: KEY_HEIGHT }, { productId: r.id, namespace: NS, key: KEY_SIZE });
    }
  }
  if (set.length) await ensureDefs(store);
  const w = set.length ? await setProductMetafields(store, set) : { written: 0, errors: [] };
  const d = del.length ? await deleteProductMetafields(store, del) : { deleted: 0, errors: [] };
  return {
    ok: !w.errors.length && !d.errors.length,
    saved: set.length / 2,
    cleared: del.length / 2,
    errors: [...w.errors, ...d.errors].slice(0, 10),
  };
}

/* ---------- Maattabellen: "valt 1 maat klein" (03-11-2026) ----------
   Justin: in ALLE maattabellen (custom.size_guide) zetten dat het product
   1 maat klein valt en dat je 1 maat groter moet nemen. Nooit "Asian sizes"
   noemen. Schoenen blijven "true to size". De pop-up toont guide.fit als
   fit-balk en guide.note als tekst. */
// 03-11: geen "runs one size small" (klant haakt af) → zachte woordkeuze.
// fit "snug" = bolletje op 75% tussen "Runs small" en "True to size" (theme-snippet size-guide.liquid).
export const SMALL_NOTE = "Runs snug — choose one size up for your desired fit.";
const OLD_NOTES = [/Fits slightly snug — we recommend sizing up for a comfortable fit\.?/i, /Runs one size small — we recommend ordering one size up\.?/i, /Body measurements\.?/i, /Between two sizes\? Choose the larger one\.?/i];
const SG = { ns: "custom", key: "size_guide" };
function isShoeGuide(g) {
  return g && (g.family === "shoes" || g.kind === "shoes");
}
export function markSmall(g) {
  if (!g || typeof g !== "object" || isShoeGuide(g)) return null;
  let rest = String(g.note || "").replace(SMALL_NOTE, "");
  for (const re of OLD_NOTES) rest = rest.replace(re, "");
  rest = rest.replace(/\s+/g, " ").trim().replace(/[—–-]\s*$/, "").trim();
  const note = [SMALL_NOTE, rest].filter(Boolean).join(" ");
  if (g.fit === "snug" && g.note === note) return null;
  return { ...g, fit: "snug", note };
}
async function allGuides(store) {
  const q = `query G($after: String) {
    products(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id mf: metafield(namespace: "${SG.ns}", key: "${SG.key}") { value } }
    }
  }`;
  const out = [];
  let after = null;
  for (let i = 0; i < 20; i++) {
    const r = await storeGraphql(store, q, { after });
    if (!r.ok) throw httpErr(500, `Shopify: ${r.error}`);
    const d = r.data && r.data.products;
    for (const n of (d && d.nodes) || []) {
      if (!n.mf || !n.mf.value) continue;
      let g = null;
      try {
        g = JSON.parse(n.mf.value);
      } catch {}
      if (g) out.push({ id: String(n.id).split("/").pop(), g });
    }
    if (!d || !d.pageInfo.hasNextPage) break;
    after = d.pageInfo.endCursor;
  }
  return out;
}
/** Telt: maattabellen, schoenen, al op "valt klein", nog te doen. */
export async function scanSizeCharts(store) {
  const all = await allGuides(store);
  const shoes = all.filter((x) => isShoeGuide(x.g)).length;
  const todo = all.filter((x) => markSmall(x.g)).map((x) => x.id);
  return { ok: true, total: all.length, shoes, done: all.length - shoes - todo.length, todo };
}
/** Zet max 100 maattabellen per call op "valt 1 maat klein". */
export async function applySizeChartsSmall(store, ids) {
  const want = new Set((ids || []).slice(0, 100).map(String));
  const all = (await allGuides(store)).filter((x) => want.has(x.id));
  const entries = [];
  for (const x of all) {
    const g2 = markSmall(x.g);
    if (g2) entries.push({ productId: x.id, namespace: SG.ns, key: SG.key, type: "json", value: JSON.stringify(g2) });
  }
  const w = entries.length ? await setProductMetafields(store, entries) : { written: 0, errors: [] };
  return { ok: !w.errors.length, updated: w.written || 0, errors: w.errors.slice(0, 5) };
}

/** 12-11: fitnote voor een NIEUWE AI-foto (foto-wachtrij) — kijkt naar de foto
 *  zelf (postuur + lengte), niet naar het profiel uit de prompt: de generator
 *  maakt soms een slank model van een "curvy" profiel. null = geen oordeel. */
export async function fitFromPhoto(store, productId, imageUrl, gender) {
  if (!store || !productId || !/^https?:\/\//.test(String(imageUrl || ""))) return null;
  const r = await listProductsByIds(store, [productId], "id,title,product_type,options");
  const p = r.ok && (r.products || [])[0];
  if (!p || !needsModel(p)) return null;
  const out = await modelBatch([{ index: 0, title: String(p.title || "").slice(0, 90), urls: [imageUrl] }]);
  const a = (out.results || []).find((x) => x.index === 0);
  if (!a || !a.model || (a.sure != null && Number(a.sure) < 0.6)) return null;
  const g = gender === "man" || gender === "woman" ? gender : a.person === "man" ? "man" : "woman";
  const build = BUILDS.includes(a.build) ? a.build : "standard";
  const size = pickSize(sizeOption(p), g, build, 0);
  const height = pickHeight(g, build, a.height_cm);
  return size && height ? { height, size, build, aiUsd: (out.ai && out.ai.usd) || 0 } : null;
}

/** Importer (03-11): na het importeren meteen fitnote checken + zetten.
 *  Alleen als een model het product draagt; bestaande fitnote blijft staan. */
export async function autoFitNotes(store, ids) {
  const a = await analyzeFitNotes(store, ids);
  const rows = a.rows.filter((r) => r.model && r.height && r.size);
  const w = rows.length ? await writeFitNotes(store, rows.map((r) => ({ id: r.id, height: r.height, size: r.size }))) : { saved: 0, errors: [] };
  return {
    ok: !(w.errors && w.errors.length),
    aiUsd: a.aiUsd || 0,
    results: a.rows.map((r) => ({ id: r.id, set: !!(r.model && r.height && r.size), label: r.label, why: r.why })),
    errors: w.errors || [],
  };
}

/* ---------- Bestaande heren-fitnotes één maat groter (09-11-2026) ----------
   Justin (EMC): "model moet ook een maatje groter dragen" — de fitnotes die
   al met de oude regel (+1) zijn gezet, schuiven één maat op. Alleen als de
   huidige maat PRECIES is wat de oude regel koos (dus nooit handwerk
   overschrijven), lengte blijft staan. Nog een keer draaien doet niets. */
function storeManOnly(p, storeG) {
  if (storeG === "M") return true;
  if (storeG === "V") return false;
  return /\bmen'?s\b/i.test(p.title) && !/women/i.test(p.title);
}
export async function resizeFitNotes(store, { dryRun = true } = {}) {
  if (!store || !store.domain) throw httpErr(400, "Geen store");
  const [products, vals, storeG] = await Promise.all([allProducts(store), fitValues(store), storeGendersOf(store).catch(() => null)]);
  const same = (a, b) => norm(a) === norm(b);
  const rows = [];
  let men = 0;
  let manual = 0;
  for (const p of products.filter(needsModel)) {
    const v = vals.get(String(p.id));
    if (!v || !v.height || !v.size || !storeManOnly(p, storeG)) continue;
    men++;
    const sizes = sizeOption(p);
    let hit = null;
    for (const build of ["standard", "plus", "petite"]) {
      const old = pickSize(sizes, "man", build, 0, { menStep: MEN_STEP_OLD });
      const nw = pickSize(sizes, "man", build, 0, { menStep: MEN_STEP });
      if (old && nw && same(old, v.size) && !same(nw, v.size)) {
        hit = { build, from: v.size, to: nw };
        break;
      }
    }
    if (!hit) {
      manual++;
      continue;
    }
    rows.push({ id: p.id, title: p.title, height: v.height, from: hit.from, size: hit.to });
  }
  if (dryRun || !rows.length) return { ok: true, dryRun: true, men, todo: rows.length, untouched: manual, rows: rows.slice(0, 400) };
  let saved = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += 100) {
    const w = await writeFitNotes(store, rows.slice(i, i + 100).map((r) => ({ id: r.id, height: r.height, size: r.size })));
    saved += w.saved || 0;
    errors.push(...(w.errors || []));
  }
  return { ok: !errors.length, dryRun: false, men, todo: rows.length, saved, untouched: manual, errors: errors.slice(0, 10), rows: rows.slice(0, 400) };
}
