import { NextResponse } from "next/server";
import { scanFitNotes, analyzeFitNotes, writeFitNotes, scanSizeCharts, applySizeChartsSmall, autoFitNotes } from "@/lib/fit-note";

/* FITNOTES (Store Doctor, 03-11-2026)
   scan:    kleding-producten + huidige fitnote (metafields custom.model_height_cm / custom.model_size)
   analyze: AI-voorstel voor max 10 ids (draagt een model het product? lengte + maat)
   write:   rows [{id, height, size}] → metafields (leeg = wissen) */
export const maxDuration = 60;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "scan") return NextResponse.json(await scanFitNotes(body.store));
    if (action === "analyze") return NextResponse.json(await analyzeFitNotes(body.store, body.ids));
    if (action === "sizecharts-scan") return NextResponse.json(await scanSizeCharts(body.store));
    if (action === "sizecharts-apply") return NextResponse.json(await applySizeChartsSmall(body.store, body.ids));
    if (action === "auto") return NextResponse.json(await autoFitNotes(body.store, body.ids));
    if (action === "write") return NextResponse.json(await writeFitNotes(body.store, body.rows));
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[fit-note]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
