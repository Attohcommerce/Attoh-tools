// BESTEMMING OPENEN — "alle opties" voor één bestemming (27-10-2026).
// 1. alle vluchten die aan de eisen voldoen (elke vertrekdag, elk vliegveld,
//    elke maatschappij), goedkoopste eerst, incl. bagage + reiskosten
// 2. alle hotels voor de gekozen datums (standaard: de goedkoopste vlucht),
//    met foto's, sterren, review, maaltijd, zwembad en AI-fotoscore
import { DEST_BY_ID, ORIGINS, ORIGIN_BY_CODE, isLongHaul } from "./destinations.js";
import { airlineName, airlineTier, bagCostFor2, ULCC } from "./airlines.js";
import { tpRoundTrips, tpOneWays, tpLatest, hasTravelpayouts } from "./flights.js";
import { findHotels, hotelDetails, hasLiteApi, BOARD_LABEL } from "./hotels.js";
import { scoreHotels, hasVision } from "./vision.js";
import { flightLinks, oneWayLinks, hotelLinks } from "./links.js";
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

export async function exploreFlights(rawSearch, destId, opts = {}) {
  const q = normalizeSearch(rawSearch);
  const d = DEST_BY_ID[destId];
  if (!d) throw new Error("Onbekende bestemming");
  if (!hasTravelpayouts()) return { flights: [], live: false };
  const { months, ok } = dateRules(q);
  const long = isLongHaul(d);
  const maxStops = maxStopsFor(q, long);
  const direct = maxStops === 0;
  // "wide" = ook de verdere vliegvelden (Weeze, Keulen, Charleroi …)
  const origins = opts.wide ? ORIGINS.map((o) => o.code) : q.origins;
  const airports = d.iata;
  const bagRT = (code) => (q.flight.bags ? bagCostFor2(code, long) : 0);
  const bagOW = (code) => Math.round(bagRT(code) / 2);
  const stats = { sources: 0, rows: 0 };

  // 1. retourvluchten uit 3 bronnen: alleen direct, alles (incl. overstap),
  //    en de "laatst gevonden" prijzen. Plus enkele reizen heen en terug.
  const rtJobs = [], owJobs = [];
  for (const m of months) for (const o of origins) for (const a of airports) {
    rtJobs.push({ m, o, a, kind: "rt", direct: true });
    rtJobs.push({ m, o, a, kind: "rt", direct: false });
    rtJobs.push({ m, o, a, kind: "latest" });
    owJobs.push({ m, from: o, to: a, dir: "out" });
    owJobs.push({ m, from: a, to: o, dir: "back" });
  }
  // terugvluchten kunnen in de maand ná de laatste vertrekmaand vallen
  const lastM = months[months.length - 1];
  if (lastM) {
    const [y, mo] = lastM.split("-").map(Number);
    const next = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, "0")}`;
    for (const o of origins) for (const a of airports) owJobs.push({ m: next, from: a, to: o, dir: "back" });
  }
  const [rtRows, owRows] = await Promise.all([
    pool(rtJobs, 14, (j) => (j.kind === "latest" ? tpLatest(j.o, j.a, j.m) : tpRoundTrips(j.o, j.a, j.m, j.direct)).then((r) => r.map((x) => ({ ...x, origin: j.o, dest: j.a })))),
    pool(owJobs, 14, (j) => tpOneWays(j.from, j.to, j.m, direct).then((r) => r.map((x) => ({ ...x, dir: j.dir, from: j.from, to: j.to })))),
  ]);
  stats.sources = rtJobs.length + owJobs.length;

  const best = new Map();
  const put = (f) => {
    const prev = best.get(f.id);
    if (prev && prev.cost <= f.cost) return;
    best.set(f.id, f);
  };
  let checked = 0;
  for (const list of rtRows) {
    for (const r of list || []) {
      checked++;
      if (r.stopsOut > maxStops || r.stopsBack > maxStops) continue;
      if (q.flight.noUlcc && ULCC.includes(r.airline)) continue;
      if (!ok(r.depart, r.ret)) continue;
      const bag = bagRT(r.airline);
      const toAirport = ORIGIN_BY_CODE[r.origin].toAirport;
      const cost = Math.round(r.pricePP * 2 + bag + toAirport);
      put({
        id: `${r.origin}|${r.dest}|${r.depart}|${r.ret}|rt`,
        kind: "retour",
        origin: r.origin, originName: ORIGIN_BY_CODE[r.origin].short, backTo: r.origin, backToName: ORIGIN_BY_CODE[r.origin].short, airport: r.dest,
        depart: r.depart, ret: r.ret, nights: nightsBetween(r.depart, r.ret),
        departTime: r.departTime, returnTime: r.returnTime,
        airline: r.airline, airlineName: r.airline ? airlineName(r.airline) : "Zie boeksite", tier: airlineTier(r.airline),
        flightNumber: r.flightNumber || "",
        stopsOut: r.stopsOut, stopsBack: r.stopsBack,
        ticket: Math.round(r.pricePP * 2), bag, toAirport, cost, source: r.source,
        mk: () => ({ links: flightLinks({ origin: r.origin, dest: r.dest, depart: r.depart, ret: r.ret, direct: r.stopsOut === 0 && r.stopsBack === 0, aviasalesPath: r.link, airline: r.airline }) }),
      });
    }
  }

  // 2. twee losse enkele reizen combineren (ook: heen vanaf Eindhoven, terug
  //    op Schiphol). Per dag alleen de goedkoopste per vliegveld-paar.
  const outs = new Map(), backs = new Map();
  for (const list of owRows) {
    for (const r of list || []) {
      checked++;
      if (r.stops > maxStops) continue;
      if (q.flight.noUlcc && ULCC.includes(r.airline)) continue;
      const nlAirport = r.dir === "out" ? r.from : r.to;
      const k = `${nlAirport}|${r.dir === "out" ? r.to : r.from}|${r.date}`;
      const map = r.dir === "out" ? outs : backs;
      const cur = map.get(k);
      const c = r.pricePP * 2 + bagOW(r.airline);
      if (!cur || c < cur.c) map.set(k, { ...r, c, nl: nlAirport, far: r.dir === "out" ? r.to : r.from });
    }
  }
  const backList = [...backs.values()];
  for (const out of outs.values()) {
    for (const bk of backList) {
      if (bk.date <= out.date) continue;
      if (!ok(out.date, bk.date)) continue;
      const toAirport = Math.round((ORIGIN_BY_CODE[out.nl].toAirport + ORIGIN_BY_CODE[bk.nl].toAirport) / 2);
      const bag = bagOW(out.airline) + bagOW(bk.airline);
      const ticket = Math.round((out.pricePP + bk.pricePP) * 2);
      const cost = ticket + bag + toAirport;
      const same = out.nl === bk.nl;
      put({
        id: `${out.nl}|${out.far}|${out.date}|${bk.date}|${same ? "rt" : bk.nl}`,
        kind: "los",
        origin: out.nl, originName: ORIGIN_BY_CODE[out.nl].short, backTo: bk.nl, backToName: ORIGIN_BY_CODE[bk.nl].short, airport: out.far,
        depart: out.date, ret: bk.date, nights: nightsBetween(out.date, bk.date),
        departTime: out.time, returnTime: bk.time,
        airline: out.airline, airlineName: out.airline === bk.airline ? airlineName(out.airline) : `${airlineName(out.airline)} + ${airlineName(bk.airline)}`,
        tier: Math.max(airlineTier(out.airline), airlineTier(bk.airline)),
        stopsOut: out.stops, stopsBack: bk.stops,
        ticket, bag, toAirport, cost, source: "oneway",
        mk: () => ({ legs: [
          { dir: "Heen", from: out.nl, to: out.far, date: out.date, time: out.time, airline: out.airline, airlineName: airlineName(out.airline), flightNumber: out.flightNumber, pricePP: out.pricePP, stops: out.stops,
            links: oneWayLinks({ from: out.nl, to: out.far, date: out.date, direct: out.stops === 0, aviasalesPath: out.link, airline: out.airline }) },
          { dir: "Terug", from: bk.far, to: bk.nl, date: bk.date, time: bk.time, airline: bk.airline, airlineName: airlineName(bk.airline), flightNumber: bk.flightNumber, pricePP: bk.pricePP, stops: bk.stops,
            links: oneWayLinks({ from: bk.far, to: bk.nl, date: bk.date, direct: bk.stops === 0, aviasalesPath: bk.link, airline: bk.airline }) },
        ],
        links: flightLinks({ origin: out.nl, dest: out.far, depart: out.date, ret: bk.date, direct: out.stops === 0 && bk.stops === 0, airline: out.airline }) }),
      });
    }
  }

  const all = [...best.values()].sort((a, b) => a.cost - b.cost);
  // per vertrek+terugdag+vliegveld alleen de goedkoopste variant tonen
  const seen = new Set();
  const flights = [];
  for (const f of all) {
    const k = `${f.origin}|${f.backTo}|${f.depart}|${f.ret}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const { mk, ...rest } = f;
    flights.push({ ...rest, ...mk() });
    if (flights.length >= 400) break;
  }
  if (flights.length) flights[0].cheapest = true;
  const losCount = flights.filter((f) => f.kind === "los").length;
  return { flights, live: true, checked, sources: stats.sources, losCount, origins };
}

export async function exploreHotels(rawSearch, destId, checkin, checkout, opts = {}) {
  const q = normalizeSearch(rawSearch);
  const d = DEST_BY_ID[destId];
  if (!d) throw new Error("Onbekende bestemming");
  const nights = nightsBetween(checkin, checkout);
  // "ruimer" = ook 7,5+ reviews en hotels zonder bevestigd zwembad
  const minReview = opts.wide ? Math.min(q.hotel.minReview, 7.5) : q.hotel.minReview;
  const searchLinks = hotelLinks({ city: d.lite, checkin, checkout, minStars: q.hotel.minStars, pool: q.hotel.pool, minReview: q.hotel.minReview, board: q.hotel.board });
  if (!hasLiteApi()) return { hotels: [], live: false, searchLinks, nights };
  const { hotels } = await findHotels({ dest: d, checkin, checkout, minStars: q.hotel.minStars, minReview, board: q.hotel.board, limit: 60, poolSize: 150 });
  let list = hotels.slice(0, 120);
  const DETAIL_N = 45;
  const details = await pool(list.slice(0, DETAIL_N), 10, (h) => hotelDetails(h.id));
  list = list.map((h, i) => ({ ...h, detail: details[i] || null }));
  if (q.hotel.pool && !opts.wide) list = list.filter((h) => !h.detail || h.detail.pool);
  let scores = {};
  if (q.hotel.aiCheck && hasVision()) {
    scores = await scoreHotels(list.slice(0, 12).map((h) => ({ id: h.id, name: h.name, images: [h.photo, ...((h.detail && h.detail.images) || [])].filter(Boolean).slice(0, 3) })));
  }
  const out = list.map((h) => ({
    id: h.id, name: h.name, stars: h.stars, rating: h.rating, reviews: h.reviews, address: h.address, lat: h.lat, lng: h.lng,
    photos: [h.photo, ...((h.detail && h.detail.images) || [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8),
    price: h.price, perNight: Math.round(h.price / Math.max(1, nights)),
    board: h.board, boardLabel: BOARD_LABEL[h.board] || h.board, refundable: h.refundable, room: h.room || "",
    boards: Object.entries(h.boards || {}).map(([code, price]) => ({ code, label: BOARD_LABEL[code] || code, price })).sort((a, b) => a.price - b.price),
    rooms: h.rooms || 1, refundPrice: h.refundPrice,
    pool: h.detail ? h.detail.pool : null, beachfront: h.detail ? h.detail.beachfront : null,
    allInclusive: h.detail ? h.detail.allInclusive : null,
    ai: scores[h.id] || null,
    links: hotelLinks({ city: d.lite, hotelName: h.name, checkin, checkout, minStars: q.hotel.minStars, pool: q.hotel.pool, minReview: 0, board: q.hotel.board }),
  }));
  // gemiddelde prijs → "goede deal"-label
  if (out.length > 4) {
    const sorted = out.map((h) => h.perNight).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const h of out) if (h.rating >= 8.5 && h.perNight <= median * 0.85) h.deal = true;
  }
  return { hotels: out, live: true, searchLinks, nights, checked: hotels.length };
}
