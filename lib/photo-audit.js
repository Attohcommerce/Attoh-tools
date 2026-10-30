/* FOTO-AUDIT (30-10-2026) — strengere geslachts- en collectiecheck.

   Aanleiding: een klant/reviewer vond op SSB "Women's Pants | Elastic Waist"
   met een MAN op de foto in de damescollectie, en in "Tank Tops" een jas, een
   overhemd en een longsleeve. De oude AI-geslachtscheck liet de titel "bijna
   absoluut" winnen — maar de titel is juist wat er fout is. Hier is de FOTO
   de baas:
   - staat er duidelijk een man/vrouw op de foto en zegt de titel/tag het
     andere geslacht → misgenderd (eruit halen of omzetten);
   - toont de foto een kledingstuk dat niet bij een collectie-tag hoort
     (jas in Tank Tops) → tag eraf, juiste tag erbij als de store die heeft.
   Plus twee gratis checks zonder AI: titels die zichzelf tegenspreken
   ("Tank Top | Long Sleeve") en producten met dezelfde foto in één collectie. */

// Wat de AI per foto teruggeeft (vaste lijst, zodat we hard kunnen vergelijken)
export const GARMENTS = [
  "dress", "skirt", "jeans", "trousers", "shorts", "jumpsuit", "set",
  "tank-top", "short-sleeve-top", "long-sleeve-top", "shirt-blouse",
  "sweater-knit", "cardigan", "hoodie-sweatshirt", "jacket-coat", "blazer", "vest-gilet",
  "boots", "flats-loafers", "sneakers", "heels", "sandals", "slippers-clogs", "other-shoe",
  "bag", "accessory", "swimwear", "other",
];

const TOPS = ["tank-top", "short-sleeve-top", "long-sleeve-top", "shirt-blouse"];
const SHOES = ["boots", "flats-loafers", "sneakers", "heels", "sandals", "slippers-clogs", "other-shoe"];

/* Collectie-tag (zonder Men's/Women's, kleine letters) → welke kledingstukken
   erin mogen. Tags die hier niet staan worden niet beoordeeld. */
export const COLLECTION_FIT = {
  "tank tops": ["tank-top"],
  "tanks": ["tank-top"],
  "camis": ["tank-top"],
  "blouses": ["shirt-blouse", "long-sleeve-top", "short-sleeve-top", "tank-top"],
  "other tops": [...TOPS, "sweater-knit"],
  "tops": [...TOPS, "sweater-knit"],
  "t-shirts": ["short-sleeve-top", "long-sleeve-top"],
  "shirts": ["shirt-blouse", "short-sleeve-top", "long-sleeve-top"],
  "polos": ["short-sleeve-top", "shirt-blouse"],
  "sweaters": ["sweater-knit", "cardigan", "hoodie-sweatshirt"],
  "knitwear": ["sweater-knit", "cardigan", "vest-gilet"],
  "cardigans": ["cardigan", "sweater-knit"],
  "hoodies": ["hoodie-sweatshirt"],
  "sweatshirts": ["hoodie-sweatshirt", "sweater-knit"],
  "jackets & coats": ["jacket-coat", "blazer", "vest-gilet"],
  "jackets": ["jacket-coat", "blazer", "vest-gilet"],
  "coats": ["jacket-coat"],
  "blazers": ["blazer", "jacket-coat"],
  "jeans": ["jeans"],
  "trousers": ["trousers", "jeans"],
  "pants": ["trousers", "jeans"],
  "pants & jeans": ["trousers", "jeans"],
  "shorts": ["shorts"],
  "skirts": ["skirt"],
  "dresses": ["dress"],
  "casual dresses": ["dress"],
  "formal & occasion dresses": ["dress", "jumpsuit"],
  "wedding guest & bridesmaid dresses": ["dress", "jumpsuit"],
  "jumpsuits & playsuits": ["jumpsuit"],
  "co-ord sets": ["set"],
  "sets": ["set"],
  "boots": ["boots"],
  "shoes": SHOES,
  "flats & loafers": ["flats-loafers", "slippers-clogs"],
  "loafers": ["flats-loafers"],
  "sneakers": ["sneakers"],
  "heels": ["heels"],
  "sandals": ["sandals", "slippers-clogs"],
  "bags": ["bag"],
  "swimwear": ["swimwear"],
};

const GENDER_PREFIX = /^(men'?s|mens|men|male|gents?|women'?s|womens|women|ladies|lady'?s|female)\s+/i;
export function fitKey(tag) {
  return String(tag || "").replace(GENDER_PREFIX, "").trim().toLowerCase();
}

// Eerste passende collectie-tag voor een kledingstuk (voorkeursvolgorde)
const BEST_FOR = {
  "tank-top": ["tank tops", "other tops", "tops"],
  "short-sleeve-top": ["other tops", "t-shirts", "shirts", "tops"],
  "long-sleeve-top": ["other tops", "shirts", "tops"],
  "shirt-blouse": ["blouses", "shirts", "other tops", "tops"],
  "sweater-knit": ["sweaters", "knitwear"],
  cardigan: ["sweaters", "knitwear", "cardigans"],
  "hoodie-sweatshirt": ["hoodies", "sweatshirts", "sweaters"],
  "jacket-coat": ["jackets & coats", "jackets", "coats"],
  blazer: ["jackets & coats", "blazers", "jackets"],
  "vest-gilet": ["jackets & coats", "knitwear"],
  jeans: ["jeans", "pants & jeans", "trousers", "pants"],
  trousers: ["trousers", "pants", "pants & jeans"],
  shorts: ["shorts"],
  skirt: ["skirts"],
  dress: ["casual dresses", "dresses"],
  jumpsuit: ["jumpsuits & playsuits"],
  set: ["co-ord sets", "sets"],
  boots: ["boots"],
  "flats-loafers": ["flats & loafers", "loafers", "shoes"],
  "slippers-clogs": ["flats & loafers", "sandals", "shoes"],
  sneakers: ["sneakers", "shoes"],
  heels: ["heels", "shoes"],
  sandals: ["sandals", "shoes"],
  "other-shoe": ["shoes"],
  bag: ["bags"],
  swimwear: ["swimwear"],
};

/** Zoekt in de tags die de store al gebruikt de beste tag voor dit kledingstuk
 *  en geslacht ("Men's Shirts" voor heren, kale "Blouses" voor dames). */
export function bestTagFor(garment, gender, knownTags) {
  const keys = BEST_FOR[garment] || [];
  const known = [...(knownTags || [])];
  for (const k of keys) {
    const hit = known.find((t) => {
      if (fitKey(t) !== k) return false;
      const isMen = /^(men'?s|mens|men|gents?)\b/i.test(t);
      return gender === "Men" ? isMen : !isMen; // dames = kale tag of "Women's …"
    });
    if (hit) return hit;
  }
  return null;
}

/* ---------- Titel spreekt zichzelf tegen (gratis) ---------- */
const SLEEVELESS_RE = /\b(tank|cami|camisole|sleeveless|spaghetti|strappy|halter|tube top)\b/i;
const SLEEVED_RE = /\b(long[\s-]?sleeves?|short[\s-]?sleeves?|elbow[\s-]?sleeves?|3\/4[\s-]?sleeves?|puff[\s-]?sleeves?|batwing)\b/i;
const OUTER_RE = /\b(jacket|coat|blazer|parka|trench|puffer|anorak|bomber)\b/i;
export function titleContradiction(title) {
  const t = String(title || "");
  const head = t.split("|")[0];
  if (SLEEVELESS_RE.test(head) && SLEEVED_RE.test(t)) return `"${head.trim()}" maar ook "${t.match(SLEEVED_RE)[0]}"`;
  if (/\b(tank|cami|top|tee|t-shirt|blouse)\b/i.test(head) && OUTER_RE.test(t.split("|").slice(1).join(" "))) {
    return `"${head.trim()}" maar ook "${t.match(OUTER_RE)[0]}"`;
  }
  if (/\bwomen'?s\b/i.test(t) && /\bmen'?s\b/i.test(t.replace(/women'?s/gi, ""))) return "zowel Women's als Men's in de titel";
  return null;
}

/* ---------- Dezelfde foto bij meerdere producten (gratis) ----------
   Shopify plakt bij een her-upload "_<uuid>" achter de bestandsnaam;
   "92408fbe-….jpg" en "92408fbe-…_8fa73b8c-….jpg" zijn dezelfde foto. */
export function imageKey(src, w, h) {
  try {
    const u = new URL(String(src));
    let name = decodeURIComponent(u.pathname.split("/").pop() || "").toLowerCase();
    name = name.replace(/\.(jpe?g|png|webp|gif|avif)$/i, "");
    name = name.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "");
    name = name.replace(/-photoroom$/i, "").replace(/_\d{2,4}x\d{0,4}$/i, "");
    // te generieke namen ("1", "main", "image") zeggen niets
    if (name.length < 6 || /^(image|img|photo|main|product|untitled)[-_ ]?\d*$/.test(name)) return null;
    return `${name}${w && h ? `@${w}x${h}` : ""}`;
  } catch {
    return null;
  }
}

/* ---------- Oordeel per product na de foto-AI ---------- */
function titleGender(title) {
  const t = String(title || "").toLowerCase();
  if (/\bwomen'?s\b|\bfor women\b|\bladies\b/.test(t)) return "Women";
  if (/\bmen'?s\b|\bfor men\b/.test(t)) return "Men";
  return null;
}
function tagGender(tags) {
  const list = String(tags || "").split(",").map((t) => t.trim().toLowerCase());
  const m = list.includes("men");
  const w = list.includes("women");
  return m && !w ? "Men" : w && !m ? "Women" : null;
}

/**
 * p: { id, title, tags }, a: { person: "man"|"woman"|"none"|"unclear", sure: 0-1, garment }
 * storeGenders: "M" | "V" | "MV" | null; knownTags: Set van alle tags in de store
 * → { gender: {current, photo, singleGenderStore} | null, fit: {drop[], add, garment} | null }
 */
export function auditVerdict(p, a, { storeGenders, knownTags } = {}) {
  const res = { gender: null, fit: null };
  if (!a) return res;
  const photo = a.person === "man" ? "Men" : a.person === "woman" ? "Women" : null;
  const current = titleGender(p.title) || tagGender(p.tags) || (storeGenders === "M" ? "Men" : storeGenders === "V" ? "Women" : null);
  if (photo && current && photo !== current && (a.sure == null || a.sure >= 0.8)) {
    res.gender = { current, photo, singleGenderStore: storeGenders === "M" || storeGenders === "V" };
  }
  const g = String(a.garment || "");
  if (g && g !== "other" && GARMENTS.includes(g)) {
    const tags = String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    const drop = tags.filter((t) => {
      const allow = COLLECTION_FIT[fitKey(t)];
      return allow && !allow.includes(g);
    });
    if (drop.length) {
      const gender = photo || current || "Women";
      const fits = tags.some((t) => (COLLECTION_FIT[fitKey(t)] || []).includes(g));
      const add = fits ? null : bestTagFor(g, gender, knownTags);
      res.fit = { drop, add, garment: g };
    }
  }
  return res;
}
