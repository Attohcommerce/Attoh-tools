/* STORE-ORDE (Store Doctor, 12-11-2026): juiste naam + juiste collectie
   Justin (LGB): "Waarom zie ik bij Flats & Loafers een jurk en sneakers?
   Loafers en mules staan niet in de juiste collectie. Bouw de Store Doctor
   in dat dit voortaan goed gaat: de juiste benaming, de juiste collecties."

   Twee checks, puur bestand (geen Shopify-calls), voor elke store:

   1. titleNameVerdict — de naam vóór de "|":
      - "Chelsea Boots For Women | …"  → "Women's Chelsea Boots | …"
      - dames-store (V) met "Men's Baggy Jeans" terwijl het type "Women's …"
        zegt (of geen geslacht) → "Women's Baggy Jeans" (en andersom in een
        herenstore). Zegt het type óók het andere geslacht, dan niets
        omzetten: dan is het echt een heren-product (op draft zetten).

   2. wrongCategoryVerdict — het product hangt in een categorie-collectie
      die niet bij het kledingstuk past (laars in Flats & Loafers, jurk in
      Flats & Loafers, loafer in Knitwear, overall in Jeans, platte mule in
      Heels). Alleen tag-collecties: de fix haalt die tag eraf en zet de tag
      van de juiste collectie erop. Een collectie waarvan de naam niets zegt
      ("Women", "Sale", "New in") wordt nooit beoordeeld. */

import { garmentOf, categoryCollections, inCollection, usefulTags, baseKey } from "./category-collection";
import { listSmartCollections } from "./shopify";

const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();
const tagsOf = (p) => (Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",")).map((t) => String(t).trim()).filter(Boolean);

/* ---------- 1. naam ---------- */
const WOMEN_RE = /\b(women'?s|womens|ladies|lady'?s|for women)\b/i;
const MEN_RE = /\b(men'?s|mens|for men)\b/i;
const genderIn = (s) => (WOMEN_RE.test(String(s || "")) ? "Women" : MEN_RE.test(String(s || "")) ? "Men" : null);

/** "Duck Boots For Men" / "Men's Duck Boots" → "Women's Duck Boots" (want = "Women" | "Men"). */
export function genderHead(head, want) {
  let h = String(head || "").trim();
  h = h.replace(/\s+for\s+(wo)?men\b/i, "").replace(/^(women'?s|womens|ladies|lady'?s|men'?s|mens)\s+/i, "").trim();
  if (!h) return String(head || "").trim();
  return `${want === "Men" ? "Men's" : "Women's"} ${h}`;
}
function swapTypeGender(type, want) {
  const t = String(type || "");
  return want === "Men"
    ? t.replace(/\bwomen'?s\b|\bwomens\b|\bladies\b/gi, "Men's")
    : t.replace(/\bmen'?s\b|\bmens\b/gi, "Women's");
}

/**
 * → null (naam klopt) of { title, product_type?, why } — title null = niet
 * automatisch om te zetten (why zegt waarom).
 * storeGenders: "V" (alleen dames), "M" (alleen heren), anders gemengd.
 */
export function titleNameVerdict(p, storeGenders) {
  const title = String(p.title || "");
  const bar = title.indexOf("|");
  const head = (bar >= 0 ? title.slice(0, bar) : title).trim();
  const rest = bar >= 0 ? title.slice(bar) : "";
  const storeWant = storeGenders === "V" ? "Women" : storeGenders === "M" ? "Men" : null;
  const headG = genderIn(head);
  const typeG = genderIn(p.product_type);

  // a. geslacht in de titel past niet bij een één-geslacht-store
  if (storeWant && headG && headG !== storeWant) {
    if (typeG && typeG !== storeWant) {
      return { title: null, why: `titel én type zeggen ${headG === "Men" ? "heren" : "dames"} — echt een ${headG === "Men" ? "heren" : "dames"}product? Op draft zetten` };
    }
    const nh = genderHead(head, storeWant);
    const out = { title: `${nh}${rest ? ` ${rest.replace(/^\|\s*/, "| ")}` : ""}`.replace(/\s{2,}/g, " ").trim(), why: `"${head}" → "${nh}" (${storeWant === "Women" ? "dames" : "heren"}store)` };
    if (typeG && typeG !== storeWant) out.product_type = swapTypeGender(p.product_type, storeWant);
    return out;
  }
  // b. "X For Women" / "X For Men" → "Women's X" / "Men's X"
  const m = head.match(/\s+for\s+((?:wo)?men)\b/i);
  if (m) {
    const want = /^wo/i.test(m[1]) ? "Women" : "Men";
    const nh = genderHead(head, storeWant || want);
    if (nh !== head) return { title: `${nh}${rest ? ` ${rest.replace(/^\|\s*/, "| ")}` : ""}`.replace(/\s{2,}/g, " ").trim(), why: `"${head}" → "${nh}"` };
  }
  return null;
}

/* ---------- 2. collectie ---------- */
// Familie van een collectie op naam; namen met "&" krijgen meerdere ("Slippers & Loungewear").
const COL_FAMILY = [
  ["slippers", /slipper|house ?shoe/],
  ["lounge", /lounge/],
  ["boots", /\bboot(s|ie|ies)?\b/],
  ["sneakers", /sneaker|trainer/],
  ["sandals", /sandal|slides?\b/],
  ["heels", /\bheels?\b|\bpumps?\b|stiletto/],
  ["flats-loafers", /loafer|\bflats?\b|\bmules?\b|ballet/],
  ["shoes", /\bshoes?\b|footwear/],
  ["dress", /dress(?!\s*(pants|trousers|shoes|shirts?|boots|slacks))|gown/], // "Dress Pants/Shoes/Shirts" zijn geen jurken
  ["jumpsuit", /jumpsuit|playsuit|romper|overall|dungaree/],
  ["set", /\bsets?\b|co-?ords?|sweatsuit|tracksuit/],
  ["skirt", /skirt|skort/],
  ["jeans", /jean|denim/],
  ["shorts", /\bshorts\b/],
  ["trousers", /pant|trouser|legging|jogger|chino|slack/],
  ["swim", /swim|bikini|beach/],
  ["hoodie", /hood|sweatshirt|\bsweats\b/],
  ["knit", /knit|sweater|cardigan|jumper|pullover/],
  ["outer", /coat|jacket|outerwear|blazer|\bsuits?\b|vest|gilet|parka|puffer/],
  ["top", /\btops?\b|blouse|shirt|\btees?\b|t-shirt|tank|polo|cami|bodysuit/],
  ["bag", /\bbags?\b|handbag|purse|tote/],
];
const famOf = (part) => {
  for (const [fam, re] of COL_FAMILY) if (re.test(part)) return fam;
  return null;
};
export function collectionFamilies(title) {
  const parts = baseKey(title).split(/\s*(?:&|\band\b|,|\+|\/)\s*/).filter(Boolean);
  // "Chino & Tailored Shorts" = chino shorts + tailored shorts: een los enkelvoud-woord vóór de "&"
  // is een bijvoeglijk woord bij het laatste deel (EMC 12-11: jogger zat "goed" via Chino & Tailored Shorts).
  const lastFam = parts.length > 1 ? famOf(parts[parts.length - 1]) : null;
  const out = new Set();
  parts.forEach((part, i) => {
    const modifier = lastFam && i < parts.length - 1 && !/\s/.test(part) && !/s$/.test(part);
    const fam = modifier ? lastFam : famOf(part);
    if (fam) out.add(fam);
  });
  return [...out];
}

const SHOE_FAMS = ["boots", "sneakers", "sandals", "heels", "flats-loafers", "slippers", "shoes"];
// Welke collectie-families passen bij welk kledingstuk (garmentOf + slippers/mules)
const ALLOWED = {
  boots: ["boots", "shoes"],
  sneakers: ["sneakers", "shoes"],
  sandals: ["sandals", "heels", "shoes", "swim"], // slippers/slides in "Swim & Beach" (EMC) horen daar
  heels: ["heels", "shoes"],
  "flats-loafers": ["flats-loafers", "shoes"],
  slippers: ["slippers", "shoes", "lounge", "flats-loafers"],
  "other-shoe": ["shoes", "flats-loafers", "sneakers", "slippers", "sandals"],
  dress: ["dress", "knit", "lounge"],
  skirt: ["skirt"],
  jeans: ["jeans", "trousers"],
  shorts: ["shorts", "trousers", "jeans", "swim", "lounge", "hoodie"],
  trousers: ["trousers", "jeans", "lounge", "set", "hoodie"], // "Hoodies & Sweats" mag sweatpants hebben
  jumpsuit: ["jumpsuit", "lounge"],
  set: ["set", "lounge", "trousers", "top", "hoodie", "knit", "swim", "dress", "skirt"],
  suit: ["outer", "set"],
  blazer: ["outer", "dress"], // "Blazer Dress"
  swimwear: ["swim", "shorts"],
  hoodie: ["hoodie", "knit", "top", "outer", "set", "lounge"],
  cardigan: ["knit", "outer", "top", "lounge"],
  sweater: ["knit", "top", "hoodie", "lounge", "outer"], // sweater vest
  vest: ["outer", "knit", "top"],
  jacket: ["outer", "knit", "top", "hoodie"], // overshirt, fleece/zip jacket
  "tank-top": ["top", "knit", "lounge"],
  tee: ["top", "knit", "lounge"],
  shirt: ["top", "outer"],
  top: ["top", "knit", "lounge"],
  bag: ["bag"],
};
// Voorkeur voor de collectie die erbij komt: [familie, namen in volgorde]
const ADD_PREF = {
  dress: ["casual dresses", "dresses"],
  "flats-loafers": ["flats & loafers", "loafers & flats", "loafers", "flats"],
  slippers: ["slippers", "slippers & loungewear"],
  "other-shoe": ["shoes", "flats & loafers", "loafers & flats"],
};

/** Kledingstuk: garmentOf (category-collection) kent sinds 12-11 ook slippers en mules met hak. */
export const garmentFor = (p) => garmentOf(p);

const isMenTag = (t) => /^(men'?s|mens|gents?)\b/i.test(String(t || "").trim());
const isWomenTag = (t) => /^(women'?s|womens|ladies|lady'?s)\b/i.test(String(t || "").trim());
function menProduct(p, storeGenders) {
  const t = String(p.title || "");
  if (/\bwomen'?s\b|\bladies\b|\bfor women\b/i.test(t)) return false;
  if (/\bmen'?s\b|\bfor men\b/i.test(t)) return true;
  if (storeGenders === "M") return true;
  if (storeGenders === "V") return false;
  return tagsOf(p).map(lc).includes("men");
}
/** De ene tag die een product in deze collectie zet (alleen bij "tag = X"-collecties). */
function singleTag(c) {
  const rules = c.rules || [];
  if (rules.length === 1 && lc(rules[0].column) === "tag" && lc(rules[0].relation) === "equals") return String(rules[0].condition).trim();
  if (c.disjunctive) {
    const t = rules.filter((r) => lc(r.column) === "tag" && lc(r.relation) === "equals");
    if (t.length === rules.length && t.length) return t.map((r) => String(r.condition).trim());
  }
  return null;
}

/** Beste tag-collectie voor een kledingstuk in deze store (null = geen). */
function pickTagFor(garment, cols, men, storeGenders, exclude = []) {
  const allowed = ALLOWED[garment];
  if (!allowed) return null;
  const fits = (t) => (men ? isMenTag(t) || (storeGenders === "M" && !isWomenTag(t)) : !isMenTag(t));
  const useful = usefulTags(cols).filter((u) => fits(u.tag) && !exclude.some((d) => lc(d) === lc(u.tag)));
  const cand = useful.filter((u) => collectionFamilies(u.title).includes(allowed[0]));
  const pref = ADD_PREF[garment] || [];
  let hit = pref.map((k) => cand.find((u) => baseKey(u.tag) === k || baseKey(u.title) === k)).find(Boolean) || cand[0] || null;
  // tweede keus: een andere passende familie (bv. "Shoes" voor laarzen)
  if (!hit) hit = useful.find((u) => collectionFamilies(u.title).some((f) => allowed.includes(f))) || null;
  return hit ? hit.tag : null;
}

/**
 * Oordeel voor één product → null (klopt / niet te beoordelen) of
 * { garment, wrong: [titels], drop: [tags], add: tag|null, reason }
 */
export function wrongCategoryVerdict(p, cols, { storeGenders = null } = {}) {
  if (!p || p.status === "archived" || !Array.isArray(cols)) return null;
  const garment = garmentFor(p);
  const allowed = garment && ALLOWED[garment];
  if (!allowed) return null;
  const cats = categoryCollections(cols);
  const inCats = cats.filter((c) => inCollection(c, p) === true);
  const judged = inCats.map((c) => ({ c, fams: collectionFamilies(c.title) })).filter((x) => x.fams.length);
  const wrong = judged.filter((x) => !x.fams.some((f) => allowed.includes(f)));
  if (!wrong.length) return null;

  const drop = [];
  const fixedBy = [];
  const tags = tagsOf(p);
  for (const w of wrong) {
    const t = singleTag(w.c);
    const hit = (Array.isArray(t) ? t : t ? [t] : []).filter((x) => tags.some((y) => lc(y) === lc(x)));
    if (hit.length) {
      drop.push(...tags.filter((y) => hit.some((x) => lc(x) === lc(y))));
      fixedBy.push(w.c.title);
    }
  }
  // "Alle regels"-collectie met een tag die we toch al weghalen (Men's Shorts + titel → Chino & Tailored
  // Shorts): valt vanzelf weg, dus geen "regel nakijken".
  for (const w of wrong) {
    if (fixedBy.includes(w.c.title) || w.c.disjunctive) continue;
    const tagRules = (w.c.rules || []).filter((r) => lc(r.column) === "tag" && lc(r.relation) === "equals");
    if (tagRules.some((r) => drop.some((d) => lc(d) === lc(r.condition)))) fixedBy.push(w.c.title);
  }
  const notTag = wrong.filter((w) => !fixedBy.includes(w.c.title)).map((w) => w.c.title);

  // Blijft hij na het weghalen in een passende collectie? Anders de juiste tag erbij.
  const stillOk = judged.some((x) => !wrong.includes(x) && x.fams.some((f) => allowed.includes(f)));
  const add = stillOk ? null : pickTagFor(garment, cols, menProduct(p, storeGenders), storeGenders, drop);
  const reason = notTag.length
    ? `zit via een regel op titel/type in ${notTag.join(", ")} — die regel nakijken`
    : !stillOk && !add
      ? `geen passende collectie voor "${garment}" — eerst aanmaken`
      : "";
  // Niet weghalen als er niets passends voor terugkomt: dan valt hij nergens meer in.
  if (!stillOk && !add) return { garment, wrong: wrong.map((w) => w.c.title), drop: [], add: null, reason };
  return { garment, wrong: wrong.map((w) => w.c.title), drop, add, reason };
}

/* ---------- 3. bij het importeren (12-11) ----------
   De COLLECTIE uit de planning past soms niet bij het product (keyword
   "womens mules" in Heels, loafers in Knitwear, een jurk in Flats & Loafers).
   De importer vraagt dit vóór het aanmaken: zegt de collectienaam een ander
   soort kledingstuk dan de nieuwe titel, dan de passende collectie van de
   store. Collecties 10 min in het geheugen per store. */
const COLS_TTL = 10 * 60 * 1000;
const colsCache = new Map();
export async function storeCollectionsCached(store) {
  const key = String((store && store.domain) || "");
  const hit = colsCache.get(key);
  if (hit && Date.now() - hit.at < COLS_TTL) return hit.cols;
  const r = await listSmartCollections(store);
  const cols = r.ok ? r.collections : null;
  if (cols) colsCache.set(key, { at: Date.now(), cols });
  return cols;
}
/** → null (collectie past of is niet te beoordelen) of { col, why } (col null = niets passends gevonden). */
export function importCollectionFix(p, colTitle, cols, storeGenders) {
  const garment = garmentOf(p);
  const allowed = garment && ALLOWED[garment];
  if (!allowed || !colTitle) return null;
  const fams = collectionFamilies(colTitle);
  if (!fams.length || fams.some((f) => allowed.includes(f))) return null;
  const men = menProduct(p, storeGenders);
  const col = Array.isArray(cols) ? pickTagFor(garment, cols, men, storeGenders, [colTitle]) : null;
  const head = String(p.title || "").split("|")[0].trim();
  return {
    col,
    why: col ? `COLLECTIE "${colTitle}" past niet bij "${head}" → ${col}` : `COLLECTIE "${colTitle}" past niet bij "${head}" (geen passende collectie in de store — staat er toch in)`,
  };
}

export { SHOE_FAMS };
