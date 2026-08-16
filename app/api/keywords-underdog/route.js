import { NextResponse } from "next/server";
import { readRange, appendRows, parseSheetId } from "@/lib/sheets";
import {
  canonKey, isVerdelingJunk, collectionFor, consistentCollection, keywordType,
  MARKETS, seasonOf, seasonFactor, eventFactor, storeProfile,
} from "@/lib/verdeling";
import {
  underdogScore, isFamilyOfExisting, allocateUnderdogs, growthFactor,
} from "@/lib/underdog";
import { classifyJunkKeywordsBatch, classifyUnknownTokens, reviewUnderdogPicks } from "@/lib/ai";
import { unknownFashionTokens } from "@/lib/brands";

export const maxDuration = 60;

const MONTH_TOKEN = {
  jan: "jan", feb: "feb", mrt: "mar", apr: "apr", mei: "may", jun: "jun",
  jul: "jul", aug: "aug", sep: "sep", okt: "oct", nov: "nov", dec: "dec",
};
const KEYS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function colLetter(i) {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const {
    orgSheetId, orgTab, statsSheetId, statsTab,
    months, genders, market, storeUrl, count, productTarget,
  } = body;

  if (!orgSheetId || !String(orgTab || "").trim())
    return NextResponse.json({ error: "Organization-sheet of bladnaam ontbreekt" }, { status: 400 });
  if (!statsSheetId || !String(statsTab || "").trim())
    return NextResponse.json({ error: "All-batch-stats-sheet of bladnaam ontbreekt" }, { status: 400 });
  if (!Array.isArray(months) || months.length !== 4)
    return NextResponse.json({ error: "Kies precies 4 maanden" }, { status: 400 });

  /* Justin kiest het aantal PRODUCTEN; hoeveel keywords daarvoor nodig zijn
     bepaalt de engine zelf (vloer 2 / cap 6 per keyword, naar score). Oude
     aanroepen met "count" (keywords) blijven werken via ×3. */
  const budget = Math.max(
    20,
    Math.min(900, Number(productTarget) || (Number(count) ? Number(count) * 3 : 250))
  );
  const target = Math.min(300, Math.floor(budget / 2)); // max # keywords als alles de vloer krijgt
  const T0 = Date.now();
  const msLeft = () => 50000 - (Date.now() - T0);
  const warnings = [];

  try {
    /* ---- 1. Bestaande organization inlezen: wat is er al? ---- */
    const oTab = String(orgTab).trim();
    const orgRows = await readRange(orgSheetId, `'${oTab}'!A1:J`);
    if (!orgRows.length) throw new Error(`Organization-tabblad "${oTab}" is leeg of bestaat niet`);
    const oHead = (orgRows[0] || []).map((h) => String(h || "").toLowerCase());
    const oKw = oHead.findIndex((h) => h.startsWith("keyword"));
    const oCol = oHead.findIndex((h) => h.startsWith("collectie"));
    const oN = oHead.findIndex((h) => h.startsWith("aantal"));
    const oType = oHead.findIndex((h) => h.startsWith("type"));
    if (oKw === -1 || oCol === -1)
      throw new Error(`"${oTab}" mist de kolommen Keyword/Collectie — is dit wel een organization-tabblad?`);

    const existingCanons = new Set();
    const colProducts = new Map();
    let existingProducts = 0;
    let maxRank = 0;
    let hasUnderdogBlock = false;
    for (let i = 1; i < orgRows.length; i++) {
      const r = orgRows[i] || [];
      const kw = String(r[oKw] || "").trim().toLowerCase();
      const joined = r.join(" ").toUpperCase();
      if (joined.includes("UNDERDOG KEYWORDS")) hasUnderdogBlock = true;
      if (!kw) continue;
      if (oType >= 0 && String(r[oType] || "").toLowerCase() === "underdog") hasUnderdogBlock = true;
      const c = canonKey(kw);
      if (c) existingCanons.add(c);
      const col = String(r[oCol] || "").trim();
      const n = Number(r[oN]) || 0;
      if (col) colProducts.set(col, (colProducts.get(col) || 0) + n);
      existingProducts += n;
      const rank = Number(r[0]) || 0;
      if (rank > maxRank) maxRank = rank;
    }
    if (hasUnderdogBlock)
      throw new Error(
        `"${oTab}" bevat al een underdog-blok. Verwijder dat blok eerst (of gebruik een kopie van het tabblad) — twee keer draaien zou dubbele keywords geven.`
      );
    if (!existingCanons.size)
      throw new Error(`Geen bestaande keywords gevonden in "${oTab}"`);

    /* ---- 2. Stats-tabblad: kolommen vinden en lezen ---- */
    const sTab = String(statsTab).trim();
    const headerRows = await readRange(statsSheetId, `'${sTab}'!1:1`);
    const header = (headerRows[0] || []).map((h) => String(h || "").toLowerCase());
    if (!header.length) throw new Error(`Stats-tabblad "${sTab}" is leeg of bestaat niet`);

    const kwIdx = header.findIndex((h) => h.startsWith("keyword"));
    const avgIdx = header.findIndex((h) => h.startsWith("avg"));
    if (kwIdx === -1) throw new Error(`Kolom "Keyword" niet gevonden in "${sTab}"`);
    const monthIdx = months.map((m) => {
      const tok = MONTH_TOKEN[m] || m;
      const i = header.findIndex((h) => h.replace(/^searches:\s*/, "").startsWith(tok));
      if (i === -1) throw new Error(`Maandkolom "${m}" niet gevonden in "${sTab}"`);
      return i;
    });
    const afterKey = KEYS[(KEYS.indexOf(months[3]) + 1) % 12];
    const nextIdx = header.findIndex((h) =>
      h.replace(/^searches:\s*/, "").startsWith(MONTH_TOKEN[afterKey] || afterKey)
    );
    // Underdog-kolommen (stap 1 nieuw) — mogen ontbreken bij oude tabbladen
    const compTxtIdx = header.findIndex((h) => h === "competition");
    const compIdxIdx = header.findIndex((h) => h.startsWith("comp. index") || h.includes("indexed"));
    const bidLowIdx = header.findIndex((h) => h.includes("bid low") || h.includes("bid (low"));
    const bidHighIdx = header.findIndex((h) => h.includes("bid high") || h.includes("bid (high"));
    const chg3Idx = header.findIndex((h) => h.startsWith("3-mnd") || h.startsWith("three month"));
    const yoyIdx = header.findIndex((h) => h.startsWith("yoy"));
    const hasCompData = compIdxIdx >= 0 || compTxtIdx >= 0;
    if (!hasCompData)
      warnings.push(
        `"${sTab}" heeft geen concurrentie/bid/trend-kolommen — draai stap 1 opnieuw met je CSV's voor een véél scherpere underdog-selectie. Nu rekent de engine op volume, venster-groei en long-tail alleen.`
      );

    const wanted = [
      ...new Set(
        [kwIdx, avgIdx, ...monthIdx, nextIdx, compTxtIdx, compIdxIdx, bidLowIdx, bidHighIdx, chg3Idx, yoyIdx].filter(
          (i) => i >= 0
        )
      ),
    ];
    const fetched = await Promise.all(
      wanted.map(async (i) => {
        const L = colLetter(i);
        const vals = await readRange(statsSheetId, `'${sTab}'!${L}2:${L}`);
        return [i, vals.map((r) => r[0])];
      })
    );
    const cols = Object.fromEntries(fetched);
    const nRows = cols[kwIdx].length;
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const raw = (v) => (v == null || v === "" ? "" : Number(String(v).replace(/[^\d.-]/g, "")));

    /* ---- 3. Markt-context ---- */
    const mkt = MARKETS[market] ? market : null;
    const hemisphere = mkt ? MARKETS[mkt].hemisphere : null;
    const windowMonths = months.map((m) => String(m).toLowerCase());
    const windowSeasons = mkt ? windowMonths.map((m) => seasonOf(m, hemisphere)).filter(Boolean) : [];
    const profile = storeProfile(storeUrl);
    const blocked = new Set((profile && profile.block) || []);
    const wantG = genders === "M" || genders === "V" ? genders : "V";

    /* ---- 4. Kandidaten bouwen ---- */
    const MIN_SEASON = 1200; // lager dan de hoofdverdeling: underdogs mogen klein zijn
    const seen = new Set();
    const candidates = [];
    const phraseCount = new Map();
    const allKws = [];
    for (let r = 0; r < nRows; r++) {
      const kw = String(cols[kwIdx][r] || "").toLowerCase().trim().replace(/\s+(uk|united kingdom)$/, "");
      if (!kw || seen.has(kw)) continue;
      seen.add(kw);
      allKws.push(kw);
    }
    // Steun-index over de VOLLEDIGE lijst (182k) — artefact-detectie
    for (const kw of allKws) {
      const w = kw.split(" ");
      const grams = new Set();
      for (let i = 0; i < w.length; i++) {
        for (let j = i + 2; j <= w.length; j++) grams.add(w.slice(i, j).join(" "));
      }
      for (const g of grams) phraseCount.set(g, (phraseCount.get(g) || 0) + 1);
    }
    const supportOf = (kw) => Math.max(0, (phraseCount.get(kw) || 0) - 1);

    seen.clear();
    let stat = { junk: 0, family: 0, low: 0, unmapped: 0, gender: 0, artefact: 0, blocked: 0 };
    for (let r = 0; r < nRows; r++) {
      const kw = String(cols[kwIdx][r] || "").toLowerCase().trim().replace(/\s+(uk|united kingdom)$/, "");
      if (!kw || seen.has(kw)) continue;
      seen.add(kw);
      if (isVerdelingJunk(kw)) { stat.junk++; continue; }
      const canon = canonKey(kw);
      if (isFamilyOfExisting(canon, existingCanons)) { stat.family++; continue; }
      const mm = monthIdx.map((i) => num(cols[i][r]));
      const windowVol = mm.reduce((s, v) => s + v, 0);
      if (windowVol < MIN_SEASON) { stat.low++; continue; }
      const avg = avgIdx >= 0 ? num(cols[avgIdx][r]) : 0;
      const multi = kw.split(/\s+/).length >= 2;
      if (multi && avg >= 10000 && supportOf(kw) === 0) { stat.artefact++; continue; }
      let { col, g } = collectionFor(kw);
      col = consistentCollection(kw, col);
      if (!col) { stat.unmapped++; continue; }
      if (blocked.has(col)) { stat.blocked++; continue; }
      if (g !== wantG) { stat.gender++; continue; }

      let peak = 0;
      for (let i = 1; i < mm.length; i++) if (mm[i] > mm[peak]) peak = i;
      const next = nextIdx >= 0 ? num(cols[nextIdx][r]) : "";
      const early = mm[0] + (mm[1] || 0);
      const lastM = mm[mm.length - 1];
      const late = next !== "" ? lastM + next : (mm[mm.length - 2] || 0) + lastM;
      const dying = early > 0 && late < 0.45 * early;

      const cand = {
        kw, canon, col, g,
        avg, windowVol, months: mm, next,
        peak: months[peak],
        comp: compTxtIdx >= 0 ? String(cols[compTxtIdx][r] || "") : "",
        compIdx: compIdxIdx >= 0 ? raw(cols[compIdxIdx][r]) : "",
        bidLow: bidLowIdx >= 0 ? raw(cols[bidLowIdx][r]) : "",
        bidHigh: bidHighIdx >= 0 ? raw(cols[bidHighIdx][r]) : "",
        chg3: chg3Idx >= 0 ? raw(cols[chg3Idx][r]) : "",
        yoy: yoyIdx >= 0 ? raw(cols[yoyIdx][r]) : "",
        stemCount: canon ? canon.split(" ").length : 1,
        seasonF: mkt ? seasonFactor(col, windowSeasons) : 1,
        eventF: mkt ? eventFactor(kw, mkt, windowMonths) : 1,
        dying,
      };
      cand.score = underdogScore(cand);
      candidates.push(cand);
    }

    /* ---- 5. Onderling ontdubbelen (canon + volume-fingerprint) ---- */
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

    /* ---- 6. AI-lagen over de top-pool ---- */
    const pool = unique.slice(0, Math.min(Math.max(target * 2, 120), 400));
    const excluded = new Set();
    const aiRemoved = [];

    try {
      if (msLeft() > 15000) {
        const items = pool.map((c, i) => ({ index: i, kw: c.kw }));
        for (let i = 0; i < items.length; i += 160) {
          const part = items.slice(i, i + 160);
          const removals = await classifyJunkKeywordsBatch(part, { market: mkt });
          for (const rem of removals) {
            const hit = items[rem.index];
            if (hit && part.some((p) => p.index === rem.index)) {
              excluded.add(hit.kw);
              aiRemoved.push(`${hit.kw} (${rem.reason || "junk"})`);
            }
          }
        }
      } else warnings.push("Tijd krap — merken-AI-check overgeslagen.");
    } catch { warnings.push("Merken-AI-check faalde — statische filters blijven gelden."); }

    try {
      if (msLeft() > 12000) {
        const suspects = pool
          .filter((c) => !excluded.has(c.kw))
          .map((c) => ({ kw: c.kw, unknown: unknownFashionTokens(c.kw) }))
          .filter((s) => s.unknown.length);
        if (suspects.length) {
          const verdicts = await classifyUnknownTokens(suspects.slice(0, 200));
          for (const v of verdicts) {
            excluded.add(v.kw);
            aiRemoved.push(`${v.kw} (${v.reason})`);
          }
        }
      }
    } catch {}

    /* ---- 7. De denk-laag: AI kiest en schrijft de scraper-uitleg ---- */
    let picked = [];
    const afterFilters = pool.filter((c) => !excluded.has(c.kw));
    if (msLeft() < 10000) {
      warnings.push("Tijd krap — underdog-review zonder AI-uitleg gedraaid; draai opnieuw voor uitleg per keyword.");
      picked = afterFilters.slice(0, target).map((c) => ({ ...c, uitleg: "" }));
    } else {
      const review = await reviewUnderdogPicks(
        afterFilters.slice(0, Math.min(afterFilters.length, 300)).map((c) => ({
          kw: c.kw, col: c.col, windowVol: c.windowVol, avg: c.avg,
          compIdx: c.compIdx,
          growthPct: Math.round((growthFactor(c.months, c.next) - 1) * 100),
        })),
        {
          market: mkt, months: windowMonths, seasons: windowSeasons, storeUrl,
          existing: [...colProducts.entries()].map(([col, products]) => ({ col, products })),
          target,
        }
      );
      const byKw = new Map(afterFilters.map((c) => [c.kw, c]));
      for (const d of review.drop) {
        if (byKw.has(d.kw)) aiRemoved.push(`${d.kw} (${d.reason})`);
      }
      for (const p of review.picks) {
        const c = byKw.get(p.kw);
        if (!c) continue;
        // AI mag hercollecteren, maar alleen naar een bestaande collectie
        const col = colProducts.has(p.collection) ? p.collection : c.col;
        picked.push({ ...c, col, uitleg: p.uitleg });
      }
      picked.sort((a, b) => b.score - a.score);
      picked = picked.slice(0, target);
    }

    if (!picked.length)
      throw new Error("Geen underdog-keywords overgebleven — verlaag het aantal niet-gedekte filters of check de bron-tabbladen.");

    /* ---- 8. Productbudget vullen: beste underdogs eerst, tot het gekozen
            aantal PRODUCTEN bereikt is (vloer 2 / cap 6 per keyword) ---- */
    const scored = allocateUnderdogs(picked);
    const final = [];
    let left = budget;
    for (const c of scored) {
      if (left < 2) break;
      const n = Math.max(2, Math.min(c.n, left));
      final.push({ ...c, n });
      left -= n;
    }
    // Budget nog niet vol maar keywords op → sterkste keywords bijvullen tot cap
    for (let i = 0; left > 0 && final.length && i < 6000; i++) {
      if (final.every((f) => f.n >= 6)) break;
      const x = final[i % final.length];
      if (x.n < 6) {
        x.n++;
        left--;
      }
    }
    if (left > 0) {
      warnings.push(
        `Niet genoeg sterke underdogs voor ${budget} producten — ${budget - left} gevuld met ${final.length} keywords. Meer batch-data (stap 1 met verse CSV's incl. concurrentie-kolommen) geeft de engine meer om uit te kiezen.`
      );
    }

    const colSummary = new Map();
    for (const c of final) {
      if (!colSummary.has(c.col)) colSummary.set(c.col, { col: c.col, kws: 0, products: 0, top: [] });
      const s = colSummary.get(c.col);
      s.kws++;
      s.products += c.n;
      if (s.top.length < 3) s.top.push(c.kw);
    }
    const summaryRows = [...colSummary.values()].sort((a, b) => b.products - a.products);

    /* ---- 9. Wegschrijven: tabel (A-J) + underdog-overzicht en uitleg (K-N),
            in dezelfde stijl als het overzicht van de hoofdverdeling ---- */
    const stamp = new Date().toISOString().slice(0, 10);
    const EMPTY10 = ["", "", "", "", "", "", "", "", "", ""];
    const title = [
      "", `UNDERDOG KEYWORDS — niche kansen (${stamp})`, "", "", "", "", "", "", "",
      "Uitleg voor de scraper (wat is het + hoe herken je het op de foto)",
    ];
    const leftRows = [
      EMPTY10,
      title,
      ...final.map((c, i) => [
        maxRank + i + 1, c.kw, c.col, c.g, c.avg, c.windowVol, c.peak, c.n, "Underdog", c.uitleg || "",
      ]),
    ];
    const rightRows = [
      ["Collectie", "Aantal keywords", "Aantal producten", "Top keywords"],
      ...summaryRows.map((c) => [c.col, c.kws, c.products, c.top.join(", ")]),
      ["", "", "", ""],
      ["WAT ZIJN UNDERDOG-KEYWORDS?", "", "", ""],
      ["Echte zoekvragen met bewezen vraag maar lage concurrentie — bewust níet de voor de hand liggende termen waar iedereen op adverteert.", "", "", ""],
      ["Gekozen op data: venstervolume × groei × YoY-trend × concurrentie-index × biedingen × long-tail, plus AI-review.", "", "", ""],
      ["Voor de scraper: deze woorden staan zelden letterlijk in producttitels van concurrenten. Kolom J zegt per keyword wat het item ís en hoe je het herkent — match op titel + omschrijving + foto, niet op de letterlijke term.", "", "", ""],
      ["Voor de importer: verwerk het keyword functioneel in titel, omschrijving en tags, zodat de zoekvraag bij onze store landt.", "", "", ""],
    ];
    // Rechterblok begint naast de titelregel; is het langer dan de tabel, dan
    // vullen lege A-J-rijen aan zodat alles netjes uitlijnt.
    const nOut = Math.max(leftRows.length, rightRows.length + 1);
    const values = [];
    for (let i = 0; i < nOut; i++) {
      const L = leftRows[i] || EMPTY10;
      const R = i >= 1 ? rightRows[i - 1] || [] : [];
      values.push([...L, ...R]);
    }
    await appendRows(orgSheetId, `'${oTab}'!A1`, values, "RAW");

    const id = parseSheetId(orgSheetId);
    return NextResponse.json({
      ok: true,
      url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      added: final.length,
      totalUnderdogProducts: final.reduce((s, x) => s + x.n, 0),
      productTarget: budget,
      existingProducts,
      collections: summaryRows,
      aiRemoved: aiRemoved.slice(0, 40),
      stats: {
        statsRows: nRows, kandidaten: candidates.length, naDedupe: unique.length,
        poolNaarAi: pool.length, ...stat, compData: hasCompData,
        seizoen: windowSeasons.join("-") || "n.v.t.",
      },
      warnings,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
