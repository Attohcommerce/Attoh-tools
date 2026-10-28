// PRIJSKILLER! — een bewaarde reis opnieuw laten doorrekenen (28-10-2026).
// Basis = jullie hotel. Daaromheen zoekt hij:
//   A. zelfde hotel, andere data: maand ervoor / zelfde maand / maand erna,
//      en een paar nachten korter of langer (goedkopere vlucht of kamer)
//   B. vergelijkbaar hotel in de buurt (≤ 3 km, ≥ zelfde sterren, review
//      hooguit 0,3 lager), op dezelfde data
//   C. vergelijkbaar hotel in de buurt op de goedkoopste andere data
// Elke optie = volledige totaalprijs (vlucht 2p + bagage + reis naar
// vliegveld + hotel), vergeleken met wat jullie nu hebben.
import { DEST_BY_ID, ORIGIN_BY_CODE, isLongHaul } from "./destinations.js";
import { airlineName, bagCostFor2, ULCC } from "./airlines.js";
import { tpRoundTrips, hasTravelpayouts } from "./flights.js";
import { cityHotels, findHotels, hotelRate, hasLiteApi, BOARD_LABEL } from "./hotels.js";
import { flightLinks, hotelLinks } from "./links.js";
import { normalizeSearch, maxStopsFor } from "./engine.js";

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const nightsBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / DAY);
const monthAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); return iso(Date.UTC(y, m - 1 + n, 1)).slice(0, 7); };

function km(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out;
}

export async function priceKill(trip) {
  const r = trip.result;
  const dest = DEST_BY_ID[r.destId];
  if (!dest) throw new Error("Onbekende bestemming");
  if (!hasTravelpayouts() || !hasLiteApi()) throw new Error("De Prijskiller heeft live vlucht- en hotelprijzen nodig (Travelpayouts + LiteAPI).");
  if (!r.hotel || !r.hotel.id) throw new Error("Bij deze reis is nog geen echt hotel gekozen. Open de bestemming en kies eerst een hotel.");
  const t0 = Date.now();
  const q = normalizeSearch(trip.search || {});
  const long = isLongHaul(dest);
  const maxStops = maxStopsFor(q, long);
  const board = q.hotel.board;
  const bags = r.flight && r.flight.bag > 0 ? true : q.flight.bags;
  const today = iso(Date.now() + DAY);
  const baseNights = r.nights;
  const baseline = { total: r.total, flight: r.flight.cost, hotel: r.hotelTotal, nights: baseNights };

  // Origineel hotel (met coördinaten) uit de stadslijst
  const all = await cityHotels(dest.cc, dest.lite);
  const orig = all.find((h) => h.id === r.hotel.id) || { id: r.hotel.id, name: r.hotel.name, stars: r.hotel.stars, rating: r.hotel.rating, lat: r.hotel.lat, lng: r.hotel.lng };

  // 1. Vluchten: maand ervoor, zelfde maand, maand erna; vanaf het eigen
  //    vliegveld + de vertrekvelden uit de zoekopdracht
  const m0 = r.depart.slice(0, 7);
  const months = [monthAdd(m0, -1), m0, monthAdd(m0, 1)].filter((m) => m >= today.slice(0, 7));
  const origins = [...new Set([r.origin, ...q.origins])].slice(0, 5);
  const jobs = [];
  for (const m of months) for (const o of origins) jobs.push({ m, o });
  const rows = await pool(jobs, 10, (j) => tpRoundTrips(j.o, r.airport, j.m, maxStops === 0).then((x) => x.map((f) => ({ ...f, origin: j.o }))));
  const flights = new Map();
  for (const list of rows) for (const f of list || []) {
    if (f.depart < today) continue;
    if (f.stopsOut > maxStops || f.stopsBack > maxStops) continue;
    if (q.flight.noUlcc && ULCC.includes(f.airline)) continue;
    const n = nightsBetween(f.depart, f.ret);
    if (n < Math.max(3, baseNights - 3) || n > baseNights + 4) continue;
    const bag = bags ? bagCostFor2(f.airline, long) : 0;
    const cost = Math.round(f.pricePP * 2 + bag + ORIGIN_BY_CODE[f.origin].toAirport);
    const key = `${f.depart}|${f.ret}`;
    const prev = flights.get(key);
    if (!prev || cost < prev.cost) flights.set(key, { ...f, nights: n, bag, cost, toAirport: ORIGIN_BY_CODE[f.origin].toAirport });
  }
  // altijd de originele data meenemen (met de originele vluchtprijs als die niet in de lijst zit)
  const baseKey = `${r.depart}|${r.ret}`;
  if (!flights.has(baseKey)) flights.set(baseKey, { origin: r.origin, depart: r.depart, ret: r.ret, nights: baseNights, cost: r.flight.cost, bag: r.flight.bag, toAirport: r.flight.toAirport, pricePP: (r.flight.ticket || 0) / 2, airline: r.flight.airline, stopsOut: r.flight.stopsOut, stopsBack: r.flight.stopsBack, departTime: r.flight.departTime, returnTime: r.flight.returnTime, link: "" });

  // kandidaat-data: goedkoopste vlucht per nacht-aantal per maand + originele
  const fl = [...flights.values()].sort((a, b) => a.cost / a.nights - b.cost / b.nights);
  const picked = new Map([[baseKey, flights.get(baseKey)]]);
  const seen = new Set();
  for (const f of fl) {
    const k = `${f.depart.slice(0, 7)}|${f.nights}`;
    if (seen.has(k)) continue;
    seen.add(k);
    picked.set(`${f.depart}|${f.ret}`, f);
    if (picked.size >= 14) break;
  }
  const dateOpts = [...picked.values()];

  // 2. Zelfde hotel op al die data
  const sameRates = await pool(dateOpts, 5, (f) => hotelRate(orig.id, f.depart, f.ret, board));
  const options = [];
  const mk = (kind, f, h, hp) => {
    const total = Math.round(f.cost + hp.price);
    return {
      kind, depart: f.depart, ret: f.ret, nights: f.nights, origin: f.origin,
      flight: { cost: f.cost, ticket: Math.round((f.pricePP || 0) * 2), bag: f.bag, toAirport: f.toAirport, airline: f.airline, airlineName: airlineName(f.airline), stopsOut: f.stopsOut, stopsBack: f.stopsBack, departTime: f.departTime, returnTime: f.returnTime, link: f.link },
      hotel: { id: h.id, name: h.name, stars: h.stars, rating: h.rating, reviews: h.reviews, photo: h.photo, lat: h.lat, lng: h.lng, address: h.address, board: hp.board, boardLabel: hp.boardLabel, room: hp.room, refundable: hp.refundable, distKm: h.id === orig.id ? 0 : km(orig, h) },
      hotelTotal: hp.price, total, perNight: Math.round(total / f.nights),
      diff: total - baseline.total,
      diffPerNight: Math.round(total / f.nights - baseline.total / baseNights),
    };
  };
  dateOpts.forEach((f, i) => { if (sameRates[i]) options.push(mk("zelfde-hotel", f, orig, sameRates[i])); });

  // 3. Vergelijkbare hotels in de buurt: op de originele data + de 2 data
  //    met de goedkoopste vlucht per nacht
  const similar = (h) => h.id !== orig.id && (h.stars || 0) >= (orig.stars || 0) && (!orig.rating || !h.rating || h.rating >= orig.rating - 0.3) && (km(orig, h) == null || km(orig, h) <= 3);
  const nearbyDates = [flights.get(baseKey), ...fl.filter((f) => `${f.depart}|${f.ret}` !== baseKey).slice(0, 2)];
  const nearby = await pool(nearbyDates, 3, (f) => findHotels({ dest, checkin: f.depart, checkout: f.ret, minStars: Math.max(4, orig.stars || 4), minReview: Math.max(0, (orig.rating || 8) - 0.3), board, limit: 12 }));
  nearbyDates.forEach((f, i) => {
    const hs = ((nearby[i] && nearby[i].hotels) || []).filter(similar).slice(0, 4);
    for (const h of hs) options.push(mk(`${baseKey}` === `${f.depart}|${f.ret}` ? "ander-hotel" : "ander-hotel-andere-data", f, h, { price: h.price, board: h.board, boardLabel: BOARD_LABEL[h.board] || h.board, room: h.room, refundable: h.refundable }));
  });

  // 4. Labels + sorteren: echte besparingen eerst, dan "langer voor bijna niks"
  for (const o of options) {
    const extra = o.nights - baseNights;
    o.isBase = o.kind === "zelfde-hotel" && o.depart === r.depart && o.ret === r.ret;
    if (o.isBase) o.label = "Jullie huidige reis (opnieuw berekend)";
    else if (o.diff < 0 && extra === 0) o.label = "Zelfde lengte, goedkoper";
    else if (o.diff < 0 && extra > 0) o.label = `${extra} ${extra === 1 ? "nacht" : "nachten"} langer én goedkoper`;
    else if (o.diff < 0 && extra < 0) o.label = `${-extra} ${extra === -1 ? "nacht" : "nachten"} korter, goedkoper`;
    else if (extra > 0 && o.diffPerNight < 0 && o.diff <= 60 * extra) o.label = `${extra} ${extra === 1 ? "nacht" : "nachten"} langer voor maar ${o.diff <= 0 ? "€0" : "€" + o.diff} extra`;
    o.win = !o.isBase && (o.diff < 0 || (o.nights > baseNights && o.diffPerNight < 0 && o.diff <= 60 * (o.nights - baseNights)));
  }
  const base = options.find((o) => o.isBase) || null;
  const wins = options.filter((o) => o.win)
    .sort((a, b) => a.diff - b.diff || a.diffPerNight - b.diffPerNight)
    .filter((o, i, arr) => arr.findIndex((x) => x.hotel.id === o.hotel.id && x.depart === o.depart && x.ret === o.ret) === i)
    .slice(0, 12);

  // links + compleet result-object om de reis mee te vervangen
  const toResult = (o) => ({
    id: `${dest.id}-${o.depart}-${o.ret}-${o.origin}-${o.hotel.id}`,
    destId: dest.id, cc: dest.cc, city: dest.city, country: dest.country, tags: dest.tags, hours: dest.hours, beach: dest.beach,
    temp: dest.temp[new Date(o.depart + "T12:00:00Z").getUTCMonth()],
    origin: o.origin, originName: ORIGIN_BY_CODE[o.origin].short, airport: r.airport,
    depart: o.depart, ret: o.ret, nights: o.nights,
    flight: { estimate: false, ...o.flight },
    hotel: { ...o.hotel, place: o.hotel.id === r.hotel.id ? r.hotel.place || "" : "" },
    hotelTotal: o.hotelTotal, hotelEstimate: false,
    total: o.total, perPerson: Math.round(o.total / 2), alts: [],
    links: {
      flight: flightLinks({ origin: o.origin, dest: r.airport, depart: o.depart, ret: o.ret, direct: o.flight.stopsOut === 0 && o.flight.stopsBack === 0, aviasalesPath: o.flight.link }),
      hotel: hotelLinks({ city: dest.lite, hotelName: o.hotel.name, checkin: o.depart, checkout: o.ret, minStars: q.hotel.minStars, pool: q.hotel.pool, minReview: 0, board }),
      packages: [],
    },
  });
  return {
    baseline,
    base: base ? { ...base, result: toResult(base) } : null,
    options: wins.map((o) => ({ ...o, result: toResult(o) })),
    stats: { flightsChecked: rows.reduce((n, l) => n + ((l && l.length) || 0), 0), datesChecked: dateOpts.length, hotelsChecked: nearby.reduce((n, x) => n + ((x && x.hotels && x.hotels.length) || 0), 0) + dateOpts.length, months, ms: Date.now() - t0 },
  };
}
