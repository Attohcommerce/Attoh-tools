import { NextResponse } from "next/server";
import { checkAgentKey, agentNext, agentDone, agentFail, agentSource, agentRepos } from "@/lib/photo-queue";

/* Ingang voor Claude (geen login, wel sleutel in header x-photo-key).
   next: openstaande opdrachten + het brein · done: foto-URL → op het product · fail: afgekeurd · source: bronfoto van een opdracht */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req) {
  if (!(await checkAgentKey(req.headers.get("x-photo-key")))) return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "source") {
      const img = await agentSource(body);
      return new NextResponse(img.buf, { headers: { "content-type": img.type, "cache-control": "no-store" } });
    }
    if (body.action === "repos") return NextResponse.json(await agentRepos(body));
    if (body.action === "done") return NextResponse.json(await agentDone(body));
    if (body.action === "fail") return NextResponse.json(await agentFail(body));
    return NextResponse.json(await agentNext({ limit: body.limit, store: body.store }));
  } catch (e) {
    console.error("[photo-queue/agent]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
