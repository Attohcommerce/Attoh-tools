import { NextResponse } from "next/server";
import { analysePythago, writePythagoTab, draftProducts } from "@/lib/pythago";
import { applyBoostState } from "@/lib/cvr-boost";

/* PYTHAGO — spend per product (Google Ads-export) naast Shopify-verkopen.
   analyse: export(s) + Shopify (orders + producten) → advies per product. Schrijft niets.
            Daarna krijgt elke rij de Conversion Booster-status (lopende boost,
            boost-venster, effect na het venster — lib/cvr-boost.js).
   write:   resultaat als tabblad in een Google Sheet.
   draft:   alleen de aangevinkte product-ID's op draft zetten (Importer-koppeling). */
export const maxDuration = 120;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "analyse") {
      const { store, ordersStore, ads, exports, settings, adsCurrency, fxOverride } = body;
      const result = await analysePythago({ store, ordersStore, ads, exports, settings, adsCurrency, fxOverride });
      try {
        await applyBoostState(result, store.domain);
      } catch (e) {
        result.warnings = [...(result.warnings || []), `Boost-status niet geladen: ${String((e && e.message) || e).slice(0, 120)}`];
      }
      return NextResponse.json({ ok: true, result });
    }
    if (action === "write") {
      const { sheet, tab, result } = body;
      return NextResponse.json(await writePythagoTab({ sheet, tab, result }));
    }
    if (action === "draft") {
      const { store, productIds } = body;
      return NextResponse.json(await draftProducts({ store, productIds }));
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[pythago]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
