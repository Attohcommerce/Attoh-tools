import { NextResponse } from "next/server";
import { listProducts, listProductMetafieldValues } from "@/lib/shopify";
import { productSummary, SG_NS, SG_KEY, KIND_LABEL } from "@/lib/sizeguide";

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

    // De hele maattabel per product (JSON) — nodig voor "Check alles" in de client
    const mf = await listProductMetafieldValues(store, { namespace: SG_NS, key: SG_KEY });
    const guides = mf.ok ? mf.values : {};

    const items = products.map((p) => {
      const s = productSummary(p);
      let guide = null;
      const raw = guides[String(p.id)];
      if (raw) {
        try {
          guide = JSON.parse(raw);
        } catch {
          guide = null;
        }
      }
      return { ...s, sgStatus: guide ? guide.status || "aliexpress" : null, guide };
    });
    const counts = { total: items.length, withGuide: 0, noSizes: 0, aliexpress: 0, source: 0, standard: 0, manual: 0 };
    const kinds = {};
    for (const it of items) {
      if (!it.sizes.length) counts.noSizes++;
      if (it.sgStatus) {
        counts.withGuide++;
        if (counts[it.sgStatus] != null) counts[it.sgStatus]++;
      }
      kinds[it.kind] = (kinds[it.kind] || 0) + 1;
    }
    const kindsList = Object.entries(kinds)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ kind: k, label: KIND_LABEL[k] || k, count: n }));
    return NextResponse.json({ ok: true, items, counts, kinds: kindsList, metafieldsReadable: mf.ok, metafieldsError: mf.ok ? null : mf.error });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
