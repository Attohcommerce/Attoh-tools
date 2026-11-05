import { NextResponse } from "next/server";
import { tpkAnalyseForStore, tpkWriteForStore } from "@/lib/tpk";
import { getOrg } from "@/lib/org-server";

/* TPK — Top Performing Keywords (Keywords → TPK). Twee acties:
   analyse: orders van de laatste 30 dagen (Orders-app van de store, zelfde
            sleutels als de Bills-pagina) of een geplakte Shopify-CSV
            ("Verkopen per product") → keywords, verdict, verdeling van N
            producten, zoektermen. Schrijft NIETS. Bronnen (sources): sales
            (orders/CSV) en/of pythago (uptrend-producten uit de laatste
            Pythago-sync, lib/pythago-uptrend.js) — één of allebei.
   write:   het weektab (scrape-ready, verdeling-formaat) + Log + Overzicht
            in de TPK-sheet van de store (store-geheugen). */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "analyse") {
      const { store, ordersStore, csvText, days, n, useAi, tab, sources, pyN } = body;
      return NextResponse.json(await tpkAnalyseForStore({ org: getOrg(), store, ordersStore, csvText, days, n, useAi, tab, sources, pyN }));
    }
    if (action === "write") {
      const { store, tab, analysis } = body;
      return NextResponse.json(await tpkWriteForStore({ store, tab, analysis }));
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[tpk]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
