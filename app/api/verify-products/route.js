import { NextResponse } from "next/server";
import { verifyProductsForKeyword } from "@/lib/ai";

export const maxDuration = 60;

// AI-vision dubbelcheck voor via-matches (alternatieve zoekwoorden).
// body: { keyword, gender, items: [{index, title, image|null}] }
export async function POST(req) {
  const { keyword, gender, items } = await req.json().catch(() => ({}));
  if (!keyword || !Array.isArray(items) || !items.length) {
    return NextResponse.json({ error: "keyword/items ontbreekt" }, { status: 400 });
  }
  try {
    const reject = [];
    const CHUNK = 10; // max ~10 foto's per AI-call
    for (let i = 0; i < items.length; i += CHUNK) {
      const part = items.slice(i, i + CHUNK);
      const r = await verifyProductsForKeyword(String(keyword), gender, part);
      reject.push(...r);
    }
    return NextResponse.json({ ok: true, reject });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
