import { NextResponse } from "next/server";
import { startJob, kickTick, getJob, getCfg, reviveIfStale, bcAvailable } from "@/lib/big-competitors";

export const maxDuration = 60;
// Altijd bij het verzoek zelf draaien: zonder dit rendert Next deze GET-route bij het bouwen vooraf (statisch) en doet de cron niets.
export const dynamic = "force-dynamic";

/* BIG COMPETITORS — nachtscan (Vercel Cron, zie vercel.json: elke dag 01:00
   UTC = 02:00 Nederlandse tijd in de winter, 03:00 in de zomer). Staat in
   middleware.js op de publieke lijst; eist zelf CRON_SECRET (Authorization:
   Bearer …), net als /api/competitor-finder/cron. Uit te zetten op de pagina
   ("Elke nacht automatisch"). Loopt er nog een scan die stil is gevallen, dan
   zwengelt deze route die eerst weer aan in plaats van een nieuwe te starten. */
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  }
  if (!bcAvailable()) return NextResponse.json({ ok: true, skipped: "geen Redis" });
  if (await reviveIfStale()) return NextResponse.json({ ok: true, revived: true });
  const cfg = await getCfg();
  if (cfg.nightly === false) return NextResponse.json({ ok: true, skipped: "nachtscan uit" });
  const baseUrl = process.env.BC_JOB_BASE_URL || process.env.CF_JOB_BASE_URL || process.env.SG_JOB_BASE_URL || req.nextUrl.origin;
  const r = await startJob({ baseUrl, label: "Nachtscan" });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error });
  const kicked = await kickTick(await getJob());
  return NextResponse.json({ ok: true, kicked, competitors: r.job.queue.length, markets: r.job.markets });
}
