import { NextResponse } from "next/server";
import { addTab, appendRows, formatKeywordTab, parseSheetId } from "@/lib/sheets";

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

    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
