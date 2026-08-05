import { NextResponse } from "next/server";
import { suggestAlternativeKeywords, suggestAlternativeKeywordsBatch } from "@/lib/ai";

export const maxDuration = 60;

// Underdog-keywords → AI-alternatieven met dezelfde product-intentie.
//  - Enkel:  { keyword, gender }              → { alternatives: [...] }
//  - Batch:  { keywords: [{kw, gender}, …] }  → { map: { "<kw>": [...] } }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  try {
    if (Array.isArray(body.keywords) && body.keywords.length) {
      const items = body.keywords
        .map((x, i) => ({ index: i, kw: String(x.kw || "").trim().toLowerCase(), gender: x.gender }))
        .filter((x) => x.kw);
      const map = {};
      const CHUNK = 50;
      for (let i = 0; i < items.length; i += CHUNK) {
        const part = items.slice(i, i + CHUNK);
        const res = await suggestAlternativeKeywordsBatch(part);
        for (const p of part) {
          const alts = (res[p.index] || []).filter((a) => a !== p.kw);
          if (alts.length) map[p.kw] = alts;
        }
      }
      return NextResponse.json({ ok: true, map });
    }

    const { keyword, gender } = body;
    if (!keyword || !String(keyword).trim()) {
      return NextResponse.json({ error: "keyword ontbreekt" }, { status: 400 });
    }
    const alternatives = await suggestAlternativeKeywords(String(keyword).trim(), gender);
    return NextResponse.json({ ok: true, alternatives });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
