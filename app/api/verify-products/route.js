import { NextResponse } from "next/server";
import { verifyProductsForKeyword } from "@/lib/ai";

export const maxDuration = 60;

// AI-vision controle: is dit product écht het gezochte keyword?
// body: { keyword, gender, brief?, items: [{index, title, image|null}] }
// De brief (product-definitie uit /api/keyword-brief) maakt het oordeel
// hard: MUST-eisen en disqualifiers i.p.v. een losse interpretatie.
// 05-11: de blokken van 10 foto's gaan nu 3 tegelijk naar het model in
// plaats van na elkaar — één call voor een hele golf i.p.v. per winkel.
export async function POST(req) {
  const { keyword, gender, items, brief, mode } = await req.json().catch(() => ({}));
  if (!keyword || !Array.isArray(items) || !items.length) {
    return NextResponse.json({ error: "keyword/items ontbreekt" }, { status: 400 });
  }
  try {
    const CHUNK = 10; // max ~10 foto's per AI-call
    const PARALLEL = 3;
    const parts = [];
    for (let i = 0; i < items.length; i += CHUNK) parts.push(items.slice(i, i + CHUNK));
    const reject = [];
    for (let i = 0; i < parts.length; i += PARALLEL) {
      const rs = await Promise.all(
        parts.slice(i, i + PARALLEL).map((part) => verifyProductsForKeyword(String(keyword), gender, part, brief || null, mode === "fit" ? "fit" : "strict"))
      );
      for (const r of rs) reject.push(...r);
    }
    return NextResponse.json({ ok: true, reject });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
