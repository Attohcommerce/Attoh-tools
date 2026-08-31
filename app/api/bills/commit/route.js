import { NextResponse } from "next/server";
import {
  readRange,
  appendRows,
  updateValues,
  addTab,
  getTabIdByTitle,
} from "@/lib/sheets";
import {
  LOG_TAB,
  LOG_HEADER,
  MONTHS_EN,
  londonToday,
  splitDate,
  toNum,
  dupKey,
  round2,
} from "@/lib/bills";

export const maxDuration = 60;

// KUNGFUBUY BILL — COMMIT ("Zet in sheet"). Schrijft de goedgekeurde regels
// als log-regels naar het COGS Log-tabblad en zet daarna per datum de SOM
// van het log in kolom V van de juiste maandtab. Het log is de waarheid:
// V wordt altijd herrekend uit het volledige log, dus late bills voor een
// oude datum tellen er gewoon bij op. Dupes (zelfde order + invoice) worden
// hier nogmaals tegen de sheet gecheckt — dubbel uploaden kan nooit dubbel
// meetellen, ook niet bij twee tabbladen tegelijk open.
//
// Alle writes zijn RAW (les uit de rest van de tool: USER_ENTERED + NL-
// locale maakt van datums en komma-getallen stille rommel).

export async function POST(req) {
  const { sheetId, rows } = await req.json().catch(() => ({}));
  if (!sheetId) return NextResponse.json({ error: "Geen sheet opgegeven" }, { status: 400 });
  if (!Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: "Geen regels om te schrijven" }, { status: 400 });
  }

  try {
    // 1. COGS Log-tabblad garanderen (met kop).
    let tabId = await getTabIdByTitle(sheetId, LOG_TAB);
    let logCreated = false;
    if (tabId === null) {
      const r = await addTab(sheetId, LOG_TAB, { rows: 20000, cols: LOG_HEADER.length });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      tabId = r.tabId;
      await updateValues(sheetId, `'${LOG_TAB}'!A1:I1`, [LOG_HEADER]);
      logCreated = true;
    }

    // 2. Vers log lezen — de dupe-check hier is leidend, niet die van de preview.
    const existing = await readRange(sheetId, `'${LOG_TAB}'!A2:I100000`);
    const seen = new Set();
    for (const r of existing) if (r[1] != null && r[1] !== "") seen.add(dupKey(r[1], r[2]));

    // VANDAAG-REGEL (ook hier, los van de preview): de dag van vandaag
    // wordt nooit geschreven — die is pas morgen compleet.
    const today = londonToday();
    const clean = [];
    let dupesSkipped = 0;
    let tooEarlySkipped = 0;
    for (const r of rows) {
      const key = dupKey(r.order, r.invoiceNo);
      const valid =
        r && r.order && r.date && r.dateNL && Number.isFinite(Number(r.gbp)) && Number.isFinite(Number(r.cost));
      if (!valid) continue;
      if (String(r.date) >= today) {
        tooEarlySkipped++;
        continue;
      }
      if (seen.has(key)) {
        dupesSkipped++;
        continue;
      }
      seen.add(key);
      clean.push({
        date: String(r.date),
        values: [
          String(r.dateNL),
          String(r.order),
          String(r.invoiceNo || ""),
          Number(r.stuks) || 0,
          Number(r.cost),
          String(r.currency || "EUR"),
          Number(r.rate) || "",
          Number(r.gbp),
          String(r.store || ""),
        ],
      });
    }

    if (clean.length) {
      await appendRows(sheetId, `'${LOG_TAB}'!A:I`, clean.map((c) => c.values), "RAW");
    }

    // 3. Per geraakte datum: som over het VOLLEDIGE log en naar kolom V.
    const affected = [...new Set(clean.map((c) => c.date))];
    const results = [];

    // Som per datum uit bestaand log + zojuist toegevoegde regels.
    const sumFor = (dObj) => {
      let sum = 0;
      for (const r of existing) {
        const s = splitDate(r[0]);
        if (s && s.d === dObj.d && s.m === dObj.m && s.y === dObj.y) sum += toNum(r[7]) || 0;
      }
      for (const c of clean) {
        const s = splitDate(c.date);
        if (s && s.d === dObj.d && s.m === dObj.m && s.y === dObj.y) sum += Number(c.values[7]) || 0;
      }
      return round2(sum);
    };

    for (const date of affected.sort()) {
      const s = splitDate(date);
      if (!s) continue;
      const tab = MONTHS_EN[s.m - 1];
      const monthTabId = await getTabIdByTitle(sheetId, tab);
      if (monthTabId === null) {
        results.push({
          date,
          written: false,
          note: `maandtab "${tab}" ontbreekt — regels staan in het COGS Log, V volgt zodra de tab er is`,
        });
        continue;
      }

      // Datumrij: rij 3 = dag 1 van de maand. Kolom R is de controle: staat
      // daar een ANDERE datum, dan zoeken we de juiste rij; staat er niets,
      // dan vertrouwen we de vaste indeling.
      let rowNum = 2 + s.d;
      let note = "";
      try {
        const rVals = await readRange(sheetId, `'${tab}'!R3:R40`);
        const matches = (cell) => {
          const p = splitDate(cell && cell[0]);
          return p && p.d === s.d && p.m === s.m;
        };
        const atExpected = rVals[rowNum - 3];
        if (!matches(atExpected)) {
          const idx = rVals.findIndex(matches);
          if (idx >= 0) {
            rowNum = idx + 3;
          } else if (atExpected && atExpected[0]) {
            results.push({
              date,
              written: false,
              note: `datumrij voor ${date} niet gevonden in "${tab}" (R-kolom wijkt af) — V niet geschreven`,
            });
            continue;
          } else {
            note = "R-kolom leeg — op de vaste rij-indeling geschreven";
          }
        }
      } catch {
        note = "R-kolom niet leesbaar — op de vaste rij-indeling geschreven";
      }

      const sum = sumFor(s);
      await updateValues(sheetId, `'${tab}'!V${rowNum}`, [[sum]]);
      results.push({ date, tab, row: rowNum, sum, written: true, note });
    }

    return NextResponse.json({
      ok: true,
      logCreated,
      appended: clean.length,
      dupesSkipped,
      tooEarlySkipped,
      results,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
