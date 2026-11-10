import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { checkAgentKey, agentKey } from "@/lib/photo-queue";
import { runOpenAi, openaiReady } from "@/lib/photo-openai";

/* Werker van de OpenAI-motor (sleutel in header x-photo-key, geen login nodig zodat hij zichzelf kan doorstarten).
   Antwoordt meteen en werkt daarna door; staat er na ±4 minuten nog werk, dan start hij zichzelf opnieuw.
   Zo loopt een batch door, ook als de pagina dicht is. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function work(origin) {
  const out = await runOpenAi({ maxMs: 230000 });
  if (out.left > 0 && !out.busy) {
    try {
      await fetch(`${origin}/api/photo-queue/work`, { method: "POST", headers: { "x-photo-key": await agentKey() }, signal: AbortSignal.timeout(8000) });
    } catch {}
  }
  return out;
}

export async function POST(req) {
  if (!(await checkAgentKey(req.headers.get("x-photo-key")))) return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  if (!openaiReady()) return NextResponse.json({ ok: false, off: true, error: "OPENAI_API_KEY ontbreekt in Vercel" });
  const origin = new URL(req.url).origin;
  waitUntil(work(origin).catch((e) => console.error("[photo-queue/work]", e && e.stack ? e.stack : e)));
  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
