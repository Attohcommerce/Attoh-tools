import { NextResponse } from "next/server";
import { resolveToken, shopifyRequest } from "@/lib/shopify";

export const maxDuration = 30;

/* BILLS — "Test koppeling" voor de Orders-app. Drie stappen, elk met een
   eigen foutmelding zodat meteen duidelijk is WAAR het hapert:
   1. token minten (sleutels + is de app geïnstalleerd op deze store?)
   2. /shop.json (werkt het token überhaupt — geen scope nodig)
   3. /orders/count.json (read_orders + protected customer data) */
export async function POST(req) {
  const { store } = await req.json().catch(() => ({}));
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  const via = store.token ? "vast token" : store.clientId ? "Orders-app (client credentials)" : "geen sleutels";

  const t = await resolveToken(store);
  if (!t.ok) return NextResponse.json({ ok: false, stage: "token", via, error: `Token: ${t.error}` });

  const shop = await shopifyRequest(store.domain, t.token, "/shop.json?fields=name,myshopify_domain");
  if (!shop.ok) return NextResponse.json({ ok: false, stage: "shop", via, error: `Token werkt niet op /shop.json (HTTP ${shop.status}): ${shop.error}` });
  const shopName = (shop.data && shop.data.shop && shop.data.shop.name) || store.domain;

  const cnt = await shopifyRequest(store.domain, t.token, "/orders/count.json?status=any");
  if (!cnt.ok) {
    const d = String(cnt.error || "").replace(/\s*—\s*token ongeldig of scopes ontbreken.*$/i, "");
    let hint = "";
    if (/merchant approval|scope/i.test(d)) hint = " → app op deze store opnieuw installeren/goedkeuren met read_orders.";
    else if (/not approved to access|protected customer/i.test(d)) hint = " → Protected customer data access aanzetten in het Dev Dashboard.";
    return NextResponse.json({ ok: false, stage: "orders", via, shop: shopName, error: `${shopName}: orders geweigerd (HTTP ${cnt.status}: ${d})${hint}` });
  }
  const count = (cnt.data && cnt.data.count) != null ? cnt.data.count : "?";
  return NextResponse.json({ ok: true, via, shop: shopName, count, scope: t.scope || null });
}
