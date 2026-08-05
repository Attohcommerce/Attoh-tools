import { NextResponse } from "next/server";
import { suggestAlternativeKeywords } from "@/lib/ai";

export const maxDuration = 30;

// Underdog-keyword → AI-alternatieven met dezelfde product-intentie.
export async function POST(req) {
  const { keyword, gender } = await req.json().catch(() => ({}));
  if (!keyword || !String(keyword).trim()) {
    return NextResponse.json({ error: "keyword ontbreekt" }, { status: 400 });
  }
  try {
    const alternatives = await suggestAlternativeKeywords(String(keyword).trim(), gender);
    return NextResponse.json({ ok: true, alternatives });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
