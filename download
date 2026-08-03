import { NextResponse } from "next/server";

export const maxDuration = 15;

// Gratis wisselkoersen (geen key nodig). Basis USD; kruislings omrekenen.
let cache = { at: 0, rates: null };

export async function GET() {
  const now = Date.now();
  if (cache.rates && now - cache.at < 1000 * 60 * 60 * 6) {
    return NextResponse.json({ ok: true, rates: cache.rates, cached: true });
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    if (data && data.result === "success" && data.rates) {
      cache = { at: now, rates: data.rates };
      return NextResponse.json({ ok: true, rates: data.rates });
    }
    throw new Error("Geen rates in antwoord");
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "Wisselkoersen niet beschikbaar: " + String(e.message || e) },
      { status: 502 }
    );
  }
}
