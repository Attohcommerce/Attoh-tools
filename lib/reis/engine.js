// ATTOH REISPLANNER — zoekmotor (27-10-2026)
//
// Doel: de goedkoopste LOSSE vakantie (vlucht + hotel apart) die aan de
// eisen voldoet. Stappen:
//   1. datums  → welke vertrekmaanden + welke heen/terug-combinaties mogen
//   2. bestemmingen → vibes, mooi strand, temperatuur in DIE maand, smaak
//   3. vluchten → elke vertrekluchthaven × bestemming × maand (honderden
//      routes, duizenden datumcombinaties), filter op nachten, overstappen,
//      geblokkeerde dagen, en tel bagage + reiskosten naar het vliegveld op
//   4. per bestemming de goedkoopste datums → hotels voor die datums
//      (sterren, review, zwembad, maaltijd) → AI-fotocheck
//   5. totaalprijs = vlucht + bagage + hotel + vervoer naar vliegveld
//   6. live-check van de top via Duffel (als gekoppeld)
// Zonder API-keys draait alles op schattingen (duidelijk gelabeld), zodat
// de interface en de links meteen werken.
import { DESTINATIONS, DEST_BY_ID, ORIGINS, ORIGIN_BY_CODE, isLongHaul, tempIn } from "./destinations.js";
import { airlineName, airlineTier, bagCostFor2, ULCC } from "./airlines.js";
import { tpRoundTrips, hasTravelpayouts, duffelCheck, hasDuffel } from "./flights.js";
import { findHotels, hotelDetails, hasLiteApi, BOARD_LABEL } from "./hotels.js";
import { scoreHotels, hasVision } from "./vision.js";
import { flightLinks, hotelLinks, packageLinks } from "./links.js";

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const toDate = (s) => new Date(String(s).slice(0, 10) + "T12:00:00Z");
const nightsBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
const monthKey = (s) => String(s).slice(0, 7);

// ── 1. Datums ────────────────────────────────────────────────────────
export function normalizeSearch(raw) {
  const s = raw || {};
  const when = s.when || {};
  const nights = s.nights || {};
  const flight = s.flight || {};
  const hotel = s.hotel || {};
  const minN = Math.max(1, Math.min(60, Number(nights.min) || 10));
  const maxN = Math.max(minN, Math.min(60, Number(nights.max) || 16));
  return {
    when: {
      mode: ["maanden", "periode", "vast"].includes(when.mode) ? when.mode : "maanden",
      months: (Array.isArray(when.months) ? when.months : []).filter((m) => /^\d{4}-\d{2}$/.test(m)).slice(0, 6),
      from: when.from || "",
      to: when.to || "",
      depart: when.depart || "",
      ret: when.ret || "",
      flex: Math.max(0, Math.min(14, Number(when.flex) || 0)),
    },
    nights: { min: minN, max: maxN, ideal: Math.max(minN, Math.min(maxN, Number(nights.ideal) || 13)) },
    blocked: (Array.isArray(s.blocked) ? s.blocked : []).filter((b) => b && b.from).slice(0, 20),
    vibes: (Array.isArray(s.vibes) ? s.vibes : []).slice(0, 7),
    surprise: Boolean(s.surprise),
    dests: (Array.isArray(s.dests) ? s.dests : []).filter((id) => DEST_BY_ID[id]),
    minTemp: s.minTemp === null || s.minTemp === undefined || s.minTemp === "" ? null : Number(s.minTemp),
    origins: (Array.isArray(s.origins) && s.origins.length ? s.origins : ORIGINS.filter((o) => o.def).map((o) => o.code)).filter((c) => ORIGIN_BY_CODE[c]),
    flight: {
      shortHaulStops: Number(flight.shortHaulStops) === 1 ? 1 : 0,
      bags: flight.bags !== false,
      noUlcc: Boolean(flight.noUlcc),
    },
    hotel: {
      minStars: Math.max(3, Math.min(5, Number(hotel.minStars) || 4)),
      pool: hotel.pool !== false,
      board: ["geen", "ontbijt", "halfpension", "allin"].includes(hotel.board) ? hotel.board : "geen",
      minReview: Math.max(0, Math.min(9.5, Number(hotel.minReview ?? 8))),
      aiCheck: hotel.aiCheck !== false,
    },
    budget: Number(s.budget) > 0 ? Number(s.budget) : null,
    packages: s.packages !== false,
  };
}

function dateRules(q) {
  const tomorrow = iso(Date.now() + DAY);
  const w = q.when;
  let months = [];
  let ok;
  if (w.mode === "vast" && w.depart && w.ret) {
    const d0 = toDate(w.depart), r0 = toDate(w.ret), f = w.flex * DAY;
    ok = (dep, ret) => Math.abs(toDate(dep) - d0) <= f && Math.abs(toDate(ret) - r0) <= f && toDate(ret) > toDate(dep);
    for (let t = d0 - f; t <= d0.getTime() + f; t += DAY) months.push(monthKey(iso(t)));
  } else if (w.mode === "periode" && w.from && w.to) {
    const a = toDate(w.from), b = toDate(w.to);
    ok = (dep, ret) => toDate(dep) >= a && toDate(ret) <= b;
    for (let t = a.getTime(); t <= b.getTime(); t += DAY) months.push(monthKey(iso(t)));
  } else {
    let ms = w.months;
    if (!ms.length) {
      // niets gekozen → komende 3 maanden
      const n = new Date();
      ms = [1, 2, 3].map((i) => iso(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + i, 1)).slice(0, 7));
    }
    const set = new Set(ms);
    ok = (dep) => set.has(monthKey(dep));
    months = ms;
  }
  months = [...new Set(months)].filter((m) => m >= tomorrow.slice(0, 7)).slice(0, 6);
  const nightsOk = (dep, ret) => {
    if (w.mode === "vast") return true;
    const n = nightsBetween(dep, ret);
    return n >= q.nights.min && n <= q.nights.max;
  };
  const blockedOk = (dep, ret) =>
    q.blocked.every((b) => {
      const bf = toDate(b.from), bt = toDate(b.to || b.from);
      return toDate(ret) < bf || toDate(dep) > bt; // reis mag een blokkade niet raken
    });
  const all = (dep, ret) => dep >= tomorrow && ok(dep, ret) && nightsOk(dep, ret) && blockedOk(dep, ret);
  return { months, ok: all };
}

// ── 2. Bestemmingen ─────────────────────────────────────────────────
function vibeMatch(dest, q) {
  if (q.surprise || !q.vibes.length) return { ok: true, score: 0.6 };
  let hits = 0;
  for (const v of q.vibes) {
    if (v === "strand") { if (dest.tags.includes("strand") && dest.beach >= 7) hits++; }
    else if (dest.tags.includes(v)) hits++;
  }
  return { ok: hits > 0, score: hits / q.vibes.length };
}

function weatherOk(dest, monthIdx, q) {
  const t = tempIn(dest, monthIdx);
  if (q.minTemp !== null && !Number.isNaN(q.minTemp)) return t >= q.minTemp;
  // Impliciete eis: wie "zon" of "strand" kiest wil geen 17 graden.
  if (q.vibes.includes("strand")) return t >= 25;
  if (q.vibes.includes("zon")) return t >= 23;
  return true;
}

function prefBoost(dest, prefs) {
  if (!prefs) return 0;
  let b = 0;
  for (const who of Object.values(prefs)) {
    if (!who) continue;
    b += (who.dests && who.dests[dest.id]) || 0;
    for (const t of dest.tags) b += ((who.tags && who.tags[t]) || 0) * 0.3;
  }
  return Math.max(-0.15, Math.min(0.15, b * 0.01)); // max ±15% op de match
}

// ── Seizoen (voor schattingen) ──────────────────────────────────────
function seasonFactor(dep) {
  const d = toDate(dep);
  const m = d.getUTCMonth(), day = d.getUTCDate();
  if ((m === 11 && day >= 19) || (m === 0 && day <= 3)) return 1.45; // kerst
  if (m === 6 || m === 7) return 1.35; // zomervakantie
  if (m === 1 && day >= 13 && day <= 24) return 1.2; // voorjaarsvakantie
  if ((m === 3 && day >= 25) || (m === 4 && day <= 5)) return 1.25; // meivakantie
  if (m === 9 && day >= 10 && day <= 27) return 1.15; // herfstvakantie
  return [0.92, 1.0, 0.92, 1.0, 1.05, 1.05, 1, 1, 0.97, 1.0, 0.85, 0.95][m];
}
function weekdayFactor(dep) {
  return [1.03, 0.97, 0.92, 0.92, 1.0, 1.03, 1.05][toDate(dep).getUTCDay()];
}

// ── Concurrency helper ──────────────────────────────────────────────
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e.message }; }
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Hoofdfunctie ────────────────────────────────────────────────────
export async function runSearch(rawSearch, { prefs, onProgress } = {}) {
  const t0 = Date.now();
  const DEADLINE = t0 + 52000; // Vercel-functie mag 60s
  const emit = (e) => { try { onProgress && onProgress(e); } catch {} };
  const q = normalizeSearch(rawSearch);
  const { months, ok } = dateRules(q);
  const live = { flights: hasTravelpayouts(), hotels: hasLiteApi(), vision: hasVision(), duffel: hasDuffel() };
  const stats = { routes: 0, flightOptions: 0, combos: 0, hotelsChecked: 0, photosChecked: 0, errors: [] };

  if (!months.length) return { query: q, live, stats, results: [], message: "Kies een periode in de toekomst." };

  // 2. kandidaten (bestemming × maand)
  emit({ type: "stage", label: "Bestemmingen kiezen" });
  const candDests = (q.dests.length ? q.dests.map((id) => DEST_BY_ID[id]) : DESTINATIONS);
  const pairs = [];
  for (const d of candDests) {
    const vm = q.dests.length ? { ok: true, score: 1 } : vibeMatch(d, q);
    if (!vm.ok) continue;
    for (const m of months) {
      const mi = Number(m.slice(5, 7)) - 1;
      if (!q.dests.length && !weatherOk(d, mi, q)) continue;
      pairs.push({ dest: d, month: m, match: Math.min(1, vm.score + prefBoost(d, prefs)) });
    }
  }
  const destCount = new Set(pairs.map((p) => p.dest.id)).size;
  emit({ type: "count", destinations: destCount, months: months.length });
  if (!pairs.length) {
    return { query: q, live, stats, results: [], message: "Geen bestemming past bij deze vibes + temperatuur in die maand. Haal een filter weg of kies een andere maand." };
  }

  // 3. vluchten
  emit({ type: "stage", label: live.flights ? "Vluchten vergelijken" : "Vluchtprijzen schatten" });
  const flightCands = []; // {dest, month, match, origin, depart, ret, nights, flightCost, ...}
  const bagFor = (code, long) => (q.flight.bags ? bagCostFor2(code, long) : 0);

  if (live.flights) {
    const jobs = [];
    for (const p of pairs) {
      const long = isLongHaul(p.dest);
      const direct = !long && q.flight.shortHaulStops === 0;
      for (const o of q.origins) {
        for (const a of p.dest.iata.slice(0, 2)) jobs.push({ p, origin: o, airport: a, direct, long });
      }
    }
    jobs.sort((a, b) => b.p.match - a.p.match);
    const capped = jobs.slice(0, 420);
    let done = 0;
    await pool(capped, 16, async (j) => {
      if (Date.now() > DEADLINE - 25000) return;
      let rows = [];
      try {
        rows = await tpRoundTrips(j.origin, j.airport, j.p.month, j.direct);
      } catch (e) {
        if (stats.errors.length < 3) stats.errors.push(`Vluchten ${j.origin}-${j.airport}: ${e.message}`);
      }
      stats.routes++;
      for (const r of rows) {
        stats.flightOptions++;
        const maxStops = j.long ? 1 : q.flight.shortHaulStops;
        if (r.stopsOut > maxStops || r.stopsBack > maxStops) continue;
        if (q.flight.noUlcc && ULCC.includes(r.airline)) continue;
        if (!ok(r.depart, r.ret)) continue;
        const nights = nightsBetween(r.depart, r.ret);
        const bag = bagFor(r.airline, j.long);
        const toAirport = ORIGIN_BY_CODE[j.origin].toAirport;
        flightCands.push({
          ...j.p, origin: j.origin, airport: j.airport, depart: r.depart, ret: r.ret, nights,
          ticket: Math.round(r.pricePP * 2), bag, toAirport,
          flightCost: Math.round(r.pricePP * 2 + bag + toAirport),
          airline: r.airline, airlineName: airlineName(r.airline), tier: airlineTier(r.airline),
          stopsOut: r.stopsOut, stopsBack: r.stopsBack, departTime: r.departTime, returnTime: r.returnTime,
          durationOut: r.durationOut, aviasales: r.link, estimate: false,
        });
      }
      done++;
      if (done % 8 === 0) emit({ type: "count", routes: stats.routes, flightOptions: stats.flightOptions, matches: flightCands.length });
    });
  }

  // Schatting: per bestemming × maand de goedkoopste dag volgens seizoen +
  // weekdag (en altijd als er live niets gevonden is voor die bestemming).
  const liveDestIds = new Set(flightCands.map((f) => f.dest.id));
  for (const p of pairs) {
    if (liveDestIds.has(p.dest.id)) continue;
    const long = isLongHaul(p.dest);
    const [y, m] = p.month.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let best = null;
    for (let day = 1; day <= days; day++) {
      const dep = `${p.month}-${String(day).padStart(2, "0")}`;
      const tries = q.when.mode === "vast" && q.when.depart && q.when.ret
        ? [nightsBetween(q.when.depart, q.when.ret)]
        : [q.nights.ideal];
      for (const n of [...new Set(tries)]) {
        const ret = iso(toDate(dep).getTime() + n * DAY);
        if (!ok(dep, ret)) continue;
        const f = seasonFactor(dep) * weekdayFactor(dep) * (0.5 + 0.5 * seasonFactor(ret));
        const origin = q.origins.includes("AMS") ? "AMS" : q.origins[0];
        const ticket = Math.round(p.dest.flightEst * 2 * f);
        const bag = q.flight.bags ? (long ? 0 : 140) : 0;
        const toAirport = ORIGIN_BY_CODE[origin].toAirport;
        const hotel = Math.round(p.dest.hotelEst * n * (0.75 + 0.25 * seasonFactor(dep)) * (q.hotel.minStars >= 5 ? 1.7 : 1) * ({ geen: 1, ontbijt: 1.12, halfpension: 1.3, allin: 1.6 }[q.hotel.board]));
        const total = ticket + bag + toAirport + hotel;
        if (!best || total < best.total) {
          best = { ...p, origin, airport: p.dest.iata[0], depart: dep, ret, nights: n, ticket, bag, toAirport, flightCost: ticket + bag + toAirport, hotelEstTotal: hotel, total, estimate: true, airline: "", airlineName: long ? "Diverse (max 1 overstap)" : "Directe vlucht", tier: 2, stopsOut: long ? 1 : 0, stopsBack: long ? 1 : 0 };
        }
      }
    }
    if (best) flightCands.push(best);
  }
  stats.combos = flightCands.length;
  emit({ type: "count", routes: stats.routes, flightOptions: stats.flightOptions, matches: flightCands.length });

  if (!flightCands.length) {
    return { query: q, live, stats, results: [], message: "Geen vluchten gevonden die aan alle eisen voldoen (direct, ruimbagage, datums). Maak de periode ruimer of sta 1 overstap toe." };
  }

  // Per bestemming de beste datums (hotel-schatting meegerekend, anders wint
  // altijd de kortste trip). Ook alternatieven bewaren: "3 nachten langer = …".
  const hotelNightEst = (d) => d.hotelEst * (q.hotel.minStars >= 5 ? 1.7 : 1) * ({ geen: 1, ontbijt: 1.12, halfpension: 1.3, allin: 1.6 }[q.hotel.board]);
  const byDest = new Map();
  for (const f of flightCands) {
    const est = f.estimate ? f.total : f.flightCost + hotelNightEst(f.dest) * f.nights;
    // Vergelijken alsof elke reis de ideale lengte heeft (anders wint altijd
    // de kortste trip), plus kleine voorkeur voor nette maatschappij,
    // directe vlucht en dicht bij de ideale lengte.
    const norm = f.estimate ? f.total : f.flightCost + hotelNightEst(f.dest) * q.nights.ideal;
    const adj = norm * (1 + (f.tier - 1) * 0.03 + (f.stopsOut + f.stopsBack) * 0.03 + Math.abs(f.nights - q.nights.ideal) * 0.015);
    const arr = byDest.get(f.dest.id) || [];
    arr.push({ ...f, roughTotal: Math.round(est), adj });
    byDest.set(f.dest.id, arr);
  }
  let shortlist = [];
  for (const arr of byDest.values()) {
    arr.sort((a, b) => a.adj - b.adj);
    const seen = new Set();
    const uniq = arr.filter((x) => { const k = x.depart + x.ret; if (seen.has(k)) return false; seen.add(k); return true; });
    shortlist.push({ best: uniq[0], alts: uniq.slice(1, 4) });
  }
  shortlist.sort((a, b) => a.best.adj / (0.75 + 0.25 * a.best.match) - b.best.adj / (0.75 + 0.25 * b.best.match));
  shortlist = shortlist.slice(0, 14);

  // 4. hotels
  emit({ type: "stage", label: live.hotels ? "Hotels zoeken en foto's checken" : "Hotelprijzen schatten" });
  const results = [];
  await pool(shortlist, 4, async ({ best: f, alts }) => {
    const d = f.dest;
    let hotel = null;
    let hotelTotal = f.estimate ? f.hotelEstTotal : Math.round(hotelNightEst(d) * f.nights);
    let hotelEstimate = true;
    if (live.hotels && Date.now() < DEADLINE - 12000) {
      try {
        const { hotels } = await findHotels({ dest: d, checkin: f.depart, checkout: f.ret, minStars: q.hotel.minStars, minReview: q.hotel.minReview, board: q.hotel.board, limit: 6 });
        stats.hotelsChecked += hotels.length;
        let cands = hotels.slice(0, 8);
        const details = await pool(cands, 4, (h) => hotelDetails(h.id).catch(() => null));
        cands = cands.map((h, i) => ({ ...h, detail: details[i] || null }));
        if (q.hotel.pool) cands = cands.filter((h) => !h.detail || h.detail.pool);
        if (q.hotel.aiCheck && live.vision && cands.length && Date.now() < DEADLINE - 8000) {
          const top = cands.slice(0, 4).map((h) => ({ id: h.id, name: h.name, images: [h.photo, ...((h.detail && h.detail.images) || [])].filter(Boolean).slice(0, 3) }));
          const scores = await scoreHotels(top);
          stats.photosChecked += top.length;
          cands = cands.map((h) => ({ ...h, ai: scores[h.id] || null }));
          const good = cands.filter((h) => !h.ai || h.ai.score >= 6);
          if (good.length) cands = good;
        }
        if (cands.length) {
          // prijs, maar een mooier hotel mag iets duurder zijn
          cands.sort((a, b) => a.price * (1 + (7.5 - ((a.ai && a.ai.score) || 7)) * 0.04) - b.price * (1 + (7.5 - ((b.ai && b.ai.score) || 7)) * 0.04));
          const h = cands[0];
          hotel = {
            id: h.id, name: h.name, stars: h.stars, rating: h.rating, reviews: h.reviews, photo: h.photo,
            board: h.board, boardLabel: BOARD_LABEL[h.board] || h.board, room: h.room, refundable: h.refundable,
            pool: h.detail ? h.detail.pool : null, beachfront: h.detail ? h.detail.beachfront : null,
            ai: h.ai || null, address: h.address,
            others: cands.slice(1, 3).map((o) => ({ id: o.id, name: o.name, stars: o.stars, rating: o.rating, price: o.price, ai: o.ai || null })),
          };
          hotelTotal = h.price;
          hotelEstimate = false;
        }
      } catch (e) {
        if (stats.errors.length < 4) stats.errors.push(`Hotels ${d.city}: ${e.message}`);
      }
    }
    const total = Math.round(f.flightCost + hotelTotal);
    const perNight = hotelTotal / Math.max(1, f.nights);
    results.push({
      id: `${d.id}-${f.depart}-${f.ret}-${f.origin}`,
      destId: d.id, city: d.city, country: d.country, region: d.region, tags: d.tags, beach: d.beach,
      temp: tempIn(d, toDate(f.depart).getUTCMonth()),
      hours: d.hours, match: Math.round(f.match * 100),
      origin: f.origin, originName: ORIGIN_BY_CODE[f.origin].short, airport: f.airport,
      depart: f.depart, ret: f.ret, nights: f.nights,
      flight: {
        estimate: f.estimate, airline: f.airline, airlineName: f.airlineName, tier: f.tier,
        stopsOut: f.stopsOut, stopsBack: f.stopsBack, departTime: f.departTime || "", returnTime: f.returnTime || "",
        ticket: f.ticket, bag: f.bag, toAirport: f.toAirport, cost: f.flightCost, verified: false,
      },
      hotel, hotelTotal: Math.round(hotelTotal), hotelEstimate,
      total, perPerson: Math.round(total / 2),
      overBudget: q.budget ? total > q.budget : false,
      alts: alts.map((a) => {
        const altTotal = Math.round(a.flightCost + perNight * a.nights);
        return { depart: a.depart, ret: a.ret, nights: a.nights, origin: a.origin, total: altTotal, diff: altTotal - total };
      }),
      links: {
        flight: flightLinks({ origin: f.origin, dest: f.airport, depart: f.depart, ret: f.ret, direct: f.stopsOut === 0 && f.stopsBack === 0, aviasalesPath: f.aviasales }),
        hotel: hotelLinks({ city: d.lite, hotelName: hotel && hotel.name, checkin: f.depart, checkout: f.ret, minStars: q.hotel.minStars, pool: q.hotel.pool, minReview: q.hotel.minReview, board: q.hotel.board }),
        packages: q.packages ? packageLinks({ city: d.city.split(" ·")[0], country: d.country, depart: f.depart, nights: f.nights }) : [],
      },
    });
  });

  // 6. live-check van de top-5 vluchten (Duffel)
  results.sort((a, b) => a.total - b.total);
  if (live.duffel && Date.now() < DEADLINE - 6000) {
    emit({ type: "stage", label: "Top 5 live controleren" });
    await pool(results.filter((r) => !r.flight.estimate).slice(0, 5), 5, async (r) => {
      try {
        const long = r.hours > 6;
        const chk = await duffelCheck({ origin: r.origin, dest: r.airport, depart: r.depart, ret: r.ret, maxConnections: long ? 1 : q.flight.shortHaulStops });
        if (!chk || chk.none) return;
        const o = q.flight.bags ? chk.bestWithBag || chk.best : chk.best;
        if (!o) return;
        const bag = q.flight.bags && !o.checkedBag ? bagCostFor2(o.airline, long) : 0;
        const cost = Math.round(o.total + bag + r.flight.toAirport);
        r.flight = { ...r.flight, verified: true, ticket: Math.round(o.total), bag, cost, airline: o.airline, airlineName: o.airlineName || airlineName(o.airline), departTime: o.departTime, returnTime: o.returnTime, stopsOut: o.stopsOut, stopsBack: o.stopsBack };
        r.total = Math.round(cost + r.hotelTotal);
        r.perPerson = Math.round(r.total / 2);
        r.overBudget = q.budget ? r.total > q.budget : false;
      } catch (e) {
        if (stats.errors.length < 5) stats.errors.push(`Live-check ${r.city}: ${e.message}`);
      }
    });
    results.sort((a, b) => a.total - b.total);
  }

  // labels
  if (results.length) {
    results[0].badge = "Goedkoopst";
    const deal = [...results].sort((a, b) => a.total / (0.7 + 0.3 * (a.match / 100) + ((a.hotel && a.hotel.ai && a.hotel.ai.score) || 7) * 0.02) - b.total / (0.7 + 0.3 * (b.match / 100) + ((b.hotel && b.hotel.ai && b.hotel.ai.score) || 7) * 0.02))[0];
    if (deal && deal !== results[0]) deal.badge = "Beste deal";
  }

  return {
    query: q, live, stats: { ...stats, ms: Date.now() - t0 },
    results,
    message: results.every((r) => r.overBudget) && q.budget ? "Niets binnen budget gevonden — dit zijn de goedkoopste opties." : "",
  };
}
