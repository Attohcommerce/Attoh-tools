import { NextResponse } from "next/server";
import { deleteProductMetafields } from "@/lib/shopify";
import { SG_NS, SG_KEY, SG_STATUS_KEY } from "@/lib/sizeguide";

export const maxDuration = 60;

/* SIZE GUIDE — maattabel(len) verwijderen (beide metafields). */
export async function POST(req) {
  const { store, ids } = await req.json().catch(() => ({}));
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: "ids ontbreekt" }, { status: 400 });
  const list = [];
  for (const id of ids.slice(0, 100)) {
    list.push({ productId: id, namespace: SG_NS, key: SG_KEY });
    list.push({ productId: id, namespace: SG_NS, key: SG_STATUS_KEY });
  }
  const r = await deleteProductMetafields(store, list);
  return NextResponse.json({ ok: r.ok, removed: Math.floor(r.deleted / 2), errors: r.errors.slice(0, 10) });
}
