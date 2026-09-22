import { NextResponse } from "next/server";
import { addTab, appendRows, formatVerdelingTab, parseSheetId, a1Tab } from "@/lib/sheets";
import { orderWindow, storeProfile, MARKETS, seasonOf } from "@/lib/verdeling";
import { parseBijvulBrief, reviewVerdelingFinal } from "@/lib/ai";
import { getTabMarket } from "@/lib/kw-memory";
import { readOrganization, readStatsRows, buildBijvul, shiftWindow, rowType } from "@/lib/bijvullen";

/* BIJVULLEN — in drie korte stappen die de browser na elkaar aanroept (net
   als de underdog-run), zodat geen enkele stap in de buurt van Vercel's
   tijdslimiet komt:
     plan  → originele organization inlezen + de instructie van de
             mediabuyer omzetten in een plan (AI)
     prep  → verse keyword-data inlezen, bijvul-verdeling berekenen,
             AI-eindcontrole, voorbeeld terug
     write → nieuw tabblad in de aanvul-sheet schrijven                 */
export const maxDuration = 300;

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ---------- stap 1: PLAN ---------- */
async function planStep(body) {
  const { orgSheetId, orgTab, instruction, storeUrl, productTarget } = body;
  const org = await readOrganization(orgSheetId, orgTab, body.genders);
  const prof = storeProfile(storeUrl);
  const market = body.market || (prof && prof.market) || "";
  const months = Array.isArray(body.months) && body.months.length === 4 ? orderWindow(body.months) : shiftWindow(org.origMonths, 1);

  let plan;
  try {
    plan = await parseBijvulBrief(instruction, {
      storeUrl,
      market,
      genders: org.genders,
      existingProducts: org.existingProducts,
      existing: Object.entries(org.colProducts).map(([col, products]) => ({ col, products })),
      months,
      productTarget: Number(productTarget) > 0 ? Number(productTarget) : null,
    });
  } catch (e) {
    throw httpErr(502, `AI kon de instructie niet lezen (${e.message || e}). Formuleer korter: "loafers heren en dames, 300 producten".`);
  }
  if (Number(productTarget) > 0) plan.target = Math.max(20, Math.min(900, Number(productTarget)));

  return {
    ok: true,
    plan,
    org: {
      tab: org.tab,
      genders: org.genders,
      keywords: org.keywords.length,
      products: org.existingProducts,
      underdogs: org.underdogs,
      maxRank: org.maxRank,
      origMonths: org.origMonths,
      collections: Object.entries(org.colProducts).map(([col, products]) => ({ col, products })).sort((a, b) => b.products - a.products),
    },
    months,
    suggestedMonths: shiftWindow(org.origMonths, 1),
    market,
  };
}

/* ---------- stap 2: PREP ---------- */
async function prepStep(body) {
  const { orgSheetId, orgTab, statsSheetId, statsTab, storeUrl, plan } = body;
  if (!plan || typeof plan !== "object") throw httpErr(400, "Geen plan — draai eerst stap 1");
  const months = orderWindow(body.months || []);
  if (months.length !== 4) throw httpErr(400, "Kies precies 4 maanden");
  const prof = storeProfile(storeUrl);
  const market = body.market || (prof && prof.market) || "";
  const T0 = Date.now();
  const msLeft = () => maxDuration * 1000 - 14000 - (Date.now() - T0);
  const warnings = [];
  const skipped = [];

  /* Markt-bewaking: een batch die als andere markt geregistreerd staat
     mag hier nooit doorheen (zelfde regel als de verdeling). */
  const knownMarket = await getTabMarket(statsSheetId, String(statsTab || "").trim());
  if (knownMarket && market && knownMarket !== market)
    throw httpErr(422, `MARKT KLOPT NIET: "${statsTab}" is geregistreerd als ${knownMarket}-batch, maar je vult bij voor ${market}.`);

  const org = await readOrganization(orgSheetId, orgTab, body.genders);
  const stats = await readStatsRows(statsSheetId, statsTab, months);
  if (!stats.rows.length) throw httpErr(422, `Geen data-rijen in "${statsTab}"`);

  const opts = { months, market, storeUrl, productTarget: plan.target };
  let result = buildBijvul(stats.rows, org, plan, opts);
  if (!result.rows.length)
    throw httpErr(422, "Geen nieuwe keywords over — alles wat in deze batch staat zit al in de organization, of heeft te weinig volume in dit venster. Draai Keyword Planner op andere zoekwoorden (de productsoorten van de mediabuyer) en probeer opnieuw.");

  /* AI-eindcontrole over het hele plan (merken, artefacten, seizoen,
     doelgroep) — max 2 rondes, daarna herberekenen met de afvallers
     uitgesloten zodat het budget naar het volgende beste keyword gaat. */
  const aiRemoved = [];
  const extraExclude = [];
  const hemisphere = MARKETS[market] ? MARKETS[market].hemisphere : null;
  const seasons = hemisphere ? months.map((m) => seasonOf(m, hemisphere)).filter(Boolean) : [];
  try {
    for (let round = 0; round < 2; round++) {
      if (msLeft() < 20000) {
        skipped.push("AI-eindcontrole");
        break;
      }
      const flagged = await reviewVerdelingFinal(
        result.rows.map((r) => ({ kw: r.kw, col: r.col, n: r.n, vol: r.season })),
        market,
        storeUrl,
        { months, seasons, audience: prof && prof.audience }
      );
      const fresh = flagged.filter((f) => result.rows.some((r) => r.kw === f.kw));
      if (!fresh.length) break;
      for (const f of fresh) {
        extraExclude.push(f.kw);
        aiRemoved.push(`${f.kw} (${f.reason})`);
      }
      result = buildBijvul(stats.rows, org, plan, { ...opts, extraExclude });
    }
  } catch {
    skipped.push("AI-eindcontrole");
  }

  for (const f of result.focusReport) {
    if (f.got < f.wanted * 0.6)
      warnings.push(
        `"${f.label}": gevraagd ±${f.wanted} producten, gevonden ${f.got} (${f.keywords} keywords met deze termen in de batch). Meer keywords nodig? Draai Keyword Planner op "${f.label}"-zoekwoorden en voeg die batch toe.`
      );
  }
  if (result.totalProducts < result.target * 0.85)
    warnings.push(`Doel ${result.target} producten, gevuld ${result.totalProducts} — de batch heeft niet genoeg nieuwe keywords met vraag in dit venster.`);
  if (skipped.length) warnings.push(`Overgeslagen door tijd: ${[...new Set(skipped)].join(", ")}.`);
  if (!market) warnings.push("Geen markt — seizoen en verkoopagenda zijn niet meegerekend.");
  if (!stats.hasNext) warnings.push(`De maand ná je venster (${stats.afterKey}) staat niet in de batch — de sterfte-check per keyword kon niet draaien.`);
  const nieuweCols = result.collections.filter((c) => c.nieuw).map((c) => c.col);

  return {
    ok: true,
    rows: result.rows.map((r) => ({
      rank: r.rank, kw: r.kw, col: r.col, g: r.g, avg: r.avg, season: r.season, peak: r.peak, n: r.n,
      type: rowType(r.kw), bron: r.bron,
    })),
    collections: result.collections,
    nieuweCollecties: nieuweCols,
    totalProducts: result.totalProducts,
    target: result.target,
    focusReport: result.focusReport,
    aiRemoved,
    warnings,
    months,
    market,
    org: { tab: org.tab, genders: org.genders, gLabel: org.gLabel, products: org.existingProducts, keywords: org.keywords.length, maxRank: org.maxRank, colProducts: org.colProducts },
    statsRows: stats.rows.length,
  };
}

/* ---------- stap 3: WRITE ---------- */
async function writeStep(body) {
  const { targetSheetId, targetTab, rows, collections, meta } = body;
  if (!targetSheetId || !String(targetTab || "").trim()) throw httpErr(400, "Aanvul-sheet of bladnaam ontbreekt");
  if (!Array.isArray(rows) || !rows.length) throw httpErr(422, "Niets om weg te schrijven — draai eerst stap 2");
  const m = meta || {};
  const months = orderWindow(m.months || []);
  const label = months.join("-");
  const startRank = Number(m.maxRank) > 0 ? Number(m.maxRank) : 0;

  const t = await addTab(targetSheetId, String(targetTab).trim());
  if (!t.ok) throw httpErr(422, t.error);

  const gLabel = m.gLabel || (m.genders === "M" ? "Groep — alleen heren" : m.genders === "V" ? "Groep — alleen dames" : "Groep");
  /* Zelfde 9 kolommen als een verdeling (A–I), zodat scraper en importer
     dit blad één-op-één kunnen lezen. Kolom J zegt waar het keyword vandaan
     komt (de gevraagde productsoort of de algemene aanvulling). De rank
     loopt door op de originele organization, zodat beide bladen samen één
     doorlopende lijst vormen. */
  const left = [
    ["Rank", "Keyword", "Collectie", gLabel, "Avg. volume", `Volume ${label}`, "Piekmaand", "Aantal producten", "Type", "Bijvul-bron"],
    ...rows.map((r, i) => [startRank + i + 1, r.kw, r.col, r.g, r.avg, r.season, r.peak, r.n, r.type || "", r.bron || ""]),
  ];
  const right = [
    ["Collectie", "Bestaand (origineel)", "Bijvul keywords", "Bijvul producten", "Top keywords"],
    ...(collections || []).map((c) => [c.col + (c.nieuw ? " (NIEUW)" : ""), c.bestaand || 0, c.kws, c.products, (c.top || []).join(", ")]),
  ];
  const diag = [["Diagnose", ""]];
  diag.push(["Bijvul van", `${m.orgTab || "?"} (${m.orgProducts || "?"} producten, ${m.orgKeywords || "?"} keywords, venster ${(m.origMonths || []).join("-") || "?"})`]);
  diag.push(["Venster aanvulling", label]);
  diag.push(["Instructie", String(m.instruction || "").slice(0, 400)]);
  if (m.planSummary) diag.push(["Plan (AI)", m.planSummary]);
  for (const f of m.focusReport || []) diag.push(["Focus", `${f.label}: gevraagd ±${f.wanted}, gevuld ${f.got} (${f.keywords} keywords in batch)`]);
  diag.push(["Totaal", `${rows.reduce((s, r) => s + (Number(r.n) || 0), 0)} producten · ${rows.length} keywords · doel ${m.target || "?"}`]);
  for (const n of m.planNotes || []) diag.push(["Aanname", n]);
  for (const w of m.warnings || []) diag.push(["Let op", w]);
  for (const a of m.aiRemoved || []) diag.push(["AI verwijderde", a]);
  diag.push(["Scraper/importer", "Lees dit blad als een gewone organization (A–I). Rank loopt door op het origineel. Collecties met (NIEUW) bestaan nog niet in de store — eerst aanmaken."]);

  const nOut = Math.max(left.length, right.length, diag.length);
  const values = [];
  const padLeft = new Array(10).fill("");
  const padRight = new Array(5).fill("");
  for (let i = 0; i < nOut; i++) {
    values.push([...(left[i] || padLeft), "", ...(right[i] || padRight), "", ...(diag[i] || [])]);
  }
  await appendRows(targetSheetId, `${a1Tab(t.title)}!A1`, values, "RAW");
  let formatted = false;
  try {
    await formatVerdelingTab(targetSheetId, t.tabId, left.length, 10, 19);
    formatted = true;
  } catch {}

  const id = parseSheetId(targetSheetId);
  return {
    ok: true,
    url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${t.tabId}`,
    title: t.title,
    tabId: t.tabId,
    keywordCount: rows.length,
    totalProducts: rows.reduce((s, r) => s + (Number(r.n) || 0), 0),
    formatted,
  };
}

/* ---------- dispatcher ---------- */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "plan") return NextResponse.json(await planStep(body));
    if (body.action === "prep") return NextResponse.json(await prepStep(body));
    if (body.action === "write") return NextResponse.json(await writeStep(body));
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[keywords-bijvullen]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
