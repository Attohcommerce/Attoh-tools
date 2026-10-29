// HOTELS — LiteAPI (liteapi.travel). Env var: LITEAPI_KEY.
// Eén key geeft live kamerprijzen van honderden aanbieders (vergelijkbaar
// met wat Booking/Expedia tonen), plus hotelgegevens, faciliteiten en foto's.
// Sandbox-key (sand_…) werkt ook, maar geeft testprijzen.
//
// Stroom per bestemming + datums:
//   1. hotellijst van de stad → lokaal filteren op sterren + reviewscore
//   2. live prijzen voor de beste ±60 hotels in één call
//   3. details (faciliteiten + foto's) voor de goedkoopste kandidaten
//      → zwembad-check + AI-fotocheck (vision.js)
import { cached } from "./store.js";

const BASE = "https://api.liteapi.travel/v3.0";

export function hasLiteApi() {
  return Boolean(String(process.env.LITEAPI_KEY || "").trim());
}

async function lite(path, { method = "GET", body, timeoutMs = 12000 } = {}) {
  const key = String(process.env.LITEAPI_KEY || "").trim();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { "X-API-Key": key, accept: "application/json", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(`LiteAPI ${res.status}: ${(json && json.error && (json.error.message || json.error)) || text.slice(0, 140)}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function cityHotels(cc, city) {
  return cached(`lite:hotels:${cc}:${city}`, 60 * 60 * 24 * 7, async () => {
    const qs = new URLSearchParams({ countryCode: cc, cityName: city, limit: "300" });
    const json = await lite(`/data/hotels?${qs}`);
    const rows = (json && json.data) || [];
    return rows.map((h) => ({
      id: h.id,
      name: h.name,
      stars: num(h.stars ?? h.starRating) || 0,
      rating: num(h.rating) || 0, // 0–10
      reviews: num(h.reviewCount) || 0,
      photo: h.main_photo || h.thumbnail || "",
      address: h.address || "",
      lat: num(h.latitude),
      lng: num(h.longitude),
      desc: String(h.hotelDescription || "").replace(/<[^>]+>/g, " ").slice(0, 600),
    }));
  });
}

export async function hotelDetails(id) {
  return cached(`lite:detail:${id}`, 60 * 60 * 24 * 30, async () => {
    const json = await lite(`/data/hotel?hotelId=${encodeURIComponent(id)}`);
    const h = (json && json.data) || {};
    const facilities = [
      ...(Array.isArray(h.hotelFacilities) ? h.hotelFacilities : []),
      ...(Array.isArray(h.facilities) ? h.facilities.map((f) => f && (f.name || f.facility)) : []),
    ].filter(Boolean).map(String);
    const images = (Array.isArray(h.hotelImages) ? h.hotelImages : [])
      .map((i) => i && (i.urlHd || i.url))
      .filter(Boolean)
      .slice(0, 12);
    const desc = String(h.hotelDescription || "").replace(/<[^>]+>/g, " ");
    return {
      facilities: facilities.slice(0, 80),
      images,
      pool: /pool|zwembad|piscina|swimming/i.test(facilities.join(" ") + " " + desc),
      allInclusive: /all[\s-]?inclusive/i.test(facilities.join(" ") + " " + desc),
      beachfront: /beach ?front|on the beach|aan het strand|private beach|beach access/i.test(facilities.join(" ") + " " + desc),
    };
  });
}

// boardType-codes van LiteAPI: RO kamer · BB ontbijt · HB halfpension ·
// FB volpension · AI all-inclusive
const BOARD_OK = {
  geen: null,
  ontbijt: ["BB", "HB", "FB", "AI"],
  halfpension: ["HB", "FB", "AI"],
  allin: ["AI"],
};
export const BOARD_LABEL = { RO: "Alleen kamer", BB: "Ontbijt", HB: "Halfpension", FB: "Volpension", AI: "All-inclusive" };

function rateAmount(r) {
  const tot = r && r.retailRate && r.retailRate.total;
  if (Array.isArray(tot) && tot[0]) return num(tot[0].amount);
  if (tot && tot.amount) return num(tot.amount);
  return null;
}

// Hoofdfunctie: beste hotels voor één bestemming + datums.
export async function findHotels({ dest, checkin, checkout, minStars = 4, minReview = 8, board = "geen", limit = 8, poolSize = 60 }) {
  if (!hasLiteApi()) return { hotels: [], source: "none" };
  const all = await cityHotels(dest.cc, dest.lite);
  let pool = all.filter((h) => h.stars >= minStars && (h.rating === 0 || h.rating >= minReview));
  pool.sort((a, b) => b.rating * Math.log10(10 + b.reviews) - a.rating * Math.log10(10 + a.reviews));
  pool = pool.slice(0, poolSize);
  if (!pool.length) return { hotels: [], source: "liteapi", note: "Geen hotels gevonden met deze eisen" };

  const ratesKey = `lite:rates:${dest.id}:${checkin}:${checkout}:${minStars}:${minReview}:${poolSize}`;
  const rates = await cached(ratesKey, 60 * 60 * 2, async () => {
    const json = await lite("/hotels/rates", {
      method: "POST",
      body: {
        hotelIds: pool.map((h) => h.id),
        occupancies: [{ adults: 2 }],
        currency: "EUR",
        guestNationality: "NL",
        checkin,
        checkout,
        timeout: poolSize > 60 ? 12 : 8,
      },
      timeoutMs: poolSize > 60 ? 28000 : 20000,
    });
    const out = {};
    for (const row of (json && json.data) || []) {
      const opts = [];
      for (const rt of row.roomTypes || []) {
        const r0 = (rt.rates || [])[0] || {};
        const amount = num(rt.offerRetailRate && rt.offerRetailRate.amount) || rateAmount(r0);
        if (!amount) continue;
        opts.push({
          amount,
          board: String(r0.boardType || "RO").toUpperCase(),
          room: r0.name || "",
          refundable: r0.cancellationPolicies && r0.cancellationPolicies.refundableTag === "RFN",
        });
      }
      if (opts.length) out[row.hotelId] = opts;
    }
    return out;
  });

  const okBoards = BOARD_OK[board] || null;
  const priced = [];
  for (const h of pool) {
    const opts = (rates[h.id] || []).filter((o) => !okBoards || okBoards.includes(o.board));
    if (!opts.length) continue;
    opts.sort((a, b) => a.amount - b.amount);
    // goedkoopste prijs per maaltijdsoort ("met ontbijt +€80")
    const boards = {};
    for (const o of rates[h.id] || []) if (!boards[o.board] || o.amount < boards[o.board]) boards[o.board] = Math.round(o.amount);
    const cheapRefund = opts.find((o) => o.refundable);
    priced.push({
      ...h, price: Math.round(opts[0].amount), board: opts[0].board, room: opts[0].room, refundable: opts[0].refundable,
      boards, rooms: opts.length, refundPrice: cheapRefund ? Math.round(cheapRefund.amount) : null,
    });
  }
  priced.sort((a, b) => a.price - b.price);
  return { hotels: priced.slice(0, limit * 2), source: "liteapi" };
}

// Reviews + samenvatting (pluspunten/minpunten) van echte gasten.
// LiteAPI: GET /data/reviews?hotelId=…&getSentiment=true
export async function hotelReviews(id) {
  if (!hasLiteApi()) return { reviews: [], pros: [], cons: [] };
  return cached(`lite:reviews:${id}`, 60 * 60 * 24 * 7, async () => {
    const qs = new URLSearchParams({ hotelId: id, limit: "6", getSentiment: "true", timeout: "6" });
    const json = await lite(`/data/reviews?${qs}`, { timeoutMs: 15000 });
    const rows = (json && Array.isArray(json.data) && json.data) || [];
    const sent = (json && (json.sentimentAnalysis || json.sentiment_analysis || (json.data && json.data.sentimentAnalysis))) || {};
    const listOf = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x && (x.text || x.name || x.description))).filter(Boolean) : []);
    const cats = Array.isArray(sent.categories)
      ? sent.categories.map((c) => ({ name: c.name || c.category, rating: num(c.rating ?? c.score) })).filter((c) => c.name).slice(0, 6)
      : [];
    return {
      pros: listOf(sent.pros).slice(0, 5),
      cons: listOf(sent.cons).slice(0, 4),
      categories: cats,
      reviews: rows.slice(0, 5).map((r) => ({
        score: num(r.averageScore ?? r.score ?? r.rating),
        name: r.name || "",
        country: r.country || "",
        type: r.type || "",
        date: String(r.date || "").slice(0, 10),
        headline: String(r.headline || r.title || "").slice(0, 140),
        pros: String(r.pros || "").slice(0, 300),
        cons: String(r.cons || "").slice(0, 300),
      })),
    };
  });
}

// Prijs van één specifiek hotel voor bepaalde data (goedkoopste kamer die
// past bij de maaltijd-eis). Voor de Prijskiller.
export async function hotelRate(hotelId, checkin, checkout, board = "geen") {
  if (!hasLiteApi()) return null;
  const key = `lite:rate1:${hotelId}:${checkin}:${checkout}`;
  const opts = await cached(key, 60 * 60 * 2, async () => {
    const json = await lite("/hotels/rates", {
      method: "POST",
      timeoutMs: 15000,
      body: { hotelIds: [hotelId], occupancies: [{ adults: 2 }], currency: "EUR", guestNationality: "NL", checkin, checkout, timeout: 6 },
    });
    const out = [];
    for (const row of (json && json.data) || []) {
      for (const rt of row.roomTypes || []) {
        const r0 = (rt.rates || [])[0] || {};
        const amount = num(rt.offerRetailRate && rt.offerRetailRate.amount) || rateAmount(r0);
        if (amount) out.push({ amount, board: String(r0.boardType || "RO").toUpperCase(), room: r0.name || "", refundable: r0.cancellationPolicies && r0.cancellationPolicies.refundableTag === "RFN" });
      }
    }
    return out;
  });
  const okBoards = BOARD_OK[board] || null;
  const list = (opts || []).filter((o) => !okBoards || okBoards.includes(o.board)).sort((a, b) => a.amount - b.amount);
  if (!list.length) return null;
  return { price: Math.round(list[0].amount), board: list[0].board, boardLabel: BOARD_LABEL[list[0].board] || list[0].board, room: list[0].room, refundable: list[0].refundable };
}
