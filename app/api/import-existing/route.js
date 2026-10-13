import { NextResponse } from "next/server";
import { listProducts, listProductMetafieldValues } from "@/lib/shopify";
import { buildIndex, SRC_NS, SRC_KEY } from "@/lib/source-match";

export const maxDuration = 60;

/* Index van wat er al in de store staat — de importer slaat daarmee
   bron-producten over die al geïmporteerd zijn (herimport na een
   afgebroken run, credits op, …). Eén keer per run opgehaald. */
export async function POST(req) {
  const { store } = await req.json().catch(() => ({}));
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  try {
    const [r, mf] = await Promise.all([
      listProducts(store, 5000, { fields: "id,title,images,variants" }),
      listProductMetafieldValues(store, { namespace: SRC_NS, key: SRC_KEY, max: 5000 }).catch(() => ({ ok: false })),
    ]);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    const index = buildIndex(r.products || [], mf && mf.ok ? Object.values(mf.values) : []);
    return NextResponse.json({ ok: true, products: (r.products || []).length, ...index });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
