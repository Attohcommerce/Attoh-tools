// MAATNOTATIE PER MARKT (03-11-2026) — niet "welk systeem" (dat doet
// lib/sizes.js: EU → US/AU) maar "hoe schrijft de lokale retailer het op".
// Bron: retail-onderzoek 03-11-2026, 65 bronnen (projectdoc 105).
//   USA/CAN  heren jeans/chino/shorts = taille in inches, kaal: 30 · 32 · 34
//            (Levi's, Old Navy, Gap, Abercrombie); dames = XS–XL of US 0–16,
//            dames jeans ook 24–34 taille
//   AUS+NZ   heren jeans/chino/shorts bij FASHION-retailers = kaal inches
//            28–40 (Cotton On, Target AU, Tarocash, Hallensteins NZ);
//            cm ALLEEN bij werkkleding/tradie (KingGee, Hard Yakka, Bisley:
//            77/82/87/92… met R/S/L) en pakken — en dan dubbel "87 (34")"
//            zoals Bisley/Allingtons; dames = even AU 6–18 voor jurken/rokken/
//            broeken/zwem (Target, Kmart, Showpo, Princess Polly, Jeanswest),
//            letters bij tops/knit/activewear. NZ = AU (EziBuy "NZ/AU").
//   UK       zoals USA voor heren (inches), dames UK 6–18 of letters
// Lettermaten overal gelijk geschreven: XS S M L XL XXL XXXL 4XL 5XL (geen
// "2XL"/"XX-Large"/"Size M"/"US M"-mengsels).
// NOOIT automatisch: letters → AU-nummer (twee scholen: jong XS=6/S=8/M=10,
// mainstream XS=8/S=10/M=12 — gokken = retouren). Wat niet ondubbelzinnig
// is, blijft staan en komt als "handmatig" in de check.

const norm = (s) => String(s || "").toLowerCase();

/* ---------- kledinggroep (fijner dan familyOf) ---------- */
const RE = {
  shoes: /\b(boots?|booties|heels?|sneakers?|sandals?|flats?|mules?|loafers?|pumps?|shoes?|footwear|trainers?|slides?|wedges?|espadrilles?|mary jane|oxfords?|brogues?|clogs?|slippers?|moccasins?)\b/,
  bra: /\b(bras?|bralettes?|lingerie)\b/,
  swim: /\b(swim\w*|bikini|boardshorts?|swimming trunks|trunks)\b/,
  workwear: /\b(work ?(shorts?|pants?|trousers?|wear)|workwear|tradie|hi-?vis|cargo work|utility work|work ?boots?)\b/,
  jeans: /\b(jeans?|denim (pants?|trousers?|shorts))\b/,
  shorts: /\bshorts\b/,
  pants: /\b(pants?|trousers?|chinos?|joggers?|slacks|culottes?|sweatpants?|trackpants?|track pants?|cargos?)\b/,
  leggings: /\b(leggings?|tights|yoga pants?)\b/,
  skirt: /\bskirts?\b/,
  dress: /\b(dress(es)?|gowns?|jumpsuits?|rompers?|playsuits?|overalls?)\b/,
  suit: /\b(suits?|tuxedos?)\b/,
  outerwear: /\b(jackets?|coats?|parkas?|blazers?|puffers?|trench|overcoats?|vests?|gilets?|anoraks?|windbreakers?|ponchos?|capes?)\b/,
  knit: /\b(sweaters?|jumpers?|knits?|knitwear|pullovers?|hoodies?|sweatshirts?|cardigans?|fleece)\b/,
  top: /\b(tops?|blouses?|shirts?|t-?shirts?|tees?|polos?|tanks?|camis?|bodysuits?|tunics?|overshirts?)\b/,
  accessory: /\b(hats?|caps?|beanies?|belts?|scarf|scarves|gloves?|bags?|wallets?|socks?|sunglasses)\b/,
};
const ORDER = ["shoes", "bra", "swim", "workwear", "jeans", "shorts", "leggings", "pants", "skirt", "dress", "suit", "outerwear", "knit", "top", "accessory"];

export function garmentGroup(productType, title) {
  const s = norm(productType) + " " + norm(title);
  for (const g of ORDER) if (RE[g].test(s)) return g;
  return "other";
}

export const GROUP_LABEL = {
  shoes: "schoenen", bra: "bh/lingerie", swim: "zwemkleding", workwear: "werkkleding", jeans: "jeans", shorts: "shorts", leggings: "leggings",
  pants: "broeken", skirt: "rokken", dress: "jurken", suit: "pakken", outerwear: "jassen", knit: "truien/hoodies", top: "tops/shirts", accessory: "accessoires", other: "overig",
};

const BOTTOMS = new Set(["jeans", "shorts", "pants", "workwear"]);

/* ---------- taille inches ↔ cm (AU-retail/werkkleding-ladder) ---------- */
export const WAIST_IN_TO_CM = {
  24: 61, 25: 64, 26: 67, 27: 69, 28: 72, 29: 74, 30: 77, 31: 79, 32: 82, 33: 84, 34: 87, 35: 89, 36: 92, 37: 94, 38: 97, 39: 99,
  40: 102, 41: 104, 42: 107, 43: 109, 44: 112, 45: 114, 46: 117, 47: 119, 48: 122, 50: 127, 52: 132, 54: 137,
};
const CM_TO_IN = Object.fromEntries(Object.entries(WAIST_IN_TO_CM).map(([i, c]) => [c, Number(i)]));
export function cmToWaistIn(cm) {
  const n = Number(cm);
  if (!isFinite(n)) return null;
  if (CM_TO_IN[n] != null) return CM_TO_IN[n];
  // dichtstbijzijnde trede (max 1,5 cm ernaast)
  let best = null;
  for (const [c, i] of Object.entries(CM_TO_IN)) if (Math.abs(Number(c) - n) <= 1.5 && (best == null || Math.abs(Number(c) - n) < best.d)) best = { i, d: Math.abs(Number(c) - n) };
  return best ? best.i : null;
}

/* ---------- lettermaten ---------- */
const LETTER_WORDS = {
  "xx-small": "XXS", "xxsmall": "XXS", "x-small": "XS", "xsmall": "XS", "extra small": "XS", small: "S", medium: "M", large: "L",
  "x-large": "XL", xlarge: "XL", "extra large": "XL", "xx-large": "XXL", xxlarge: "XXL", "xxx-large": "XXXL", xxxlarge: "XXXL",
  "xxxx-large": "4XL", "xxxxx-large": "5XL",
};
/** "2xl" / "xxl" / "XX-Large" / "Size M" / "US M" → canonieke letter, anders null */
export function canonLetter(raw) {
  let s = norm(raw).trim().replace(/^(size|maat|us|uk|au|aus|eu|int|intl)\s*[:\-]?\s*/, "").replace(/\s*\((us|uk|au|eu|int|intl)\)\s*$/, "").trim();
  if (LETTER_WORDS[s]) return LETTER_WORDS[s];
  let m = s.match(/^(\d)\s*xl$/);
  if (m) return Number(m[1]) <= 3 ? "X".repeat(Number(m[1])) + "L" : `${m[1]}XL`;
  m = s.match(/^(\d)\s*xs$/);
  if (m) return Number(m[1]) <= 2 ? "X".repeat(Number(m[1])) + "S" : `${m[1]}XS`;
  m = s.match(/^(x{0,5})(s|m|l)$/);
  if (m) {
    const x = m[1].length;
    const base = m[2].toUpperCase();
    if (base === "M") return x ? null : "M";
    if (x <= 3) return "X".repeat(x) + base;
    return `${x}X${base}`;
  }
  return null;
}

const RANGE_LETTER_RE = /^([a-z\- ]{1,10})\s*[\(\[]\s*([^\)\]]+)\s*[\)\]]\s*$/i; // "M (8-10)" — laten staan
const WAIST_RE = /^(?:w\s*)?(\d{2})(?:\s*(?:w|in(?:ch(?:es)?)?|"|”|''))?$/i; // 32, W32, 32W, 32", 32 in
const WAIST_CM_RE = /^(\d{2,3})\s*cm$/i; // 82cm, 82 cm
const DUAL_RE = /^(\d{2})\s*\(\s*(\d{2,3})\s*cm\s*\)$/i; // 32 (82 cm)
const DUAL_CM_FIRST_RE = /^(\d{2,3})\s*(?:cm)?\s*\(\s*(\d{2})\s*(?:in(?:ch)?|"|”)?\s*\)$/i; // 82 (32") · 82 cm (32)
const WORK_CM_RE = /^(\d{2,3})\s*([rsl])$/i; // 82R / 87S / 84L — lengtecode, niet te raden

export const AU_MEN_BOTTOMS = { plain: "32", dual: "32 (82 cm)" };

/**
 * notationTarget(market, gender, group) → { style, label }
 *   style: "letters-local" | "waist-in" | "waist-dual" | "waist-cm-dual" | "keep"
 */
export function notationTarget(market, gender, group, opts = {}) {
  const au = market === "AUS+NZ";
  if (group === "shoes" || group === "bra" || group === "accessory") return { style: "keep", label: "" };
  if (gender === "men" && BOTTOMS.has(group)) {
    if (au && group === "workwear") return { style: "waist-cm-dual", label: 'werkkleding: cm mét inches, "82 (32")" (KingGee/Bisley-stijl)' };
    if (au && (opts.auMenBottoms || "plain") === "dual") return { style: "waist-dual", label: 'taille in inches mét cm: "32 (82 cm)"' };
    return { style: "waist-in", label: "taille in inches, kaal: 30 · 32 · 34" };
  }
  return { style: "letters-local", label: au ? "XS–XXL of AU 6–18" : market === "UK" ? "XS–XXL of UK 6–18" : "XS–XXL of US 0–16" };
}

/**
 * planNotation(values, { market, gender, group, auMenBottoms })
 *  → { target, changes: [[from, to]], manual: [reden], ok }
 *  Verandert alleen wat ondubbelzinnig is; de rest blijft (en wordt gemeld).
 */
export function planNotation(values, opts = {}) {
  const market = opts.market || "";
  const gender = opts.gender || "women";
  const group = opts.group || "other";
  const target = notationTarget(market, gender, group, opts);
  const changes = [];
  const manual = [];
  if (!market || target.style === "keep") return { target, changes, manual, ok: true };
  const out = [];
  for (const raw of values || []) {
    const src = String(raw == null ? "" : raw).trim();
    if (!src) {
      out.push(src);
      continue;
    }
    let to = src;
    if (target.style === "waist-in" || target.style === "waist-dual" || target.style === "waist-cm-dual") {
      let inch = null;
      let m;
      if ((m = src.match(WORK_CM_RE))) {
        manual.push(`${src}: lengtecode ${m[2].toUpperCase()} (R/S/L) — zet lengte in een aparte optie`);
        out.push(src);
        continue;
      }
      if ((m = src.match(DUAL_RE))) inch = Number(m[1]);
      else if ((m = src.match(DUAL_CM_FIRST_RE))) inch = Number(m[2]);
      else if (/^\d{2,3}$/.test(src) && Number(src) >= 61) inch = cmToWaistIn(src); // kale cm-waarde (67/72/77/82/87…)
      else if ((m = src.match(WAIST_RE))) inch = Number(m[1]);
      else if ((m = src.match(WAIST_CM_RE))) inch = cmToWaistIn(m[1]);
      if (inch == null) {
        const letter = canonLetter(src);
        if (letter) to = letter; // joggers/shorts in S–XL mogen letters blijven
        else if (!RANGE_LETTER_RE.test(src)) manual.push(`${src}: geen taille-maat herkend`);
      } else if (inch < 24 || inch > 54) {
        manual.push(`${src}: taille ${inch} buiten 24–54`);
      } else if (target.style === "waist-in") {
        to = String(inch);
      } else {
        const cm = WAIST_IN_TO_CM[inch];
        if (!cm) to = String(inch);
        else to = target.style === "waist-cm-dual" ? `${cm} (${inch}")` : `${inch} (${cm} cm)`;
      }
    } else {
      // letters-local: lettermaten canoniek; nummers en "M (8-10)" met rust laten
      const letter = canonLetter(src);
      if (letter) to = letter;
      else if (/^\d{1,2}(\.5)?$/.test(src)) {
        const n = Number(src);
        // oneven AU-damesmaten bestaan alleen bij denim (5/7/9 = taille 23/25/27) — elders melden
        if (gender === "women" && market === "AUS+NZ" && !BOTTOMS.has(group) && n >= 4 && n <= 26 && n % 2 === 1) manual.push(`${src}: oneven AU-damesmaat (AU gebruikt 6/8/10…)`);
      }
    }
    out.push(to);
    if (to !== src) changes.push([src, to]);
  }
  // botsingen: twee bronwaarden die op dezelfde eindwaarde uitkomen → niets doen
  const seen = new Map();
  for (const v of out) {
    const k = v.toLowerCase();
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const clash = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  if (clash.length) return { target, changes: [], manual: [`botsing na omzetten (${clash.join(", ")} dubbel)`], ok: false };
  return { target, changes, manual, ok: manual.length === 0, values: out };
}

/** Is dit een label dat de notatie-fix zelf maakt ("32 (82 cm)")? Dan is het
 *  géén rommel voor de rommel-check. */
export function isNotationLabel(raw) {
  const s = String(raw == null ? "" : raw).trim();
  return DUAL_RE.test(s) || DUAL_CM_FIRST_RE.test(s);
}
