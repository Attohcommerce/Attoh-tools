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
import { analyzeKeyword } from "./fashion";

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
  },
  focus: {
    alpha: 1.0,
    cap: 28,
    floor: 8,
    colCapFrac: 0.45,
    minColBudget: 24, // een collectie verdient alleen een plek met ≥3 serieuze keywords
  },
};

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

export function isVerdelingJunk(kw) {
  if (hasRepeatedWord(kw)) return "dubbel-woord";
  if (kw.split(/\s+/).some((t) => FOREIGN_NOISE.has(t))) return "buitenlands";
  if (isJunkKeyword(kw)) return "merkenlijst";
  return null;
}

/* ---------------- collectie-blauwdruk ---------------- */

const MEN_RE = /\bmen'?s?\b|\bman\b|\bmale\b|\bgents?\b/;

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
  if (has(kw, "blouses?", "shirts?")) return { col: men ? null : "Blouses", g };
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
  "work", "office", "business", "interview", "church", "brunch", "date",
  "night", "club", "festival", "concert", "funeral", "gala", "formal",
  "occasion", "event", "evening",
]);
const OUTFIT_WORDS = new Set(["outfit", "outfits", "look", "looks", "attire", "wear"]);

export function keywordType(kw) {
  const tokens = String(kw).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return "Direct";
  // "outfit"/"look" is nooit een producttype
  if (tokens.some((t) => OUTFIT_WORDS.has(t))) return "Gelegenheid";
  if (tokens.some((t) => OCCASION_WORDS.has(t))) return "Gelegenheid";
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
const SYNONYMS = { bridal: "wedding", attendee: "guest", jumper: "sweater" };

export function canonKey(kw) {
  let s = kw;
  for (const [glued, split] of COMPOUNDS) s = s.replace(new RegExp(glued, "g"), split);
  const stems = [];
  for (let t of s.split(/[^a-z0-9]+/)) {
    if (!t || FILLER.has(t)) continue;
    if (SYNONYMS[t]) t = SYNONYMS[t];
    t = t.replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2));
    if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
    stems.push(t);
  }
  return stems.sort().join(" ");
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

function allocateByCollection(items, budget, P, droppedCols) {
  // Laag 1: budget over collecties ∝ vraag^alpha met collectie-cap.
  // Collecties die onder het minimum-budget uitkomen vallen af (zwakste
  // eerst) en hun budget vloeit terug naar de sterkere collecties — in
  // focus-modus is dat minimum hoog, waardoor zwakke productsoorten
  // volledig wegvallen ten gunste van kansrijke.
  const byCol = new Map();
  for (const r of items) {
    if (!byCol.has(r.col)) byCol.set(r.col, []);
    byCol.get(r.col).push(r);
  }
  let cols = [...byCol.keys()];
  const weightOf = (c) =>
    Math.pow(byCol.get(c).reduce((s, x) => s + x.score, 0), P.alpha);

  let alloc = new Map();
  for (let guard = 0; guard < cols.length + 5 && cols.length; guard++) {
    alloc = new Map(cols.map((c) => [c, 0]));
    const capped = new Set();
    const colCap = budget * P.colCapFrac;
    for (let iter = 0; iter < 60; iter++) {
      const free = cols.filter((c) => !capped.has(c));
      const used = [...capped].reduce((s, c) => s + alloc.get(c), 0);
      const rem = budget - used;
      const sw = free.reduce((s, c) => s + weightOf(c), 0);
      if (!free.length || sw <= 0) break;
      let changed = false;
      for (const c of free) alloc.set(c, (rem * weightOf(c)) / sw);
      for (const c of free) {
        if (alloc.get(c) > colCap) {
          alloc.set(c, colCap);
          capped.add(c);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const weak = cols.filter((c) => alloc.get(c) < P.minColBudget);
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

/* ---------------- hoofd-functie ---------------- */

/**
 * rows: [{ kw, avg, months: [4 getallen in gekozen volgorde] }]
 * opts: {
 *   monthNames: ["aug","sep","okt","nov"],  // labels voor piekmaand
 *   genders: "MV" | "V" | "M",
 *   total: 1000,        // 1–2000
 *   mode: "spread" | "focus",
 *   minSeason: 4000,
 *   exclude: Set<string>  // extra keywords die weg moeten (bv. AI-check)
 * }
 */
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

function consistentCollection(kw, col) {
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
  // Herenkeywords houden hun eigen "Men's ..."-variant
  return col.startsWith("Men's ") ? `Men's ${home}` : home;
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

  const stats = { input: rows.length, junk: 0, lowSeason: 0, unmapped: 0, genderSkip: 0 };

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

  // 1-3: filteren, seizoensscore, collectie
  const mapped = [];
  const seenKw = new Set();
  for (const r of rows) {
    const kw = stripUk(String(r.kw || "").toLowerCase().trim());
    if (!kw || seenKw.has(kw)) continue;
    seenKw.add(kw);
    const facts = kwFacts(kw);
    if (exclude.has(kw) || facts.junk) {
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
    const canon = facts.canon;
    const stemCount = canon ? canon.split(" ").length : 1;
    // Head/longtail-balans: kale head-terms ("boots", "jeans") zijn moordend
    // competitief in Shopping — lichte demping; 2-3-woords long-tails
    // converteren beter voor een kleine store — lichte boost.
    const tailFactor = stemCount <= 1 ? 0.85 : stemCount <= 3 ? 1.08 : 1;
    mapped.push({
      kw,
      col,
      g,
      avg: Number(r.avg) || 0,
      season,
      score: season * momentum * tailFactor,
      peak: monthNames[peak] || `m${peak + 1}`,
      canon,
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

  // 5: alloceren per groep
  const droppedCols = [];
  let allRows = [];
  if (genders === "MV") {
    const wBudget = Math.round(total * W_SHARE);
    allRows = [
      ...allocateByCollection(unique.filter((r) => r.g === "V"), wBudget, P, droppedCols),
      ...allocateByCollection(unique.filter((r) => r.g === "M"), total - wBudget, P, droppedCols),
    ];
  } else {
    allRows = allocateByCollection(unique, total, P, droppedCols);
  }
  allRows = allRows.filter((x) => x.n >= P.floor);
  allRows.sort((a, b) => b.season - a.season);

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
    stats,
  };
}
