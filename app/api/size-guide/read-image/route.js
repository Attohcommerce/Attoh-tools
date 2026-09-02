import { NextResponse } from "next/server";
import { buildFromImage } from "@/lib/sizeguide-run";

export const maxDuration = 60;

/* SIZE GUIDE — screenshot-route: afbeelding (data-URL uit de review-UI of
   een URL) → AI leest de tabel → zelfde normalisatie/uitlijning als de
   AliExpress-route. Bodylimiet Vercel ±4,5 MB: client verkleint eerst. */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { item, market, imageUrl, dataUrl } = body;
  if (!item || !item.id) return NextResponse.json({ error: "item ontbreekt" }, { status: 400 });
  if (!imageUrl && !dataUrl) return NextResponse.json({ error: "geen afbeelding" }, { status: 400 });
  try {
    const r = await buildFromImage({ item, market: market || "USA", imageUrl, dataUrl });
    return NextResponse.json({ ok: true, result: r });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
