import { NextResponse } from "next/server";
import { fetchSizeChart, resolveAliProductId, parseAliProductId } from "@/lib/aliexpress";
import { imageSearchConfigured } from "@/lib/imagesearch";
import { normalizeChart } from "@/lib/sizeguide";

export const maxDuration = 60;

/* SIZE GUIDE — probe. Eén proef-request naar de AliExpress-maattabelpagina
   vanaf Vercel: komt er een tabel terug (klaar), een slider/punish-pagina
   (→ SCRAPER_PROXY_URL instellen) of niets? Meldt ook welke env vars staan.
   Default-product = de live geverifieerde damestrui van 02-09-2026. */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  // envOnly: alleen de instellingen-check (voor de start van een run) — geen AliExpress-request
  if (body.envOnly) {
    return NextResponse.json({
      ok: true,
      env: {
        apify: imageSearchConfigured(),
        proxy: String(process.env.SCRAPER_PROXY_URL || "").includes("{url}"),
        redis: !!process.env.REDIS_URL,
      },
    });
  }
  let pid = parseAliProductId(body.pid || body.url || "") || null;
  const started = Date.now();
  let resolved = null;
  if (!pid && body.url) {
    const r = await resolveAliProductId(body.url);
    if (r.ok) pid = r.pid;
    resolved = r;
  }
  if (!pid) pid = "1005005712746295";
  const c = await fetchSizeChart(pid);
  const env = {
    apify: imageSearchConfigured(),
    proxy: String(process.env.SCRAPER_PROXY_URL || "").includes("{url}"),
    redis: !!process.env.REDIS_URL,
  };
  if (!c.ok) {
    // bewust `message` (niet `error`): dit is een geldig probe-resultaat, geen API-fout
    return NextResponse.json({ ok: false, pid, url: c.url, blocked: !!c.blocked, reason: c.reason || null, message: c.error, via: c.via, ms: Date.now() - started, env, resolved });
  }
  const chart = normalizeChart({ headers: c.headers, rows: c.rows, unitHint: c.unitHint });
  return NextResponse.json({
    ok: true,
    pid,
    url: c.url,
    via: c.via,
    ms: Date.now() - started,
    headers: c.headers,
    rows: c.rows,
    unitHint: c.unitHint,
    unit: chart.unit,
    columns: chart.columns.map((x) => x.key),
    env,
    resolved,
  });
}
