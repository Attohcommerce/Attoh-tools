// PRODUCTCATEGORIE + PRODUCT TYPE — één bron voor importer én Store Doctor.
//
// Aanleiding (RTM/Ana, 15-10-2026, SSB): nieuwe producten stonden op
// "Uncategorized" en het product type had geen geslacht ("Barrel Leg Jeans").
// Category stuurt Google's productclassificatie + de categorie-metafields
// (o.a. gender) in de feed; het product type gaat 1-op-1 als product_type de
// feed in. Allebei leeg/vaag = minder relevante vertoningen.
//
// Waarom vaste GID's i.p.v. de taxonomie-zoekfunctie: de zoekfunctie eiste
// een exacte naam en vond voor loafers, mules, tops, coats, jumpsuits en
// scarves niets ("Loafers" bestaat niet in Shopify's taxonomie — dat is
// "Shoes > Flats"). Gevolg: die producten bleven stil leeg. De GID's
// hieronder komen uit Shopify's Standard Product Taxonomy (2026) en zijn
// stabiel; setProductCategory verifieert na het schrijven alsnog.

import { analyzeKeyword } from "@/lib/fashion";

const G = (id, name) => ({ gid: `gid://shopify/TaxonomyCategory/${id}`, name });

// typeId (lib/fashion.js TYPE_GROUPS) → categorie
export const CATEGORY_BY_TYPE = {
  dress: G("aa-1-4", "Apparel & Accessories > Clothing > Dresses"),
  tshirt: G("aa-1-13-8", "Apparel & Accessories > Clothing > Clothing Tops > T-Shirts"),
  shirt: G("aa-1-13-7", "Apparel & Accessories > Clothing > Clothing Tops > Shirts"),
  blouse: G("aa-1-13-1", "Apparel & Accessories > Clothing > Clothing Tops > Blouses"),
  top: G("aa-1-13", "Apparel & Accessories > Clothing > Clothing Tops"),
  sweater: G("aa-1-13-12", "Apparel & Accessories > Clothing > Clothing Tops > Sweaters"),
  hoodie: G("aa-1-13-13", "Apparel & Accessories > Clothing > Clothing Tops > Hoodies"),
  cardigan: G("aa-1-13-3", "Apparel & Accessories > Clothing > Clothing Tops > Cardigans"),
  jacket: G("aa-1-10-2", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets"),
  coat: G("aa-1-10-2", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets"),
  blazer: G("aa-1-10-2-18", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Blazers"),
  jeans: G("aa-1-12-4", "Apparel & Accessories > Clothing > Pants > Jeans"),
  pants: G("aa-1-12", "Apparel & Accessories > Clothing > Pants"),
  leggings: G("aa-1-12-8", "Apparel & Accessories > Clothing > Pants > Leggings"),
  shorts: G("aa-1-14", "Apparel & Accessories > Clothing > Shorts"),
  skirt: G("aa-1-15", "Apparel & Accessories > Clothing > Skirts"),
  jumpsuit: G("aa-1-9", "Apparel & Accessories > Clothing > One-Pieces"),
  heels: G("aa-8-10", "Apparel & Accessories > Shoes > Heels"),
  boots: G("aa-8-3", "Apparel & Accessories > Shoes > Boots"),
  sneakers: G("aa-8-8", "Apparel & Accessories > Shoes > Sneakers"),
  loafers: G("aa-8-9", "Apparel & Accessories > Shoes > Flats"),
  sandals: G("aa-8-6", "Apparel & Accessories > Shoes > Sandals"),
  flats: G("aa-8-9", "Apparel & Accessories > Shoes > Flats"),
  mules: G("aa-8-9", "Apparel & Accessories > Shoes > Flats"),
  bag: G("aa-5-4", "Apparel & Accessories > Handbags, Wallets & Cases > Handbags"),
  scarf: G("aa-2-26", "Apparel & Accessories > Clothing Accessories > Scarves & Shawls"),
  belt: G("aa-2-6", "Apparel & Accessories > Clothing Accessories > Belts"),
  hat: G("aa-2-17", "Apparel & Accessories > Clothing Accessories > Hats"),
  swimsuit: G("aa-1-20", "Apparel & Accessories > Clothing > Swimwear"),
  bikini: G("aa-1-20-6", "Apparel & Accessories > Clothing > Swimwear > Classic Bikinis"),
  vest: G("aa-1-10-6", "Apparel & Accessories > Clothing > Outerwear > Vests"),
  polo: G("aa-1-13-6", "Apparel & Accessories > Clothing > Clothing Tops > Polos"),
  bodysuit: G("aa-1-13-2", "Apparel & Accessories > Clothing > Clothing Tops > Bodysuits"),
  kimono: G("aa-1-13-3", "Apparel & Accessories > Clothing > Clothing Tops > Cardigans"),
  pajamas: G("aa-1-17-4", "Apparel & Accessories > Clothing > Sleepwear & Loungewear > Pajamas"),
  bra: G("aa-1-6-3", "Apparel & Accessories > Clothing > Lingerie > Bras"),
  set: G("aa-1-11", "Apparel & Accessories > Clothing > Outfit Sets"),
  suit: G("aa-1-19", "Apparel & Accessories > Clothing > Suits"),
  sunglasses: G("aa-2-27", "Apparel & Accessories > Clothing Accessories > Sunglasses"),
};

// Fijnere bladeren als de titel het specifieker zegt (alleen bij een zeker woord)
const REFINE = [
  { types: ["hoodie"], re: /\bsweatshirts?\b|\bcrewneck\b/, cat: G("aa-1-13-14", "Apparel & Accessories > Clothing > Clothing Tops > Sweatshirts") },
  { types: ["top"], re: /\btank\b|\bcami(sole)?\b/, cat: G("aa-1-13-9", "Apparel & Accessories > Clothing > Clothing Tops > Tank Tops") },
  { types: ["top"], re: /\bcorset\b/, cat: G("aa-1-13-15", "Apparel & Accessories > Clothing > Clothing Tops > Corset Tops") },
  { types: ["top", "blouse", "shirt"], re: /\btunic\b/, cat: G("aa-1-13-11", "Apparel & Accessories > Clothing > Clothing Tops > Tunics") },
  { types: ["pants"], re: /\bcargo\b/, cat: G("aa-1-12-2", "Apparel & Accessories > Clothing > Pants > Cargo Pants") },
  { types: ["pants"], re: /\bchinos?\b/, cat: G("aa-1-12-3", "Apparel & Accessories > Clothing > Pants > Chinos") },
  { types: ["pants"], re: /\btrousers?\b|\bslacks\b/, cat: G("aa-1-12-11", "Apparel & Accessories > Clothing > Pants > Trousers") },
  /* Zwemshorts zijn zwemkleding (16-10): basis Swimwear, het fijnste blad
     (Boardshorts / Swim Shorts / Swim Trunks) kiest lib/category-attrs.js. */
  { types: ["shorts", "swimsuit"], re: /\b(board ?shorts?|boardies|swim(ming)? (shorts?|trunks?)|swim ?trunks?|trunks)\b/, cat: G("aa-1-20", "Apparel & Accessories > Clothing > Swimwear") },
  { types: ["shorts"], re: /\bcargo\b/, cat: G("aa-1-14-2", "Apparel & Accessories > Clothing > Shorts > Cargo Shorts") },
  { types: ["coat", "jacket"], re: /\btrench\b/, cat: G("aa-1-10-2-13", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Trench Coats") },
  { types: ["coat", "jacket"], re: /\bpuffer\b|\bdown jacket\b|\bquilted\b/, cat: G("aa-1-10-2-9", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Puffer Jackets") },
  { types: ["coat", "jacket"], re: /\bbomber\b/, cat: G("aa-1-10-2-2", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Bomber Jackets") },
  { types: ["coat", "jacket"], re: /\bparka\b/, cat: G("aa-1-10-2-6", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Parkas") },
  { types: ["coat", "jacket"], re: /\bovercoat\b|\bwool coat\b|\blong coat\b/, cat: G("aa-1-10-2-5", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Overcoats") },
  { types: ["coat", "jacket"], re: /\bdenim jacket\b|\btrucker\b|\bjean jacket\b/, cat: G("aa-1-10-2-14", "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets > Trucker Jackets") },
  { types: ["swimsuit"], re: /\bone[- ]piece\b/, cat: G("aa-1-20-22", "Apparel & Accessories > Clothing > Swimwear > One-Piece Swimsuits") },
  { types: ["swimsuit", "bikini"], re: /\bcover[- ]?ups?\b|\bsarong\b/, cat: G("aa-1-20-7", "Apparel & Accessories > Clothing > Swimwear > Cover Ups") },
  { types: ["sneakers"], re: /\brunning\b|\btrainers?\b/, cat: G("aa-8-8", "Apparel & Accessories > Shoes > Sneakers") },
  { types: ["sandals", "mules", "flats", "loafers"], re: /\bslippers?\b/, cat: G("aa-8-7", "Apparel & Accessories > Shoes > Slippers") },
];

// Een categorie in deze takken is altijd fout op onze (volwassen) stores
export const CATEGORY_BAD_BRANCH_RE = /baby|toddler|children|kids|infant|boys'|girls'|nursing|maternity|costume|uniform/i;

function norm(s) {
  return String(s || "").toLowerCase().replace(/[‘’ʼ`´']/g, "'").replace(/\s+/g, " ").trim();
}
// Linkerdeel van de titel = het "wat is het" ("Women's Barrel Leg Jeans | ...")
export function titleHead(title) {
  return String(title || "").replace(/[‘’ʼ`´]/g, "'").split("|")[0].replace(/\s+/g, " ").trim();
}

function typeIdOf(text) {
  const s = norm(text).replace(/\b(women'?s|men'?s|ladies|for (wo)?men|unisex)\b/g, " ").replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  try {
    const a = analyzeKeyword(s);
    if (a && a.typeId && CATEGORY_BY_TYPE[a.typeId]) return a.typeId;
  } catch {}
  // Type staat niet achteraan ("Loafer Shoe For Men Tassel Slip-On") →
  // elk woord van achter naar voren proberen, eerste herkende wint.
  const words = s.split(" ");
  for (let i = words.length - 1; i >= 0; i--) {
    for (const len of [2, 1]) {
      if (i - len + 1 < 0) continue;
      const chunk = words.slice(i - len + 1, i + 1).join(" ");
      try {
        const a = analyzeKeyword(chunk);
        if (a && a.typeId && CATEGORY_BY_TYPE[a.typeId] && a.typeTerms && a.typeTerms.length) return a.typeId;
      } catch {}
    }
  }
  return null;
}

/**
 * categoryFor(product) → { typeId, gid, name } | null
 * Bron: titel-kop (wat de klant ziet), dan product_type. Geen herkenbaar
 * type = null → de Doctor laat het product met rust (liever leeg dan fout).
 */
export function categoryFor(p) {
  const head = titleHead(p.title);
  const typeId = typeIdOf(head) || typeIdOf(p.product_type) || typeIdOf(p.title);
  if (!typeId) return null;
  const text = norm(`${head} ${p.product_type || ""}`);
  const refined = REFINE.find((r) => r.types.includes(typeId) && r.re.test(text));
  const cat = refined ? refined.cat : CATEGORY_BY_TYPE[typeId];
  return { typeId, gid: cat.gid, name: cat.name };
}

// Is de huidige categorie fout t.o.v. wat wij afleiden?
// - kinder/positie/kostuum-tak: altijd fout
// - andere hoofdtak (Shoes vs Clothing vs Handbags): fout
// - zelfde hoofdtak, ander pad: NIET flaggen (Shopify's eigen keuze binnen
//   dezelfde tak is meestal ook goed — geen ruis in het rapport)
export function categoryVerdict(currentName, want) {
  if (!currentName) return want ? "missing" : "ok";
  if (CATEGORY_BAD_BRANCH_RE.test(currentName)) return "bad-branch";
  if (!want) return "ok";
  if (currentName === want.name) return "ok";
  const top = (n) => String(n).split(" > ").slice(0, 2).join(" > ");
  if (top(currentName) !== top(want.name)) return "wrong-branch";
  /* 16-10: "refine" = er is een fijnere categorie die de titel draagt
     (Shorts → Denim Shorts, Activewear > Shorts → Shorts > Cargo Shorts).
     Alleen als `want` zelf verfijnd is (want.refined) of de huidige een
     voorouder van `want` is — Shopify's eigen keuze binnen dezelfde tak
     zonder betere kennis blijft "ok". */
  if (want.name.startsWith(currentName + " > ")) return "refine";
  if (want.refined) return "refine";
  return "ok";
}

/* ---------- PRODUCT TYPE MET GESLACHT ----------
   Ana (RTM): "add gender and maybe extra relevant details to product type".
   Regel: product type = "<Women's|Men's> <kop van de titel zonder geslacht>",
   mits die kop kort is en een herkenbaar kledingtype bevat ("Women's Barrel
   Leg Jeans"). Anders: geslacht + bestaand type, of geslacht + standaardlabel. */
const TYPE_LABEL = {
  dress: "Dress", tshirt: "T-Shirt", shirt: "Shirt", blouse: "Blouse", top: "Top",
  sweater: "Sweater", hoodie: "Hoodie", cardigan: "Cardigan", jacket: "Jacket", coat: "Coat",
  blazer: "Blazer", jeans: "Jeans", pants: "Pants", leggings: "Leggings", shorts: "Shorts",
  skirt: "Skirt", jumpsuit: "Jumpsuit", heels: "Heels", boots: "Boots", sneakers: "Sneakers",
  loafers: "Loafers", sandals: "Sandals", flats: "Flats", mules: "Mules", bag: "Handbag",
  scarf: "Scarf", belt: "Belt", hat: "Hat", swimsuit: "Swimsuit", bikini: "Bikini",
  vest: "Vest", polo: "Polo Shirt", bodysuit: "Bodysuit", kimono: "Kimono", pajamas: "Pajamas",
  bra: "Bra", set: "Two-Piece Set", suit: "Suit", sunglasses: "Sunglasses",
};
const GENDER_WORD_RE = /\b(women'?s|womens|men'?s|mens|ladies|lady'?s|for women|for men|female|male|unisex)\b/gi;

export function typeHasGender(t) {
  return /^(women'?s|men'?s)\s/i.test(String(t || "").trim());
}

function titleCase(s) {
  return String(s)
    .split(" ")
    .map((w) => (/^[A-Z0-9-]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** gender: "men" | "women" (uit titel/tags/storeprofiel) */
export function genderedTypeFor(p, gender) {
  const g = gender === "men" ? "Men's" : "Women's";
  const typeId = typeIdOf(titleHead(p.title)) || typeIdOf(p.product_type) || typeIdOf(p.title);
  // Krul-apostrof eerst recht: anders "Men’s" → "Men's 's Chino Shorts" (EMC 16-10)
  const clean = (s) => String(s || "").replace(/[‘’ʼ`´]/g, "'").replace(GENDER_WORD_RE, " ").replace(/(^|\s)'s\b/g, " ").replace(/[^A-Za-z0-9&'\- ]/g, " ").replace(/\s+/g, " ").trim();

  // 1. kop van de titel: kort (2–5 woorden zonder geslacht) én met een type
  const head = clean(titleHead(p.title));
  const headWords = head ? head.split(" ").length : 0;
  if (head && headWords >= 1 && headWords <= 5 && typeIdOf(head)) {
    return `${g} ${titleCase(head)}`.slice(0, 255);
  }
  // 2. bestaand product type (zonder geslacht) als het een type bevat
  const cur = clean(p.product_type);
  if (cur && cur.split(" ").length <= 5 && typeIdOf(cur)) return `${g} ${titleCase(cur)}`.slice(0, 255);
  // 3. standaardlabel
  if (typeId && TYPE_LABEL[typeId]) return `${g} ${TYPE_LABEL[typeId]}`;
  return null;
}
