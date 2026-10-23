import { NextResponse } from "next/server";
import { cvrBoostAnalyse, cvrBoostWrite, cvrBoostDone, cvrBoostShow, cvrBoostReopen, cvrBoostList } from "@/lib/cvr-boost";

/* CONVERSION BOOSTER (Pythago, projectdoc 64) — vóór het draften eerst een kans.
   analyse: Pythago-resultaat + regels → kandidaten, listing uit Shopify, AI-oordeel
            per product (Boost · Draft nu · Laten lopen). Schrijft niets.
   write:   aangevinkte producten als blad "CVR BOOST dd-mm" + CVR Log; run in het
            geheugen zodat Pythago die producten niet draft zolang de boost loopt.
   done:    boost klaar → blad verbergen, boost-venster start.
   show:    blad tonen/verbergen zonder de status te veranderen.
   reopen:  boost heropenen (venster en effect gewist).
   list:    alle boosts van de store. */
export const maxDuration = 120;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "analyse") {
      const { store, result, settings } = body;
      return NextResponse.json(await cvrBoostAnalyse({ store, result, settings }));
    }
    if (action === "write") {
      const { store, sheet, tab, run } = body;
      return NextResponse.json(await cvrBoostWrite({ store, sheet, tab, run }));
    }
    if (action === "done") return NextResponse.json(await cvrBoostDone({ store: body.store, tab: body.tab }));
    if (action === "show") return NextResponse.json(await cvrBoostShow({ store: body.store, tab: body.tab, hidden: !!body.hidden }));
    if (action === "reopen") return NextResponse.json(await cvrBoostReopen({ store: body.store, tab: body.tab }));
    if (action === "list") return NextResponse.json(await cvrBoostList({ store: body.store }));
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[cvr-boost]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
