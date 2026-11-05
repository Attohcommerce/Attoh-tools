import { NextResponse } from "next/server";
import { storeRange, londonDay, addDays } from "@/lib/dashboard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SPAN = 14; // dagen in de trendgrafiek (dag-modus)
const MAX_RANGE = 92; // langste periode (periode-modus)

/* OMZET-DASHBOARD — body:
   { date: "yyyy-mm-dd", adsSheetId, stores: [{ key, name, domain, currency,
     clientId, clientSecret, token }] }
   Geeft per store de laatste 14 dagen t/m de gekozen dag (omzet £, orders,
   sessies, Google Ads) en de omzet per uur voor de gekozen dag en de dag ervoor.

   PERIODE (05-11-2026): body { range: { from, to }, … } → per store alle dagen
   van de periode én van de even lange periode ervoor (voor de vergelijking).
   Antwoord: { mode: "range", from, to, prevFrom, prevTo, … }. */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const stores = Array.isArray(body.stores) ? body.stores.filter((s) => s && s.domain) : [];
  if (!stores.length) return NextResponse.json({ error: "Geen stores aangevinkt" }, { status: 400 });
  const today = londonDay();
  const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

  /* ---------- periode ---------- */
  if (body.range && isYmd(body.range.from) && isYmd(body.range.to)) {
    let from = body.range.from;
    let to = body.range.to;
    if (to > today) to = today;
    if (from > to) from = to;
    const len = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (len > MAX_RANGE) from = addDays(to, -(MAX_RANGE - 1));
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(Math.round((Date.parse(to) - Date.parse(from)) / 86400000)));
    const results = await Promise.all(
      stores.map((s) =>
        storeRange(s, prevFrom, to, addDays(to, -1), body.adsSheetId).catch((e) => ({
          key: s.key || "", name: s.name, domain: s.domain, errors: [String(e.message || e)], days: {}, hours: {},
        }))
      )
    );
    return NextResponse.json({
      ok: true, mode: "range", from, to, prevFrom, prevTo, today,
      // zelfde velden als de dag-modus, zodat bestaande code niet struikelt
      date: to, prevDate: addDays(to, -1),
      nowHour: Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date())) % 24,
      nowMinute: new Date().getUTCMinutes(),
      stores: results, at: new Date().toISOString(),
    });
  }

  /* ---------- dag ---------- */
  let ymd = isYmd(body.date) ? body.date : today;
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
    ok: true, mode: "day", date: ymd, prevDate: prev, from, today,
    nowHour: Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date())) % 24,
    nowMinute: new Date().getUTCMinutes(),
    stores: results, at: new Date().toISOString(),
  });
}
