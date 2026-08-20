// MAAT-SYSTEMEN PER MARKT — de kennisbank achter de maten-check.
//
// Onze markten: USA, CAN (identiek aan USA), UK, AUS+NZ. Bron-producten
// komen vaak met EU-maten (36/38/40, schoenen 35–46) binnen en die horen
// in GEEN van onze markten thuis. Belangrijke nuance: nummers 4–26 zijn in
// élke markt geldig (US 0–20, UK/AU 4–26) maar betekenen iets anders
// (US 12 = AU 16) — dat is uit de nummers alleen NIET te zien, dus daar
// wordt bewust niet op gealarmeerd (geen vals alarm). Alleen ondubbelzinnig
// EU wordt geflagd en omgerekend.
//
// De tabellen (standaard fashion-retail):
//  Dameskleding:  US/CAN = EU − 32 · UK/AU = EU − 28   (EU 36 = US 4 = UK/AU 8)
//  Herenjassen:   borstmaat inches = EU − 10           (EU 50 = 40")
//  Herenbroeken:  taille inches = EU − 16              (EU 50 = 34")
//  Damesschoenen: US/AU = EU − 31 · UK = EU − 33       (EU 38 = US/AU 7 = UK 5)
//  Herenschoenen: US = EU − 33 · UK/AU = EU − 34       (EU 43 = US 10 = UK/AU 9)
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

const SHOES_RE = /\b(boots?|heels?|sneakers?|sandals?|flats?|mules?|loafers?|pumps?|shoes?|footwear|trainers?|slides?|wedges?|espadrilles?)\b/;
const BRA_RE = /\b(bras?|bralettes?|lingerie)\b/;
const BOTTOMS_RE = /\b(jeans?|pants?|trousers?|chinos?|joggers?|shorts|leggings?|culottes?)\b/;

export function familyOf(productType, title) {
  const s = norm(productType) + " " + norm(title);
  if (SHOES_RE.test(s)) return "shoes";
  if (BRA_RE.test(s)) return "bra";
  if (BOTTOMS_RE.test(s)) return "bottoms";
  return "clothing";
}

/* ---------- Waarde parsen ---------- */

function parseSizeValue(raw) {
  const s = String(raw == null ? "" : raw).trim();
  const euLabel = /(^|[\s(])(eu|eur)\b/i.test(s);
  const m = s.match(/(\d+)(?:[.,](5))?/);
  if (!m) return { num: null, euLabel, cup: "" };
  const num = Number(m[1]) + (m[2] ? 0.5 : 0);
  // cup-letter voor BH's ("70B" → B)
  const cupM = s.match(/\d+\s*([a-k]{1,2})\b/i);
  return { num, euLabel, cup: cupM ? cupM[1].toUpperCase() : "" };
}

/* ---------- Detectie: is dit EU? ---------- */

function isEuNum(num, family, gender) {
  if (num == null) return false;
  if (family === "shoes") return num >= 35 && num <= 48;
  if (family === "bra") return num >= 60 && num <= 110 && num % 5 === 0;
  if (family === "bottoms") {
    // heren-EU-broekmaten 46–60; dames-EU-bottoms zijn niet te onderscheiden
    // van taille-inches (34–44 overlapt) → alleen heren flaggen
    return gender === "men" && num >= 46 && num <= 60 && num % 2 === 0;
  }
  // clothing
  if (gender === "men") return num >= 44 && num <= 60 && num % 2 === 0;
  return num >= 32 && num <= 56 && num % 2 === 0;
}

/**
 * analyzeSizes(values, {family, gender, market})
 * → { eu: bool, extra: "EU 36/38/40 → 8/10/12 (AUS+NZ)", pairs: [[old, new]] }
 * Alleen EU wanneer het ondubbelzinnig is: expliciet "EU"-label, of ≥70%
 * van de numerieke waarden in de EU-band van deze productfamilie.
 */
export function analyzeSizes(values, opts = {}) {
  const family = opts.family || "clothing";
  const gender = opts.gender || "women";
  const market = opts.market || "";
  const parsed = (values || []).map((v) => ({ raw: String(v), ...parseSizeValue(v) }));
  const nums = parsed.filter((p) => p.num != null);
  if (!nums.length) return { eu: false, extra: "", pairs: [] };

  const anyLabel = nums.some((p) => p.euLabel);
  const inBand = nums.filter((p) => isEuNum(p.num, family, gender));
  // Kleding-detectie vraagt ≥2 waarden in de band (één losse "38" kan van
  // alles zijn); schoenen/BH-banden zijn ook met één waarde ondubbelzinnig.
  const minHits = family === "shoes" || family === "bra" ? 1 : 2;
  const eu = anyLabel || (inBand.length >= minHits && inBand.length >= nums.length * 0.7);
  if (!eu) return { eu: false, extra: "", pairs: [] };

  const pairs = parsed
    .filter((p) => p.num != null && (p.euLabel || isEuNum(p.num, family, gender)))
    .map((p) => [p.raw, market ? convertSizeValue(p.raw, { family, gender, market }).value : "?"]);
  const from = pairs.map((x) => x[0]).slice(0, 5).join("/");
  const to = pairs.map((x) => x[1]).slice(0, 5).join("/");
  const extra = market ? `EU ${from} → ${to} (${market})` : `EU-maten: ${from}`;
  return { eu: true, extra, pairs };
}

/* ---------- Conversie ---------- */

const OFFSETS = {
  clothingW: { USA: -32, CAN: -32, UK: -28, "AUS+NZ": -28 },
  chestM: { USA: -10, CAN: -10, UK: -10, "AUS+NZ": -10 },
  waistM: { USA: -16, CAN: -16, UK: -16, "AUS+NZ": -16 },
  shoesW: { USA: -31, CAN: -31, UK: -33, "AUS+NZ": -31 },
  shoesM: { USA: -33, CAN: -33, UK: -34, "AUS+NZ": -34 },
};

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.floor(n)) + ".5";
}

/**
 * convertSizeValue("EU 38", {family, gender, market}) → {value, changed}
 * Niet-EU-waarden komen ongewijzigd terug. Cup-letters blijven staan.
 */
export function convertSizeValue(raw, opts = {}) {
  const family = opts.family || "clothing";
  const gender = opts.gender || "women";
  const market = opts.market;
  const p = parseSizeValue(raw);
  if (p.num == null || !market || !(p.euLabel || isEuNum(p.num, family, gender))) {
    return { value: String(raw), changed: false };
  }

  let out = null;
  if (family === "bra") {
    const band =
      market === "AUS+NZ" ? ((p.num - 70) / 5) * 2 + 10 : p.num / 2.5 + 4;
    out = fmtNum(Math.round(band)) + (p.cup || "");
  } else {
    let key;
    if (family === "shoes") key = gender === "men" ? "shoesM" : "shoesW";
    else if (family === "bottoms") key = "waistM"; // alleen heren-EU wordt gedetecteerd
    else key = gender === "men" ? "chestM" : "clothingW";
    const off = OFFSETS[key][market];
    if (off == null) return { value: String(raw), changed: false };
    out = fmtNum(p.num + off);
  }
  return { value: out, changed: out !== String(raw).trim() };
}
