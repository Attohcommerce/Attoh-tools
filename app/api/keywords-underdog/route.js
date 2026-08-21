import { NextResponse } from "next/server";
import {
  readRange, readColumnsBatch, appendRows, parseSheetId,
  getTabIdByTitle, formatUnderdogBlock, a1Tab,
} from "@/lib/sheets";
import {
  canonKey, isVerdelingJunk, collectionFor, consistentCollection,
  MARKETS, seasonOf, seasonFactor, eventFactor, storeProfile,
} from "@/lib/verdeling";
import {
  underdogScore, isFamilyOfExisting, prepFamilies, allocateUnderdogs, growthFactor,
} from "@/lib/underdog";
import { classifyUnknownTokens, reviewUnderdogPicks } from "@/lib/ai";
import { unknownFashionTokens } from "@/lib/brands";

/* De underdog-run is opgeknipt in korte stappen die de BROWSER na elkaar
   aanroept: prep (data + algoritme) → sieve (onbekende woorden) → review
   (AI-denkwerk, in stukken) → write (budget vullen + wegschrijven). Eén
   monoliet-verzoek klapte live tweemaal op HTTP 504: Vercel-plannen klemmen
   een functie op 60s, wat maxDuration ook vraagt. Elke stap hieronder blijft
   ruim onder de minuut, dus een 504 kan structureel niet meer. */
export const maxDuration = 60;

const MONTH_TOKEN = {
  jan: "jan", feb: "feb", mrt: "mar", apr: "apr", mei: "may", jun: "jun",
  jul: "jul", aug: "aug", sep: "sep", okt: "oct", nov: "nov", dec: "dec",
};
const KEYS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/* ---------- Stap 1: PREP — sheets lezen, algoritme, pool bouwen ---------- */

async function prepStep(body) {
  const { orgSheetId, orgTab, statsSheetId, statsTab, months, genders, market, storeUrl, productTarget } = body;

  if (!orgSheetId || !String(orgTab || "").trim()) throw httpErr(400, "Organization-sheet of bladnaam ontbreekt");
  if (!statsSheetId || !String(statsTab || "").trim()) throw httpErr(400, "All-batch-stats-sheet of bladnaam ontbreekt");
  if (!Array.isArray(months) || months.length !== 4) throw httpErr(400, "Kies precies 4 maanden");

  const budget = Math.max(20, Math.min(900, Number(productTarget) || 250));
  const target = Math.min(300, Math.floor(budget / 2));
  const warnings = [];

  /* -- Bestaande organization -- */
  const oTab = String(orgTab).trim();
  const orgRows = await readRange(orgSheetId, `${a1Tab(oTab)}!A1:J`);
  if (!orgRows.length) throw httpErr(422, `Organization-tabblad "${oTab}" is leeg of bestaat niet`);
  const oHead = (orgRows[0] || []).map((h) => String(h || "").toLowerCase());
  const oKw = oHead.findIndex((h) => h.startsWith("keyword"));
  const oCol = oHead.findIndex((h) => h.startsWith("collectie"));
  const oN = oHead.findIndex((h) => h.startsWith("aantal"));
  const oType = oHead.findIndex((h) => h.startsWith("type"));
  if (oKw === -1 || oCol === -1)
    throw httpErr(422, `"${oTab}" mist de kolommen Keyword/Collectie — is dit wel een organization-tabblad?`);

  const existingCanons = new Set();
  const colProducts = {};
  let existingProducts = 0;
  let maxRank = 0;
  let hasUnderdogBlock = false;
  for (let i = 1; i < orgRows.length; i++) {
    const r = orgRows[i] || [];
    const kw = String(r[oKw] || "").trim().toLowerCase();
    if (r.join(" ").toUpperCase().includes("UNDERDOG KEYWORDS")) hasUnderdogBlock = true;
    if (!kw) continue;
    if (oType >= 0 && String(r[oType] || "").toLowerCase() === "underdog") hasUnderdogBlock = true;
    const c = canonKey(kw);
    if (c) existingCanons.add(c);
    const col = String(r[oCol] || "").trim();
    const n = Number(r[oN]) || 0;
    if (col) colProducts[col] = (colProducts[col] || 0) + n;
    existingProducts += n;
    const rank = Number(r[0]) || 0;
    if (rank > maxRank) maxRank = rank;
  }
  if (hasUnderdogBlock)
    throw httpErr(422, `"${oTab}" bevat al een underdog-blok. Verwijder dat blok eerst (of gebruik een kopie van het tabblad) — twee keer draaien zou dubbele keywords geven.`);
  if (!existingCanons.size) throw httpErr(422, `Geen bestaande keywords gevonden in "${oTab}"`);

  /* -- Stats-tabblad -- */
  const sTab = String(statsTab).trim();
  const headerRows = await readRange(statsSheetId, `${a1Tab(sTab)}!1:1`);
  const header = (headerRows[0] || []).map((h) => String(h || "").toLowerCase());
  if (!header.length) throw httpErr(422, `Stats-tabblad "${sTab}" is leeg of bestaat niet`);

  const kwIdx = header.findIndex((h) => h.startsWith("keyword"));
  const avgIdx = header.findIndex((h) => h.startsWith("avg"));
  if (kwIdx === -1) throw httpErr(422, `Kolom "Keyword" niet gevonden in "${sTab}"`);
  const monthIdx = months.map((m) => {
    const tok = MONTH_TOKEN[m] || m;
    const i = header.findIndex((h) => h.replace(/^searches:\s*/, "").startsWith(tok));
    if (i === -1) throw httpErr(422, `Maandkolom "${m}" niet gevonden in "${sTab}"`);
    return i;
  });
  const afterKey = KEYS[(KEYS.indexOf(months[3]) + 1) % 12];
  const nextIdx = header.findIndex((h) => h.replace(/^searches:\s*/, "").startsWith(MONTH_TOKEN[afterKey] || afterKey));
  const compTxtIdx = header.findIndex((h) => h === "competition");
  const compIdxIdx = header.findIndex((h) => h.startsWith("comp. index") || h.includes("indexed"));
  const bidLowIdx = header.findIndex((h) => h.includes("bid low") || h.includes("bid (low"));
  const bidHighIdx = header.findIndex((h) => h.includes("bid high") || h.includes("bid (high"));
  const chg3Idx = header.findIndex((h) => h.startsWith("3-mnd") || h.startsWith("three month"));
  const yoyIdx = header.findIndex((h) => h.startsWith("yoy"));
  const hasCompData = compIdxIdx >= 0 || compTxtIdx >= 0;
  if (!hasCompData)
    warnings.push(`"${sTab}" heeft geen concurrentie/bid/trend-kolommen — draai stap 1 opnieuw met je CSV's voor een véél scherpere underdog-selectie.`);

  const cols = await readColumnsBatch(statsSheetId, sTab, [
    kwIdx, avgIdx, ...monthIdx, nextIdx, compTxtIdx, compIdxIdx, bidLowIdx, bidHighIdx, chg3Idx, yoyIdx,
  ]);
  const nRows = (cols[kwIdx] || []).length;
  if (!nRows) throw httpErr(422, `Geen data-rijen in "${sTab}"`);
  const num = (v) => {
    const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const raw = (v) => (v == null || v === "" ? "" : Number(String(v).replace(/[^\d.-]/g, "")));

  /* -- Markt-context -- */
  const mkt = MARKETS[market] ? market : null;
  const hemisphere = mkt ? MARKETS[mkt].hemisphere : null;
  const windowMonths = months.map((m) => String(m).toLowerCase());
  const windowSeasons = mkt ? windowMonths.map((m) => seasonOf(m, hemisphere)).filter(Boolean) : [];
  const profile = storeProfile(storeUrl);
  const blocked = new Set((profile && profile.block) || []);
  const wantG = genders === "M" ? "M" : "V";

  /* -- Kandidaten (volume-filter eerst — goedkoop) -- */
  const MIN_SEASON = 1200;
  const prepped = prepFamilies(existingCanons);
  const seen = new Set();
  const pre = [];
  const allKws = [];
  const stat = { junk: 0, family: 0, low: 0, unmapped: 0, gender: 0, artefact: 0, blocked: 0 };
  for (let r = 0; r < nRows; r++) {
    const kw = String((cols[kwIdx] || [])[r] || "").toLowerCase().trim().replace(/\s+(uk|united kingdom)$/, "");
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    allKws.push(kw);
    const mm = monthIdx.map((i) => num((cols[i] || [])[r]));
    const windowVol = mm.reduce((s, v) => s + v, 0);
    if (windowVol < MIN_SEASON) { stat.low++; continue; }
    if (isVerdelingJunk(kw)) { stat.junk++; continue; }
    const canon = canonKey(kw);
    if (isFamilyOfExisting(canon, prepped)) { stat.family++; continue; }
    let { col, g } = collectionFor(kw);
    col = consistentCollection(kw, col);
    if (!col) { stat.unmapped++; continue; }
    if (blocked.has(col)) { stat.blocked++; continue; }
    if (g !== wantG) { stat.gender++; continue; }
    pre.push({ kw, canon, col, g, mm, windowVol, row: r });
  }

  /* -- Gerichte steun-index (artefact-detectie) -- */
  const candSet = new Set(pre.filter((c) => c.kw.includes(" ")).map((c) => c.kw));
  const phraseCount = new Map();
  if (candSet.size) {
    for (const kw of allKws) {
      const w = kw.split(" ");
      if (w.length < 2) continue;
      for (let i = 0; i < w.length; i++) {
        for (let j = i + 2; j <= w.length; j++) {
          const g = w.slice(i, j).join(" ");
          if (candSet.has(g)) phraseCount.set(g, (phraseCount.get(g) || 0) + 1);
        }
      }
    }
  }
  const supportOf = (kw) => Math.max(0, (phraseCount.get(kw) || 0) - 1);

  /* -- Scoren -- */
  const candidates = [];
  for (const c of pre) {
    const { kw, canon, col, g, mm, windowVol, row: r } = c;
    const avg = avgIdx >= 0 ? num((cols[avgIdx] || [])[r]) : 0;
    if (kw.includes(" ") && avg >= 10000 && supportOf(kw) === 0) { stat.artefact++; continue; }
    let peak = 0;
    for (let i = 1; i < mm.length; i++) if (mm[i] > mm[peak]) peak = i;
    const next = nextIdx >= 0 ? num((cols[nextIdx] || [])[r]) : "";
    const early = mm[0] + (mm[1] || 0);
    const lastM = mm[mm.length - 1];
    const late = next !== "" ? lastM + next : (mm[mm.length - 2] || 0) + lastM;
    const dying = early > 0 && late < 0.45 * early;
    const cand = {
      kw, canon, col, g, avg, windowVol, months: mm, next, peak: months[peak],
      comp: compTxtIdx >= 0 ? String((cols[compTxtIdx] || [])[r] || "") : "",
      compIdx: compIdxIdx >= 0 ? raw((cols[compIdxIdx] || [])[r]) : "",
      bidLow: bidLowIdx >= 0 ? raw((cols[bidLowIdx] || [])[r]) : "",
      bidHigh: bidHighIdx >= 0 ? raw((cols[bidHighIdx] || [])[r]) : "",
      chg3: chg3Idx >= 0 ? raw((cols[chg3Idx] || [])[r]) : "",
      yoy: yoyIdx >= 0 ? raw((cols[yoyIdx] || [])[r]) : "",
      stemCount: canon ? canon.split(" ").length : 1,
      seasonF: mkt ? seasonFactor(col, windowSeasons) : 1,
      eventF: mkt ? eventFactor(kw, mkt, windowMonths) : 1,
      dying,
    };
    cand.score = underdogScore(cand);
    candidates.push(cand);
  }

  /* -- Onderling ontdubbelen -- */
  const bestByCanon = new Map();
  for (const c of candidates) {
    const prev = bestByCanon.get(c.canon);
    if (!prev || c.score > prev.score) bestByCanon.set(c.canon, c);
  }
  let unique = [...bestByCanon.values()];
  const byFp = new Map();
  for (const c of unique) {
    const key = `${c.col}|${c.avg}|${c.months.join("|")}`;
    const prev = byFp.get(key);
    if (!prev || c.kw.length < prev.kw.length) byFp.set(key, c);
  }
  unique = [...byFp.values()].sort((a, b) => b.score - a.score);

  const pool = unique.slice(0, Math.min(Math.max(target * 2, 120), 350)).map((c) => ({
    kw: c.kw, col: c.col, g: c.g, avg: c.avg, windowVol: c.windowVol, peak: c.peak,
    score: Math.round(c.score * 100) / 100, compIdx: c.compIdx,
    growthPct: Math.round((growthFactor(c.months, c.next) - 1) * 100),
  }));
  const suspects = pool
    .map((c) => ({ kw: c.kw, unknown: unknownFashionTokens(c.kw) }))
    .filter((s) => s.unknown.length)
    .slice(0, 150);

  return {
    ok: true,
    pool, suspects, budget,
    colProducts, existingProducts, maxRank,
    windowSeasons, market: mkt,
    stats: {
      statsRows: nRows, kandidaten: candidates.length, naDedupe: unique.length,
      poolNaarAi: pool.length, ...stat, compData: hasCompData,
      seizoen: windowSeasons.join("-") || "n.v.t.",
    },
    warnings,
  };
}

/* ---------- Stap 4: WRITE — budget vullen en wegschrijven ---------- */

async function writeStep(body) {
  const { orgSheetId, orgTab, picks, productTarget } = body;
  if (!orgSheetId || !String(orgTab || "").trim()) throw httpErr(400, "Organization-sheet of bladnaam ontbreekt");
  if (!Array.isArray(picks) || !picks.length) throw httpErr(422, "Geen underdog-keywords overgebleven na de AI-review");
  const budget = Math.max(20, Math.min(900, Number(productTarget) || 250));

  /* Verse guard + rank: het tabblad kan veranderd zijn tussen prep en write */
  const oTab = String(orgTab).trim();
  const orgRows = await readRange(orgSheetId, `${a1Tab(oTab)}!A1:J`);
  if (!orgRows.length) throw httpErr(422, `Organization-tabblad "${oTab}" is leeg of bestaat niet`);
  let maxRank = 0;
  for (let i = 1; i < orgRows.length; i++) {
    const r = orgRows[i] || [];
    if (r.join(" ").toUpperCase().includes("UNDERDOG KEYWORDS"))
      throw httpErr(422, `"${oTab}" bevat al een underdog-blok — verwijder dat eerst.`);
    const rank = Number(r[0]) || 0;
    if (rank > maxRank) maxRank = rank;
  }
  // Waar het nieuwe blok begint (0-based rij-index in het tabblad)
  const existingRowCount = orgRows.length;

  const clean = picks
    .map((p) => ({
      kw: String(p.kw || "").trim(),
      col: String(p.col || "").trim(),
      g: p.g === "M" ? "M" : "V",
      avg: Number(p.avg) || 0,
      windowVol: Number(p.windowVol) || 0,
      peak: String(p.peak || ""),
      score: Number(p.score) || 0,
      uitleg: String(p.uitleg || "").slice(0, 220),
    }))
    .filter((p) => p.kw && p.col)
    .sort((a, b) => b.score - a.score);

  /* Budget vullen met collectie-plafond (~20%) — underdogs horen breed */
  const scored = allocateUnderdogs(clean);
  const capPerCol = Math.max(8, Math.ceil(budget * 0.2));
  const colUsed = new Map();
  const final = [];
  const skippedByCap = [];
  let left = budget;
  for (const c of scored) {
    if (left < 2) break;
    const used = colUsed.get(c.col) || 0;
    if (used + 2 > capPerCol) { skippedByCap.push(c); continue; }
    const n = Math.max(2, Math.min(c.n, left, capPerCol - used));
    final.push({ ...c, n });
    colUsed.set(c.col, used + n);
    left -= n;
  }
  for (const c of skippedByCap) {
    if (left < 2) break;
    const n = Math.max(2, Math.min(c.n, left));
    final.push({ ...c, n });
    left -= n;
  }
  for (let i = 0; left > 0 && final.length && i < 6000; i++) {
    if (final.every((f) => f.n >= 6)) break;
    const x = final[i % final.length];
    if (x.n < 6) { x.n++; left--; }
  }
  const warnings = [];
  if (left > 0)
    warnings.push(`Niet genoeg sterke underdogs voor ${budget} producten — ${budget - left} gevuld met ${final.length} keywords.`);

  const colSummary = new Map();
  for (const c of final) {
    if (!colSummary.has(c.col)) colSummary.set(c.col, { col: c.col, kws: 0, products: 0, top: [] });
    const s = colSummary.get(c.col);
    s.kws++;
    s.products += c.n;
    if (s.top.length < 3) s.top.push(c.kw);
  }
  const summaryRows = [...colSummary.values()].sort((a, b) => b.products - a.products);

  /* Opbouw van het blok. Bewust met een EIGEN KOPRIJ (het las eerst niet als
     tabel) en met het overzicht in L-O in plaats van K-N: kolom J bevat de
     lange uitleg en liep visueel over het overzicht heen. K blijft leeg als
     scheiding. */
  const stamp = new Date().toISOString().slice(0, 10);
  const EMPTY10 = ["", "", "", "", "", "", "", "", "", ""];
  const banner = [`UNDERDOG KEYWORDS — niche kansen (${stamp})`, "", "", "", "", "", "", "", "", ""];
  const header = [
    "Rank", "Keyword", "Collectie", "Groep", "Avg. volume", "Venster-volume",
    "Piekmaand", "Aantal producten", "Type", "Uitleg voor de scraper (wat is het + hoe herken je het)",
  ];
  const dataRows = final.map((c, i) => [
    maxRank + i + 1, c.kw, c.col, c.g, c.avg, c.windowVol, c.peak, c.n, "Underdog", c.uitleg || "",
  ]);
  const leftRows = [EMPTY10, banner, header, ...dataRows];

  const infoLines = [
    "WAT ZIJN UNDERDOG-KEYWORDS?",
    "Echte zoekvragen met bewezen vraag maar lage concurrentie — bewust níet de voor de hand liggende termen waar iedereen op adverteert.",
    "Gekozen op data: venstervolume × groei × YoY-trend × concurrentie-index × biedingen × long-tail, plus AI-review.",
    "Voor de scraper: deze woorden staan zelden letterlijk in producttitels van concurrenten. Kolom J zegt per keyword wat het item ís en hoe je het herkent — match op titel + omschrijving + foto, niet op de letterlijke term.",
    "Voor de importer: verwerk het keyword functioneel in titel, omschrijving en tags, zodat de zoekvraag bij onze store landt.",
  ];
  const rightRows = [
    ["Collectie", "Aantal keywords", "Aantal producten", "Top keywords"],
    ...summaryRows.map((c) => [c.col, c.kws, c.products, c.top.join(", ")]),
    ["", "", "", ""],
    ...infoLines.map((t) => [t, "", "", ""]),
  ];

  // Rechterblok start op de koprij-hoogte; K blijft leeg als scheidingskolom.
  const rightOffset = 2; // 0 = lege rij, 1 = banner, 2 = koprij
  const nOut = Math.max(leftRows.length, rightRows.length + rightOffset);
  const values = [];
  for (let i = 0; i < nOut; i++) {
    const L = leftRows[i] || EMPTY10;
    const R = i >= rightOffset ? rightRows[i - rightOffset] || [] : [];
    values.push([...L, "", ...R]);
  }
  await appendRows(orgSheetId, `${a1Tab(oTab)}!A1`, values, "RAW");

  /* Opmaak. Faalt dit, dan is de data er nog steeds — daarom apart en
     niet-blokkerend. */
  let formatted = false;
  try {
    const tabId = await getTabIdByTitle(orgSheetId, oTab);
    if (tabId != null) {
      const base = existingRowCount; // 0-based index van de eerste nieuwe rij
      const bannerRow = base + 1;
      const headerRow = base + 2;
      const firstDataRow = base + 3;
      const lastDataRow = firstDataRow + dataRows.length;
      const summaryHeaderRow = base + rightOffset;
      const summaryLastRow = summaryHeaderRow + 1 + summaryRows.length;
      const infoFirstRow = summaryLastRow + 1;
      await formatUnderdogBlock(orgSheetId, tabId, {
        bannerRow,
        headerRow,
        firstDataRow,
        lastDataRow,
        summaryHeaderRow,
        summaryLastRow,
        infoFirstRow,
        infoLastRow: infoFirstRow + infoLines.length,
      });
      formatted = true;
    }
  } catch (e) {
    warnings.push(`Opmaak van het underdog-blok mislukte (${e.message}) — de gegevens staan er wel gewoon in.`);
  }

  const id = parseSheetId(orgSheetId);
  return {
    ok: true,
    url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    added: final.length,
    totalUnderdogProducts: final.reduce((s, x) => s + x.n, 0),
    productTarget: budget,
    collections: summaryRows,
    formatted,
    warnings,
  };
}

/* ---------- dispatcher ---------- */

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "prep") return NextResponse.json(await prepStep(body));

    if (body.action === "sieve") {
      // Client stuurt stukken van 50 — de cap hier is een vangnet, zodat één
      // verzoek nooit meer dan ~1 snelle AI-call hoeft te doen.
      const suspects = (Array.isArray(body.suspects) ? body.suspects : []).slice(0, 60);
      if (!suspects.length) return NextResponse.json({ ok: true, removals: [] });
      const removals = await classifyUnknownTokens(suspects);
      return NextResponse.json({ ok: true, removals });
    }

    if (body.action === "review") {
      // Client stuurt stukken van 25 — cap 30 als vangnet: altijd precies één
      // Sonnet-call per verzoek, ruim binnen Vercel's 60s-venster (60 items
      // paste NIET; dat was de 504 midden in de review).
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30);
      if (!items.length) return NextResponse.json({ ok: true, picks: [], drop: [] });
      const out = await reviewUnderdogPicks(items, body.opts || {});
      return NextResponse.json({ ok: true, ...out });
    }

    if (body.action === "write") return NextResponse.json(await writeStep(body));

    // Oude frontend (zonder action) → duidelijke melding i.p.v. een monoliet-run
    return NextResponse.json(
      { error: "Je pagina draait een oude versie van de tool — ververs hard met Ctrl+Shift+R en probeer opnieuw." },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
