// POKÉMON TOOL — Store Doctor: scan, fixes in porties, voorraad.
import { NextResponse } from "next/server";
import { scanStore, runFix, getLocations, setStock, stockList } from "@/lib/pokemon/doctor";
import { getComps, getImported, getSettings, pkRedisAvailable } from "@/lib/pokemon/store";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function storeFrom(b) {
  const s = b.store || {};
  return { domain: s.domain, token: s.token, clientId: s.clientId, clientSecret: s.clientSecret };
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const store = storeFrom(body);
  if (!store.domain) return NextResponse.json({ error: "Kies eerst een store" }, { status: 400 });
  const redis = pkRedisAvailable();
  try {
    if (body.action === "scan") {
      const comps = redis ? await getComps() : [];
      const imported = redis ? await getImported(store.domain) : {};
      const r = await scanStore(store, { comps, imported });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      return NextResponse.json(r);
    }
    if (body.action === "fix") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, body.fix === "rewrite" ? 3 : 25);
      const imported = redis ? await getImported(store.domain) : {};
      const settings = { ...((redis && (await getSettings())) || {}), ...(body.settings || {}) };
      const r = await runFix(store, body.fix, ids, { imported, settings });
      return NextResponse.json(r);
    }
    if (body.action === "locations") return NextResponse.json(await getLocations(store));
    if (body.action === "stocklist") return NextResponse.json(await stockList(store));
    if (body.action === "stock") return NextResponse.json(await setStock(store, body.items || [], body.locationId));
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
