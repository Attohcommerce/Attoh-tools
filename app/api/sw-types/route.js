import { NextResponse } from "next/server";
import { listProducts } from "@/lib/shopify";
import { latestProductIds, productsByIdsFull, LATEST_MAX } from "@/lib/doctor-latest";
import { isShapesWardrobe, swTypeVerdict, SW_TYPES } from "@/lib/sw-product-types";

export const maxDuration = 60;

/* SHAPES WARDROBE — producttypes van Cas (23-10-2026), stap vóór de Doctor-scan.
   "check": haalt de producten op in dezelfde selectie als de scan (import-run,
   laatste N of hele store) en geeft de ID's terug waarvan het type niet
   exact uit de lijst van Cas komt. Het rechtzetten zelf loopt via de gewone
   Doctor-fix "set-sw-type" (/api/doctor-fix: chunks, backup, AI op foto + titel).
   Alleen voor Shapes Wardrobe. */
export async function POST(req) {
  const { store, sinceISO, latest, max } = await req.json().catch(() => ({}));
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  if (!isShapesWardrobe(store)) {
    return NextResponse.json({ error: "Producttypes van Cas gelden alleen voor Shapes Wardrobe" }, { status: 400 });
  }
  try {
    let products;
    const latestN = !sinceISO && Number(latest) > 0 ? Math.min(LATEST_MAX, Math.round(Number(latest))) : 0;
    if (latestN) {
      const li = await latestProductIds(store, latestN);
      if (!li.ok) return NextResponse.json({ error: li.error }, { status: 422 });
      const pr = await productsByIdsFull(store, li.ids);
      if (!pr.ok) return NextResponse.json({ error: pr.error }, { status: 422 });
      products = pr.products;
    } else {
      const r = await listProducts(store, Number(max) || 5000, {
        createdAtMin: sinceISO || null,
        fields: "id,title,product_type,tags,status",
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      products = r.products || [];
    }

    const toFix = [];
    const reasons = {};
    const examples = [];
    for (const p of products) {
      const v = swTypeVerdict(p);
      if (v.ok) continue;
      toFix.push(p.id);
      const key = v.canonical ? "spelling wijkt af" : v.reason.startsWith("geslacht") ? "geslacht klopt niet" : v.reason;
      reasons[key] = (reasons[key] || 0) + 1;
      if (examples.length < 6) examples.push(`${String(p.title || p.id).slice(0, 60)} — "${String(p.product_type || "").trim() || "leeg"}"`);
    }
    return NextResponse.json({
      ok: true,
      total: products.length,
      good: products.length - toFix.length,
      toFix,
      reasons,
      examples,
      typeCount: SW_TYPES.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
