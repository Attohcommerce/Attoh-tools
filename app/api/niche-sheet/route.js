import { NextResponse } from "next/server";
import { formatKeywordTab, spreadsheetBatchUpdate, parseSheetId } from "@/lib/sheets";

export const maxDuration = 60;

/* NICHE KIEZEN — opmaak van de twee tabbladen die de pagina schrijft.
   Aanmaken en rijen toevoegen gaan via /api/keywords-sheet (zelfde
   capaciteits-check en RAW-upload); hier alleen de opmaak, omdat deze
   tabbladen decimale kolommen hebben (biedingen) die de standaard
   keyword-opmaak ("0") anders op hele getallen zou afronden. */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action, sheetId, tabId, rowCount, colCount, decimalCols = [], wideCols = [] } = body;
  if (!sheetId) return NextResponse.json({ error: "Sheet-link ontbreekt" }, { status: 400 });

  try {
    if (action === "format") {
      const id = Number(tabId);
      const rows = Number(rowCount);
      const cols = Number(colCount);
      await formatKeywordTab(sheetId, id, rows, cols);

      const reqs = [];
      for (const c of decimalCols) {
        reqs.push({
          repeatCell: {
            range: { sheetId: id, startRowIndex: 1, endRowIndex: rows, startColumnIndex: c, endColumnIndex: c + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } },
            fields: "userEnteredFormat.numberFormat",
          },
        });
      }
      for (const w of wideCols) {
        reqs.push({
          updateDimensionProperties: {
            range: { sheetId: id, dimension: "COLUMNS", startIndex: w.col, endIndex: w.col + 1 },
            properties: { pixelSize: w.px },
            fields: "pixelSize",
          },
        });
      }
      if (reqs.length) await spreadsheetBatchUpdate(sheetId, reqs);

      return NextResponse.json({
        ok: true,
        url: `https://docs.google.com/spreadsheets/d/${parseSheetId(sheetId)}/edit#gid=${id}`,
      });
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
