import { NextResponse } from "next/server";
import { listProducts, listProductMetafieldValues } from "@/lib/shopify";
import { runDoctor } from "@/lib/doctor";
import { SG_NS, SG_KEY } from "@/lib/sizeguide";

export const maxDuration = 60;

// STORE DOCTOR — scan. Haalt de producten op (heel de store, of alleen
// alles van ná `sinceISO` = de lopende import-run) en draait alle gratis
// deterministische checks. AI-checks lopen apart via /api/doctor-ai.
export async function POST(req) {
  const { store, max, sinceISO, vendorName, market } = await req.json().catch(() => ({}));
  if (!store || !store.domain) {
    return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  }
  try {
    const r = await listProducts(store, Number(max) || 1000, {
      createdAtMin: sinceISO || null,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    const products = r.products || [];
    if (!products.length) {
      return NextResponse.json(
        { error: sinceISO ? "Geen producten gevonden binnen deze run (created_at-filter)" : "Deze store heeft (nog) geen producten" },
        { status: 422 }
      );
    }

    // Maattabellen (metafield custom.size_guide) — één GraphQL-loop, 250 per pagina
    let guides = null;
    try {
      const mf = await listProductMetafieldValues(store, { namespace: SG_NS, key: SG_KEY });
      guides = mf.ok ? mf.values : {};
    } catch {
      guides = {};
    }

    const result = runDoctor(products, {
      vendorName: vendorName || store.name || "",
      menTemplate: "men",
      market: market || "",
      guides,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      scanned: products.length,
      // alle gescande ids — de AI-checks lopen hier client-side in stukken doorheen
      productIds: products.map((p) => p.id),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
