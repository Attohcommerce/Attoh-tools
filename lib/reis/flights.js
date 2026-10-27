// VLUCHTEN — twee bronnen, allebei optioneel (env vars in Vercel):
//
// 1. TRAVELPAYOUTS_TOKEN (gratis, travelpayouts.com → Aviasales Data API)
//    = de "breedte": goedkoopste gevonden retourprijzen per route per maand,
//    honderden routes binnen een paar seconden. Prijzen komen uit de cache
//    van echte zoekopdrachten (meestal < 48 uur oud) en zijn per persoon,
//    meestal ZONDER ruimbagage → die tellen we er zelf bij (airlines.js).
//
// 2. DUFFEL_TOKEN (duffel.com, zoeken gratis) = de "diepte": live prijs
//    van de beste kandidaten mét bagage-info en exacte vluchttijden.
//    Wordt alleen gebruikt voor de top van de lijst.
import { cached } from "./store.js";

const TP_BASE = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";

export function hasTravelpayouts() {
  return Boolean(String(process.env.TRAVELPAYOUTS_TOKEN || "").trim());
}
export function hasDuffel() {
  return Boolean(String(process.env.DUFFEL_TOKEN || "").trim());
}

async function fetchJson(url, opts = {}, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const msg = (json && (json.error || json.message || (json.errors && json.errors[0] && json.errors[0].message))) || text.slice(0, 160);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

// Eén route, één vertrekmaand ("2026-12"). direct=true → alleen non-stop.
// Geeft genormaliseerde retourvluchten terug.
export async function tpRoundTrips(origin, dest, month, direct) {
  const token = String(process.env.TRAVELPAYOUTS_TOKEN || "").trim();
  if (!token) return [];
  const key = `tp:${origin}:${dest}:${month}:${direct ? 1 : 0}`;
  return cached(key, 60 * 60 * 3, async () => {
    const qs = new URLSearchParams({
      origin,
      destination: dest,
      departure_at: month,
      one_way: "false",
      direct: direct ? "true" : "false",
      currency: "eur",
      sorting: "price",
      unique: "false",
      limit: "1000",
      page: "1",
      market: "nl",
      token,
    });
    const json = await fetchJson(`${TP_BASE}?${qs}`, { headers: { "Accept-Encoding": "gzip" } });
    const rows = (json && Array.isArray(json.data) && json.data) || [];
    return rows
      .filter((r) => r && r.departure_at && r.return_at && r.price)
      .map((r) => ({
        source: "travelpayouts",
        origin: r.origin_airport || r.origin || origin,
        dest: r.destination_airport || r.destination || dest,
        depart: String(r.departure_at).slice(0, 10),
        ret: String(r.return_at).slice(0, 10),
        departTime: String(r.departure_at).slice(11, 16),
        returnTime: String(r.return_at).slice(11, 16),
        pricePP: Number(r.price),
        airline: r.airline || "",
        flightNumber: r.flight_number ? `${r.airline || ""}${r.flight_number}` : "",
        stopsOut: Number(r.transfers || 0),
        stopsBack: Number(r.return_transfers || 0),
        durationOut: Number(r.duration_to || 0), // minuten
        durationBack: Number(r.duration_back || 0),
        link: r.link || "",
      }));
  });
}

// Live check van één combinatie via Duffel. Geeft de goedkoopste aanbieding
// met minimaal 1 ingecheckte koffer (of de goedkoopste zonder + vlag).
export async function duffelCheck({ origin, dest, depart, ret, maxConnections }) {
  const token = String(process.env.DUFFEL_TOKEN || "").trim();
  if (!token) return null;
  const key = `duffel:${origin}:${dest}:${depart}:${ret}:${maxConnections}`;
  return cached(key, 60 * 30, async () => {
    const body = {
      data: {
        slices: [
          { origin, destination: dest, departure_date: depart },
          { origin: dest, destination: origin, departure_date: ret },
        ],
        passengers: [{ type: "adult" }, { type: "adult" }],
        cabin_class: "economy",
        max_connections: maxConnections,
      },
    };
    const json = await fetchJson(
      "https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=12000",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Duffel-Version": "v2",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
      20000
    );
    const offers = (json && json.data && json.data.offers) || [];
    if (!offers.length) return { none: true };
    const norm = offers.map((o) => {
      const slices = o.slices || [];
      const checked = slices.every((s) =>
        (s.segments || []).every((seg) =>
          (seg.passengers || []).every((p) =>
            (p.baggages || []).some((b) => b.type === "checked" && Number(b.quantity) > 0)
          )
        )
      );
      const seg0 = (slices[0] && slices[0].segments) || [];
      const seg1 = (slices[1] && slices[1].segments) || [];
      return {
        total: Number(o.total_amount),
        currency: o.total_currency,
        airline: (o.owner && o.owner.iata_code) || "",
        airlineName: (o.owner && o.owner.name) || "",
        checkedBag: checked,
        stopsOut: Math.max(0, seg0.length - 1),
        stopsBack: Math.max(0, seg1.length - 1),
        departTime: seg0[0] ? String(seg0[0].departing_at).slice(11, 16) : "",
        returnTime: seg1[0] ? String(seg1[0].departing_at).slice(11, 16) : "",
      };
    }).filter((o) => o.currency === "EUR" || !o.currency);
    norm.sort((a, b) => a.total - b.total);
    const withBag = norm.find((o) => o.checkedBag);
    return { best: norm[0] || null, bestWithBag: withBag || null };
  });
}
