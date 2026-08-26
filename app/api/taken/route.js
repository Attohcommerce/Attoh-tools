import { NextResponse } from "next/server";
import { listJobs, getJob } from "../../../lib/jobs";
import { cleanDomain } from "../../../lib/jobs/_helpers";

export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

// POST { jobId, items: [...], params? } -> { results: [{ok,row}|{ok:false,item,error}] }
// Client stuurt chunks (max 15 items per call); binnen de call parallel via een worker-pool.
export async function POST(req) {
  try {
    const body = await req.json();
    const job = getJob(body && body.jobId);
    if (!job) return NextResponse.json({ error: "Onbekende taak" }, { status: 400 });

    const list = (Array.isArray(body.items) ? body.items : [])
      .slice(0, 15)
      .map((x) => cleanDomain(x))
      .filter(Boolean);
    if (!list.length) return NextResponse.json({ results: [] });

    const conc = Math.max(1, Math.min(job.concurrency || 6, 8));
    const results = new Array(list.length);
    let idx = 0;

    async function worker() {
      while (idx < list.length) {
        const i = idx++;
        const item = list[i];
        try {
          const row = await job.run(item, body.params || {});
          results[i] = { ok: true, row };
        } catch (e) {
          results[i] = { ok: false, item, error: String((e && e.message) || e) };
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(conc, list.length) }, worker));
    return NextResponse.json({ results });
  } catch (e) {
    console.error("taken route:", (e && e.stack) || e);
    return NextResponse.json({ error: String((e && e.message) || e) }, { status: 500 });
  }
}
