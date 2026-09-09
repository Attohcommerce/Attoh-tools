import { NextResponse } from "next/server";
import { startJob, stopJob, resumeJob, jobStatus, kickTick, getJob, jobAvailable } from "@/lib/sizeguide-job";

export const maxDuration = 30;

/* SIZE GUIDE — cloud-run (pc mag uit). action:
     start  — zelfde body als /api/size-guide/build + backup/autoWrite; slaat
              de job op in Redis en start de eerste tick
     status — voortgang/log (start zelf een tick als de keten stil ligt)
     stop   — stopt na de lopende ronde, schrijft wat klaar is
     resume — hervat een gestopte/gefaalde run vanaf de cursor */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action = "status", store, domain } = body;
  const dom = (store && store.domain) || domain;
  if (!jobAvailable()) return NextResponse.json({ error: "REDIS_URL ontbreekt — een cloud-run heeft Redis nodig om de voortgang te bewaren." }, { status: 422 });
  if (!dom) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  try {
    if (action === "start") {
      if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
      if (!Array.isArray(body.items) || !body.items.length) return NextResponse.json({ error: "items ontbreekt" }, { status: 400 });
      const backupOn = !!(body.backup && body.backup.sheetId && body.backup.tab);
      if (body.autoWrite !== false && !backupOn && !body.skipBackup) {
        return NextResponse.json({ error: "Geen log-sheet opgegeven — vul er één in of kies expliciet 'zonder log'." }, { status: 400 });
      }
      const baseUrl = process.env.SG_JOB_BASE_URL || req.nextUrl.origin;
      const r = await startJob({
        store,
        market: body.market,
        items: body.items,
        useSearch: body.useSearch,
        sourceDomains: body.sourceDomains,
        fallbackStandard: body.fallbackStandard,
        autoWrite: body.autoWrite,
        backup: backupOn ? body.backup : null,
        baseUrl,
        label: body.label,
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
      const job = await getJob(store.domain);
      const kicked = await kickTick(job);
      return NextResponse.json({ ok: true, job: r.job, kicked });
    }
    if (action === "stop") {
      const r = await stopJob(dom);
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 404 });
    }
    if (action === "resume") {
      const r = await resumeJob(dom);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
      const job = await getJob(dom);
      const kicked = await kickTick(job);
      return NextResponse.json({ ...r, kicked });
    }
    const r = await jobStatus(dom);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
