// PRIJSALERT — draait dagelijks via Vercel Cron (vercel.json).
// Voor elke bewaarde reis met alert aan: zelfde route + datums opnieuw
// opvragen (Travelpayouts), prijs in de geschiedenis zetten, en bij een
// daling van ≥ 5% een mail sturen (als RESEND_API_KEY is ingesteld).
import { NextResponse } from "next/server";
import { listTrips, updateTrip } from "@/lib/reis/store";
import { tpRoundTrips, hasTravelpayouts } from "@/lib/reis/flights";
import { bagCostFor2 } from "@/lib/reis/airlines";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function mail(subject, html) {
  const key = process.env.RESEND_API_KEY;
  const to = (process.env.REIS_ALERT_TO || "justinattoh.veerman@gmail.com,quintygbr@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !to.length) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.REIS_ALERT_FROM || "Attoh Reisplanner <onboarding@resend.dev>", to, subject, html }),
  });
  return res.ok;
}

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  }
  if (!hasTravelpayouts()) return NextResponse.json({ ok: true, skipped: "Geen TRAVELPAYOUTS_TOKEN" });
  const trips = (await listTrips()).filter((t) => t.alert && t.status !== "geboekt" && t.result && !t.result.flight.estimate);
  const today = new Date().toISOString().slice(0, 10);
  const drops = [];
  for (const t of trips.slice(0, 40)) {
    const r = t.result;
    if (r.depart <= today) continue;
    try {
      const rows = await tpRoundTrips(r.origin, r.airport, r.depart.slice(0, 7), r.flight.stopsOut === 0 && r.flight.stopsBack === 0);
      const same = rows.filter((x) => x.depart === r.depart && x.ret === r.ret).sort((a, b) => a.pricePP - b.pricePP)[0];
      if (!same) continue;
      const long = r.hours > 6;
      const flightCost = Math.round(same.pricePP * 2 + (r.flight.bag ? bagCostFor2(same.airline, long) : 0) + r.flight.toAirport);
      const total = Math.round(flightCost + r.hotelTotal);
      const prev = (t.priceHistory || []).slice(-1)[0];
      await updateTrip(t.id, { pricePoint: { at: new Date().toISOString(), total } });
      if (prev && prev.total && total <= prev.total * 0.95) drops.push({ t, total, prev: prev.total });
    } catch (e) {
      console.error("alert", t.id, e.message);
    }
  }
  if (drops.length) {
    const rows = drops.map((d) => `<li><b>${d.t.result.city}</b> ${d.t.result.depart} → ${d.t.result.ret}: <b>€${d.total}</b> (was €${d.prev})</li>`).join("");
    await mail(`✈ Prijs gezakt: ${drops.map((d) => d.t.result.city).join(", ")}`, `<p>De prijs van ${drops.length} bewaarde reis/reizen is gezakt:</p><ul>${rows}</ul><p>Open de Reisplanner om te boeken.</p>`);
  }
  return NextResponse.json({ ok: true, checked: trips.length, drops: drops.length });
}
