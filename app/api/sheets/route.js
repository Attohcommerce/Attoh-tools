import { NextResponse } from "next/server";
import { readRange, appendRows, batchUpdate, getServiceAccountEmail } from "@/lib/sheets";

export const maxDuration = 30;

// Eén route met acties: read / append / update / info
export async function POST(req) {
  const { action, sheetId, range, rows, updates } = await req.json().catch(() => ({}));
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
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
