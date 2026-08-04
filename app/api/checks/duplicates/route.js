import { NextResponse } from "next/server";
import { readRange, batchUpdate } from "@/lib/sheets";
import { productUrlToJsonUrl, imageFilename } from "@/lib/scrape";

export const maxDuration = 60;

const UA = "Mozilla/5.0 (compatible; SA-Tools/1.0)";

async function getImageSignatures(link) {
  const jsonUrl = productUrlToJsonUrl(link);
  if (!jsonUrl) return [];
  try {
    const res = await fetch(jsonUrl, { headers: { "User-Agent": UA } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.product?.images || []).map((im) => imageFilename(im.src)).filter(Boolean);
  } catch {
    return [];
  }
}

// Fase 1 (scan): client roept herhaald aan met cursor; wij halen per rij de foto-signatures op
// en geven ze terug. Fase 2 (tag): client stuurt de rijen die dubbel bleken; wij taggen kolom G.
export async function POST(req) {
  const { sheetId, tab, action, cursor = 2, batchSize = 12, tags } = await req.json().catch(() => ({}));
  const P = tab ? `'${String(tab).replace(/'/g, "")}'!` : "";
  if (!sheetId) return NextResponse.json({ error: "sheetId ontbreekt" }, { status: 400 });

  try {
    if (action === "tag") {
      const updates = (tags || []).map((t) => ({
        range: `${P}G${t.row}`,
        values: [[t.label || "Dubbel"]],
      }));
      if (updates.length) await batchUpdate(sheetId, updates);
      return NextResponse.json({ ok: true, tagged: updates.length });
    }

    // action: "scan"
    const values = await readRange(sheetId, `${P}A${cursor}:A${cursor + batchSize - 1}`);
    if (!values.length) return NextResponse.json({ ok: true, done: true, items: [] });

    const items = await Promise.all(
      values.map(async (row, i) => {
        const link = row[0];
        if (!link) return null;
        const sigs = await getImageSignatures(link);
        return { row: cursor + i, link, sigs };
      })
    );

    const done = values.length < batchSize;
    return NextResponse.json({
      ok: true,
      done,
      items: items.filter(Boolean),
      nextCursor: cursor + values.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
