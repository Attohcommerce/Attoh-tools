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
/* Heren-aandeel bij een man + vrouw-store (21-9-2026). Was hard 13% (dames
   0,87): de Shapes Wardrobe-run kreeg daardoor 58 van de ~450 producten voor
   heren, verspreid over 8 zwakke keywords. Nu een doel van 40% dat per store
   in STORE_PROFILES (menShare) te overschrijven is. Kan de herenkant dat
   niet dragen (te weinig keywords), dan schuift de rest naar dames en komt
   er een waarschuwing in het Diagnose-blok. */
export const MEN_SHARE_DEFAULT = 0.4;

/* Alle seizoensvloeren samen mogen nooit meer dan dit deel van het budget
   vastleggen — de rest verdeelt de vraag. Zie floorOf in allocateByCollection. */
const FLOOR_SHARE_MAX = 0.5;

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

/* VENSTER IN TIJDSVOLGORDE (21-9-2026). De UI stuurde de maanden in
   KALENDER-volgorde: okt-nov-dec-jan werd "jan-okt-nov-dec". Daardoor woog
   januari (de laatste, dus belangrijkste maand) het líchtst, was de "maand
   na het venster" januari zelf (in plaats van februari) en klopte de
   sterfte-check niet. Een venster dat over de jaargrens loopt begint na het grootste gat
   in de kalender. Gebruikt door de UI én door beide API-routes. */
export function orderWindow(months) {
  const idx = [...new Set((months || []).map((m) => MONTH_ORDER.indexOf(String(m).toLowerCase())))]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (idx.length <= 1) return idx.map((i) => MONTH_ORDER[i]);
  let gapAt = 0;
  let gap = -1;
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k];
    const b = idx[(k + 1) % idx.length];
    const d = (b - a + 12) % 12 || 12;
    if (d > gap) { gap = d; gapAt = (k + 1) % idx.length; }
  }
  return [...idx.slice(gapAt), ...idx.slice(0, gapAt)].map((i) => MONTH_ORDER[i]);
}

/* Automatisch venster: de 4 maanden vanaf VOLGENDE maand (producten staan
   pas live als de lopende maand grotendeels voorbij is). */
export function autoWindow(date = new Date()) {
  const m = date.getMonth() + 1;
  return [0, 1, 2, 3].map((i) => MONTH_ORDER[(m + i) % 12]);
}

export function seasonOf(monthKey, hemisphere) {
  const i = MONTH_ORDER.indexOf(String(monthKey || "").toLowerCase());
  if (i < 0) return null;
  const s = SEASON_N[i];
  return hemisphere === "S" ? FLIP[s] : s;
}

/* ============ SEIZOENSMODEL v5 (13-9-2026) ============================
   Oud model: per collectie een LIJSTJE seizoenen. Zat een seizoen uit het
   venster in dat lijstje, dan gold de categorie als "in seizoen" — ook al
   was dat maar één van de vier maanden. Daardoor kreeg een Australische
   okt-jan-run (lente,lente,zomer,zomer) 14% jassen: "Jackets & Coats" bevat
   "spring", dus het off-season-plafond van 5% sloeg nooit aan.

   Nieuw model: per collectie een CURVE met een gewicht 0..1 per seizoen, en
   daarbovenop een woordenboek op keyword-niveau. Een pufferjas en een
   regenjas zitten in dezelfde collectie maar verkopen totaal anders; alleen
   op collectieniveau rekenen is daarom te grof. Werkt identiek voor elke
   markt — het halfrond bepaalt welk seizoen een maand is, de curve doet de
   rest. ==================================================================== */

const COL_SEASON_CURVE = {
  // --- zomerkern ---
  Swimwear:            { summer: 1, spring: 0.45, autumn: 0.12, winter: 0.04 },
  "Men's Swimwear":    { summer: 1, spring: 0.45, autumn: 0.12, winter: 0.04 },
  Sandals:             { summer: 1, spring: 0.55, autumn: 0.15, winter: 0.05 },
  "Men's Sandals":     { summer: 1, spring: 0.55, autumn: 0.15, winter: 0.05 },
  Shorts:              { summer: 1, spring: 0.70, autumn: 0.25, winter: 0.08 },
  "Men's Shorts":      { summer: 1, spring: 0.70, autumn: 0.25, winter: 0.08 },
  "Tank Tops":         { summer: 1, spring: 0.65, autumn: 0.20, winter: 0.07 },
  Skirts:              { summer: 1, spring: 0.80, autumn: 0.45, winter: 0.25 },
  "Casual Dresses":    { summer: 1, spring: 0.85, autumn: 0.50, winter: 0.30 },
  "Jumpsuits & Playsuits": { summer: 1, spring: 0.85, autumn: 0.45, winter: 0.25 },
  "Co-ord Sets":       { summer: 1, spring: 0.85, autumn: 0.50, winter: 0.30 },
  // --- winterkern ---
  Boots:               { winter: 1, autumn: 0.85, spring: 0.30, summer: 0.08 },
  "Men's Boots":       { winter: 1, autumn: 0.85, spring: 0.30, summer: 0.08 },
  Sweaters:            { winter: 1, autumn: 0.85, spring: 0.30, summer: 0.06 },
  "Men's Sweaters":    { winter: 1, autumn: 0.85, spring: 0.30, summer: 0.06 },
  Hoodies:             { winter: 1, autumn: 0.90, spring: 0.50, summer: 0.15 },
  "Men's Hoodies":     { winter: 1, autumn: 0.90, spring: 0.50, summer: 0.15 },
  "Jackets & Coats":   { winter: 1, autumn: 0.90, spring: 0.40, summer: 0.10 },
  "Men's Jackets & Coats": { winter: 1, autumn: 0.90, spring: 0.40, summer: 0.10 },
  // alles wat hier niet in staat verkoopt het hele jaar (jeans, broeken,
  // shirts, schoenen, gelegenheidsjurken, tassen, hoeden). Die krijgen hun
  // seizoen sinds 21-9 AUTOMATISCH uit de maanddata van de bron-sheet —
  // zie dataSeasonScore hieronder.
};

/* Kern-seizoenscollecties: als hun seizoen er is, MOETEN ze stevig in de
   store staan (vloer tot 10%). Swimwear kreeg in een AUS okt-jan-run 0% —
   in de Australische zomer een van de grootste categorieën. */
const CORE_SEASON = new Set([
  "Swimwear", "Men's Swimwear", "Sandals", "Men's Sandals", "Shorts", "Men's Shorts",
  "Boots", "Men's Boots", "Sweaters", "Men's Sweaters", "Hoodies", "Men's Hoodies",
  "Jackets & Coats", "Men's Jackets & Coats",
]);

/* Woordenboek op KEYWORD-niveau. Specifieker dan de collectie: als een
   keyword hier matcht, wint deze curve. Zo verdwijnt "mens puffer jacket"
   uit een Australische decemberrun terwijl "mens rain coat" gewoon blijft. */
const ITEM_SEASON = [
  { name: "hard winter",
    re: /\b(puffer|down (jacket|coat)|quilted|padded|parka|sherpa|shearling|teddy|thermal|thermals|fleece[- ]lined|wool coat|overcoat|peacoat|pea coat|snow|ski|beanie|scarf|scarves|gloves|mittens|earmuffs|turtleneck|cable knit|chunky knit)\b/,
    curve: { winter: 1, autumn: 0.80, spring: 0.20, summer: 0.03 } },
  { name: "hard zomer",
    re: /\b(swim|swimming|swimsuits?|swimwear|swimmers|bikinis?|tankinis?|bathers|cossies?|togs|board ?shorts?|boardies|bathing|beach|linen|seersucker|sandals?|thongs?|flip ?flops?|slides?|espadrilles?|tank|singlets?|sleeveless|short sleeve|resort|poolside|sun ?dress|rash ?(guard|vest)|cover ?ups?|sarongs?|kaftans?|caftans?|sun ?hats?|straw|raffia|bucket hats?|playsuits?)\b/,
    curve: { summer: 1, spring: 0.70, autumn: 0.20, winter: 0.05 } },
  { name: "regen (bijna jaarrond)",
    re: /\b(rain|waterproof|water ?resistant|windbreaker|packable|anorak)\b/,
    // Regenkleding verkoopt het hele jaar; in een Australische zomer is het
    // stormseizoen. Wel iets zwaarder in herfst/winter.
    curve: { winter: 1, autumn: 1, spring: 0.85, summer: 0.70 } },
  { name: "trans-seasonal laag",
    re: /\b(bomber|blazer|overshirt|shacket|harrington|denim jacket|jean jacket|leather jacket|leather coat|biker|aviator|varsity|cardigan|gilet|bodywarmer)\b/,
    curve: { autumn: 1, winter: 0.85, spring: 0.80, summer: 0.35 } },
];

/* Het venster in tweeën was te grof: nu weegt elke maand apart, waarbij de
   LAATSTE maanden zwaarder tellen. Je koopt vandaag in voor wat er aankomt,
   niet voor wat afloopt. */
function monthWeights(n) {
  if (n <= 1) return [1];
  return Array.from({ length: n }, (_, i) => 0.8 + (0.4 * i) / (n - 1));
}

/* 0..1: hoe hard verkoopt dit keyword in dit venster op dit halfrond. */
export function seasonScore(col, windowSeasons, kw) {
  if (!windowSeasons || !windowSeasons.length) return 1;
  let curve = null;
  if (kw) {
    for (const it of ITEM_SEASON) {
      if (it.re.test(kw)) { curve = it.curve; break; }
    }
  }
  if (!curve) curve = COL_SEASON_CURVE[col] || null;
  if (!curve) return 1; // jaarrond
  const w = monthWeights(windowSeasons.length);
  let num = 0, den = 0;
  windowSeasons.forEach((s, i) => {
    num += w[i] * (curve[s] != null ? curve[s] : 1);
    den += w[i];
  });
  return den ? num / den : 1;
}

/* Onder deze score is het dode voorraad: het keyword valt helemaal af.
   Een pufferjas in een Australische zomer komt op ~0,10 uit. */
export const SEASON_DEAD = 0.12;

/* Scorefactor: 0,25 (dood) tot 1,30 (volle seizoenspiek) — zelfde
   bandbreedte als het oude model, maar nu vloeiend. */
export function seasonFactor(col, windowSeasons, kw) {
  return 0.25 + 1.05 * seasonScore(col, windowSeasons, kw);
}

/* Plafond uit het seizoen. Boven 0,60 knijpt het seizoen niet: dan bepaalt
   het gewone collectieplafond. Daaronder schaalt het hard mee, zodat een
   categorie die er niet toe doet nooit meer een kwart van de store vult. */
export function seasonCapFrac(score) {
  if (score >= 0.6) return null;
  /* 21-9: strakker. Met score × 0,22 mocht een categorie op 0,29 (laarzen in
     een Australische zomer) nog 6,4% van de store vullen. Nu loopt het
     plafond van ~1% (net boven dood) naar ~6% (bijna in seizoen). */
  return Math.max(0.01, (score - 0.12) * 0.12);
}

/* Vloer uit het seizoen: waar het seizoen om draait MOET vertegenwoordigd
   zijn. Alleen voor collecties met een curve — jaarrond-categorieën krijgen
   geen vloer, anders staat de hele store vol met vloeren. */
export function seasonFloorFrac(col, score, hasDataSignal = false) {
  if (!COL_SEASON_CURVE[col] && !hasDataSignal) return null;
  if (score < 0.72) return null;
  if (CORE_SEASON.has(col)) return Math.min(0.1, (score - 0.6) * 0.7);
  return Math.min(0.06, (score - 0.6) * 0.25);
}

/* AUTOMATISCHE SEIZOENSHERKENNING uit de data (21-9-2026).
   Keyword Planner levert 12 maandkolommen. Hoe groot is de vraag IN het
   venster ten opzichte van het jaargemiddelde? Index 1,0 = jaarrond,
   1,4+ = het seizoen komt eraan, 0,5 = voorbij. Hiermee herkent de engine
   ook het seizoen van soorten die niet in het woordenboek staan (tassen,
   hoeden, jumpsuits, nieuwe trends) en corrigeert hij het woordenboek als de
   markt anders koopt dan verwacht. Latere maanden wegen zwaarder, net als
   in seasonScore. */
export function seasonIndex(windowVals, yearVals) {
  if (!Array.isArray(yearVals) || yearVals.length < 6 || !Array.isArray(windowVals) || !windowVals.length) return null;
  const yAvg = yearVals.reduce((s, v) => s + (Number(v) || 0), 0) / yearVals.length;
  if (!(yAvg > 0)) return null;
  const w = monthWeights(windowVals.length);
  let num = 0, den = 0;
  windowVals.forEach((v, i) => { num += w[i] * (Number(v) || 0); den += w[i]; });
  return den ? num / den / yAvg : null;
}

/* Index → score 0..1 op dezelfde schaal als de curves. Jaarrond komt op
   0,70: geen plafond (< 0,60) en geen vloer (> 0,72).
   MARGE ±20% (21-9-2026, tweede ronde): Black Friday en kerst tillen in
   nov/dec vrijwel ALLE mode-zoekopdrachten 10-30% op. Zonder marge kreeg in
   een okt-jan-venster elke jaarrond-collectie (jeans, schoenen, gelegenheids-
   jurken) een seizoensvloer. Pas buiten 0,8-1,2 telt het als seizoen.
   Omhoog: 1,4 → 0,85 (in seizoen), 1,6+ → 1,0. Omlaag steiler: 0,5 → 0,40
   (plafond), 0,22 → 0,12 (dood) — hetzelfde sterftepunt als zonder marge. */
export function dataSeasonScore(idx) {
  if (idx == null || !Number.isFinite(idx)) return null;
  const d = idx > 1.2 ? (idx - 1.2) * 0.75 : idx < 0.8 ? (idx - 0.8) * 1.0 : 0;
  return Math.max(0.05, Math.min(1, 0.7 + d));
}

/* Woordenboek + data samen. Heeft het keyword/de collectie een curve, dan
   telt die 65% en de data 35% (de data corrigeert, het woordenboek houdt
   uitschieters tegen). Zonder curve beslist de data alleen. */
export function blendSeason(curveScore, hasCurve, dataScore) {
  if (dataScore == null) return curveScore;
  if (!hasCurve) return dataScore;
  return 0.65 * curveScore + 0.35 * dataScore;
}

function hasCurveFor(col, kw) {
  if (kw) for (const it of ITEM_SEASON) if (it.re.test(kw)) return true;
  return Boolean(COL_SEASON_CURVE[col]);
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
  /* Shapes Wardrobe — AUS+NZ, man én vrouw (geen plus size). Heren krijgen
     hier bewust een groter deel dan het standaarddoel. */
  "shapeswardrobe.com": {
    market: "AUS",
    genders: "MV",
    menShare: 0.45,
    audience: "everyday fashion for men and women in Australia and New Zealand; local wording (thongs, boardies, singlet, jumper, bathers) is correct here",
  },
  "lilyandluce.com": { market: "USA", genders: "MV" },
  /* Everman Clothing (EMC) — herenzaak voor AUS+NZ. Let op het verschil met
     everymanclothing.com hieronder: andere store, andere markt. Zonder dit
     profiel draaide de EMC-run zonder geslacht en kwam 83% van de producten
     in damescollecties terecht. */
  "evermanclothing.com": {
    market: "AUS",
    genders: "M",
    audience: "men's everyday fashion for Australia and New Zealand — casual and smart-casual staples; local wording (thongs, boardies, singlet, jumper) is correct here",
    footwearCap: 0.18,
  },
  /* EveryMan: herenzaak voor 55+. `audience` gaat mee naar de AI-eindcontrole
     (trend-/streetwear-items als baggy jeans of fur jackets passen niet);
     `footwearCap` houdt schoenen + laarzen SAMEN onder 18% — het is een
     kledingstore, en schoeisel is de lastigste dropship-categorie. */
  "everymanclothing.com": {
    market: "USA",
    genders: "M",
    audience: "men aged 55 and over — everyday, classic, comfortable menswear; NO youth trends, streetwear or fashion-forward pieces (baggy/wide-leg jeans, fur or shearling fashion jackets, cropped or oversized cuts, Y2K, techwear)",
    footwearCap: 0.18,
    // Deterministisch vangnet vóór de AI: trend-/jeugdwoorden die nooit bij
    // een 55+-herenzaak horen. "mens baggy jeans" kreeg in run 1 negen producten.
    blockWords: ["baggy", "oversized", "cropped", "crop", "y2k", "skinny", "ripped", "distressed", "fur", "streetwear", "techwear", "graphic"],
  },
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

/* Landnamen aan het begin of eind van een keyword zijn geen zoekvraag naar
   een ander product: "au dresses", "formal dresses aus" en "summer dresses
   au" kregen in de Shapes-run elk eigen budget naast "dresses". Weghalen,
   dan vallen ze in de dedupe samen met de gewone term. */
function stripUk(kw) {
  return kw
    .replace(/\s+(uk|united kingdom|au|aus|aussie|australia|australian|nz|new zealand)$/, "")
    .replace(/^(uk|au|aus|aussie|australia|australian|nz|new zealand)\s+/, "")
    .trim();
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
  // "matching set" is een co-ord set (echte mode-categorie), geen cadeau-shirt
  const t = kw.replace(/\bmatching (sets?|co ?ords?)\b/g, "set").split(/\s+/);
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
  if (NONSENSE_TYPE_RE.test(kw)) return "geen producttype";
  if (BRAND_FRAGMENT_RE.test(kw)) return "merkfragment";
  if (B2B_RE.test(kw)) return "zakelijk/bedrukking";
  if (PANTS_DRESS_RE.test(kw)) return "tegenstrijdig";
  return null;
}

/* Zakelijke inkoop en bedrukking: "sublimated polo shirts" (sportteams,
   bedrijfskleding) stond in de Shapes-run met 5 producten. Geen consument,
   geen fashion-aankoop. */
const B2B_RE =
  /\b(sublimated|sublimation|custom|customi[sz]ed|personali[sz]ed|wholesale|bulk|uniforms?|printing|blank|screen ?print(ed)?|logo)\b/;

/* "pants dress", "jeans dress": Planner plakt twee producttypes aan elkaar
   met een JURK als hoofdwoord. "dress pants" (andersom) is wél een echt
   artikel en blijft staan. */
const PANTS_DRESS_RE = /\b(pants|trousers|jeans|shorts|leggings)\s+dress(es)?$/;

/* Woordcombinaties die geen bestaand producttype zijn maar wél volume tonen —
   Planner plakt ze aan elkaar uit losse zoekwoorden. "boxer shoes" (7
   producten in de emc 2.0-run) en "gymnastic shorts" bestaan niet als artikel;
   je scrapet er dus willekeurige spullen bij. */
const NONSENSE_TYPE_RE =
  /\b(boxer|briefs?|underwear|sock)\s+(shoes?|boots?|sandals?)\b|\bgymnastics?\s+(shorts?|pants?|tops?)\b|\b(shoes?|boots?)\s+(shirt|pants?)\b/;

/* Merkfragmenten die de merkenlijst mist omdat het afkortingen of
   sublabels zijn: "rl polo shirts" (Ralph Lauren) en "&denim jeans"
   (H&M-sublabel) stonden allebei in de emc 2.0-run — samen 13 producten
   op merktermen, en dat is een GMC-merkrisico. */
const BRAND_FRAGMENT_RE =
  /(^|\s)&[a-z]|\b(rl|ck|ysl|lv|bnwt|nwt)\s|\b(rl|ck|ysl|lv)$/;

/* ---------------- collectie-blauwdruk ---------------- */

/* "guys denim shorts" belandde in een women-only store omdat "guys" niet in
   deze regex stond. Herenwoorden zijn breder dan alleen "men". */
const MEN_RE = /\bmen'?s?\b|\bman\b|\bmale\b|\bgents?\b|\bguys?\b|\bblokes?\b|\bdudes?\b|\blads?\b/;

/* Spiegelbeeld van MEN_RE. Nodig voor single-gender stores: in een
   heren-only run is "shoes" vanzelfsprekend een herenschoen, maar
   "ladies shoes" moet er juist uit. Zonder deze regex viel ALLES zonder
   het woord "mens" terug op de damescollecties — in de EMC-run van 13-9
   stond daardoor 83% van de producten in Blouses/Flats & Loafers/Shoes
   en scrapete de scraper vrouwenstukken. */
const WOMEN_RE =
  /\bwomen'?s?\b|\bwomans?\b|\bladies\b|\blady\b|\bfemales?\b|\bgirls?\b|\bmaternity\b|\bbridal\b|\bbridesmaids?\b/;

/* Geslachtswoorden voor de TITEL-opschoning onderin (niet voor de indeling):
   welke woorden achteraan mogen naar voren, en welke daarvan heren zijn. */
const GENDER_WORD_RE = /^(mens?|womens?|womans?|males?|females?|gents?|ladies|lady|guys?|blokes?|dudes?|lads?)$/i;
const MALE_WORD_RE = /^(mens?|males?|gents?|guys?|blokes?|dudes?|lads?)$/i;

const SHOE_TAIL_RE = /^(shoes?|boots?|sneakers?|trainers?|sandals?|heels?|loafers?|slides?|thongs?)$/i;

/* ---------- woordvolgorde van de Keyword Planner ----------

   De Planner levert regelmatig omgedraaide zinnen: "skirt maxi",
   "black shorts cargo", "loafers for men", "mens pants cargo". Die gingen
   ONGEWIJZIGD door de canon, de geslachtsbepaling en de collectie heen en
   werden pas bij het maken van de titel rechtgezet. Gevolg in de
   Shapes-run van 25-9: "black shorts cargo" matchte MALE_LEANING_RE niet
   (die kent alleen "cargo shorts") en werd dus een DAMESshort naast
   "black cargo shorts" — twee keer budget voor precies hetzelfde artikel.
   Daarom zetten we de volgorde nu recht VÓÓR alle analyse. */

function isTypePhrase(phrase) {
  try {
    const a = analyzeKeyword(phrase);
    return !!(a && a.typeId);
  } catch {
    return false;
  }
}

/** Planner-volgorde → natuurlijke volgorde. Idempotent. */
export function fixKeywordOrder(kw) {
  let s = String(kw || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (!s) return s;

  /* "linen pants clothes" → "linen pants". Alleen als er daarna nog een
     echt artikel overblijft: "womens clothing" mag geen "womens" worden. */
  const stripped = s.replace(/\s+(clothing|clothes|apparel)$/, "").trim();
  if (stripped && stripped !== s && stripped.includes(" ")) s = stripped;
  else if (stripped && stripped !== s && !GENDER_WORD_RE.test(stripped)) s = stripped;

  let t = s.split(" ");

  /* Geslachtswoord achteraan hoort voorop: "suede coat mens" → "mens suede
     coat", "loafers for men" → "mens loafers" (het voorzetsel gaat mee weg). */
  const last = t[t.length - 1];
  if (t.length >= 2 && GENDER_WORD_RE.test(last) && !GENDER_WORD_RE.test(t[0])) {
    const g = MALE_WORD_RE.test(last) ? "mens" : "womens";
    let head = t.slice(0, -1);
    if (head.length >= 2 && /^(for|voor)$/i.test(head[head.length - 1])) head = head.slice(0, -1);
    s = [g, ...head].join(" ");
    t = s.split(" ");
  }

  /* Hoofdwoord naar achteren. fashion.js herkent een producttype alleen als
     het ACHTERAAN staat, dus: staat het keyword niet als type in het
     woordenboek, verplaats dan één woord naar achteren en kijk of het dan
     wél een type is. Schoenwoorden achteraan blijven met rust — fashion.js
     kent "shoes" niet als type en draaide "dress shoes" anders om tot
     "shoes dress". */
  if (t.length >= 2 && t.length <= 4 && !SHOE_TAIL_RE.test(t[t.length - 1]) && !isTypePhrase(s)) {
    for (let i = 0; i < t.length - 1; i++) {
      if (GENDER_WORD_RE.test(t[i])) continue; // geslacht blijft voorop
      const cand = [...t.slice(0, i), ...t.slice(i + 1), t[i]].join(" ");
      if (isTypePhrase(cand)) {
        s = cand;
        break;
      }
    }
  }
  return s;
}

/* Eén plek waar "welk geslacht is dit keyword" wordt beslist — zodat stap 1,
   de underdog-route en elke vervolgstap exact hetzelfde antwoord geven.
   storeGenders: "M" (herenstore), "V" (dameszaak) of "MV" (unisex).
   Bij een single-gender store is het ONTBREKEN van een geslachtswoord geen
   reden om naar het andere geslacht te vallen: de store ís dat geslacht. */
/* Artikelen die zonder geslachtswoord in de praktijk HERENKLEDING zijn.
   In een man + vrouw-store viel alles zonder "mens" naar dames: "polo
   shirts", "cargo shorts", "chino shorts", "button up shirts" en "collared
   shirts" stonden in de Shapes-run als V/Blouses — de scraper haalde er dus
   damesblouses bij voor zoekopdrachten van mannen. Een jurk/rok/bikini-woord
   in hetzelfde keyword wint altijd ("polo dress" blijft dames). */
const MALE_LEANING_RE =
  /\b(cargo shorts?|chino shorts?|chinos?|board ?shorts?|boardies|swim ?shorts?|swim trunks?|trunks|polo shirts?|polos|polo tops?|polo tshirts?|polo t shirts?|henleys?|button (up|down) shirts?|collared shirts?|hawaiian shirts?|flannel shirts?|flannels|overshirts?|work shorts?|work pants|work shirts?|singlets?|rugby shirts?|fishing shirts?|boat shoes?|derby shoes?|brogues?|oxford shoes?|dress shoes?|bomber jackets?)\b/;
const FEMALE_ITEM_RE = /\bdress(es)?\b(?!\s+(shoes?|shirts?|pants|slacks|trousers|boots|socks))|\b(skirts?|skorts?|bikinis?|tankinis?|heels?|blouses?|bras?|leggings|crop|cropped|halter|corset|bodysuits?)\b/;

export function genderOf(kw, storeGenders) {
  const g = storeGenders === "M" || storeGenders === "V" ? storeGenders : "MV";
  const women = WOMEN_RE.test(kw);
  const men = MEN_RE.test(kw) && !women;
  if (g === "M") return women ? "V" : "M";
  if (g === "V") return men ? "M" : "V";
  if (men) return "M";
  if (!women && MALE_LEANING_RE.test(kw) && !FEMALE_ITEM_RE.test(kw)) return "M";
  return "V";
}

function has(kw, ...patterns) {
  for (const p of patterns) {
    if (new RegExp(`\\b${p}\\b`).test(kw)) return true;
  }
  return false;
}

/** Eén keyword → collectie uit de vaste blauwdruk (of null = past nergens). */
/* "dress" als BIJVOEGLIJK naamwoord: dress shirt, dress pants, dress shoes,
   dress socks — dat zijn geen jurken. Zonder deze uitzondering vielen "mens
   dress shirts" (223k/seizoen) en "mens dress pants" (132k) bij de eerste
   herenstore stilletjes weg omdat ze in de jurken-tak belandden (en een man
   krijgt daar null). */
const DRESS_ITEM_RE = /\bdress (shirts?|pants|slacks|trousers|socks|boots|shoes|loafers?|sneakers?|belts?|gloves?|watch(es)?)\b/;

export function collectionFor(kw, opts = {}) {
  /* storeGenders komt uit stap 1 en reist mee naar elke vervolgstap. In een
     heren-only store krijgt élk keyword zonder vrouw-woord g = "M" en dus de
     Men's-collectie: "shoes" en "men's shoes" landen in DEZELFDE collectie
     (Men's Shoes) in plaats van in Shoes + Men's Shoes naast elkaar. */
  const g = genderOf(kw, opts.storeGenders);
  const men = g === "M";
  const dressItem = DRESS_ITEM_RE.test(kw);

  /* Nachtkleding is geen mode-assortiment voor deze stores. "mens pj pants"
     belandde eerder in Men's Trousers. */
  if (has(kw, "pj", "pjs", "pyjamas?", "pajamas?", "nightwear", "sleepwear", "nighties?", "onesies?",
    "dressing gowns?", "housecoats?"))
    return { col: null, g };

  /* Zwemshorts zijn zwemkleding, geen shorts — anders verdwijnt de hele
     zomercategorie in Men's Shorts en krijgt hij nooit een eigen vloer. */
  if (has(kw, "swim shorts?", "swimming shorts?", "board ?shorts?", "boardies", "swim trunks?", "bathing suits?", "swim briefs?", "rash ?(guards?|vests?)", "rashies"))
    return { col: men ? "Men's Swimwear" : "Swimwear", g };
  /* Zwemkleding en strandlaag. Bikini/swimsuit/swimwear stonden wél in de
     blauwdruk, maar consistentCollection kende hun producttype niet en gooide
     ze er daarna alsnog uit: in de Shapes-run van 21-9 zat daardoor 0 swim
     in een Australische zomerstore. Australische en Kiwi-woorden
     (bathers, cossies, swimmers, togs) horen erbij. */
  if (has(kw, "bikinis?", "tankinis?", "swimsuits?", "swimwear", "swimmers", "bathers", "cossies?", "togs",
    "beach cover ?ups?", "swim cover ?ups?", "bikini cover ?ups?", "cover ?ups?", "sarongs?", "kaftans?", "caftans?"))
    return { col: men ? (has(kw, "kaftans?", "caftans?", "sarongs?", "cover ?ups?") ? null : "Men's Swimwear") : "Swimwear", g };

  /* Tassen en hoeden (21-9-2026). Er bestond geen enkele accessoire-
     collectie, dus "tote bag", "beach bag", "crossbody bag" en "bucket hat"
     vielen als "geen collectie" weg — terwijl strandtassen en zonnehoeden
     in de zomer meeverkopen en geen maatretouren kennen. "paperbag waist"
     en "cap sleeve" raken deze regels niet (woordgrens / alleen echte
     petten). */
  if (has(kw, "bags?", "handbags?", "totes?", "tote bags?", "purses?", "clutch(es)?", "crossbody", "shoulder bags?",
    "backpacks?", "duffle bags?", "weekender bags?", "messenger bags?", "satchels?", "wallets?"))
    return { col: men ? "Men's Bags" : "Bags", g };
  if (has(kw, "hats?", "sun ?hats?", "bucket hats?", "fedoras?", "visors?", "beanies?",
    "(baseball|trucker|dad|bucket|sun|straw|flat) caps?"))
    return { col: men ? "Men's Hats" : "Hats", g };

  // Schoenen eerst — specifieker dan kledingwoorden
  if (has(kw, "boots?", "wellies", "wellingtons?"))
    return { col: men ? "Men's Boots" : "Boots", g };
  /* Sandalen/slippers zijn in AUS/NZ een van de grootste zomercategorieën
     voor mannen ("thongs" is daar het normale woord). Die vielen eerder
     volledig weg omdat heren hier null kregen. */
  if (has(kw, "sandals?", "sliders?", "slides?", "flip ?flops?", "thongs?", "espadrilles?"))
    return { col: men ? "Men's Sandals" : "Sandals", g };
  // Heren-loafers/mocassins zijn gewoon herenschoenen (283k/seizoen in de
  // USA-herenbatch); "Flats & Loafers" is de damescollectie.
  if (has(kw, "loafers?", "flats", "ballet (flats|pumps)", "mary janes?", "moccasins?"))
    return { col: men ? "Men's Shoes" : "Flats & Loafers", g };
  // "oxford shirt" is een overhemd, geen schoen — vandaar de lookahead.
  if (
    has(kw, "trainers?", "sneakers?", "shoes?", "heels?", "pumps?", "stilettos?",
      "court shoes?", "brogues?", "oxfords?(?!\\s+shirts?)", "espadrilles?", "mules?", "clogs?",
      "platforms?", "slippers?")
  )
    return { col: men ? "Men's Shoes" : "Shoes", g };

  /* Jumpsuits/playsuits en co-ord sets zijn in de Australische zomer eigen
     categorieën. Ze vielen weg (geen collectie) of werden jurken. Sets gaan
     vóór rokken/broeken/shorts: "linen shorts set" is een set, geen short. */
  if (has(kw, "jumpsuits?", "playsuits?", "rompers?", "overalls?", "dungarees"))
    return { col: men ? null : "Jumpsuits & Playsuits", g };
  if (
    has(kw, "co ?ords?", "co ?ord sets?", "coord sets?", "two piece sets?", "2 piece sets?", "matching sets?",
      "(linen|knit|shorts|skirt|pants|lounge|summer|beach) sets?")
  )
    return { col: men ? null : "Co-ord Sets", g };
  // Singlet = Australisch voor tanktop/hemd
  if (has(kw, "singlets?")) return { col: men ? "Men's Shirts" : "Tank Tops", g };

  // Jurken — specifieke categorieën vóór de algemene
  // "wedding" + "guest" hoeven niet naast elkaar te staan: "dresses to wear to
  // a wedding as a guest" is dezelfde intentie als "wedding guest dress".
  if (!dressItem) {
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
      /* Een gown IS een gelegenheidsjurk — "formal gown", "evening gown",
         "gowns for women" stonden in Casual Dresses omdat alleen
         "ball gown" in deze lijst stond (Shapes-run 25-9). De badjas
         ("dressing gown") is hierboven al afgevangen. */
      has(kw, "prom", "gowns?", "evening dress(es)?", "occasion dress(es)?",
        "formal dress(es)?", "cocktail dress(es)?", "party dress(es)?", "christmas party")
    )
      return { col: men ? null : "Formal & Occasion Dresses", g };
    if (has(kw, "dress(es)?", "sundress(es)?"))
      return { col: men ? null : "Casual Dresses", g };
  }

  // Jassen (peacoat/topcoat/sportcoat/shacket zijn aan elkaar geschreven en
  // vielen buiten "coats?"/"jackets?")
  if (
    has(kw, "coats?", "jackets?", "parkas?", "puffers?", "trench(es)?", "gilets?",
      "blazers?", "overcoats?", "raincoats?", "anoraks?", "windbreakers?", "bombers?",
      "capes?", "ponchos?", "peacoats?", "topcoats?", "sportcoats?", "shackets?")
  )
    return { col: men ? "Men's Jackets & Coats" : "Jackets & Coats", g };
  /* Heren-"vest" = bodywarmer/gilet (US), dus outerwear — 241k/seizoen.
     Sweater vests zijn knitwear en dames-"vest tops" zijn hemdjes: die
     blijven hun eigen tak volgen. */
  if (men && has(kw, "vests?") && !has(kw, "sweater vests?", "knit vests?", "cardigan vests?", "vest tops?"))
    return { col: "Men's Jackets & Coats", g };

  // Broeken
  if (has(kw, "jeans", "denim")) {
    if (!has(kw, "jackets?", "shirts?", "skirts?", "dress(es)?"))
      return { col: men ? "Men's Jeans" : "Jeans", g };
  }
  if (
    has(kw, "trousers?", "pants", "chinos?", "joggers?", "leggings?", "culottes?",
      "palazzo", "wide leg", "khakis?", "slacks", "sweatpants?", "sweat pants", "corduroys")
  )
    return { col: men ? "Men's Trousers" : "Trousers", g };
  if (has(kw, "shorts")) return { col: men ? "Men's Shorts" : "Shorts", g };
  if (has(kw, "skirts?", "skorts?")) return { col: men ? null : "Skirts", g };

  // Tops
  if (has(kw, "hoodies?", "sweatshirts?", "zip ups?"))
    return { col: men ? "Men's Hoodies" : "Hoodies", g };
  // quarter/half zip en fleece (pullover) zijn knitwear-midlayers — de 55+
  // herenkern (375k/seizoen voor "mens quarter zip" alleen al).
  if (
    has(kw, "jumpers?", "sweaters?", "cardigans?", "knitwear", "knits?",
      "turtlenecks?", "roll necks?", "pullovers?", "quarter zips?", "half zips?", "zip necks?", "fleeces?")
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
  // Heren-tees/long sleeves horen bij de herenshirts (er is geen "Men's Other Tops")
  if (has(kw, "tops?", "t ?shirts?", "tees?", "long sleeve"))
    return { col: men ? "Men's Shirts" : "Other Tops", g };
  if (has(kw, "swimsuits?", "bikinis?", "swimwear", "tankinis?"))
    return { col: men ? "Men's Swimwear" : "Swimwear", g };

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

/* Algemene woorden die niets toevoegen zodra er al een SPECIFIEK artikel in
   het keyword staat. "henleys" en "henleys tops" zijn één zoekvraag (samen 11
   producten), net als "slider shoes" en "slides". Zonder deze regel kregen ze
   allebei budget. Let op: alleen schrappen als het specifieke woord er ÓÓK
   staat — "tops" en "shoes" op zichzelf blijven gewoon bestaan. */
const SPECIFIC_TOP = new Set([
  "henley", "polo", "hoodie", "blouse", "shirt", "tank", "singlet",
  "sweater", "cardigan", "jacket", "blazer", "bodysuit",
]);
const SPECIFIC_FOOT = new Set([
  "loafer", "sneaker", "trainer", "boot", "sandal", "slide", "thong",
  "mule", "oxford", "brogue", "derby", "moccasin", "espadrille", "clog",
]);

// Stammen die geen producttype-detail zijn (alleen voor de kop-term-telling;
// de canon zelf houdt ze, anders vallen heren en dames samen).
const NON_TYPE_STEMS = new Set([
  "men", "man", "male", "gent", "guy", "bloke", "dude", "lad", "unisex",
  "winter", "summer", "fall", "autumn", "spring", "casual",
]);

// Brits/Australisch jargon dat op een USA-store niet in een titel mag landen.
const UK_ONLY_RE =
  /\b(jumpers?|trainers|wellies|wellingtons?|dungarees|waistcoats?|cord trousers|cords|plimsolls|swimming costumes?|pinafores?|court shoes|bum bags?|braces)\b/;

// Aan elkaar geschreven varianten normaliseren vóór het stemmen, zodat
// "longsleeve dress" en "long sleeve dress" dezelfde canonieke vorm krijgen.
const COMPOUNDS = [
  ["boardshorts", "board shorts"],
  ["boardshort", "board shorts"],
  ["boardies", "board shorts"],
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
  /* "guys cargo shorts" en "mens cargo shorts" zijn één zoekvraag. Zonder
     deze regels kregen ze allebei budget: in de EMC-run van 13-9 ging ruim
     10% van de producten naar synoniemen van keywords die al gekocht waren. */
  man: "men", guy: "men", guys: "men", bloke: "men", blokes: "men",
  dude: "men", dudes: "men", lad: "men", lads: "men",
  // "rain jacket men" = "mens rain coat"; "tank tees" = "tank shirts"
  coat: "jacket", coats: "jacket", tee: "shirt", tees: "shirt",
  /* Zwemshorts heten overal anders en kregen daardoor vier keer budget:
     board shorts (10) + swim shorts (10, exact hetzelfde volume) +
     swim trunks (5) + mens board shorts (5) = 30 producten op één artikel. */
  board: "swim", boards: "swim", trunk: "short", trunks: "short",
  // "slider shoes" (13 producten) en "mens slides" (5) zijn hetzelfde item.
  slider: "slide", sliders: "slide",
  // Spelling: in AUS/UK is het "grey"; "gray jeans" en "grey jeans" = één vraag
  gray: "grey",
  // Australisch/Kiwi zwemwoord = swimsuit
  bathers: "swimsuit", swimmers: "swimsuit", cossie: "swimsuit", cossies: "swimsuit", togs: "swimsuit",
  playsuits: "playsuit", romper: "playsuit", rompers: "playsuit",
};

/* Sfeer-bijvoeglijke woorden die de zoekvraag niet veranderen zodra er al
   een concreet artikel + detail staat. "summer maxi dress", "casual maxi
   dress" en "maxi dress" kregen in de Shapes-run samen ~45 producten voor één
   productsoort. Alleen schrappen als er daarna nog ≥2 stammen over zijn:
   "summer dress" blijft dus gewoon bestaan. */
const SOFT_MODS = new Set(["summer", "casual", "everyday", "basic", "cute", "trendy", "stylish", "comfy", "comfortable", "nice", "pretty"]);

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

export function canonKey(kw, opts = {}) {
  /* In een single-gender store zegt het woord "mens" niets meer — het geldt
     voor de hele store. Laten we het staan, dan zijn "shoes" en "mens shoes"
     twee verschillende canons en pakken ze allebei budget voor precies
     hetzelfde product. Bij een unisex store MOET het blijven staan, anders
     vallen heren en dames samen. */
  const dropGender = opts.storeGenders === "M" || opts.storeGenders === "V";
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
    if (dropGender && (t === "men" || t === "women" || t === "unisex")) continue;
    t = t.replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2));
    if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
    stems.add(t);
  }
  // "long dress" = "maxi dress"
  if (stems.has("long") && stems.has("dress") && !stems.has("sleeve")) { stems.delete("long"); stems.add("maxi"); }
  if (stems.size >= 3) {
    const soft = [...stems].filter((t) => SOFT_MODS.has(t));
    if (soft.length && stems.size - soft.length >= 2) for (const t of soft) stems.delete(t);
  }
  /* Man + vrouw-store: een herenartikel zonder "mens" ("cargo shorts",
     "polo shirts") krijgt via genderOf al het geslacht M — dan moet het ook
     dezelfde canon hebben als "mens cargo shorts", anders krijgen ze allebei
     budget voor precies dezelfde zoekvraag. */
  if (!dropGender && !stems.has("men") && !stems.has("women") && genderOf(String(kw || ""), "MV") === "M") stems.add("men");
  if (stems.has("top")) for (const t of SPECIFIC_TOP) if (stems.has(t)) { stems.delete("top"); break; }
  /* Polo is zélf het producttype. "polo shirts", "polo tops", "polo tshirts"
     en "polo tees" zijn één zoekvraag — in de Shapes-run van 25-9 kregen ze
     alle vier apart budget voor hetzelfde artikel. */
  if (stems.has("polo")) { stems.delete("shirt"); stems.delete("t"); }
  if (stems.has("shoe")) for (const t of SPECIFIC_FOOT) if (stems.has(t)) { stems.delete("shoe"); break; }
  return [...stems].sort().join(" ");
}

/* ---------------- allocatie ---------------- */

/* Cap per keyword. Kale kop-termen ("mens shoes", "mens hoodies") krijgen een
   lagere cap: zo'n term is géén producttype voor de scraper — 19 producten op
   "mens shoes" betekent 19 willekeurige schoenen zonder zoekvraag erachter.
   Het budget hoort bij de specifieke varianten (dress shoes, loafers, slip on). */
function kwCapOf(r, P) {
  return r && r.head ? P.headCap : P.cap;
}

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
      const cap = kwCapOf(pool[i], P);
      if (alloc[i] > cap) {
        alloc[i] = cap;
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
    n: Math.min(kwCapOf(r, P), Math.max(P.floor, Math.round(best.alloc[i]))),
  }));
  // ±1 bijstellen tot exact het budget (binnen vloer/cap)
  let diff = budget - out.reduce((s, x) => s + x.n, 0);
  for (let i = 0; diff !== 0 && out.length && i < 8000; i++) {
    const x = out[i % out.length];
    if (diff > 0 && x.n < kwCapOf(x, P)) {
      x.n++;
      diff--;
    } else if (diff < 0 && x.n > P.floor) {
      x.n--;
      diff++;
    }
  }
  return out;
}

function allocateByCollection(items, budget, P0, droppedCols, rules) {
  /* Kleine pool: kunnen alle keywords samen het budget niet dragen (elk op
     zijn cap), dan gaat de cap evenredig omhoog — beter een paar producten
     meer per keyword dan een store die niet vol komt. */
  let P = P0;
  const rawCapacity = items.reduce((s, r) => s + kwCapOf(r, P0), 0);
  if (rawCapacity > 0 && rawCapacity < budget) {
    const up = budget / rawCapacity;
    P = { ...P0, cap: Math.ceil(P0.cap * up) + 1, headCap: Math.max(P0.floor, Math.ceil(P0.headCap * up) + 1) };
  }
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
  // Capaciteit: meer dan (keywords × cap) kan een collectie nooit dragen.
  // Sinds de cap meeschaalt met de storegrootte zou het budget anders in
  // een collectie blijven hangen die het niet kwijt kan (focus-modus bleef
  // op 204 van 300 steken).
  const capacityOf = (c) => (byCol.get(c) || []).reduce((s, r) => s + kwCapOf(r, P), 0);
  const capOf = (c) => {
    let f = P.colCapFrac;
    if (rules && rules.cap) {
      const o = rules.cap(c);
      if (o != null) f = Math.min(f, o);
    }
    return Math.min(budget * f, capacityOf(c));
  };
  const floorRaw = (c) => {
    if (!rules || !rules.floor) return 0;
    const o = rules.floor(c);
    if (o == null) return 0;
    const kws = (byCol.get(c) || []).length;
    if (kws < 2) return 0; // een vloer zonder keywords is niet af te dwingen
    // nooit meer eisen dan de keywords kunnen dragen, en nooit boven het
    // eigen plafond (hoeden: plafond 4%, seizoensvloer 6% → 4%)
    return Math.min(budget * o, kws * P.cap, capOf(c));
  };
  /* VLOEREN SAMEN MAX 50% (21-9-2026, tweede ronde). Met de data-
     seizoensherkenning kreeg in een zomervenster bijna elke collectie een
     vloer. Opgeteld was dat méér dan het budget: de Shapes-test (AUS okt-jan)
     gaf 473 producten bij 450 gevraagd, en jurken kregen evenveel als hoeden
     omdat alles op zijn vloer vastgezet werd. Kern-seizoenscollecties (swim,
     sandalen, shorts, laarzen …) houden voorrang; de overige vloeren schalen
     mee terug tot het samen past. */
  let floorScale = { core: 1, other: 1 };
  const setFloorScale = (activeCols) => {
    let core = 0;
    let other = 0;
    for (const c of activeCols) {
      const f = floorRaw(c);
      if (CORE_SEASON.has(c)) core += f;
      else other += f;
    }
    const room = budget * FLOOR_SHARE_MAX;
    if (core + other <= room) floorScale = { core: 1, other: 1 };
    else if (core >= room) floorScale = { core: room / core, other: 0 };
    else floorScale = { core: 1, other: (room - core) / other };
  };
  const floorOf = (c) => floorRaw(c) * (CORE_SEASON.has(c) ? floorScale.core : floorScale.other);

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
    setFloorScale(cols);
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
    /* Groepsplafond (rules.groupCaps): collecties die SAMEN niet boven een
       aandeel mogen komen — schoenen + laarzen bij een kledingstore. Per
       collectie stond elk al op 13%, samen werd dat 26%: een kwart van een
       kledingstore in de categorie met de meeste maat-retouren. De groep
       wordt evenredig teruggeschaald en vastgezet; de rest vloeit naar de
       vrije collecties. */
    for (const gc of (rules && rules.groupCaps) || []) {
      const members = cols.filter((c) => gc.test(c) && !fixed.has(c));
      const sum = members.reduce((s, c) => s + (alloc.get(c) || 0), 0);
      const limit = budget * gc.frac;
      if (members.length && sum > limit + 0.5) {
        const scale = limit / sum;
        for (const c of members) fixed.set(c, (alloc.get(c) || 0) * scale);
        alloc = distribute(cols, budget, fixed);
      }
    }

    // Te kleine collecties laten vallen (vloer-collecties zijn beschermd)
    const weak = cols.filter((c) => alloc.get(c) < P.minColBudget && floorOf(c) <= 0);
    if (!weak.length || cols.length <= 1) break;
    weak.sort((a, b) => weightOf(a) - weightOf(b));
    if (droppedCols) droppedCols.push(weak[0]);
    cols = cols.filter((c) => c !== weak[0]);
  }

  // Na het wegvallen van zwakke collecties nogmaals de capaciteitscheck:
  // de overgebleven keywords moeten het budget samen kunnen dragen.
  const capLeft = cols.reduce((s, c) => s + capacityOf(c), 0);
  if (capLeft > 0 && capLeft < budget) {
    const up = budget / capLeft;
    P = { ...P, cap: Math.ceil(P.cap * up) + 1, headCap: Math.max(P.floor, Math.ceil(P.headCap * up) + 1) };
    alloc = distribute(cols, budget, new Map());
  }

  // Laag 2: binnen elke collectie over de keywords.
  const out = [];
  for (const c of cols) {
    out.push(...allocateKeywords(byCol.get(c), Math.round(alloc.get(c) || 0), P));
  }
  // Restbudget (afronding) naar de sterkste keywords die nog ruimte hebben.
  let diff = budget - out.reduce((s, x) => s + x.n, 0);
  out.sort((a, b) => b.score - a.score);
  /* Eerst alleen naar collecties die hun plafond nog niet halen; pas als dat
     niet meer kan, mag de rest overal heen (anders klopt het totaal niet). */
  const colTot = new Map();
  for (const x of out) colTot.set(x.col, (colTot.get(x.col) || 0) + x.n);
  for (let pass = 0; pass < 2 && diff > 0; pass++) {
    for (let i = 0; diff > 0 && out.length && i < 5000; i++) {
      const x = out[i % out.length];
      if (x.n >= kwCapOf(x, P)) continue;
      if (pass === 0 && (colTot.get(x.col) || 0) >= Math.ceil(capOf(x.col))) continue;
      x.n++;
      colTot.set(x.col, (colTot.get(x.col) || 0) + 1);
      diff--;
    }
  }
  /* Te VEEL (vloeren + het minimum per keyword samen boven het budget):
     terug naar exact het gevraagde aantal. Eerst de zwakste keywords tot hun
     minimum, daarna vallen de zwakste keywords helemaal weg. */
  for (let i = out.length - 1; diff < 0 && i >= 0; i--) {
    const x = out[i];
    const d = Math.min(x.n - P.floor, -diff);
    if (d > 0) {
      x.n -= d;
      diff += d;
    }
  }
  while (diff < 0 && out.length > 1) {
    const x = out.pop();
    diff += x.n;
  }
  for (let i = 0; diff > 0 && out.length && i < 5000; i++) {
    const x = out[i % out.length];
    if (x.n < kwCapOf(x, P)) {
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
  Sweaters: ["sweater", "cardigan", "vest"], // sweater vest = knitwear
  Trousers: ["pants", "leggings"],
  Blouses: ["blouse", "shirt", "tshirt", "polo"],
  Shirts: ["shirt", "blouse", "tshirt", "polo"],
  "Tank Tops": ["top", "bodysuit", "bra"],
  "Other Tops": ["top", "tshirt", "shirt", "blouse", "polo", "bodysuit"],
  "Jackets & Coats": ["jacket", "coat", "blazer", "vest", "kimono"],
  "Flats & Loafers": ["flats", "loafers", "mules"],
  Shoes: ["heels", "sneakers", "sandals", "mules", "flats", "loafers"],
  Sandals: ["sandals", "mules"],
  "Men's Sandals": ["sandals", "mules"],
  /* bikini/swimsuit ontbraken hier: élk bikini-keyword werd daardoor als
     "past nergens" weggegooid (0 swim in de Shapes-run van 21-9). Een
     bikini TOP of een kaftan (typeId kimono) hoort ook gewoon bij swim. */
  Swimwear: ["swimwear", "swimsuit", "bikini", "shorts", "top", "vest", "kimono", "set", "dress"],
  "Men's Swimwear": ["swimwear", "swimsuit", "shorts", "vest", "top"],
  Bags: ["bag"],
  Hats: ["hat"],
  "Jumpsuits & Playsuits": ["jumpsuit", "pants", "shorts"],
  "Co-ord Sets": ["set", "shorts", "pants", "skirt", "top", "blouse", "shirt", "tshirt"],
};

// typeId → de collectie waar het thuishoort (voor het omleiden)
const TYPE_HOME = {
  dress: "Casual Dresses", jumpsuit: "Jumpsuits & Playsuits", boots: "Boots",
  jeans: "Jeans", skirt: "Skirts", shorts: "Shorts", hoodie: "Hoodies",
  sweater: "Sweaters", cardigan: "Sweaters", pants: "Trousers",
  leggings: "Trousers", blouse: "Blouses", shirt: "Blouses", tshirt: "Other Tops",
  polo: "Other Tops", top: "Other Tops", bodysuit: "Tank Tops",
  jacket: "Jackets & Coats", coat: "Jackets & Coats", blazer: "Jackets & Coats",
  vest: "Jackets & Coats", kimono: "Jackets & Coats", heels: "Shoes",
  sneakers: "Shoes", sandals: "Sandals", mules: "Shoes", flats: "Flats & Loafers",
  loafers: "Flats & Loafers", swimwear: "Swimwear", swimsuit: "Swimwear",
  bikini: "Swimwear", bag: "Bags", hat: "Hats", set: "Co-ord Sets",
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
  // Dames-only collecties hebben geen heren-variant: tops → Men's Shirts,
  // flats/sandalen → Men's Shoes, jurken → valt af (geen "Men's Casual Dresses").
  if (col.startsWith("Men's ")) {
    if (MEN_NO_HOME.has(home)) return null;
    return `Men's ${MEN_HOME[home] || home}`;
  }
  return home;
}

const MEN_HOME = {
  Blouses: "Shirts", "Other Tops": "Shirts", "Tank Tops": "Shirts",
  "Flats & Loafers": "Shoes",
  // Sandals en Swimwear hebben sinds 13-9 WEL een herenvariant
};
const MEN_NO_HOME = new Set(["Casual Dresses", "Skirts", "Jumpsuits & Playsuits", "Co-ord Sets"]);

// Blijft leven zolang de serverless-functie warm is: opeenvolgende
// herberekeningen binnen één verzoek kosten daardoor bijna niets.
const kwMemo = new Map();

export function buildVerdeling(rows, opts = {}) {
  const monthNames = opts.monthNames || [];
  const genders = opts.genders === "M" || opts.genders === "V" ? opts.genders : "MV";
  /* Het storegeslacht is vanaf hier ÉÉN waarde die door alles heen reist:
     collectie-keuze, canonieke dedupe, de Groep-kolom in de sheet en daarmee
     de scraper en de importer. */
  const singleGender = genders !== "MV";
  const total = Math.max(1, Math.min(2000, Number(opts.total) || TOTAL_DEFAULT));
  const minSeason = Number(opts.minSeason) || 4000;
  const exclude = opts.exclude || new Set();
  /* Cap per keyword schaalt mee met de storegrootte. 28 hoorde bij
     1000-productenstores; sinds het besluit "max 300 per store" (18-8) zou
     één keyword anders 9% van de hele store kunnen opslokken. 300 → 12,
     600 → 24, 1000 → 28. Kop-termen (alleen een producttype, geen detail)
     krijgen 60% daarvan — zie kwCapOf. */
  const base = MODES[opts.mode === "focus" ? "focus" : "spread"];
  const scaledCap = Math.max(10, Math.min(base.cap, Math.round(total / 25)));
  // headCap nooit onder de vloer (focus-vloer 8), anders kan een kop-term
  // de vloer niet halen en sloopt hij de hele binaire zoektocht.
  const P = { ...base, cap: scaledCap, headCap: Math.max(base.floor, 6, Math.round(scaledCap * 0.6)) };
  /* opts.liftCaps (bijvul-tool): de mediabuyer vraagt bewust om één
     productsoort ("40% loafers"). Dan gelden de winkelbrede plafonds niet —
     een collectie mag het hele deelbudget dragen, en het collectie-plafond
     op schoenen/laarzen/jassen wordt in dat deel losgelaten. */
  if (opts.liftCaps) P.colCapFrac = 1;

  /* Markt-context. Zonder markt gedraagt de engine zich exact als voorheen
     (alle factoren 1), zodat oude runs reproduceerbaar blijven. */
  const profile = storeProfile(opts.storeUrl);
  /* Markt automatisch uit het store-profiel als hij niet is meegegeven —
     een bekende store draait zo nooit meer zonder halfrond. */
  const market = MARKETS[opts.market] ? opts.market : profile && MARKETS[profile.market] ? profile.market : null;
  const hemisphere = market ? MARKETS[market].hemisphere : null;
  const windowMonths = monthNames.map((m) => String(m).toLowerCase());
  const windowSeasons = market ? windowMonths.map((m) => seasonOf(m, hemisphere)).filter(Boolean) : [];
  const blocked = new Set([...(opts.blockCollections || []), ...((profile && profile.block) || [])]);
  // Doelgroep-woorden uit het store-profiel (zie STORE_PROFILES.blockWords)
  const blockWordRe =
    profile && profile.blockWords && profile.blockWords.length
      ? new RegExp(`\\b(${profile.blockWords.join("|")})\\b`)
      : null;

  const stats = {
    input: rows.length, junk: 0, lowSeason: 0, unmapped: 0, genderSkip: 0, offSeason: 0,
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
  /* De memo leeft zolang de serverless-functie warm is en wordt dus gedeeld
     tussen runs van VERSCHILLENDE stores. Zonder het geslacht in de sleutel
     kreeg een dameszaak de collecties van de herenrun ervoor terug. */
  const mkey = (kw) => `${genders}|${kw}`;
  const kwFacts = (kw) => {
    const k = mkey(kw);
    let f = memo.get(k);
    if (f) return f;
    if (isVerdelingJunk(kw)) {
      f = { junk: true };
    } else {
      let { col, g } = collectionFor(kw, { storeGenders: genders });
      col = consistentCollection(kw, col);
      f = { junk: false, col, g, canon: canonKey(kw, { storeGenders: genders }) };
    }
    memo.set(k, f);
    return f;
  };

  /* Uitsluitingen gelden voor de hele INTENT, niet alleen de formulering.
     De AI-controle sluit een keyword uit; zonder deze set nam de volgende
     herberekening gewoon een zustervariant uit dezelfde canon-groep
     ("little black dress" eruit → "a little black dress" erin). */
  const excludedCanons = new Set();
  for (const x of exclude) {
    try {
      const c = canonKey(String(x), { storeGenders: genders });
      if (c) excludedCanons.add(c);
    } catch {}
  }

  // 1-3: filteren, seizoensscore, collectie
  let mapped = [];
  const seenKw = new Set();
  /* De volgorde-correctie kost een woordenboek-lookup per keyword; bij
     108.000 rijen loont het om hem één keer per unieke tekst te doen. */
  const orderMemo = new Map();
  const fixOrder = (k) => {
    let v = orderMemo.get(k);
    if (v === undefined) {
      try {
        v = fixKeywordOrder(k);
      } catch {
        v = k;
      }
      orderMemo.set(k, v);
    }
    return v;
  };
  for (const r of rows) {
    /* Planner-omkeringen ("black shorts cargo", "loafers for men") worden
       hier al rechtgezet, niet pas bij de titel: anders draaien canon,
       geslacht en collectie op de omgekeerde tekst en krijgt hetzelfde
       artikel twee keer budget in twee verschillende collecties. */
    const kw = fixOrder(stripUk(String(r.kw || "").toLowerCase().trim()));
    if (!kw || seenKw.has(kw)) continue;
    seenKw.add(kw);
    const facts = kwFacts(kw);
    if (exclude.has(kw) || facts.junk || (facts.canon && excludedCanons.has(facts.canon))) {
      stats.junk++;
      continue;
    }
    /* Markt-woorden: Brits/Australisch jargon hoort niet in een Amerikaanse
       producttitel ("mens cord trousers" stond in de eerste EveryMan-run;
       een Amerikaan zoekt "corduroy pants"). De AI-nacontrole zou dit moeten
       vangen maar liet het door — dus nu ook statisch. */
    if (market === "USA" && UK_ONLY_RE.test(kw)) {
      stats.marketWord = (stats.marketWord || 0) + 1;
      continue;
    }
    if (blockWordRe && blockWordRe.test(kw)) {
      stats.audienceBlocked = (stats.audienceBlocked || 0) + 1;
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
    /* Stam-telling ZONDER geslachts- en seizoenswoorden. "mens shoes" is net
       zo'n kale kop-term als "womens shoes" — maar "womens" zit in FILLER en
       "mens" niet (die moet in de canon blijven om heren en dames uit elkaar
       te houden), dus herenkop-termen kregen de 2-woords boost (×1,12) i.p.v.
       de demping (×0,70). Daardoor zaten in de eerste EveryMan-run 113 van
       300 producten op 9 kale termen. "winter coats" is evenmin een
       producttype — het seizoenswoord telt ook niet mee. */
    const stemCount = canon
      ? Math.max(1, canon.split(" ").filter((st) => !NON_TYPE_STEMS.has(st)).length)
      : 1;
    const head = stemCount <= 1;
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
    /* Seizoen = woordenboek (curve per collectie/keyword op dit halfrond)
       gecombineerd met wat de DATA zegt: de vraag in het venster t.o.v. het
       jaargemiddelde. Zo herkent de engine het seizoen ook zonder woordenboek-
       regel — en werkt het zelfs als er geen markt is gekozen. */
    const dIdx = seasonIndex(months, r.year);
    const dScore = dataSeasonScore(dIdx);
    const curveS = market ? seasonScore(col, windowSeasons, kw) : 1;
    const sScore = blendSeason(curveS, market ? hasCurveFor(col, kw) : false, dScore);
    if (dScore != null) stats.dataSeason = (stats.dataSeason || 0) + 1;
    /* Dode voorraad: onder de drempel koopt niemand het in dit venster,
       hoe groot het zoekvolume ook is. Een pufferjas met 17.000 zoekopdrachten
       is in een Australische december nog steeds onverkoopbaar. */
    if ((market || dScore != null) && sScore < SEASON_DEAD) {
      stats.offSeason = (stats.offSeason || 0) + 1;
      continue;
    }
    const sFactor = market || dScore != null ? 0.25 + 1.05 * sScore : 1;
    const eFactor = market ? eventFactor(kw, market, windowMonths) : 1;
    mapped.push({
      kw,
      col,
      g,
      avg: Number(r.avg) || 0,
      season,
      score: season * momentum * tailFactor * sFactor * eFactor * (dying ? 0.55 : 1),
      seasonFactor: sFactor,
      seasonScore: sScore,
      seasonIdx: dIdx,
      eventFactor: eFactor,
      yearAvg: Array.isArray(r.year) && r.year.length ? r.year.reduce((a, v) => a + (Number(v) || 0), 0) / r.year.length : 0,
      winVals: months,
      peak: monthNames[peak] || `m${peak + 1}`,
      canon,
      head,
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
  /* opts.skipArtefact: de bijvul-tool draait de engine op een DEELVERZAMELING
     (alleen de keywords van één gevraagde productsoort). Daarin heeft een
     echte term als "penny loafers" geen langere varianten om steun uit te
     halen en zou hij als artefact wegvallen. De AI-eindcontrole vangt
     artefacten daar alsnog. */
  if (!opts.skipArtefact) {
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
  // De NATUURLIJKSTE formulering wint (meeste steun in de dataset), pas daarna
  // de kortste: "mens button down shirts" boven "mens button shirts".
  const cleaner = (a, b) => {
    const sa = supportOf(a.kw);
    const sb = supportOf(b.kw);
    if (sa !== sb) return sa > sb ? a : b;
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
  /* Collectie-seizoen uit de data: som van de (gewogen) venstervraag
     gedeeld door de jaarvraag, over alle keywords van de collectie. Dat is
     het signaal dat "tassen" of "jumpsuits" nu aan de beurt zijn, ook al
     staan ze niet in het woordenboek. */
  const colData = new Map();
  for (const u of unique) {
    if (!u.yearAvg || !u.winVals) continue;
    const w = monthWeights(u.winVals.length);
    const den = w.reduce((a, b) => a + b, 0);
    const win = u.winVals.reduce((a, v, i) => a + w[i] * (Number(v) || 0), 0) / den;
    const key = u.col;
    const cur = colData.get(key) || { win: 0, year: 0 };
    cur.win += win;
    cur.year += u.yearAvg;
    colData.set(key, cur);
  }
  const colDataScore = (col) => {
    const d = colData.get(col);
    return d && d.year > 0 ? dataSeasonScore(d.win / d.year) : null;
  };
  const colSeason = (col) =>
    blendSeason(
      market ? seasonScore(col, windowSeasons, null) : 1,
      market ? Boolean(COL_SEASON_CURVE[col]) : false,
      colDataScore(col)
    );
  stats.colSeason = {};
  for (const c of new Set(unique.map((u) => u.col))) stats.colSeason[c] = Math.round(colSeason(c) * 100) / 100;

  const rules = market || colData.size
    ? {
        /* Plafonds: zware/riskante categorieën mogen de store nooit meer
           domineren. Jassen zijn seizoensgevoelig kapitaal; schoenen en
           laarzen zijn de lastigste dropship-categorie die er is
           (maatvoering, retouren, merkverwachting). En een categorie die
           volledig buiten het venster valt is op z'n best een bijzaak —
           hard-zomerse soorten (shorts/swim/sandalen in een wintervenster)
           vrijwel nul. */
        cap: (col) => {
          if (opts.liftCaps) return null;
          let f = null;
          if (col.includes("Jackets & Coats")) f = 0.2;
          else if (col.endsWith("Shoes")) f = 0.13;
          else if (col.endsWith("Boots")) f = 0.13;
          // Accessoires: meeverkopers, nooit de kern van een kledingstore
          else if (col.endsWith("Bags")) f = 0.08;
          else if (col.endsWith("Hats")) f = 0.04;
          /* Seizoensplafond op de curve i.p.v. een aan/uit-lijstje. Jassen
             in een AUS okt-jan-venster komen op score ~0,23 → ruim 5%, in
             plaats van de 14% die de run van 13-9 opleverde. */
          const sc = seasonCapFrac(colSeason(col));
          if (sc != null) f = Math.min(f ?? 1, sc);
          return f;
        },
        /* Vloeren: de kern van het seizoen moet vertegenwoordigd zijn.
           Herfst/winter-venster → hoodies, sweaters en shirts zijn waar
           de Q4-marge zit; zomer-venster → swim hoort een echte categorie
           te zijn. Alleen afgedwongen als er keywords voor bestaan. */
        floor: (col) => {
          /* Vloer volgt nu dezelfde curve: wat in dit venster piekt MOET
             vertegenwoordigd zijn. Werkt daardoor in elke markt en elk
             venster, zonder per seizoen een aparte regel. */
          const sf = seasonFloorFrac(col, colSeason(col), colDataScore(col) != null);
          if (sf != null) return sf;
          // Shirts zijn in een koud venster de Q4-marge, maar jaarrond en
          // dus zonder curve — die houdt zijn eigen regel.
          if (coldShare >= 0.5 && col.endsWith("Shirts")) return 0.07;
          return null;
        },
        /* Groepsplafond uit het store-profiel: schoeisel (schoenen, laarzen,
           sandalen, flats) SAMEN onder footwearCap. */
        groupCaps:
          profile && profile.footwearCap
            ? [{ test: (col) => /Shoes|Boots|Sandals|Flats & Loafers/.test(col), frac: profile.footwearCap }]
            : [],
      }
    : null;

  const droppedCols = [];
  let allRows = [];
  if (genders === "MV") {
    /* Heren-aandeel: doel uit profiel/opts (standaard 40%), maar nooit meer
       dan de herenkeywords met hun normale cap kunnen dragen — anders blaast
       allocateByCollection de cap op en krijgen 8 keywords elk 20+ producten. */
    const target = Math.max(0, Math.min(0.7,
      Number(opts.menShare) > 0 ? Number(opts.menShare)
      : profile && Number(profile.menShare) > 0 ? Number(profile.menShare)
      : MEN_SHARE_DEFAULT));
    const men = unique.filter((r) => r.g === "M");
    const women = unique.filter((r) => r.g === "V");
    /* Wat kan een kant ÉCHT dragen: per collectie de keyword-caps, maar
       nooit boven het collectieplafond. Zonder die tweede grens kreeg een
       dunne herenkant (8 shirts-keywords, 1 zwem, 1 sandaal) het volle
       budget en belandde de rest als "restbudget" in één collectie — 119
       van de 195 herenproducten in Men's Shirts. */
    const effCap = (items, budget) => {
      const byC = new Map();
      for (const r of items) byC.set(r.col, (byC.get(r.col) || 0) + kwCapOf(r, P));
      let sum = 0;
      for (const [c, kc] of byC) {
        let f = P.colCapFrac;
        if (rules && rules.cap) { const o = rules.cap(c); if (o != null) f = Math.min(f, o); }
        sum += Math.min(kc, budget * f);
      }
      return Math.floor(sum);
    };
    const want = Math.round(total * target);
    const capM = effCap(men, want);
    const capW = effCap(women, total - Math.min(want, capM));
    let mBudget = Math.min(want, capM);
    // Kan de damescant de rest niet dragen, dan schuift het terug naar heren
    if (total - mBudget > capW) mBudget = Math.min(capM, total - capW);
    mBudget = Math.max(0, Math.min(total, mBudget));
    stats.menTarget = Math.round(target * 100);
    stats.menBudget = mBudget;
    allRows = [
      ...allocateByCollection(women, total - mBudget, P, droppedCols, rules),
      ...(mBudget > 0 ? allocateByCollection(men, mBudget, P, droppedCols, rules) : []),
    ];
  } else {
    allRows = allocateByCollection(unique, total, P, droppedCols, rules);
  }
  allRows = allRows.filter((x) => x.n >= P.floor);
  allRows.sort((a, b) => b.season - a.season);

  /* Titel-opschoning. De woordvolgorde is hierboven al rechtgezet
     (fixKeywordOrder draait op de invoer); deze ronde vangt alleen wat na
     de samenvoeging nog overblijft, plus de markt-spelling. */
  for (const x of allRows) {
    /* Titelwaardige formulering: "palazzo clothing" → "palazzo pants",
       "linen pants clothes" → "linen pants"; in AUS/UK "grey" i.p.v. "gray"
       (het keyword komt letterlijk in producttitels). */
    x.kw = x.kw.replace(/\s+(clothing|clothes|apparel)$/, "").trim() || x.kw;
    if (/^palazzo$/.test(x.kw) || /\bpalazzo$/.test(x.kw)) x.kw = `${x.kw} pants`;
    if (market === "AUS" || market === "UK") x.kw = x.kw.replace(/\bgray\b/g, "grey");
    try {
      x.kw = fixKeywordOrder(x.kw) || x.kw;
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
    /* Reist mee naar de sheet-header, zodat de scraper en de importer het
       storegeslacht niet opnieuw hoeven te raden. */
    genders,
    singleGender,
    market,
    hemisphere,
    windowSeasons,
    storeProfile: profile,
    blockedCollections: [...blocked],
    caps: { perKeyword: P.cap, headTerm: P.headCap },
    stats,
  };
}
