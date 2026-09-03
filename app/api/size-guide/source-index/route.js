import { NextResponse } from "next/server";
import { memoryDomains, buildSourceIndex, cleanDomain } from "@/lib/sourcestore";
import { cacheAvailable } from "@/lib/sizeguide-cache";

export const maxDuration = 60;

/* SIZE GUIDE — bron-stores indexeren. Client stuurt z'n scraper-lijst
   (localStorage sa_competitor_stores) mee; server voegt alle domeinen uit de
   Geheugen-sheet toe en bouwt per domein een index (products.json → foto-
   sleutels + SKU's) in Redis (24 u). Per call max PER_CALL nog-niet-
   geïndexeerde domeinen; client herhaalt met cursor tot done. */
const PER_CALL = 4;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { domains: clientDomains = [], cursor = 0, force = false } = body;
  if (!cacheAvailable()) return NextResponse.json({ error: "REDIS_URL ontbreekt — bron-store-index kan niet bewaard worden" }, { status: 422 });
  const started = Date.now();
  const mem = await memoryDomains();
  const all = [...new Set([...(Array.isArray(clientDomains) ? clientDomains : []), ...mem].map(cleanDomain).filter((d) => d && d.includes(".")))];
  const results = [];
  let i = Math.max(0, Number(cursor) || 0);
  let built = 0;
  for (; i < all.length; i++) {
    if (Date.now() - started > 45000) break;
    const d = all[i];
    const r = await buildSourceIndex(d, { force });
    results.push({ domain: d, ...r });
    if (!r.cached) built++;
    if (built >= PER_CALL) {
      i++;
      break;
    }
  }
  return NextResponse.json({ ok: true, domains: all, results, nextCursor: i, done: i >= all.length, fromMemorySheet: mem.length, ms: Date.now() - started });
}
