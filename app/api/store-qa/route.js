import { NextResponse } from "next/server";
import { listProducts } from "@/lib/shopify";
import { runStoreQa } from "@/lib/qa";
import { reviewStoreSample } from "@/lib/ai";

export const maxDuration = 60;

// Volledige store-controle: haalt de producten op, draait de harde checks en
// laat daarna een AI-steekproef zoeken naar systematische fouten die alleen
// in samenhang opvallen.
export async function POST(req) {
  const { store, max, ai } = await req.json().catch(() => ({}));
  if (!store || !store.domain) {
    return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  }
  const T0 = Date.now();
  try {
    const r = await listProducts(store, Number(max) || 500);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    const products = r.products || [];
    if (!products.length) {
      return NextResponse.json({ error: "Deze store heeft (nog) geen producten" }, { status: 422 });
    }

    const result = runStoreQa(products, { menTemplate: "men" });

    // AI-steekproef: 12 producten uit verschillende hoeken van de catalogus
    let aiFindings = [];
    if (ai !== false && Date.now() - T0 < 30000) {
      try {
        const step = Math.max(1, Math.floor(products.length / 12));
        const sample = products.filter((_, i) => i % step === 0).slice(0, 12);
        aiFindings = await reviewStoreSample(
          sample.map((p) => ({
            title: p.title,
            desc: String(p.body_html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600),
            tags: p.tags,
          }))
        );
      } catch {
        /* AI-laag is aanvullend; harde checks staan er al */
      }
    }

    return NextResponse.json({
      ok: true,
      ...result,
      aiFindings,
      scanned: products.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
