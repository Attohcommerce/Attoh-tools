import { NextResponse } from "next/server";
import { reviveIfStale, bcAvailable } from "@/lib/big-competitors";

export const maxDuration = 60;
// Altijd bij het verzoek zelf draaien: zonder dit rendert Next deze GET-route bij het bouwen vooraf (statisch) en doet de cron niets.
export const dynamic = "force-dynamic";

/* BIG COMPETITORS — waakhond (Vercel Cron, een half uur na de nachtscan).
   's Nachts kijkt niemand naar de pagina; valt de keten van ticks stil
   (deploy, time-out), dan start deze route hem opnieuw. Start nooit zelf een
   nieuwe scan. */
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  }
  if (!bcAvailable()) return NextResponse.json({ ok: true, skipped: "geen Redis" });
  return NextResponse.json({ ok: true, revived: await reviveIfStale() });
}
