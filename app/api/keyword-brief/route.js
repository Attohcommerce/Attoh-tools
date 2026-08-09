import { NextResponse } from "next/server";
import { buildKeywordBriefs } from "@/lib/ai";

export const maxDuration = 60;

// Product-briefings per keyword: wat IS het product eigenlijk?
// body: { keywords: [{kw, gender}] } → { map: { "<kw>": brief } }
export async function POST(req) {
  const { keywords } = await req.json().catch(() => ({}));
  if (!Array.isArray(keywords) || !keywords.length) {
    return NextResponse.json({ error: "keywords ontbreekt" }, { status: 400 });
  }
  try {
    const map = {};
    const CHUNK = 20; // briefings zijn lang — kleine batches
    for (let i = 0; i < keywords.length; i += CHUNK) {
      const part = keywords.slice(i, i + CHUNK).map((k, n) => ({
        index: n,
        kw: String(k.kw || "").toLowerCase().trim(),
        gender: k.gender,
      }));
      const res = await buildKeywordBriefs(part);
      for (const [idx, brief] of Object.entries(res)) {
        const hit = part[Number(idx)];
        if (hit) map[hit.kw] = brief;
      }
    }
    return NextResponse.json({ ok: true, map });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
