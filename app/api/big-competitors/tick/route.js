import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { tickJob, bcJobSecret } from "@/lib/big-competitors";

export const maxDuration = 60;

/* BIG COMPETITORS — één tick van de scan. Wordt door de vorige tick (of de
   start/status-route, of de cron) aangeroepen met het job-geheim; staat in
   middleware.js op de publieke lijst, dus het geheim is de enige toegang.
   Antwoordt meteen (202) en werkt daarna door via waitUntil. */
export async function POST(req) {
  const secret = req.headers.get("x-bc-job-secret") || "";
  if (!secret || secret !== bcJobSecret()) return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  waitUntil(
    tickJob(body.id || null).catch((e) => {
      console.error("tickJob (big competitors):", e);
    })
  );
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
