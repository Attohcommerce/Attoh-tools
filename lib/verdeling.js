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

// Veelvoorkomende Keyword Planner-tikfouten: geen eigen zoekintentie, alleen
// ruis in de spelling. Corrigeren VÓÓR matching/output — anders belandt de
// tikfout letterlijk in de producttitel (het keyword IS het producttype-slot).
// Uitbreidbaar: nieuwe gevallen die opvallen in een verdeling hier bijzetten.
const SPELLING_FIX = {
  comfrt: "comfort",
};

function fixSpelling(kw) {
  return kw
    .split(/\s+/)
    .map((t) => SPELLING_FIX[t] || t)
    .join(" ");
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
  if (has(kw, "wedding guest", "bridesmaids?", "bridal", "wedding attendee"))
    return { col: men ? null : "Wedding Guest & Bridesmaid Dresses", g };
  if (has(kw, "graduation")) return { col: men ? null : "Graduation Dresses", g };
  if (has(kw, "maternity")) {
    if (has(kw, "dress(es)?")) return { col: men ? null : "Maternity Dresses", g };
    return { col: null, g };
  }
  if (
    has(kw, "prom", "homecoming", "ball ?gowns?", "evening dress(es)?", "occasion dress(es)?",
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

/* ---------------- canonieke dedupe ---------------- */

const FILLER = new Set([
  "women", "womens", "women's", "ladies", "lady", "for", "uk", "s", "the", "a", "female",
  // Generieke aanvul-woorden die de zoekintentie NIET veranderen — "cardigan
  // clothes" en "cardigans clothing" zijn gewoon "cardigan".
  "clothes", "clothing", "wear", "outfit", "outfits", "fashion", "style", "styles",
  "buy", "shop", "online", "cheap", "best", "sale",
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
export function buildVerdeling(rows, opts = {}) {
  const monthNames = opts.monthNames || [];
  const genders = opts.genders || "MV";
  const total = Math.max(1, Math.min(2000, Number(opts.total) || TOTAL_DEFAULT));
  const minSeason = Number(opts.minSeason) || 4000;
  const exclude = opts.exclude || new Set();
  const P = MODES[opts.mode === "focus" ? "focus" : "spread"];

  const stats = { input: rows.length, junk: 0, lowSeason: 0, unmapped: 0, genderSkip: 0 };

  // 1-3: filteren, seizoensscore, collectie
  const mapped = [];
  const seenKw = new Set();
  for (const r of rows) {
    const kw = fixSpelling(stripUk(String(r.kw || "").toLowerCase().trim()));
    if (!kw || seenKw.has(kw)) continue;
    seenKw.add(kw);
    if (exclude.has(kw) || isVerdelingJunk(kw)) {
      stats.junk++;
      continue;
    }
    const months = (r.months || []).map((v) => Number(v) || 0);
    const season = months.reduce((s, v) => s + v, 0);
    if (season < minSeason) {
      stats.lowSeason++;
      continue;
    }
    const { col, g } = collectionFor(kw);
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
    const canon = canonKey(kw);
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
  const allKws = mapped.map((m) => m.kw);
  const supportOf = (kw) => {
    let n = 0;
    for (const other of allKws) if (other !== kw && other.includes(kw)) n++;
    return n;
  };

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

  // 4a: subset-merge — zelfde avg + de ene term is (qua stemmen) een
  // deelverzameling van de andere binnen dezelfde collectie ("hoodie" vs
  // "comfort hoodie", beide 368k avg) = door Planner gegroepeerde vraag.
  // De kortste (meest generieke basis mét steun) wint.
  {
    const byColG = new Map();
    for (const r of unique) {
      const k = `${r.col}|${r.g}`;
      if (!byColG.has(k)) byColG.set(k, []);
      byColG.get(k).push(r);
    }
    const drop = new Set();
    for (const rows2 of byColG.values()) {
      for (let i = 0; i < rows2.length; i++) {
        for (let j = i + 1; j < rows2.length; j++) {
          const a = rows2[i];
          const b = rows2[j];
          if (drop.has(a) || drop.has(b) || a.avg !== b.avg || !a.avg) continue;
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
