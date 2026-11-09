// POKÉMON TOOL (07-11-2026) — herkennen, indelen en ontdubbelen van
// Pokémon-producten. Puur (geen server- of browser-API's): bruikbaar in de
// API-routes én in de pagina.
//
// Elk gescrapet product krijgt:
//   type   — Elite Trainer Box, Booster Box, Booster Pack, Tin, …
//   set    — Surging Sparks, 151, Evolving Skies, … (uit de lijst hieronder)
//   era    — Scarlet & Violet, Sword & Shield, Mega Evolution, …
//   lang   — English, Japanese, Korean, Chinese, …
//   key    — ontdubbel-sleutel: hetzelfde product bij 3 concurrenten = 1 rij

/* ---------- Is het Pokémon? ---------- */

const POKE_RE = /pok[eé]mon|ptcg|pikachu|charizard|eevee|mewtwo/i;
// Andere kaartspellen die vaak in dezelfde winkels staan
const OTHER_TCG_RE = /one piece|magic:? the gathering|\bmtg\b|yu-?gi-?oh|lorcana|dragon ?ball|digimon|flesh and blood|star wars unlimited|weiss|union arena|sorcery/i;

export function isPokemon(p) {
  const hay = [p.title, p.productType, p.vendor, p.tags, p.category].join(" ");
  if (POKE_RE.test(hay)) return true;
  if (OTHER_TCG_RE.test(hay)) return false;
  // Set-naam zonder het woord Pokémon ("Surging Sparks ETB")
  return !!detectSet(p.title || "");
}

/* ---------- Sets (nieuwste eerst; aanvulbaar) ---------- */

// [naam, era, extra zoekpatronen]
const SETS = [
  // Mega Evolution-era (2025–2026) — lijst bijgewerkt 09-11 met de sets uit de competitor-menu's
  ["Delta Reign", "Mega Evolution"],
  ["30th Celebration", "Mega Evolution", [/30th (celebration|anniversary)/i]],
  ["Pitch Black", "Mega Evolution"],
  ["Chaos Rising", "Mega Evolution"],
  ["Perfect Order", "Mega Evolution"],
  ["Ascended Heroes", "Mega Evolution"],
  ["Phantasmal Flames", "Mega Evolution"],
  ["Mega Evolution", "Mega Evolution", [/\bmega evolution\b(?! era)/i, /\bme0?1\b/i]],
  // Scarlet & Violet
  ["Black Bolt", "Scarlet & Violet"],
  ["White Flare", "Scarlet & Violet"],
  ["Destined Rivals", "Scarlet & Violet"],
  ["Journey Together", "Scarlet & Violet"],
  ["Prismatic Evolutions", "Scarlet & Violet", [/prismatic/i]],
  ["Surging Sparks", "Scarlet & Violet"],
  ["Stellar Crown", "Scarlet & Violet"],
  ["Shrouded Fable", "Scarlet & Violet"],
  ["Twilight Masquerade", "Scarlet & Violet"],
  ["Temporal Forces", "Scarlet & Violet"],
  ["Paldean Fates", "Scarlet & Violet"],
  ["Paradox Rift", "Scarlet & Violet"],
  ["151", "Scarlet & Violet", [/\b151\b/, /pokemon card 151/i]],
  ["Obsidian Flames", "Scarlet & Violet"],
  ["Paldea Evolved", "Scarlet & Violet"],
  ["Scarlet & Violet Base", "Scarlet & Violet", [/scarlet (&|and) violet (base|booster|elite|etb)/i]],
  // Sword & Shield
  ["Crown Zenith", "Sword & Shield"],
  ["Silver Tempest", "Sword & Shield"],
  ["Lost Origin", "Sword & Shield"],
  ["Pokémon GO", "Sword & Shield", [/pok[eé]mon go\b/i]],
  ["Astral Radiance", "Sword & Shield"],
  ["Brilliant Stars", "Sword & Shield"],
  ["Fusion Strike", "Sword & Shield"],
  ["Celebrations", "Sword & Shield", [/celebrations|25th anniversary/i]],
  ["Evolving Skies", "Sword & Shield"],
  ["Chilling Reign", "Sword & Shield"],
  ["Battle Styles", "Sword & Shield"],
  ["Shining Fates", "Sword & Shield"],
  ["Vivid Voltage", "Sword & Shield"],
  ["Champion's Path", "Sword & Shield", [/champion'?s path/i]],
  ["Darkness Ablaze", "Sword & Shield"],
  ["Rebel Clash", "Sword & Shield"],
  ["Sword & Shield Base", "Sword & Shield", [/sword (&|and) shield (base|booster|elite|etb)/i]],
  // Sun & Moon / ouder
  ["Hidden Fates", "Sun & Moon"],
  ["Cosmic Eclipse", "Sun & Moon"],
  ["Unified Minds", "Sun & Moon"],
  ["Team Up", "Sun & Moon"],
  ["Evolutions", "XY", [/\bxy evolutions\b|\bevolutions\b(?! ?(skies|prismatic))/i]],
  ["Base Set", "Vintage", [/\bbase set\b/i]],
  ["Jungle", "Vintage", [/\bjungle\b/i]],
  ["Fossil", "Vintage", [/\bfossil\b/i]],
  ["Team Rocket", "Vintage", [/\bteam rocket\b(?!.*glory)/i]],
  // Japanse sets
  ["Storm Emeralda", "Japanese"],
  ["Abyss Eye", "Japanese"],
  ["Ninja Spinner", "Japanese"],
  ["Nihil Zero", "Japanese"],
  ["Mega Dream ex", "Japanese", [/mega dream/i]],
  ["Inferno X", "Japanese", [/inferno x/i]],
  ["Mega Brave", "Japanese", [/mega brave/i]],
  ["Mega Symphonia", "Japanese", [/mega symphonia/i]],
  ["Glory of Team Rocket", "Japanese", [/glory of team rocket/i]],
  ["Heat Wave Arena", "Japanese"],
  ["Battle Partners", "Japanese"],
  ["Terastal Festival ex", "Japanese", [/terastal fes/i]],
  ["Super Electric Breaker", "Japanese"],
  ["Paradise Dragona", "Japanese"],
  ["Night Wanderer", "Japanese"],
  ["Stellar Miracle", "Japanese"],
  ["Shiny Treasure ex", "Japanese", [/shiny treasure/i]],
  ["VSTAR Universe", "Japanese", [/vstar universe/i]],
  ["Clay Burst", "Japanese"],
  ["Snow Hazard", "Japanese"],
  ["Wild Force", "Japanese"],
  ["Cyber Judge", "Japanese"],
  ["Crimson Haze", "Japanese"],
  ["Mask of Change", "Japanese"],
  ["Raging Surf", "Japanese"],
  ["Ruler of the Black Flame", "Japanese"],
  ["Future Flash", "Japanese"],
  ["Ancient Roar", "Japanese"],
  ["Triplet Beat", "Japanese"],
].map(([name, era, extra]) => ({
  name,
  era,
  res: [new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "(&|and)").replace(/'/g, "'?") + "\\b", "i"), ...(extra || [])],
}));

export const SET_NAMES = SETS.map((s) => s.name);
export const ERA_OF = Object.fromEntries(SETS.map((s) => [s.name, s.era]));

export function detectSet(text) {
  const t = String(text || "");
  for (const s of SETS) if (s.res.some((re) => re.test(t))) return s.name;
  return "";
}

/* ---------- Producttype ---------- */

// Volgorde telt: specifiek vóór algemeen
const TYPES = [
  ["Graded Card", /\b(psa|bgs|cgc|beckett)\s?\d|\bgraded\b|\bslab\b/i],
  ["Accessories", /sleeve|binder(?! collection)|portfolio|deck ?box|playmat|toploader|top loader|card protector|storage box|album|9-pocket|4-pocket|qware|acrylic|display case|protector case/i],
  // Hele dozen per case/doos van de distributeur (09-11)
  ["Case", /\b(booster box|elite trainer box|etb|booster bundle|display|tin) case\b|\bcase of \d+|\(\d+x (booster box|etb|elite trainer box)\)|\bsealed case\b/i],
  // Displays van kleine producten horen bij dat product, niet bij Booster Box
  ["Tin", /mini tin display|tin display/i],
  ["Blister", /checklane display|blister display/i],
  ["Plush & Figures", /\bplush|knuffel|figure|figurine|funko|statue/i],
  ["Elite Trainer Box", /elite trainer box|\betb\b|trainer box/i],
  ["Booster Bundle", /booster bundle|bundle of 6|6[- ]pack bundle/i],
  ["Booster Box", /booster (box|display)|display box|\bdisplay\b|36 (booster|pack)|30 (booster|pack)|\bbooster case\b|\bbb\b/i],
  ["Ultra Premium Collection", /ultra[- ]premium/i],
  ["Build & Battle", /build (&|and) battle/i],
  ["Tin", /\btins?\b|mini tin|poke ?ball tin/i],
  ["Blister", /blister|checklane|3[- ]pack|three[- ]pack|2[- ]pack|sleeved booster/i],
  ["Collection Box", /collection|premium|\bbox set\b|\bex box\b|\bv box\b|special set|poster box|binder collection|figure collection|\bgift box\b/i],
  ["Booster Pack", /booster pack|\bbooster\b|\bpack\b|enhanced expansion|high[- ]class pack/i],
  ["Single Card", /\b\d{1,3}\s?\/\s?\d{1,3}\b|single card|\bholo\b|reverse holo|full art|illustration rare|secret rare|\bsar\b|\bsir\b|\bpromo\b/i],
  ["Theme Deck", /theme deck|battle deck|starter deck|league battle deck|\bdeck\b/i],
];
export const TYPE_NAMES = TYPES.map((t) => t[0]);

// Collectie-titels (meervoud) voor de store
export const TYPE_COLLECTION = {
  "Graded Card": "Graded Cards",
  Accessories: "Accessories",
  "Plush & Figures": "Plush & Figures",
  "Elite Trainer Box": "Elite Trainer Boxes",
  "Booster Bundle": "Booster Bundles",
  "Booster Box": "Booster Boxes",
  "Ultra Premium Collection": "Ultra Premium Collections",
  "Build & Battle": "Build & Battle Boxes",
  Tin: "Tins",
  Blister: "Blisters",
  "Collection Box": "Collection Boxes",
  "Booster Pack": "Booster Packs",
  "Single Card": "Single Cards",
  "Theme Deck": "Decks",
  Case: "Cases",
  Other: "Other",
};
export const SEALED_TYPES = new Set([
  "Elite Trainer Box", "Booster Bundle", "Booster Box", "Ultra Premium Collection", "Build & Battle",
  "Tin", "Blister", "Collection Box", "Booster Pack", "Theme Deck", "Case",
]);

export function detectType(p) {
  const t = String(p.title || "");
  for (const [name, re] of TYPES) if (re.test(t)) return name;
  const extra = [p.productType, p.tags].join(" ");
  for (const [name, re] of TYPES) if (re.test(extra)) return name;
  return "Other";
}

/* ---------- Taal ---------- */

const LANGS = [
  ["Japanese", /japan|japanese|japans|\bjp\b|\bjpn\b|\(jp\)|japanisch/i],
  ["Korean", /korea|korean|koreaans|\bkr\b/i],
  ["Chinese", /chinese|chinees|simplified|traditional|\bs-chinese|\bt-chinese|\bcn\b/i],
  ["Thai", /\bthai\b/i],
  ["Indonesian", /indonesia/i],
  ["German", /german|deutsch|duits/i],
  ["French", /french|fran[cç]ais|frans/i],
  ["Dutch", /dutch|nederlands/i],
  ["Spanish", /spanish|espa[nñ]ol|spaans/i],
  ["Italian", /italian|italiano|italiaans/i],
  ["English", /english|engels|\beng\b|\ben\b/i],
];
export const LANG_NAMES = LANGS.map((l) => l[0]);

export function detectLang(p) {
  const t = [p.title, p.tags, p.productType].join(" ");
  for (const [name, re] of LANGS) if (re.test(t)) return name;
  return "English";
}

/* ---------- Ontdubbel-sleutel ---------- */

const STOP = new Set(
  "pokemon pokémon tcg trading card game cards card kaarten kaart the and en de het of van a an new nieuw sealed factory official english engels edition box pack booster elite trainer etb display bundle collection tin blister premium ex vstar vmax gx v scarlet violet sword shield mega evolution sv swsh me with met"
    .split(" ")
);
const SET_WORDS = new Set(SETS.flatMap((s) => s.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)));

function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !SET_WORDS.has(w) && !LANG_WORDS.has(w));
}
const LANG_WORDS = new Set("japanese japans jp jpn korean koreaans kr chinese chinees german deutsch french francais dutch nederlands spanish italian english engels eng en".split(" "));

/** Betekenisvolle woorden van een titel (zonder set-, type-, taal- en stopwoorden). */
export function sigTokens(s) {
  return [...new Set(tokens(s))];
}

export function productKey(p) {
  const set = p.set || detectSet(p.title);
  const type = p.type || detectType(p);
  const lang = p.lang || detectLang(p);
  const tk = [...new Set(tokens(p.title))];
  // "display" is een stopwoord (booster display = booster box), maar een Mini Tin
  // Display of Checklane Display is een ander product dan één tin/blister (09-11)
  if (type !== "Booster Box" && /\bdisplay\b/i.test(p.title || "")) tk.push("display");
  const rest = tk.sort().slice(0, 6).join("-");
  return [lang, type, set || "-", rest || "-"].join("|").toLowerCase();
}

/* ---------- Indelen ---------- */

export function classify(p) {
  const set = detectSet([p.title, p.tags].join(" "));
  const type = detectType(p);
  let lang = detectLang(p);
  // Sets die alleen in Japan uitkomen zijn altijd Japans, ook als de titel het niet zegt
  if (set && ERA_OF[set] === "Japanese" && lang === "English") lang = "Japanese";
  const out = { ...p, set, era: set ? ERA_OF[set] : "", type, lang };
  out.key = productKey(out);
  return out;
}

/** Zelfde product bij meerdere concurrenten → één groep met prijsbereik. */
export function groupProducts(list) {
  const map = new Map();
  for (const p of list) {
    const g = map.get(p.key);
    if (!g) {
      map.set(p.key, { key: p.key, best: p, sources: [p] });
      continue;
    }
    g.sources.push(p);
    // beste bron: meeste foto's, dan langste omschrijving
    const score = (x) => (x.images || []).length * 1000 + String(x.body || "").length;
    if (score(p) > score(g.best)) g.best = p;
  }
  return [...map.values()].map((g) => {
    const prices = g.sources.map((s) => Number(s.price) || 0).filter((n) => n > 0).sort((a, b) => a - b);
    return {
      key: g.key,
      title: g.best.title,
      type: g.best.type,
      set: g.best.set,
      era: g.best.era,
      lang: g.best.lang,
      image: (g.best.images || [])[0] || "",
      imageCount: (g.best.images || []).length,
      best: g.best,
      fullSources: g.sources,
      sources: g.sources.map((s) => ({ domain: s.domain, url: s.url, price: s.price, currency: s.currency, available: s.available })),
      minPrice: prices[0] || 0,
      medianPrice: prices.length ? prices[Math.floor((prices.length - 1) / 2)] : 0,
      maxPrice: prices[prices.length - 1] || 0,
      anyAvailable: g.sources.some((s) => s.available),
    };
  });
}

/* ---------- Prijzen ---------- */

/** Prijs volgens de instelling: concurrent laagste/mediaan × factor, met nette eindes. */
export function targetPrice(group, { mode = "min", factor = 1, ending = ".95" } = {}) {
  const base = mode === "median" ? group.medianPrice : mode === "max" ? group.maxPrice : group.minPrice;
  if (!base) return 0;
  let p = base * (Number(factor) || 1);
  if (ending === ".95" || ending === ".99") {
    const cents = ending === ".95" ? 0.95 : 0.99;
    // dichtstbijzijnde x.95 / x.99 (afronden naar boven bij twijfel)
    p = Math.floor(p) + cents;
    if (p < base * (Number(factor) || 1) - 0.5) p += 1;
  } else if (ending === "4.95/9.95") {
    // Justins vaste regel: eindigt op 4,95 of 9,95
    const tens = Math.floor(p / 10) * 10;
    const cands = [tens - 0.05, tens + 4.95, tens + 9.95].filter((c) => c > 0);
    p = cands.reduce((best, c) => (Math.abs(c - p) < Math.abs(best - p) ? c : best), cands[0]);
  } else {
    p = Math.round(p * 100) / 100;
  }
  return Math.round(p * 100) / 100;
}

/* ---------- Tekst-gelijkheid (plagiaatcheck) ---------- */

export function stripHtml(h) {
  return String(h || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(text, n = 5) {
  const w = stripHtml(text).toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** Deel van ONZE tekst dat letterlijk (5-woord-reeksen) in de bron staat: 0..1 */
export function copyRatio(ours, source) {
  const a = shingles(ours);
  if (!a.size) return 0;
  const b = shingles(source);
  if (!b.size) return 0;
  let hit = 0;
  for (const s of a) if (b.has(s)) hit++;
  return hit / a.size;
}

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/** Standaard titel: "Pokémon TCG: Surging Sparks Elite Trainer Box" (+ taal als niet Engels). */
export function standardTitle({ title, set, type, lang }) {
  const core = String(title || "")
    .replace(/pok[eé]mon( tcg| trading card game)?[:\s-]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  let t = `Pokémon TCG: ${core}`;
  if (lang && lang !== "English" && !new RegExp(lang, "i").test(t)) t += ` (${lang})`;
  return t.slice(0, 140);
}
