import { NextResponse } from "next/server";
import { listProducts, listProductMetafieldValues } from "@/lib/shopify";
import { productSummary, SG_NS, SG_STATUS_KEY } from "@/lib/sizeguide";

export const maxDuration = 60;

/* SIZE GUIDE — scan. Alle producten (of alleen die van ná sinceISO) als
   compacte samenvatting: familie, geslacht, maten, 2 foto's + de huidige
   maattabel-status uit de metafield. Geen AI, geen kosten. */
export async function POST(req) {
  const { store, max, sinceISO } = await req.json().catch(() => ({}));
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  try {
    const r = await listProducts(store, Number(max) || 1000, {
      createdAtMin: sinceISO || null,
      fields: "id,title,handle,tags,status,product_type,images,variants,options,created_at",
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    const products = r.products || [];
    if (!products.length) return NextResponse.json({ error: "Geen producten gevonden" }, { status: 422 });

    const mf = await listProductMetafieldValues(store, { namespace: SG_NS, key: SG_STATUS_KEY });
    const statuses = mf.ok ? mf.values : {};

    const items = products.map((p) => {
      const s = productSummary(p);
      return { ...s, sgStatus: statuses[String(p.id)] || null };
    });
    const counts = { total: items.length, withGuide: 0, noSizes: 0, aliexpress: 0, standard: 0, manual: 0 };
    for (const it of items) {
      if (!it.sizes.length) counts.noSizes++;
      if (it.sgStatus) {
        counts.withGuide++;
        if (counts[it.sgStatus] != null) counts[it.sgStatus]++;
      }
    }
    return NextResponse.json({ ok: true, items, counts, metafieldsReadable: mf.ok, metafieldsError: mf.ok ? null : mf.error });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
