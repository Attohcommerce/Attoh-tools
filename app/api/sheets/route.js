import { NextResponse } from "next/server";
import {
  readRange,
  appendRows,
  batchUpdate,
  getServiceAccountEmail,
  addTab,
  getTabIdByTitle,
  parseSheetId,
  deleteTab,
  deleteRows,
  getFirstTabId,
} from "@/lib/sheets";

export const maxDuration = 30;

// Eén route met acties: read / append / update / info / createTab / deleteTab / deleteTailRows
export async function POST(req) {
  const { action, sheetId, range, rows, updates, title, header, tabId, count } = await req
    .json()
    .catch(() => ({}));
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
    // Heel tabblad verwijderen (Stop & verwijderen in de scraper)
    if (action === "deleteTab") {
      if (tabId === undefined || tabId === null) {
        return NextResponse.json({ error: "tabId ontbreekt" }, { status: 400 });
      }
      await deleteTab(sheetId, tabId);
      return NextResponse.json({ ok: true });
    }
    // Laatste N datarijen van het eerste blad verwijderen (geheugen-rollback)
    if (action === "deleteTailRows") {
      const n = Number(count) || 0;
      if (n <= 0) return NextResponse.json({ ok: true, deleted: 0 });
      const firstTab = await getFirstTabId(sheetId);
      if (firstTab === null) return NextResponse.json({ error: "Geen blad gevonden" }, { status: 422 });
      const vals = await readRange(sheetId, "A:A");
      const total = vals.length; // incl. eventuele headerrij
      const cnt = Math.min(n, Math.max(total - 1, 0)); // rij 1 nooit meenemen
      if (cnt <= 0) return NextResponse.json({ ok: true, deleted: 0 });
      const indexes = [];
      for (let i = total - cnt; i < total; i++) indexes.push(i); // 0-based rij-indexen
      await deleteRows(sheetId, firstTab, indexes);
      return NextResponse.json({ ok: true, deleted: cnt });
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
