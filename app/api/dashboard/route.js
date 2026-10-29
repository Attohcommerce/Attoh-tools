import { NextResponse } from "next/server";
import { storeRange, londonDay, addDays } from "@/lib/dashboard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SPAN = 14; // dagen in de trendgrafiek

/* OMZET-DASHBOARD — body:
   { date: "yyyy-mm-dd", adsSheetId, stores: [{ key, name, domain, currency,
     clientId, clientSecret, token }] }
   Geeft per store de laatste 14 dagen t/m de gekozen dag (omzet £, orders,
   sessies, Google Ads) en de omzet per uur voor de gekozen dag en de dag ervoor. */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const stores = Array.isArray(body.stores) ? body.stores.filter((s) => s && s.domain) : [];
  if (!stores.length) return NextResponse.json({ error: "Geen stores aangevinkt" }, { status: 400 });
  const today = londonDay();
  let ymd = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : today;
  if (ymd > today) ymd = today;
  const prev = addDays(ymd, -1);
  const from = addDays(ymd, -(SPAN - 1));

  const results = await Promise.all(
    stores.map((s) =>
      storeRange(s, from, ymd, prev, body.adsSheetId).catch((e) => ({
        key: s.key || "", name: s.name, domain: s.domain, errors: [String(e.message || e)], days: {}, hours: {},
      }))
    )
  );
  return NextResponse.json({
    ok: true, date: ymd, prevDate: prev, from, today,
    nowHour: Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date())) % 24,
    stores: results, at: new Date().toISOString(),
  });
}
