import { NextResponse } from "next/server";
import { getStores } from "@/lib/claude-link";
import { priceCap } from "@/lib/price-cap";

// Korting maximeren op een store (zie lib/price-cap.js). Achter de gewone login.
// POST { store, max_pct: 50, apply: false|true, cursor? }
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    const r = await priceCap(body || {}, await getStores());
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 });
  }
}
