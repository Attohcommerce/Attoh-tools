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
  formatRunTab,
  getSheetSizes,
  clearValues,
  updateValues,
  a1Tab,
} from "@/lib/sheets";
import { parseImportRows, toImportRow, IMPORT_HEADER } from "@/lib/import-format";
import { getStoreMemory, canonOf } from "@/lib/geheugen";
import { loadOrgMap } from "@/lib/tpk";
import { buildScraperTabs } from "@/lib/scraper-tabs";
import { buildChaimTab } from "@/lib/chaim-import";

export const maxDuration = 120;

// Eén route met acties: read / append / update / info / createTab / deleteTab / deleteTailRows
export async function POST(req) {
  const { action, sheetId, range, rows, updates, title, header, tabId, count, store, overwrite, weeks } = await req
    .json()
    .catch(() => ({}));
  try {
    if (action === "info") {
      return NextResponse.json({ ok: true, serviceAccountEmail: getServiceAccountEmail() });
    }
    if (!sheetId) return NextResponse.json({ error: "sheetId ontbreekt" }, { status: 400 });

    // Tabbladen van een sheet (naam + id) — voor de tabblad-keuze in de scraper
    if (action === "tabs") {
      const tabs = (await getSheetSizes(sheetId)).map((t) => ({ title: t.title, tabId: t.tabId }));
      return NextResponse.json({ ok: true, tabs });
    }
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
    /* Scraper W-tabs aanmaken uit de planning van de store (Keywordplan/Plan
       of de weektabs), in de opmaak van de SSB Final Organization — zelfde
       sheet (Sa Collective, 20-10). overwrite = bestaande Scraper W-tabs
       opnieuw schrijven; weeks = alleen deze weeknummers. */
    if (action === "buildScraperTabs") {
      return NextResponse.json(await buildScraperTabs({ sheetId, store, overwrite: !!overwrite, weeks }));
    }
    /* Chaim-importblad naast een Attoh-import-lijst (Sa Collective, 24-10):
       "W3" → "W3 Chaim formaat" in dezelfde sheet, 5 kolommen zonder kopregel
       (Keyword · URL · Gender · Collection · Tag) voor Chaims importer.
       Collectie + tag uit het store-geheugen; zie lib/chaim-import.js. */
    if (action === "buildChaimTab") {
      return NextResponse.json(await buildChaimTab({ sheetId, title, store }));
    }
    /* Import-tabblad in Chaim-formaat (Keyword · Competitor · Match ·
       Productnaam · URL · Geslacht · Duplicaten · Literal-check · Store) ter
       plekke omzetten naar het Attoh-formaat (LINK · TITEL · KEYWORD · … ·
       COLLECTIE · TYPE), zelfde tabblad, zelfde sheet (Sa Collective, 20-10).
       Collectie per keyword komt uit het store-geheugen (ORG VROUW/ORG MAN
       van de aanvul-sheet) als er een store is meegegeven. */
    if (action === "convertImportTab") {
      const t = String(title || "").trim();
      if (!t) return NextResponse.json({ error: "Tabbladnaam ontbreekt" }, { status: 400 });
      const values = await readRange(sheetId, `${a1Tab(t)}!A1:N`);
      if (!values.length) return NextResponse.json({ error: `Tabblad "${t}" is leeg of bestaat niet` }, { status: 422 });
      const parsed = parseImportRows(values);
      if (parsed.format === "attoh") return NextResponse.json({ ok: true, already: true, count: parsed.rows.length });
      if (parsed.format !== "chaim") {
        return NextResponse.json({ error: `"${t}" is geen import-lijst in Chaim-formaat (verwacht: Keyword · Competitor · Match · Productnaam · URL · Geslacht) en ook niet in Attoh-formaat.` }, { status: 422 });
      }
      let orgMap = new Map();
      if (store && store.domain) {
        try {
          orgMap = await loadOrgMap(await getStoreMemory(store.domain));
        } catch {
          orgMap = new Map();
        }
      }
      let withCol = 0;
      const out = parsed.rows.map((p) => {
        const g = p.gender === "Man" ? "M" : "V";
        const hit = orgMap.get(`${g}|${canonOf(p.keyword)}`);
        const collection = hit && hit.coll ? hit.coll : "";
        if (collection) withCol++;
        return toImportRow({ ...p, collection });
      });
      const id = await getTabIdByTitle(sheetId, t);
      if (id === null) return NextResponse.json({ error: `Tabblad "${t}" niet gevonden` }, { status: 422 });
      await clearValues(sheetId, a1Tab(t));
      await updateValues(sheetId, `${a1Tab(t)}!A1`, [IMPORT_HEADER, ...out]);
      try {
        await formatRunTab(sheetId, id);
      } catch {
        /* opmaak is nice-to-have */
      }
      const sid = parseSheetId(sheetId);
      return NextResponse.json({
        ok: true,
        count: out.length,
        withCollection: withCol,
        skipped: Math.max(0, values.length - (parsed.hasHeader ? 1 : 0) - out.length),
        tabId: id,
        url: `https://docs.google.com/spreadsheets/d/${sid}/edit#gid=${id}`,
      });
    }
    // Fancy opmaak voor een scraper-run-tabblad (import-lijst)
    if (action === "formatRun") {
      if (tabId === undefined || tabId === null) {
        return NextResponse.json({ error: "tabId ontbreekt" }, { status: 400 });
      }
      await formatRunTab(sheetId, Number(tabId));
      return NextResponse.json({ ok: true });
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
    const msg = String(e.message || e);
    /* 403 van Google ("The caller does not have permission"): de service
       account mag deze sheet niet (be)werken. Vaak is de sheet wel "iedereen
       met de link kan bekijken" — lezen lukt dan, schrijven niet. Melding
       noemt welke sheet en wat te doen (20-10). */
    if (/does not have permission|PERMISSION_DENIED|forbidden|\b403\b/i.test(msg)) {
      let id = "";
      try {
        id = parseSheetId(sheetId);
      } catch {
        id = String(sheetId || "");
      }
      const write = ["append", "update", "createTab", "deleteTab", "deleteTailRows", "formatRun", "buildScraperTabs", "convertImportTab", "buildChaimTab"].includes(action);
      return NextResponse.json(
        {
          error: `Geen ${write ? "schrijf" : "lees"}rechten op sheet https://docs.google.com/spreadsheets/d/${id}/edit — deel hem als Bewerker met ${getServiceAccountEmail()} en probeer opnieuw.`,
          code: "SHEET_PERMISSION",
          sheetId: id,
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: msg }, { status: Number(e && e.status) || 500 });
  }
}
