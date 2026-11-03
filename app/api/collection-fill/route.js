import { NextResponse } from "next/server";
import { scanCollections, planFill, writeFillTab } from "@/lib/collection-fill";

/* COLLECTIES AANVULLEN (Store Doctor, 02-11-2026)
   scan:  alle collecties + aantal actieve producten + koppelingen (markt, TPK-sheet)
   plan:  per aangevinkte collectie keywords + aantallen (schrijft niets)
   write: plan → nieuw blad in de TPK-sheet van de store (scrape-ready) */
export const maxDuration = 120;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "scan") return NextResponse.json(await scanCollections(body.store, body.target));
    if (action === "plan") {
      return NextResponse.json(
        await planFill({ store: body.store, ordersStore: body.ordersStore, collections: body.collections, target: body.target, researchOnly: body.researchOnly !== false })
      );
    }
    if (action === "write") return NextResponse.json(await writeFillTab({ plan: body.plan, tab: body.tab }));
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[collection-fill]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
