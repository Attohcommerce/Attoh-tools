// CATEGORIE-METAFIELDS + FIJNSTE SUBCATEGORIE (16-10-2026)
//
// Aanleiding (Justin, EMC-shorts): in de Shopify-admin staan onder
// "Category metafields" velden als Color, Fabric, Fit, Target gender, Age
// group, Size, Clothing features, Size type, Waist rise … en Shopify stelt
// een fijnere categorie voor ("Denim Shorts in Shorts" i.p.v. "Shorts").
// Die velden gaan als gestructureerde attributen de Google-feed in
// (gender/age_group/color/size/material) en voeden de filters op de store.
//
// Twee functies:
//   resolveCategory(store, p)        → { gid, name, base } — fijnste blad
//   fillCategoryMetafields(store, id) → zet alle afleidbare category-metafields
//
// Regel overal: LIEVER LEEG DAN FOUT. Een waarde wordt alleen gezet als hij
// uit de varianten (kleur/maat), het geslacht, of een expliciete frase in de
// titel/omschrijving komt. Geen gokken op losse woorden als "long" of "high".
//
// Techniek (Shopify, geverifieerd 16-10 op EMC):
//   - Attributen + toegestane waarden per categorie: node(id: TaxonomyCategory)
//     { attributes { ... on TaxonomyChoiceListAttribute { name values } } }
//   - Metafield: namespace "shopify", key = attribuutnaam in kebab-case
//     ("Target gender" → "target-gender"; Color → "color-pattern"),
//     type list.metaobject_reference.
//   - Elke waarde is een metaobject van type "shopify--<key>" met velden
//     label + taxonomy_reference (kleur: color_taxonomy_reference = lijst).
//   - Definities worden per store één keer aangezet via
//     standardMetaobjectDefinitionEnable / standardMetafieldDefinitionEnable.
//   - Scopes van de app: write_products + write_metaobjects +
//     write_metaobject_definitions.

import { storeGraphql, productGid } from "@/lib/shopify";
import { categoryFor, titleHead, CATEGORY_BAD_BRANCH_RE } from "@/lib/categories";

/* ---------------- tekst-hulpjes ---------------- */

const QUOTES_RE = /[‘’ʼ`´]/g;

export function normText(s) {
  return String(s || "")
    .replace(QUOTES_RE, "'")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, " and ")
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9.' ]/g, " ")
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(w) {
  if (w.length <= 3) return w;
  if (/sses$/.test(w)) return w.slice(0, -2); // dresses → dress
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}

const STOP = new Set(["and", "the", "of", "for", "with", "a", "in", "on", "men", "women", "mens", "womens"]);

function tokenSet(s) {
  const words = normText(s).split(" ").filter(Boolean).map(stem);
  const set = new Set(words.filter((w) => !STOP.has(w)));
  // samengestelde woorden: "board shorts" ↔ "Boardshorts"
  for (let i = 0; i < words.length - 1; i++) set.add(stem(words[i] + words[i + 1]));
  return set;
}

function hasPhrase(text, phrase) {
  const p = normText(phrase);
  if (!p) return false;
  return new RegExp(`(^| )${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?( |$)`).test(text);
}

/* ---------------- 1. fijnste subcategorie ---------------- */

const descendantsCache = new Map(); // base gid → [{id, fullName}]

async function categoryDescendants(store, gid) {
  if (descendantsCache.has(gid)) return descendantsCache.get(gid);
  const q = `query($id: ID!, $after: String) {
    taxonomy { categories(first: 250, descendantsOf: $id, after: $after) {
      nodes { id fullName }
      pageInfo { hasNextPage endCursor }
    } }
  }`;
  const out = [];
  let after = null;
  for (let page = 0; page < 4; page++) {
    const r = await storeGraphql(store, q, { id: gid, after });
    if (!r.ok) break;
    const c = r.data && r.data.taxonomy && r.data.taxonomy.categories;
    for (const n of (c && c.nodes) || []) out.push({ id: n.id, fullName: n.fullName });
    if (!c || !c.pageInfo || !c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  descendantsCache.set(gid, out);
  return out;
}

/**
 * refineCategory(store, base {gid,name}, text) → {gid, name}
 * Kiest het diepste onderliggende blad waarvan ALLE onderscheidende woorden
 * in de tekst staan ("Shorts" + "denim" → "Shorts > Denim Shorts"). Geen
 * blad dat volledig past → de basis blijft staan.
 */
export async function refineCategory(store, base, text) {
  if (!base || !base.gid) return base;
  const kids = await categoryDescendants(store, base.gid);
  if (!kids.length) return base;
  const baseDepth = base.name.split(" > ").length;
  const baseTok = tokenSet(base.name.split(" > ").pop());
  const txt = tokenSet(text);
  let best = null;
  for (const k of kids) {
    if (CATEGORY_BAD_BRANCH_RE.test(k.fullName)) continue;
    const segs = k.fullName.split(" > ").slice(baseDepth);
    const dist = [...tokenSet(segs.join(" "))].filter((t) => !baseTok.has(t) && t.length > 1);
    if (!dist.length) continue;
    if (!dist.every((t) => txt.has(t))) continue;
    const score = dist.length * 10 + segs.length;
    if (!best || score > best.score) best = { score, gid: k.id, name: k.fullName };
  }
  return best ? { gid: best.gid, name: best.name } : base;
}

/**
 * resolveCategory(store, p) → { gid, name, base } | null
 * p: { title, product_type } — basis uit lib/categories.js (titel-kop), dan
 * het fijnste blad dat de titel-kop + het producttype dragen.
 */
export async function resolveCategory(store, p) {
  const base = categoryFor(p);
  if (!base) return null;
  const text = `${titleHead(p.title)} ${p.product_type || ""}`;
  let refined = base;
  try {
    refined = await refineCategory(store, { gid: base.gid, name: base.name }, text);
  } catch {
    refined = base;
  }
  return {
    gid: refined.gid,
    name: refined.name,
    base: { gid: base.gid, name: base.name },
    typeId: base.typeId,
    refined: refined.gid !== base.gid,
  };
}

/* ---------------- 2. attributen per categorie ---------------- */

const attrCache = new Map(); // category gid → [{id, name, key, values:[{id,name}]}]

export function attributeKey(name) {
  const n = String(name || "").trim().toLowerCase();
  if (n === "color") return "color-pattern";
  return n.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function categoryAttributes(store, gid) {
  if (attrCache.has(gid)) return attrCache.get(gid);
  const q = `query($id: ID!) {
    node(id: $id) { ... on TaxonomyCategory {
      attributes(first: 60) { nodes {
        ... on TaxonomyChoiceListAttribute { id name values(first: 250) { nodes { id name } } }
      } }
    } }
  }`;
  const r = await storeGraphql(store, q, { id: gid });
  if (!r.ok) return [];
  const nodes = (r.data && r.data.node && r.data.node.attributes && r.data.node.attributes.nodes) || [];
  const list = nodes
    .filter((a) => a && a.name && a.values)
    .map((a) => ({ id: a.id, name: a.name, key: attributeKey(a.name), values: a.values.nodes || [] }));
  attrCache.set(gid, list);
  return list;
}

/* ---------------- 3. waarden afleiden ---------------- */

// Kleur-synoniemen → taxonomie-kleur. Volgorde telt: "rose gold" vóór "rose".
const COLOR_WORDS = [
  ["Rose gold", /\brose gold\b/],
  ["Multicolor", /\b(multi ?colou?r(ed)?|multi|rainbow|colou?rful|mixed colou?rs?)\b/],
  ["Navy", /\b(navy|dark blue|midnight blue)\b/],
  ["Black", /\b(black|jet|onyx|noir)\b/],
  ["White", /\b(white|ivory|off white|snow)\b/],
  ["Gray", /\b(gr[ae]y|charcoal|ash|heather|graphite|slate|smoke)\b/],
  ["Beige", /\b(beige|cream|khaki|sand|nude|stone|oatmeal|taupe|ecru|champagne)\b/],
  ["Brown", /\b(brown|coffee|chocolate|camel|tan|mocha|cognac|caramel|walnut|chestnut)\b/],
  ["Blue", /\b(blue|sky|denim|royal|cobalt|teal|turquoise|aqua|indigo|azure|cyan|sapphire)\b/],
  ["Green", /\b(green|olive|army|sage|mint|emerald|khaki green|forest|lime|jade|pistachio)\b/],
  ["Red", /\b(red|burgundy|wine|maroon|crimson|scarlet|cherry|claret|bordeaux)\b/],
  ["Pink", /\b(pink|rose|fuchsia|blush|coral|magenta|salmon|hot pink)\b/],
  ["Purple", /\b(purple|violet|lilac|lavender|plum|mauve|grape|orchid)\b/],
  ["Yellow", /\b(yellow|mustard|lemon|butter)\b/],
  ["Orange", /\b(orange|apricot|rust|peach|tangerine|copper|burnt)\b/],
  ["Gold", /\b(gold|golden)\b/],
  ["Silver", /\b(silver|metallic silver)\b/],
  ["Bronze", /\bbronze\b/],
  ["Clear", /\b(clear|transparent)\b/],
];
// Taxonomie-waarde "Solid" (Pattern) — globale id, op elke store gelijk
const SOLID_PATTERN = "gid://shopify/TaxonomyValue/2874";

const COLOR_HEX = {
  Beige: "#d9c3a0", Black: "#000000", Blue: "#2b5bd7", Bronze: "#a97142", Brown: "#7b4a2a",
  Clear: "#f4f6f8", Gold: "#d4af37", Gray: "#8a8a8a", Green: "#2e8b57", Multicolor: "#c0c0c0",
  Navy: "#1f2a4d", Orange: "#f28c28", Pink: "#f4a6c1", Purple: "#7d3c98", Red: "#c0392b",
  "Rose gold": "#b76e79", Silver: "#c0c0c0", White: "#ffffff", Yellow: "#f4d03f",
};

function colorsFromValue(v) {
  const s = normText(v);
  const out = [];
  for (const [name, re] of COLOR_WORDS) {
    if (re.test(s)) {
      out.push(name);
      if (name === "Rose gold") break;
      if (name === "Multicolor") break;
    }
  }
  // "Rose" alleen als er geen "rose gold" stond
  return [...new Set(out)];
}

// Maat-opties → taxonomie-waarde ("M" → "Medium (M)")
const SIZE_ALIAS = {
  xxxs: "Triple extra small (XXXS)", "3xs": "Triple extra small (XXXS)",
  xxs: "Double extra small (XXS)", "2xs": "Double extra small (XXS)",
  xs: "Extra small (XS)", "extra small": "Extra small (XS)",
  s: "Small (S)", small: "Small (S)",
  m: "Medium (M)", medium: "Medium (M)",
  l: "Large (L)", large: "Large (L)",
  xl: "Extra large (XL)", "extra large": "Extra large (XL)",
  xxl: "Double extra large (XXL)", "2xl": "Double extra large (XXL)",
  xxxl: "Triple extra large (XXXL)", "3xl": "Triple extra large (XXXL)",
  "4xl": "Four extra large (4XL)", xxxxl: "Four extra large (4XL)",
  "5xl": "Five extra large (5XL)", xxxxxl: "Five extra large (5XL)",
  "6xl": "Six extra large (6XL)", "7xl": "7XL", "8xl": "8XL",
  "one size": "One size", onesize: "One size", "free size": "One size", os: "One size",
};

function sizeValues(optionValues, allowed) {
  const byName = new Map(allowed.map((v) => [v.name.toLowerCase(), v]));
  const out = [];
  for (const raw of optionValues) {
    const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
    const alias = SIZE_ALIAS[s] || SIZE_ALIAS[s.replace(/\s/g, "")];
    const hit = (alias && byName.get(alias.toLowerCase())) || byName.get(s) ||
      // "EU 42" / "US 9" / "42 EU" → het getal
      byName.get((s.match(/^(?:eu|us|uk|au)?\s*(\d{1,2}(?:\.5)?)\s*(?:eu|us|uk|au)?$/) || [])[1] || "\u0000");
    if (hit) out.push(hit);
  }
  return dedupe(out);
}

function dedupe(vals) {
  const seen = new Set();
  return vals.filter((v) => v && !seen.has(v.id) && seen.add(v.id));
}

// Per attribuut: expliciete frases → waarde. Alleen gebruikt als die waarde
// in de categorie bestaat. t = titel+type, a = titel+type+omschrijving.
const RULES = {
  "waist-rise": [
    ["High", /\bhigh (waist|waisted|rise)\b/, "t"],
    ["Mid", /\bmid (waist|rise)\b/, "t"],
    ["Low", /\blow (waist|rise)\b/, "t"],
  ],
  fit: [
    ["Slim", /\bslim\b/, "t"],
    ["Skinny leg", /\bskinny\b/, "t"],
    ["Straight leg", /\bstraight( leg| fit|\b)/, "t"],
    ["Tapered leg", /\btapered\b/, "t"],
    ["Wide", /\bwide( leg| fit)\b/, "t"],
    ["Boyfriend", /\bboyfriend\b/, "t"],
    ["Mom", /\bmom (jeans?|fit)\b/, "t"],
    ["Regular", /\bregular fit\b/, "t"],
    ["Relaxed", /\b(relaxed|loose) fit\b/, "t"],
    ["Oversized", /\boversized?\b/, "t"],
    ["Loose", /\bloose fit\b/, "t"],
    ["Fitted", /\bfitted\b/, "t"],
  ],
  "pants-length-type": [
    ["Knee", /\b(knee length|bermudas?)\b/, "t"],
    ["Above the knee", /\b(above (the )?knee|mid thigh|short length)\b/, "t"],
    ["Cropped", /\bcropped\b/, "t"],
    ["Capri", /\bcapris?\b/, "t"],
    ["Long", /\b(full length|long (pants|trousers))\b/, "t"],
  ],
  "skirt-dress-length-type": [
    ["Mini", /\bmini\b/, "t"],
    ["Midi", /\bmidi\b/, "t"],
    ["Maxi", /\bmaxi\b/, "t"],
    ["Knee", /\bknee length\b/, "t"],
  ],
  "dress-length-type": [
    ["Mini", /\bmini\b/, "t"],
    ["Midi", /\bmidi\b/, "t"],
    ["Maxi", /\bmaxi\b/, "t"],
  ],
  "skirt-length-type": [
    ["Mini", /\bmini\b/, "t"],
    ["Midi", /\bmidi\b/, "t"],
    ["Maxi", /\bmaxi\b/, "t"],
  ],
  "clothing-features": [
    ["Quick drying", /\bquick (dry|drying|dri)\b/, "a"],
    ["Water resistant", /\b(water (resistant|repellent)|waterproof)\b/, "a"],
    ["Stretchable", /\bstretch(y|able)?\b/, "a"],
    ["Moisture wicking", /\b(moisture|sweat) wicking\b/, "a"],
    ["UV protection", /\b(uv protection|upf ?\d*|uv ?\d+)\b/, "a"],
    ["Windproof", /\bwind ?proof\b/, "a"],
    ["Wrinkle resistant", /\bwrinkle (free|resistant)\b/, "a"],
    ["Insulated", /\binsulated\b/, "a"],
    ["Reversible", /\breversible\b/, "a"],
  ],
  "swimwear-features": [
    ["Quick drying", /\bquick (dry|drying|dri)\b/, "a"],
    ["Elastic waistband", /\belastic (waist|waistband)\b/, "a"],
    ["Lightweight", /\blight ?weight\b/, "a"],
    ["Breathable design", /\bbreathable\b/, "a"],
    ["UPF sun protection", /\b(upf ?\d*|uv protection|sun protection)\b/, "a"],
    ["Chlorine resistant", /\bchlorine resistant\b/, "a"],
    ["Adjustable strap", /\badjustable straps?\b/, "t"],
  ],
  "lining-type": [
    ["Mesh-lined", /\bmesh (lining|lined|liner|brief)\b/, "a"],
    ["Double-lined", /\bdouble lined\b/, "a"],
    ["Unlined", /\bunlined\b/, "a"],
    ["Lined", /\b(fully lined|inner (liner|lining)|compression liner|lined)\b/, "a"],
  ],
  "shoe-features": [
    ["Cushioned", /\bcushion(ed|ing)?\b/, "a"],
    ["Lightweight", /\blight ?weight\b/, "a"],
    ["Breathable design", /\bbreathable\b/, "a"],
    ["Arch support", /\barch support\b/, "a"],
    ["Slip resistant", /\b(non slip|anti slip|slip resistant)\b/, "a"],
    ["Waterproof", /\bwaterproof\b/, "a"],
    ["Vegan friendly", /\bvegan\b/, "a"],
  ],
  "closure-type": [
    ["Zipper", /\bzip(per|ped)?\b/, "t"],
    ["Buttons", /\bbuttons?( closure| front| fly| up)?\b/, "t"],
    ["Drawstring", /\b(drawstring|drawcord)\b/, "t"],
    ["Elastic", /\belastic( waist| waistband)?\b/, "t"],
    ["Lace-up", /\blace up\b/, "t"],
    ["Buckles", /\bbuckles?\b/, "t"],
    ["Velcro", /\bvelcro\b/, "t"],
    ["Hook & loop", /\b(hook and loop|velcro)\b/, "t"],
    ["Slip-on", /\bslip on\b/, "t"],
    ["Adjustable straps", /\badjustable straps?\b/, "t"],
    ["Snap", /\bsnap (button|closure)s?\b/, "t"],
    ["Ties", /\b(self tie|tie (waist|front|closure))\b/, "t"],
  ],
  "front-closure-style": [
    ["Double-breasted", /\bdouble breasted\b/, "a"],
    ["Single-breasted", /\bsingle breasted\b/, "a"],
    ["Zip", /\b(zip|zipper|zipped) (front|closure|up)\b|\bfull zip\b/, "a"],
    ["Open", /\bopen front\b/, "a"],
    ["Wrap", /\bwrap (front|style|coat|jacket)\b/, "a"],
  ],
  "care-instructions": [
    ["Machine washable", /\bmachine wash(able)?\b/, "a"],
    ["Hand wash", /\bhand wash\b/, "a"],
    ["Dry clean only", /\bdry clean only\b/, "a"],
    ["Tumble dry", /\btumble dry\b/, "a"],
  ],
  "toe-style": [
    ["Open", /\bopen toe\b/, "t"],
    ["Peep", /\bpeep toe\b/, "t"],
    ["Pointed", /\b(pointed|pointy) toe\b/, "t"],
    ["Round", /\bround toe\b/, "t"],
    ["Square", /\bsquare toe\b/, "t"],
    ["Almond", /\balmond toe\b/, "t"],
    ["Moc", /\b(moc toe|moccasins?)\b/, "t"],
    ["Cap", /\bcap toe\b/, "t"],
    ["Wingtip", /\bwing ?tips?\b/, "t"],
  ],
  "heel-height-type": [
    ["Flat", /\b(flat|flats|flatform)\b/, "t"],
    ["High", /\bhigh heels?\b/, "t"],
    ["Low", /\b(low|kitten) heels?\b/, "t"],
    ["Mid", /\bmid heels?\b/, "t"],
  ],
  "shoe-fit": [["Wide", /\bwide (fit|width)\b/, "t"]],
  "occasion-style": [
    ["Dress", /\b(dress shoes?|oxfords?|derby|brogues?|formal)\b/, "t"],
    ["Casual", /\bcasual\b/, "t"],
  ],
  "hem-style": [
    ["Frayed", /\bfray(ed)?\b/, "a"],
    ["Raw", /\braw hem\b/, "a"],
    ["Rolled/cuffed", /\b(rolled (hem|cuffs?)|roll up|cuffed)\b/, "a"],
    ["Scalloped", /\bscallop(ed)?\b/, "a"],
  ],
  "denim-wash": [
    ["Acid wash", /\bacid wash(ed)?\b/, "a"],
    ["Black wash", /\bblack wash(ed)?\b/, "a"],
    ["Dark wash", /\bdark wash(ed)?\b/, "a"],
    ["Light wash", /\blight wash(ed)?\b/, "a"],
    ["Medium wash", /\bmedium wash(ed)?\b/, "a"],
    ["Stone wash", /\bstone ?wash(ed)?\b/, "a"],
    ["Vintage wash", /\b(vintage wash(ed)?|washed vintage)\b/, "a"],
    ["Raw/unwashed", /\b(raw denim|unwashed)\b/, "a"],
  ],
  "size-type": [
    ["Plus", /\bplus size\b/, "t"],
    ["Petite", /\bpetite\b/, "t"],
    ["Tall", /\btall\b/, "t"],
    ["Big", /\bbig and tall\b/, "t"],
  ],
  "sleeve-length-type": [
    ["Sleeveless", /\bsleeveless\b/, "a"],
    ["Short", /\bshort sleeves?\b/, "a"],
    ["Long", /\blong sleeves?\b/, "a"],
    ["3/4", /\b3 4 sleeves?\b/, "a"],
    ["Cap", /\bcap sleeves?\b/, "a"],
  ],
  neckline: [
    ["V-neck", /\bv neck\b/, "t"],
    ["Crew", /\bcrew ?neck\b/, "t"],
    ["Round", /\bround neck\b/, "t"],
    ["Scoop", /\bscoop neck\b/, "t"],
    ["Square", /\bsquare neck\b/, "t"],
    ["Halter", /\bhalter\b/, "t"],
    ["Off shoulder", /\boff (the )?shoulder\b/, "t"],
    ["One shoulder", /\bone shoulder\b/, "t"],
    ["Sweetheart", /\bsweetheart\b/, "t"],
    ["Cowl", /\bcowl neck\b/, "t"],
    ["Boat", /\bboat neck\b/, "t"],
    ["Mock", /\bmock neck\b/, "t"],
    ["Turtle", /\bturtle ?neck\b/, "t"],
    ["Collared", /\bcollared\b/, "t"],
    ["Hooded", /\bhooded\b/, "t"],
  ],
};

// Materiaal-attributen: waarde-naam letterlijk in titel/omschrijving, plus aliassen
const MATERIAL_KEYS = new Set(["fabric", "footwear-material", "material", "bag-material", "upper-material", "accessory-material"]);
const MATERIAL_ALIAS = {
  Denim: /\bdenim\b/, // "jeans" alleen via de titel (zie hieronder)
  Lycra: /\b(lycra|spandex|elastane)\b/,
  Spandex: /\b(spandex|elastane|lycra)\b/,
  "Faux leather": /\b(faux|pu|vegan|synthetic) leather\b/,
  "Faux fur": /\bfaux fur\b/,
  Polyester: /\bpolyester\b/,
  Viscose: /\bviscose\b/,
  Rayon: /\brayon\b/,
  Terrycloth: /\bterry( cloth|cloth)?\b/,
  Velour: /\bvelour\b/,
};

// Kenmerken (alle "... features"-attributen): naam letterlijk, of een van deze vormen
const FEATURE_ALIAS = {
  pockets: /\b(pockets?|cargo)\b/,
  lightweight: /\blight ?weight\b/,
  "quick drying": /\bquick (dry|drying|dri)\b/,
  "water resistant": /\bwater (resistant|repellent)\b/,
  waterproof: /\bwater ?proof\b/,
  windproof: /\bwind ?proof\b/,
  breathable: /\bbreathable\b/,
  "breathable design": /\bbreathable\b/,
  stretchable: /\bstretch(y|able)?\b/,
  hooded: /\bhood(ed)?\b/,
  "detachable hood": /\bdetachable hood\b/,
  insulated: /\binsulated\b/,
  padded: /\bpadded\b/,
  "elastic waistband": /\belastic (waist|waistband)\b/,
  "adjustable waist": /\badjustable waist(band)?\b/,
  "moisture wicking": /\b(moisture|sweat) wicking\b/,
  "uv protection": /\b(uv protection|upf ?\d*)\b/,
  "upf sun protection": /\b(upf ?\d*|uv protection|sun protection)\b/,
  "wrinkle resistant": /\bwrinkle (free|resistant)\b/,
  reversible: /\breversible\b/,
  cushioned: /\bcushion(ed|ing)?\b/,
  "arch support": /\barch support\b/,
  "slip resistant": /\b(non slip|anti slip|slip resistant)\b/,
  "vegan friendly": /\bvegan\b/,
};

const SKIP_KEYS_RE = /^(pattern|baby|toddler|maternity|nursing|pregnancy|belly|age-group|target-gender|size|shoe-size|color-pattern|lining-material|outsole-material)/;
const AMBIGUOUS_SINGLE = new Set([
  "other", "none", "dress", "casual", "regular", "classic", "plain", "solid", "standard", "basic",
  "long", "short", "high", "low", "mid", "wide", "open", "round", "square", "flat", "text", "logo",
  "lace", "mesh", "cap", "slim", "full", "half", "mini", "midi", "maxi", "light", "heavy", "medium",
]);

// Losse woorden alleen bij "stijl"-attributen (Sandal style: Gladiator …);
// bij de rest ("Coverage level: Adjustable") gaf dat valse treffers.
const SINGLE_WORD_OK_RE = /(style|silhouette|collar|neckline|closure|heel-type|toe)/;

function genericMatch(key, values, tText) {
  const out = [];
  for (const v of values) {
    const n = normText(v.name);
    if (!n || n === "other" || n === "none") continue;
    const words = n.split(" ");
    if (words.length === 1 && (!SINGLE_WORD_OK_RE.test(key) || AMBIGUOUS_SINGLE.has(n) || n.length < 6)) continue;
    if (hasPhrase(tText, n)) out.push(v);
  }
  return out;
}

/**
 * deriveAttributes(product, attrs, {gender}) → { key: [taxonomyValue] }
 * product: { title, productType, description, options:[{name, values}] }
 */
export function deriveAttributes(product, attrs, { gender } = {}) {
  const tText = normText(`${product.title} ${product.productType || ""}`);
  /* Omschrijving zonder styling-zinnen: "Pair with jeans and leather boots"
     maakte van een trenchcoat Fabric = Denim (SSB, 16-10). Zinnen met
     pair/style/team/wear it with/goes with/match tellen niet mee. */
  const descClean = String(product.description || "")
    .replace(/<\/(p|li|h\d)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((z) => !/\b(pair(ed|s|ing)?|style[sd]?( it)?|team(ed)?|match(es|ed)?|goes|go|wear (it|them|this)|complement(s|ed)?|combine[sd]?|layer(ed)? (over|under|with))\b[^.]*\b(with|over|under|alongside)\b/i.test(z))
    .join(" ");
  const aText = normText(`${product.title} ${product.productType || ""} ${descClean}`);
  const opt = (re) => {
    const o = (product.options || []).find((x) => re.test(String(x.name || "")));
    return o ? o.values || [] : [];
  };
  const result = {};
  for (const attr of attrs) {
    const key = attr.key;
    const byName = new Map(attr.values.map((v) => [v.name.toLowerCase(), v]));
    const pick = (name) => byName.get(String(name).toLowerCase());
    let vals = [];

    if (key === "target-gender") {
      const g = /\bunisex\b/.test(tText) ? "Unisex" : gender === "men" ? "Male" : gender === "women" ? "Female" : null;
      if (g && pick(g)) vals = [pick(g)];
    } else if (key === "age-group") {
      if (pick("Adults")) vals = [pick("Adults")];
    } else if (key === "color-pattern") {
      const fromOpt = opt(/^(colou?r|kleur|couleur|farbe|shade)s?$/i).flatMap(colorsFromValue);
      /* Geen kleur-optie → alleen een EXPLICIET kleurwoord in de titel-kop.
         "Denim Shorts" is geen blauw (zwarte denim bestaat), "Stone" geen beige. */
      const head = normText(titleHead(product.title));
      const explicit = head.match(/\b(black|white|gr[ae]y|beige|brown|blue|navy|green|red|pink|purple|yellow|orange|gold|silver|khaki|cream|ivory|burgundy|olive|tan|camel)\b/g) || [];
      const names = fromOpt.length ? fromOpt : [...new Set(explicit.flatMap(colorsFromValue))];
      vals = dedupe(names.map(pick));
    } else if (key === "size") {
      vals = sizeValues(opt(/^(size|maat|taille|grö(ss|ß)e|talla)s?$/i), attr.values);
    } else if (key === "shoe-size") {
      vals = sizeValues(opt(/^(shoe )?(size|maat|taille|grö(ss|ß)e|talla)s?$/i), attr.values);
    } else if (key === "lining-material") {
      const m = aText.match(/\b([a-z]+) (lining|lined)\b/);
      if (m) vals = [...byName.values()].filter((v) => normText(v.name) === m[1]);
    } else if (key === "outsole-material") {
      const m = aText.match(/\b(rubber|eva|tpr|tpu|pu|leather|cork|wood(en)?) (out)?soles?\b/);
      if (m) {
        const map = { eva: "ethylene vinyl acetate (eva)", tpr: "thermoplastic rubber (tpr)", tpu: "thermoplastic polyurethane (tpu)", pu: "polyurethane (pu)", wooden: "wood" };
        const want = map[m[1]] || m[1];
        vals = [...byName.values()].filter((v) => v.name.toLowerCase() === want);
      }
    } else if (MATERIAL_KEYS.has(key)) {
      // titel eerst, dan omschrijving; max 3; "faux leather" sluit "leather" uit
      const found = [];
      // "Mesh Lining", "Faux Leather Patch", "Suede Trim" zeggen niets over de stof zelf
      const strip = (s) => s.replace(/\b(faux |pu |vegan )?[a-z]+ (lining|liner|lined|patch(es)?|trim(med)?|detail(s|ing)?|pocket(s)?|strap(s)?|belt|sole|insole|panel(s)?|logo|label|tie)\b/g, " ");
      for (const src of [strip(tText), strip(aText)]) {
        for (const v of attr.values) {
          const n = v.name;
          if (/^(other|none)$/i.test(n)) continue;
          const re = MATERIAL_ALIAS[n];
          if ((re && re.test(src)) || (!re && hasPhrase(src, n))) found.push(v);
        }
        if (found.length) break;
      }
      if (key === "fabric" && /\bjeans?\b/.test(tText) && !found.some((v) => v.name === "Denim") && pick("Denim")) found.unshift(pick("Denim"));
      let f = dedupe(found);
      if (f.some((v) => v.name === "Faux leather") && !/\b(genuine|real|cow) leather\b/.test(aText)) f = f.filter((v) => v.name !== "Leather");
      if (f.some((v) => v.name === "Faux fur")) f = f.filter((v) => v.name !== "Fur");
      vals = f.slice(0, 3);
    } else if (RULES[key]) {
      for (const [name, re, src] of RULES[key]) {
        const v = pick(name);
        if (v && re.test(src === "a" ? aText : tText)) vals.push(v);
      }
      // fit: maximaal één pasvorm (eerste = meest specifiek)
      if (["fit", "waist-rise", "pants-length-type", "heel-height-type", "sleeve-length-type", "dress-length-type", "skirt-length-type", "skirt-dress-length-type", "size-type", "lining-type"].includes(key)) vals = vals.slice(0, 1);
      if (key === "size-type" && !vals.length && pick("Regular")) vals = [pick("Regular")];
      vals = dedupe(vals).slice(0, 4);
    } else if (/features$/.test(key)) {
      // Shopify stelt deze zelf voor ("Lightweight", "Pockets") — wij zetten ze direct
      for (const v of attr.values) {
        const n = normText(v.name);
        if (!n || n === "other") continue;
        const alias = FEATURE_ALIAS[n];
        if ((alias && alias.test(aText)) || hasPhrase(aText, n)) vals.push(v);
      }
      vals = dedupe(vals).slice(0, 5);
    } else if (!SKIP_KEYS_RE.test(key)) {
      vals = genericMatch(key, attr.values, tText).slice(0, 3);
    }
    if (vals.length) result[key] = vals;
  }
  return result;
}

/* ---------------- 4. Shopify schrijven ---------------- */

const enabledKeys = new Map(); // domain → Set(keys)

async function ensureDefinitions(store, keys) {
  const dom = String(store.domain || "");
  if (!enabledKeys.has(dom)) enabledKeys.set(dom, new Set());
  const done = enabledKeys.get(dom);
  const todo = keys.filter((k) => !done.has(k));
  const failed = [];
  for (const key of todo) {
    const m = `mutation($t: String!, $k: String!) {
      a: standardMetaobjectDefinitionEnable(type: $t) { metaobjectDefinition { type } userErrors { message code } }
      b: standardMetafieldDefinitionEnable(namespace: "shopify", key: $k, ownerType: PRODUCT) { createdDefinition { key } userErrors { message code } }
    }`;
    const r = await storeGraphql(store, m, { t: `shopify--${key}`, k: key });
    if (!r.ok) { failed.push(`${key}: ${r.error}`); continue; }
    const errs = [
      ...((r.data.a && r.data.a.userErrors) || []),
      ...((r.data.b && r.data.b.userErrors) || []),
    ].filter((e) => !/TAKEN|already|exists|in use|enabled/i.test(`${e.code || ""} ${e.message || ""}`));
    if (errs.length) failed.push(`${key}: ${errs.map((e) => e.message).join("; ")}`);
    else done.add(key);
  }
  return failed;
}

const moIndex = new Map(); // `${domain}|${type}` → Map(taxonomyValueGid → metaobjectId)

async function metaobjectIndex(store, type) {
  const k = `${store.domain}|${type}`;
  if (moIndex.has(k)) return moIndex.get(k);
  const idx = new Map();
  const q = `query($t: String!, $after: String) {
    metaobjects(type: $t, first: 250, after: $after) {
      nodes { id fields { key value } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  // Meerdere objecten op dezelfde taxonomie-waarde? Dan wint het object met
  // een nette label (niet de handmatige "femal" van 16-10 op SSB).
  const keep = (tax, id, label) => {
    const cur = idx.get(tax);
    const nice = (l) => (l && /^[A-Z]/.test(l) ? 2 : 0) + String(l || "").length / 100;
    if (!cur || nice(label) > nice(cur.label)) {
      idx.set(tax, { id, label: label || "" });
    }
  };
  let after = null;
  for (let page = 0; page < 8; page++) {
    const r = await storeGraphql(store, q, { t: type, after });
    if (!r.ok) break;
    const c = r.data && r.data.metaobjects;
    for (const n of (c && c.nodes) || []) {
      const f = Object.fromEntries((n.fields || []).map((x) => [x.key, x.value]));
      if (type === "shopify--color-pattern") {
        // alleen "pure" kleuren (één kleur, patroon Solid of leeg) hergebruiken —
        // zo pakken we ook de kleuren die Shopify/Justin zelf al aanmaakte
        let list = [];
        try { list = JSON.parse(f.color_taxonomy_reference || "[]"); } catch {}
        if (list.length === 1 && (!f.pattern_taxonomy_reference || f.pattern_taxonomy_reference === SOLID_PATTERN)) keep(list[0], n.id, f.label);
      } else if (f.taxonomy_reference) {
        keep(f.taxonomy_reference, n.id, f.label);
      }
    }
    if (!c || !c.pageInfo || !c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  moIndex.set(k, idx);
  return idx;
}

function handleOf(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "value";
}

async function metaobjectFor(store, key, value) {
  const type = `shopify--${key}`;
  const idx = await metaobjectIndex(store, type);
  if (idx.has(value.id)) {
    const hit = idx.get(value.id);
    /* Bestaande waarde met een afwijkende label ("femal" i.p.v. "Female")
       → label één keer rechtzetten. Dat object hoort bij deze taxonomie-
       waarde, dus de juiste naam klopt voor elk product dat hem gebruikt. */
    if (hit.label !== value.name && !hit.fixed) {
      const um = `mutation($id: ID!, $mo: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $mo) { metaobject { id } userErrors { message } }
      }`;
      const ur = await storeGraphql(store, um, { id: hit.id, mo: { fields: [{ key: "label", value: value.name }] } });
      hit.fixed = true;
      if (ur.ok) hit.label = value.name;
    }
    return { id: hit.id };
  }
  const fields =
    key === "color-pattern"
      ? [
          { key: "label", value: value.name },
          { key: "color_taxonomy_reference", value: JSON.stringify([value.id]) },
          // verplicht veld ("Base pattern can't be blank") — effen kleur
          { key: "pattern_taxonomy_reference", value: SOLID_PATTERN },
          ...(COLOR_HEX[value.name] ? [{ key: "color", value: COLOR_HEX[value.name] }] : []),
        ]
      : [
          { key: "label", value: value.name },
          { key: "taxonomy_reference", value: value.id },
        ];
  const m = `mutation($h: MetaobjectHandleInput!, $mo: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $h, metaobject: $mo) { metaobject { id } userErrors { field message code } }
  }`;
  // zelfde handle-stijl als Shopify's eigen waarden ("blue", "adults", "male");
  // bestond hij al, dan vond de index hierboven hem al
  const r = await storeGraphql(store, m, { h: { type, handle: handleOf(value.name) }, mo: { fields } });
  if (!r.ok) return { error: r.error };
  const res = r.data && r.data.metaobjectUpsert;
  if (res && res.metaobject) {
    idx.set(value.id, { id: res.metaobject.id, label: value.name, fixed: true });
    return { id: res.metaobject.id };
  }
  return { error: ((res && res.userErrors) || []).map((e) => e.message).join("; ") || "upsert mislukt" };
}

const PRODUCT_Q = `query($id: ID!) {
  product(id: $id) {
    id title productType descriptionHtml tags
    category { id fullName }
    options { name values }
    metafields(namespace: "shopify", first: 60) { nodes { key value } }
  }
}`;

/**
 * fillCategoryMetafields(store, productId, { gender, overwrite })
 *   gender: "men" | "women" (verplicht voor Target gender; anders uit titel)
 *   overwrite: true = ook velden met een bestaande waarde overschrijven
 *              (importer, nieuw product); false = alleen lege velden (Doctor)
 * → { ok, set: {key: [labels]}, skipped: [keys met al een waarde], errors: [] }
 */
export async function fillCategoryMetafields(store, productId, { gender, overwrite = false } = {}) {
  const r = await storeGraphql(store, PRODUCT_Q, { id: productGid(productId) });
  if (!r.ok || !r.data || !r.data.product) return { ok: false, error: r.error || "product niet gevonden", set: {}, errors: [] };
  const p = r.data.product;
  if (!p.category) return { ok: false, error: "geen categorie — eerst categorie zetten", set: {}, errors: [] };

  const g =
    gender ||
    (/^\s*men'?s\b|\bfor men\b/i.test(String(p.title).replace(QUOTES_RE, "'")) ? "men"
      : /^\s*women'?s\b|\bfor women\b|\bladies\b/i.test(String(p.title).replace(QUOTES_RE, "'")) ? "women"
      : (p.tags || []).some((t) => /^men$/i.test(t)) ? "men"
      : (p.tags || []).some((t) => /^women$/i.test(t)) ? "women" : null);

  const attrs = await categoryAttributes(store, p.category.id);
  if (!attrs.length) return { ok: false, error: "geen attributen voor deze categorie opgehaald", set: {}, errors: [] };

  const derived = deriveAttributes(
    { title: p.title, productType: p.productType, description: p.descriptionHtml, options: p.options },
    attrs,
    { gender: g }
  );

  const existing = new Map(((p.metafields && p.metafields.nodes) || []).map((m) => [m.key, m.value]));
  const skipped = [];
  const keys = Object.keys(derived).filter((k) => {
    const has = existing.has(k) && existing.get(k) && existing.get(k) !== "[]";
    if (has && !overwrite) { skipped.push(k); return false; }
    return true;
  });
  if (!keys.length) return { ok: true, set: {}, skipped, errors: [] };

  const errors = await ensureDefinitions(store, keys);
  const failedKeys = new Set(errors.map((e) => e.split(":")[0]));

  const entries = [];
  const set = {};
  for (const key of keys) {
    if (failedKeys.has(key)) continue;
    const ids = [];
    for (const v of derived[key]) {
      const mo = await metaobjectFor(store, key, v);
      if (mo.id) ids.push(mo.id);
      else errors.push(`${key}/${v.name}: ${mo.error}`);
    }
    if (!ids.length) continue;
    entries.push({ ownerId: p.id, namespace: "shopify", key, type: "list.metaobject_reference", value: JSON.stringify(ids) });
    set[key] = derived[key].map((v) => v.name);
  }

  const mut = `mutation($m: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $m) { metafields { key } userErrors { field message } }
  }`;
  for (let i = 0; i < entries.length; i += 25) {
    const w = await storeGraphql(store, mut, { m: entries.slice(i, i + 25) });
    if (!w.ok) { errors.push(w.error); continue; }
    for (const u of (w.data.metafieldsSet && w.data.metafieldsSet.userErrors) || []) errors.push(u.message);
  }
  if (errors.some((e) => /access denied|ACCESS_DENIED|scope/i.test(e))) {
    errors.unshift("Scopes: de Shopify-app van de store mist write_metaobjects / write_metaobject_definitions — toevoegen in de app-instellingen en opnieuw installeren.");
  }
  return { ok: errors.length === 0, set, skipped, errors };
}

/** Samenvatting voor logs: "Color: Black, Navy · Size: S–XL · Fabric: Denim" */
export function summarizeSet(set) {
  return Object.entries(set || {})
    .map(([k, v]) => `${k.replace(/-/g, " ").replace(/^color pattern$/, "color")}: ${v.length > 4 ? `${v[0]} … ${v[v.length - 1]} (${v.length})` : v.join(", ")}`)
    .join(" · ");
}

/** Lichte scan voor de Doctor: welke shopify-metafields heeft elk product? */
export async function listCategoryAttrKeys(store, { max = 2000 } = {}) {
  const q = `query($after: String) {
    products(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id metafields(namespace: "shopify", first: 40) { nodes { key value } } }
    }
  }`;
  const values = {};
  let after = null;
  for (let page = 0; page < 40; page++) {
    const r = await storeGraphql(store, q, { after });
    if (!r.ok) return { ok: false, error: r.error };
    const c = r.data && r.data.products;
    for (const n of (c && c.nodes) || []) {
      const id = String(n.id).replace(/^gid:\/\/shopify\/Product\//, "");
      values[id] = ((n.metafields && n.metafields.nodes) || []).filter((m) => m.value && m.value !== "[]").map((m) => m.key);
    }
    if (!c || !c.pageInfo || !c.pageInfo.hasNextPage || Object.keys(values).length >= max) break;
    after = c.pageInfo.endCursor;
  }
  return { ok: true, values };
}
