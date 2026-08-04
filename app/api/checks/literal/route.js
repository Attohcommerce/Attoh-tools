import { NextResponse } from "next/server";
import { readRange, batchUpdate } from "@/lib/sheets";
import { normText } from "@/lib/scrape";

export const maxDuration = 30;

// Controleert of elke "Literal"-match het keyword echt letterlijk bevat (in de titel)
// en tagt twijfelgevallen in kolom H.
export async function POST(req) {
  const { sheetId, tab, cursor = 2, batchSize = 200 } = await req.json().catch(() => ({}));
  const P = tab ? `'${String(tab).replace(/'/g, "")}'!` : "";
  if (!sheetId) return NextResponse.json({ error: "sheetId ontbreekt" }, { status: 400 });

  try {
    const values = await readRange(sheetId, `${P}A${cursor}:H${cursor + batchSize - 1}`);
    if (!values.length) return NextResponse.json({ ok: true, done: true, tagged: 0 });

    const updates = [];
    values.forEach((row, i) => {
      const rowNum = cursor + i;
      const link = row[0];
      const title = normText(row[1] || "");
      const keyword = normText(row[2] || "");
      const matchType = String(row[4] || "");
      const already = row[7];
      if (!link || !keyword || already) return;
      if (matchType.toLowerCase() !== "literal") return;
      if (!title.includes(keyword)) {
        updates.push({ range: `${P}H${rowNum}`, values: [["Twijfel"]] });
      }
    });

    if (updates.length) await batchUpdate(sheetId, updates);
    const done = values.length < batchSize;
    return NextResponse.json({
      ok: true,
      done,
      tagged: updates.length,
      checked: values.length,
      nextCursor: cursor + values.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
