// POKÉMON TOOL — concurrentenlijst (toevoegen / weghalen / platform herkennen)
import { NextResponse } from "next/server";
import { getComps, upsertComp, removeComp, clearGenState, pkRedisAvailable } from "@/lib/pokemon/store";
import { detectPlatform, cleanDomain } from "@/lib/pokemon/scrape";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  if (!pkRedisAvailable()) return NextResponse.json({ comps: [], redis: false });
  return NextResponse.json({ comps: await getComps(), redis: true });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!pkRedisAvailable()) return NextResponse.json({ error: "Redis is niet ingesteld (STORAGE2_REDIS_URL)" }, { status: 500 });
  const action = body.action || "add";
  try {
    if (action === "add") {
      const domains = [...new Set(String(body.domains || "").split(/[\s,;]+/).map(cleanDomain).filter((d) => d && d.includes(".")))].slice(0, 30);
      if (!domains.length) return NextResponse.json({ error: "Geen geldige domeinen" }, { status: 400 });
      const existing = await getComps();
      const added = [];
      await Promise.all(
        domains.map(async (d) => {
          const known = existing.find((c) => c.domain === d);
          const platform = known && known.platform ? known.platform : await detectPlatform(d);
          added.push({ domain: d, platform });
        })
      );
      for (const a of added) await upsertComp(a);
      return NextResponse.json({ comps: await getComps(), added });
    }
    if (action === "remove") {
      await removeComp(body.domain);
      return NextResponse.json({ comps: await getComps() });
    }
    if (action === "platform") {
      // handmatig platform kiezen (als de herkenning fout zat)
      await upsertComp({ domain: body.domain, platform: body.platform });
      await clearGenState(body.domain);
      return NextResponse.json({ comps: await getComps() });
    }
    if (action === "redetect") {
      const platform = await detectPlatform(body.domain);
      await upsertComp({ domain: body.domain, platform });
      await clearGenState(body.domain);
      return NextResponse.json({ comps: await getComps(), platform });
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
