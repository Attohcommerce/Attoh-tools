import { NextResponse } from "next/server";
import { listProducts } from "@/lib/shopify";

export const maxDuration = 60;

/* PRIJSPLAN — handles → product-id's (12-11-2026).
   Plannen die Claude uit een Shopify-productexport maakt kennen alleen de
   handle (de export heeft geen product-id). De Store Doctor vraagt hier
   vooraf de id's op, daarna loopt alles via de gewone fix "set-prices". */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { store, handles } = body;
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  if (!Array.isArray(handles) || !handles.length) return NextResponse.json({ error: "Geen handles" }, { status: 400 });
  const r = await listProducts(store, 5000, { fields: "id,handle" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
  const byHandle = new Map(r.products.map((p) => [String(p.handle).toLowerCase(), p.id]));
  const ids = {};
  const missing = [];
  for (const h of handles) {
    const id = byHandle.get(String(h).toLowerCase());
    if (id) ids[h] = id;
    else missing.push(h);
  }
  return NextResponse.json({ ok: true, ids, missing, total: r.products.length });
}
