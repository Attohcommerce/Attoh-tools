import { NextResponse } from "next/server";
import {
  addTab, appendRows, formatKeywordTab, parseSheetId,
  getSheetSizes, SHEETS_CELL_LIMIT,
} from "@/lib/sheets";
import { cleanTopRows } from "@/lib/keyword-clean";

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

      /* Capaciteits-check VOORAF. Google's limiet van 10 miljoen cellen geldt
         voor het hele workbook (alle tabbladen samen, lege cellen incl.).
         Zonder deze check klapte de upload halverwege op een cryptische
         Engelse fout; nu zie je vóóraf wat er niet past en wat je kunt doen. */
      const plannedRows = Number(rowCount) || 0;
      const plannedCols = Number(colCount) || (Array.isArray(header) ? header.length : 26);
      if (plannedRows > 0) {
        const sizes = await getSheetSizes(sheetId);
        const used = sizes.reduce((s, t) => s + t.cells, 0);
        const needed = (plannedRows + 1) * plannedCols;
        if (used + needed > SHEETS_CELL_LIMIT) {
          const big = sizes
            .sort((a, b) => b.cells - a.cells)
            .slice(0, 4)
            .map((t) => `"${t.title}" (${(t.cells / 1e6).toFixed(1)}M cellen)`)
            .join(", ");
          const usedM = (used / 1e6).toFixed(1);
          const neededM = (needed / 1e6).toFixed(1);
          return NextResponse.json(
            {
              error:
                `Dit workbook zit vol: ${usedM}M van de 10M cellen in gebruik en dit tabblad heeft er nog ${neededM}M nodig. ` +
                `Grootste tabbladen: ${big}. Twee opties: verwijder oude tabbladen die je niet meer gebruikt (rechtsklik op het tabblad onderin → Verwijderen), ` +
                `of maak een léég Google Sheets-bestand en plak die link hierboven in het sheet-veld — de tool werkt met elke sheet-link.`,
            },
            { status: 422 }
          );
        }
      }

      // Exact raster aanmaken: alleen de cellen die de data echt nodig heeft
      // (default is 26 kolommen breed — 25% verspilling op een keyword-tab).
      const grid = plannedRows > 0 ? { rows: plannedRows + 1, cols: plannedCols } : null;
      const r = await addTab(sheetId, String(tabName).trim(), grid);
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
      const r = await cleanTopRows(sheetId, title, body.topN);
      return NextResponse.json({ ok: true, ...r });
    }

    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
