import { NextResponse } from "next/server";
import { getStores } from "@/lib/claude-link";
import { rebrand } from "@/lib/rebrand";

// Merknaam omzetten in de policies en pagina's van één store (zie lib/rebrand.js), achter de gewone login.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    const r = await rebrand(body || {}, await getStores());
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 });
  }
}
