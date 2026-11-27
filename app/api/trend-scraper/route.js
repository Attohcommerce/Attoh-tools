import { NextResponse } from "next/server";
import {
  TREND_SOURCES,
  TREND_MARKETS,
  TREND_PRESETS,
  presetKeywords,
  trendAvailable,
  getTrendJob,
  startTrendJob,
  tickTrendJob,
  stopTrendJob,
  getTrendResults,
  getTrendQueue,
  addToTrendQueue,
  removeFromTrendQueue,
  clearTrendQueue,
  trendingKeywords,
} from "@/lib/trend";
import { scrapeTrendProduct } from "@/lib/trend-product";

export const maxDuration = 60;

/* TREND SCRAPER — API (27-11-2026). action:
   info · start · tick · stop · results · queue · queueAdd · queueRemove · queueClear · keywords · preview */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action = "info" } = body;
  try {
    if (action === "info") {
      const presets = Object.fromEntries(Object.entries(TREND_PRESETS).map(([k, p]) => [k, { label: p.label, keywords: presetKeywords(k) }]));
      return NextResponse.json({
        available: trendAvailable(),
        sources: Object.values(TREND_SOURCES).map((s) => ({ key: s.key, label: s.label })),
        markets: TREND_MARKETS,
        presets,
        job: await getTrendJob(),
        queueCount: (await getTrendQueue()).length,
      });
    }
    if (action === "start") return NextResponse.json({ job: await startTrendJob(body) });
    if (action === "tick") return NextResponse.json(await tickTrendJob());
    if (action === "stop") return NextResponse.json(await stopTrendJob());
    if (action === "results") return NextResponse.json({ results: await getTrendResults() });
    if (action === "queue") return NextResponse.json({ queue: await getTrendQueue() });
    if (action === "queueAdd") return NextResponse.json(await addToTrendQueue(body.items || []));
    if (action === "queueRemove") return NextResponse.json(await removeFromTrendQueue(body.urls || []));
    if (action === "queueClear") return NextResponse.json(await clearTrendQueue());
    if (action === "keywords") {
      const r = await getTrendResults();
      return NextResponse.json({ keywords: trendingKeywords(r ? r.items : [], { limit: Number(body.limit) || 60 }) });
    }
    if (action === "preview") {
      // Eén product testen: details + foto-opschoning, zonder te importeren
      if (!body.url) return NextResponse.json({ error: "url ontbreekt" }, { status: 400 });
      return NextResponse.json(await scrapeTrendProduct(body.url));
    }
    return NextResponse.json({ error: `onbekende actie ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
