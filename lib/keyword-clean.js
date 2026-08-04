// Gedeelde opschoon-logica voor de Keywords-module: statische merkenlijst
// eerst, daarna AI-beoordeling. Gebruikt door de Stap 2-knop én de sessie-chat.
import { readRange, getTabIdByTitle, deleteRows } from "./sheets";
import { isJunkKeyword } from "./brands";
import { classifyJunkKeywordsBatch } from "./ai";

export async function cleanTopRows(sheetId, title, topNRaw) {
  const tabId = await getTabIdByTitle(sheetId, title);
  if (tabId === null) throw new Error(`Tabblad "${title}" niet gevonden`);

  const topN = Math.min(Math.max(Number(topNRaw) || 500, 10), 800);
  const values = await readRange(sheetId, `'${title}'!A2:A${topN + 1}`);
  const kws = values.map((r) => String(r[0] || "").trim());

  const flagged = new Map();
  kws.forEach((kw, i) => {
    if (kw && isJunkKeyword(kw)) flagged.set(i, "merkenlijst");
  });

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

  const removed = [...flagged.entries()]
    .map(([i, reason]) => ({ kw: kws[i], reason, row: i + 1 }))
    .sort((a, b) => a.row - b.row);
  await deleteRows(sheetId, tabId, removed.map((r) => r.row));

  return {
    checked: kws.length,
    removedCount: removed.length,
    removed: removed.map(({ kw, reason }) => ({ kw, reason })),
  };
}
