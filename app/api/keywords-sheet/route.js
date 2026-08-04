import { NextResponse } from "next/server";
import {
  addTab,
  appendRows,
  formatKeywordTab,
  parseSheetId,
  readRange,
  getTabIdByTitle,
  deleteRows,
} from "@/lib/sheets";
import { isJunkKeyword } from "@/lib/brands";
import { classifyJunkKeywordsBatch } from "@/lib/ai";

export const maxDuration = 60;

// Drie acties, aangeroepen door de Keywords-pagina:
//  create → nieuw tabblad met headerrij
//  append → een blok rijen toevoegen (client hakt in stukken vanwege bodylimiet)
//  format → opmaak: geel/vet/filters/grijs kolom A, rij 1 bevroren
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action, sheetId, tabName, tabId, header, rows, rowCount, colCount } = body;

  if (!sheetId) return NextResponse.json({ error: "Sheet-link ontbreekt" }, { status: 400 });

  try {
    if (action === "create") {
      if (!tabName || !String(tabName).trim()) {
        return NextResponse.json({ error: "Geef het nieuwe tabblad een naam" }, { status: 400 });
      }
      const r = await addTab(sheetId, String(tabName).trim());
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      if (Array.isArray(header) && header.length) {
        // RAW: "jul 2025" blijft letterlijke tekst, wordt nooit een datum
        await appendRows(sheetId, `'${r.title}'!A1`, [header], "RAW");
      }
      return NextResponse.json({ ok: true, tabId: r.tabId, title: r.title, gid: r.tabId });
    }

    if (action === "append") {
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: "Geen rijen" }, { status: 400 });
      }
      // RAW: getallen blijven getallen — geen dag-nummer-interpretatie
      await appendRows(sheetId, `'${tabName}'!A1`, rows, "RAW");
      return NextResponse.json({ ok: true, appended: rows.length });
    }

    if (action === "format") {
      await formatKeywordTab(sheetId, Number(tabId), Number(rowCount), Number(colCount));
      const id = parseSheetId(sheetId);
      return NextResponse.json({
        ok: true,
        url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${tabId}`,
      });
    }

    // Merken/rommel-check over de bovenste N rijen van een bestaand tabblad
    if (action === "clean") {
      const title = String(tabName || "").trim();
      if (!title) return NextResponse.json({ error: "Tabbladnaam ontbreekt" }, { status: 400 });

      const numericTabId = await getTabIdByTitle(sheetId, title);
      if (numericTabId === null) {
        return NextResponse.json({ error: `Tabblad "${title}" niet gevonden` }, { status: 422 });
      }

      const topN = Math.min(Math.max(Number(body.topN) || 500, 10), 800);
      const values = await readRange(sheetId, `'${title}'!A2:A${topN + 1}`);
      const kws = values.map((r) => String(r[0] || "").trim());

      // 1. Statische zeef (merkenlijst, gratis)
      const flagged = new Map(); // rij-index (0-based data) → reden
      kws.forEach((kw, i) => {
        if (kw && isJunkKeyword(kw)) flagged.set(i, "merkenlijst");
      });

      // 2. AI-zeef over de rest
      const rest = kws
        .map((kw, i) => ({ index: i, kw }))
        .filter((r) => r.kw && !flagged.has(r.index));
      const BATCH = 160;
      for (let i = 0; i < rest.length; i += BATCH) {
        const part = rest.slice(i, i + BATCH);
        const removals = await classifyJunkKeywordsBatch(part);
        for (const r of removals) {
          if (part.some((p) => p.index === r.index)) flagged.set(r.index, r.reason || "ai");
        }
      }

      // 3. Rijen verwijderen (data-rij i → sheet-rij i+1, 0-based met header op 0)
      const removed = [...flagged.entries()]
        .map(([i, reason]) => ({ kw: kws[i], reason, row: i + 1 }))
        .sort((a, b) => a.row - b.row);
      await deleteRows(sheetId, numericTabId, removed.map((r) => r.row));

      return NextResponse.json({
        ok: true,
        checked: kws.length,
        removedCount: removed.length,
        removed: removed.map(({ kw, reason }) => ({ kw, reason })),
      });
    }

    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
