// Collection & Product organization — de verdeel-engine.
//
// Neemt de samengevoegde keyword-lijst (uit stap 1) en bepaalt per markt
// welke keywords op de store komen en hoeveel producten elk keyword krijgt:
//  1. rommel eruit (merkenlijst + herhaalde woorden + buitenlandse woorden)
//  2. seizoensscore = som van de 4 gekozen maanden; te laag volume valt af
//  3. elk keyword → één collectie uit de vaste blauwdruk
//  4. varianten samenvoegen voor de vraagberekening (stem-dedupe)
//  5. budget verdelen: eerst over collecties (gedempt op vraag),
//     daarna binnen elke collectie over de keywords (max spreiding,
//     vloer 5 / cap 28 producten per keyword)
import { isJunkKeyword } from "./brands";
import { analyzeKeyword, hardAttributes } from "./fashion";

export const TOTAL_DEFAULT = 1000;
const W_SHARE = 0.87; // dames-aandeel bij man + vrouw

// Twee verdeel-modi:
// - "spread" (default): maximale keyword-spreiding, alles wat goed is komt erin.
// - "focus": voor kleine stores — zwakke collecties vallen VOLLEDIG weg en het
//   budget concentreert op de meest kansrijke productsoorten; elk gekozen
//   keyword krijgt genoeg producten om echt mee te tellen (hogere vloer,
//   minder demping zodat winnaars proportioneel meer pakken).
const MODES = {
  spread: {
    alpha: 0.55, // demping: toppers winnen, maar slokken niet alles op
    cap: 28, // max producten per keyword
    floor: 5, // minder dan dit → keyword valt af
    colCapFrac: 0.3, // geen collectie groter dan 30% van het totaal
    minColBudget: 5, // collectie doet mee zodra er 1 keyword in past
    colorCap: 2, // max keywords die alleen in KLEUR verschillen, per productsoort
  },
  focus: {
    alpha: 1.0,
    cap: 28,
    floor: 8,
    colCapFrac: 0.45,
    minColBudget: 24, // een collectie verdient alleen een plek met ≥3 serieuze keywords
    colorCap: 1,
  },
};

/* ================= MARKT: halfrond, seizoen en koopmoment =================

   Tot nu toe was "Markt" alleen een woordje in de AI-prompt: de verdeling zelf
   rekende puur op zoekvolume. Daardoor kreeg een AUS-store in september-december
   evenveel laarzen en truien als een Amerikaanse — terwijl het daar lente wordt
   en richting hoogzomer gaat. Zoekvolume is bovendien geen koopgedrag: mensen
   zoeken het hele jaar "boots", maar kopen ze in het koude seizoen.

   Deze laag vertaalt de markt naar drie dingen die wél over kopen gaan:
     1. HALFROND  → welk seizoen het is in de gekozen maanden
     2. SEIZOEN   → komt de productsoort eraan, loopt hij door, of is hij voorbij
     3. AGENDA    → valt het evenement achter het keyword binnen het venster
========================================================================== */

export const MARKETS = {
  USA: { hemisphere: "N", label: "United States" },
  UK: { hemisphere: "N", label: "United Kingdom" },
  CAN: { hemisphere: "N", label: "Canada" },
  AUS: { hemisphere: "S", label: "Australia & New Zealand" },
};

const MONTH_ORDER = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
// Noordelijk halfrond, per maandindex
const SEASON_N = [
  "winter", "winter", "spring", "spring", "spring", "summer",
  "summer", "summer", "autumn", "autumn", "autumn", "winter",
];
const FLIP = { winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" };

export function seasonOf(monthKey, hemisphere) {
  const i = MONTH_ORDER.indexOf(String(monthKey || "").toLowerCase());
  if (i < 0) return null;
  const s = SEASON_N[i];
  return hemisphere === "S" ? FLIP[s] : s;
}

/* In welk seizoen wordt een productsoort daadwerkelijk GEKOCHT.
   Collecties die hier niet in staan verkopen het hele jaar door (jeans,
   blouses, gelegenheidsjurken) en krijgen geen seizoenscorrectie. */
const COL_SEASONS = {
  Swimwear: ["summer"],
  Sandals: ["spring", "summer"],
  Shorts: ["spring", "summer"],
  "Tank Tops": ["spring", "summer"],
  Skirts: ["spring", "summer"],
  "Casual Dresses": ["spring", "summer"],
  Boots: ["autumn", "winter"],
  Sweaters: ["autumn", "winter"],
  Hoodies: ["autumn", "winter", "spring"],
  "Jackets & Coats": ["autumn", "winter", "spring"],
  "Men's Boots": ["autumn", "winter"],
  "Men's Sweaters": ["autumn", "winter"],
  "Men's Hoodies": ["autumn", "winter", "spring"],
  "Men's Jackets & Coats": ["autumn", "winter", "spring"],
  "Men's Shorts": ["spring", "summer"],
};

/* Het venster in tweeën: de producten gaan pas leven aan het EIND van het
   venster, dus een seizoen dat er aan komt is meer waard dan een seizoen dat
   afloopt. Dat is het verschil tussen inkopen op data en inkopen op trend. */
/* Categorieën die buiten hun seizoen ECHT dood zijn. Shorts in een
   Amerikaanse december is dode voorraad; laarzen in een Australische lente
   zijn nog gewoon mode (trans-seasonal), dus die houden de zachte demping. */
export const HARD_SUMMER = new Set(["Shorts", "Men's Shorts", "Swimwear", "Sandals"]);

export function seasonFactor(col, windowSeasons) {
  const want = COL_SEASONS[col];
  if (!want || !windowSeasons.length) return 1;
  const half = Math.ceil(windowSeasons.length / 2);
  const early = windowSeasons.slice(0, half);
  const late = windowSeasons.slice(half);
  const inEarly = early.some((s) => want.includes(s));
  const inLate = late.some((s) => want.includes(s));
  if (inLate && !inEarly) return 1.3; // seizoen komt eraan → nu inkopen
  if (inLate && inEarly) return 1.15; // loopt door het hele venster
  if (inEarly && !inLate) return 0.75; // seizoen loopt af
  // Volledig buiten het venster: hard-seizoensgebonden soorten vrijwel op nul
  return HARD_SUMMER.has(col) ? 0.25 : 0.6;
}

/* Verkoopagenda per markt. Een gelegenheidskeyword is alleen geld waard als
   het evenement BINNEN het venster valt — "christmas party dress" in maart is
   dode vraag, en spring racing carnival is in Australië in oktober-november
   een groter modemoment dan welke bruiloft ook. */
const EVENTS = {
  AUS: [
    { name: "spring racing carnival", months: ["sep", "okt", "nov"], terms: ["race day", "races", "racing", "melbourne cup", "derby", "racewear", "fascinator"] },
    { name: "kerst", months: ["nov", "dec"], terms: ["christmas", "xmas", "holiday party"] },
    { name: "oud & nieuw", months: ["dec", "jan"], terms: ["new year", "nye"] },
    { name: "school formal", months: ["okt", "nov", "dec"], terms: ["school formal", "year 12 formal"] },
    { name: "zomervakantie", months: ["nov", "dec", "jan", "feb"], terms: ["beach", "holiday", "vacation", "resort", "cruise", "poolside"] },
    { name: "bruiloftseizoen", months: ["okt", "nov", "dec", "jan", "feb", "mrt"], terms: ["wedding guest", "bridesmaid"] },
  ],
  USA: [
    { name: "thanksgiving", months: ["nov"], terms: ["thanksgiving"] },
    { name: "kerst", months: ["nov", "dec"], terms: ["christmas", "xmas", "holiday party"] },
    { name: "oud & nieuw", months: ["dec", "jan"], terms: ["new year", "nye"] },
    { name: "zomervakantie", months: ["mei", "jun", "jul", "aug"], terms: ["beach", "vacation", "resort", "cruise", "poolside"] },
    { name: "derby", months: ["apr", "mei"], terms: ["derby", "races", "race day"] },
    { name: "bruiloftseizoen", months: ["mei", "jun", "jul", "aug", "sep", "okt"], terms: ["wedding guest", "bridesmaid"] },
  ],
  UK: [
    { name: "kerst", months: ["nov", "dec"], terms: ["christmas", "xmas", "holiday party", "party season"] },
    { name: "oud & nieuw", months: ["dec", "jan"], terms: ["new year", "nye"] },
    { name: "races", months: ["jun", "jul"], terms: ["races", "race day", "ascot", "racewear"] },
    { name: "zomervakantie", months: ["jun", "jul", "aug"], terms: ["beach", "holiday", "vacation", "cruise"] },
    { name: "bruiloftseizoen", months: ["mei", "jun", "jul", "aug", "sep"], terms: ["wedding guest", "bridesmaid"] },
  ],
  CAN: [
    { name: "kerst", months: ["nov", "dec"], terms: ["christmas", "xmas", "holiday party"] },
    { name: "oud & nieuw", months: ["dec", "jan"], terms: ["new year", "nye"] },
    { name: "zomervakantie", months: ["jun", "jul", "aug"], terms: ["beach", "vacation", "resort", "cruise"] },
    { name: "bruiloftseizoen", months: ["jun", "jul", "aug", "sep"], terms: ["wedding guest", "bridesmaid"] },
  ],
};

export function eventFactor(kw, market, windowMonths) {
  const cal = EVENTS[market];
  if (!cal) return 1;
  let matched = false;
  let inWindow = false;
  for (const ev of cal) {
    if (!ev.terms.some((t) => kw.includes(t))) continue;
    matched = true;
    if (ev.months.some((m) => windowMonths.includes(m))) inWindow = true;
  }
  if (!matched) return 1;
  return inWindow ? 1.25 : 0.55;
}

/* Store → markt, doelgroep en collecties die niet bij het merk passen.
   Hiermee doet het Store-veld eindelijk iets: het controleert of de gekozen
   markt klopt en houdt productsoorten buiten de deur die niet bij de
   positionering horen. */
export const STORE_PROFILES = {
  "juliaraven.com": { market: "AUS", genders: "MV" },
  "dunhill-lily.com": { market: "AUS", genders: "MV" },
  "ladyglamboutique.com": { market: "AUS", genders: "V", block: ["Maternity Dresses"] },
  "alessandramariano.com": { market: "CAN", genders: "V" },
  "emilyneill.com": { market: "CAN", genders: "MV" },
  "soulsocietyboutique.com": { market: "USA", genders: "V" },
  "clarajames.co.uk": { market: "UK", genders: "MV" },
};

export function storeProfile(url) {
  const h = String(url || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
  if (!h) return null;
  for (const [dom, p] of Object.entries(STORE_PROFILES)) {
    if (h === dom || h.endsWith(`.${dom}`)) return { domain: dom, ...p };
  }
  return null;
}

/* ---------------- extra rommel-filters bovenop de merkenlijst ---------------- */

const FOREIGN_NOISE = new Set([
  "leder", "damen", "herren", "robe", "robes", "chaqueta", "giacca", "jaqueta",
  "vestido", "abrigo", "manteau", "veste", "chemise", "jupe", "kleid", "schuhe",
  "zapatos", "chaussures", "abbigliamento", "vetements", "ropa",
]);

function hasRepeatedWord(kw) {
  const t = kw.split(/\s+/);
  for (let i = 0; i < t.length - 1; i++) if (t[i] === t[i + 1]) return true;
  return false;
}

function stripUk(kw) {
  return kw.replace(/\s+(uk|united kingdom)$/, "").trim();
}

/* ---------------- doelgroep-bewaking ----------------
   Alle stores in dit portfolio richten zich op volwassen shoppers. Keywords
   voor tiener-evenementen en kinderkleding horen er dus NOOIT in — los van
   het zoekvolume. "black homecoming dresses" (Amerikaans highschool-bal,
   14-18 jaar) kreeg producten puur omdat het volume klopte; de doelgroep
   klopte niet. Google leert bovendien je publiek uit je klikken — tiener-
   verkeer vervuilt de campagnedata van de hele store. */
const TEEN_EVENTS = [
  "homecoming", "hoco", "prom", "quinceanera", "quince", "sweet 16",
  "sweet sixteen", "back to school", "school dance", "school outfit",
  "school outfits", "first day of school",
];
const KID_WORDS = new Set([
  "kids", "kid", "toddler", "toddlers", "infant", "infants", "newborn",
  "children", "childrens", "child", "tween", "tweens", "teen", "teens",
  "teenager", "teenagers", "youth", "juniors",
]);
// "girls"/"boys" alleen blokkeren als het over kínderen gaat — "girls night
// out dress" en "girls trip outfits" zijn volwassen gelegenheden.
const GIRLS_OK_NEXT = new Set(["night", "trip", "weekend", "getaway"]);

function wrongAudience(kw) {
  const k = ` ${kw} `;
  for (const ev of TEEN_EVENTS) if (k.includes(` ${ev} `)) return true;
  const t = kw.split(/\s+/);
  for (let i = 0; i < t.length; i++) {
    if (KID_WORDS.has(t[i])) return true;
    if ((t[i] === "girls" || t[i] === "boys") && !GIRLS_OK_NEXT.has(t[i + 1] || "")) return true;
    if (t[i] === "for" && (t[i + 1] === "girls" || t[i + 1] === "boys")) return true;
  }
  return false;
}

/* ---------------- novelty & tegenstrijdigheden ----------------
   Twee foutklassen die door alle bestaande filters heen kwamen:

   1. NOVELTY — "christmas t shirts ladies", "funny sweatshirt", "ugly
      christmas jumper". Echte vraag, maar cadeau-artikelen met een print;
      geen enkele van deze boutiques verkoopt dat, en het trekt precies het
      verkeerde publiek de campagne in.
   2. TEGENSTRIJDIG — "formal sundress" (90.500 zoekopdrachten, rank 3 in de
      laatste run). Een sundress is per definitie informeel. Dit soort frasen
      ontstaat doordat Keyword Planner twee close variants aan elkaar plakt;
      een echte shopper typt het nooit. Herkenbaar aan twee eigenschappen die
      elkaar uitsluiten. */
const NOVELTY_WORDS = new Set(["funny", "novelty", "slogan", "meme", "ugly", "matching", "gag"]);
const FESTIVE_WORDS = new Set(["christmas", "xmas", "halloween", "easter", "valentines", "thanksgiving"]);
const PRINTABLE_RE = /\b(t ?shirts?|shirts?|tees?|sweatshirts?|jumpers?|sweaters?|hoodies?|pyjamas?|pajamas?|onesies?)\b/;

function isNovelty(kw) {
  const t = kw.split(/\s+/);
  if (t.some((w) => NOVELTY_WORDS.has(w))) return true;
  // feestdag + bedrukbaar kledingstuk = cadeau-artikel, geen mode-aankoop
  if (PRINTABLE_RE.test(kw) && t.some((w) => FESTIVE_WORDS.has(w))) return true;
  return false;
}

const CONTRADICTIONS = [
  [["formal", "cocktail", "evening", "gown", "gowns", "black tie", "ballgown"],
   ["sundress", "sundresses", "sun dress", "casual", "everyday", "lounge", "loungewear", "pyjama", "pajama", "beachwear"]],
  [["winter", "thermal", "fleece", "padded", "quilted", "puffer"],
   ["swimwear", "swimsuit", "bikini", "tankini", "beachwear"]],
  [["sleeveless", "strapless"], ["long sleeve"]],
  [["mini"], ["maxi"]],
  [["petite"], ["plus size"]],
];

function isContradictory(kw) {
  const k = ` ${kw} `;
  for (const [a, b] of CONTRADICTIONS) {
    const hasA = a.some((w) => k.includes(` ${w} `));
    const hasB = b.some((w) => k.includes(` ${w} `));
    if (hasA && hasB) return true;
  }
  return false;
}

/* Drie foutklassen uit de heren-testrun (17-8):
   1. PROMO-WOORDEN — "men winter jacket sale": het keyword is straks het
      titel-slot, dus "sale" belandt letterlijk in een producttitel.
   2. SPORT-FUNCTIE — wrestling/tennis/ski/snowboard-zoekers willen Nike,
      Salomon of Burton, geen naamloos dropship-item. Lage conversie, hoge
      retour, en het hoort niet in een fashion-boutique.
   3. MERK-ECHO — "polo jacket", "polo hoodie" (Ralph Lauren) en alles met
      "designer" erin: een designer-claim zonder merk is een GMC-risico.
      "polo shirt"/"polo neck" blijven staan — dat zijn generieke kledingtypes. */
const PROMO_RE = /\b(sale|sales|clearance|discount|discounted|outlet|coupon|promo|deals?)\b/;
const SPORT_PAIR_RE =
  /\b(wrestling|tennis|basketball|running|jogging|workout|gym|soccer|football|golf|ski|snowboard|cycling|climbing|walking|hunting|fishing|tactical|volleyball|baseball|softball|track)\b[\s\S]*\b(shoes?|boots?|sneakers?|trainers?|jackets?|pants?|shorts?|gear|cleats?|jerseys?|spikes?|hoodies?|sweatshirts?|shirts?|vests?|gloves?)\b/;
const SPORT_SOLO_RE = /\b(cleats?|activewear|sportswear)\b/;
const BRAND_ECHO_RE = /\bdesigner\b|\bpolo\s+(jackets?|hoodies?|coats?|sweatshirts?|tracksuits?|jeans)\b/;

export function isVerdelingJunk(kw) {
  if (hasRepeatedWord(kw)) return "dubbel-woord";
  if (kw.split(/\s+/).some((t) => FOREIGN_NOISE.has(t))) return "buitenlands";
  if (isJunkKeyword(kw)) return "merkenlijst";
  if (wrongAudience(kw)) return "doelgroep";
  if (isNovelty(kw)) return "novelty";
  if (isContradictory(kw)) return "tegenstrijdig";
  if (PROMO_RE.test(kw)) return "promo-woord";
  if (SPORT_PAIR_RE.test(kw) || SPORT_SOLO_RE.test(kw)) return "sport-functie";
  if (BRAND_ECHO_RE.test(kw)) return "merk-echo";
  return null;
}

/* ---------------- collectie-blauwdruk ---------------- */

/* "guys denim shorts" belandde in een women-only store omdat "guys" niet in
   deze regex stond. Herenwoorden zijn breder dan alleen "men". */
const MEN_RE = /\bmen'?s?\b|\bman\b|\bmale\b|\bgents?\b|\bguys?\b|\bblokes?\b|\bdudes?\b|\blads?\b/;

function has(kw, ...patterns) {
  for (const p of patterns) {
    if (new RegExp(`\\b${p}\\b`).test(kw)) return true;
  }
  return false;
}

/** Eén keyword → collectie uit de vaste blauwdruk (of null = past nergens). */
export function collectionFor(kw) {
  const men = MEN_RE.test(kw) && !/\bwomen/.test(kw);
  const g = men ? "M" : "V";

  // Schoenen eerst — specifieker dan kledingwoorden
  if (has(kw, "boots?", "wellies", "wellingtons?"))
    return { col: men ? "Men's Boots" : "Boots", g };
  if (has(kw, "sandals?", "sliders?", "flip flops?"))
    return { col: men ? null : "Sandals", g };
  if (has(kw, "loafers?", "flats", "ballet (flats|pumps)", "mary janes?", "moccasins?"))
    return { col: men ? null : "Flats & Loafers", g };
  if (
    has(kw, "trainers?", "sneakers?", "shoes?", "heels?", "pumps?", "stilettos?",
      "court shoes?", "brogues?", "oxfords?", "espadrilles?", "mules?", "clogs?",
      "platforms?", "slippers?")
  )
    return { col: men ? "Men's Shoes" : "Shoes", g };

  // Jurken — specifieke categorieën vóór de algemene
  // "wedding" + "guest" hoeven niet naast elkaar te staan: "dresses to wear to
  // a wedding as a guest" is dezelfde intentie als "wedding guest dress".
  if (
    has(kw, "wedding guest", "bridesmaids?", "bridal", "wedding attendee") ||
    (has(kw, "wedding") && has(kw, "guests?"))
  )
    return { col: men ? null : "Wedding Guest & Bridesmaid Dresses", g };
  if (has(kw, "graduation")) return { col: men ? null : "Graduation Dresses", g };
  if (has(kw, "maternity")) {
    if (has(kw, "dress(es)?")) return { col: men ? null : "Maternity Dresses", g };
    return { col: null, g };
  }
  /* Race day. In Australië is de spring racing carnival (okt-nov) het grootste
     modemoment van het jaar; "race day dress" belandde voorheen in Casual
     Dresses omdat er geen gelegenheidswoord in stond. Schoenen zijn hierboven
     al afgevangen, dus "derby shoes" raakt deze regel niet. */
  if (has(kw, "race day", "races", "racewear", "melbourne cup", "derby", "racing carnival"))
    return { col: men ? null : "Formal & Occasion Dresses", g };
  if (
    has(kw, "prom", "ball ?gowns?", "evening dress(es)?", "occasion dress(es)?",
      "formal dress(es)?", "cocktail dress(es)?", "party dress(es)?", "christmas party")
  )
    return { col: men ? null : "Formal & Occasion Dresses", g };
  if (has(kw, "dress(es)?", "gowns?", "sundress(es)?"))
    return { col: men ? null : "Casual Dresses", g };

  // Jassen
  if (
    has(kw, "coats?", "jackets?", "parkas?", "puffers?", "trench(es)?", "gilets?",
      "blazers?", "overcoats?", "raincoats?", "anoraks?", "windbreakers?", "bombers?",
      "capes?", "ponchos?")
  )
    return { col: men ? "Men's Jackets & Coats" : "Jackets & Coats", g };

  // Broeken
  if (has(kw, "jeans", "denim")) {
    if (!has(kw, "jackets?", "shirts?", "skirts?", "dress(es)?"))
      return { col: men ? "Men's Jeans" : "Jeans", g };
  }
  if (
    has(kw, "trousers?", "pants", "chinos?", "joggers?", "leggings?", "culottes?",
      "palazzo", "wide leg")
  )
    return { col: men ? "Men's Trousers" : "Trousers", g };
  if (has(kw, "shorts")) return { col: men ? "Men's Shorts" : "Shorts", g };
  if (has(kw, "skirts?", "skorts?")) return { col: men ? null : "Skirts", g };

  // Tops
  if (has(kw, "hoodies?", "sweatshirts?", "zip ups?"))
    return { col: men ? "Men's Hoodies" : "Hoodies", g };
  if (
    has(kw, "jumpers?", "sweaters?", "cardigans?", "knitwear", "knits?",
      "turtlenecks?", "roll necks?", "pullovers?")
  )
    return { col: men ? "Men's Sweaters" : "Sweaters", g };
  /* Herenshirts zijn een kerncategorie (flannel, overshirt, button-down,
     henley, oxford) — die verdienen hun eigen collectie. "Men's Blouses"
     was een omweg via de dames-mapping en is een dameswoord. */
  if (has(kw, "blouses?", "shirts?", "flannels?", "overshirts?", "henleys?", "button ?downs?", "oxfords?"))
    return { col: men ? "Men's Shirts" : "Blouses", g };
  if (
    has(kw, "tank tops?", "camis?", "camisoles?", "vest tops?", "crop tops?",
      "halter ?necks?", "bodysuits?", "corset tops?")
  )
    return { col: men ? null : "Tank Tops", g };
  if (has(kw, "tops?", "t ?shirts?", "tees?", "long sleeve"))
    return { col: men ? null : "Other Tops", g };
  if (has(kw, "swimsuits?", "bikinis?", "swimwear", "tankinis?"))
    return { col: men ? null : "Swimwear", g };

  return { col: null, g };
}

/* ---------------- keyword-type ----------------
   Bepaalt hoe de scraper en de importer met een keyword moeten omgaan:
   - "Direct"      → shops zetten dit letterlijk in hun producttitels
                     ("blazer"): gewoon zoeken, best-selling pakken.
   - "Attribuut"   → producttype + zichtbare eigenschap ("black midi dress").
   - "Gelegenheid" → een GEBRUIKSMOMENT, geen producttype
                     ("christmas party dress", "fall wedding guest outfit").
                     Geen enkele shop titelt zo; de scraper moet op fysieke
                     proxies zoeken en op foto verifiëren, en de importer moet
                     de titel natuurlijk maken i.p.v. de frase erin te forceren.
------------------------------------------------ */
const OCCASION_WORDS = new Set([
  "wedding", "bridal", "bridesmaid", "guest", "cocktail", "party", "prom",
  "homecoming", "graduation", "christmas", "xmas", "holiday", "halloween",
  "thanksgiving", "newyear", "nye", "birthday", "vacation", "resort", "cruise",
  "office", "business", "interview", "church", "brunch", "date",
  "night", "club", "festival", "concert", "funeral", "gala", "formal",
  "occasion", "event", "evening",
  // Race day is in AUS/NZ en UK een gebruiksmoment, geen producttype
  "races", "racewear", "racing", "derby", "carnival",
]);
const OUTFIT_WORDS = new Set(["outfit", "outfits", "look", "looks", "attire", "wear"]);

export function keywordType(kw) {
  const tokens = String(kw).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return "Direct";
  /* "work boots" en "work pants" zijn producttypes (workwear) — geen
     gelegenheid. "Work" telt alleen als gelegenheid in combinatie met een
     outfit-woord ("work dress", "work outfit"). */
  const k = ` ${tokens.join(" ")} `;
  if (k.includes(" work ") && /\b(dress|dresses|outfit|outfits|attire|blouse|heels|clothes|wear)\b/.test(k)) {
    return "Gelegenheid";
  }
  // "outfit"/"look" is nooit een producttype
  if (tokens.some((t) => OUTFIT_WORDS.has(t))) return "Gelegenheid";
  if (tokens.some((t) => OCCASION_WORDS.has(t))) return "Gelegenheid";
  // Kleur, materiaal of patroon in het keyword = de scraper moet dat op de
  // foto bewijzen — dus Attribuut, ook bij twee woorden ("black boots").
  // MAAR: het hoofd-producttype is nooit een attribuut van zichzelf —
  // "jeans" is gewoon Direct, ook al staat jean/denim in de materiaal-lijst.
  try {
    const last = tokens[tokens.length - 1];
    const lastStem = last.length > 3 && last.endsWith("s") ? last.slice(0, -1) : last;
    const attrs = hardAttributes(kw).filter(
      (a) => a !== last && a !== lastStem && a + "s" !== last
    );
    if (attrs.length) return "Attribuut";
  } catch {}
  if (tokens.length <= 2) return "Direct";
  return "Attribuut";
}

/* ---------------- canonieke dedupe ---------------- */

const FILLER = new Set([
  "women", "womens", "women's", "ladies", "lady", "for", "uk", "s", "the", "a", "female",
  // Generieke aanvul-woorden die de zoekintentie NIET veranderen — "cardigan
  // clothes" en "cardigans clothing" zijn gewoon "cardigan".
  "clothes", "clothing", "wear", "outfit", "outfits", "fashion", "style", "styles",
  "buy", "shop", "online", "cheap", "best", "sale",
  // Grammaticale vulwoorden uit lange Planner-frasen ("dresses to wear to a
  // wedding as a guest" → "dress guest wedding"). LET OP: "on" en "off" NIET
  // toevoegen — "on shoes" is een merk en "off the shoulder" een producttype.
  "to", "as", "in", "of", "at", "and", "or", "my", "your",
]);

// Aan elkaar geschreven varianten normaliseren vóór het stemmen, zodat
// "longsleeve dress" en "long sleeve dress" dezelfde canonieke vorm krijgen.
const COMPOUNDS = [
  ["longsleeve", "long sleeve"],
  ["shortsleeve", "short sleeve"],
  ["tshirt", "t shirt"],
  ["wideleg", "wide leg"],
  ["highwaist", "high waist"],
  ["kneehigh", "knee high"],
];

// Synoniemen die dezelfde zoekintentie zijn — Planner-artefacten als
// "bridal guest dress" / "wedding attendee dress" vallen zo samen met
// de natuurlijke term "wedding guest dress".
/* Woorden die exact dezelfde zoekvraag zijn. Zonder deze lijst kreeg je
   "jean shorts" én "denim shorts" allebei budget (16 producten op één
   zoekvraag), en hetzelfde bij "jean skirt" / "denim skirt". */
const SYNONYMS = {
  bridal: "wedding", attendee: "guest", jumper: "sweater",
  jean: "denim", jeans: "denim",
  trouser: "pant", trousers: "pant", pants: "pant",
  female: "women", womens: "women", womans: "women", ladies: "women", lady: "women",
  gents: "men", mens: "men", male: "men",
};

/* Woordenboek-lookup die ALLEEN eigen sleutels ziet. SYNONYMS is een gewoon
   object en erft dus "constructor" van Object.prototype: het keyword "baffin
   constructor boots" (97k-batch heren-USA, 21-8) gaf SYNONYMS["constructor"]
   = de Object-functie, en die heeft geen .replace → "e.replace is not a
   function" voor de héle verdeling. Elke lookup met een rauw zoekwoord als
   sleutel moet daarom via hasOwnProperty. */
const OWN = Object.prototype.hasOwnProperty;
function synonymOf(t) {
  return OWN.call(SYNONYMS, t) ? SYNONYMS[t] : null;
}

export function canonKey(kw) {
  let s = String(kw || "");
  for (const [glued, split] of COMPOUNDS) s = s.replace(new RegExp(glued, "g"), split);
  // Set: na synoniem-vertaling kunnen stammen dubbel worden ("denim jean
  // skirt" → denim denim skirt) en dan ontsnapte de rij aan de dedupe met
  // "denim skirt" — 14 producten op één zoekvraag.
  const stems = new Set();
  for (let t of s.split(/[^a-z0-9]+/)) {
    if (!t || FILLER.has(t)) continue;
    const syn = synonymOf(t);
    if (syn) t = syn;
    t = t.replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2));
    if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
    stems.add(t);
  }
  return [...stems].sort().join(" ");
}

/* ---------------- allocatie ---------------- */

function waterfill(pool, budget, P) {
  // Verdeel budget ∝ score^alpha met harde cap; wat boven de cap uitkomt
  // schuift door naar de rest. (score = seizoensscore × momentum-boost)
  const w = pool.map((r) => Math.pow(r.score, P.alpha));
  const alloc = new Array(pool.length).fill(0);
  const capped = new Array(pool.length).fill(false);
  for (let iter = 0; iter < 60; iter++) {
    const free = [];
    let cappedSum = 0;
    for (let i = 0; i < pool.length; i++) {
      if (capped[i]) cappedSum += alloc[i];
      else free.push(i);
    }
    const rem = budget - cappedSum;
    const sw = free.reduce((s, i) => s + w[i], 0);
    if (!free.length || sw <= 0) break;
    let changed = false;
    for (const i of free) alloc[i] = (rem * w[i]) / sw;
    for (const i of free) {
      if (alloc[i] > P.cap) {
        alloc[i] = P.cap;
        capped[i] = true;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return alloc;
}

function allocateKeywords(items, budget, P) {
  // Max spreiding binnen de collectie: zoveel mogelijk keywords meenemen
  // zolang de laagste nog >= vloer producten krijgt (binary search).
  const sorted = [...items].sort((a, b) => b.score - a.score);
  if (!sorted.length || budget < P.floor) return [];
  let lo = 1;
  let hi = Math.min(sorted.length, Math.floor(budget / P.floor));
  let best = null;
  while (lo <= hi) {
    const K = (lo + hi) >> 1;
    const pool = sorted.slice(0, K);
    const alloc = waterfill(pool, budget, P);
    if (Math.min(...alloc) >= P.floor - 0.5) {
      best = { pool, alloc };
      lo = K + 1;
    } else {
      hi = K - 1;
    }
  }
  if (!best) {
    const pool = sorted.slice(0, 1);
    best = { pool, alloc: waterfill(pool, budget, P) };
  }
  const out = best.pool.map((r, i) => ({
    ...r,
    n: Math.min(P.cap, Math.max(P.floor, Math.round(best.alloc[i]))),
  }));
  // ±1 bijstellen tot exact het budget (binnen vloer/cap)
  let diff = budget - out.reduce((s, x) => s + x.n, 0);
  for (let i = 0; diff !== 0 && out.length && i < 8000; i++) {
    const x = out[i % out.length];
    if (diff > 0 && x.n < P.cap) {
      x.n++;
      diff--;
    } else if (diff < 0 && x.n > P.floor) {
      x.n--;
      diff++;
    }
  }
  return out;
}

function allocateByCollection(items, budget, P, droppedCols, rules) {
  // Laag 1: budget over collecties ∝ vraag^alpha, met PLAFONDS en VLOEREN.
  //
  // Plafonds (rules.cap): de heren-testrun stopte 62% van de store in
  // jassen + schoenen + laarzen — zware, riskante categorieën (maatvoering,
  // retouren). Vraag^alpha alleen corrigeert dat nooit, want het zoekvolume
  // zit nu eenmaal daar. Vloeren (rules.floor): kern-seizoenscategorieën
  // (hoodies/sweaters/shirts in een herfst-wintervenster) krijgen een
  // minimum-aandeel zolang er keywords voor bestaan — 3,7% hoodies in Q4
  // Amerika was de grootste blunder van die run.
  const byCol = new Map();
  for (const r of items) {
    if (!byCol.has(r.col)) byCol.set(r.col, []);
    byCol.get(r.col).push(r);
  }
  let cols = [...byCol.keys()];
  const weightOf = (c) =>
    Math.pow(byCol.get(c).reduce((s, x) => s + x.score, 0), P.alpha);
  const capOf = (c) => {
    let f = P.colCapFrac;
    if (rules && rules.cap) {
      const o = rules.cap(c);
      if (o != null) f = Math.min(f, o);
    }
    return budget * f;
  };
  const floorOf = (c) => {
    if (!rules || !rules.floor) return 0;
    const o = rules.floor(c);
    if (o == null) return 0;
    const kws = (byCol.get(c) || []).length;
    if (kws < 2) return 0; // een vloer zonder keywords is niet af te dwingen
    // nooit meer eisen dan de keywords kunnen dragen
    return Math.min(budget * o, kws * P.cap);
  };

  // Waterfill over de vrije collecties, met vaste bedragen voor `fixed`.
  const distribute = (activeCols, totalBudget, fixed) => {
    const alloc = new Map(activeCols.map((c) => [c, 0]));
    for (const [c, amt] of fixed) alloc.set(c, amt);
    const capped = new Set(fixed.keys());
    for (let iter = 0; iter < 60; iter++) {
      const free = activeCols.filter((c) => !capped.has(c));
      const used = [...capped].reduce((s, c) => s + (alloc.get(c) || 0), 0);
      const rem = totalBudget - used;
      const sw = free.reduce((s, c) => s + weightOf(c), 0);
      if (!free.length || sw <= 0) break;
      let changed = false;
      for (const c of free) alloc.set(c, (rem * weightOf(c)) / sw);
      for (const c of free) {
        const cap = capOf(c);
        if (alloc.get(c) > cap) {
          alloc.set(c, cap);
          capped.add(c);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return alloc;
  };

  let alloc = new Map();
  for (let guard = 0; guard < cols.length + 5 && cols.length; guard++) {
    // Ronde 1: verdeel zonder vloeren
    const fixed = new Map();
    alloc = distribute(cols, budget, fixed);
    // Ronde 2 (max 3x): collecties onder hun vloer vastzetten op de vloer en
    // de rest opnieuw verdelen — het budget komt zo uit de zware toppers.
    for (let fr = 0; fr < 3; fr++) {
      let lifted = false;
      for (const c of cols) {
        const fl = floorOf(c);
        if (fl > 0 && !fixed.has(c) && (alloc.get(c) || 0) < fl - 0.5) {
          fixed.set(c, fl);
          lifted = true;
        }
      }
      if (!lifted) break;
      alloc = distribute(cols, budget, fixed);
    }

    // Te kleine collecties laten vallen (vloer-collecties zijn beschermd)
    const weak = cols.filter((c) => alloc.get(c) < P.minColBudget && floorOf(c) <= 0);
    if (!weak.length || cols.length <= 1) break;
    weak.sort((a, b) => weightOf(a) - weightOf(b));
    if (droppedCols) droppedCols.push(weak[0]);
    cols = cols.filter((c) => c !== weak[0]);
  }

  // Laag 2: binnen elke collectie over de keywords.
  const out = [];
  for (const c of cols) {
    out.push(...allocateKeywords(byCol.get(c), Math.round(alloc.get(c) || 0), P));
  }
  // Restbudget (afronding) naar de sterkste keywords die nog ruimte hebben.
  let diff = budget - out.reduce((s, x) => s + x.n, 0);
  out.sort((a, b) => b.score - a.score);
  for (let i = 0; diff > 0 && out.length && i < 5000; i++) {
    const x = out[i % out.length];
    if (x.n < P.cap) {
      x.n++;
      diff--;
    }
  }
  return out;
}


/* Collectie-consistentie. "maternity dress pants" belandde in de collectie
   Maternity Dresses omdat het woord "dress" erin staat — maar het hoofdwoord
   is PANTS, dus het is een broek. Zo ontstond een collectie met één keyword
   dat er niet eens in thuishoort. Elke collectie kent nu de producttypes die
   erin passen; klopt het hoofdwoord van het keyword daar niet mee, dan gaat
   het keyword naar de collectie die er wél bij hoort — of het valt af. */
const COL_TYPES = {
  Dresses: ["dress", "jumpsuit"],
  Boots: ["boots"],
  Jeans: ["jeans"],
  Skirts: ["skirt"],
  Shorts: ["shorts"],
  Hoodies: ["hoodie"],
  Sweaters: ["sweater", "cardigan"],
  Trousers: ["pants", "leggings"],
  Blouses: ["blouse", "shirt", "tshirt", "polo"],
  Shirts: ["shirt", "blouse", "tshirt", "polo"],
  "Tank Tops": ["top", "bodysuit", "bra"],
  "Other Tops": ["top", "tshirt", "shirt", "blouse", "polo", "bodysuit"],
  "Jackets & Coats": ["jacket", "coat", "blazer", "vest", "kimono"],
  "Flats & Loafers": ["flats", "loafers", "mules"],
  Shoes: ["heels", "sneakers", "sandals", "mules", "flats", "loafers"],
  Sandals: ["sandals", "mules"],
};

// typeId → de collectie waar het thuishoort (voor het omleiden)
const TYPE_HOME = {
  dress: "Casual Dresses", jumpsuit: "Casual Dresses", boots: "Boots",
  jeans: "Jeans", skirt: "Skirts", shorts: "Shorts", hoodie: "Hoodies",
  sweater: "Sweaters", cardigan: "Sweaters", pants: "Trousers",
  leggings: "Trousers", blouse: "Blouses", shirt: "Blouses", tshirt: "Other Tops",
  polo: "Other Tops", top: "Other Tops", bodysuit: "Tank Tops",
  jacket: "Jackets & Coats", coat: "Jackets & Coats", blazer: "Jackets & Coats",
  vest: "Jackets & Coats", kimono: "Jackets & Coats", heels: "Shoes",
  sneakers: "Shoes", sandals: "Shoes", mules: "Shoes", flats: "Flats & Loafers",
  loafers: "Flats & Loafers",
};

function allowedTypesFor(col) {
  if (COL_TYPES[col]) return COL_TYPES[col];
  // Namen als "Wedding Guest & Bridesmaid Dresses" of "Men's Jackets & Coats"
  for (const key of Object.keys(COL_TYPES)) {
    if (col.includes(key)) return COL_TYPES[key];
  }
  return null;
}

export function consistentCollection(kw, col) {
  if (!col) return col;
  const allowed = allowedTypesFor(col);
  if (!allowed) return col;
  let typeId = null;
  try {
    typeId = (analyzeKeyword(kw) || {}).typeId || null;
  } catch {}
  if (!typeId || allowed.includes(typeId)) return col;
  const home = TYPE_HOME[typeId];
  if (!home) return null; // past nergens → keyword valt af
  // Herenkeywords houden hun eigen "Men's ..."-variant — en shirts gaan
  // bij mannen naar Men's Shirts, nooit naar het dameswoord "Blouses".
  if (col.startsWith("Men's ")) {
    return `Men's ${home === "Blouses" ? "Shirts" : home}`;
  }
  return home;
}

// Blijft leven zolang de serverless-functie warm is: opeenvolgende
// herberekeningen binnen één verzoek kosten daardoor bijna niets.
const kwMemo = new Map();

export function buildVerdeling(rows, opts = {}) {
  const monthNames = opts.monthNames || [];
  const genders = opts.genders || "MV";
  const total = Math.max(1, Math.min(2000, Number(opts.total) || TOTAL_DEFAULT));
  const minSeason = Number(opts.minSeason) || 4000;
  const exclude = opts.exclude || new Set();
  const P = MODES[opts.mode === "focus" ? "focus" : "spread"];

  /* Markt-context. Zonder markt gedraagt de engine zich exact als voorheen
     (alle factoren 1), zodat oude runs reproduceerbaar blijven. */
  const market = MARKETS[opts.market] ? opts.market : null;
  const hemisphere = market ? MARKETS[market].hemisphere : null;
  const windowMonths = monthNames.map((m) => String(m).toLowerCase());
  const windowSeasons = market ? windowMonths.map((m) => seasonOf(m, hemisphere)).filter(Boolean) : [];
  const profile = storeProfile(opts.storeUrl);
  const blocked = new Set([...(opts.blockCollections || []), ...((profile && profile.block) || [])]);

  const stats = {
    input: rows.length, junk: 0, lowSeason: 0, unmapped: 0, genderSkip: 0,
    market: market || "geen", season: windowSeasons.join("-") || "n.v.t.",
    blockedCollection: 0, artefact: 0, colorCapped: 0,
  };

  /* Het zware werk per keyword — schoonmaken, junk-check, collectie bepalen,
     canonieke vorm — hangt alleen van het keyword zelf af, niet van het
     aantal producten of de uitsluitingen. De verdeling wordt na elke
     AI-ronde opnieuw berekend, dus zonder geheugen deden we dit werk zes
     keer over 108.000 rijen. Dat vrat het tijdsbudget op, waardoor juist de
     merkencontrole werd overgeslagen. Nu één keer rekenen, daarna opzoeken. */
  const memo = kwMemo;
  const kwFacts = (kw) => {
    let f = memo.get(kw);
    if (f) return f;
    if (isVerdelingJunk(kw)) {
      f = { junk: true };
    } else {
      let { col, g } = collectionFor(kw);
      col = consistentCollection(kw, col);
      f = { junk: false, col, g, canon: canonKey(kw) };
    }
    memo.set(kw, f);
    return f;
  };

  /* Uitsluitingen gelden voor de hele INTENT, niet alleen de formulering.
     De AI-controle sluit een keyword uit; zonder deze set nam de volgende
     herberekening gewoon een zustervariant uit dezelfde canon-groep
     ("little black dress" eruit → "a little black dress" erin). */
  const excludedCanons = new Set();
  for (const x of exclude) {
    try {
      const c = canonKey(String(x));
      if (c) excludedCanons.add(c);
    } catch {}
  }

  // 1-3: filteren, seizoensscore, collectie
  let mapped = [];
  const seenKw = new Set();
  for (const r of rows) {
    const kw = stripUk(String(r.kw || "").toLowerCase().trim());
    if (!kw || seenKw.has(kw)) continue;
    seenKw.add(kw);
    const facts = kwFacts(kw);
    if (exclude.has(kw) || facts.junk || (facts.canon && excludedCanons.has(facts.canon))) {
      stats.junk++;
      continue;
    }
    const months = (r.months || []).map((v) => Number(v) || 0);
    const season = months.reduce((s, v) => s + v, 0);
    if (season < minSeason) {
      stats.lowSeason++;
      continue;
    }
    const { col, g } = facts;
    if (!col) {
      stats.unmapped++;
      continue;
    }
    if (blocked.has(col)) {
      stats.blockedCollection++;
      continue;
    }
    if (genders !== "MV" && g !== genders) {
      stats.genderSkip++;
      continue;
    }
    let peak = 0;
    for (let i = 1; i < months.length; i++) if (months[i] > months[peak]) peak = i;
    // Momentum-onderzoek: een keyword dat piekt in de TWEEDE helft van het
    // gekozen venster is nog stijgend als de producten live gaan — dat
    // weegt 15% zwaarder in de allocatie (de getoonde volumes blijven ruw).
    const momentum = peak >= Math.floor(months.length / 2) ? 1.15 : 1;
    /* Sterfte-check: vergelijk het EINDE van het venster (laatste maand +
       de maand erna als die bekend is) met het BEGIN (eerste twee maanden).
       Stort de vraag in — homecoming dresses, jean shorts, maternity midi
       dress, kitten heel sandals — dan telt het keyword nog maar half mee.
       De vraag bestond wel, maar is al dood tegen de tijd dat de producten
       live staan en de campagnes lopen. */
    const nextVal = Number(r.next);
    const early = months[0] + (months[1] || 0);
    const lastM = months[months.length - 1];
    const late = Number.isFinite(nextVal) && r.next != null
      ? lastM + nextVal
      : (months[months.length - 2] || 0) + lastM;
    const dying = early > 0 && late < 0.45 * early;
    if (dying) stats.dying = (stats.dying || 0) + 1;

    const canon = facts.canon;
    const stemCount = canon ? canon.split(" ").length : 1;
    /* KOOPGEDRAG in plaats van kaal zoekvolume.

       Head/longtail: een kale head-term ("boots", "jeans") is grotendeels
       oriënterend verkeer en in Shopping onbetaalbaar voor een nieuwe store —
       stevigere demping dan voorheen (0,85 → 0,70). Twee- en drie-woords
       long-tails zijn koopklaar en krijgen de boost. Vier woorden en langer
       wordt weer te specifiek: te weinig vraag om producten op te zetten. */
    const tailFactor =
      stemCount <= 1 ? 0.7 : stemCount === 2 ? 1.12 : stemCount === 3 ? 1.08 : stemCount === 4 ? 0.95 : 0.8;
    /* Seizoen en agenda: is deze productsoort in dit halfrond aan de beurt,
       en valt het evenement achter het keyword binnen het venster. */
    const sFactor = market ? seasonFactor(col, windowSeasons) : 1;
    const eFactor = market ? eventFactor(kw, market, windowMonths) : 1;
    mapped.push({
      kw,
      col,
      g,
      avg: Number(r.avg) || 0,
      season,
      score: season * momentum * tailFactor * sFactor * eFactor * (dying ? 0.55 : 1),
      seasonFactor: sFactor,
      eventFactor: eFactor,
      peak: monthNames[peak] || `m${peak + 1}`,
      canon,
      earlyV: early,
      lateV: late,
      // Volume-vingerafdruk: Keyword Planner geeft "close variants" exact
      // hetzelfde gebundelde volume — identieke fingerprint binnen dezelfde
      // collectie = zelfde vraag, meermaals geteld.
      fp: `${Number(r.avg) || 0}|${months.join("|")}`,
    });
  }

  // Natuurlijkheids-steun: hoe vaak komt dit keyword als frase terug in
  // andere keywords? "wedding guest dress" zit in tientallen varianten,
  // een artefact als "bridal guest dress" in bijna geen — de term met de
  // meeste steun is de formulering die echte shoppers typen.
  // Dit was een dubbele lus over ~14.000 keywords (200 miljoen vergelijkingen)
  // en vrat in z'n eentje seconden per herberekening. Nu één keer een index
  // van alle woordgroepen; opzoeken is daarna gratis.
  const phraseCount = new Map();
  for (const m of mapped) {
    const w = m.kw.split(" ");
    const seen = new Set();
    for (let i = 0; i < w.length; i++) {
      for (let j = i + 1; j <= w.length; j++) {
        const g = w.slice(i, j).join(" ");
        if (seen.has(g)) continue;
        seen.add(g);
        phraseCount.set(g, (phraseCount.get(g) || 0) + 1);
      }
    }
  }
  const supportOf = (kw) => Math.max(0, (phraseCount.get(kw) || 0) - 1);

  /* ARTEFACT-ZEEF op steun. In een bron van tienduizenden keywords komt een
     ECHTE zoekvraag altijd óók terug als onderdeel van langere varianten:
     "wedding guest dress" zit in tientallen frasen. Een meerwoordsterm met
     fors volume die in geen enkele andere frase voorkomt, bestaat alleen in
     de Planner-export en niet in het hoofd van een shopper — "formal
     sundress" (90.500, rank 3) was daar het schoolvoorbeeld van.
     De zeef is bewust streng afgesteld — NUL steun en ≥10.000 zoekopdrachten.
     Eén enkele langere variant is al genoeg om als echt te tellen, want een
     term die niemand ooit uitbreidt maar wel tienduizenden keer "gezocht"
     wordt, bestaat niet. Kleine long-tails blijven altijd staan: daar is
     simpelweg minder omheen gezocht. */
  {
    const before = mapped.length;
    const removed = [];
    mapped = mapped.filter((m) => {
      const bad = m.kw.split(/\s+/).length >= 2 && m.avg >= 10000 && supportOf(m.kw) === 0;
      if (bad) removed.push(m.kw);
      return !bad;
    });
    stats.artefact = before - mapped.length;
    stats.artefactList = removed.slice(0, 25);
  }

  // 4: canonieke dedupe — de NATUURLIJKSTE formulering wint (meeste steun
  // in de dataset), bij gelijke steun de hoogste seizoensscore. Het volume
  // van de groep blijft dat van de sterkste variant (gebundeld volume).
  const best = new Map();
  for (const r of mapped) {
    const c = r.canon;
    const prev = best.get(c);
    if (!prev) {
      best.set(c, r);
      continue;
    }
    const sPrev = supportOf(prev.kw);
    const sNew = supportOf(r.kw);
    const winner =
      sNew > sPrev ? r : sNew < sPrev ? prev : r.season > prev.season ? r : prev;
    const loser = winner === r ? prev : r;
    // volume/score van de sterkste variant behouden op de winnende formulering
    if (loser.season > winner.season) {
      winner.season = loser.season;
      winner.score = loser.score;
      winner.avg = Math.max(winner.avg, loser.avg);
      winner.peak = loser.peak;
      winner.fp = loser.fp;
      winner.earlyV = loser.earlyV;
      winner.lateV = loser.lateV;
    }
    best.set(c, winner);
  }
  let unique = [...best.values()];
  stats.afterDedupe = unique.length;

  // 4a: subset-merge — IDENTIEKE volume-fingerprint (avg + alle 4 maanden) én
  // de ene term is qua stemmen een deelverzameling van de andere = door
  // Planner gegroepeerde vraag ("hoodie"/"comfort hoodie"; "wedding guest" /
  // "dresses to wear to a wedding as a guest"). Bewust CROSS-COLLECTIE
  // (alleen op geslacht gegroepeerd): dezelfde vraag kan door de blauwdruk in
  // twee verschillende collecties landen en ontsnapte zo aan de merge.
  // De kortste formulering wint; die houdt zijn eigen collectie.
  {
    // Beide takken hieronder eisen een gelijk gemiddelde, dus alleen keywords
    // met hetzelfde geslacht én hetzelfde avg hoeven vergeleken te worden.
    // Dat maakt van 38 miljoen vergelijkingen een paar duizend.
    const byG = new Map();
    for (const r of unique) {
      const k = `${r.g}|${r.avg}`;
      if (!byG.has(k)) byG.set(k, []);
      byG.get(k).push(r);
    }
    const drop = new Set();
    for (const rows2 of byG.values()) {
      for (let i = 0; i < rows2.length; i++) {
        for (let j = i + 1; j < rows2.length; j++) {
          const a = rows2[i];
          const b = rows2[j];
          // Cross-collectie: alleen bij een identieke volume-fingerprint
          // (avg + alle 4 maanden) — sterk bewijs van Planner-groepering.
          // Binnen dezelfde collectie is hetzelfde avg genoeg: "hoodie" en
          // "comfort hoodie" (beide 368k) zijn daar één zoekvraag.
          const sameCol = a.col === b.col;
          const fpMatch = a.fp === b.fp;
          const avgMatch = a.avg === b.avg;
          if (drop.has(a) || drop.has(b) || !a.avg) continue;
          if (!(fpMatch || (sameCol && avgMatch))) continue;
          const sa = new Set(a.canon.split(" "));
          const sb = new Set(b.canon.split(" "));
          const aInB = [...sa].every((t) => sb.has(t));
          const bInA = [...sb].every((t) => sa.has(t));
          if (aInB || bInA) {
            // de subset (kortere basis) blijft; hoogste seizoensscore mee
            const keep = aInB ? a : b;
            const gone = aInB ? b : a;
            if (gone.season > keep.season) {
              keep.season = gone.season;
              keep.score = gone.score;
              keep.peak = gone.peak;
              keep.earlyV = gone.earlyV;
              keep.lateV = gone.lateV;
            }
            drop.add(gone);
          }
        }
      }
    }
    if (drop.size) {
      unique = unique.filter((r) => !drop.has(r));
      stats.subsetMerged = drop.size;
    }
  }

  // 4b: close-variant-samenvouwing op volume-fingerprint. Keywords met
  // exact hetzelfde avg + dezelfde 4 maandvolumes binnen dezelfde collectie
  // zijn door Keyword Planner gegroepeerde varianten van één zoekvraag
  // ("trench coat" vs "trench jacket"). Zonder deze stap wordt die vraag
  // dubbel/driedubbel geteld én versnipperd over bijna-identieke keywords.
  // De schoonste formulering wint (minste woorden, dan kortste).
  const byFp = new Map();
  let variantMerged = 0;
  const cleaner = (a, b) => {
    const wa = a.kw.split(/\s+/).length;
    const wb = b.kw.split(/\s+/).length;
    if (wa !== wb) return wa < wb ? a : b;
    return a.kw.length <= b.kw.length ? a : b;
  };
  for (const r of unique) {
    const key = `${r.col}|${r.g}|${r.fp}`;
    const prev = byFp.get(key);
    if (!prev) {
      byFp.set(key, r);
    } else {
      byFp.set(key, cleaner(prev, r));
      variantMerged++;
    }
  }
  unique = [...byFp.values()];
  stats.variantMerged = variantMerged;
  stats.afterVariantMerge = unique.length;

  /* 4c: KLEUR-PLAFOND. "white dress", "red dress" en "black dress" kregen in de
     vorige run samen 23 producten bovenop "dresses" — terwijl het dezelfde
     jurken zijn met een filter eroverheen. Kleur is een eigenschap van de
     voorraad, geen aparte productbehoefte: één zwarte en één witte variant
     dekt de vraag, de rest is versnipperd budget. Per productsoort blijven
     alleen de sterkste kleur-keywords staan (2 bij spreiding, 1 bij focus). */
  {
    const COLOR_WORDS = new Set(
      `black white ivory cream gold golden silver red burgundy wine blue navy cobalt
       green olive emerald khaki brown tan camel cognac chocolate beige nude sand
       taupe grey gray charcoal pink blush rose fuchsia purple lilac lavender violet
       yellow mustard orange rust terracotta`
        .split(/\s+/)
        .filter(Boolean)
    );
    const groups = new Map();
    for (const r of unique) {
      const parts = r.canon.split(" ");
      if (!parts.some((s) => COLOR_WORDS.has(s))) continue;
      const base = parts.filter((s) => !COLOR_WORDS.has(s)).join(" ");
      if (!base) continue; // een kale kleur zonder producttype
      const key = `${r.col}|${r.g}|${base}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const drop = new Set();
    for (const arr of groups.values()) {
      if (arr.length <= P.colorCap) continue;
      arr.sort((a, b) => b.score - a.score);
      for (const r of arr.slice(P.colorCap)) drop.add(r);
    }
    if (drop.size) {
      unique = unique.filter((r) => !drop.has(r));
      stats.colorCapped = drop.size;
    }
  }

  // Sterfte op groepsniveau: instortend ÉN aan het eind vrijwel geen vraag
  // meer over → de hele groep overslaan. "maternity midi dress" had in
  // november nog 720 zoekopdrachten; daar richt je geen collectie voor in.
  const before = unique.length;
  unique = unique.filter((u) => !(u.earlyV > 0 && u.lateV < 0.45 * u.earlyV && u.lateV < 12000));
  stats.deadDropped = before - unique.length;

  /* 5: alloceren per groep — met marktbewuste plafonds en vloeren.
     Dit is waar "Markt" en "Maanden" eindelijk de VERHOUDINGEN sturen in
     plaats van alleen de scores. Zonder markt: geen regels, oud gedrag. */
  const coldShare = windowSeasons.length
    ? windowSeasons.filter((x) => x === "autumn" || x === "winter").length / windowSeasons.length
    : 0;
  const warmShare = windowSeasons.length
    ? windowSeasons.filter((x) => x === "spring" || x === "summer").length / windowSeasons.length
    : 0;
  const rules = market
    ? {
        /* Plafonds: zware/riskante categorieën mogen de store nooit meer
           domineren. Jassen zijn seizoensgevoelig kapitaal; schoenen en
           laarzen zijn de lastigste dropship-categorie die er is
           (maatvoering, retouren, merkverwachting). En een categorie die
           volledig buiten het venster valt is op z'n best een bijzaak —
           hard-zomerse soorten (shorts/swim/sandalen in een wintervenster)
           vrijwel nul. */
        cap: (col) => {
          let f = null;
          if (col.includes("Jackets & Coats")) f = 0.2;
          else if (col.endsWith("Shoes")) f = 0.13;
          else if (col.endsWith("Boots")) f = 0.13;
          const want = COL_SEASONS[col];
          if (want && windowSeasons.length && !windowSeasons.some((x) => want.includes(x))) {
            f = Math.min(f ?? 1, HARD_SUMMER.has(col) ? 0.015 : 0.05);
          }
          return f;
        },
        /* Vloeren: de kern van het seizoen moet vertegenwoordigd zijn.
           Herfst/winter-venster → hoodies, sweaters en shirts zijn waar
           de Q4-marge zit; zomer-venster → swim hoort een echte categorie
           te zijn. Alleen afgedwongen als er keywords voor bestaan. */
        floor: (col) => {
          if (coldShare >= 0.5) {
            if (col.endsWith("Hoodies")) return 0.09;
            if (col.endsWith("Sweaters")) return 0.09;
            if (col.endsWith("Shirts")) return 0.07;
          }
          if (warmShare >= 0.75 && col === "Swimwear") return 0.08;
          return null;
        },
      }
    : null;

  const droppedCols = [];
  let allRows = [];
  if (genders === "MV") {
    const wBudget = Math.round(total * W_SHARE);
    allRows = [
      ...allocateByCollection(unique.filter((r) => r.g === "V"), wBudget, P, droppedCols, rules),
      ...allocateByCollection(unique.filter((r) => r.g === "M"), total - wBudget, P, droppedCols, rules),
    ];
  } else {
    allRows = allocateByCollection(unique, total, P, droppedCols, rules);
  }
  allRows = allRows.filter((x) => x.n >= P.floor);
  allRows.sort((a, b) => b.season - a.season);

  /* Planner-omkeringen rechtzetten: "skirt maxi" → "maxi skirt",
     "pants baggy" → "baggy pants". Alleen bij twee woorden, en alleen als
     het laatste woord GEEN producttype is en het omgedraaide dat wél is —
     "dress pants" en "jean coat" blijven dus onaangeroerd. */
  for (const x of allRows) {
    let t = x.kw.split(/\s+/);
    /* Planner-omkeringen met het geslacht achteraan: "suede coat mens",
       "barn jacket mens", "shirt jacket men" — dat belandt één-op-één in
       klantgerichte producttitels. Het geslachtswoord hoort voorop:
       "mens suede coat". */
    const last = t[t.length - 1];
    if (t.length >= 2 && /^(mens?|womens?)$/i.test(last) && !/^(mens?|womens?)$/i.test(t[0])) {
      const g = /^men$/i.test(last) ? "mens" : /^women$/i.test(last) ? "womens" : last.toLowerCase();
      x.kw = [g, ...t.slice(0, -1)].join(" ");
      t = x.kw.split(/\s+/);
    }
    if (t.length !== 2) continue;
    try {
      const a = analyzeKeyword(x.kw);
      if (a && a.typeId) continue;
      const sw = `${t[1]} ${t[0]}`;
      const b = analyzeKeyword(sw);
      if (b && b.typeId) x.kw = sw;
    } catch {}
  }

  // Overzicht per collectie
  const colInfo = new Map();
  for (const x of allRows) {
    if (!colInfo.has(x.col)) colInfo.set(x.col, { col: x.col, kws: 0, products: 0, top: [] });
    const ci = colInfo.get(x.col);
    ci.kws++;
    ci.products += x.n;
    if (ci.top.length < 3) ci.top.push(x.kw);
  }
  const collections = [...colInfo.values()].sort((a, b) => b.products - a.products);

  return {
    rows: allRows.map((x, i) => ({ rank: i + 1, ...x })),
    collections,
    droppedCollections: [...new Set(droppedCols)],
    totalProducts: allRows.reduce((s, x) => s + x.n, 0),
    mode: opts.mode === "focus" ? "focus" : "spread",
    market,
    hemisphere,
    windowSeasons,
    storeProfile: profile,
    blockedCollections: [...blocked],
    stats,
  };
}
