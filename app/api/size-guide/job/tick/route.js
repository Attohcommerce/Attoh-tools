import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { tickJob, jobSecret } from "@/lib/sizeguide-job";

export const maxDuration = 60;

/* SIZE GUIDE — één tick van de cloud-run. Wordt door de vorige tick (of de
   start/resume/status-route) aangeroepen met het job-geheim; staat in
   middleware.js op de publieke lijst, dus het geheim is de enige toegang.
   Antwoordt meteen (202) en werkt daarna door via waitUntil, zodat de
   aanroeper niet hoeft te wachten en de keten niet in elkaar genest raakt. */
export async function POST(req) {
  const secret = req.headers.get("x-sg-job-secret") || "";
  if (!secret || secret !== jobSecret()) return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const domain = String(body.domain || "").trim();
  if (!domain) return NextResponse.json({ error: "domain ontbreekt" }, { status: 400 });
  waitUntil(
    tickJob(domain).catch((e) => {
      console.error("tickJob:", e);
    })
  );
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
