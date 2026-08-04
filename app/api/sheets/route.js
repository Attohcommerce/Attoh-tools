import { NextResponse } from "next/server";
import {
  readRange,
  appendRows,
  batchUpdate,
  getServiceAccountEmail,
  addTab,
  getTabIdByTitle,
  parseSheetId,
} from "@/lib/sheets";

export const maxDuration = 30;

// Eén route met acties: read / append / update / info / createTab
export async function POST(req) {
  const { action, sheetId, range, rows, updates, title, header } = await req.json().catch(() => ({}));
  try {
    if (action === "info") {
      return NextResponse.json({ ok: true, serviceAccountEmail: getServiceAccountEmail() });
    }
    if (!sheetId) return NextResponse.json({ error: "sheetId ontbreekt" }, { status: 400 });

    if (action === "read") {
      const values = await readRange(sheetId, range || "A:H");
      return NextResponse.json({ ok: true, values });
    }
    if (action === "append") {
      const r = await appendRows(sheetId, range || "A:H", rows || []);
      return NextResponse.json({ ok: true, ...r });
    }
    if (action === "update") {
      const r = await batchUpdate(sheetId, updates || []);
      return NextResponse.json({ ok: true, ...r });
    }
    // Tabblad aanmaken (of hergebruiken als het al bestaat) + optionele headerrij
    if (action === "createTab") {
      const t = String(title || "").trim();
      if (!t) return NextResponse.json({ error: "Tabbladnaam ontbreekt" }, { status: 400 });
      const r = await addTab(sheetId, t);
      let tabId;
      let existed = false;
      if (r.ok) {
        tabId = r.tabId;
        if (Array.isArray(header) && header.length) {
          await appendRows(sheetId, `'${t}'!A1`, [header], "RAW");
        }
      } else {
        tabId = await getTabIdByTitle(sheetId, t);
        existed = true;
        if (tabId === null) return NextResponse.json({ error: r.error }, { status: 422 });
      }
      const id = parseSheetId(sheetId);
      return NextResponse.json({
        ok: true,
        title: t,
        tabId,
        existed,
        url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${tabId}`,
      });
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
