import { NextResponse } from "next/server";
import { startJob, kickTick, getJob } from "@/lib/finder-job";
import { getConfig } from "@/lib/competitor-finder";
import { DEFAULT_MARKET_KEYS } from "@/lib/finder-markets";

export const maxDuration = 60;

/* COMPETITOR FINDER — wekelijkse run (Vercel Cron, zie vercel.json: elke
   maandag 05:20 UTC). Staat in middleware.js op de publieke lijst; eist zelf
   CRON_SECRET (Authorization: Bearer …), net als /api/reis/cron. Uit te
   zetten in de tool: Instellingen → "Elke maandag automatisch". */
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  }
  const cfg = await getConfig();
  if (cfg.weekly === false) return NextResponse.json({ ok: true, skipped: "weekrun uit" });
  const markets = String(cfg.weeklyMarkets || "").split(",").map((k) => k.trim()).filter(Boolean);
  const baseUrl = process.env.CF_JOB_BASE_URL || process.env.SG_JOB_BASE_URL || req.nextUrl.origin;
  const r = await startJob({ markets: markets.length ? markets : DEFAULT_MARKET_KEYS, baseUrl, label: "Weekrun" });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 409 });
  const kicked = await kickTick(await getJob());
  return NextResponse.json({ ok: true, kicked, markets: r.job.markets, queries: r.job.totalQueries });
}
