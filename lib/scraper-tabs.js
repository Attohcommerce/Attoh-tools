// SCRAPER W-TABS AANMAKEN (20-10-2026) — uit de planning van een store de
// tabbladen "Scraper W2", "Scraper W3", … schrijven in exact de opmaak van de
// SSB Final Organization (doc 49), in dezelfde Google Sheet:
//
//   A Rank · B Keyword (zoekterm) · C Collectie · D Groep (V/M) · E Avg. volume
//   · F Volume venster (p/m) · G Piekmaand · H Aantal producten · I Type ·
//   J Uitleg  |  K Collectie · L Aantal keywords · M Aantal producten · N Top keywords
//
// Bron (in deze volgorde): een plan-tab ("Keywordplan" / "Plan": één rij per
// keyword per week, met vraag + piekmaand) of anders de weektabs ("Week 2" …
// in Chaim-opmaak). Volumes die de planning niet heeft komen uit het
// All-keywords-geheugen van de markt (top 2500 per geslacht); de rest blijft
// leeg. Type = keywordType (Direct/Attribuut/Gelegenheid), Uitleg = kern
// (n st.) / nieuw deze week / doorloper — zoals in de SSB-tabs.
import {
  readRange, getSheetSizes, addTab, clearValues, updateValues, resizeTabGrid,
  spreadsheetBatchUpdate, getTabIdByTitle, parseSheetId, a1Tab,
} from "./sheets";
import { parsePlanTab, parseWeekplanSheet, weekNumberOf } from "./weekplan";
import { keywordType, storeProfile } from "./verdeling";
import { getStoreMemory, canonOf, allTopKeywords } from "./geheugen";

export const SCRAPER_HEADER = [
  "Rank", "Keyword (zoekterm)", "Collectie", "Groep (V/M)", "Avg. volume", "Volume venster (p/m)",
  "Piekmaand", "Aantal producten", "Type", "Uitleg",
  "Collectie", "Aantal keywords", "Aantal producten", "Top keywords",
];
const MONTHS_NL = { jan: "jan", feb: "feb", mar: "mrt", mrt: "mrt", apr: "apr", may: "mei", mei: "mei", jun: "jun", jul: "jul", aug: "aug", sep: "sep", oct: "okt", okt: "okt", nov: "nov", dec: "dec" };

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const canonKey = (g, k) => `${g === "man" ? "M" : "V"}|${canonOf(String(k).replace(/^mens\s+/i, ""))}`;
const peakNl = (p) => {
  const s = String(p || "").toLowerCase().slice(0, 3);
  return MONTHS_NL[s] || String(p || "");
};

/** Alle weken uit de sheet: Map<week, rows[]> + bron-omschrijving. */
async function readPlanning(sheetId, titles) {
  const planTab = titles.find((t) => /^keywordplan$/i.test(t.trim())) || titles.find((t) => /^plan$/i.test(t.trim()));
  if (planTab) {
    const values = await readRange(sheetId, `${a1Tab(planTab)}!A1:P`);
    const plan = parsePlanTab(values);
    if (plan) return { weeks: plan.weeks, bron: `tab "${planTab}"` };
  }
  // weektabs "Week 2", "Week 3 (26 Oct-1 Nov)" … in Chaim-opmaak
  const weeks = new Map();
  const weekTabs = titles
    .filter((t) => /^week\s*\d+/i.test(t.trim()))
    .map((t) => ({ t, w: weekNumberOf(t) }))
    .filter((x) => x.w)
    .sort((a, b) => a.w - b.w);
  for (const { t, w } of weekTabs) {
    const values = await readRange(sheetId, `${a1Tab(t)}!A1:J`).catch(() => []);
    const read = parseWeekplanSheet(values);
    if (!read || !read.parsed.length) continue;
    weeks.set(
      w,
      read.parsed.map((p) => ({ k: p.k, keyword: p.k.replace(/^mens\s+/i, ""), n: p.n, g: p.g, col: p.col, rol: "", vraag: null, piek: "" }))
    );
  }
  if (!weeks.size) throw httpErr(422, 'Geen planning gevonden: geen tab "Keywordplan"/"Plan" en geen weektabs ("Week 2" …) in Chaim-opmaak.');
  return { weeks, bron: `${weekTabs.length} weektabs` };
}

function uitlegFor(row, w, seen) {
  if (row.rol === "origineel") return "origineel";
  if (row.n >= 2) return `kern (${row.n} st.)`;
  if (row.rol === "nieuw" || row.rol === "upload") return "nieuw deze week";
  if (row.rol === "doorloper") return "doorloper";
  const key = canonKey(row.g, row.k);
  return seen.has(key) ? "doorloper" : "nieuw deze week";
}

function buildWeekRows(rows, w, seen, volumes) {
  const sorted = [...rows].sort((a, b) => b.n - a.n || (b.vraag || 0) - (a.vraag || 0) || a.k.localeCompare(b.k));
  const table = [];
  const colAgg = new Map();
  sorted.forEach((r, i) => {
    const vol = volumes.get(canonKey(r.g, r.k)) || null;
    const venster = r.vraag || (vol && vol.vol) || "";
    const piek = r.piek ? peakNl(r.piek) : vol && vol.peak ? peakNl(vol.peak) : "";
    const type = keywordType(r.keyword || r.k);
    table.push([
      i + 1, r.k, r.col || "", r.g === "man" ? "M" : "V", "", venster, piek, r.n, type, uitlegFor(r, w, seen),
    ]);
    const c = r.col || "(geen collectie)";
    if (!colAgg.has(c)) colAgg.set(c, { kws: [], n: 0 });
    colAgg.get(c).kws.push({ k: r.k, n: r.n, v: venster || 0 });
    colAgg.get(c).n += r.n;
  });
  const summary = [...colAgg.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].kws.length - a[1].kws.length)
    .map(([c, v]) => [c, v.kws.length, v.n, v.kws.sort((a, b) => b.n - a.n || b.v - a.v).slice(0, 4).map((x) => x.k).join(", ")]);
  // samenvoegen tot rijen van 14 kolommen (K–N naast A–J)
  const out = [];
  const len = Math.max(table.length, summary.length);
  for (let i = 0; i < len; i++) {
    const left = table[i] || ["", "", "", "", "", "", "", "", "", ""];
    const right = summary[i] || ["", "", "", ""];
    out.push([...left, ...right]);
  }
  for (const r of sorted) seen.add(canonKey(r.g, r.k));
  return { rows: out, keywords: table.length, products: sorted.reduce((s, r) => s + r.n, 0), men: sorted.filter((r) => r.g === "man").length };
}

async function formatScraperTab(sheetId, tabId, rowCount) {
  const YELLOW = { red: 1, green: 0.95, blue: 0.8 };
  const GREY = { red: 0.95, green: 0.95, blue: 0.95 };
  const widths = [50, 220, 190, 90, 95, 130, 90, 120, 100, 150, 190, 110, 120, 360];
  await spreadsheetBatchUpdate(sheetId, [
    { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 14 },
        cell: { userEnteredFormat: { backgroundColor: YELLOW, textFormat: { bold: true }, numberFormat: { type: "TEXT" } } },
        fields: "userEnteredFormat(backgroundColor,textFormat.bold,numberFormat)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 4, endColumnIndex: 6 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 10, endColumnIndex: 14 },
        cell: { userEnteredFormat: { backgroundColor: GREY } },
        fields: "userEnteredFormat.backgroundColor",
      },
    },
    { setBasicFilter: { filter: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 10 } } } },
    ...widths.map((px, i) => ({
      updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" },
    })),
  ]);
}

/**
 * Scraper W-tabs schrijven. opts: { sheetId, store?: {domain, publicDomain}, overwrite?: bool, weeks?: number[] }
 * → { bron, market, written: [{week, tab, keywords, products, men, url, replaced}], skipped: [tab], volumesFound }
 */
export async function buildScraperTabs({ sheetId, store, overwrite = false, weeks: onlyWeeks } = {}) {
  const id = parseSheetId(sheetId);
  if (!id) throw httpErr(400, "Geen geldige sheet-link");
  const sizes = await getSheetSizes(id);
  const list = Array.isArray(sizes) ? sizes : sizes && Array.isArray(sizes.tabs) ? sizes.tabs : [];
  const titles = list.map((t) => String(t.title || ""));
  const { weeks, bron } = await readPlanning(id, titles);

  // markt → volumes uit het All-keywords-geheugen (gedeeld, top 2500 per geslacht)
  let market = "";
  if (store && store.domain) {
    const entry = await getStoreMemory(store.domain).catch(() => null);
    market = (entry && entry.market) || "";
    if (!market) {
      const prof = storeProfile(store.publicDomain) || storeProfile(store.domain);
      market = (prof && prof.market) || "";
    }
  }
  const volumes = new Map();
  if (market) {
    const top = await allTopKeywords(market).catch(() => null);
    for (const r of (top && top.rows) || []) {
      const key = `${r.g}|${canonOf(r.kw)}`;
      if (!volumes.has(key)) volumes.set(key, { vol: r.vol, peak: r.peak });
    }
  }

  const written = [];
  const skipped = [];
  const seen = new Set();
  let volumesFound = 0;
  const weekNums = [...weeks.keys()].sort((a, b) => a - b);
  for (const w of weekNums) {
    const rows = weeks.get(w);
    const isOrig = rows.every((r) => r.rol === "origineel");
    // week 1 = het origineel (staat al op de store) → geen Scraper-tab; wél bij een echte upload-week
    const wanted = Array.isArray(onlyWeeks) && onlyWeeks.length ? onlyWeeks.includes(w) : !isOrig;
    if (!wanted) {
      for (const r of rows) seen.add(canonKey(r.g, r.k)); // telt wel mee voor "doorloper"
      continue;
    }
    const title = `Scraper W${w}`;
    const built = buildWeekRows(rows, w, seen, volumes);
    volumesFound += built.rows.filter((r) => r[5] !== "").length;
    let tabId = await getTabIdByTitle(id, title);
    let replaced = false;
    if (tabId !== null && !overwrite) {
      skipped.push(title);
      continue;
    }
    const nRows = built.rows.length + 1;
    if (tabId === null) {
      const made = await addTab(id, title, { rows: Math.max(nRows, 2), cols: 14 });
      if (!made.ok) throw httpErr(422, made.error || `Tab "${title}" niet kunnen aanmaken`);
      tabId = made.tabId;
    } else {
      replaced = true;
      await clearValues(id, a1Tab(title));
      await resizeTabGrid(id, tabId, Math.max(nRows, 2), 14).catch(() => {});
    }
    await updateValues(id, `${a1Tab(title)}!A1`, [SCRAPER_HEADER, ...built.rows]);
    try {
      await formatScraperTab(id, tabId, nRows);
    } catch {
      /* opmaak is nice-to-have */
    }
    written.push({ week: w, tab: title, keywords: built.keywords, products: built.products, men: built.men, replaced, url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${tabId}` });
  }
  return { ok: true, bron, market: market || null, written, skipped, volumesFound, weeks: weekNums };
}
