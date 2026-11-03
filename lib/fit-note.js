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
  /\b(shoes?|boots?|booties|sneakers?|trainers?|sandals?|slides|loafers?|heels?|pumps|flats|mules|clogs|slippers?|moccasins?|oxfords?|bags?|handbags?|purses?|totes?|backpacks?|wallets?|clutch|crossbody|hats?|caps?|beanies?|berets?|scarf|scarves|belts?|gloves?|socks?|jewel(le)?ry|necklaces?|earrings?|bracelets?|rings?|watch(es)?|sunglasses|umbrella|keychain|hair clip|scrunchie)\b/i;

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
export function pickSize(sizes, gender, build) {
  const list = (sizes || []).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  const want = build === "plus" ? 5 : build === "petite" ? 1 : gender === "man" ? 3 : 2; // XL / XS / M / S
  const lettered = list.map((v) => ({ v, i: letterIndex(v) })).filter((x) => x.i >= 0);
  if (lettered.length >= Math.ceil(list.length / 2)) {
    let best = lettered[0];
    for (const x of lettered) if (Math.abs(x.i - want) < Math.abs(best.i - want) || (Math.abs(x.i - want) === Math.abs(best.i - want) && x.i > best.i)) best = x;
    return best.v;
  }
  // numerieke maten (jeans 26–34, US 2–16, AU 6–18): positie in de reeks
  const pos = build === "plus" ? 0.8 : build === "petite" ? 0.1 : gender === "man" ? 0.4 : 0.3;
  return list[Math.min(list.length - 1, Math.round((list.length - 1) * pos))];
}
const RANGE = {
  woman: { standard: [168, 180, 175], petite: [157, 165, 162], tall: [178, 185, 180], plus: [163, 175, 170] },
  man: { standard: [180, 191, 185], petite: [170, 178, 175], tall: [188, 196, 190], plus: [175, 188, 183] },
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
- build: "petite", "standard", "tall" or "plus" — plus = clearly curvy/plus-size model.
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
    const build = a && ["petite", "standard", "tall", "plus"].includes(a.build) ? a.build : "standard";
    const height = model ? pickHeight(gender, build, a && a.height_cm) : null;
    const size = model ? pickSize(sizes, gender, build) : "";
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
