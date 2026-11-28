import { NextResponse } from "next/server";
import { getDashSession } from "@/lib/dash-session";
import { tokenMark, dashGet, dashTouch, serverStores, publicStore, pick } from "@/lib/dash-ext";
import { runDashboard } from "@/lib/dashboard-run";
import { storePayouts, aggregate } from "@/lib/cashflow";
import { londonDay } from "@/lib/dashboard";
import { recentSales } from "@/lib/recent-sales";

// DASHBOARD MOBIEL (/m) — alleen kijken. De telefoon stuurt alleen domeinen;
// de sleutels komen hier van de server (lib/dash-ext.js serverStores).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function who() {
  const session = await getDashSession();
  if (!session.user || !session.user.id) return null;
  const u = await dashGet(session.user.id).catch(() => null);
  if (!u || u.email !== session.user.email || tokenMark(u.token) !== session.user.mark) return null; // link verwijderd of vernieuwd → uitgelogd
  return { session, u };
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "logout") {
    const session = await getDashSession();
    session.destroy();
    return NextResponse.json({ ok: true });
  }

  const me = await who();
  if (!me) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  dashTouch(me.u, ip).catch(() => {});

  if (action === "me") {
    const all = await serverStores();
    return NextResponse.json({ ok: true, user: { email: me.u.email }, stores: all.stores.map(publicStore), syncedAt: all.savedAt });
  }

  if (action === "dashboard") {
    const all = await serverStores();
    const out = await runDashboard({ date: body.date, range: body.range, adsSheetId: all.adsSheetId, stores: pick(all.stores, body.domains, "orders") });
    return NextResponse.json(out.json, { status: out.status });
  }

  if (action === "cashflow") {
    const all = await serverStores();
    const stores = pick(all.stores, body.domains, "cashflow");
    if (!stores.length) return NextResponse.json({ error: "Geen stores aangevinkt" }, { status: 400 });
    const today = londonDay();
    const results = await Promise.all(
      stores.map((s) =>
        storePayouts(s).catch((e) => ({ key: s.key || "", name: s.name, domain: s.domain, ok: false, error: String(e.message || e), balance: [], upcoming: [], paid: [] }))
      )
    );
    return NextResponse.json({ ok: true, today, stores: results, totals: aggregate(results, today), at: new Date().toISOString() });
  }

  // Live sales (28-11-2026): laatste orders over de aangevinkte stores, voor de aardbol + tijdlijn
  if (action === "recent") {
    const all = await serverStores();
    const stores = pick(all.stores, body.domains, "orders");
    if (!stores.length) return NextResponse.json({ ok: true, sales: [], errors: [] });
    return NextResponse.json(await recentSales(stores, 15));
  }

  return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
}
