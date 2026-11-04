import { NextResponse } from "next/server";
import { storePayouts, aggregate } from "@/lib/cashflow";
import { londonDay } from "@/lib/dashboard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* CASHFLOW — body: { stores: [{ key, name, domain, currency, clientId, clientSecret, token }] }
   (zelfde credentials als het omzet-dashboard). Geeft per store de geplande/
   onderweg zijnde Shopify Payments-uitbetalingen, de laatste betaalde, het
   saldo en het schema; plus een totaal per dag (vandaag … +14) in £. */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const stores = Array.isArray(body.stores) ? body.stores.filter((s) => s && s.domain) : [];
  if (!stores.length) return NextResponse.json({ error: "Geen stores aangevinkt" }, { status: 400 });
  const today = londonDay();
  const results = await Promise.all(
    stores.map((s) =>
      storePayouts(s).catch((e) => ({ key: s.key || "", name: s.name, domain: s.domain, ok: false, error: String(e.message || e), balance: [], upcoming: [], paid: [] }))
    )
  );
  return NextResponse.json({ ok: true, today, stores: results, totals: aggregate(results, today), at: new Date().toISOString() });
}
