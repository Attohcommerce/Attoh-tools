import { NextResponse } from "next/server";
import {
  bcAvailable, bcInfo, bcStatus, saveSettings, saveMarket, addCompetitor, updateCompetitor, removeCompetitor, resetCompetitor,
  startJob, stopJob, resumeJob, kickTick, getJob, markTab, probeFeed, patchCompetitor, pushTimeline,
} from "@/lib/big-competitors";

export const maxDuration = 60;

/* BIG COMPETITORS — API (23-11-2026, projectdoc 205). action:
     info        — alles voor de pagina: markten (sheet, stores, instellingen), competitors, tijdlijn, bladen, runs
     status      — voortgang van de lopende scan + competitors + tijdlijn (zwengelt een stilgevallen scan weer aan)
     settings    — nachtscan aan/uit, max leeftijd in dagen
     saveMarket  — per markt: sheet (link), onder de prijs, max per scan, stores aan/uit
     addCompetitor / updateCompetitor / removeCompetitor / resetCompetitor / probe
     start       — scan starten (markets[] of domains[]; leeg = alles wat actief is)
     stop / resume
     markTab     — blad afvinken als geïmporteerd */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action = "status" } = body;
  try {
    if (!bcAvailable()) return NextResponse.json({ error: "Redis ontbreekt — Big Competitors bewaart zijn geheugen in Redis." }, { status: 422 });

    if (action === "info") return NextResponse.json(await bcInfo());
    if (action === "status") return NextResponse.json(await bcStatus({ autoResume: true }));

    if (action === "settings") {
      const cfg = await saveSettings(body);
      return NextResponse.json({ ok: true, cfg: { nightly: cfg.nightly, maxAgeDays: cfg.maxAgeDays } });
    }
    if (action === "saveMarket") {
      await saveMarket(body.market, body);
      return NextResponse.json(await bcInfo());
    }

    if (action === "addCompetitor") {
      const entry = await addCompetitor(body);
      return NextResponse.json({ ok: true, entry });
    }
    if (action === "updateCompetitor") {
      const entry = await updateCompetitor(body.domain, body.patch || {});
      return NextResponse.json({ ok: true, entry });
    }
    if (action === "removeCompetitor") {
      await removeCompetitor(body.domain);
      return NextResponse.json({ ok: true });
    }
    if (action === "resetCompetitor") {
      await resetCompetitor(body.domain);
      await pushTimeline([{ kind: "competitor", domain: body.domain, text: `Geheugen van ${body.domain} gewist — de volgende scan is weer een eerste scan` }]);
      return NextResponse.json({ ok: true });
    }
    if (action === "probe") {
      const probe = await probeFeed(body.domain);
      const entry = await patchCompetitor(body.domain, { feed: probe.feed, feedStatus: probe.status, ...(probe.currency ? { currency: probe.currency } : {}), ...(probe.expected ? { expected: probe.expected } : {}) });
      return NextResponse.json({ ok: true, probe, entry });
    }

    if (action === "start") {
      const baseUrl = process.env.BC_JOB_BASE_URL || process.env.CF_JOB_BASE_URL || process.env.SG_JOB_BASE_URL || req.nextUrl.origin;
      const r = await startJob({ markets: body.markets || [], domains: body.domains || [], baseUrl, label: body.label || "Handmatig" });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
      const kicked = await kickTick(await getJob());
      return NextResponse.json({ ok: true, job: r.job, kicked });
    }
    if (action === "stop") {
      const r = await stopJob();
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });
      return NextResponse.json(r);
    }
    if (action === "resume") {
      const r = await resumeJob();
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
      const job = await getJob();
      if (job && !job.baseUrl) job.baseUrl = req.nextUrl.origin;
      const kicked = await kickTick(job);
      return NextResponse.json({ ...r, kicked });
    }

    if (action === "markTab") {
      const tab = await markTab(body.id, { imported: body.imported });
      return NextResponse.json({ ok: true, tab });
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[big-competitors]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String((e && e.message) || e) }, { status: Number(e && e.status) || 500 });
  }
}
