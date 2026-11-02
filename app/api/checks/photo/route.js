import { NextResponse } from "next/server";
import { readRange, batchUpdate } from "@/lib/sheets";
import { scorePhotoLooksBatch } from "@/lib/ai";

export const maxDuration = 60;

/* FOTO-CIJFER (02-11-2026) — kolom O (cijfer 1–10) + P (korte reden) van de
   import-lijst. Per call max `batchSize` rijen; de client herhaalt tot done.
   Foto's komen van de concurrent-productpagina (<link>.json, eerste 2 foto's). */
async function imagesOf(link) {
  try {
    const u = String(link || "").split("?")[0].replace(/\/$/, "");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${u}.json`, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0" } });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const imgs = (j.product && j.product.images) || [];
    return imgs.slice(0, 2).map((im) => im.src).filter(Boolean);
  } catch {
    return [];
  }
}

export async function POST(req) {
  const { sheetId, tab, cursor = 2, batchSize = 10, redo = false } = await req.json().catch(() => ({}));
  const P = tab ? `'${String(tab).replace(/'/g, "")}'!` : "";
  if (!sheetId) return NextResponse.json({ error: "sheetId ontbreekt" }, { status: 400 });
  try {
    if (cursor === 2) {
      await batchUpdate(sheetId, [{ range: `${P}O1:P1`, values: [["FOTO-CIJFER", "FOTO-OORDEEL"]] }]);
    }
    const values = await readRange(sheetId, `${P}A${cursor}:P${cursor + batchSize - 1}`);
    if (!values.length) return NextResponse.json({ ok: true, done: true, processed: 0, scored: 0 });

    const todo = [];
    values.forEach((row, i) => {
      const link = row[0];
      if (link && /\/products\//.test(link) && (redo || !row[14])) todo.push({ row: cursor + i, link });
    });
    const withImgs = await Promise.all(todo.map(async (x) => ({ ...x, images: await imagesOf(x.link) })));
    const usable = withImgs.filter((x) => x.images.length);
    let scored = 0;
    let usd = 0;
    const updates = [];
    if (usable.length) {
      const out = await scorePhotoLooksBatch(usable.map((x, i) => ({ index: i, images: x.images })));
      usd = (out.ai && out.ai.usd) || 0;
      for (const r of out.results) {
        const x = usable[r.index];
        if (!x) continue;
        updates.push({ range: `${P}O${x.row}:P${x.row}`, values: [[r.score, r.why]] });
        scored++;
      }
    }
    for (const x of withImgs.filter((y) => !y.images.length)) {
      updates.push({ range: `${P}O${x.row}:P${x.row}`, values: [["", "foto's niet bereikbaar"]] });
    }
    if (updates.length) await batchUpdate(sheetId, updates);
    return NextResponse.json({
      ok: true, done: values.length < batchSize, processed: values.length, scored, usd,
      nextCursor: cursor + values.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
