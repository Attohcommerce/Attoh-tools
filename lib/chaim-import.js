// CHAIM-IMPORTBLAD (24-10-2026) — naast de Attoh-import-lijst ("W3") schrijft
// de scraper in Sa Collective automatisch een tweede blad "W3 Chaim formaat",
// exact zoals Chaims importer het wil ("Paste the whole sheet"): 5 kolommen,
// GÉÉN kopregel:
//
//   A Keyword · B URL · C Gender (Women/Men) · D Collection · E Tag
//
// Collection + tag komen uit het geheugen van de store, in deze volgorde:
//   1. ORG VROUW / ORG MAN in de aanvul-sheet (live snapshot van de store:
//      keyword → collectie + tag-regel) — lib/tpk.js loadOrgMap
//   2. de planning zelf ("Collecties (import)" / "Plan": Keyword · Gender ·
//      Collection · Tag) — zelfde keyword-canon
//   3. kolom I COLLECTIE van de import-lijst (de collectie uit het bronblad),
//      opgezocht in STORE COLLECTIES voor de echte tag-regel
//   4. niets → Collection/Tag leeg, wordt gemeld
// Bestaat de collectie niet op de store, dan wordt de tag afgeleid uit de
// naam (Men's Sandals → menssandals): Chaims importer maakt de smart
// collection dan zelf aan. Geslacht komt uit kolom F (na de geslacht-check);
// een herenproduct onder een dames-keyword krijgt de "Men's …"-variant van de
// collectie als die op de store bestaat.
//
// Server-only (leest Redis + Sheets); aangeroepen via /api/sheets
// action "buildChaimTab".

import {
  readRange, addTab, clearValues, updateValues, resizeTabGrid,
  spreadsheetBatchUpdate, getTabIdByTitle, parseSheetId, a1Tab,
} from "./sheets";
import { parseImportRows } from "./import-format";
import { getStoreMemory, canonOf, findOrgTabs } from "./geheugen";
import { loadOrgMap } from "./tpk";

export const CHAIM_SUFFIX = " Chaim formaat";
export const chaimTabName = (runTitle) => `${String(runTitle || "").trim()}${CHAIM_SUFFIX}`;

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const low = (v) => String(v || "").toLowerCase().trim();

/** Tag uit een collectienaam, zoals Chaim ze zelf zet: "Men's Sandals" → menssandals. */
export function tagSlug(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[‘’ʼ`´']/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const isMensTitle = (t) => /\bmen'?s\b|\bmens\b/i.test(String(t || ""));
const stripMens = (t) => String(t || "").replace(/^\s*men'?s\s+/i, "").trim();

/* ---------- bronnen ---------- */

/** STORE COLLECTIES-tab van de aanvul-sheet → Map(lower title → {title, tag, exists, kind}). */
async function loadStoreCollections(entry) {
  const map = new Map();
  if (!entry || !entry.aanvulSheetId) return map;
  let rows = [];
  try {
    rows = await readRange(entry.aanvulSheetId, `${a1Tab("STORE COLLECTIES")}!A1:J`);
  } catch {
    return map; // tab bestaat (nog) niet — snapshot nooit gedraaid
  }
  if (!rows.length) return map;
  const head = (rows[0] || []).map(low);
  const iT = head.findIndex((h) => h.startsWith("collectie") || h.startsWith("collection"));
  const iTag = head.findIndex((h) => h.startsWith("tag"));
  const iKind = head.findIndex((h) => h.startsWith("soort"));
  const iEx = head.findIndex((h) => h.startsWith("bestaat"));
  if (iT < 0) return map;
  for (const r of rows.slice(1)) {
    const title = String((r || [])[iT] || "").trim();
    if (!title) continue;
    const rawTag = iTag >= 0 ? String(r[iTag] || "").trim() : "";
    const exists = iEx >= 0 ? /^ja\b/i.test(String(r[iEx] || "")) : true;
    map.set(title.toLowerCase(), {
      title,
      // "-" = handmatige collectie zonder tag-regel; bij "alleen in origineel"
      // staat de titel als tag → voor Chaim altijd de slug
      tag: exists && rawTag && rawTag !== "-" && rawTag.toLowerCase() !== title.toLowerCase() ? rawTag : "",
      exists,
      kind: iKind >= 0 ? String(r[iKind] || "") : "",
    });
  }
  return map;
}

/** De planning (Collecties (import) / Plan / organization): Map("V|canon" → {coll, tag}) + Map(lower coll → tag). */
async function loadPlanMap(entry, storeGenders) {
  const byKw = new Map();
  const byColl = new Map();
  const sheetId = entry && (entry.orgSheetId || entry.aanvulSheetId);
  if (!sheetId) return { byKw, byColl };
  // één organization-tabblad, of (27-10) alle "Scraper Wn"-tabbladen samen
  let tabs = [];
  try {
    tabs = await findOrgTabs(sheetId, entry.orgTab);
  } catch {
    tabs = [];
  }
  for (const tab of tabs) {
    let rows = [];
    try {
      rows = await readRange(sheetId, `${a1Tab(tab)}!A1:J`);
    } catch {
      continue;
    }
    addPlanRows(rows, storeGenders, byKw, byColl);
  }
  return { byKw, byColl };
}

/* Eén planning-tabblad in de maps zetten (kopregel mag onder een titel staan). */
function addPlanRows(rows, storeGenders, byKw, byColl) {
  const hdrAt = rows.slice(0, 10).findIndex((r) => {
    const h = (r || []).map(low);
    return h.some((x) => x.startsWith("keyword")) && h.some((x) => x.startsWith("collectie") || x.startsWith("collection"));
  });
  if (hdrAt < 0) return;
  rows = rows.slice(hdrAt);
  const head = (rows[0] || []).map(low);
  const iKw = head.findIndex((h) => h.startsWith("keyword"));
  const iCol = head.findIndex((h) => h.startsWith("collectie") || h.startsWith("collection"));
  const iTag = head.findIndex((h) => h === "tag" || h.startsWith("tag"));
  let iG = head.findIndex((h) => h.startsWith("groep"));
  if (iG < 0) iG = head.findIndex((h) => h === "gender" || h === "geslacht");
  const fixed = storeGenders === "M" || storeGenders === "V" ? storeGenders : "";
  for (const r of rows.slice(1)) {
    const kw = String((r || [])[iKw] || "").trim();
    const coll = String(r[iCol] || "").trim();
    if (!kw || !coll || /^(totaal|total|keyword)$/i.test(kw)) continue;
    const tag = iTag >= 0 ? String(r[iTag] || "").trim() : "";
    const gv = iG >= 0 ? low(r[iG]) : "";
    const g =
      fixed ||
      (/^(m|men|man|heren|male)$/.test(gv) ? "M" : /^(v|w|women|vrouw|dames|female)$/.test(gv) ? "V" : isMensTitle(coll) || /^mens\s/i.test(kw) ? "M" : "V");
    const key = `${g}|${canonOf(kw)}`;
    if (!byKw.has(key)) byKw.set(key, { coll, tag });
    if (tag && !byColl.has(coll.toLowerCase())) byColl.set(coll.toLowerCase(), tag);
  }
}

/* ---------- per rij: collectie + tag kiezen ---------- */

function makeResolver({ orgMap, plan, colls }) {
  const tagFor = (title, hint) => {
    const c = colls.get(low(title));
    if (c && c.tag) return { tag: c.tag, isNew: false };
    if (hint) return { tag: hint, isNew: !(c && c.exists) };
    const p = plan.byColl.get(low(title));
    if (p) return { tag: p, isNew: !(c && c.exists) };
    return { tag: tagSlug(title), isNew: !(c && c.exists) };
  };
  const exactTitle = (title) => {
    const c = colls.get(low(title));
    return c ? c.title : title;
  };
  // Mannenproduct → "Men's …"-variant van een damescollectie (als die bestaat), en andersom
  const genderFit = (title, g) => {
    if (!title) return { title, switched: false };
    if (g === "M" && !isMensTitle(title)) {
      for (const cand of [`Men's ${title}`, `Mens ${title}`]) {
        if (colls.has(low(cand)) || plan.byColl.has(low(cand))) return { title: exactTitle(cand), switched: true };
      }
      return { title, switched: false, mismatch: true };
    }
    if (g === "V" && isMensTitle(title)) {
      const cand = stripMens(title);
      if (colls.has(low(cand)) || plan.byColl.has(low(cand))) return { title: exactTitle(cand), switched: true };
      return { title, switched: false, mismatch: true };
    }
    return { title, switched: false };
  };

  return function resolve({ g, keyword, planCol }) {
    const canon = canonOf(keyword);
    let title = "";
    let hint = "";
    let bron = "";
    const o = orgMap.get(`${g}|${canon}`);
    if (o && o.coll) {
      title = o.coll;
      hint = o.tag && o.tag.toLowerCase() !== o.coll.toLowerCase() ? o.tag : "";
      bron = "store";
    } else {
      const p = plan.byKw.get(`${g}|${canon}`);
      if (p && p.coll) {
        title = p.coll;
        hint = p.tag || "";
        bron = "planning";
      } else if (planCol) {
        title = planCol;
        bron = "kolom I";
        // de planning kan het keyword onder het andere geslacht kennen (geslacht-check heeft gewisseld)
        const other = plan.byKw.get(`${g === "M" ? "V" : "M"}|${canon}`) || orgMap.get(`${g === "M" ? "V" : "M"}|${canon}`);
        if (other && other.coll && low(other.coll) === low(planCol) && other.tag && low(other.tag) !== low(other.coll)) hint = other.tag;
      }
    }
    if (!title) return { collection: "", tag: "", bron: "", isNew: false, switched: false, mismatch: false, missing: true };
    const fit = genderFit(exactTitle(title), g);
    if (fit.switched) hint = ""; // andere collectie → eigen tag opzoeken
    const t = tagFor(fit.title, hint);
    return { collection: fit.title, tag: t.tag, bron, isNew: t.isNew, switched: !!fit.switched, mismatch: !!fit.mismatch, missing: false };
  };
}

/* ---------- het blad zelf ---------- */

async function formatChaimTab(sheetId, tabId, rowCount) {
  const widths = [190, 520, 80, 230, 170];
  const reqs = [
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: Math.max(1, rowCount), startColumnIndex: 0, endColumnIndex: 5 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: "Arial", fontSize: 10 }, numberFormat: { type: "TEXT" } } },
        fields: "userEnteredFormat(textFormat,numberFormat)",
      },
    },
    ...widths.map((px, i) => ({
      updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" },
    })),
  ];
  await spreadsheetBatchUpdate(sheetId, reqs);
}

/**
 * Chaim-importblad schrijven naast een Attoh-import-lijst.
 * opts: { sheetId, title (het run-blad, bv. "W3"), store?: {domain} }
 * → { ok, tab, url, count, withCollection, newCollections: [{title, tag, n}],
 *     missing: [keyword], switched: [{keyword, collection}], mismatch: [{keyword, collection}],
 *     sources: {store, planning, kolomI}, storeName }
 */
export async function buildChaimTab({ sheetId, title, store } = {}) {
  const id = parseSheetId(sheetId);
  if (!id) throw httpErr(400, "Geen geldige sheet-link");
  const src = String(title || "").trim();
  if (!src) throw httpErr(400, "Bladnaam van de import-lijst ontbreekt");
  if (src.toLowerCase().endsWith(CHAIM_SUFFIX.toLowerCase())) throw httpErr(400, `"${src}" is zelf al een Chaim-blad — kies het Attoh-blad (bv. "W3").`);

  const values = await readRange(id, `${a1Tab(src)}!A1:N`);
  if (!values.length) throw httpErr(422, `Blad "${src}" is leeg of bestaat niet`);
  const parsed = parseImportRows(values);
  if (parsed.format !== "attoh") {
    throw httpErr(422, `"${src}" is geen import-lijst in Attoh-formaat (LINK · TITEL · KEYWORD · … · COLLECTIE). ${parsed.format === "chaim" ? "Dit blad staat al in Chaim-formaat." : ""}`.trim());
  }

  // geheugen van de store
  let entry = null;
  if (store && store.domain) entry = await getStoreMemory(store.domain).catch(() => null);
  let orgMap = new Map();
  let colls = new Map();
  let plan = { byKw: new Map(), byColl: new Map() };
  if (entry) {
    orgMap = await loadOrgMap(entry).catch(() => new Map());
    colls = await loadStoreCollections(entry).catch(() => new Map());
    plan = await loadPlanMap(entry, entry.genders || "MV").catch(() => ({ byKw: new Map(), byColl: new Map() }));
  }
  const resolve = makeResolver({ orgMap, plan, colls });

  const out = [];
  const newColls = new Map();
  const missing = [];
  const switched = [];
  const mismatch = [];
  const sources = { store: 0, planning: 0, kolomI: 0 };
  let withCollection = 0;
  for (const p of parsed.rows) {
    const gRaw = low(p.gender);
    const g =
      gRaw === "man" ? "M" : gRaw === "vrouw" ? "V" : /^mens\s/i.test(p.keyword) || isMensTitle(p.collection) ? "M" : "V";
    const r = resolve({ g, keyword: p.keyword, planCol: p.collection });
    if (r.missing) missing.push(p.keyword);
    else {
      withCollection++;
      if (r.bron === "store") sources.store++;
      else if (r.bron === "planning") sources.planning++;
      else sources.kolomI++;
      if (r.isNew) {
        const cur = newColls.get(r.collection) || { title: r.collection, tag: r.tag, n: 0 };
        cur.n++;
        newColls.set(r.collection, cur);
      }
      if (r.switched) switched.push({ keyword: p.keyword, collection: r.collection });
      if (r.mismatch) mismatch.push({ keyword: p.keyword, collection: r.collection });
    }
    out.push([p.keyword, p.url, g === "M" ? "Men" : "Women", r.collection, r.tag]);
  }

  // schrijven: bestaand Chaim-blad wordt vervangen (afgeleid van het Attoh-blad)
  const tab = chaimTabName(src);
  let tabId = await getTabIdByTitle(id, tab);
  let replaced = false;
  const nRows = Math.max(out.length, 1);
  if (tabId === null) {
    const made = await addTab(id, tab, { rows: Math.max(nRows, 2), cols: 5 });
    if (!made.ok) throw httpErr(422, made.error || `Blad "${tab}" niet kunnen aanmaken`);
    tabId = made.tabId;
  } else {
    replaced = true;
    await clearValues(id, a1Tab(tab));
    await resizeTabGrid(id, tabId, Math.max(nRows, 2), 5).catch(() => {});
  }
  if (out.length) await updateValues(id, `${a1Tab(tab)}!A1`, out);
  try {
    await formatChaimTab(id, tabId, out.length);
  } catch {
    /* opmaak is nice-to-have */
  }
  return {
    ok: true,
    tab,
    tabId,
    replaced,
    url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${tabId}`,
    count: out.length,
    withCollection,
    newCollections: [...newColls.values()].sort((a, b) => b.n - a.n),
    missing: [...new Set(missing)],
    switched,
    mismatch,
    sources,
    storeName: entry ? entry.name || entry.domain : "",
    hasMemory: !!entry,
    memoryTabs: { org: orgMap.size > 0, collections: colls.size > 0, plan: plan.byKw.size > 0 },
  };
}
