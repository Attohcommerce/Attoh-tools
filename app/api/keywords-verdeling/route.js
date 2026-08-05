import { NextResponse } from "next/server";
import { readRange, addTab, appendRows, formatVerdelingTab, parseSheetId } from "@/lib/sheets";
import { buildVerdeling } from "@/lib/verdeling";
import { classifyJunkKeywordsBatch } from "@/lib/ai";

export const maxDuration = 60;

// Nederlandse maand-key → Engels token zoals in de sheet-koppen ("Jul 2025")
const MONTH_TOKEN = {
  jan: "jan", feb: "feb", mrt: "mar", apr: "apr", mei: "may", jun: "jun",
  jul: "jul", aug: "aug", sep: "sep", okt: "oct", nov: "nov", dec: "dec",
};

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
  const { sourceSheetId, sourceTab, targetSheetId, targetTab, months, genders, total } = body;

  if (!sourceSheetId || !String(sourceTab || "").trim()) {
    return NextResponse.json({ error: "Bron-sheet of bron-tabblad ontbreekt" }, { status: 400 });
  }
  if (!targetSheetId || !String(targetTab || "").trim()) {
    return NextResponse.json({ error: "Doel-sheet of bladnaam ontbreekt" }, { status: 400 });
  }
  if (!Array.isArray(months) || months.length !== 4) {
    return NextResponse.json({ error: "Kies precies 4 maanden" }, { status: 400 });
  }

  try {
    const src = String(sourceTab).trim();

    /* ---- 1. kolommen vinden in het bron-tabblad ---- */
    const headerRows = await readRange(sourceSheetId, `'${src}'!1:1`);
    const header = (headerRows[0] || []).map((h) => String(h || "").toLowerCase());
    if (!header.length) throw new Error(`Tabblad "${src}" is leeg`);

    const kwIdx = header.findIndex((h) => h.startsWith("keyword"));
    const avgIdx = header.findIndex((h) => h.startsWith("avg"));
    const monthIdx = months.map((m) => {
      const tok = MONTH_TOKEN[m] || m;
      const i = header.findIndex((h) => h.replace(/^searches:\s*/, "").startsWith(tok));
      if (i === -1) throw new Error(`Maandkolom "${m}" niet gevonden in "${src}"`);
      return i;
    });
    if (kwIdx === -1) throw new Error(`Kolom "Keyword" niet gevonden in "${src}"`);

    /* ---- 2. alleen de nodige kolommen lezen (bron kan tienduizenden rijen zijn) ---- */
    const wanted = [kwIdx, avgIdx, ...monthIdx].filter((i) => i >= 0);
    const columns = {};
    for (const i of wanted) {
      const L = colLetter(i);
      const vals = await readRange(sourceSheetId, `'${src}'!${L}2:${L}`);
      columns[i] = vals.map((r) => r[0]);
    }
    const nRows = columns[kwIdx].length;
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
      });
    }

    /* ---- 3. verdeling berekenen ---- */
    const opts = {
      monthNames: months,
      genders: genders === "M" || genders === "V" ? genders : "MV",
      total: Number(total) || 1000,
    };
    let result = buildVerdeling(rows, opts);

    /* ---- 4. AI-nacontrole op de geselecteerde keywords (vangt merken die
            door de statische lijst glippen) — faalt stil bij API-problemen ---- */
    let aiRemoved = [];
    try {
      const items = result.rows.map((r, i) => ({ index: i, kw: r.kw }));
      const exclude = new Set();
      const BATCH = 160;
      for (let i = 0; i < items.length; i += BATCH) {
        const part = items.slice(i, i + BATCH);
        const removals = await classifyJunkKeywordsBatch(part);
        for (const rem of removals) {
          const hit = items[rem.index];
          if (hit && part.some((p) => p.index === rem.index)) exclude.add(hit.kw);
        }
      }
      if (exclude.size) {
        aiRemoved = [...exclude];
        result = buildVerdeling(rows, { ...opts, exclude });
      }
    } catch {
      /* verdeling zonder AI-nacontrole is ook prima */
    }

    if (!result.rows.length) {
      throw new Error("Geen keywords over na filteren — controleer bron-tabblad en maanden");
    }

    /* ---- 5. wegschrijven: tabel (A-H) + collectie-overzicht (J-M) ---- */
    const t = await addTab(targetSheetId, String(targetTab).trim());
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: 422 });

    const label = months.join("-");
    const left = [
      ["Rank", "Keyword", "Collectie", "Groep", "Avg. volume", `Volume ${label}`, "Piekmaand", "Aantal producten"],
      ...result.rows.map((r) => [r.rank, r.kw, r.col, r.g, r.avg, r.season, r.peak, r.n]),
    ];
    const right = [
      ["Collectie", "Aantal keywords", "Aantal producten", "Top keywords"],
      ...result.collections.map((c) => [c.col, c.kws, c.products, c.top.join(", ")]),
    ];
    const nOut = Math.max(left.length, right.length);
    const values = [];
    for (let i = 0; i < nOut; i++) {
      values.push([...(left[i] || ["", "", "", "", "", "", "", ""]), "", ...(right[i] || [])]);
    }
    await appendRows(targetSheetId, `'${t.title}'!A1`, values, "RAW");
    await formatVerdelingTab(targetSheetId, t.tabId, left.length, 8, 13);

    const id = parseSheetId(targetSheetId);
    return NextResponse.json({
      ok: true,
      url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${t.tabId}`,
      title: t.title,
      tabId: t.tabId,
      keywordCount: result.rows.length,
      totalProducts: result.totalProducts,
      collections: result.collections.map(({ col, kws, products }) => ({ col, kws, products })),
      aiRemoved,
      stats: result.stats,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
