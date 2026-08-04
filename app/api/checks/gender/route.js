import { NextResponse } from "next/server";
import { readRange, batchUpdate } from "@/lib/sheets";
import { classifyGenderBatch } from "@/lib/ai";

export const maxDuration = 60;

// Verwerkt max `batchSize` rijen per call; client herhaalt tot done.
// Sheet-indeling: A link, B titel, C keyword, D matchbron, E matchtype, F geslacht-label.
export async function POST(req) {
  const { sheetId, tab, cursor = 2, batchSize = 40 } = await req.json().catch(() => ({}));
  const P = tab ? `'${String(tab).replace(/'/g, "")}'!` : "";
  if (!sheetId) return NextResponse.json({ error: "sheetId ontbreekt" }, { status: 400 });

  try {
    const values = await readRange(sheetId, `${P}A${cursor}:F${cursor + batchSize - 1}`);
    if (!values.length) {
      return NextResponse.json({ ok: true, done: true, processed: 0 });
    }

    const rows = [];
    values.forEach((row, i) => {
      const link = row[0];
      const already = row[5];
      if (link && !already) {
        rows.push({
          index: cursor + i,
          title: row[1] || link,
          keyword: row[2] || "",
        });
      }
    });

    let labeled = 0;
    if (rows.length) {
      const map = await classifyGenderBatch(rows);
      const updates = [];
      for (const r of rows) {
        const label = map[r.index];
        if (label) {
          updates.push({ range: `${P}F${r.index}`, values: [[label]] });
          labeled++;
        }
      }
      if (updates.length) await batchUpdate(sheetId, updates);
    }

    const done = values.length < batchSize;
    return NextResponse.json({
      ok: true,
      done,
      processed: values.length,
      labeled,
      nextCursor: cursor + values.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
