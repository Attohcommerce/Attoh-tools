import { NextResponse } from "next/server";
import { storeDays, londonDay, addDays } from "@/lib/dashboard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* OMZET-DASHBOARD — body:
   { date: "yyyy-mm-dd", adsSheetId, stores: [{ key, name, domain, currency,
     clientId, clientSecret, token }] }
   Geeft per store de gekozen dag + de dag ervoor (voor de +/- %). */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const stores = Array.isArray(body.stores) ? body.stores.filter((s) => s && s.domain) : [];
  if (!stores.length) return NextResponse.json({ error: "Geen stores aangevinkt" }, { status: 400 });
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : londonDay();
  const prev = addDays(ymd, -1);

  const results = await Promise.all(
    stores.map((s) =>
      storeDays(s, ymd, prev, body.adsSheetId).catch((e) => ({
        key: s.key || "", name: s.name, domain: s.domain, errors: [String(e.message || e)],
        day: null, prev: null,
      }))
    )
  );
  return NextResponse.json({ ok: true, date: ymd, prevDate: prev, today: londonDay(), stores: results, at: new Date().toISOString() });
}
