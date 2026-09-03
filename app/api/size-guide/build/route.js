import { NextResponse } from "next/server";
import { buildForProduct } from "@/lib/sizeguide-run";

export const maxDuration = 60;

/* SIZE GUIDE — bouwen (geen writes). Client stuurt de item-samenvattingen
   + cursor en herhaalt tot done. Per call CHUNK producten PARALLEL: elk
   product kan een image-search (5–10 s) én een echte-browser-run bij Apify
   (20–40 s) nodig hebben, dus achter elkaar past dat niet in 60 s.
   `deadline` = harde grens waarbinnen elke bron klaar moet zijn; wat niet
   meer past valt op het vangnet terug (standaardtabel) en wordt de volgende
   run gewoon opnieuw geprobeerd. Met aliInput (handmatige URL/ID) 1 product. */
const CHUNK = 3;
const BUDGET_MS = 52000;

export async function POST(req) {
  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const {
    store,
    market,
    items,
    cursor = 0,
    useSearch = true,
    useSource = true,
    sourceDomains = [],
    fallbackStandard = true,
    force = false,
    aliInput = null,
  } = body;
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ error: "items ontbreekt" }, { status: 400 });
  const slice = items.slice(cursor, cursor + (aliInput ? 1 : CHUNK));
  const deadline = started + BUDGET_MS;
  const domains = Array.isArray(sourceDomains) ? sourceDomains.slice(0, 200) : [];

  const settled = await Promise.allSettled(
    slice.map((item) =>
      buildForProduct({
        domain: store.domain,
        item,
        market: market || "USA",
        aliInput,
        useSearch,
        useSource,
        sourceDomains: domains,
        force,
        fallbackStandard,
        deadline,
      })
    )
  );
  const results = [];
  let fatal = null;
  settled.forEach((s, i) => {
    const item = slice[i];
    if (s.status === "fulfilled") {
      const r = s.value;
      if (r.fatal) {
        // zoekdienst ligt eruit: dit product niet meetellen, batch stoppen
        if (!fatal) fatal = r.reason;
        return;
      }
      results.push(r);
    } else {
      results.push({ id: item.id, title: item.title, ok: false, verdict: "red", reason: `fout: ${String((s.reason && s.reason.message) || s.reason).slice(0, 160)}` });
    }
  });
  // Bij een fatal: cursor niet voorbij de niet-verwerkte producten zetten
  const nextCursor = fatal ? cursor + results.length : cursor + slice.length;
  return NextResponse.json({ ok: true, results, nextCursor, done: !fatal && nextCursor >= items.length, fatal, ms: Date.now() - started });
}
