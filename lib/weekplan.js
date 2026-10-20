// WEEKPLANNING LEZEN (20-10-2026) — één plek voor de drie planning-formaten
// die de scraper en de Scraper-tab-generator (lib/scraper-tabs.js) kennen.
// Puur JavaScript, geen server-imports: wordt in de scraper (client) én op
// de server gebruikt.
//
//  1. Verdeling-formaat (Keywords-tool / Scraper W-tabs): A Rank · B Keyword ·
//     C Collectie · D Groep · … · H Aantal producten · I Type · J Uitleg.
//  2. Weekplanning (Chaim-opmaak, de organization sheets die Claude maakt):
//     kopregel A "Categorie (Bet)" · B "Keyword" · C "Aantal" · D "The Play",
//     daaronder per categorie "Casual Dresses (HERO)  [105]" en per keyword
//     een rij met B keyword, C aantal, F zoekterm (heren: "mens …"), H collectie.
//  3. Plan-tab (SSB "Plan" / AM "Keywordplan"): één rij per keyword per week,
//     kopregel op naam: Week · Keyword · Zoekterm · Gender · Aantal · Rol ·
//     Categorie · Bet · Collection · Tag · Vraag … · Piekmaand.
// Alle drie leveren rijen { k, n, g, col, type, uitleg } (g = "man"|"vrouw").

import { OCCASION_RE } from "./import-format";

export const low = (v) => String(v || "").toLowerCase().trim();

export function parseVerdelingSheet(values) {
  const h = (values[0] || []).map(low);
  if (!h[1]?.startsWith("keyword") || !h[3]?.startsWith("groep") || !h[7]?.startsWith("aantal")) return null;
  /* Storegeslacht uit de kop van kolom D ("Groep — alleen heren"). Bij een
     heren-only blad is élk keyword heren — ook "shoes" zonder "mens". */
  const storeG = /alleen heren/.test(h[3]) ? "man" : /alleen dames/.test(h[3]) ? "vrouw" : null;
  const parsed = [];
  for (const r of values.slice(1)) {
    const k = String(r[1] || "").trim();
    if (!k) continue;
    if (k.toUpperCase().startsWith("UNDERDOG KEYWORDS")) continue; // scheidingsregel
    if (/^keyword$/i.test(k)) continue; // koprij van het underdog-blok
    if (!Number.isFinite(Number(r[0])) && !Number.isFinite(Number(r[7]))) continue;
    const n = Math.max(1, Number(r[7]) || 0);
    const g = storeG || (String(r[3] || "").trim().toUpperCase() === "M" ? "man" : "vrouw");
    const col = String(r[2] || "").trim(); // C = Collectie — reist mee naar de importlijst
    const type = String(r[8] || "").trim() || "Direct"; // I = Direct/Attribuut/Gelegenheid/Underdog
    const uitleg = String(r[9] || "").trim(); // J = underdog-uitleg voor de foto-controle
    parsed.push({ k, n, g, col, type, uitleg });
  }
  return { parsed, storeG, formaat: "verdeling", bron: "kop van kolom D" };
}

export function parseWeekplanSheet(values) {
  let hdr = -1;
  for (let i = 0; i < Math.min(values.length, 8); i++) {
    const r = values[i] || [];
    if (low(r[0]).startsWith("categorie") && low(r[1]).startsWith("keyword") && low(r[2]).startsWith("aantal")) {
      hdr = i;
      break;
    }
  }
  if (hdr < 0) return null;
  // Titel + notitie boven de kopregel: "Week 1 (12 Oct-18 Oct) — 1x AUS/NZ", "alleen dames"
  const head = values.slice(0, hdr + 1).flat().map(low).join(" ");
  const storeG = /alleen heren|herenstore/.test(head) ? "man" : /alleen dames|dameszaak/.test(head) ? "vrouw" : null;
  const title = head.match(/week\s*(\d+)\s*\(([^)]+)\)/);
  let cat = "";
  const parsed = [];
  for (const r of values.slice(hdr + 1)) {
    const a = String(r[0] || "").trim();
    const b = String(r[1] || "").trim();
    const catRow = a.match(/^(.+?)\s*\((HERO|CORE|SIDE)\)/i);
    if (catRow && !b) {
      cat = catRow[1].trim(); // "Casual Dresses (HERO)  [105]" → Casual Dresses
      continue;
    }
    if (!b || /^keyword$/i.test(b) || /^totaal/i.test(a) || /^totaal/i.test(b)) continue;
    const n = Number(String(r[2] || "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    const col = (a && !catRow ? a : "") || String(r[7] || "").trim() || cat;
    const zoekterm = String(r[5] || "").trim(); // F = zoekterm (heren: "mens …")
    const g = storeG || (/^men'?s\b/i.test(col) || /^mens\b/i.test(zoekterm) ? "man" : "vrouw");
    const k = g === "man" && zoekterm ? zoekterm : b;
    const type = OCCASION_RE.test(k) ? "Gelegenheid" : "Direct";
    parsed.push({ k, n: Math.max(1, Math.round(n)), g, col, type, uitleg: "" });
  }
  return { parsed, storeG, formaat: "weekplanning", bron: "notitie boven de tabel", week: title ? `week ${title[1]} (${title[2]})` : "" };
}

/** Weeknummer uit een bladnaam: "Scraper W3" / "Week 3 (26 Oct-1 Nov)" / "W3" → 3. */
export function weekNumberOf(title) {
  const m = String(title || "").match(/\bw(?:eek)?\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * Plan-tab (SSB "Plan", AM "Keywordplan") → per week de rijen, op kopnaam.
 * → { weeks: Map<number, rows[]>, header } of null als het geen plan-tab is.
 * rij: { k (zoekterm), keyword, n, g, col, tag, rol, vraag, piek, cat, bet }
 */
export function parsePlanTab(values) {
  const rows = Array.isArray(values) ? values : [];
  const hdrAt = rows.slice(0, 10).findIndex((r) => {
    const h = (r || []).map(low);
    return h.some((x) => x === "week") && h.some((x) => x.startsWith("keyword")) && h.some((x) => x.startsWith("aantal"));
  });
  if (hdrAt < 0) return null;
  const h = (rows[hdrAt] || []).map(low);
  const idx = (pred) => h.findIndex(pred);
  const iWeek = idx((x) => x === "week");
  const iKw = idx((x) => x === "keyword" || x.startsWith("keyword"));
  const iZoek = idx((x) => x.startsWith("zoekterm"));
  const iG = idx((x) => x === "gender" || x === "geslacht");
  const iN = idx((x) => x.startsWith("aantal"));
  const iRol = idx((x) => x === "rol");
  const iCat = idx((x) => x.startsWith("categorie"));
  const iBet = idx((x) => x === "bet");
  const iCol = idx((x) => x.startsWith("collection") || x.startsWith("collectie"));
  const iTag = idx((x) => x === "tag");
  const iVraag = idx((x) => x.startsWith("vraag"));
  const iPiek = idx((x) => x.startsWith("piek"));
  const weeks = new Map();
  for (const r of rows.slice(hdrAt + 1)) {
    const w = Number(String((r || [])[iWeek] || "").trim());
    const keyword = String(r[iKw] || "").trim();
    if (!Number.isFinite(w) || w <= 0 || !keyword) continue;
    const n = Number(String(r[iN] || "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    const gv = low(iG >= 0 ? r[iG] : "");
    const g = /^(men|man|mens|heren|m)$/.test(gv) ? "man" : "vrouw";
    const zoek = iZoek >= 0 ? String(r[iZoek] || "").trim() : "";
    const k = zoek || (g === "man" && !/^men'?s?\b/i.test(keyword) ? `mens ${keyword}` : keyword);
    const row = {
      k,
      keyword,
      n: Math.max(1, Math.round(n)),
      g,
      col: iCol >= 0 ? String(r[iCol] || "").trim() : "",
      tag: iTag >= 0 ? String(r[iTag] || "").trim() : "",
      rol: low(iRol >= 0 ? r[iRol] : ""),
      cat: iCat >= 0 ? String(r[iCat] || "").trim() : "",
      bet: iBet >= 0 ? String(r[iBet] || "").trim() : "",
      vraag: iVraag >= 0 ? Number(String(r[iVraag] || "").replace(/[^\d]/g, "")) || null : null,
      piek: iPiek >= 0 ? String(r[iPiek] || "").trim() : "",
    };
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(row);
  }
  return weeks.size ? { weeks, header: h } : null;
}
