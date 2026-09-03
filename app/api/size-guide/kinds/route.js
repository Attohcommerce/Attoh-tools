import { NextResponse } from "next/server";
import { classifyKindsBatch } from "@/lib/sizeguide-ai";

export const maxDuration = 60;

/* SIZE GUIDE — productsoort bepalen voor titels die de regels niet herkennen
   (kind "unknown"). Alleen tekst → Haiku, ±$0,0003 per product. Client
   stuurt max 40 per call. */
export async function POST(req) {
  const { items } = await req.json().catch(() => ({}));
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ error: "items ontbreekt" }, { status: 400 });
  try {
    const r = await classifyKindsBatch(items.slice(0, 40).map((it, i) => ({ index: i, title: it.title, productType: it.productType || "" })));
    const kinds = r.kinds.map((k) => ({ id: items[k.index] && items[k.index].id, kind: k.kind })).filter((k) => k.id != null);
    return NextResponse.json({ ok: true, kinds, ai: r.ai });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
