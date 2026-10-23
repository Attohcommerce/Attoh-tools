// SHAPES WARDROBE — PRODUCTTYPES VAN CAS (23-10-2026).
//
// Cas Beckers (media buyer SW) bouwt zijn campagnes op het veld Product type.
// Elk SW-product krijgt daarom precies ÉÉN type uit zijn lijst, letterlijk
// gespeld: "<SEIZOEN> - <Womens|Mens> - <Type>", bv. "SS - Mens - Sandals".
//   AS = All Season · SS = Spring/Summer · AW = Autumn/Winter
// Bron: sheet "Producttypes", tab Fashion
//   https://docs.google.com/spreadsheets/d/1tAVzxXLgDhlTJrBDEEHyCE8JVW8c4L4TbNlRgisUikg
// Past Cas de sheet aan, dan deze lijst bijwerken (zelfde volgorde/spelling).
//
// Geldt ALLEEN voor Shapes Wardrobe (isShapesWardrobe). Dit bestand heeft
// geen server-imports — de Doctor-pagina gebruikt het ook in de browser.
// De AI-indeling (foto + titel) staat in lib/sw-product-types-ai.js.

export const SW_TYPE_SHEET = "https://docs.google.com/spreadsheets/d/1tAVzxXLgDhlTJrBDEEHyCE8JVW8c4L4TbNlRgisUikg/edit";

const SEASONS = ["AS", "SS", "AW"];
const GW = { women: "Womens", men: "Mens" };

const BASES = {
  "AS|women": ["Top", "Blouse", "T-shirt", "Polo", "Dress", "Sweater", "Hoodie", "Cardigan", "Trousers", "Jeans", "Flared Pants", "Shorts", "Skirt", "Legging", "Parka", "Bomber Jacket", "Denim Jacket", "Leather Jacket", "Trenchcoat", "Blazer", "Raincoat", "Casual Set", "Loungewear Set", "Heels", "Sneakers", "Sandals", "Boots", "Slippers", "Bag", "Belt", "Scarf", "Hat", "Cap", "Sunglasses", "Jewellery", "Watch", "Sports Top", "Sports Legging", "Sports Shorts", "Sports Bra", "Jogger", "Lingerie", "Underwear", "Socks", "Suit", "Pyjama"],
  "AS|men": ["Tanktop", "T-shirt", "Polo", "Blouse", "Sweater", "Hoodie", "Trousers", "Jeans", "Shorts", "Parka", "Bomber Jacket", "Denim Jacket", "Leather Jacket", "Trenchcoat", "Blazer", "Raincoat", "Casual Set", "Loungewear Set", "Sneakers", "Sandals", "Boots", "Slippers", "Bag", "Belt", "Scarf", "Hat", "Cap", "Sunglasses", "Jewellery", "Watch", "Sports Tanktop", "Sports Shorts", "Jogger", "Underwear", "Socks", "Suit", "Pyjama"],
  "SS|women": ["Top", "Blouse", "T-shirt", "Polo", "Dress", "Trousers", "Jeans", "Shorts", "Skirt", "Legging", "Casual Set", "Loungewear Set", "Heels", "Sneakers", "Sandals", "Slippers", "Bag", "Hat", "Sports Top", "Sports Legging", "Sports Shorts", "Sports Bra", "Jogger", "Swimwear", "Suit"],
  "SS|men": ["Tanktop", "T-shirt", "Polo", "Blouse", "Trousers", "Jeans", "Shorts", "Casual Set", "Loungewear Set", "Shoes", "Sneakers", "Sandals", "Slippers", "Bag", "Hat", "Sports Tanktop", "Sports Shorts", "Jogger", "Swimwear", "Suit"],
  "AW|women": ["Sweater", "Hoodie", "Cardigan", "Trousers", "Jeans", "Legging", "Parka", "Coat", "Casual Set", "Loungewear Set", "Boots", "Scarf", "Jogger", "Socks"],
  "AW|men": ["Sweater", "Hoodie", "Trousers", "Jeans", "Parka", "Coat", "Casual Set", "Loungewear Set", "Boots", "Scarf", "Jogger", "Socks"],
};

export function swTypeName(season, gender, base) {
  return `${season} - ${GW[gender]} - ${base}`;
}

/** Alle 154 types, exact zoals in de sheet. */
export const SW_TYPES = [];
/** Types per geslacht ("women" | "men"). */
export const SW_TYPES_BY_GENDER = { women: [], men: [] };
for (const s of SEASONS) {
  for (const g of ["women", "men"]) {
    for (const b of BASES[`${s}|${g}`]) {
      const t = swTypeName(s, g, b);
      SW_TYPES.push(t);
      SW_TYPES_BY_GENDER[g].push(t);
    }
  }
}
const TYPE_SET = new Set(SW_TYPES);

/* Losse spelling ("AS – Mens – Hat", "as-mens-hat", dubbele spaties) →
   sleutel om naar de exacte schrijfwijze terug te vinden. */
function looseKey(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-");
}
const LOOSE = new Map(SW_TYPES.map((t) => [looseKey(t), t]));

/** Shapes Wardrobe herkennen op domein of naam (store-object of string). */
export function isShapesWardrobe(storeOrDomain) {
  if (!storeOrDomain) return false;
  const s =
    typeof storeOrDomain === "string"
      ? storeOrDomain
      : `${storeOrDomain.domain || ""} ${storeOrDomain.name || ""} ${storeOrDomain.handle || ""}`;
  return /shapes\s*wardrobe|shapeswardrobe|6snnji-kr|ashbridge-2/i.test(s);
}

export function isSwType(t) {
  return TYPE_SET.has(String(t || ""));
}

/** Exacte schrijfwijze bij een bijna-goede spelling, anders null. */
export function canonicalSwType(t) {
  if (isSwType(t)) return String(t);
  return LOOSE.get(looseKey(t)) || null;
}

/** "men" | "women" | null uit een Cas-type. */
export function swTypeGender(t) {
  const m = String(t || "").match(/^(AS|SS|AW) - (Womens|Mens) - /);
  if (!m) return null;
  return m[2] === "Mens" ? "men" : "women";
}

function tagList(p) {
  return String((p && p.tags) || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/* Geslacht van een SW-product. SW-regel (Justin, okt 2026): "Men's"/"Women's"
   in de titel beslist; anders de tag Men/Women. Geen van beide → null
   (dan beslist de AI op de foto). */
export function swGenderOf(p) {
  const t = String((p && p.title) || "").replace(/[‘’ʼ`´]/g, "'").toLowerCase();
  if (/\bwomen'?s\b|\bwomens\b|\bfor women\b|\bladies\b/.test(t)) return "women";
  if (/\bmen'?s\b|\bmens\b|\bfor men\b/.test(t)) return "men";
  const tags = tagList(p);
  const w = tags.includes("women");
  const m = tags.includes("men");
  if (w && !m) return "women";
  if (m && !w) return "men";
  return null;
}

/**
 * Oordeel over het huidige type van één product:
 *  { ok: true } — exact een Cas-type, geslacht klopt
 *  { ok: false, reason, canonical?, kind? } — canonical = zonder AI rechtzetten
 *    (kind "spelling" | "seizoen" | "soort")
 */
export function swTypeVerdict(p) {
  const cur = String((p && p.product_type) || "").trim();
  const gender = swGenderOf(p);
  if (!cur) return { ok: false, reason: "leeg" };
  const canon = canonicalSwType(cur);
  if (!canon) return { ok: false, reason: "niet uit de lijst van Cas" };
  const tg = swTypeGender(canon);
  if (gender && tg && gender !== tg) return { ok: false, reason: `geslacht klopt niet (${tg === "men" ? "Mens" : "Womens"} op een ${gender === "men" ? "herenproduct" : "damesproduct"})` };
  // seizoen-/soortregel (hieronder): rechtzetten zonder AI
  const want = normalizeSwType(canon, p);
  if (want !== canon) {
    const a = parseSwType(canon);
    const b = parseSwType(want);
    const kind = a.base !== b.base ? "soort" : "seizoen";
    return {
      ok: false,
      kind,
      reason: kind === "seizoen" ? `seizoen ${a.season} → ${b.season}` : `soort ${a.base} → ${b.base}`,
      canonical: want,
    };
  }
  if (canon !== cur) return { ok: false, kind: "spelling", reason: "spelling wijkt af", canonical: canon };
  return { ok: true };
}

function cleanText(s) {
  return String(s || "").replace(/[‘’ʼ`´]/g, "'").toLowerCase();
}

export function parseSwType(t) {
  const m = String(t || "").match(/^(AS|SS|AW) - (Womens|Mens) - (.+)$/);
  return m ? { season: m[1], gender: m[2] === "Mens" ? "men" : "women", base: m[3] } : null;
}

/* ---------- SEIZOENSREGEL (Justin, 23-10-2026; vast gemaakt na storecheck) ----------
   AS is de standaard. SS alleen voor wat je echt niet in de winter draagt —
   en dan ALTIJD SS, zodat gelijke producten ook gelijk staan:
   - altijd SS: Swimwear, Sandals (ook slides/flip-flops en sandalen met hak),
     Shorts, Sports Shorts, Tanktop, Mens Shoes (bestaat alleen in SS)
   - zomerwoord in de titel (linen, hawaiian, tropical, beach, resort, summer,
     sun, straw, crochet) → SS; behalve sneakers en jeans
   - herenoverhemd (Blouse) met korte mouw / mouwloos → SS
   - set met een short erin → SS
   Al het andere AS — ook mouwloze jurken/tops, sneakers, jeans, polo's,
   t-shirts, tassen, "lightweight", "mesh", "breathable". AW blijft zoals
   gekozen (fleece, gevoerd, wol …). */
const SS_ALWAYS = new Set(["Swimwear", "Sandals", "Shorts", "Sports Shorts", "Tanktop", "Shoes"]);
const SUMMER_WORD = /\b(linen|hawaiian|tropical|beach\w*|resort|summer|sundress|sun|straw|crochet|swim\w*|bikinis?)\b/;
const SUMMER_NO = new Set(["Sneakers", "Jeans"]);
const SHORT_SLEEVE = /\b(sleeveless|short[- ]sleeves?)\b/;

function wantsSS(gender, base, title) {
  if (SS_ALWAYS.has(base)) return true;
  if (SUMMER_WORD.test(title) && !SUMMER_NO.has(base)) return true;
  if (gender === "men" && base === "Blouse" && SHORT_SLEEVE.test(title)) return true;
  if (base === "Casual Set" && /\b(shorts|skorts?)\b/.test(title)) return true;
  return false;
}

/** Seizoen volgens de regel; `chosen` telt alleen nog voor AW. */
function ruleSeason(gender, base, title, chosen) {
  const avail = seasonsWith(gender, base);
  if (avail.includes("SS") && wantsSS(gender, base, title)) return "SS";
  if (chosen === "AW" && avail.includes("AW")) return "AW";
  if (avail.includes("AS")) return "AS";
  return avail.includes(chosen) ? chosen : avail[0];
}

const FOOTWEAR = new Set(["Shoes", "Sneakers", "Sandals", "Heels", "Slippers"]);

/* Soort rechtzetten waar de titel ondubbelzinnig is. Gevonden in de storecheck
   van 23-10: board shorts half Shorts/half Swimwear, "Men's Sandals" op Shoes,
   "Linen Pants" op Jeans, compressieshirts op Tanktop, cowboylaarzen op Shoes. */
function baseFromTitle(title, base) {
  if (/\b(board\s*shorts?|boardshorts|swim\s*(shorts?|trunks?)|swimwear|swimsuits?|bikinis?|tankinis?)\b/.test(title)) return "Swimwear";
  if (/\b(sandals?|slides?|flip[- ]?flops?)\b/.test(title) && !/\b(sneakers?|boots?)\b/.test(title)) return "Sandals";
  if (FOOTWEAR.has(base) && /\b(boots?|booties|cowboy|western|chelsea)\b/.test(title)) return "Boots";
  if (/\b(sneakers?|trainers?|(running|athletic|sports?|walking|tennis)\s*shoes?)\b/.test(title)) return "Sneakers";
  if (base === "Jeans" && !/\b(jeans?|denim)\b/.test(title) && /\b(pants|trousers|chinos?|slacks|linen)\b/.test(title)) return "Trousers";
  if (base === "Tanktop" && /\b(compression|gym|training|workout|athletic|sports?)\b/.test(title)) return "Sports Tanktop";
  if (base === "Tanktop" && !/\b(tanks?|singlets?|sleeveless|vest|muscle)\b/.test(title)) return /\bshirt\b/.test(title) ? "Blouse" : "T-shirt";
  return null;
}

/** Cas-type → het type volgens de seizoens- en soortregel (zelfde geslacht). */
export function normalizeSwType(type, p) {
  const parsed = parseSwType(type);
  if (!parsed || !isSwType(type)) return type;
  const { gender, season: chosen } = parsed;
  let { base } = parsed;
  const title = cleanText(p && p.title);
  const fb = baseFromTitle(title, base);
  if (fb && fb !== base && seasonsWith(gender, fb).length) base = fb;
  return swTypeName(ruleSeason(gender, base, title, chosen), gender, base);
}

/* ---------- Vangnet zonder AI: trefwoorden → type ----------
   Wordt gebruikt als de AI-call faalt of iets buiten de lijst antwoordt.
   Volgorde = specifiek → algemeen. Een basis die voor het geslacht niet
   bestaat wordt overgeslagen (of via ALT omgezet). */
const RULES = [
  [/\bsports?\s*bra\b/, "Sports Bra"],
  [/\b(swim\w*|bikinis?|tankinis?|one[- ]piece|board\s*shorts?|boardshorts|trunks|bathing|beachwear|rash\s*guard)\b/, "Swimwear"],
  [/\b(pyjamas?|pajamas?|sleepwear|nightwear|nightgown|nightie)\b/, "Pyjama"],
  [/\b(lingerie|bralette|negligee|babydoll|bras?)\b/, "Lingerie"],
  [/\b(underwear|briefs|boxers?|panties|knickers)\b/, "Underwear"],
  [/\bsocks?\b/, "Socks"],
  [/\b(suits?|tuxedo|waistcoat)\b/, "Suit"],
  [/\b(lounge\s*(set|wear)|loungewear|tracksuits?|sweat\s*set)\b/, "Loungewear Set"],
  [/\b(co-?ords?|two[- ]piece|2[- ]piece|matching\s*set|outfit\s*set|sets?|jumpsuits?|playsuits?|rompers?|overalls?|dungarees)\b/, "Casual Set"],
  [/\btrench/, "Trenchcoat"],
  [/\b(raincoats?|rain\s*jackets?|waterproof\s*jackets?|windbreakers?|anoraks?)\b/, "Raincoat"],
  [/\b(parkas?|puffers?|down\s*jackets?|padded\s*jackets?|quilted\s*jackets?)\b/, "Parka"],
  [/\bbombers?\b/, "Bomber Jacket"],
  [/\b(denim|jean)\s*jackets?\b/, "Denim Jacket"],
  [/\b(leather|biker|moto)\s*jackets?\b/, "Leather Jacket"],
  [/\bblazers?\b/, "Blazer"],
  [/\b(coats?|overcoats?|peacoats?)\b/, "Coat"],
  [/\b(jackets?|shackets?|overshirts?)\b/, "Bomber Jacket"],
  [/\b(heels?|stilettos?|pumps|court\s*shoes?|slingbacks?)\b/, "Heels"],
  [/\b(boots?|booties|chelsea|cowboy|western)\b/, "Boots"],
  [/\b(sneakers?|trainers?|(running|sports?|walking|barefoot|athletic)\s*shoes?)\b/, "Sneakers"],
  [/\bslippers?\b/, "Slippers"],
  [/\b(sandals?|slides?|flip[- ]?flops?|espadrilles?|mules?|clogs?)\b/, "Sandals"],
  // niet "flat front" (chino's): alleen ballet flats / flats / flat shoes
  [/\b(loafers?|oxfords?|derby|brogues?|boat\s*shoes?|moccasins?|ballet\s*flats?|flats|flat\s*shoes?|ballet|shoes?|footwear)\b/, "Shoes"],
  // vóór de truien: "Knit Midi Dress" is een jurk; "dress pants/shirt" niet
  [/\b(dress|dresses|gowns?|sundress)\b(?!\s*(pants|trousers|slacks|shirts?|shoes))/, "Dress"],
  [/\b(hoodies?|hooded)\b/, "Hoodie"],
  [/\bcardigans?\b/, "Cardigan"],
  [/\b(sweaters?|jumpers?|pullovers?|sweatshirts?|crewneck)\b/, "Sweater"],
  [/\b(sports?|gym|yoga|workout|athletic|running|training|compression)\s*(tops?|tees?|t[- ]?shirts?|shirts?|tanks?|singlets?)\b/, "Sports Top"],
  [/\b(sports?|gym|yoga|workout|athletic|running|training|biker|bicycle|cycling)\s*shorts\b/, "Sports Shorts"],
  [/\b(yoga|gym|sports?|workout|athletic)\s*(leggings?|tights)\b/, "Sports Legging"],
  [/\b(joggers?|sweatpants|track\s*pants?|trackpants)\b/, "Jogger"],
  [/\bleggings?\b/, "Legging"],
  // niet "flared sleeves"/"mini flare" bij tops en shorts
  [/\b(flared?\s*(leg|pants|trousers|jeans)|flares|bell[- ]bottoms?)\b/, "Flared Pants"],
  [/\b(jeans|denim\s*pants)\b/, "Jeans"],
  [/\b(skorts?|skirts?)\b/, "Skirt"],
  [/\bshorts\b/, "Shorts"], // niet "short sleeve"
  [/\b(trousers|pants|chinos?|slacks|culottes|capris?)\b/, "Trousers"],
  [/\b(t[- ]?shirts?|tees?|henleys?)\b/, "T-shirt"], // ook "T Shirt" met spatie
  [/\bpolos?\b/, "Polo"],
  [/\b(tanks?|tank\s*tops?|singlets?|vest\s*tops?|camisoles?|cami|sleeveless)\b/, "Tanktop"],
  [/\b(knit|ribbed)\s*shirts?\b/, "T-shirt"],
  [/\b(blouses?|shirts?|button[- ]?(up|down))\b/, "Blouse"],
  [/\b(tops?|bodysuits?|crop|halter|bustier|tube|corset)\b/, "Top"],
  // "Ribbed Knit Polo" / "Knit Top" zijn hierboven al gevangen; losse knit = trui
  [/\bknit\w*\b/, "Sweater"],
  [/\b(sunglasses|shades)\b/, "Sunglasses"],
  [/\bcaps?\b(?!\s*sleeve)/, "Cap"],
  [/\b(hats?|beanies?|bucket|fedoras?|visors?|berets?)\b/, "Hat"],
  [/\b(bags?|handbags?|totes?|backpacks?|crossbody|clutch\w*|purses?|wallets?|duffle|satchels?)\b/, "Bag"],
  [/\bbelts?\b/, "Belt"],
  [/\b(scarf|scarves|shawls?|pashminas?)\b/, "Scarf"],
  [/\bwatch(es)?\b/, "Watch"],
  [/\b(necklaces?|bracelets?|earrings?|rings?|jewell?ery|pendants?|anklets?)\b/, "Jewellery"],
];
// basis die voor dit geslacht niet bestaat → alternatief
const ALT = {
  women: { Tanktop: "Top", Shoes: "Sneakers", "Sports Tanktop": "Sports Top" },
  men: { Top: "T-shirt", "Sports Top": "Sports Tanktop", Cardigan: "Sweater", Legging: "Jogger", "Sports Legging": "Jogger", "Flared Pants": "Trousers", Lingerie: "Underwear", "Sports Bra": "Sports Tanktop" },
};
// niet "button down" en niet elke "knit" (gebreide t-shirts/polo's zijn AS)
const COLD = /\b(wool|woolen|fleece|puffer|padded|thermal|cashmere|sherpa|quilted|fur|faux\s*fur|winter|turtleneck|chunky|cable|corduroy|borg|teddy|insulated|(goose|duck)\s*down|down\s*(filled|jacket|coat))\b/;

function seasonsWith(gender, base) {
  return SEASONS.filter((s) => BASES[`${s}|${gender}`].includes(base));
}

/** Type zonder AI (vangnet). gender: "men" | "women"; onbekend → "women". */
export function guessSwType(p, genderIn) {
  const gender = genderIn === "men" ? "men" : "women";
  const clean = (s) => String(s || "").replace(/[‘’ʼ`´]/g, "'").toLowerCase();
  const findBase = (txt) => {
    for (const [re, b] of RULES) {
      if (!re.test(txt)) continue;
      const cand = seasonsWith(gender, b).length ? b : ALT[gender][b];
      if (cand && seasonsWith(gender, cand).length) return cand;
    }
    return null;
  };
  // SW-titels: "<Men's|Women's> <wat het is> | <kenmerken>". Eerst het stuk
  // vóór de "|" (anders wint "Puffer Design" van "Quilted Tote Bag"), dan de
  // hele titel, het oude producttype (vaak rommel) alleen als laatste bron.
  const title = clean(p && p.title);
  const head = title.split("|")[0];
  const text = title || clean(p && p.product_type); // seizoen-signalen alleen uit de titel
  let base = (head !== title && findBase(head)) || findBase(title) || findBase(clean(p && p.product_type));
  // "Chino | Pleated Tailored Cuffed Shorts" is een short
  if (/^(Trousers|Jeans|Jogger)$/.test(base || "") && /\bshorts\b/.test(title) && seasonsWith(gender, "Shorts").length) base = "Shorts";
  // "Lightweight Shoe | Lace Closure Mesh Upper" / "Canvas Shoe | Low-Top" zijn sneakers
  if (/^(Shoes|Sneakers)$/.test(base || "") && /\b(mesh|knit\s*upper|low[- ]tops?|high[- ]tops?|athletic|running|canvas\s*shoes?)\b/.test(title) && !/\b(loafers?|boat|derby|oxfords?|brogues?|moccasins?)\b/.test(title)) base = "Sneakers";
  if (!base) base = gender === "men" ? "T-shirt" : "Top";
  const avail = seasonsWith(gender, base);
  const season = COLD.test(text) && avail.includes("AW") ? "AW" : avail.includes("AS") ? "AS" : avail[0];
  // seizoensregel (SS voor sandalen/shorts/zwemkleding/linnen …, rest AS) + soortregel
  return normalizeSwType(swTypeName(season, gender, base), p);
}

/** De lijst als leesbare tekst voor de AI-prompt (per geslacht, per seizoen). */
export function swTypeListText(gender) {
  const gs = gender === "men" || gender === "women" ? [gender] : ["women", "men"];
  const lines = [];
  for (const g of gs) {
    for (const s of SEASONS) {
      lines.push(`${s} ${g === "men" ? "MEN" : "WOMEN"}: ${BASES[`${s}|${g}`].map((b) => swTypeName(s, g, b)).join(" | ")}`);
    }
  }
  return lines.join("\n");
}
