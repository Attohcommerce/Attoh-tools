// MAAT-SYSTEMEN PER MARKT — de kennisbank achter de maten-check.
//
// Onze markten: USA, CAN (identiek aan USA), UK, AUS+NZ. Bron-producten
// komen vaak met EU-maten (36/38/40, schoenen 35–46) binnen en die horen
// in GEEN van onze markten thuis. Belangrijke nuance: nummers 4–26 zijn in
// élke markt geldig (US 0–20, UK/AU 4–26) maar betekenen iets anders
// (US 12 = AU 16) — dat is uit de nummers alleen NIET te zien, dus daar
// wordt bewust niet op gealarmeerd (geen vals alarm). Alleen ondubbelzinnig
// EU en rommel-waarden met labels worden aangepakt.
//
// KLANT-LOGICA BOVEN WISKUNDE (les van de eerste live run, 20-8): supplier-
// waarden zijn vaak een mix als "US 4.5 | EU 35" of "37 EU/6.5-7 US". De
// oude parser pakte het EERSTE getal en rekende daarop — met "maat −26.5"
// als resultaat. Nu geldt: (1) staat het doelmarkt-nummer er al bij
// (US-label op een AU-damesschoen = hetzelfde nummer), dan wordt dát
// nummer overgenomen — nooit gerekend; (2) alleen anders wordt er
// omgerekend vanaf het júiste gelabelde nummer; (3) elk resultaat moet
// binnen de sanity-band van de productsoort vallen, anders doet de fix
// dat product NIET en meldt hij "handmatig". Een klant ziet altijd één
// schoon nummer ("8"), nooit "EU 38/US 7.5" en nooit onzin.
//
// De tabellen (standaard fashion-retail):
//  Dameskleding:  US/CAN = EU − 32 · UK/AU = EU − 28   (EU 36 = US 4 = UK/AU 8) · UK/AU = US + 4
//  Herenjassen:   borstmaat inches = EU − 10           (EU 50 = 40")
//  Herenbroeken:  taille inches = EU − 16              (EU 50 = 34")
//  Damesschoenen: US/AU = EU − 31 · UK = EU − 33       (EU 38 = US/AU 7 = UK 5) · UK = US − 2
//  Herenschoenen: US = EU − 33 · UK/AU = EU − 34       (EU 43 = US 10 = UK/AU 9) · UK/AU = US − 1
//  BH-band:       inches = EU/2,5 + 4 · AU = (EU−70)/5×2 + 10  (EU 75 = 34 = AU 12)
// Schoenen-tabellen verschillen per merk tot een halve maat — na een
// conversie altijd een steekproef doen (staat ook in de fix-notitie).

function norm(s) {
  return String(s || "").toLowerCase();
}

export const MARKETS = ["USA", "UK", "AUS+NZ", "CAN"];

// Spiekbrief per markt (getoond in de Store Doctor)
export const MARKET_SIZE_GUIDE = {
  USA: [
    "Dameskleding (jurken/tops/rokken/outerwear/zwem): US 0–20 (even) of XS–XXL",
    "Jeans & broeken: taille in inches — dames 24–34, heren 28–40",
    "Damesschoenen: US 5–11 · Herenschoenen: US 7–14",
    "BH's: inch-band 30–40 + cup (32B, 34C)",
    "Herenjassen/pakken: borstmaat in inches 36–48; verder XS–XXL",
  ],
  CAN: [
    "Canada is 1-op-1 identiek aan de USA-maatvoering (kleding, schoenen, BH's).",
    "Dameskleding: US 0–20 of XS–XXL · Jeans: inches · Damesschoenen US 5–11 · Herenschoenen US 7–14 · BH's 32B-stijl",
  ],
  UK: [
    "Dameskleding: UK 4–24 (UK = US + 4 → UK 12 = US 8) of XS–XXL",
    "Jeans & broeken: taille in inches (zelfde als US)",
    "Damesschoenen: UK 2–9 (UK = US − 2) · Herenschoenen: UK 6–13 (UK = US − 1)",
    "BH's: zelfde inch-banden als US (30–40 + cup)",
    "Herenjassen/pakken: borstmaat in inches",
  ],
  "AUS+NZ": [
    "Dameskleding: AU 6–26 — zelfde nummers als UK (AU 12 = UK 12 = US 8)",
    "Jeans & broeken: taille in inches",
    "Damesschoenen: AU volgt de US-nummering (AU 8 = US 8 = UK 6)",
    "Herenschoenen: AU volgt de UK-nummering (AU 9 = UK 9 = US 10)",
    "BH's: AU 8–18 + cup (AU 12B = US 34B); US-stijl 32B/34C is in AU-retail óók gangbaar — beide goed",
    "NZ = identiek aan AU.",
  ],
};

/* ---------- Productfamilie bepalen ---------- */

const SHOES_RE = /\b(boots?|heels?|sneakers?|sandals?|flats?|mules?|loafers?|pumps?|shoes?|footwear|trainers?|slides?|wedges?|espadrilles?|mary jane)\b/;
const BRA_RE = /\b(bras?|bralettes?|lingerie)\b/;
const BOTTOMS_RE = /\b(jeans?|pants?|trousers?|chinos?|joggers?|shorts|leggings?|culottes?)\b/;

export function familyOf(productType, title) {
  const s = norm(productType) + " " + norm(title);
  if (SHOES_RE.test(s)) return "shoes";
  if (BRA_RE.test(s)) return "bra";
  if (BOTTOMS_RE.test(s)) return "bottoms";
  return "clothing";
}

/* ---------- Waarde parsen: gelabelde nummers per systeem ----------
   "US 4.5 | EU 35"  → { us: 4.5, eu: 35 }
   "37 EU/6.5-7 US"  → { eu: 37, us: 6.5 }   (bij een range telt het eerste getal)
   "EU38"            → { eu: 38 }
   "7.5"             → { bare: 7.5 }
   "One Size"        → { } (niets numeriek — blijft altijd met rust)      */

const NUMPAT = "(\\d{1,3}(?:[.,]5)?)";

export function extractSizeParts(raw) {
  const s = String(raw == null ? "" : raw).replace(/,/g, ".");
  const parts = { eu: null, us: null, uk: null, au: null, bare: null, cup: "" };
  const put = (labelRaw, numStr) => {
    const l = labelRaw.toLowerCase();
    const key = l.startsWith("e") ? "eu" : l.startsWith("a") ? "au" : l === "uk" ? "uk" : "us";
    const n = Number(numStr);
    if (!isNaN(n) && parts[key] == null) parts[key] = n;
  };
  // label vóór nummer: "EU 38", "US: 7.5", "AU8" (evt. met range "US 6.5-7")
  const re1 = new RegExp("\\b(eu|eur|us|usa|uk|au|aus)\\.?\\s*:?\\s*" + NUMPAT, "gi");
  // nummer vóór label: "38 EU", "6.5-7 US"
  const re2 = new RegExp(NUMPAT + "(?:\\s*-\\s*\\d{1,3}(?:\\.5)?)?\\s*(eu|eur|us|usa|uk|au|aus)\\b", "gi");
  let m;
  while ((m = re1.exec(s))) put(m[1], m[2]);
  while ((m = re2.exec(s))) put(m[2], m[1]);
  const labeled = parts.eu != null || parts.us != null || parts.uk != null || parts.au != null;
  if (!labeled) {
    const bm = s.match(/(\d{1,3}(?:\.5)?)/);
    if (bm) parts.bare = Number(bm[1]);
  }
  const cupM = s.match(/\d+\s*([a-k]{1,2})\b/i);
  if (cupM && !/^(eu|us|uk|au)$/i.test(cupM[1])) parts.cup = cupM[1].toUpperCase();
  return { ...parts, labeled };
}

/* ---------- Detectie-banden & sanity-grenzen ---------- */

function isEuNum(num, family, gender) {
  if (num == null) return false;
  if (family === "shoes") return num >= 35 && num <= 49;
  if (family === "bra") return num >= 60 && num <= 110 && num % 5 === 0;
  if (family === "bottoms") {
    // heren-EU-broekmaten 46–60; dames-EU-bottoms zijn niet te onderscheiden
    // van taille-inches (34–44 overlapt) → alleen heren flaggen
    return gender === "men" && num >= 46 && num <= 60 && num % 2 === 0;
  }
  if (gender === "men") return num >= 44 && num <= 60 && num % 2 === 0;
  return num >= 32 && num <= 56 && num % 2 === 0;
}

// Waar mag het EINDRESULTAAT landen? Erbuiten = niet schrijven, "handmatig".
function saneRange(family, gender, market) {
  if (family === "shoes") return gender === "men" ? [4, 15] : market === "UK" ? [1, 11] : [2, 13];
  if (family === "bra") return market === "AUS+NZ" ? [6, 26] : [28, 46];
  if (family === "bottoms") return gender === "men" ? [24, 46] : [0, 46];
  if (gender === "men") return [30, 60]; // borstmaat inches
  return [0, 30]; // dameskleding
}

function fmtNum(n) {
  const r = Math.round(n * 2) / 2;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/* ---------- De beslistabellen: extractie boven wiskunde ----------
   direct = deze labels zijn al het doelmarkt-nummer (overnemen, niet rekenen)
   daarna: omrekenen vanaf een ander gelabeld systeem, als laatste EU.     */

const SHOE_RULES = {
  women: {
    "AUS+NZ": { direct: ["au", "us"], uk: 2, eu: -31 },
    USA: { direct: ["us", "au"], uk: 2, eu: -31 },
    CAN: { direct: ["us", "au"], uk: 2, eu: -31 },
    UK: { direct: ["uk"], us: -2, au: -2, eu: -33 },
  },
  men: {
    "AUS+NZ": { direct: ["au", "uk"], us: -1, eu: -34 },
    UK: { direct: ["uk", "au"], us: -1, eu: -34 },
    USA: { direct: ["us"], uk: 1, au: 1, eu: -33 },
    CAN: { direct: ["us"], uk: 1, au: 1, eu: -33 },
  },
};

const CLOTHING_RULES = {
  women: {
    "AUS+NZ": { direct: ["au", "uk"], us: 4, eu: -28 },
    UK: { direct: ["uk", "au"], us: 4, eu: -28 },
    USA: { direct: ["us"], uk: -4, au: -4, eu: -32 },
    CAN: { direct: ["us"], uk: -4, au: -4, eu: -32 },
  },
  // heren: gelabelde US/UK/AU-nummers zijn inches (overal gelijk); EU rekent om
  men: { any: { direct: ["us", "uk", "au"], eu: -10 } },
};

function rulesFor(family, gender, market) {
  if (family === "shoes") return SHOE_RULES[gender] && SHOE_RULES[gender][market];
  if (gender === "men") return CLOTHING_RULES.men.any;
  return CLOTHING_RULES.women[market];
}

/* Kern: van geparste onderdelen naar het doelmarkt-NUMMER (nog zonder
   clamp/format). euDelta = de uit dit product zélf afgeleide EU-verhouding
   (zie resolveSizeSet) — die wint van de standaardtabel, want de bron weet
   zijn eigen leest het best. */
function resolveFromParts(p, family, gender, market, euDelta) {
  const rules = rulesFor(family, gender, market);
  if (!rules) return null;
  // 1. Doelmarkt-nummer staat er al bij → overnemen (klant-logica, geen wiskunde)
  for (const key of rules.direct) {
    if (p[key] != null) return p[key];
  }
  // 2. Ander gelabeld systeem → vaste offset
  for (const key of ["us", "uk", "au"]) {
    if (p[key] != null && typeof rules[key] === "number") return p[key] + rules[key];
  }
  // 3. EU: eerst de product-eigen ladder, anders de standaardtabel
  const euOff = typeof euDelta === "number" ? euDelta : rules.eu;
  if (p.eu != null) return p.eu + euOff;
  if (p.bare != null && isEuNum(p.bare, family, gender)) return p.bare + euOff;
  return null;
}

/**
 * resolveSizeValue(raw, {family, gender, market, euDelta})
 * → { value, changed, ok }
 *   ok=false  : er staat wél een maat maar die is niet veilig op te lossen
 *               (onbekende mix / resultaat buiten de sanity-band) → product
 *               overslaan en "handmatig" melden, NOOIT gokken.
 *   changed   : ook true bij puur opschonen ("EU 38/US 7.5" → "7.5").
 */
export function resolveSizeValue(raw, opts = {}) {
  const family = opts.family || "clothing";
  const gender = opts.gender || "women";
  const market = opts.market;
  const src = String(raw == null ? "" : raw).trim();
  const p = extractSizeParts(src);
  const keep = { value: src, changed: false, ok: true };
  if (!market) return keep;
  const hasNum = p.labeled || p.bare != null;
  if (!hasNum) return keep; // "One Size", "S/M/L" — niet numeriek, altijd oké

  const [lo, hi] = saneRange(family, gender, market);
  const finish = (n) => {
    if (n == null || isNaN(n) || n < lo || n > hi) return { value: src, changed: false, ok: false };
    const outVal = family === "bra" && p.cup ? fmtNum(n) + p.cup : fmtNum(n);
    return { value: outVal, changed: outVal !== src, ok: true };
  };

  if (family === "bra") {
    if (p.labeled && p.us != null) return finish(p.us); // inch-band overnemen
    const n = p.eu != null ? p.eu : p.bare;
    if (isEuNum(n, "bra", gender)) {
      const band = market === "AUS+NZ" ? ((n - 70) / 5) * 2 + 10 : n / 2.5 + 4;
      return finish(band);
    }
    if (p.bare != null && p.bare >= lo && p.bare <= hi) return keep;
    return p.labeled ? finish(null) : keep;
  }

  const n = resolveFromParts(p, family, gender, market, opts.euDelta);
  if (n != null) return finish(n);
  // Kaal nummer dat al in de doelband valt → laten staan
  if (p.bare != null && p.bare >= lo && p.bare <= hi) return keep;
  // Gelabeld maar onbruikbaar (bv. alleen een EU-label zonder logisch nummer)
  return p.labeled ? { value: src, changed: false, ok: false } : keep;
}

/**
 * resolveSizeSet(rawValues, {family, gender, market}) → [{value, changed, ok}]
 * Het hele product in één keer, mét de slimste stap: dragen sommige waarden
 * BEIDE systemen ("EU 35/US 5.5"), dan wordt daar de leverancier z'n eigen
 * EU→doel-ladder uit afgeleid (mediaan) en gebruikt die voor de waarden
 * waar alléén EU op staat ("EU 39" → 9.5 in plaats van tabel-8). Alleen
 * wanneer alle afgeleide verhoudingen op elkaar liggen (±0,5) — anders
 * gewoon de standaardtabel.
 */
export function resolveSizeSet(rawValues, opts = {}) {
  const family = opts.family || "clothing";
  const gender = opts.gender || "women";
  const market = opts.market;
  let euDelta = null;
  if (market && family !== "bra") {
    const deltas = [];
    for (const raw of rawValues || []) {
      const parts = extractSizeParts(raw);
      if (parts.eu == null) continue;
      const donor = { ...parts, eu: null, bare: null };
      donor.labeled = donor.us != null || donor.uk != null || donor.au != null;
      if (!donor.labeled) continue;
      const n = resolveFromParts(donor, family, gender, market, null);
      if (n != null) deltas.push(n - parts.eu);
    }
    if (deltas.length) {
      deltas.sort((a, b) => a - b);
      const med = deltas[Math.floor(deltas.length / 2)];
      if (deltas.every((d) => Math.abs(d - med) <= 0.5)) euDelta = med;
    }
  }
  return (rawValues || []).map((raw) => resolveSizeValue(raw, { ...opts, euDelta }));
}

/** Oude naam blijft werken (importer/doctor gebruiken hem her en der). */
export function convertSizeValue(raw, opts = {}) {
  return resolveSizeValue(raw, opts);
}

/**
 * analyzeSizes(values, {family, gender, market})
 * → { eu, convertible, extra, pairs }
 *   eu          : er is iets mis met deze maten-set (EU-systeem en/of
 *                 rommel-waarden met labels zoals "EU 38/US 7.5")
 *   convertible : de fix kan ze ALLEMAAL veilig oplossen (uniek + binnen
 *                 de sanity-band) — anders toont de check "handmatig"
 */
export function analyzeSizes(values, opts = {}) {
  const family = opts.family || "clothing";
  const gender = opts.gender || "women";
  const market = opts.market || "";
  const raws = (values || []).map((v) => String(v));
  const parsed = raws.map((r) => ({ raw: r, parts: extractSizeParts(r) }));
  const numeric = parsed.filter((x) => x.parts.labeled || x.parts.bare != null);
  if (!numeric.length) return { eu: false, convertible: false, extra: "", pairs: [] };

  const anyLabel = numeric.some((x) => x.parts.labeled);
  const bareEu = numeric.filter((x) => !x.parts.labeled && isEuNum(x.parts.bare, family, gender));
  const minHits = family === "shoes" || family === "bra" ? 1 : 2;
  const flag = anyLabel || (bareEu.length >= minHits && bareEu.length >= numeric.length * 0.7);
  if (!flag) return { eu: false, convertible: false, extra: "", pairs: [] };

  if (!market) {
    return {
      eu: true,
      convertible: false,
      extra: `maten: ${raws.slice(0, 5).join(" · ")} — kies eerst de doelmarkt`,
      pairs: [],
    };
  }

  const setRes = resolveSizeSet(raws, { family, gender, market });
  const res = parsed.map((x, i) => ({ raw: x.raw, r: setRes[i] }));
  const allOk = res.every((x) => x.r.ok);
  const finals = res.map((x) => x.r.value);
  const unique = new Set(finals).size === finals.length;
  const changedPairs = res.filter((x) => x.r.changed).map((x) => [x.raw, x.r.value]);
  const convertible = allOk && unique && changedPairs.length > 0;

  const from = raws.slice(0, 5).join(" · ");
  const extra = convertible
    ? `${from} → ${changedPairs.map((x) => x[1]).slice(0, 6).join("/")} (${market})`
    : `handmatig: ${from} — onduidelijke maten-mix, hier gok ik niet op`;
  return { eu: true, convertible, extra, pairs: changedPairs };
}
