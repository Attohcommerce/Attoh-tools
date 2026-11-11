import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { enqueue, listQueue, clearQueue, agentKey } from "@/lib/photo-queue";
import { openaiReady, openaiSettings } from "@/lib/photo-openai";
import { getOrg } from "@/lib/org-server";
import { listProducts } from "@/lib/shopify";

/* AI-modelfoto's (10-11-2026): wachtrij voor Claude.
   enqueue: gekozen producten van de laatste import klaarzetten
   list:    stand per batch + sleutel voor Claude
   clear:   batch (of alles wat klaar is) opruimen */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const org = getOrg();
  try {
    if (body.action === "enqueue") {
      const r = await enqueue({ org, store: body.store, productIds: body.productIds, mode: body.mode, per: body.per, engine: body.engine, batch: body.batch });
      // OpenAI-motor: meteen de werker starten — die loopt door, ook als de pagina dicht gaat.
      if (body.engine === "openai" && r.added) {
        const origin = new URL(req.url).origin;
        const key = await agentKey();
        waitUntil(fetch(`${origin}/api/photo-queue/work`, { method: "POST", headers: { "x-photo-key": key }, signal: AbortSignal.timeout(8000) }).catch(() => {}));
      }
      return NextResponse.json({ ...r, queue: await listQueue(org) });
    }
    if (body.action === "products") {
      // tab 4: producten uit de store zelf (titel + id), zodat het overzicht er ook na verversen of op een andere pc is
      if (!body.store || !body.store.domain) return NextResponse.json({ error: "Kies een store" }, { status: 400 });
      const days = Math.max(0, Math.min(365, Number(body.days) || 0));
      const opts = { fields: "id,title,status,created_at" };
      if (days) opts.createdAtMin = new Date(Date.now() - days * 86400000).toISOString();
      const r = await listProducts(body.store, 3000, opts);
      if (!r.ok) return NextResponse.json({ error: r.error || "Producten ophalen mislukt" }, { status: 400 });
      const products = (r.products || []).filter((p) => p.status !== "archived").map((p) => ({ id: String(p.id), title: p.title || "" }));
      return NextResponse.json({ ok: true, products });
    }
    if (body.action === "clear") {
      await clearQueue(org, { batch: body.batch, onlyDone: !!body.onlyDone });
      return NextResponse.json({ ok: true, queue: await listQueue(org) });
    }
    return NextResponse.json({ ok: true, queue: await listQueue(org), key: await agentKey(), openai: openaiReady(), openaiSettings: openaiSettings() });
  } catch (e) {
    console.error("[photo-queue]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
