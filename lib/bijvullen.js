// BIJVULLEN — een store die met 200–400 producten begint, groeit in de loop
// van de tijd naar 800–1000. Elke aanvulling moet ÉCHT iets toevoegen: geen
// tweede keer dezelfde keywords, wel de productsoorten die de mediabuyer
// doorgeeft, en berekend op het venster van NU (een maand later dan de
// originele verdeling).
//
// Bouwstenen die al bestaan en hier hergebruikt worden:
//   - de verdeel-engine (buildVerdeling) met `exclude` = alle keywords uit de
//     originele organization → dezelfde intentie komt er nooit twee keer in
//   - het store-profiel (markt, geslacht, geblokkeerde collecties)
//   - de AI-eindcontrole (reviewVerdelingFinal)
//
// Nieuw: het "plan" van de mediabuyer (lib/ai.js → parseBijvulBrief) dat per
// gevraagde productsoort een deel van het budget reserveert. Elke focus krijgt
// zijn eigen kleine verdeling over de keywords die bij die soort horen; de
// rest van het budget vult de engine met de beste seizoens-keywords.

import { readRange, readColumnsBatch } from "./sheets";
import { buildVerdeling, canonKey, orderWindow, keywordType, genderOf, storeProfile, MEN_SHARE_DEFAULT } from "./verdeling";

const MONTH_TOKEN = {
  jan: "jan", feb: "feb", mrt: "mar", apr: "apr", mei: "may", jun: "jun",
  jul: "jul", aug: "aug", sep: "sep", okt: "oct", nov: "nov", dec: "dec",
};
export const MONTH_KEYS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* Venster één (of meer) maanden opschuiven: okt-nov-dec-jan → nov-dec-jan-feb.
   De originele verdeling is een maand oud tegen de tijd dat er bijgevuld
   wordt; de aanvulling moet op het venster van nú rekenen. */
export function shiftWindow(months, by = 1) {
  const ordered = orderWindow(months || []);
  if (!ordered.length) return [];
  const last = MONTH_KEYS.indexOf(ordered[ordered.length - 1]);
  const out = ordered.slice(by);
  for (let i = 1; i <= by; i++) out.push(MONTH_KEYS[(last + i) % 12]);
  return out;
}

/* Maanden uit de kop "Volume okt-nov-dec-jan" van een organization-tabblad. */
export function monthsFromHeader(header) {
  const h = String(header || "").toLowerCase();
  const m = h.match(/volume\s+([a-z\-]+)/);
  if (!m) return [];
  return m[1].split("-").filter((x) => MONTH_KEYS.includes(x));
}

/* ---------- de originele organization lezen ---------- */
export async function readOrganization(sheetId, tab, storeGendersIn) {
  const oTab = String(tab || "").trim();
  if (!sheetId || !oTab) throw httpErr(400, "Originele organization: sheet of bladnaam ontbreekt");
  const rows = await readRange(sheetId, `${a1(oTab)}!A1:J`);
  if (!rows.length) throw httpErr(422, `Organization-tabblad "${oTab}" is leeg of bestaat niet`);
  const head = (rows[0] || []).map((h) => String(h || "").toLowerCase());
  const iKw = head.findIndex((h) => h.startsWith("keyword"));
  const iCol = head.findIndex((h) => h.startsWith("collectie"));
  const iN = head.findIndex((h) => h.startsWith("aantal"));
  const iVol = head.findIndex((h) => h.startsWith("volume"));
  const iType = head.findIndex((h) => h.startsWith("type"));
  if (iKw === -1 || iCol === -1)
    throw httpErr(422, `"${oTab}" mist de kolommen Keyword/Collectie — is dit wel een organization-tabblad?`);

  /* Storegeslacht uit de kop van kolom D ("Groep — alleen heren"), tenzij
     de gebruiker het zelf meegeeft. */
  const gHead = String((rows[0] || [])[3] || "");
  let genders = storeGendersIn === "M" || storeGendersIn === "V" || storeGendersIn === "MV" ? storeGendersIn : null;
  if (!genders) genders = /alleen heren/i.test(gHead) ? "M" : /alleen dames/i.test(gHead) ? "V" : "MV";

  const keywords = [];
  const canons = new Set();
  const colProducts = {};
  let existingProducts = 0;
  let maxRank = 0;
  let underdogs = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const kw = String(r[iKw] || "").trim().toLowerCase();
    if (!kw) continue;
    // koprijen van het underdog-blok overslaan
    if (kw === "keyword" || r.join(" ").toUpperCase().includes("UNDERDOG KEYWORDS")) continue;
    keywords.push(kw);
    const c = canonKey(kw, { storeGenders: genders });
    if (c) canons.add(c);
    const col = String(r[iCol] || "").trim();
    const n = Number(r[iN]) || 0;
    if (col) colProducts[col] = (colProducts[col] || 0) + n;
    existingProducts += n;
    const rank = Number(r[0]) || 0;
    if (rank > maxRank) maxRank = rank;
    if (iType >= 0 && /underdog/i.test(String(r[iType] || ""))) underdogs++;
  }
  if (!keywords.length) throw httpErr(422, `Geen keywords gevonden in "${oTab}"`);

  return {
    tab: oTab,
    genders,
    gLabel: gHead.trim() || "Groep",
    keywords,
    canons,
    colProducts,
    existingProducts,
    maxRank,
    underdogs,
    origMonths: iVol >= 0 ? monthsFromHeader(head[iVol]) : [],
  };
}

/* ---------- de verse Keyword Planner-data lezen (zelfde leesroutine als de verdeling) ---------- */
export async function readStatsRows(sheetId, tab, months) {
  const src = String(tab || "").trim();
  if (!sheetId || !src) throw httpErr(400, "Keyword-data: sheet of bladnaam ontbreekt");
  const headerRows = await readRange(sheetId, `${a1(src)}!1:1`);
  const header = (headerRows[0] || []).map((h) => String(h || "").toLowerCase());
  if (!header.length) throw httpErr(422, `Tabblad "${src}" is leeg of bestaat niet`);

  const kwIdx = header.findIndex((h) => h.startsWith("keyword"));
  const avgIdx = header.findIndex((h) => h.startsWith("avg"));
  if (kwIdx === -1) throw httpErr(422, `Kolom "Keyword" niet gevonden in "${src}"`);
  const monthIdx = months.map((m) => {
    const tok = MONTH_TOKEN[m] || m;
    const i = header.findIndex((h) => h.replace(/^searches:\s*/, "").startsWith(tok));
    if (i === -1) throw httpErr(422, `Maandkolom "${m}" niet gevonden in "${src}" — staat de maand ná je venster wel in deze batch?`);
    return i;
  });
  const afterKey = MONTH_KEYS[(MONTH_KEYS.indexOf(months[3]) + 1) % 12];
  const nextIdx = header.findIndex((h) => h.replace(/^searches:\s*/, "").startsWith(MONTH_TOKEN[afterKey] || afterKey));
  const MONTH_TOKS = Object.values(MONTH_TOKEN);
  const yearIdx = header
    .map((h, i) => ({ h: h.replace(/^searches:\s*/, ""), i }))
    .filter(({ h }) => MONTH_TOKS.some((t) => h.startsWith(t)))
    .map(({ i }) => i)
    .slice(-12);
  const useYear = yearIdx.length >= 6;
  const readIdx = [...new Set([kwIdx, avgIdx, ...monthIdx, nextIdx, ...(useYear ? yearIdx : [])].filter((i) => i >= 0))];
  const columns = await readColumnsBatch(sheetId, src, readIdx);
  const nRows = (columns[kwIdx] || []).length;
  const num = (v) => {
    const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const rows = [];
  for (let r = 0; r < nRows; r++) {
    const kw = String(columns[kwIdx][r] || "").trim();
    if (!kw) continue;
    rows.push({
      kw,
      avg: avgIdx >= 0 ? num(columns[avgIdx][r]) : 0,
      months: monthIdx.map((i) => num(columns[i][r])),
      next: nextIdx >= 0 ? num(columns[nextIdx][r]) : null,
      year: useYear ? yearIdx.map((i) => num((columns[i] || [])[r])) : null,
    });
  }
  return { rows, hasNext: nextIdx >= 0, hasYear: useYear, afterKey };
}

/* ---------- focus-termen → regex ---------- */
function termRe(terms) {
  const parts = (terms || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.length) return null;
  return new RegExp(`\\b(?:${parts.join("|")})`, "i");
}

/* ---------- de bijvul-verdeling ----------
   plan: { target, focus:[{label, terms, share, gender, collection}], avoid:[] }
   Elke focus krijgt eerst zijn deel; wat een focus niet kan dragen (te weinig
   keywords met genoeg vraag) schuift naar de algemene aanvulling. */
export function buildBijvul(statsRows, org, plan, opts) {
  const total = Math.max(20, Math.min(900, Number(plan.target) || Number(opts.productTarget) || 200));
  const base = {
    monthNames: opts.months,
    genders: org.genders,
    mode: "spread",
    market: opts.market,
    storeUrl: opts.storeUrl,
  };
  const exclude = new Set(org.keywords);
  for (const x of opts.extraExclude || []) exclude.add(String(x).toLowerCase());
  const avoidRe = termRe(plan.avoid);

  let pool = statsRows;
  if (avoidRe) pool = pool.filter((r) => !avoidRe.test(r.kw));

  const out = [];
  const usedKw = new Set();
  const focusReport = [];
  let leftover = 0;

  /* Heren-aandeel voor een focus die voor man én vrouw geldt: zelfde doel
     als de engine (store-profiel, anders 40%). */
  const prof = storeProfile(opts.storeUrl);
  const menShare = prof && Number(prof.menShare) > 0 ? Number(prof.menShare) : MEN_SHARE_DEFAULT;

  for (const f of plan.focus || []) {
    const re = termRe(f.terms);
    if (!re) continue;
    const want = Math.max(2, Math.round(total * f.share));
    const sub = pool.filter((r) => re.test(r.kw) && !usedKw.has(r.kw.toLowerCase()));
    /* Een focus voor man + vrouw draait als twee losse verdelingen (dames,
       heren). In één gemengde run van bv. 48 producten kreeg de herenkant
       12 producten en liet de engine die collectie als "te klein" vallen. */
    const gPlan = f.gender || org.genders;
    const parts = gPlan === "MV" ? [["V", 1 - menShare], ["M", menShare]] : [[gPlan, 1]];
    let got = 0;
    let carry = leftover;
    for (const [g, frac] of parts) {
      const rowsG = gPlan === "MV" ? sub.filter((r) => genderOf(r.kw.toLowerCase(), "MV") === g) : sub;
      const budget = Math.round(want * frac) + carry;
      carry = 0;
      if (!rowsG.length || budget < 2) {
        carry = budget;
        continue;
      }
      const res = buildVerdeling(rowsG, { ...base, genders: g, total: budget, exclude, skipArtefact: true, liftCaps: true });
      let gotG = 0;
      for (const r of res.rows) {
        if (usedKw.has(r.kw.toLowerCase())) continue;
        usedKw.add(r.kw.toLowerCase());
        out.push({ ...r, g, col: f.collection || r.col, bron: f.label, focusNew: !!f.collection });
        gotG += r.n;
      }
      got += gotG;
      carry = Math.max(0, budget - gotG);
    }
    focusReport.push({ label: f.label, wanted: want, got, keywords: sub.length });
    leftover = carry;
  }

  /* De algemene aanvulling mag de gevraagde productsoorten NIET nog eens
     opvullen: het aandeel van een focus is een plafond én een vloer. Anders
     koos de engine hierna alsnog "penny loafers" en "tassel loafers" als beste
     restkeywords en werd 80% van de aanvulling loafers. */
  const focusRes = (plan.focus || []).map((f) => termRe(f.terms)).filter(Boolean);
  const rest = total - out.reduce((s, r) => s + r.n, 0);
  let restRes = null;
  if (rest >= 2) {
    const ex2 = new Set(exclude);
    for (const k of usedKw) ex2.add(k);
    const restPool = pool.filter((r) => !usedKw.has(r.kw.toLowerCase()) && !focusRes.some((re) => re.test(r.kw)));
    restRes = buildVerdeling(restPool, { ...base, total: rest, exclude: ex2 });
    for (const r of restRes.rows) {
      usedKw.add(r.kw.toLowerCase());
      out.push({ ...r, bron: "aanvulling" });
    }
  }

  // Herrangschikken: focus eerst (in volgorde), daarna de aanvulling op score
  const rows = out.map((r, i) => ({ ...r, rank: i + 1 }));
  const colInfo = new Map();
  for (const r of rows) {
    if (!colInfo.has(r.col)) colInfo.set(r.col, { col: r.col, kws: 0, products: 0, top: [], nieuw: !(r.col in org.colProducts), bestaand: org.colProducts[r.col] || 0 });
    const c = colInfo.get(r.col);
    c.kws++;
    c.products += r.n;
    if (c.top.length < 3) c.top.push(r.kw);
  }
  const collections = [...colInfo.values()].sort((a, b) => b.products - a.products);
  return {
    rows,
    collections,
    totalProducts: rows.reduce((s, r) => s + r.n, 0),
    target: total,
    focusReport,
    windowSeasons: (restRes && restRes.windowSeasons) || [],
    storeProfile: restRes && restRes.storeProfile,
    stats: restRes && restRes.stats,
    caps: restRes && restRes.caps,
  };
}

export function rowType(kw) {
  try {
    return keywordType(kw);
  } catch {
    return "";
  }
}

function a1(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}
