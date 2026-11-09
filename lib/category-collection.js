/* CATEGORIE-COLLECTIE (Store Doctor, 09-11-2026)
   Justin (EMC): "Ik zie geen suits collectie, kan dat kloppen? Er hoort toch
   gewoon een suits collectie op de store te staan. En anders hoort die tool
   dat toch aan te maken."

   Check "no-category-collection": een actief/draft product dat in GEEN
   ENKELE categorie-collectie valt (alleen in Men/Women/Sale) is onvindbaar
   in de navigatie. De fix "fix-category-collection":
     1. herkent het kledingstuk (titel vóór de "|", anders het type),
     2. zoekt een smart collection die op precies één TAG werkt en bij dat
        kledingstuk past ("Men's Shirts", "Men's Suits & Blazers", "Dresses"…),
     3. bestaat die niet: maakt hem aan (tag = titel, gepubliceerd),
     4. zet die tag op het product.

   Waarom alleen tag-collecties: een sub-collectie die op de TITEL werkt
   ("Sneakers" = titel bevat Sneaker) vul je niet met een tag. Precies dat
   ging mis bij EMC: producten kregen de tag "Sneakers" of "Henleys" en
   vielen daardoor in geen enkele collectie. Puur bestand (geen Shopify-calls). */

const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();
const tagsOf = (p) => (Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",")).map((t) => String(t).trim()).filter(Boolean);
const GENDER_PREFIX = /^(men'?s|mens|men|male|gents?|women'?s|womens|women|ladies|lady'?s|female)\s+/i;
export const baseKey = (t) => lc(String(t || "").replace(GENDER_PREFIX, ""));
const isMenTag = (t) => /^(men'?s|mens|gents?)\b/i.test(String(t || "").trim());
const isWomenTag = (t) => /^(women'?s|womens|ladies|lady'?s)\b/i.test(String(t || "").trim());

/* ---------- kledingstuk herkennen ---------- */
// Volgorde telt: set/pak/blazer vóór jas, schoenen vóór jurk ("Dress Loafers"), jeans vóór broek.
const GARMENTS = [
  ["set", /\b(sets?|co-?ords?|two[\s-]?piece set|matching set)\b/i],
  ["suit", /\b(suits?|tuxedos?|three[\s-]?piece|3[\s-]?piece)\b/i],
  ["blazer", /\b(blazers?|sport ?coats?)\b/i],
  ["swimwear", /\b(swim\w*|bikinis?|board ?shorts?|swim ?trunks?|swimsuits?|one[\s-]?piece|rash ?guards?)\b/i],
  ["boots", /\b(boots?|booties)\b/i],
  ["sneakers", /\b(sneakers?|trainers?|running shoes?|runners)\b/i],
  ["sandals", /\b(sandals?|slides?|flip[\s-]?flops?)\b/i],
  ["heels", /\b(heels?|pumps|stilettos?)\b/i],
  ["flats-loafers", /\b(loafers?|flats|ballet flats?|moccasins?|espadrilles?|mules?|slip[\s-]?on shoes?)\b/i],
  ["other-shoe", /\b(shoes?|oxfords?|derby|brogues?|clogs?)\b/i],
  ["jumpsuit", /\b(jumpsuits?|playsuits?|rompers?|overalls?|dungarees)\b/i],
  ["dress", /(?<!shoes?\s)\bdress(es)?\b(?!\s*(shirts?|pants?|trousers?|shoes?|boots?|slacks|chelsea|loafers?))/i],
  ["skirt", /\b(skirts?|skorts?)\b/i],
  ["jeans", /\bjeans?\b(?!\s*(shorts?|jackets?|shirts?))/i],
  ["shorts", /\b(shorts|short pants)\b/i],
  ["trousers", /\b(pants|trousers|chinos?|slacks|joggers?|leggings|sweatpants|cargos)\b/i],
  ["hoodie", /\b(hoodies?|hooded|sweatshirts?)\b/i],
  ["cardigan", /\bcardigans?\b/i],
  ["sweater", /\b(sweaters?|jumpers?|pullovers?|knitwear|crewnecks?)\b/i],
  ["vest", /\b(vests?|gilets?|waistcoats?|bodywarmers?)\b/i],
  ["jacket", /\b(jackets?|coats?|parkas?|bombers?|windbreakers?|anoraks?|puffers?|overshirts?|trench)\b/i],
  ["tank-top", /\b(tanks?|tank tops?|singlets?|camis?|camisoles?|sleeveless|no sleeve)\b/i],
  ["tee", /\b(t[\s-]?shirts?|tees?)\b/i],
  ["shirt", /\b(shirts?|blouses?|henleys?|polos?)\b/i],
  ["top", /\b(tops?|bodysuits?|crop)\b/i],
  ["bag", /\b(bags?|handbags?|totes?|clutch|backpacks?|purses?)\b/i],
];
function garmentIn(text) {
  for (const [k, re] of GARMENTS) if (re.test(text)) return k;
  return null;
}
/** Kledingstuk van een product: eerst de titel vóór de "|", dan het type, dan de hele titel. */
export function garmentOf(p) {
  const head = String(p.title || "").split("|")[0];
  return garmentIn(head) || garmentIn(String(p.product_type || "")) || garmentIn(String(p.title || ""));
}

// Welke bestaande tag-collecties passen (op naam zonder Men's/Women's), in voorkeursvolgorde
const WANT = {
  set: ["linen sets", "sets", "co-ord sets", "matching sets"],
  suit: ["suits & blazers", "suits", "blazers & suits"],
  blazer: ["suits & blazers", "blazers", "jackets & coats", "jackets"],
  swimwear: ["swimwear", "swim", "swim & beach"],
  jumpsuit: ["jumpsuits & playsuits", "jumpsuits", "playsuits"],
  dress: ["dresses", "casual dresses"],
  skirt: ["skirts"],
  jeans: ["jeans", "pants & jeans", "trousers", "pants"],
  shorts: ["shorts"],
  trousers: ["trousers", "pants", "pants & jeans"],
  boots: ["boots", "shoes"],
  sneakers: ["sneakers", "shoes"],
  sandals: ["sandals", "shoes"],
  heels: ["heels", "shoes"],
  "flats-loafers": ["flats & loafers", "loafers", "shoes"],
  "other-shoe": ["shoes"],
  hoodie: ["hoodies", "hoodies & sweatshirts", "sweatshirts", "sweaters"],
  cardigan: ["cardigans", "sweaters", "knitwear"],
  sweater: ["sweaters", "knitwear", "jumpers"],
  vest: ["jackets & coats", "jackets", "vests"],
  jacket: ["jackets & coats", "jackets", "coats", "outerwear"],
  "tank-top": ["tank tops", "tops", "shirts"],
  tee: ["t-shirts", "tops", "shirts"],
  shirt: ["shirts", "blouses", "tops"],
  top: ["tops", "other tops", "shirts"],
  bag: ["bags"],
};
// Naam van een NIEUWE collectie als de store er nog geen heeft  [heren, dames]
const CREATE = {
  set: ["Men's Sets", "Co-ord Sets"],
  suit: ["Men's Suits & Blazers", "Suits & Blazers"],
  blazer: ["Men's Suits & Blazers", "Blazers"],
  swimwear: ["Men's Swimwear", "Swimwear"],
  jumpsuit: [null, "Jumpsuits & Playsuits"],
  dress: [null, "Dresses"],
  skirt: [null, "Skirts"],
  jeans: ["Men's Jeans", "Jeans"],
  shorts: ["Men's Shorts", "Shorts"],
  trousers: ["Men's Pants", "Pants"],
  boots: ["Men's Shoes", "Boots"],
  sneakers: ["Men's Shoes", "Sneakers"],
  sandals: ["Men's Sandals", "Sandals"],
  heels: [null, "Heels"],
  "flats-loafers": ["Men's Shoes", "Flats & Loafers"],
  "other-shoe": ["Men's Shoes", "Shoes"],
  hoodie: ["Men's Hoodies", "Hoodies & Sweatshirts"],
  cardigan: ["Men's Sweaters", "Cardigans"],
  sweater: ["Men's Sweaters", "Sweaters"],
  vest: ["Men's Jackets & Coats", "Jackets & Coats"],
  jacket: ["Men's Jackets & Coats", "Jackets & Coats"],
  "tank-top": ["Men's Shirts", "Tops"],
  tee: ["Men's Shirts", "Tops"],
  shirt: ["Men's Shirts", "Blouses"],
  top: ["Men's Shirts", "Tops"],
  bag: ["Men's Bags", "Bags"],
};

/** Geslacht van het product: titel eerst ("Women's …" in een herenstore = dames-product), dan store, dan tags. */
export function genderFor(p, storeGenders) {
  const t = String(p.title || "");
  if (/\bwomen'?s\b|\bladies\b|\bfor women\b/i.test(t)) return "women";
  if (/\bmen'?s\b|\bfor men\b/i.test(t)) return "men";
  if (storeGenders === "M") return "men";
  if (storeGenders === "V") return "women";
  const tg = tagsOf(p).map(lc);
  if (tg.includes("men")) return "men";
  return "women";
}

/* ---------- collecties lezen ---------- */
const TEXT_COLS = new Set(["tag", "title", "type", "vendor"]);
const NOT_CATEGORY = /^(dubbel\b|sale|all\b|all products|new\b|new in|new arrivals|best ?sellers?|trending|home ?page|frontpage|gift)/i;
const GENDER_ONLY = /^(men|mens|women|womens|ladies|unisex|man|woman)$/i;

/** Smart collections die over een SOORT kledingstuk gaan (geen gender/sale/alles). */
export function categoryCollections(cols) {
  return (cols || []).filter((c) => {
    const rules = c.rules || [];
    if (!rules.length || NOT_CATEGORY.test(String(c.title || "")) || lc(c.handle) === "frontpage") return false;
    if (rules.some((r) => !TEXT_COLS.has(lc(r.column)))) return false; // prijs/voorraad/korting → geen categorie
    if (rules.every((r) => lc(r.column) === "tag" && GENDER_ONLY.test(String(r.condition || "").trim()))) return false;
    return true;
  });
}

function ruleHit(r, p) {
  const col = lc(r.column);
  const rel = lc(r.relation);
  const cond = lc(r.condition);
  const vals = (col === "tag" ? tagsOf(p) : [col === "title" ? p.title : col === "type" ? p.product_type : p.vendor]).map(lc);
  switch (rel) {
    case "equals": return vals.some((v) => v === cond);
    case "not_equals": return vals.every((v) => v !== cond);
    case "contains": return vals.some((v) => v.includes(cond));
    case "not_contains": return vals.every((v) => !v.includes(cond));
    case "starts_with": return vals.some((v) => v.startsWith(cond));
    case "ends_with": return vals.some((v) => v.endsWith(cond));
    default: return null;
  }
}
/** Valt dit product in deze collectie? true / false / null (onbekend). */
export function inCollection(c, p) {
  const hits = (c.rules || []).map((r) => ruleHit(r, p));
  if (!hits.length) return false;
  if (c.disjunctive) return hits.some((h) => h === true) ? true : hits.some((h) => h === null) ? null : false;
  return hits.every((h) => h === true) ? true : hits.some((h) => h === false) ? false : null;
}

/** Tags die een product met zekerheid in een categorie-collectie zetten:
 *  collecties met één regel "tag = X" (of alle regels tag-regels met X erbij). */
export function usefulTags(cols) {
  const out = [];
  for (const c of categoryCollections(cols)) {
    const rules = c.rules || [];
    if (rules.length === 1 && lc(rules[0].column) === "tag" && lc(rules[0].relation) === "equals") {
      out.push({ tag: String(rules[0].condition).trim(), title: c.title, handle: c.handle, id: c.id });
    } else if (c.disjunctive) {
      const t = rules.find((r) => lc(r.column) === "tag" && lc(r.relation) === "equals");
      if (t) out.push({ tag: String(t.condition).trim(), title: c.title, handle: c.handle, id: c.id });
    }
  }
  return out;
}

/**
 * Oordeel voor één product.
 *  cols    = smart collections mét regels (REST)
 *  gender  = "men" | "women" (leeg = genderFor: titel, dan store, dan tags)
 * → null (zit ergens in / niet te beoordelen) of
 *   { garment, tag, create, reason }  — tag null = niet automatisch te fixen (reason zegt waarom)
 */
export function categoryCollectionVerdict(p, cols, { gender = null, storeGenders = null } = {}) {
  if (!p || p.status === "archived") return null;
  const cats = categoryCollections(cols);
  // Store zonder (tag-)categorie-collecties: dan werkt de store anders (handmatige collecties) → niets zeggen
  if (usefulTags(cols).length < 2) return null;
  if (cats.some((c) => inCollection(c, p) !== false)) return null;

  const garment = garmentOf(p);
  if (!garment) return { garment: null, tag: null, create: false, reason: "kledingstuk niet herkend — handmatig indelen" };
  const men = (gender || genderFor(p, storeGenders)) === "men";
  // Dames-product in een herenstore (of andersom): geen collectie voor aanmaken
  if ((storeGenders === "M" && !men) || (storeGenders === "V" && men)) {
    return { garment, tag: null, create: false, reason: `${men ? "heren" : "dames"}-product in een ${men ? "dames" : "heren"}store — op draft zetten of omzetten` };
  }
  const menOnly = storeGenders === "M";
  const fitsGender = (t) => (men ? isMenTag(t) || (menOnly && !isWomenTag(t)) : !isMenTag(t));
  const useful = usefulTags(cols).filter((u) => fitsGender(u.tag));
  for (const key of WANT[garment] || []) {
    const hit = useful.find((u) => baseKey(u.tag) === key);
    if (hit) return { garment, tag: hit.tag, create: false, collection: hit.title };
  }
  const name = (CREATE[garment] || [])[men ? 0 : 1];
  if (!name) return { garment, tag: null, create: false, reason: `geen passende collectie voor "${garment}"` };
  // Bestaat er al een collectie met die naam die NIET op die tag werkt? Dan niet aanmaken (zou niets doen)
  const clash = (cols || []).find((c) => lc(c.title) === lc(name));
  if (clash) {
    const works = useful.some((u) => lc(u.tag) === lc(name));
    if (!works) return { garment, tag: null, create: false, reason: `collectie "${name}" bestaat al maar werkt niet op de tag — regels nakijken` };
    return { garment, tag: name, create: false, collection: name };
  }
  return { garment, tag: name, create: true, collection: name };
}
