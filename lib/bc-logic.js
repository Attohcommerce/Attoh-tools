// BIG COMPETITORS — de logica zonder Redis of netwerk (23-11-2026, projectdoc 205).
//
// Justin: "Stores met 200k+ bezoek per maand importeren continu nieuwe
// producten — wat zij nieuw toevoegen werkt. Scrape ze 's nachts, onthoud wat
// je al gezien hebt, en zet alles wat nieuw is (max 90 dagen oud) meteen als
// import-sheet klaar, verdeeld over mijn stores per markt, net onder hun prijs."
//
// Dit bestand bevat alleen rekenwerk, zodat het los te testen is
// (lib/bc-logic-test.mjs):
//   - product uit de publieke feed → compacte regel (shapeProduct)
//   - wanneer is iets "nieuw" (addedAtOf) en wat slaan we over (junkReason)
//   - keyword afleiden uit hún titel + tags (deriveKeyword)
//   - verdelen over de stores van de markt (distribute)
//   - rijen voor het datum-blad (buildRow) — import-formaat + prijs
//   - product-ID's compact bewaren (packIds / unpackIds)
import { gzipSync, gunzipSync } from "zlib";
import { guessGender, isKidsProduct } from "./scrape";
import { GARMENTS } from "./category-collection";
import { keywordType } from "./verdeling";
import { analyzeKeyword } from "./fashion";
import { IMPORT_HEADER, floorTo95, sheetDiscountFor, straightQ } from "./import-format";

export const BC_HEADER = [...IMPORT_HEADER, "COMPETITOR", "TOEGEVOEGD BIJ COMPETITOR", "REDEN TOEWIJZING"];

/* ---------------- datum (Nederlandse tijd) ---------------- */
const AMS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
/** { iso: "2026-11-24", short: "24-11", time: "02:04" } in Nederlandse tijd. */
export function amsParts(ts = Date.now()) {
  const p = Object.fromEntries(AMS.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return { iso: `${p.year}-${p.month}-${p.day}`, short: `${p.day}-${p.month}`, time: `${hour}:${p.minute}` };
}

/* ---------------- product-ID's compact bewaren ----------------
   Een competitor met 25.000 producten = 25.000 ID's van 13–14 cijfers.
   Gesorteerd, als verschil met de vorige (base36) en gezipt past dat in
   ±100 kB — Redis is 250 MB en gedeeld met de rest van de tool. */
export function packIds(ids) {
  const arr = [...new Set([...ids].map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].sort((a, b) => a - b);
  const parts = new Array(arr.length);
  let prev = 0;
  for (let i = 0; i < arr.length; i++) {
    parts[i] = (arr[i] - prev).toString(36);
    prev = arr[i];
  }
  return gzipSync(Buffer.from(parts.join(","))).toString("base64");
}
export function unpackIds(packed) {
  const out = new Set();
  if (!packed) return out;
  const txt = gunzipSync(Buffer.from(String(packed), "base64")).toString();
  if (!txt) return out;
  let prev = 0;
  for (const part of txt.split(",")) {
    prev += parseInt(part, 36);
    out.add(prev);
  }
  return out;
}

/* ---------------- wanneer is een product toegevoegd ----------------
   Laatste van created_at en published_at: een product dat maanden als
   concept klaarstond en vorige week live ging, is "vorige week toegevoegd".
   (Een CSV-export heeft geen aanmaakdatum en de ?v=-tijd in foto-links is
   onbetrouwbaar — daarom alleen de feed.) */
export function addedAtOf(p) {
  const c = Date.parse((p && p.created_at) || "") || 0;
  const pub = Date.parse((p && p.published_at) || "") || 0;
  return Math.max(c, pub);
}

function stripHtml(h) {
  return String(h || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------- keyword uit hún titel ----------------
   Barbara Dever: "Penelope | Women's Slouchy Foldover High Heel Boots
   Gold-Buckle Knee-High" met tags "block heel boots, foldover boots, high
   heel boots, knee-high boots…". Hun tags zíjn hun keywords. Wij nemen het
   keyword dat zij gebruiken (letterlijk terug te vinden in de titel) en de
   importer schrijft daar onze eigen titel omheen — nooit 1-op-1 overnemen.

   Regels (de titel-check van de importer keurt anders af):
   geen voornaam, geen geslachtswoord, geen kleur, geen cijfers, geen
   waarde-oordelen (elegant, stylish…), hooguit 4 woorden, type achteraan. */
const GENDER_RE = /\b(women'?s?|woman'?s?|womens|men'?s?|man'?s?|mens|ladies|lady'?s?|female|male|unisex|for (?:her|him|women|men|ladies))\b/gi;
const FLUFF = new Set(
  `elegant stylish chic stunning beautiful premium luxury luxurious perfect trendy versatile gorgeous lovely cute
fashionable sexy amazing ultimate exclusive signature new hot best sale quality fashion style styled comfortable comfy ai generated images`.split(/\s+/)
);
const COLORS = new Set(
  `black white ivory cream gold golden silver red burgundy wine blue navy cobalt green olive emerald khaki brown tan camel
cognac chocolate beige nude taupe grey gray charcoal pink blush rose fuchsia purple lilac lavender violet yellow mustard
orange rust terracotta multicolor multicolour colorful apricot coffee`.split(/\s+/)
);
const STOP = new Set(["with", "and", "for", "the", "a", "an", "in", "of", "to", "by", "on", "at", "from", "or"]);
// Tweewoords-eigenschappen: nooit maar de helft meenemen ("merino wool", "long sleeve")
const BIGRAMS = new Set(
  `long sleeve|short sleeve|v neck|crew neck|round neck|high neck|mock neck|knee high|thigh high|mid calf|block heel|high heel|
low heel|kitten heel|wide leg|straight leg|faux fur|faux leather|faux suede|relaxed fit|slim fit|loose fit|regular fit|
button front|open front|zip front|high waist|high rise|off shoulder|one shoulder|half zip|quarter zip|full zip|zip up|
lace up|slip on|pull on|pointed toe|round toe|square toe|open toe|closed toe|cable knit|merino wool|wool blend|two piece|
three piece|color block|side zip|stand collar|fur lined|sherpa lined|fleece lined|wide calf|ankle strap|puff sleeve`
    .replace(/\n/g, "")
    .split("|")
    .map((s) => s.trim())
);
// Detail-eigenschappen: wel een keyword van hen, maar zwakker dan een soortnaam
// ("full zip jacket" verliest van "bomber jacket", "relaxed fit vest" van "sherpa vest")
const DETAIL = new Set(
  `full zip|button front|zip front|side zip|stand collar|notch lapel|ribbed cuff|contrast trim|drawstring waist|two tone|
snap pocket|multi pocket|elastic waist|relaxed fit|slim fit|loose fit|regular fit|round toe|pointed toe|square toe|wide toe`
    .replace(/\n/g, "")
    .split("|")
    .map((s) => s.trim())
);
// Type dat uit twee woorden bestaat: beide woorden horen bij het type-slot
const TWO_WORD_TYPES = new Set(["tank top", "t shirt", "polo shirt", "crop top", "flip flops", "board shorts", "swim trunks", "rash guard", "sport coat", "house shoes", "running shoes", "ballet flats", "bathing suit"]);
// Woorden uit de kledingstuk-lijst die een eigenschap zijn, geen zelfstandig naamwoord
const NOT_A_TYPE = new Set(["sleeveless", "hooded", "crop", "piece", "knitwear", "swim", "trench", "no"]);
const GARMENT_RE = Object.fromEntries(GARMENTS);

/* Kledingstuk van een product — dezelfde lijst als de Store Doctor (GARMENTS),
   met drie correcties voor competitor-feeds:
   - eerst de TITEL (zonder voornaam), pas daarna het type, en van een type-pad
     ("Accessories > Sunglasses > Casual > Bomber") alleen de eerste twee
     stukken — de staart is bij Barbara Dever rommel (zonnebril werd "jacket");
   - "Hooded Puffer Jacket" is een jas, geen hoodie;
   - accessoires, tunieken en nachtkleding krijgen een eigen soort. */
const EXTRA_GARMENTS = [
  ["top", /\b(tunics?)\b/i],
  ["sleepwear", /\b(robes?|pajamas?|pyjamas?|nightgowns?|nighties?|sleepwear|nightwear|kimonos?|kaftans?|caftans?)\b/i],
];
const ACCESSORY_RE = /\b(sunglasses|eyewear|beanies?|scar(?:f|ves)|gloves?|mittens?|jewel(?:le)?ry|necklaces?|earrings?|bracelets?|wallets?|socks|hats?)\b/i;
const OUTER_RE = /\b(coats?|jackets?|parkas?|puffers?|trench|anoraks?|windbreakers?|overcoats?)\b/i;
function garmentIn(text) {
  for (const [k, re] of GARMENTS) if (re.test(text)) return k;
  for (const [k, re] of EXTRA_GARMENTS) if (re.test(text)) return k;
  return null;
}
// Bovenstukken die vóór een ander kledingstuk-woord een bijvoeglijk gebruik hebben
const UPPER = new Set(["blazer", "shirt", "tee", "sweater", "hoodie", "jacket", "tank-top", "top", "cardigan"]);
const VEST_RE = /\b(vests?|gilets?|waistcoats?)\b/i;
export function bcGarment(title, productType) {
  // "Blazer-Style Midi Dress" is een jurk; "Dress with Flowing Skirt" is geen rok
  const core = coreTitle(title).replace(/\|/g, " ").replace(/\b[\w-]+[\s-]style\b/gi, " ").replace(/\bwith\b.*$/i, " ");
  let g = garmentIn(core);
  if (g === "hoodie" && OUTER_RE.test(core) && !/\b(hoodies?|sweatshirts?)\b/i.test(core)) g = "jacket";
  if (g && UPPER.has(g)) {
    // kopwoord staat achteraan: "Sweater Dress", "Shirt Dress", "Sweater Vest"
    const at = core.search(GARMENT_RE[g]);
    const tail = at >= 0 ? core.slice(at) : "";
    if (GARMENT_RE.dress.test(tail)) g = "dress";
    else if (g !== "jacket" && VEST_RE.test(tail)) g = "vest";
  }
  if (g) return g;
  if (ACCESSORY_RE.test(core)) return "accessory";
  const typeHead = String(productType || "").split(/\s*[>\/]\s*/).slice(0, 2).join(" ");
  g = garmentIn(typeHead);
  if (g) return g;
  if (ACCESSORY_RE.test(typeHead)) return "accessory";
  return null;
}
const NON_FASHION_RE =
  /\b(craft kits?|mosaic|puzzles?|ornaments?|home decor|candles?|mugs?|toys?|blankets?|pillows?|posters?|stickers?|phone cases?|kitchen|garden|lamps?|string lights|gadgets?|christmas tree|wall art|diamond painting|pet (bed|toy|collar)|dog (bed|toy|collar|leash))\b/i;

const stem = (w) => (w.length > 3 && w.endsWith("es") && /(ss|sh|ch|x)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Titel zonder voornaam ervoor ("William | Men's …" → "Men's …"). */
export function coreTitle(title) {
  const t = straightQ(String(title || "")).replace(/[™®©]/g, " ").replace(/\s+/g, " ").trim();
  const segs = t.split(/\s*[|–—]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return t;
  // eerste stuk = één of twee woorden zonder kledingstuk → een naam, eraf
  const first = segs[0];
  const firstIsName = first.split(" ").length <= 2 && !garmentIn(first) && !ACCESSORY_RE.test(first);
  const rest = firstIsName ? segs.slice(1) : segs;
  return rest.join(" ");
}

function cleanTokens(text) {
  const raw = String(text || "")
    .toLowerCase()
    .replace(GENDER_RE, " ")
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (/\d/.test(w)) continue;
    if (w.length === 1) {
      // "v neck", "t shirt", "a line" — de losse letter hoort bij het volgende woord
      const nxt = raw[i + 1] || "";
      if (!((w === "v" && nxt === "neck") || (w === "t" && /^shirts?$/.test(nxt)) || (w === "a" && nxt === "line"))) continue;
    }
    if (w === "s") continue; // rest van "women's"
    const keepStop = (w === "a" && raw[i + 1] === "line") || (w === "on" && /^(slip|pull|snap|clip|step)$/.test(raw[i - 1] || ""));
    if (FLUFF.has(w) || COLORS.has(w) || (STOP.has(w) && !keepStop)) continue;
    out.push(w);
  }
  return out;
}

// Type-id uit de mode-taxonomie (lib/fashion.js) → kledingstuk-soort hierboven
const TYPE_TO_GARMENT = {
  dress: "dress", tshirt: "tee", shirt: "shirt", blouse: "shirt", polo: "shirt", top: "top", bodysuit: "top", sweater: "sweater",
  hoodie: "hoodie", cardigan: "cardigan", jacket: "jacket", coat: "jacket", blazer: "blazer", jeans: "jeans", pants: "trousers",
  leggings: "trousers", shorts: "shorts", skirt: "skirt", jumpsuit: "jumpsuit", heels: "heels", boots: "boots", sneakers: "sneakers",
  loafers: "flats-loafers", flats: "flats-loafers", mules: "flats-loafers", sandals: "sandals", bag: "bag", vest: "vest", set: "set",
  suit: "suit", swimsuit: "swimwear", bikini: "swimwear", kimono: "sleepwear", pajamas: "sleepwear", sunglasses: "accessory",
  scarf: "accessory", belt: "accessory", hat: "accessory",
};
// Woorden die de taxonomie als type ziet maar in een titel meestal een eigenschap zijn
const WEAK_TYPE = new Set(["short", "heel", "knit", "top", "skirt", "set"]);

/** Waar staat het type in de tokens? → { start, end } of null. Laatste treffer wint. */
function typeSpan(tokens, garment) {
  const res = garment ? [GARMENT_RE[garment], ...EXTRA_GARMENTS.filter(([k]) => k === garment).map(([, r]) => r)].filter(Boolean) : [];
  const hit = (text) => res.some((re) => re.test(text));
  if (res.length) {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const one = tokens[i];
      if (!NOT_A_TYPE.has(one) && hit(one)) {
        if (i >= 1 && TWO_WORD_TYPES.has(`${tokens[i - 1]} ${one}`)) return { start: i - 1, end: i + 1 };
        return { start: i, end: i + 1 };
      }
      if (i >= 1) {
        const two = `${tokens[i - 1]} ${one}`;
        if (TWO_WORD_TYPES.has(two) && hit(two)) return { start: i - 1, end: i + 1 };
      }
    }
  }
  /* Het woord uit de kledingstuk-lijst staat niet in de titel (soort kwam uit
     het producttype, of het is een synoniem: "Maxi Gown" bij dress) → de
     mode-taxonomie: laatste woord dat hetzelfde soort kledingstuk is. Zonder
     bekende soort: laatste woord dat een type is, behalve woorden die in een
     titel meestal een eigenschap zijn ("Short Sleeve", "Block Heel"). */
  for (let i = tokens.length - 1; i >= 0; i--) {
    const w = tokens[i];
    if (NOT_A_TYPE.has(w)) continue;
    let typeId = null;
    try {
      const a = analyzeKeyword(w);
      typeId = a && a.typeId;
    } catch {}
    if (!typeId) continue;
    if (garment && garment !== "accessory" ? TYPE_TO_GARMENT[typeId] === garment : !WEAK_TYPE.has(w)) return { start: i, end: i + 1 };
  }
  return null;
}

function titleKeyword(tokens, span) {
  const type = tokens.slice(span.start, span.end);
  const before = tokens.slice(0, span.start);
  let mods = before.slice(-2);
  // halve tweewoords-eigenschap ("[merino] wool turtleneck") → de halve eraf
  if (before.length >= 3 && BIGRAMS.has(`${before[before.length - 3]} ${before[before.length - 2]}`)) mods = before.slice(-1);
  // drie woorden als de laatste twee samen één eigenschap zijn en er nog één voor staat? nee: kort houden
  if (!mods.length) {
    // type staat vooraan ("Dress Relaxed V-Neck Maxi") → eerste eigenschap erachter ervoor zetten
    const after = tokens.slice(span.end);
    if (after.length >= 2 && BIGRAMS.has(`${after[0]} ${after[1]}`)) mods = after.slice(0, 2);
    else if (after.length) mods = after.slice(0, 1);
  }
  return [...mods, ...type];
}

/**
 * deriveKeyword(title, productType, tags[]) → { keyword, source: "tag"|"titel"|"geen type", garment }
 */
export function deriveKeyword(title, productType, tags) {
  const core = coreTitle(title);
  const garment = bcGarment(title, productType);
  const tokens = cleanTokens(core);
  if (!tokens.length) return { keyword: "", source: "geen type", garment };
  const found = typeSpan(tokens, garment);
  // geen type herkend ("Draped Tunic", "Belted Robe"): het laatste woord is het type
  const span = found || { start: tokens.length - 1, end: tokens.length };
  const typeWords = tokens.slice(span.start, span.end);
  const typeLast = stem(typeWords[typeWords.length - 1]);
  const titleStems = new Set(tokens.map(stem));
  const titleJoined = ` ${tokens.map(stem).join(" ")} `;

  // 1. hún tags: een tag die op hetzelfde type eindigt en waarvan élk woord in de titel staat
  let best = null;
  const list = Array.isArray(tags) ? tags : String(tags || "").split(",");
  list.forEach((tag, idx) => {
    const tt = cleanTokens(tag);
    if (tt.length < 2 || tt.length > 4) return;
    if (stem(tt[tt.length - 1]) !== typeLast) return;
    if (new Set(tt.map(stem)).size !== tt.length) return; // "trench coat coats"
    if (!tt.every((w) => titleStems.has(stem(w)))) return;
    const contiguous = titleJoined.includes(` ${tt.map(stem).join(" ")} `);
    const detail = DETAIL.has(tt.slice(0, -1).join(" "));
    const score = (tt.length === 4 ? 2.5 : tt.length) + (contiguous ? 0.5 : 0) - (detail ? 1.2 : 0) - idx * 0.001;
    if (!best || score > best.score) best = { score, words: tt };
  });
  if (best) return { keyword: best.words.join(" "), source: "tag", garment };
  // 2. uit de titel zelf: de één of twee eigenschappen direct vóór het type
  return { keyword: titleKeyword(tokens, span).join(" "), source: found ? "titel" : "geen type", garment };
}

/* ---------------- feed-product → compacte regel ---------------- */
const NOT_A_PRODUCT_RE =
  /\b(gift ?cards?|e-?gift|shipping protection|package protection|order protection|route (package )?protection|shipping insurance|insurance|warranty|priority (processing|handling|shipping)|rush (order|processing)|mystery (box|bag|item)|donation|tip jar|free gift|sample|digital download|vip (access|club|membership))\b/i;

/**
 * shapeProduct(feedProduct, domain) → regel of null.
 * Korte veldnamen: er gaan er honderden tegelijk door Redis.
 *   id · d domein · h handle · t titel · ty type · tg tags · p laagste prijs ·
 *   c hoogste doorstreepprijs · a toegevoegd (ms) · im eerste foto · av leverbaar ·
 *   ni aantal foto's · g Man/Vrouw/Onbekend · ga kledingstuk · kw keyword · ks bron keyword
 */
export function shapeProduct(p, domain) {
  if (!p || !p.id || !p.handle) return null;
  const id = Number(p.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const prices = variants.map((v) => Number(v.price) || 0).filter((n) => n > 0);
  const compares = variants.map((v) => Number(v.compare_at_price) || 0).filter((n) => n > 0);
  const tagsArr = (Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",")).map((t) => String(t).trim()).filter(Boolean);
  const title = straightQ(String(p.title || "")).replace(/\s+/g, " ").trim();
  const type = String(p.product_type || "").trim();
  const tags = tagsArr.join(", ");
  let g = guessGender({ title, productType: type, tags, bodyHtml: "" });
  if (g === "Onbekend") g = guessGender({ title, productType: type, tags, bodyHtml: stripHtml(p.body_html || "").slice(0, 500) });
  const kw = deriveKeyword(title, type, tagsArr);
  const images = Array.isArray(p.images) ? p.images : [];
  return {
    id,
    d: domain,
    h: String(p.handle),
    t: title.slice(0, 170),
    ty: type.slice(0, 90),
    tg: tags.slice(0, 320),
    p: prices.length ? Math.min(...prices) : 0,
    c: compares.length ? Math.max(...compares) : 0,
    a: addedAtOf(p),
    im: images[0] && images[0].src ? String(images[0].src).split("?")[0] : "",
    av: variants.length === 0 ? true : variants.some((v) => v.available !== false),
    ni: images.length,
    g,
    ga: kw.garment || null,
    kw: kw.keyword,
    ks: kw.source,
  };
}

/** Waarom slaan we dit product over? "" = gewoon meenemen. */
export function junkReason(rec) {
  if (!rec) return "onleesbaar";
  if (NOT_A_PRODUCT_RE.test(rec.t) || NOT_A_PRODUCT_RE.test(rec.ty)) return "geen product";
  if (!(rec.p > 0)) return "geen prijs";
  if (!rec.av) return "uitverkocht";
  if (!rec.ni) return "geen foto";
  if (isKidsProduct({ title: rec.t, productType: rec.ty, tags: rec.tg })) return "kids";
  if (!rec.ga && NON_FASHION_RE.test(`${rec.t} ${rec.ty}`)) return "geen kleding";
  return "";
}

/** Geslacht van een hele competitor uit de mix van zijn producten: "M" | "V" | "MV". */
export function mixGender(men, women) {
  const m = Number(men) || 0;
  const v = Number(women) || 0;
  if (m + v < 8) return "MV";
  if (v >= m * 6) return "V";
  if (m >= v * 6) return "M";
  return "MV";
}

/* ---------------- nieuwste eerst, eerlijk over de competitors ---------------- */
/** byDomain: { domein: [regels] } → max `limit` regels, om de beurt per competitor, nieuwste eerst. */
export function roundRobin(byDomain, limit) {
  const lists = Object.values(byDomain || {})
    .map((l) => [...(l || [])].sort((a, b) => (b.a || 0) - (a.a || 0)))
    .filter((l) => l.length);
  const out = [];
  let i = 0;
  while (out.length < limit && lists.some((l) => l.length > i)) {
    for (const l of lists) {
      if (l.length > i && out.length < limit) out.push(l[i]);
    }
    i++;
  }
  return out;
}

/* ---------------- Pythago-cijfers per store → per kledingstuk ---------------- */
/** rows = Pythago-rijen ({ title, type, onStore, per: {30: {orders, spend}} }) → { hasData, orders, byGarment } */
export function perfFromRows(rows) {
  const byGarment = {};
  let orders = 0;
  let n = 0;
  for (const r of rows || []) {
    if (!r) continue;
    const ga = bcGarment(String(r.title || ""), String(r.type || ""));
    const w = (r.per && (r.per[30] || r.per["30"])) || {};
    const o = Number(w.orders) || 0;
    const sp = Number(w.spend) || 0;
    orders += o;
    if (!ga) continue;
    const a = (byGarment[ga] = byGarment[ga] || { orders: 0, spend: 0, n: 0 });
    a.orders += o;
    a.spend += sp;
    if (r.onStore !== false) a.n++;
    n++;
  }
  return { hasData: n > 0, orders, byGarment };
}

/* ---------------- de verdeler ----------------
   Justin (23-11): "Hij mag zelf de verdeling maken per store. Stel er worden
   120 nieuwe producten verdeeld over 3 stores: dan kiest hij wie 60 krijgt,
   wie 40 en wie 20. Het mag ook dat er niets tussen zit voor Lady Glam en
   alles naar Soul Society en Everman gaat. Die logica zit erin."

   Per product:
     1. geslacht moet bij de store passen (heren → M of MV, dames → V of MV;
        onbekend → het geslacht van de competitor, anders alleen MV-stores);
     2. pasvorm = hoe goed dat kledingstuk in díe store verkoopt (Pythago,
        30 dagen: aandeel in de orders), + klein beetje voor een store die
        alleen dat geslacht voert, − als het er geld kost zonder orders;
     3. drukte: elke store heeft een richtaandeel naar sterkte (orders 30 d);
        zit hij daarboven dan zakt zijn score — een veel betere match wint
        nog steeds. Zo ontstaat 60/40/20 vanzelf, of 0 voor een store.
   Eén product gaat naar één store per markt. */
export function distribute({ products, stores, perf = {}, compGender = {} }) {
  const list = stores || [];
  const N = (products || []).length;
  const totalOrders = list.reduce((a, s) => a + ((perf[s.domain] && perf[s.domain].orders) || 0), 0);
  const weight = {};
  let sumW = 0;
  for (const s of list) {
    const share = totalOrders > 0 ? ((perf[s.domain] && perf[s.domain].orders) || 0) / totalOrders : 0;
    weight[s.domain] = 1 + 2 * list.length * share;
    sumW += weight[s.domain];
  }
  const quota = {};
  for (const s of list) quota[s.domain] = sumW > 0 ? (N * weight[s.domain]) / sumW : 0;

  const assigned = {};
  for (const s of list) assigned[s.domain] = [];
  const unassigned = [];

  for (const p of products || []) {
    let g = p.g;
    let gNote = "";
    if (g !== "Man" && g !== "Vrouw") {
      const cg = compGender[p.d];
      if (cg === "M") {
        g = "Man";
        gNote = " (competitor is een herenstore)";
      } else if (cg === "V") {
        g = "Vrouw";
        gNote = " (competitor is een damesstore)";
      }
    }
    const eligible = list.filter((s) => {
      const sg = String(s.genders || "MV").toUpperCase();
      if (g === "Man") return sg.includes("M");
      if (g === "Vrouw") return sg.includes("V");
      return sg === "MV";
    });
    const gLabel = g === "Man" ? "Heren" : g === "Vrouw" ? "Dames" : "Geslacht onbekend";
    if (!eligible.length) {
      unassigned.push({ p, g, reason: g === "Man" ? "geen herenstore in deze markt" : g === "Vrouw" ? "geen damesstore in deze markt" : "geslacht onbekend en geen store met heren én dames" });
      continue;
    }
    let best = null;
    for (const s of eligible) {
      const pf = perf[s.domain];
      const gp = pf && pf.hasData && p.ga ? pf.byGarment[p.ga] : null;
      const share = gp && pf.orders > 0 ? gp.orders / pf.orders : 0;
      let fit = 1 + 3 * share;
      if (gp && gp.n > 0) fit += 0.3;
      if (gp && gp.orders === 0 && gp.spend >= 40) fit -= 0.4;
      const sg = String(s.genders || "MV").toUpperCase();
      const specialist = (g === "Man" && sg === "M") || (g === "Vrouw" && sg === "V");
      if (specialist) fit += 0.25;
      const count = assigned[s.domain].length;
      const load = quota[s.domain] > 0 ? count / quota[s.domain] : count;
      const eff = fit / (1 + load);
      if (!best || eff > best.eff + 1e-9 || (Math.abs(eff - best.eff) <= 1e-9 && count < assigned[best.s.domain].length)) {
        best = { s, fit, eff, share, gp, specialist, hasData: !!(pf && pf.hasData) };
      }
    }
    let why;
    if (eligible.length === 1) why = `enige store voor ${g === "Man" ? "heren" : g === "Vrouw" ? "dames" : "dit product"} in deze markt`;
    else if (best.gp && best.gp.orders > 0) why = `${p.ga} verkoopt hier: ${best.gp.orders} orders in 30 dagen (${Math.round(best.share * 100)}% van de store)`;
    else if (best.specialist) why = `${g === "Man" ? "heren" : "dames"}store — past het best`;
    else if (!best.hasData) why = "nog geen Pythago-cijfers — eerlijk verdeeld";
    else why = "verdeeld naar ruimte per store";
    assigned[best.s.domain].push({ p, g, reason: `${gLabel}${gNote} · ${p.ga || "type onbekend"} · ${why}` });
  }
  return { assigned, unassigned, quota };
}

/* ---------------- rijen voor het datum-blad ---------------- */
export function productUrl(rec) {
  return `https://${rec.d}/products/${rec.h}`;
}

/**
 * Eén rij in het import-formaat (A–S) + T COMPETITOR · U TOEGEVOEGD · V REDEN.
 * Onze prijs (Q) = hun laagste prijs − undercut, naar beneden op het
 * X4,95/X9,95-rooster (64,95 → 59,95). Andere valuta dan de store → geen
 * prijs in de sheet (dan rekent de importer met de prijsband), wel in de reden.
 */
export function buildRow(item, { undercut = 5, storeCurrency = "", competitorCurrency = "" } = {}) {
  const rec = item.p;
  const url = productUrl(rec);
  const sameCur = !competitorCurrency || !storeCurrency || String(competitorCurrency).toUpperCase() === String(storeCurrency).toUpperCase();
  const our = sameCur && rec.p > 0 ? floorTo95(rec.p - (Number(undercut) || 0)) : 0;
  const g = item.g === "Man" || item.g === "Vrouw" ? item.g : "";
  const kw = rec.kw || "";
  const added = rec.a ? amsParts(rec.a).iso : "";
  const reason = sameCur ? item.reason : `${item.reason} · prijs concurrent ${rec.p} ${competitorCurrency} (andere valuta — prijsband van de importer)`;
  return [
    url, rec.t, kw, `Big Competitors · ${rec.d}`, "Literal", g,
    "", "", "", kw ? keywordType(kw) : "", "",
    "", "", "", "", "",
    our > 0 ? our : "", sameCur && rec.p > 0 ? rec.p : "", our > 0 ? sheetDiscountFor(url) : "",
    rec.d, added, reason,
  ];
}

/** "24-11 · Soul Society Boutique (60)" — tweede scan op dezelfde dag: "24-11 · Soul Society Boutique #2 (5)". */
export function tabTitle(short, storeName, count, existing) {
  const taken = (existing || []).map((t) => String(t).toLowerCase());
  const name = String(storeName || "Store").replace(/[\[\]\*\?\/\\:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const base = `${short} · ${name}`;
  const low = base.toLowerCase();
  let n = taken.filter((t) => t === low || t.startsWith(`${low} (`) || t.startsWith(`${low} #`)).length + 1;
  const make = (i) => (i === 1 ? `${base} (${count})` : `${base} #${i} (${count})`);
  while (taken.includes(make(n).toLowerCase()) && n < 200) n++;
  return make(n);
}
