// SIZE GUIDE (maattabellen) — de pure motor. Geen netwerk, geen Shopify:
// alleen tabel-data in → een schone, logische maattabel uit.
//
//   1. normalizeChart()  ruwe tabel (koppen + rijen, uit AliExpress of een
//                        screenshot) → canonieke kolommen, waarden in cm
//   2. alignRows()       tabelrijen ↔ de maten die het product in Shopify
//                        écht heeft (de tabel volgt de variantkiezer, nooit
//                        andersom)
//   3. buildGuide()      + markt-kolom (US/AU/UK), sanity-banden, cijfer,
//                        verdict → het metafield-JSON (custom.size_guide)
//   4. standardGuide()   vangnet: vaste US-conventietabel gevuld met de
//                        eigen variantmaten (altijd expliciet "standard")
//
// Regel nummer één (zelfde als MATEN v4): op maten gokken we niet. Twijfel
// = review-lijst, geen tabel. Alles hier is deterministisch en unit-getest
// (scripts/test-sizeguide.mjs).

import { familyOf } from "./sizes.js";

export const SG_NS = "custom";
export const SG_KEY = "size_guide";
export const SG_STATUS_KEY = "size_guide_status";
export const SG_VERSION = 1;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();

/* =========================================================================
   1. KOLOMMEN — koptekst → canonieke key
   ========================================================================= */

// Volgorde telt: eerste match wint. `kind`: size = maatlabel-kolom,
// text = niet-numeriek, length = cm (omrekenbaar naar inch), mass = kg/lb.
const COLUMN_RULES = [
  { key: "size", kind: "size", re: /^(size|sizes|maat|maten|label|tag size|asian size|cn size|size \(cn\))$/ },
  { key: "eu", kind: "text", re: /\b(eu|eur|europe|european)\b/ },
  { key: "us", kind: "text", re: /\b(us|usa|america|american)\b/ },
  { key: "uk", kind: "text", re: /\b(uk|british)\b/ },
  { key: "au", kind: "text", re: /\b(au|aus|australia|australian)\b/ },
  { key: "age", kind: "text", re: /\bage\b|leeftijd/ },
  { key: "foot", kind: "length", re: /foot|feet|voet|insole|inner length|inner sole/ },
  { key: "heel", kind: "length", re: /heel/ },
  { key: "bust", kind: "length", re: /bust|chest|borst|boezem/ },
  { key: "waist", kind: "length", re: /waist|taille/ },
  { key: "hip", kind: "length", re: /\bhips?\b|heup/ },
  { key: "shoulder", kind: "length", re: /shoulder|schouder/ },
  { key: "sleeve", kind: "length", re: /sleeve|mouw|arm length|armlengte/ },
  { key: "inseam", kind: "length", re: /inseam|inside leg|inner leg|binnenbeen|crotch/ },
  { key: "outseam", kind: "length", re: /outseam|outside leg|buitenbeen/ },
  { key: "thigh", kind: "length", re: /thigh|\bdij\b/ },
  { key: "hem", kind: "length", re: /\bhem\b|sweep|bottom width|leg opening|pijpwijdte|zoom/ },
  { key: "cuff", kind: "length", re: /cuff|manchet/ },
  { key: "collar", kind: "length", re: /collar|neck|kraag|hals/ },
  { key: "height", kind: "length", re: /height|lichaamslengte|body length \(cm\)|stature/ },
  { key: "weight", kind: "mass", re: /weight|gewicht/ },
  { key: "length_top", kind: "length", re: /(top|shirt|blouse|jacket|coat|upper)\s*length/ },
  { key: "length_bottom", kind: "length", re: /(pants?|trouser|bottom|short|leg)s?\s*length/ },
  { key: "length", kind: "length", re: /length|lengte|\blong\b/ },
  { key: "width", kind: "length", re: /width|breedte|wijdte/ },
];

const COLUMN_LABEL = {
  size: "Size", eu: "EU", us: "US", uk: "UK", au: "AU", age: "Age",
  foot: "Foot length", heel: "Heel height", bust: "Bust", waist: "Waist", hip: "Hips",
  shoulder: "Shoulder", sleeve: "Sleeve", inseam: "Inseam", outseam: "Outseam", thigh: "Thigh",
  hem: "Hem", cuff: "Cuff", collar: "Collar", height: "Height", weight: "Weight",
  length_top: "Top length", length_bottom: "Bottom length", length: "Length", width: "Width",
};

// Onze eigen meet-instructies (nooit AliExpress-tekst overnemen — die is
// van hen, en GMC-uniciteit geldt ook voor hulpteksten).
export const HOW_TO_MEASURE = {
  bust: "Measure around the fullest part of the chest, keeping the tape level.",
  waist: "Measure around the narrowest part of the waist.",
  hip: "Measure around the fullest part of the hips.",
  shoulder: "Measure across the back from one shoulder seam to the other.",
  sleeve: "Measure from the shoulder seam to the end of the cuff.",
  length: "Measure from the highest point of the shoulder straight down to the hem.",
  length_top: "Measure the top from the highest point of the shoulder down to the hem.",
  length_bottom: "Measure the bottoms from the waistband down to the hem.",
  inseam: "Measure along the inside of the leg from the crotch seam to the hem.",
  outseam: "Measure along the outside of the leg from the waistband to the hem.",
  thigh: "Measure around the fullest part of the thigh.",
  hem: "Measure the width of the bottom hem, lying flat.",
  foot: "Stand on a sheet of paper and measure from the heel to the tip of the longest toe.",
  height: "Body height, measured without shoes.",
};

export function columnFor(header) {
  const h = norm(header).replace(/\((cm|in|inch|inches|mm)\)/g, "").trim();
  if (!h) return null;
  for (const r of COLUMN_RULES) {
    if (r.re.test(h)) return { key: r.key, kind: r.kind, label: COLUMN_LABEL[r.key] };
  }
  const slug = h.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
  return { key: "x_" + (slug || "col"), kind: "unknown", label: String(header).trim() };
}

/* =========================================================================
   2. WAARDEN — getallen, ranges, units
   ========================================================================= */

// "84", "84.5", "84-88", "84/88", "33.07", "40/42" → {a, b|null}  (b = range-eind)
export function parseCell(raw) {
  const s = String(raw == null ? "" : raw).replace(/,/g, ".").replace(/[~～]/g, "-").trim();
  if (!s) return { a: null, b: null, text: "" };
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums) return { a: null, b: null, text: s };
  const a = Number(nums[0]);
  const range = /\d\s*[-–\/]\s*\d/.test(s) && nums.length >= 2 ? Number(nums[1]) : null;
  return { a, b: range != null && range !== a ? range : null, text: s };
}

const IN = 2.54;
export const round1 = (n) => Math.round(n * 10) / 10;
export const cmToIn = (cm) => round1(cm / IN);
export const inToCm = (inch) => round1(inch * IN);

/* Unit bepalen op de héle tabel (nooit op één cel): koppen die "(cm)"/"(in)"
   dragen winnen; anders de omtrek-kolommen (borst/taille/heup: cm ≥ 50,
   inch < 50), dan voetlengte (cm ≥ 15), dan de grootste lengtewaarde. */
export function detectUnit(headers, cols, rows, unitHint) {
  const headText = headers.map(norm).join(" ");
  if (/\(cm\)|\bcm\b|centimet/.test(headText) && !/\(in\)|inch/.test(headText)) return "cm";
  if (/\(in\)|\binch|inches/.test(headText) && !/\(cm\)|\bcm\b/.test(headText)) return "in";
  const vals = (keys) => {
    const out = [];
    cols.forEach((c, i) => {
      if (!keys.includes(String(c.key).replace(/_\d+$/, ""))) return;
      rows.forEach((r) => {
        const p = parseCell(r[i]);
        if (p.a != null) out.push(p.a);
      });
    });
    return out.sort((x, y) => x - y);
  };
  const median = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
  // Sterk bewijs: omtrekken en voetlengtes overlappen nooit tussen cm en inch
  const girth = median(vals(["bust", "waist", "hip", "thigh"]));
  if (girth != null) return girth >= 50 ? "cm" : "in";
  const foot = median(vals(["foot"]));
  if (foot != null) return foot >= 15 ? "cm" : "in";
  // Daarna de hint van de bron (AliExpress' actieve CM/IN-knop)
  if (unitHint === "cm" || unitHint === "in") return unitHint;
  // Zwak bewijs: lengtes (overlap 35–47 → bij twijfel cm)
  const len = vals(["length", "length_top", "length_bottom", "shoulder", "sleeve", "inseam", "outseam", "hem", "height"]);
  if (len.length) return len[len.length - 1] >= 50 ? "cm" : "in";
  return "cm";
}

/**
 * normalizeChart({headers, rows, unitHint}) → { columns, rows, unit, warnings }
 *   columns[i] = {key, kind, label}; rows[j] = {size, <key>: number|[a,b]|string}
 *   Lengtes staan daarna ALTIJD in cm (1 decimaal); inch-tabellen omgerekend.
 */
export function normalizeChart(input) {
  const headers = (input.headers || []).map((h) => String(h == null ? "" : h).trim());
  const rawRows = (input.rows || []).map((r) => (Array.isArray(r) ? r.map((c) => String(c == null ? "" : c).trim()) : []));
  const warnings = [];
  let cols = headers.map((h) => columnFor(h) || { key: "x_col", kind: "unknown", label: h });

  // Dubbele keys uniek maken (twee "Length"-kolommen → length, length_2)
  const seen = {};
  cols = cols.map((c) => {
    if (!c) return c;
    if (!has(seen, c.key)) {
      seen[c.key] = 1;
      return c;
    }
    seen[c.key] += 1;
    return { ...c, key: `${c.key}_${seen[c.key]}`, label: `${c.label} ${seen[c.key]}` };
  });

  // Geen maatlabel-kolom? Dan is de eerste kolom het label (AliExpress zet
  // het label altijd vooraan, vetgedrukt).
  let sizeIdx = cols.findIndex((c) => c.kind === "size");
  if (sizeIdx < 0 && cols.length) {
    sizeIdx = 0;
    cols[0] = { key: "size", kind: "size", label: "Size" };
    warnings.push("geen 'Size'-kop gevonden — eerste kolom als maatlabel gebruikt");
  }

  // Onbekende kolommen: numeriek → als lengte behandelen, anders tekst
  cols = cols.map((c, i) => {
    if (c.kind !== "unknown") return c;
    const numeric = rawRows.filter((r) => parseCell(r[i]).a != null).length;
    return { ...c, kind: numeric >= Math.max(1, rawRows.length * 0.6) ? "length" : "text" };
  });

  const unit = detectUnit(headers, cols, rawRows, input.unitHint);

  const rows = [];
  for (const r of rawRows) {
    const label = String(r[sizeIdx] || "").trim();
    if (!label) continue;
    const row = { size: label };
    cols.forEach((c, i) => {
      if (i === sizeIdx) return;
      const cell = r[i];
      if (cell == null || cell === "") return;
      if (c.kind === "length") {
        const p = parseCell(cell);
        if (p.a == null) return;
        const conv = (n) => (unit === "in" ? inToCm(n) : round1(n));
        row[c.key] = p.b != null ? [conv(p.a), conv(p.b)] : conv(p.a);
      } else if (c.kind === "mass") {
        const p = parseCell(cell);
        if (p.a == null) return;
        const toKg = (n) => (/\blb|pound/i.test(String(cell)) ? round1(n * 0.4536) : round1(n));
        row[c.key] = p.b != null ? [toKg(p.a), toKg(p.b)] : toKg(p.a);
      } else {
        row[c.key] = String(cell).trim();
      }
    });
    rows.push(row);
  }
  const columns = cols.filter((c, i) => i === sizeIdx || rows.some((r) => has(r, c.key)));
  // size-kolom altijd vooraan
  columns.sort((a, b) => (a.kind === "size" ? -1 : b.kind === "size" ? 1 : 0));
  if (!rows.length) warnings.push("tabel zonder rijen");
  return { columns, rows, unit, warnings };
}

/* =========================================================================
   3. MAATLABELS — normaliseren, sorteren, product-maten vinden
   ========================================================================= */

const LETTER_ALIAS = {
  XXS: "2XS", XXXS: "3XS", XS: "XS", S: "S", M: "M", L: "L", XL: "XL",
  XXL: "2XL", XXXL: "3XL", XXXXL: "4XL", XXXXXL: "5XL", XXXXXXL: "6XL",
  "1XL": "XL", "2XL": "2XL", "3XL": "3XL", "4XL": "4XL", "5XL": "5XL", "6XL": "6XL",
  SMALL: "S", MEDIUM: "M", LARGE: "L", "X-SMALL": "XS", "X-LARGE": "XL", "XX-LARGE": "2XL",
  "EXTRA SMALL": "XS", "EXTRA LARGE": "XL",
};
const LETTER_ORDER = ["3XS", "2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const ONE_SIZE_RE = /^(one\s*size|onesize|free\s*size|os|uni|universal|one size fits (all|most))$/i;

/** "xxl" → "2XL", " 8 " → "8", "US 8" → "8", "One size" → "ONE SIZE" */
export function normalizeSizeLabel(raw) {
  let s = String(raw == null ? "" : raw).trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return "";
  if (ONE_SIZE_RE.test(s)) return "ONE SIZE";
  // "S (US 4)" / "M - US 6" → alleen het letterdeel vóór de haak
  const paren = s.match(/^([0-9A-Z\-\/.]+)\s*[\(\-–]/);
  if (paren && has(LETTER_ALIAS, paren[1])) s = paren[1];
  s = s.replace(/^(US|EU|UK|AU|AUS|SIZE|MAAT)\s*:?\s*/, "").trim();
  if (has(LETTER_ALIAS, s)) return LETTER_ALIAS[s];
  const num = s.match(/^(\d{1,3}(?:\.5)?)(?:\s*\/\s*(\d{1,3}(?:\.5)?))?$/);
  if (num) return num[2] ? `${Number(num[1])}/${Number(num[2])}` : String(Number(num[1]));
  return s;
}

export function sizeSortKey(label) {
  const n = normalizeSizeLabel(label);
  const li = LETTER_ORDER.indexOf(n);
  if (li >= 0) return li;
  const num = parseFloat(n);
  if (!isNaN(num)) return 100 + num;
  if (n === "ONE SIZE") return 999;
  return 500;
}

/** Vind de Size-optie van een Shopify-product → { name, values[] } (values in kiezer-volgorde) */
export function findSizeOption(product) {
  const options = product.options || [];
  const variants = product.variants || [];
  const valuesOf = (idx) => {
    const key = `option${idx + 1}`;
    const out = [];
    for (const v of variants) {
      const val = v[key];
      if (val != null && val !== "" && !out.includes(String(val))) out.push(String(val));
    }
    return out;
  };
  let idx = options.findIndex((o) => /^(size|sizes|maat|größe|taille|talla|taglia)$/i.test(String(o.name || "").trim()));
  if (idx < 0) {
    // Geen "Size"-naam: de optie waarvan de waarden op maten lijken
    idx = options.findIndex((o, i) => {
      const vals = valuesOf(i);
      if (!vals.length) return false;
      const hits = vals.filter((v) => {
        const n = normalizeSizeLabel(v);
        return LETTER_ORDER.includes(n) || n === "ONE SIZE" || /^\d{1,3}(\.5)?(\/\d{1,3}(\.5)?)?$/.test(n);
      }).length;
      return hits >= vals.length * 0.8;
    });
  }
  if (idx < 0) {
    const single = variants.length === 1 && /one size|free size/i.test(String(variants[0].title || ""));
    return { name: null, values: single ? ["One Size"] : [] };
  }
  return { name: options[idx].name, values: valuesOf(idx) };
}

export function genderOf(product) {
  const tags = String(product.tags || "").toLowerCase();
  const title = String(product.title || "").toLowerCase();
  if (/(^|,)\s*men\s*(,|$)/.test(tags) || /\bmen'?s\b|\bmale\b/.test(title)) return "men";
  if (/(^|,)\s*women\s*(,|$)/.test(tags) || /\bwomen'?s\b|\bladies\b|\bfemale\b/.test(title)) return "women";
  return "women";
}


/* =========================================================================
   3b. PRODUCTSOORT (kind) — bepaalt welke maten in een tabel THUISHOREN
   Een blouse zonder "inseam", een rok zonder "bust", schoenen alleen
   voetlengte. Deterministisch op titel + product_type; onbekende titels
   kunnen door de AI-classifier (lib/sizeguide-ai.js) worden aangevuld.
   ========================================================================= */

export const KINDS = ["shoes", "bra", "accessory", "set", "skirt", "bottoms", "dress", "swim", "outerwear", "top", "unknown"];
export const KIND_LABEL = {
  shoes: "Schoenen", bra: "BH's", accessory: "Accessoires", set: "Sets / jumpsuits", skirt: "Rokken",
  bottoms: "Broeken / shorts", dress: "Jurken", swim: "Swim / bodysuits", outerwear: "Jassen / blazers",
  top: "Tops / truien / shirts", unknown: "Onbekend",
};

// Volgorde telt: specifiek vóór algemeen ("Sweater Dress" → dress, "Maxi Skirt" → skirt, "Pant Set" → set)
const KIND_RULES = [
  // "flats" alleen meervoud: "Flat Front"/"Flat Sole" komt ook in kleding- en
  // schoentitels voor; echte schoenen hebben altijd nog een ander schoenwoord.
  { kind: "shoes", re: /\b(boots?|booties|heels?|sneakers?|sandals?|flats|ballet flats?|mules?|loafers?|pumps?|shoes?|footwear|trainers?|slides?|wedges?|espadrilles?|mary jane|oxfords?|brogues?|clogs?|slippers?|moccasins?)\b/ },
  { kind: "bra", re: /\b(bras?|bralettes?)\b/ },
  { kind: "set", re: /\b(jumpsuits?|rompers?|playsuits?|overalls?|dungarees|co-?ords?|two-?piece|2-?piece|3-?piece|three-?piece|sets?|tracksuits?|suits?|pajamas?|pyjamas?|pjs?|loungewear)\b/ },
  { kind: "skirt", re: /\b(skirts?|skorts?)\b/ },
  { kind: "bottoms", re: /\b(pants?|trousers?|jeans?|denims?|leggings?|jeggings?|joggers?|sweatpants?|shorts|culottes?|chinos?|cargos?|slacks|capris?|palazzos?|flares?|wide-?legs?|bermudas?)\b/ },
  { kind: "dress", re: /\b(dress(es)?|gowns?|sundress(es)?|kaftans?|caftans?|maxi|midi|mini)\b/ },
  { kind: "swim", re: /\b(swim\w*|bikinis?|swimsuits?|bathing suits?|beachwear|cover-? ?ups?|bodysuits?|lingerie|corsets?|bustiers?|shapewear|teddy|teddies|babydolls?)\b/ },
  { kind: "outerwear", re: /\b(jackets?|coats?|blazers?|trench(es)?|parkas?|puffers?|overcoats?|peacoats?|anoraks?|windbreakers?|vests?|gilets?|ponchos?|capes?|shackets?|bombers?|raincoats?)\b/ },
  { kind: "top", re: /\b(tops?|blouses?|shirts?|t-?shirts?|tees?|tanks?|camis?|camisoles?|sweaters?|jumpers?|cardigans?|hoodies?|sweatshirts?|pullovers?|knits?|knitwear|flannels?|polos?|henleys?|tunics?|crops?|turtlenecks?|bodices?|kimonos?)\b/ },
  // Accessoires als LAATSTE: woorden als ring/cap/tie/belt zitten ook in
  // kledingtitels ("Metal Ring", "Cap Sleeve", "Wrap Tie", "Belted") — een
  // kledingwoord wint altijd.
  { kind: "accessory", re: /\b(bags?|handbags?|totes?|backpacks?|clutch(es)?|wallets?|purses?|belts?|hats?|caps?|beanies?|scarf|scarves|gloves?|mittens?|socks?|jewelry|jewellery|necklaces?|earrings?|bracelets?|rings?|sunglasses|watch(es)?|umbrellas?|headbands?|ties?|bow ?ties?|cufflinks?|keychains?)\b/ },
];

export function kindOf(productType, title) {
  const s = norm(title) + " " + norm(productType);
  for (const r of KIND_RULES) if (r.re.test(s)) return r.kind;
  return "unknown";
}

/* Welke MAATKOLOMMEN horen bij welke soort (AliExpress-tabellen worden
   hierop gecontroleerd; standaardtabellen worden hiermee opgebouwd).
   allow = toegestane maatkolommen · need = minstens één hiervan · std = de
   kolommen van de standaardtabel (dames / heren). */
const ANY_CLOTHING = ["bust", "waist", "hip", "shoulder", "sleeve", "length", "length_top", "length_bottom", "hem", "collar", "cuff", "inseam", "outseam", "thigh", "height", "weight", "width"];
export const KIND_COLUMNS = {
  top: { allow: ["bust", "waist", "hip", "shoulder", "sleeve", "length", "length_top", "hem", "collar", "cuff", "height", "weight", "width"], need: ["bust", "shoulder", "length"], std: { women: ["bust", "waist"], men: ["bust", "waist"] } },
  outerwear: { allow: ["bust", "waist", "hip", "shoulder", "sleeve", "length", "length_top", "hem", "collar", "cuff", "height", "weight", "width"], need: ["bust", "shoulder", "length"], std: { women: ["bust", "waist", "hip"], men: ["bust", "waist"] } },
  dress: { allow: ["bust", "waist", "hip", "shoulder", "sleeve", "length", "hem", "height", "weight", "width"], need: ["bust", "waist", "hip", "length"], std: { women: ["bust", "waist", "hip"], men: ["bust", "waist"] } },
  skirt: { allow: ["waist", "hip", "length", "length_bottom", "hem", "thigh", "height", "weight", "width"], need: ["waist", "hip", "length"], std: { women: ["waist", "hip"], men: ["waist", "hip"] } },
  bottoms: { allow: ["waist", "hip", "thigh", "inseam", "outseam", "length", "length_bottom", "hem", "cuff", "height", "weight", "width"], need: ["waist", "hip", "inseam", "length"], std: { women: ["waist", "hip"], men: ["waist", "hip"] } },
  set: { allow: ANY_CLOTHING, need: ["bust", "waist", "hip", "length"], std: { women: ["bust", "waist", "hip"], men: ["bust", "waist"] } },
  swim: { allow: ["bust", "waist", "hip", "length", "sleeve", "height", "weight", "width"], need: ["bust", "waist", "hip"], std: { women: ["bust", "waist", "hip"], men: ["bust", "waist"] } },
  shoes: { allow: ["foot", "heel", "width", "height"], need: ["foot"], std: null },
  bra: { allow: ["bust", "waist", "width"], need: [], std: null },
  accessory: { allow: [...ANY_CLOTHING, "foot", "heel"], need: [], std: null },
  unknown: { allow: [...ANY_CLOTHING, "foot", "heel"], need: [], std: { women: ["bust", "waist", "hip"], men: ["bust", "waist"] } },
};

const baseKey = (k) => String(k || "").replace(/_\d+$/, "");

/** Maatkolommen van een tabel toetsen aan de productsoort → { forbidden[], missingNeed } */
export function columnsForKind(columns, kind) {
  const rule = KIND_COLUMNS[kind] || KIND_COLUMNS.unknown;
  const measure = (columns || []).filter((c) => c.kind === "length" || c.kind === "mass").map((c) => baseKey(c.key));
  const known = measure.filter((k) => !k.startsWith("x_"));
  const forbidden = known.filter((k) => !rule.allow.includes(k));
  const missingNeed = rule.need.length > 0 && known.length > 0 && !known.some((k) => rule.need.includes(k));
  return { forbidden: [...new Set(forbidden)], missingNeed };
}

/**
 * checkGuide(guide, product, market) → { level: "ok"|"warn"|"error"|"missing"|"skip", issues[], kind, standard }
 *   product = productSummary() (met kind). Gebruikt door de Store Doctor én de "Check alles"-knop.
 */
export function checkGuide(guide, product, market) {
  const kind = product.kind || kindOf(null, product.title);
  const sizes = product.sizes || [];
  if (!sizes.length || kind === "accessory" || kind === "bra") {
    return { level: "skip", issues: [], kind, standard: false, reason: !sizes.length ? "geen maten" : "geen maattabel nodig" };
  }
  if (!guide || typeof guide !== "object" || !Array.isArray(guide.rows) || !Array.isArray(guide.columns)) {
    return { level: "missing", issues: ["geen maattabel"], kind, standard: false };
  }
  const issues = [];
  let level = "ok";
  const bump = (lv) => {
    if (lv === "error" || level === "ok") level = lv;
  };
  const cf = columnsForKind(guide.columns, kind);
  if (cf.forbidden.length) {
    issues.push(`kolom(men) ${cf.forbidden.map((k) => COLUMN_LABEL[k] || k).join(", ")} horen niet bij ${KIND_LABEL[kind] || kind}`);
    bump("error");
  }
  if (cf.missingNeed) {
    issues.push(`mist een kernmaat voor ${KIND_LABEL[kind] || kind} (${(KIND_COLUMNS[kind] || KIND_COLUMNS.unknown).need.map((k) => COLUMN_LABEL[k] || k).join("/")})`);
    bump("warn");
  }
  if (kind === "shoes" && guide.family && guide.family !== "shoes") {
    issues.push("kledingtabel op een schoen");
    bump("error");
  }
  if (kind !== "shoes" && guide.family === "shoes") {
    issues.push("schoenentabel op kleding");
    bump("error");
  }
  // Maten: elke variantmaat moet een rij hebben
  // Maten: de website is leidend — elke variantmaat een rij, en geen rijen
  // voor maten die niet (meer) verkocht worden. Beide kanten = fout.
  const rowSizes = new Set(guide.rows.map((r) => normalizeSizeLabel(r.size)));
  const missing = sizes.filter((s) => !rowSizes.has(normalizeSizeLabel(s)));
  if (missing.length) {
    issues.push(`variantmaten zonder rij: ${missing.slice(0, 8).join("/")}`);
    bump("error");
  }
  const sizeSet = new Set(sizes.map(normalizeSizeLabel));
  const extra = guide.rows.filter((r) => !sizeSet.has(normalizeSizeLabel(r.size)));
  if (extra.length) {
    issues.push(`rijen voor maten die niet op de site staan: ${extra.map((r) => r.size).slice(0, 8).join("/")}`);
    bump("error");
  }
  // Geslacht en markt
  const g = String(guide.gender || "").toLowerCase();
  if (g && product.gender && g !== product.gender) {
    issues.push(`tabel is ${guide.gender}, product is ${product.gender === "men" ? "Men" : "Women"}`);
    bump("warn");
  }
  if (market && guide.market && guide.market !== market) {
    issues.push(`tabel voor ${guide.market}, store staat op ${market}`);
    bump("warn");
  }
  // Lege maatkolommen
  const measureCols = guide.columns.filter((c) => c.kind === "length");
  if (!measureCols.length) {
    issues.push("geen enkele maat in de tabel");
    bump("error");
  }
  return { level, issues, kind, standard: guide.status === "standard" };
}

/**
 * imageStemKey(src) — bestandsnaam-sleutel van een Shopify-CDN-foto, zonder
 * extensie, formaat-suffix (_1024x1024) en Shopify's dubbele-naam-suffix (uuid).
 * Onze producten zijn geïmporteerd van concurrent-stores: Shopify houdt de
 * originele bestandsnaam, dus dezelfde sleutel = dezelfde bronfoto.
 */
export function imageStemKey(src) {
  try {
    const u = new URL(String(src));
    let name = decodeURIComponent(u.pathname.split("/").pop() || "").toLowerCase();
    name = name.replace(/\.(jpe?g|png|webp|gif|avif|heic)$/i, "");
    name = name.replace(/_(\d+x\d*|\d*x\d+|small|medium|large|grande|compact|icon|master|original)(@\dx)?$/i, "");
    name = name.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "");
    name = name.replace(/[^a-z0-9]+/g, "");
    return name.length >= 4 ? name : "";
  } catch {
    return "";
  }
}

/**
 * Alleen "specifieke" bestandsnamen tellen als bewijs: generieke namen
 * (original, black, image, 1, 2) komen op elke store voor en zouden het
 * verkeerde bronproduct opleveren. Gewicht 2 = vrijwel uniek (AliExpress/
 * MD5-achtige naam), 1 = specifiek genoeg, 0 = generiek (negeren).
 */
export function stemWeight(stem) {
  const s = String(stem || "");
  const digits = (s.match(/\d/g) || []).length;
  if (s.length >= 20 && digits >= 8) return 2;
  if (s.length >= 10 && digits >= 3) return 1;
  return 0;
}

/** SKU's die een product echt identificeren (géén AliExpress-optie-ID's als "14:193;5:361386") */
export function specificSku(sku) {
  const s = String(sku || "").trim();
  if (s.length < 6) return false;
  if (/^\d+:\d+/.test(s) || /^\d+:\d+#/.test(s)) return false;
  if (/^[a-z]{1,3}$/i.test(s)) return false;
  return true;
}

const CHART_IMG = /size|chart|maat|measure|cm\b|inch|guide|tabel|dimension/i;

/** Samenvatting van een product zoals de module 'm nodig heeft (client + server) */
export function productSummary(product) {
  const size = findSizeOption(product);
  const imgs = product.images || [];
  const images = imgs.map((im) => im.src).filter(Boolean);
  const imageKeys = [...new Set(images.map(imageStemKey).filter((k) => k && stemWeight(k) > 0))].slice(0, 12);
  const skus = [...new Set((product.variants || []).map((v) => String(v.sku || "").trim()).filter(specificSku))].slice(0, 12);
  // Eigen foto's die eruitzien als een maattabel (bestandsnaam/alt) — gratis kandidaat
  const chartImages = imgs.filter((im) => im && im.src && (CHART_IMG.test(im.alt || "") || CHART_IMG.test(decodeURIComponent(String(im.src).split("/").pop() || "")))).map((im) => im.src).slice(0, 3);
  return {
    id: product.id,
    title: product.title || "",
    handle: product.handle || "",
    status: product.status || "",
    family: familyOf(product.product_type, product.title),
    kind: kindOf(product.product_type, product.title),
    gender: genderOf(product),
    sizeOption: size.name,
    sizes: size.values,
    image: images[0] || null,
    images: images.slice(0, 2),
    imageKeys,
    skus,
    chartImages,
  };
}

/* =========================================================================
   4. MARKT-KOLOM — EU → US / AU / UK (zelfde formules als lib/sizes.js)
   ========================================================================= */

// offsets per (familie, geslacht) vanaf EU; markt → welk systeem we tonen
const MARKET_SYSTEM = { USA: "us", CAN: "us", "AUS+NZ": "au", UK: "uk" };
const EU_OFFSETS = {
  clothing: {
    women: { us: -32, au: -28, uk: -28 },
    men: { us: -10, au: -10, uk: -10 }, // borstmaat in inches (EU 50 = 40)
  },
  bottoms: {
    women: { us: -32, au: -28, uk: -28 },
    men: { us: -16, au: -16, uk: -16 }, // taille in inches (EU 50 = 34)
  },
  shoes: {
    women: { us: -31, au: -31, uk: -33 },
    men: { us: -33, au: -34, uk: -34 },
  },
};

function euRange(family, gender) {
  if (family === "shoes") return [34, 50];
  if (family === "bottoms" && gender === "men") return [44, 64];
  if (gender === "men") return [42, 64];
  return [30, 60];
}

/** "40/42" (EU, dames) → "8/10" (US); null als het niet ondubbelzinnig kan */
export function euToMarket(euText, family, gender, market) {
  const sys = MARKET_SYSTEM[market] || "us";
  const fam = family === "bra" ? null : has(EU_OFFSETS, family) ? family : "clothing";
  if (!fam) return null;
  const gen = gender === "men" ? "men" : "women";
  const off = EU_OFFSETS[fam][gen][sys];
  const [lo, hi] = euRange(fam, gen);
  const parts = String(euText || "").split(/[\/\-–]/).map((x) => parseFloat(x.replace(",", ".")));
  if (!parts.length || parts.some((n) => isNaN(n) || n < lo || n > hi)) return null;
  const fmt = (n) => {
    const r = Math.round(n * 2) / 2;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };
  return parts.map((n) => fmt(n + off)).join("/");
}

export function marketColumn(market) {
  const sys = MARKET_SYSTEM[market] || "us";
  return { key: sys, label: sys.toUpperCase() };
}

/* =========================================================================
   5. UITLIJNEN — tabelrijen ↔ de maten van het product
   ========================================================================= */

/**
 * alignRows(chart, storeSizes, {family, gender, market})
 * → { rows: [{size (store-label), src (chart-row), marketSize}], missing[], mode }
 *   mode: "label" (zelfde labels) · "number" (store = marktnummers, chart via EU/US)
 *         · "none"
 */
export function alignRows(chart, storeSizes, ctx = {}) {
  const sizes = (storeSizes || []).map((s) => String(s));
  const byLabel = new Map();
  for (const r of chart.rows) {
    const n = normalizeSizeLabel(r.size);
    if (n && !byLabel.has(n)) byLabel.set(n, r);
  }
  const sys = marketColumn(ctx.market).key;
  // marktnummer per chart-rij (uit US/AU/UK-kolom als aanwezig, anders EU)
  const marketOf = (r) => {
    if (r[sys]) {
      const v = normalizeSizeLabel(r[sys]);
      return v || null;
    }
    if (r.eu) return euToMarket(r.eu, ctx.family, ctx.gender, ctx.market);
    return null;
  };

  const out = [];
  const missing = [];
  let labelHits = 0;
  let numberHits = 0;
  for (const s of sizes) {
    const n = normalizeSizeLabel(s);
    let src = byLabel.get(n) || null;
    if (src) labelHits++;
    if (!src && /^\d{1,3}(\.5)?$/.test(n)) {
      // store-label is een nummer → rij zoeken waarvan het marktnummer (of
      // een deel van de range "8/10") gelijk is
      src = chart.rows.find((r) => {
        const m = marketOf(r);
        return m && m.split("/").includes(n);
      }) || null;
      if (src) numberHits++;
    }
    if (!src) {
      missing.push(s);
      continue;
    }
    out.push({ size: s, src, marketSize: marketOf(src) });
  }
  const mode = !out.length ? "none" : numberHits > labelHits ? "number" : "label";
  return { rows: out, missing, mode };
}

/* =========================================================================
   6. SANITY + CIJFER
   ========================================================================= */

const BANDS_CM = {
  bust: [40, 200], waist: [35, 200], hip: [40, 220], thigh: [25, 110], shoulder: [20, 80],
  sleeve: [5, 120], inseam: [15, 130], outseam: [25, 160], hem: [20, 250], cuff: [5, 60],
  collar: [20, 70], foot: [17, 36], heel: [0, 25], height: [90, 230],
  length: [10, 220], length_top: [10, 120], length_bottom: [10, 160], width: [5, 250],
};
const bandFor = (key) => BANDS_CM[key.replace(/_\d+$/, "")] || [1, 400];
const first = (v) => (Array.isArray(v) ? v[0] : v);

/** → { issues[], hard } — hard = buiten de fysieke band (dan geen tabel) */
export function sanityCheck(columns, rows) {
  const issues = [];
  let hard = false;
  const measureCols = columns.filter((c) => c.kind === "length");
  const ordered = [...rows].sort((a, b) => sizeSortKey(a.size) - sizeSortKey(b.size));
  for (const c of measureCols) {
    const [lo, hi] = bandFor(c.key);
    let prev = null;
    let dips = 0;
    const present = [];
    for (const r of ordered) {
      if (!has(r, c.key)) continue;
      const v = first(r[c.key]);
      present.push(v);
      if (v < lo || v > hi) {
        issues.push(`${c.label} valt buiten de band (${r.size}: ${v} cm)`);
        hard = true;
      }
      if (prev != null && v < prev - 0.6) dips++;
      prev = v;
    }
    if (dips > 0) issues.push(`${c.label} loopt niet op met de maat (${dips}× kleiner dan de maat ervoor)`);
    if (present.length >= 3 && new Set(present).size === 1 && /bust|waist|hip/.test(c.key)) {
      issues.push(`${c.label} is voor elke maat gelijk`);
    }
  }
  return { issues, hard };
}

/**
 * scoreGuide({confidence, coverage, missing, issues, hard, measureCols, mode})
 * → 1–10, deterministisch. ≥8 groen · 6–7,9 amber · <6 rood.
 */
export function scoreGuide(f) {
  let s = 10;
  const conf = f.confidence == null ? 1 : f.confidence;
  if (conf < 0.9) s -= 1;
  if (conf < 0.8) s -= 2;
  s -= Math.min(4, (f.missing || 0) * 2);
  const softIssues = (f.issues || []).length;
  s -= Math.min(4, softIssues * 1.5);
  if (f.hard) s = Math.min(s, 4);
  if (!f.measureCols) s = Math.min(s, 3);
  else if (f.measureCols === 1) s -= 2;
  else if (f.measureCols === 2) s -= 0.5;
  if (f.mode === "number") s -= 0.5;
  return Math.max(1, Math.round(s * 10) / 10);
}

export function verdictFor(score) {
  if (score >= 8) return "green";
  if (score >= 6) return "amber";
  return "red";
}

/* =========================================================================
   7. BUILD — van chart + product naar het metafield-JSON
   ========================================================================= */

const UNIT_DEFAULT = { USA: "in", CAN: "in", UK: "cm", "AUS+NZ": "cm" };

function familyLabelFix(columns, gender) {
  // Heren: "Bust" heet "Chest"
  return columns.map((c) => (c.key === "bust" && gender === "men" ? { ...c, label: "Chest" } : c));
}

/**
 * buildGuide({chart, product, market, source, confidence})
 *   chart   = normalizeChart()-resultaat
 *   product = productSummary()
 * → { ok, guide, score, verdict, issues, missing, mode }
 */
export function buildGuide({ chart, product, market, source = "aliexpress", confidence = null }) {
  const ctx = { family: product.family, gender: product.gender, market };
  const sizes = product.sizes || [];
  if (!sizes.length) return { ok: false, reason: "product heeft geen maten (geen Size-optie)", issues: [] };
  if (!chart || !chart.rows || !chart.rows.length) return { ok: false, reason: "lege tabel", issues: [] };

  const al = alignRows(chart, sizes, ctx);
  // REGEL (Justin, 03-09): de maten op de website zijn leidend — de tabel
  // bevat precies de variantmaten, niet meer en niet minder. Dekt de
  // leverancierstabel niet elke maat, dan geen tabel (vangnet neemt het over).
  if (al.mode === "none" || al.missing.length) {
    return {
      ok: false,
      reason: al.mode === "none"
        ? `tabelmaten (${chart.rows.map((r) => r.size).slice(0, 6).join("/")}) passen niet op de productmaten (${sizes.slice(0, 6).join("/")})`
        : `leverancierstabel mist maat ${al.missing.join("/")} — tabel moet exact de websitematen bevatten`,
      issues: [],
      missing: al.missing,
    };
  }

  const mcol = marketColumn(market);
  const measureCols = chart.columns.filter((c) => c.kind === "length" || c.kind === "mass");
  const textCols = chart.columns.filter((c) => c.kind === "text" && !["us", "au", "uk", "eu"].includes(c.key) && c.key !== "age");
  const hasMarket = al.rows.some((r) => r.marketSize);

  const columns = [{ key: "size", kind: "size", label: "Size" }];
  if (hasMarket) columns.push({ key: mcol.key, kind: "text", label: mcol.label });
  // EU alleen tonen buiten de US-markten (voor USA/CAN is EU ruis)
  if (market !== "USA" && market !== "CAN" && chart.columns.some((c) => c.key === "eu")) {
    columns.push({ key: "eu", kind: "text", label: "EU" });
  }
  for (const c of measureCols) columns.push({ key: c.key, kind: c.kind, label: c.label });
  for (const c of textCols) columns.push({ key: c.key, kind: "text", label: c.label });

  const rows = al.rows.map((r) => {
    const row = { size: r.size };
    if (hasMarket && r.marketSize) row[mcol.key] = r.marketSize;
    if (columns.some((c) => c.key === "eu") && r.src.eu) row.eu = r.src.eu;
    for (const c of [...measureCols, ...textCols]) if (has(r.src, c.key)) row[c.key] = r.src[c.key];
    return row;
  });

  const san = sanityCheck(columns, rows);
  // Soort-controle: een "inseam" op een blouse of "bust" op een rok betekent
  // vrijwel altijd een verkeerde match → hard rood (vangnet neemt het over).
  const kind = product.kind || kindOf(null, product.title);
  const cf = columnsForKind(columns, kind);
  if (cf.forbidden.length) {
    san.issues.push(`kolom(men) ${cf.forbidden.map((k) => COLUMN_LABEL[k] || k).join(", ")} horen niet bij ${KIND_LABEL[kind] || kind} — verkeerd product?`);
    san.hard = true;
  } else if (cf.missingNeed) {
    san.issues.push(`mist een kernmaat voor ${KIND_LABEL[kind] || kind}`);
  }
  const score = scoreGuide({
    confidence,
    missing: al.missing.length,
    issues: san.issues,
    hard: san.hard,
    measureCols: measureCols.filter((c) => c.kind === "length").length,
    mode: al.mode,
  });
  const verdict = verdictFor(score);
  const guide = {
    v: SG_VERSION,
    status: source === "image" ? "manual" : source === "source" ? "source" : "aliexpress",
    kind,
    fit: "true", // fit-balk in de pop-up: "small" | "true" | "large"
    market,
    family: product.family,
    gender: product.gender === "men" ? "Men" : "Women",
    unit_default: UNIT_DEFAULT[market] || "in",
    note: "Garment measurements, taken flat — allow 0.5–1 in (1–2 cm) variance. Between two sizes? Choose the larger one.",
    columns: familyLabelFix(columns, product.gender),
    rows,
    how_to_measure: measureCols
      .filter((c) => has(HOW_TO_MEASURE, c.key.replace(/_\d+$/, "")))
      .map((c) => ({ key: c.key, text: HOW_TO_MEASURE[c.key.replace(/_\d+$/, "")] })),
    updated: new Date().toISOString().slice(0, 10),
  };
  return { ok: true, guide, score, verdict, issues: san.issues, missing: al.missing, mode: al.mode };
}

/* =========================================================================
   8. STANDAARDTABELLEN (vangnet) — US-conventies, lichaamsmaten in cm
   ========================================================================= */

// Dames: [bust, waist, hip] als [min,max] cm  + US-nummers
const STD_WOMEN = {
  "2XS": { us: "00", bust: [76, 79], waist: [56, 59], hip: [81, 84] },
  XS: { us: "0/2", bust: [81, 84], waist: [61, 64], hip: [86, 89] },
  S: { us: "4/6", bust: [86, 89], waist: [66, 69], hip: [91, 94] },
  M: { us: "8/10", bust: [91, 94], waist: [71, 74], hip: [97, 99] },
  L: { us: "12/14", bust: [98, 102], waist: [77, 81], hip: [103, 107] },
  XL: { us: "16/18", bust: [105, 109], waist: [85, 89], hip: [110, 114] },
  "2XL": { us: "20/22", bust: [114, 119], waist: [94, 99], hip: [119, 124] },
  "3XL": { us: "24/26", bust: [124, 130], waist: [104, 109], hip: [130, 135] },
  "4XL": { us: "28", bust: [135, 140], waist: [114, 119], hip: [140, 145] },
  "5XL": { us: "30", bust: [145, 150], waist: [124, 129], hip: [150, 155] },
  "6XL": { us: "32", bust: [155, 160], waist: [134, 139], hip: [160, 165] },
};
// US-nummer → letter (dames)
const STD_WOMEN_BY_US = {};
for (const [letter, row] of Object.entries(STD_WOMEN)) {
  for (const n of row.us.split("/")) STD_WOMEN_BY_US[n] = letter;
}
// Heren: [chest, waist] cm + US-borstmaat (inches)
const STD_MEN = {
  "2XS": { us: "30/31", bust: [74, 79], waist: [61, 66] },
  XS: { us: "32/34", bust: [81, 86], waist: [66, 71] },
  S: { us: "35/37", bust: [89, 94], waist: [74, 79] },
  M: { us: "38/40", bust: [97, 102], waist: [81, 86] },
  L: { us: "41/43", bust: [104, 109], waist: [89, 94] },
  XL: { us: "44/46", bust: [112, 117], waist: [97, 102] },
  "2XL": { us: "47/49", bust: [119, 124], waist: [104, 109] },
  "3XL": { us: "50/52", bust: [127, 132], waist: [112, 117] },
  "4XL": { us: "53/55", bust: [135, 140], waist: [119, 124] },
  "5XL": { us: "56/58", bust: [142, 147], waist: [127, 132] },
  "6XL": { us: "59/61", bust: [150, 155], waist: [135, 140] },
};
// Schoenen: US → { eu, uk, foot cm }
const STD_SHOES_WOMEN = {
  2: { eu: "32", uk: "0", foot: 19.3 }, 2.5: { eu: "32.5", uk: "0.5", foot: 19.7 }, 3: { eu: "33", uk: "1", foot: 20.2 }, 3.5: { eu: "33.5", uk: "1.5", foot: 20.6 },
  4: { eu: "34", uk: "2", foot: 21.0 }, 4.5: { eu: "34.5", uk: "2.5", foot: 21.6 },
  5: { eu: "35", uk: "3", foot: 22.0 }, 5.5: { eu: "36", uk: "3.5", foot: 22.4 }, 6: { eu: "36.5", uk: "4", foot: 22.9 },
  6.5: { eu: "37", uk: "4.5", foot: 23.3 }, 7: { eu: "37.5", uk: "5", foot: 23.8 }, 7.5: { eu: "38", uk: "5.5", foot: 24.1 },
  8: { eu: "38.5", uk: "6", foot: 24.6 }, 8.5: { eu: "39", uk: "6.5", foot: 25.1 }, 9: { eu: "40", uk: "7", foot: 25.4 },
  9.5: { eu: "40.5", uk: "7.5", foot: 25.9 }, 10: { eu: "41", uk: "8", foot: 26.2 }, 10.5: { eu: "42", uk: "8.5", foot: 26.7 },
  11: { eu: "42.5", uk: "9", foot: 27.1 }, 11.5: { eu: "43", uk: "9.5", foot: 27.5 }, 12: { eu: "44", uk: "10", foot: 27.9 },
  12.5: { eu: "44.5", uk: "10.5", foot: 28.3 }, 13: { eu: "45", uk: "11", foot: 28.8 },
  13.5: { eu: "45.5", uk: "11.5", foot: 29.2 }, 14: { eu: "46", uk: "12", foot: 29.6 },
};
const STD_SHOES_MEN = {
  4: { eu: "36", uk: "3.5", foot: 22.5 }, 4.5: { eu: "36.5", uk: "4", foot: 22.9 }, 5: { eu: "37.5", uk: "4.5", foot: 23.3 },
  5.5: { eu: "38", uk: "5", foot: 23.7 },
  6: { eu: "39", uk: "5.5", foot: 24.1 }, 6.5: { eu: "39.5", uk: "6", foot: 24.6 }, 7: { eu: "40", uk: "6.5", foot: 25.0 },
  7.5: { eu: "40.5", uk: "7", foot: 25.4 }, 8: { eu: "41", uk: "7.5", foot: 25.8 }, 8.5: { eu: "42", uk: "8", foot: 26.2 },
  9: { eu: "42.5", uk: "8.5", foot: 26.7 }, 9.5: { eu: "43", uk: "9", foot: 27.1 }, 10: { eu: "44", uk: "9.5", foot: 27.5 },
  10.5: { eu: "44.5", uk: "10", foot: 27.9 }, 11: { eu: "45", uk: "10.5", foot: 28.3 }, 11.5: { eu: "45.5", uk: "11", foot: 28.8 },
  12: { eu: "46", uk: "11.5", foot: 29.2 }, 12.5: { eu: "46.5", uk: "12", foot: 29.6 }, 13: { eu: "47", uk: "12.5", foot: 30.0 },
  13.5: { eu: "47.5", uk: "13", foot: 30.4 }, 14: { eu: "48", uk: "13.5", foot: 30.8 }, 14.5: { eu: "48.5", uk: "14", foot: 31.2 },
  15: { eu: "49", uk: "14.5", foot: 31.6 }, 15.5: { eu: "49.5", uk: "15", foot: 32.0 }, 16: { eu: "50", uk: "15.5", foot: 32.4 },
  16.5: { eu: "50.5", uk: "16", foot: 32.8 }, 17: { eu: "51", uk: "16.5", foot: 33.2 },
};

/** Markt-label voor een standaardrij (US-conventie → AU/UK) */
function stdMarketLabel(usText, family, gender, market) {
  const sys = MARKET_SYSTEM[market] || "us";
  if (sys === "us") return usText;
  const fam = family === "shoes" ? "shoes" : family === "bottoms" ? "bottoms" : "clothing";
  const gen = gender === "men" ? "men" : "women";
  const off = EU_OFFSETS[fam][gen][sys] - EU_OFFSETS[fam][gen].us; // US → EU → markt
  return String(usText)
    .split("/")
    .map((x) => {
      const n = parseFloat(x);
      if (isNaN(n)) return x;
      const r = Math.round((n + off) * 2) / 2;
      return Number.isInteger(r) ? String(r) : r.toFixed(1);
    })
    .join("/");
}

/**
 * standardGuide(product, market) → { ok, guide, score, verdict, missing } | { ok:false, reason }
 * Vult de vaste US-conventietabel met de eigen variantmaten. Altijd status
 * "standard" + eigen note — nooit als leveranciersmaten gepresenteerd.
 */
export function standardGuide(product, market) {
  const sizes = product.sizes || [];
  if (!sizes.length) return { ok: false, reason: "product heeft geen maten" };
  const gender = product.gender === "men" ? "men" : "women";
  const kind = product.kind || kindOf(null, product.title);
  if (kind === "accessory") return { ok: false, reason: "accessoire — geen maattabel nodig" };
  const family = kind === "shoes" ? "shoes" : kind === "bra" ? "bra" : kind === "bottoms" || kind === "skirt" ? "bottoms" : product.family === "shoes" || product.family === "bra" ? product.family : "clothing";
  const mcol = marketColumn(market);
  const rows = [];
  const missing = [];
  let columns;

  if (family === "shoes") {
    const table = gender === "men" ? STD_SHOES_MEN : STD_SHOES_WOMEN;
    columns = [
      { key: "size", kind: "size", label: "Size" },
      { key: "us", kind: "text", label: "US" },
      { key: "eu", kind: "text", label: "EU" },
      { key: "uk", kind: "text", label: "UK" },
      { key: "foot", kind: "length", label: "Foot length" },
    ];
    for (const s of sizes) {
      const n = normalizeSizeLabel(s);
      // label is een marktnummer → naar US terugrekenen
      const off = EU_OFFSETS.shoes[gender][MARKET_SYSTEM[market] || "us"] - EU_OFFSETS.shoes[gender].us;
      const us = parseFloat(n) - off;
      const std = has(table, String(us)) ? table[String(us)] : null;
      if (!std) {
        missing.push(s);
        continue;
      }
      rows.push({ size: s, us: String(us), eu: std.eu, uk: std.uk, foot: std.foot });
    }
  } else if (family === "bra") {
    return { ok: false, reason: "geen standaardtabel voor bh's" };
  } else {
    const table = gender === "men" ? STD_MEN : STD_WOMEN;
    // Kolommen per productsoort: blouse = bust+waist, rok = waist+hips, jurk = alle drie …
    const kindRule = KIND_COLUMNS[kind] || KIND_COLUMNS.unknown;
    if (!kindRule.std) return { ok: false, reason: `geen standaardtabel voor ${KIND_LABEL[kind] || kind}` };
    const stdCols = kindRule.std[gender] || kindRule.std.women;
    columns = [
      { key: "size", kind: "size", label: "Size" },
      { key: mcol.key, kind: "text", label: mcol.label },
    ];
    for (const k of stdCols) {
      columns.push({ key: k, kind: "length", label: k === "bust" ? (gender === "men" ? "Chest" : "Bust") : k === "hip" ? "Hips" : COLUMN_LABEL[k] });
    }
    for (const s of sizes) {
      const n = normalizeSizeLabel(s);
      let letter = LETTER_ORDER.includes(n) ? n : null;
      const numLabel = parseFloat(n);
      // Broeken/jeans: een nummer is de taille in inches (dames 24–34, heren 28–40)
      if (!letter && family === "bottoms" && !isNaN(numLabel) && numLabel >= 22 && numLabel <= 50 && /^\d+$/.test(n)) {
        rows.push({ size: s, [mcol.key]: String(numLabel), waist: inToCm(numLabel) });
        continue;
      }
      // Dames-nummers zijn MARKT-nummers: in AUS+NZ/UK is "10" = US 6 → eerst
      // terug naar US (−4) en dan de letter opzoeken. De markt-kolom toont
      // het label zoals het op de site staat.
      const toUs = (x) => (MARKET_SYSTEM[market] === "us" || !MARKET_SYSTEM[market] ? String(Number(x)) : String(Number(x) - 4));
      if (!letter && gender === "women" && /^\d{1,2}$/.test(n) && has(STD_WOMEN_BY_US, toUs(n))) letter = STD_WOMEN_BY_US[toUs(n)];
      // Dames-bereik "8-10" / "12-14" / "16-18": nummers → letter(s); twee
      // verschillende letters → één rij met de buitengrenzen van beide.
      if (!letter && gender === "women" && /^\d{1,2}\s*[-–\/]\s*\d{1,2}$/.test(n)) {
        const parts = n.split(/[-–\/]/).map((x) => x.trim());
        const letters = parts.map((x) => STD_WOMEN_BY_US[toUs(x)]).filter(Boolean);
        if (letters.length === parts.length) {
          const lo = table[letters[0]];
          const hi = table[letters[letters.length - 1]];
          const row = { size: s, [mcol.key]: parts.map(Number).join("/") };
          for (const k of stdCols) if (lo[k] != null && hi[k] != null) row[k] = [lo[k][0], hi[k][1]];
          rows.push(row);
          continue;
        }
      }
      if (!letter && n === "ONE SIZE") {
        missing.push(s);
        continue;
      }
      const std = letter && has(table, letter) ? table[letter] : null;
      if (!std) {
        // Numerieke taille/borst-labels (broeken 28–40, herenjassen 36–48): het
        // label ís de maat in inches
        const num = parseFloat(n);
        if (!isNaN(num) && gender === "men" && num >= 32 && num <= 60) {
          rows.push({ size: s, [mcol.key]: String(num), bust: inToCm(num) });
          continue;
        }
        missing.push(s);
        continue;
      }
      const row = { size: s, [mcol.key]: /^\d{1,2}$/.test(n) && gender === "women" ? String(Number(n)) : stdMarketLabel(std.us, family, gender, market) };
      for (const k of stdCols) if (std[k] != null) row[k] = std[k];
      rows.push(row);
    }
    // alleen kolommen die ook echt gevuld zijn
    columns = columns.filter((c) => c.key === "size" || rows.some((r) => has(r, c.key)));
  }

  // Alle websitematen moeten een rij hebben — anders liever geen tabel dan een halve
  if (missing.length) {
    return { ok: false, reason: `geen standaardmaat voor ${missing.slice(0, 6).join("/")} — tabel moet exact de websitematen bevatten`, missing };
  }
  const guide = {
    v: SG_VERSION,
    status: "standard",
    kind,
    fit: "true",
    market,
    family,
    gender: gender === "men" ? "Men" : "Women",
    unit_default: UNIT_DEFAULT[market] || "in",
    note:
      family === "shoes"
        ? "Standard size conversion — measure your foot length and pick the matching size."
        : "Body measurements. Between two sizes? Choose the larger one.",
    columns,
    rows,
    how_to_measure: columns
      .filter((c) => c.kind === "length" && has(HOW_TO_MEASURE, c.key))
      .map((c) => ({ key: c.key, text: HOW_TO_MEASURE[c.key] })),
    updated: new Date().toISOString().slice(0, 10),
  };
  return { ok: true, guide, score: 8, verdict: "standard", missing: [], issues: [] };
}

/* =========================================================================
   9. WEERGAVE-HULP (tool-preview) — zelfde regels als de theme-snippet
   ========================================================================= */

export function formatCell(value, kind, unit) {
  if (value == null || value === "") return "";
  if (kind !== "length" && kind !== "mass") return String(value);
  const conv = (n) => {
    if (kind === "mass") return unit === "in" ? round1(n * 2.2046) : round1(n);
    return unit === "in" ? cmToIn(n) : round1(n);
  };
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(n));
  if (Array.isArray(value)) return `${fmt(conv(value[0]))}–${fmt(conv(value[1]))}`;
  return fmt(conv(value));
}

export function unitSuffix(kind, unit) {
  if (kind === "mass") return unit === "in" ? "lb" : "kg";
  if (kind === "length") return unit === "in" ? "in" : "cm";
  return "";
}
