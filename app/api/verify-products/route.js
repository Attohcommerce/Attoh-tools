import { NextResponse } from "next/server";
import { verifyProductsForKeyword } from "@/lib/ai";

export const maxDuration = 60;

// AI-vision controle: is dit product écht het gezochte keyword?
// body: { keyword, gender, brief?, items: [{index, title, image|null}] }
// De brief (product-definitie uit /api/keyword-brief) maakt het oordeel
// hard: MUST-eisen en disqualifiers i.p.v. een losse interpretatie.
export async function POST(req) {
  const { keyword, gender, items, brief } = await req.json().catch(() => ({}));
  if (!keyword || !Array.isArray(items) || !items.length) {
    return NextResponse.json({ error: "keyword/items ontbreekt" }, { status: 400 });
  }
  try {
    const reject = [];
    const CHUNK = 10; // max ~10 foto's per AI-call
    for (let i = 0; i < items.length; i += CHUNK) {
      const part = items.slice(i, i + CHUNK);
      const r = await verifyProductsForKeyword(String(keyword), gender, part, brief || null);
      reject.push(...r);
    }
    return NextResponse.json({ ok: true, reject });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
