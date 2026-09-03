import { NextResponse } from "next/server";
import { buildForProduct } from "@/lib/sizeguide-run";

export const maxDuration = 60;

/* SIZE GUIDE — bouwen (geen writes). Client stuurt de item-samenvattingen
   + cursor en herhaalt tot done; per call 2 producten, want elke image-
   search is een synchrone Apify-run van 5–30 s. Met aliInput (handmatige
   URL/ID) wordt het zoeken overgeslagen. */
const CHUNK = 2;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { store, market, items, cursor = 0, useSearch = true, fallbackStandard = true, force = false, aliInput = null } = body;
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ error: "items ontbreekt" }, { status: 400 });
  const slice = items.slice(cursor, cursor + (aliInput ? 1 : CHUNK));
  const results = [];
  let fatal = null;
  for (const item of slice) {
    try {
      const r = await buildForProduct({ domain: store.domain, item, market: market || "USA", aliInput, useSearch, force, fallbackStandard });
      if (r.fatal) {
        fatal = r.reason; // zoekdienst ligt eruit: dit product niet meetellen, batch stoppen
        break;
      }
      results.push(r);
    } catch (e) {
      results.push({ id: item.id, title: item.title, ok: false, verdict: "red", reason: `fout: ${String(e.message || e).slice(0, 160)}` });
    }
  }
  const nextCursor = cursor + results.length;
  return NextResponse.json({ ok: true, results, nextCursor, done: !fatal && nextCursor >= items.length, fatal });
}
