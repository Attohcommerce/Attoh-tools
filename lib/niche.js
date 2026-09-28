/* NICHE KIEZEN — rekenwerk voor de niche-research.

   Werkwijze (zie het masterplan): eerst de markt kiezen, dan per kandidaat-
   niche één Keyword Planner-batch van 10 seeds, 4 jaar historie. Deze module
   voegt die batches samen tot één lijst (met per keyword de niche waar het
   uit komt), berekent per keyword de trend over meerdere jaren en maakt per
   niche een scorecard. De niche met het meeste volume wint NIET vanzelf:
   de kansscore weegt vraag, groei, seizoensfit en concurrentie.

   Puur JS, geen server- of browser-afhankelijkheden: draait in de pagina. */

const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Nederlandse sleutels zoals de rest van de tool ze gebruikt (mrt, mei, okt)
const NL_TO_IDX = { jan: 0, feb: 1, mrt: 2, apr: 3, mei: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11 };

/* ---------- CSV ---------- */

/** Keyword Planner-export (tekst, al gedecodeerd) → rijen.
 *  Werkt met Engelse én Nederlandse exports: "Three month change" of
 *  "Wijziging over 3 maanden", en decimalen als "0,27" of "0.27". */
export function parsePlannerText(text, fileName = "") {
  const lines = String(text).split("\n").map((l) => l.replace(/\r$/, ""));
  const hi = lines.findIndex((l) => l.startsWith("Keyword\t"));
  if (hi === -1) throw new Error(`${fileName}: geen Keyword Planner-export`);
  const period = (lines.slice(0, hi).find((l) => /\d{4}/.test(l)) || "").trim();

  const head = lines[hi].split("\t");
  const find = (...res) => head.findIndex((h) => res.some((r) => r.test(String(h || "").trim())));
  const avgIdx = find(/^Avg\. monthly searches/i, /^Gem\. aantal zoekopdrachten/i);
  const curIdx = find(/^Currency$/i, /^Valuta$/i);
  const compTxtIdx = find(/^Competition$/i, /^Concurrentie$/i);
  const compIdxIdx = find(/^Competition \(indexed/i, /^Concurrentie \(ge/i);
  const bidLowIdx = find(/bid \(low/i, /bod.*\(laag/i);
  const bidHighIdx = find(/bid \(high/i, /bod.*\(hoog/i);
  const chg3Idx = find(/^Three month change/i, /^Wijziging over 3 maanden/i);
  const yoyIdx = find(/^YoY change/i, /^Wijziging jaar op jaar/i);
  const monthIdx = [];
  const monthNames = [];
  head.forEach((h, i) => {
    const m = String(h).match(/^(?:Searches|Zoekopdrachten):\s*(.+)$/i);
    if (m) {
      monthIdx.push(i);
      monthNames.push(m[1].trim());
    }
  });
  if (avgIdx === -1 || !monthIdx.length) throw new Error(`${fileName}: kolommen niet herkend`);

  const clean = (v) => String(v ?? "").trim().replace(/^"|"$/g, "").trim();
  const int = (v) => {
    const s = clean(v).replace(/[.\s]/g, "");
    return /^\d+$/.test(s) ? parseInt(s, 10) : 0;
  };
  const dec = (v) => {
    let s = clean(v);
    if (!s) return "";
    // "1.234,56" of "0,27" (NL) → punt als decimaal; "1,234.56" (EN) → komma weg
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : "";
  };
  const pct = (v) => {
    const s = clean(v);
    if (!s || s === "-") return "";
    if (s.includes("∞")) return 9999;
    const t = s.replace(/%/g, "");
    const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    return Number.isFinite(n) ? n : "";
  };

  const rows = [];
  let currency = "";
  for (const l of lines.slice(hi + 1)) {
    if (!l.trim()) continue;
    const p = l.split("\t");
    const kw = clean(p[0]).toLowerCase();
    if (!kw) continue;
    if (!currency && curIdx >= 0) currency = clean(p[curIdx]);
    rows.push({
      kw,
      avg: int(p[avgIdx]),
      months: monthIdx.map((i) => int(p[i])),
      comp: compTxtIdx >= 0 ? clean(p[compTxtIdx]) : "",
      compIdx: compIdxIdx >= 0 ? dec(p[compIdxIdx]) : "",
      bidLow: bidLowIdx >= 0 ? dec(p[bidLowIdx]) : "",
      bidHigh: bidHighIdx >= 0 ? dec(p[bidHighIdx]) : "",
      chg3: chg3Idx >= 0 ? pct(p[chg3Idx]) : "",
      yoy: yoyIdx >= 0 ? pct(p[yoyIdx]) : "",
    });
  }
  // De eerste rij van een export is de eerste seed → standaard nichenaam
  const seed = rows.length ? rows[0].kw : "";
  return { rows, monthNames, currency, period, seed };
}

/* ---------- Samenvoegen ---------- */

/** Batches → één lijst. Staat een keyword in meerdere batches, dan houdt het
 *  de niche van de batch waarin het het hoogste volume had; de andere
 *  niches gaan mee in "alsoIn". Lege extra velden worden aangevuld. */
export function mergeBatches(batches) {
  const EXTRA = ["comp", "compIdx", "bidLow", "bidHigh", "chg3", "yoy"];
  const merged = new Map();
  let monthNames = null;
  for (const b of batches) {
    if (!b || !b.rows) continue;
    if (!monthNames || b.monthNames.length > monthNames.length) monthNames = b.monthNames;
    for (const r of b.rows) {
      const cur = merged.get(r.kw);
      if (!cur) {
        merged.set(r.kw, { ...r, niche: b.niche, alsoIn: [] });
        continue;
      }
      const winNew = r.avg > cur.avg;
      const win = winNew ? { ...r, niche: b.niche, alsoIn: [...cur.alsoIn, cur.niche] } : { ...cur };
      if (!winNew && b.niche !== cur.niche && !cur.alsoIn.includes(b.niche)) win.alsoIn = [...cur.alsoIn, b.niche];
      const lose = winNew ? cur : r;
      for (const f of EXTRA) if (win[f] === "" || win[f] == null) win[f] = lose[f];
      win.alsoIn = win.alsoIn.filter((n) => n !== win.niche);
      merged.set(r.kw, win);
    }
  }
  return { rows: [...merged.values()].sort((a, b) => b.avg - a.avg), monthNames: monthNames || [] };
}

/* ---------- Varianten en merken ---------- */

/** Keyword Planner geeft spelvarianten en woordvolgordes van dezelfde
 *  zoekvraag ("charcuterie board", "chartreuse board", "boards for
 *  charcuterie") elk het VOLLEDIGE groepsvolume. Zonder deze stap telde de
 *  scorecard dezelfde vraag 5-10× mee. Rijen met een identieke maandreeks
 *  binnen dezelfde niche = één zoekvraag; de eerste (hoogste/hoofdterm)
 *  wordt de hoofdvariant, de rest krijgt "variantOf". */
export function markVariants(rows) {
  const main = new Map();
  for (const r of rows) {
    if (r.avg <= 0) { r.variantOf = ""; continue; }
    const key = r.niche + "|" + r.months.join(",");
    const m = main.get(key);
    if (m) r.variantOf = m;
    else { main.set(key, r.kw); r.variantOf = ""; }
  }
  return rows;
}

/* Merken en ruis BUITEN fashion — de merkenlijst in lib/brands.js is voor
   kleding gebouwd en liet o.a. IKEA, Casper, Louis Vuitton en "fedora linux"
   door. Woordgrens-match op de keyword-tekst. */
const NICHE_BRANDS = [
  "ikea", "casper", "louis vuitton", "lv", "michael kors", "mk", "coach", "kate spade", "strathberry",
  "chloe", "arcteryx", "arc teryx", "oakley", "canada pooch", "pandora", "tiffany", "mejuri", "cartier",
  "jaxxon", "stanley", "yeti", "keurig", "nespresso", "starbucks", "tim hortons", "simons", "wayfair",
  "structube", "hudson's bay", "hudsons bay", "the bay", "canadian tire", "walmart", "costco",
  "homesense", "home sense", "bouclair", "sleep country", "endy", "silk and snow", "linux", "red hat", "redhat",
  "fedora core", "west elm", "pottery barn", "crate and barrel", "cb2", "dollarama", "sephora",
  "lululemon", "aritzia", "longchamp", "gucci", "prada", "dior", "chanel", "hermes", "birkin",
  "bottega", "ysl", "saint laurent", "fossil", "kendra scott", "swarovski", "david yurman", "van cleef",
  "barefoot dreams", "brooklinen", "parachute", "sunday citizen", "le creuset", "staub",
  "kitchenaid", "breville", "delonghi", "bodum", "hario", "chemex", "kong", "petsmart", "petco",
  "pet valu", "chewy", "furbo", "etsy", "amazon", "temu", "shein", "aliexpress",
];
const NICHE_BRAND_RE = new RegExp(
  "(?:^|\\s)(?:" + NICHE_BRANDS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?:\\s|$|'s)",
  "i"
);
export function isNicheBrand(kw) {
  return NICHE_BRAND_RE.test(" " + String(kw || "").toLowerCase() + " ");
}

/* ---------- Trend per keyword ---------- */

const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);

/** Kalendermaand (0-11) van een maandkop als "Sep 2022" of "sep 2022". */
export function monthOfName(name) {
  const t = String(name || "").trim().slice(0, 3).toLowerCase();
  const i = MONTH_ABBR.indexOf(t);
  if (i >= 0) return i;
  return NL_TO_IDX[t] ?? -1;
}

/** Trend over meerdere jaren:
 *  - stijger    : 2 jaar op rij minstens 10% hoger → structurele groei
 *  - nieuwe piek: een maand die het laatste jaar ≥ 1,8× zo hoog is als in de
 *                 jaren daarvoor, en duidelijk boven het jaargemiddelde
 *  - hype       : eerst ≥ 50% omhoog, daarna ≥ 25% omlaag → te laat
 *  - daler      : laatste jaar ≥ 15% lager
 *  - stabiel    : de rest
 *  Te weinig volume (< 10/mnd gemiddeld) → "te klein". */
export function keywordTrend(months, monthNames) {
  const n = months.length;
  const L12 = sum(months.slice(Math.max(0, n - 12)));
  const P12 = n >= 24 ? sum(months.slice(n - 24, n - 12)) : 0;
  const P24 = n >= 36 ? sum(months.slice(n - 36, n - 24)) : 0;
  const g1 = P12 > 0 ? L12 / P12 - 1 : L12 > 0 ? 1 : 0;
  const g2 = P24 > 0 ? P12 / P24 - 1 : P12 > 0 ? 1 : 0;

  let label = "stabiel";
  let peak = "";
  if (L12 < 120) label = "te klein";
  else if (n >= 36 && g2 >= 0.5 && g1 <= -0.25) label = "hype";
  else if (n >= 36 && g1 >= 0.1 && g2 >= 0.1) label = "stijger";
  else if (g1 <= -0.15) label = "daler";

  if (label === "stabiel" || label === "daler") {
    // Nieuwe piek: hoogste maand van het laatste jaar tegen dezelfde
    // kalendermaand in de eerdere jaren
    const last = months.slice(n - 12);
    let bi = 0;
    last.forEach((v, i) => { if (v > last[bi]) bi = i; });
    const absIdx = n - 12 + bi;
    const earlier = [];
    for (let j = absIdx - 12; j >= 0; j -= 12) earlier.push(months[j]);
    const base = earlier.length ? sum(earlier) / earlier.length : 0;
    if (base > 0 && last[bi] >= 1.8 * base && last[bi] >= 1.5 * (L12 / 12)) {
      label = "nieuwe piek";
      peak = (monthNames[absIdx] || "").slice(0, 3);
    }
  }
  return { L12, P12, P24, g1, g2, label, peak };
}

/** Aandeel van het laatste jaar dat in het lanceervenster valt (0-1). */
export function windowShare(months, monthNames, windowIdx) {
  const n = months.length;
  const set = new Set(windowIdx);
  let inWin = 0;
  let tot = 0;
  for (let i = Math.max(0, n - 12); i < n; i++) {
    const v = months[i] || 0;
    tot += v;
    if (set.has(monthOfName(monthNames[i]))) inWin += v;
  }
  return tot > 0 ? inWin / tot : 0;
}

/* ---------- Scorecard per niche ---------- */

/** Rijen (na mergeBatches + keywordTrend) → één regel per niche.
 *  windowIdx: kalendermaanden van het lanceervenster (0-11). */
export function nicheScorecard(rows, monthNames, windowIdx, opts = {}) {
  const minBreadth = opts.minBreadth ?? 25; // keywords met ≥ 100/mnd
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.niche)) by.set(r.niche, []);
    by.get(r.niche).push(r);
  }
  const winEven = windowIdx.length / 12 || 1 / 3;

  const cards = [];
  for (const [niche, all] of by) {
    // Merken, winkels en navigatie-zoektermen tellen niet mee als vraag
    // voor jouw store; wel als "merkaandeel" (zoekt men op merk, dan valt er
    // weinig te winnen).
    // Alleen hoofdvarianten tellen als vraag (zie markVariants)
    const list = all.filter((r) => !r.junk && !r.variantOf);
    const mains = all.filter((r) => !r.variantOf);
    const allVol = sum(mains.map((r) => r.avg));
    const merkaandeel = allVol > 0 ? sum(mains.filter((r) => r.junk).map((r) => r.avg)) / allVol : 0;
    if (!list.length) continue;
    const L12 = sum(list.map((r) => r.t.L12));
    const P12 = sum(list.map((r) => r.t.P12));
    const P24 = sum(list.map((r) => r.t.P24));
    const vraag = sum(list.map((r) => r.avg));
    const g1 = P12 > 0 ? L12 / P12 - 1 : 0;
    const g2 = P24 > 0 ? P12 / P24 - 1 : 0;
    const breedte = list.filter((r) => r.avg >= 100).length;

    // Volume-gewogen concurrentie en bod
    let w = 0, bidW = 0, compW = 0, wComp = 0;
    for (const r of list) {
      const vol = r.avg || 0;
      const bid = r.bidHigh !== "" ? r.bidHigh : r.bidLow;
      if (bid !== "" && bid != null && vol > 0) { bidW += bid * vol; w += vol; }
      if (r.compIdx !== "" && r.compIdx != null && vol > 0) { compW += r.compIdx * vol; wComp += vol; }
    }
    const bod = w > 0 ? bidW / w : 0;
    const comp = wComp > 0 ? compW / wComp : 0;

    // Seizoensfit: aandeel in het venster t.o.v. een vlak jaar
    let inWin = 0, tot = 0;
    for (const r of list) { inWin += r.win * r.t.L12; tot += r.t.L12; }
    const winShare = tot > 0 ? inWin / tot : 0;
    const seizoen = winShare / winEven;

    const volOf = (lab) => sum(list.filter((r) => r.t.label === lab).map((r) => r.t.L12));
    const trendAandeel = L12 > 0 ? (volOf("stijger") + volOf("nieuwe piek")) / L12 : 0;
    const hypeAandeel = L12 > 0 ? volOf("hype") / L12 : 0;

    const flags = [];
    if (breedte < minBreadth) flags.push(`te smal (${breedte} keywords ≥100/mnd)`);
    if (g1 < -0.1) flags.push("krimpt");
    if (hypeAandeel > 0.25) flags.push("veel hype");
    if (seizoen < 0.7) flags.push("venster valt buiten de piek");
    if (merkaandeel > 0.4) flags.push("veel merk-zoekopdrachten");

    cards.push({
      niche, keywords: list.length, breedte, vraag, L12, g1, g2, bod, comp,
      winShare, seizoen, trendAandeel, hypeAandeel, merkaandeel, flags,
      top: list.slice().sort((a, b) => b.avg - a.avg).slice(0, 5).map((r) => r.kw),
      stijgers: list.filter((r) => r.t.label === "stijger" || r.t.label === "nieuwe piek")
        .sort((a, b) => b.t.L12 - a.t.L12).slice(0, 5).map((r) => r.kw),
    });
  }
  /* Groei RELATIEF aan de markt: Keyword Planner laat in een hele markt
     soms alles een paar procent dalen of stijgen (Canada 2026: alle tien
     niches -1 tot -15% over 2 jaar). Voor de keuze telt hoe een niche het
     doet t.o.v. de andere, dus de gewogen gemiddelde groei gaat eraf. */
  const vSum = sum(cards.map((c) => c.vraag)) || 1;
  const avgG1 = sum(cards.map((c) => c.g1 * c.vraag)) / vSum;
  const avgG2 = sum(cards.map((c) => c.g2 * c.vraag)) / vSum;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  for (const c of cards) {
    c.g1rel = c.g1 - avgG1;
    c.g2rel = c.g2 - avgG2;
    c.raw =
      c.vraag *
      (1 + clamp(c.g1rel, -0.5, 1)) *
      (1 + 0.5 * clamp(c.g2rel, -0.5, 1)) *
      clamp(c.seizoen, 0.3, 2.5) *
      (1 + c.trendAandeel - c.hypeAandeel) *
      (1 - 0.5 * clamp(c.merkaandeel, 0, 1)) /
      Math.max(c.bod, 0.05);
    if (c.g1rel < -0.1 && !c.flags.includes("krimpt")) c.flags.push("groeit trager dan de markt");
  }
  const max = Math.max(...cards.map((c) => (c.flags.some((f) => f.startsWith("te smal")) ? 0 : c.raw)), 1);
  for (const c of cards) {
    const blocked = c.flags.some((f) => f.startsWith("te smal"));
    c.kans = blocked ? 0 : Math.round((c.raw / max) * 100);
  }
  return cards.sort((a, b) => b.kans - a.kans || b.vraag - a.vraag);
}

/** Kalendermaanden van het venster uit de NL-sleutels van de tool. */
export function windowFromKeys(keys) {
  return (keys || []).map((k) => NL_TO_IDX[k]).filter((i) => i != null);
}
