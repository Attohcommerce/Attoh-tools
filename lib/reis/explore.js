// BESTEMMING OPENEN — "alle opties" voor één bestemming (27-10-2026).
// 1. alle vluchten die aan de eisen voldoen (elke vertrekdag, elk vliegveld,
//    elke maatschappij), goedkoopste eerst, incl. bagage + reiskosten
// 2. alle hotels voor de gekozen datums (standaard: de goedkoopste vlucht),
//    met foto's, sterren, review, maaltijd, zwembad en AI-fotoscore
import { DEST_BY_ID, ORIGIN_BY_CODE, isLongHaul } from "./destinations.js";
import { airlineName, airlineTier, bagCostFor2, ULCC } from "./airlines.js";
import { tpRoundTrips, hasTravelpayouts } from "./flights.js";
import { findHotels, hotelDetails, hasLiteApi, BOARD_LABEL } from "./hotels.js";
import { scoreHotels, hasVision } from "./vision.js";
import { flightLinks, hotelLinks } from "./links.js";
import { normalizeSearch, dateRules, maxStopsFor } from "./engine.js";

const DAY = 86400000;
const nightsBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / DAY);

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch { out[k] = null; }
    }
  }));
  return out;
}

export async function exploreFlights(rawSearch, destId) {
  const q = normalizeSearch(rawSearch);
  const d = DEST_BY_ID[destId];
  if (!d) throw new Error("Onbekende bestemming");
  if (!hasTravelpayouts()) return { flights: [], live: false };
  const { months, ok } = dateRules(q);
  const long = isLongHaul(d);
  const maxStops = maxStopsFor(q, long);
  const direct = maxStops === 0;
  const jobs = [];
  for (const m of months) for (const o of q.origins) for (const a of d.iata.slice(0, 2)) jobs.push({ m, o, a });
  const rows = await pool(jobs, 12, (j) => tpRoundTrips(j.o, j.a, j.m, direct).then((r) => r.map((x) => ({ ...x, origin: j.o }))));
  const best = new Map();
  let checked = 0;
  for (const list of rows) {
    for (const r of list || []) {
      checked++;
      if (r.stopsOut > maxStops || r.stopsBack > maxStops) continue;
      if (q.flight.noUlcc && ULCC.includes(r.airline)) continue;
      if (!ok(r.depart, r.ret)) continue;
      const bag = q.flight.bags ? bagCostFor2(r.airline, long) : 0;
      const toAirport = ORIGIN_BY_CODE[r.origin].toAirport;
      const cost = Math.round(r.pricePP * 2 + bag + toAirport);
      const key = `${r.origin}|${r.depart}|${r.ret}`;
      const prev = best.get(key);
      if (prev && prev.cost <= cost) continue;
      best.set(key, {
        id: key,
        origin: r.origin, originName: ORIGIN_BY_CODE[r.origin].short, airport: r.dest,
        depart: r.depart, ret: r.ret, nights: nightsBetween(r.depart, r.ret),
        departTime: r.departTime, returnTime: r.returnTime,
        airline: r.airline, airlineName: airlineName(r.airline), tier: airlineTier(r.airline),
        stopsOut: r.stopsOut, stopsBack: r.stopsBack,
        ticket: Math.round(r.pricePP * 2), bag, toAirport, cost,
        links: flightLinks({ origin: r.origin, dest: r.dest, depart: r.depart, ret: r.ret, direct: r.stopsOut === 0 && r.stopsBack === 0, aviasalesPath: r.link }),
      });
    }
  }
  const flights = [...best.values()].sort((a, b) => a.cost - b.cost).slice(0, 60);
  return { flights, live: true, checked };
}

export async function exploreHotels(rawSearch, destId, checkin, checkout) {
  const q = normalizeSearch(rawSearch);
  const d = DEST_BY_ID[destId];
  if (!d) throw new Error("Onbekende bestemming");
  const nights = nightsBetween(checkin, checkout);
  const searchLinks = hotelLinks({ city: d.lite, checkin, checkout, minStars: q.hotel.minStars, pool: q.hotel.pool, minReview: q.hotel.minReview, board: q.hotel.board });
  if (!hasLiteApi()) return { hotels: [], live: false, searchLinks, nights };
  const { hotels } = await findHotels({ dest: d, checkin, checkout, minStars: q.hotel.minStars, minReview: q.hotel.minReview, board: q.hotel.board, limit: 20 });
  let list = hotels.slice(0, 30);
  const details = await pool(list, 6, (h) => hotelDetails(h.id));
  list = list.map((h, i) => ({ ...h, detail: details[i] }));
  if (q.hotel.pool) list = list.filter((h) => !h.detail || h.detail.pool);
  let scores = {};
  if (q.hotel.aiCheck && hasVision()) {
    scores = await scoreHotels(list.slice(0, 12).map((h) => ({ id: h.id, name: h.name, images: [h.photo, ...((h.detail && h.detail.images) || [])].filter(Boolean).slice(0, 3) })));
  }
  const out = list.map((h) => ({
    id: h.id, name: h.name, stars: h.stars, rating: h.rating, reviews: h.reviews, address: h.address,
    photos: [h.photo, ...((h.detail && h.detail.images) || [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8),
    price: h.price, perNight: Math.round(h.price / Math.max(1, nights)),
    board: h.board, boardLabel: BOARD_LABEL[h.board] || h.board, refundable: h.refundable,
    pool: h.detail ? h.detail.pool : null, beachfront: h.detail ? h.detail.beachfront : null,
    allInclusive: h.detail ? h.detail.allInclusive : null,
    ai: scores[h.id] || null,
    links: hotelLinks({ city: d.lite, hotelName: h.name, checkin, checkout, minStars: q.hotel.minStars, pool: q.hotel.pool, minReview: 0, board: q.hotel.board }),
  }));
  return { hotels: out, live: true, searchLinks, nights };
}
