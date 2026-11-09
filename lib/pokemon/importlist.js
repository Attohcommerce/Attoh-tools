// POKÉMON TOOL — importlijst (09-11-2026).
//
// Een importlijst zegt WAT er in de store moet, de scraper weet WAAR het te
// vinden is. Per regel van de lijst zoekt de tool de bijpassende producten bij
// alle concurrenten (zelfde set + type + taal + kenmerkende woorden), voegt
// die samen (meer prijzen, meer brontekst, beste foto's) en importeert één
// product met onze vaste titel.
//
// Regel (CSV-kolommen tussen haakjes):
//   id        (ID)        uniek, bv. "DR-ETB"
//   set       (Set)       "Delta Reign"
//   lang      (Language)  English | Japanese
//   type      (Type)      Elite Trainer Box, Booster Box, … , Case
//   title     (Title)     onze titel zonder "Pokémon TCG: "
//   variants  (Variants)  "Mega Feraligatr | Mega Meganium" → 1 product met keuzes
//   option    (Option)    naam van de keuze (standaard "Design")
//   match     (Match)     zoekwoorden in plaats van de titel, als de concurrent het anders noemt
//                         (bv. "moonlit" voor "Mega Moonlit ex Tin – Clefable"); alle woorden moeten erin staan
//   caseOf    (Case of)   id van het product in de case (alleen bij type Case)
//   caseQty   (Case qty)  aantal stuks in de case
//   price     (Price)     vaste prijs (leeg = volgens de instellingen)
//   include   (Import)    ja/nee
//   note      (Note)
import { targetPrice, SET_NAMES } from "./catalog";

// Eigen woordenlijst voor het matchen: set-, type-, taal- en vulwoorden eruit,
// maar woorden die een ANDER product aanduiden (display, mini, sleeved …) blijven.
const DROP = new Set(
  ("pokemon tcg trading card game cards card kaarten kaart the and en de het of van a an with met for voor new nieuw sealed factory official " +
    "booster boosters box boxes pack packs elite trainer etb bundle bundles blister blisters tin tins collection premium ex mega evolution evolutions me " +
    "series vol volume edition anniversary 2026 english engels eng en japanese japans jp jpn jap usa_ cn " +
    "m1 m2 m3 m4 m5 m6 m7 m8 me01 me02 me03 me04 pc stuk piece x1 1x")
    .split(" ")
);
const SET_WORDS = new Set(SET_NAMES.flatMap((n) => n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/)));
// Heeft de concurrent één van deze woorden en de regel niet → ander product
const EXCLUSIVE = new Set("display case center sleeved checklane enhanced mini 5 usa poster binder figure sticker pin deck portfolio pocket ultra night day".split(" "));

export function sig(s) {
  const t = String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/knock ?out/g, "knockout")
    .replace(/\bthree\b/g, "3")
    .replace(/\btwo\b/g, "2")
    .replace(/(\d+)\s*-?\s*(pack|booster|pocket)s?\b/g, "$1 $2")
    .replace(/pok[eé]mon center/g, "center")
    .replace(/[^a-z0-9 ]+/g, " ");
  return [...new Set(t.split(/\s+/).filter((w) => w && !DROP.has(w) && !SET_WORDS.has(w)))];
}

/* ---------- Ingebouwde lijst: alle 2026-releases (EN + JP) ---------- */

const R = (id, set, lang, type, title, extra = {}) => ({ id, set, lang, type, title, include: true, ...extra });
const EN = "English";
const JP = "Japanese";

export const PRESET_2026 = [
  // Delta Reign (nieuwste)
  R("DR-BB", "Delta Reign", EN, "Booster Box", "Delta Reign Booster Box"),
  R("DR-ETB", "Delta Reign", EN, "Elite Trainer Box", "Delta Reign Elite Trainer Box"),
  R("DR-BUN", "Delta Reign", EN, "Booster Bundle", "Delta Reign Booster Bundle"),
  R("DR-BP", "Delta Reign", EN, "Booster Pack", "Delta Reign Booster Pack"),
  R("DR-3PK", "Delta Reign", EN, "Blister", "Delta Reign 3-Pack Blister"),
  R("DR-9P", "Delta Reign", EN, "Accessories", "Delta Reign 9-Pocket Portfolio"),
  // 30th Celebration (EN)
  R("30-ETB", "30th Celebration", EN, "Elite Trainer Box", "30th Celebration Elite Trainer Box"),
  R("30-PCETB", "30th Celebration", EN, "Elite Trainer Box", "30th Celebration Pokémon Center Elite Trainer Box"),
  R("30-BUN", "30th Celebration", EN, "Booster Bundle", "30th Celebration Booster Bundle"),
  R("30-BP", "30th Celebration", EN, "Booster Pack", "30th Celebration Booster Pack"),
  R("30-MT", "30th Celebration", EN, "Tin", "30th Celebration Mini Tin"),
  R("30-MTD", "30th Celebration", EN, "Tin", "30th Celebration Mini Tin Display"),
  R("30-TIN", "30th Celebration", EN, "Tin", "30th Celebration ex Tin", { variants: ["Sylveon ex", "Greninja ex"] }),
  R("30-5TIN", "30th Celebration", EN, "Tin", "30th Celebration 5-Pack Tin (USA)", { match: "5", variants: ["Sylveon ex", "Greninja ex"] }),
  R("30-SYLBOX", "30th Celebration", EN, "Collection Box", "30th Celebration Sylveon ex Box"),
  R("30-GREBOX", "30th Celebration", EN, "Collection Box", "30th Celebration Greninja ex Box"),
  R("30-2PK", "30th Celebration", EN, "Blister", "30th Celebration 2-Pack Blister – Eevee"),
  R("30-BINDER", "30th Celebration", EN, "Collection Box", "30th Celebration Binder Collection"),
  R("30-POSTER", "30th Celebration", EN, "Collection Box", "30th Celebration Poster Collection"),
  R("30-STICK", "30th Celebration", EN, "Collection Box", "30th Celebration Tech Sticker Collection", { variants: ["Lucario", "Alolan Exeggutor"] }),
  R("30-FIG", "30th Celebration", EN, "Collection Box", "30th Celebration Figure Collection", { variants: ["Mew", "Mewtwo"] }),
  R("30-UPCD", "30th Celebration", EN, "Ultra Premium Collection", "30th Celebration Ultra Premium Collection – Day"),
  R("30-UPCN", "30th Celebration", EN, "Ultra Premium Collection", "30th Celebration Ultra Premium Collection – Night"),
  R("30-DITTO", "30th Celebration", EN, "Collection Box", "30th Celebration Ditto Premium Collection"),
  R("30-KO", "30th Celebration", EN, "Collection Box", "30th Celebration Knock Out Collection"),
  R("30-BDECK", "30th Celebration", EN, "Theme Deck", "30th Celebration Battle Deck", { variants: ["Umbreon ex", "Espeon ex"] }),
  // Ascended Heroes
  R("AH-ETB", "Ascended Heroes", EN, "Elite Trainer Box", "Ascended Heroes Elite Trainer Box"),
  R("AH-BUN", "Ascended Heroes", EN, "Booster Bundle", "Ascended Heroes Booster Bundle"),
  R("AH-BP", "Ascended Heroes", EN, "Booster Pack", "Ascended Heroes Booster Pack"),
  R("AH-MT", "Ascended Heroes", EN, "Tin", "Ascended Heroes Mini Tin"),
  R("AH-5MT", "Ascended Heroes", EN, "Tin", "Ascended Heroes Mini Tin 5-Pack (USA Exclusive)"),
  R("AH-TIN", "Ascended Heroes", EN, "Tin", "Ascended Heroes Tin", { variants: ["Mega Feraligatr", "Mega Meganium", "Mega Emboar"] }),
  R("AH-2PK", "Ascended Heroes", EN, "Blister", "Ascended Heroes 2-Pack Blister"),
  R("AH-EXBOX", "Ascended Heroes", EN, "Collection Box", "Ascended Heroes Mega ex Box", { variants: ["Mega Meganium ex", "Mega Feraligatr ex", "Mega Emboar ex"] }),
  R("AH-POSG", "Ascended Heroes", EN, "Collection Box", "Ascended Heroes Premium Poster Collection – Mega Gardevoir"),
  R("AH-POSL", "Ascended Heroes", EN, "Collection Box", "Ascended Heroes Premium Poster Collection – Mega Lucario"),
  R("AH-PIN", "Ascended Heroes", EN, "Collection Box", "Ascended Heroes First Partners Deluxe Pin Collection", { match: "deluxe pin" }),
  R("AH-STICK", "Ascended Heroes", EN, "Collection Box", "Ascended Heroes Tech Sticker Collection", { match: "tech sticker" }),
  R("AH-FF", "Ascended Heroes", EN, "Collection Box", "Ascended Heroes Focused Fighters Premium Collection"),
  R("AH-9P", "Ascended Heroes", EN, "Accessories", "Ascended Heroes 9-Pocket Portfolio"),
  // Perfect Order
  R("PO-BB", "Perfect Order", EN, "Booster Box", "Perfect Order Booster Box"),
  R("PO-ETB", "Perfect Order", EN, "Elite Trainer Box", "Perfect Order Elite Trainer Box"),
  R("PO-BUN", "Perfect Order", EN, "Booster Bundle", "Perfect Order Booster Bundle"),
  R("PO-BP", "Perfect Order", EN, "Booster Pack", "Perfect Order Booster Pack"),
  R("PO-3PK", "Perfect Order", EN, "Blister", "Perfect Order 3-Pack Blister – Chikorita"),
  R("PO-E2PK", "Perfect Order", EN, "Blister", "Perfect Order Enhanced 2-Pack Blister"),
  R("PO-CHK", "Perfect Order", EN, "Blister", "Perfect Order Premium Checklane Blister", { variants: ["Clawitzer", "Steelix", "Cinderace", "Meganium"] }),
  R("PO-9P", "Perfect Order", EN, "Accessories", "Perfect Order 9-Pocket Portfolio"),
  R("PO-4P", "Perfect Order", EN, "Accessories", "Perfect Order 4-Pocket Portfolio"),
  // Chaos Rising
  R("CR-BB", "Chaos Rising", EN, "Booster Box", "Chaos Rising Booster Box"),
  R("CR-ETB", "Chaos Rising", EN, "Elite Trainer Box", "Chaos Rising Elite Trainer Box"),
  R("CR-BUN", "Chaos Rising", EN, "Booster Bundle", "Chaos Rising Booster Bundle"),
  R("CR-BP", "Chaos Rising", EN, "Booster Pack", "Chaos Rising Booster Pack"),
  R("CR-SBP", "Chaos Rising", EN, "Blister", "Chaos Rising Sleeved Booster Pack"),
  R("CR-3PK", "Chaos Rising", EN, "Blister", "Chaos Rising 3-Pack Blister"),
  R("CR-CHK", "Chaos Rising", EN, "Blister", "Chaos Rising Premium Checklane Blister"),
  R("CR-9P", "Chaos Rising", EN, "Accessories", "Chaos Rising 9-Pocket Portfolio"),
  R("CR-4P", "Chaos Rising", EN, "Accessories", "Chaos Rising 4-Pocket Portfolio"),
  // Pitch Black
  R("PB-BB", "Pitch Black", EN, "Booster Box", "Pitch Black Booster Box"),
  R("PB-ETB", "Pitch Black", EN, "Elite Trainer Box", "Pitch Black Elite Trainer Box"),
  R("PB-BUN", "Pitch Black", EN, "Booster Bundle", "Pitch Black Booster Bundle"),
  R("PB-BP", "Pitch Black", EN, "Booster Pack", "Pitch Black Booster Pack"),
  R("PB-SBP", "Pitch Black", EN, "Blister", "Pitch Black Sleeved Booster Pack"),
  R("PB-3PK", "Pitch Black", EN, "Blister", "Pitch Black 3-Pack Blister"),
  R("PB-CHK", "Pitch Black", EN, "Blister", "Pitch Black Premium Checklane Blister"),
  R("PB-CHKD", "Pitch Black", EN, "Blister", "Pitch Black Premium Checklane Display"),
  R("PB-9P", "Pitch Black", EN, "Accessories", "Pitch Black 9-Pocket Portfolio"),
  R("PB-4P", "Pitch Black", EN, "Accessories", "Pitch Black 4-Pocket Portfolio"),
  // Overige 2026-releases (geen vaste set → set leeg, zoeken op woorden)
  R("FP-1", "", EN, "Collection Box", "First Partner Illustration Collection – Series 1"),
  R("FP-2", "", EN, "Collection Box", "First Partner Illustration Collection – Series 2"),
  R("FP-3", "", EN, "Collection Box", "First Partner Illustration Collection – Series 3"),
  R("MGRE-PC", "", EN, "Collection Box", "Mega Greninja ex Premium Collection"),
  R("MZYG-PC", "", EN, "Collection Box", "Mega Zygarde ex Premium Collection"),
  R("MLUC-LBD", "", EN, "Theme Deck", "Mega Lucario ex League Battle Deck", { match: "lucario league" }),
  R("MOON-TIN", "", EN, "Tin", "Mega Moonlit ex Tin – Clefable", { match: "moonlit" }),
  R("LUM-MT", "", EN, "Tin", "Lumiose City Mini Tin"),
  R("LUM-MTD", "", EN, "Tin", "Lumiose City Mini Tin Display"),
  R("MCHAR-TIN", "", EN, "Tin", "Mega Charizard X & Y ex Tin", { match: "charizard" }),
  R("PDAY-26", "", EN, "Collection Box", "Pokémon Day Collection 2026", { match: "day" }),
  // Japans
  R("JP30-BB", "30th Celebration", JP, "Booster Box", "30th Celebration Booster Box (Japanese)"),
  R("JP30-BP", "30th Celebration", JP, "Booster Pack", "30th Celebration Booster Pack (Japanese)"),
  R("JP30-FUT", "30th Celebration", JP, "Collection Box", "30th Celebration Futuristic Collection Box (Japanese)"),
  R("JP30-DECK", "30th Celebration", JP, "Theme Deck", "30th Celebration Premium Deck Set – Espeon & Umbreon (Japanese)", { match: "espeon umbreon deck" }),
  R("JP30-FPCS", "30th Celebration", JP, "Collection Box", "30th Celebration First Partner Card Set (Japanese)", {
    option: "Generation",
    variants: ["Gen 1", "Gen 2", "Gen 3", "Gen 4", "Gen 5", "Gen 6", "Gen 7", "Gen 8", "Gen 9", "Complete set of 9"],
  }),
  R("NZ-BB", "Nihil Zero", JP, "Booster Box", "Nihil Zero Booster Box (Japanese, M3)"),
  R("NZ-BP", "Nihil Zero", JP, "Booster Pack", "Nihil Zero Booster Pack (Japanese, M3)"),
  R("NS-BB", "Ninja Spinner", JP, "Booster Box", "Ninja Spinner Booster Box (Japanese, M4)"),
  R("NS-BP", "Ninja Spinner", JP, "Booster Pack", "Ninja Spinner Booster Pack (Japanese, M4)"),
  R("AE-BB", "Abyss Eye", JP, "Booster Box", "Abyss Eye Booster Box (Japanese, M5)"),
  R("AE-BP", "Abyss Eye", JP, "Booster Pack", "Abyss Eye Booster Pack (Japanese, M5)"),
  R("SE-BB", "Storm Emeralda", JP, "Booster Box", "Storm Emeralda Booster Box (Japanese, M6)"),
  R("SE-BP", "Storm Emeralda", JP, "Booster Pack", "Storm Emeralda Booster Pack (Japanese, M6)"),
  // Cases (geen concurrent verkoopt ze → zelf samengesteld uit het losse product)
  R("DR-BB-CASE", "Delta Reign", EN, "Case", "Delta Reign Booster Box Case (6 Booster Boxes)", { caseOf: "DR-BB", caseQty: 6 }),
  R("PB-BB-CASE", "Pitch Black", EN, "Case", "Pitch Black Booster Box Case (6 Booster Boxes)", { caseOf: "PB-BB", caseQty: 6 }),
  R("CR-BB-CASE", "Chaos Rising", EN, "Case", "Chaos Rising Booster Box Case (6 Booster Boxes)", { caseOf: "CR-BB", caseQty: 6 }),
  R("PO-BB-CASE", "Perfect Order", EN, "Case", "Perfect Order Booster Box Case (6 Booster Boxes)", { caseOf: "PO-BB", caseQty: 6 }),
  R("DR-ETB-CASE", "Delta Reign", EN, "Case", "Delta Reign Elite Trainer Box Case (10 ETBs)", { caseOf: "DR-ETB", caseQty: 10 }),
  R("30-ETB-CASE", "30th Celebration", EN, "Case", "30th Celebration Elite Trainer Box Case (10 ETBs)", { caseOf: "30-ETB", caseQty: 10 }),
  R("AH-ETB-CASE", "Ascended Heroes", EN, "Case", "Ascended Heroes Elite Trainer Box Case (10 ETBs)", { caseOf: "AH-ETB", caseQty: 10 }),
  R("PB-ETB-CASE", "Pitch Black", EN, "Case", "Pitch Black Elite Trainer Box Case (10 ETBs)", { caseOf: "PB-ETB", caseQty: 10 }),
  R("CR-ETB-CASE", "Chaos Rising", EN, "Case", "Chaos Rising Elite Trainer Box Case (10 ETBs)", { caseOf: "CR-ETB", caseQty: 10 }),
  R("PO-ETB-CASE", "Perfect Order", EN, "Case", "Perfect Order Elite Trainer Box Case (10 ETBs)", { caseOf: "PO-ETB", caseQty: 10 }),
  R("NZ-BB-CASE", "Nihil Zero", JP, "Case", "Nihil Zero Booster Box Case (12 Boxes, Japanese, M3)", { caseOf: "NZ-BB", caseQty: 12 }),
  R("NS-BB-CASE", "Ninja Spinner", JP, "Case", "Ninja Spinner Booster Box Case (12 Boxes, Japanese, M4)", { caseOf: "NS-BB", caseQty: 12 }),
  R("AE-BB-CASE", "Abyss Eye", JP, "Case", "Abyss Eye Booster Box Case (12 Boxes, Japanese, M5)", { caseOf: "AE-BB", caseQty: 12 }),
  R("SE-BB-CASE", "Storm Emeralda", JP, "Case", "Storm Emeralda Booster Box Case (12 Boxes, Japanese, M6)", { caseOf: "SE-BB", caseQty: 12 }),
];

/* ---------- CSV in/uit ---------- */

const COLS = [
  ["id", "ID"], ["set", "Set"], ["lang", "Language"], ["type", "Type"], ["title", "Title"], ["variants", "Variants"],
  ["option", "Option"], ["match", "Match"], ["caseOf", "Case of"], ["caseQty", "Case qty"], ["price", "Price"],
  ["include", "Import"], ["note", "Note"],
];
const HEAD_ALIAS = {
  id: "id", set: "set", language: "lang", lang: "lang", taal: "lang", type: "type", title: "title", titel: "title", product: "title",
  variants: "variants", varianten: "variants", option: "option", optie: "option", match: "match", zoekwoorden: "match",
  "case of": "caseOf", caseof: "caseOf", "case qty": "caseQty", caseqty: "caseQty", price: "price", prijs: "price",
  import: "include", importeren: "include", include: "include", note: "note", opmerking: "note",
};

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  const head = COLS.map((c) => c[1]).join(",");
  const body = rows.map((r) =>
    COLS.map(([k]) => {
      if (k === "variants") return csvCell((r.variants || []).join(" | "));
      if (k === "include") return r.include === false ? "no" : "yes";
      return csvCell(r[k]);
    }).join(",")
  );
  return [head, ...body].join("\n");
}

function splitLine(line, d) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** CSV/TSV (komma, puntkomma of tab; Excel "Opslaan als CSV" werkt) → regels. */
export function parseCsv(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const d = first.includes("\t") ? "\t" : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const heads = splitLine(first, d).map((h) => HEAD_ALIAS[h.toLowerCase().replace(/\s+/g, " ").trim()] || null);
  const rows = [];
  lines.slice(1).forEach((l, n) => {
    const cells = splitLine(l, d);
    const r = {};
    heads.forEach((h, i) => {
      if (h) r[h] = cells[i] || "";
    });
    if (!r.title) return;
    r.title = r.title.replace(/^pok[eé]mon tcg:\s*/i, "").trim();
    r.id = r.id || `ROW-${n + 1}`;
    r.lang = /jap/i.test(r.lang) ? JP : r.lang || EN;
    r.variants = r.variants ? r.variants.split(/\s*[|]\s*/).filter(Boolean) : undefined;
    r.caseQty = r.caseQty ? Number(r.caseQty) || undefined : undefined;
    r.price = r.price ? Number(String(r.price).replace(/[^\d.,]/g, "").replace(",", ".")) || undefined : undefined;
    r.include = !/^(no|nee|n|0|false)$/i.test(r.include || "");
    for (const k of Object.keys(r)) if (r[k] === "" || r[k] === undefined) delete r[k];
    rows.push(r);
  });
  return rows;
}

/* ---------- Matchen met de scraper-catalogus ---------- */

// Alle woorden van de regel moeten erin staan; daarna: hoe minder extra woorden, hoe beter.
function scoreGroup(rowSig, g) {
  const gs = sig(g.title);
  if (rowSig.some((w) => !gs.includes(w))) return null;
  const extra = gs.filter((w) => !rowSig.includes(w));
  if (extra.some((w) => EXCLUSIVE.has(w))) return null;
  return -extra.length;
}

// Typen die vaak anders heten bij een concurrent (bv. "Premium Deck Set" = Collection Box of Deck)
const LOOSE = new Set(["Collection Box", "Other", "Theme Deck", "Single Card", "Blister", "Tin", "Ultra Premium Collection", "Plush & Figures"]);

function findGroups(groups, { set, lang, type, words }) {
  const rowSig = sig(words);
  // zonder set = losse release: alleen producten waar de scraper ook geen (echte) set in zag
  const base = groups.filter((g) => g.lang === lang && (set ? g.set === set : !g.set || g.set === "Mega Evolution"));
  const pass = (list) => {
    const scored = list.map((g) => ({ g, s: scoreGroup(rowSig, g) })).filter((x) => x.s !== null).sort((a, b) => b.s - a.s);
    if (!scored.length) return [];
    return scored.filter((x) => x.s >= scored[0].s - 0.01).map((x) => x.g);
  };
  let hit = pass(base.filter((g) => g.type === type));
  // tweede ronde met verwante typen, alleen als de regel genoeg eigen woorden heeft
  if (!hit.length && LOOSE.has(type) && rowSig.length >= 1) hit = pass(base.filter((g) => LOOSE.has(g.type)));
  return hit;
}

function mergeGroups(list) {
  const sources = [];
  const seen = new Set();
  for (const g of list) for (const s of g.sources || []) if (!seen.has(s.url)) seen.add(s.url) && sources.push(s);
  const prices = sources.map((s) => Number(s.price) || 0).filter((n) => n > 0).sort((a, b) => a - b);
  const best = list.map((g) => g.best).filter(Boolean).sort((a, b) => (b.images || []).length * 1000 + String(b.body || "").length - ((a.images || []).length * 1000 + String(a.body || "").length))[0] || null;
  const fullSources = list.flatMap((g) => g.fullSources || (g.best ? [g.best] : []));
  return {
    keys: list.map((g) => g.key),
    sources,
    best,
    fullSources,
    image: list.map((g) => g.image).find(Boolean) || "",
    imageCount: Math.max(0, ...list.map((g) => g.imageCount || 0)),
    minPrice: prices[0] || 0,
    medianPrice: prices.length ? prices[Math.floor((prices.length - 1) / 2)] : 0,
    maxPrice: prices[prices.length - 1] || 0,
    currency: (sources[0] && sources[0].currency) || "",
  };
}

const CASE_DISCOUNT = 0.05;

/**
 * Per regel: welke concurrent-producten horen erbij, wat wordt onze prijs.
 * groups = groupProducts(...) (volledig, met best) of de lichte versie.
 */
export function matchRows(rows, groups, settings = {}) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map();
  const priceOf = (m) => targetPrice(m, { mode: settings.priceMode || "min", factor: settings.factor || 1, ending: settings.ending || ".95" });

  function one(r) {
    if (out.has(r.id)) return out.get(r.id);
    let res;
    if (r.type === "Case") {
      const base = byId.get(r.caseOf);
      const b = base ? one(base) : null;
      const qty = Number(r.caseQty) || 0;
      const unit = b && b.price ? b.price : 0;
      const raw = unit * qty * (1 - (settings.caseDiscount ?? CASE_DISCOUNT));
      const price = r.price || (raw ? targetPrice({ minPrice: raw, medianPrice: raw, maxPrice: raw }, { mode: "min", ending: settings.ending || ".95" }) : 0);
      res = { id: r.id, ok: !!(b && b.ok && qty), base: r.caseOf, qty, unitPrice: unit, price, match: b ? b.match : null, variants: [], why: !base ? `basisproduct ${r.caseOf} staat niet in de lijst` : !b.ok ? `basisproduct ${r.caseOf} niet gevonden` : !qty ? "aantal per case ontbreekt" : "" };
    } else if (r.variants && r.variants.length) {
      const base = findGroups(groups, { set: r.set, lang: r.lang, type: r.type, words: r.match || r.title });
      const variants = r.variants.map((v) => {
        let gs = findGroups(groups, { set: r.set, lang: r.lang, type: r.type, words: `${r.match || r.title} ${v}` });
        // variant staat niet apart bij de concurrent → algemene match gebruiken
        const exact = gs.length && gs.some((g) => sig(v).some((w) => sig(g.title).includes(w)));
        if (!exact) gs = base;
        const m = gs.length ? mergeGroups(gs) : null;
        return { name: v, ok: !!m, exact: !!exact, match: m, price: m ? priceOf(m) : 0 };
      });
      const all = mergeGroups([...new Map(variants.filter((v) => v.match).flatMap((v) => v.match.keys.map((k) => [k, groups.find((g) => g.key === k)]))).values()].filter(Boolean));
      const okV = variants.filter((v) => v.ok);
      res = { id: r.id, ok: okV.length > 0, match: okV.length ? all : null, variants, price: r.price || (okV.length ? Math.min(...okV.map((v) => v.price || Infinity)) : 0), why: okV.length ? "" : "geen concurrent gevonden" };
    } else {
      const gs = findGroups(groups, { set: r.set, lang: r.lang, type: r.type, words: r.match || r.title });
      const m = gs.length ? mergeGroups(gs) : null;
      res = { id: r.id, ok: !!m, match: m, variants: [], price: r.price || (m ? priceOf(m) : 0), why: m ? "" : "geen concurrent gevonden" };
    }
    out.set(r.id, res);
    return res;
  }
  return rows.map((r) => ({ row: r, ...one(r) }));
}

/** Licht maken voor de browser (geen omschrijvingen). */
export function lightMatch(m) {
  const lm = (x) => (x ? { keys: x.keys, sources: x.sources, image: x.image, imageCount: x.imageCount, minPrice: x.minPrice, maxPrice: x.maxPrice, currency: x.currency } : null);
  return { id: m.id, ok: m.ok, why: m.why, price: m.price, qty: m.qty, base: m.base, unitPrice: m.unitPrice, match: lm(m.match), variants: (m.variants || []).map((v) => ({ name: v.name, ok: v.ok, exact: v.exact, price: v.price, match: lm(v.match) })) };
}
