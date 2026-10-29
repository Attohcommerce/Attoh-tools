"use client";

// Bestemming openen: stap 1 vlucht kiezen, stap 2 hotel kiezen, onderaan
// het totaal + boekknoppen. Zo simpel als een reisbureau-folder.
import { useEffect, useMemo, useRef, useState } from "react";
import { rsfx } from "./ReisSound";
import { countryInfo } from "@/lib/reis/countryinfo";
import { leaveDays } from "./fmt";
import HotelMap, { HotelMapModal, LocationLink } from "./HotelMap";
import BookingGuide from "./BookingGuide";

const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MON = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const eur = (n) => "€" + Math.round(n || 0).toLocaleString("nl-NL");
const fmtDay = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};

export default function Explore({ dest, search, initial, onClose, onSave, trip, onReplace, onBooked }) {
  const [flights, setFlights] = useState(null);
  const [flightLive, setFlightLive] = useState(true);
  const [sel, setSel] = useState(null);
  const [hotels, setHotels] = useState(null);
  const [hotelInfo, setHotelInfo] = useState({});
  const [hotelSel, setHotelSel] = useState(null);
  const [err, setErr] = useState("");
  const [nightsFilter, setNightsFilter] = useState("alle");
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState("lijst");
  const [saved, setSaved] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [mapHotel, setMapHotel] = useState(null);
  const [showMap, setShowMap] = useState(true);
  const [places, setPlaces] = useState({});
  const [wide, setWide] = useState(false);
  const [meta, setMeta] = useState({});
  const [guide, setGuide] = useState(null);
  const [fSort, setFSort] = useState("prijs");
  const [originF, setOriginF] = useState("alle");
  const [losOk, setLosOk] = useState(true);
  const [directOnly, setDirectOnly] = useState(false);
  const [dayF, setDayF] = useState("alle");
  const [hWide, setHWide] = useState(false);
  const [hSort, setHSort] = useState("prijs");
  const [hFilt, setHFilt] = useState({});
  const [hCount, setHCount] = useState(12);
  // wijknamen ophalen zodra de hotels er zijn
  useEffect(() => {
    if (!hotels || !hotels.length) return;
    const pts = hotels.filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && !places[h.id]).map((h) => ({ id: h.id, lat: h.lat, lng: h.lng }));
    if (!pts.length) return;
    let off = false;
    fetch("/api/reis/places", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: pts }) })
      .then((r) => r.json())
      .then((d) => !off && d && d.places && setPlaces((p) => ({ ...p, ...Object.fromEntries(Object.entries(d.places).map(([k, v]) => [k, v.label])) })))
      .catch(() => {});
    return () => { off = true; };
  }, [hotels]); // eslint-disable-line

  // Escape sluit, achtergrond niet laten scrollen
  useEffect(() => {
    // Escape sluit dit scherm, tenzij er een kaart-pop-up open staat (die sluit eerst)
    const onKey = (e) => e.key === "Escape" && !document.querySelector(".rp-mapmodal, .rp-guide") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let off = false;
    setFlights(null);
    fetch("/api/reis/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ search, destId: dest.id, what: "flights", wide }) })
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        if (d.error) throw new Error(d.error);
        setFlights(d.flights || []);
        setFlightLive(d.live !== false);
        setMeta({ checked: d.checked, sources: d.sources, losCount: d.losCount, origins: d.origins });
        const keepSel = sel && (d.flights || []).find((f) => f.id === sel.id);
        const pick = keepSel || (initial && (d.flights || []).find((f) => f.depart === initial.depart && f.ret === initial.ret)) || (d.flights || [])[0];
        if (pick) setSel(pick);
        else if (initial) setSel({ id: "init", depart: initial.depart, ret: initial.ret, nights: initial.nights, estimate: true });
      })
      .catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [dest.id, wide]); // eslint-disable-line

  useEffect(() => {
    if (!sel) return;
    let off = false;
    setHotels(null);
    setHotelSel(null);
    fetch("/api/reis/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ search, destId: dest.id, what: "hotels", checkin: sel.depart, checkout: sel.ret, wide: hWide }) })
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        if (d.error) throw new Error(d.error);
        setHotels(d.hotels || []);
        setHotelInfo({ live: d.live !== false, searchLinks: d.searchLinks || [], nights: d.nights, checked: d.checked });
        setHCount(12);
        // geopend vanuit een bewaarde reis: jullie hotel blijft gekozen als het er is
        const keep = (initial && initial.hotelId && (d.hotels || []).find((h) => h.id === initial.hotelId)) || (prevHotel.current && (d.hotels || []).find((h) => h.id === prevHotel.current));
        if (keep) setHotelSel(keep);
        else if (d.hotels && d.hotels[0]) setHotelSel(d.hotels[0]);
      })
      .catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [sel && sel.depart, sel && sel.ret, hWide]); // eslint-disable-line
  const prevHotel = useRef(null);
  useEffect(() => { if (hotelSel) prevHotel.current = hotelSel.id; }, [hotelSel]);

  const nightsOptions = useMemo(() => [...new Set((flights || []).map((f) => f.nights))].sort((a, b) => a - b), [flights]);
  const originOptions = useMemo(() => [...new Set((flights || []).map((f) => f.origin))], [flights]);
  const shownFlights = useMemo(() => {
    let l = (flights || []).filter((f) =>
      (nightsFilter === "alle" || f.nights === nightsFilter) &&
      (originF === "alle" || f.origin === originF) &&
      (losOk || f.kind !== "los") &&
      (!directOnly || (f.stopsOut === 0 && f.stopsBack === 0)) &&
      (dayF === "alle" || (dayF === "weekend" ? [4, 5, 6].includes(new Date(f.depart + "T12:00:00Z").getUTCDay()) : [1, 2, 3].includes(new Date(f.depart + "T12:00:00Z").getUTCDay()))));
    const hr = (t) => (t ? Number(t.slice(0, 2)) : 12);
    if (fSort === "tijden") l = [...l].sort((a, b) => (a.cost + (hr(a.departTime) < 7 ? 120 : 0) + (hr(a.returnTime) < 7 ? 80 : 0)) - (b.cost + (hr(b.departTime) < 7 ? 120 : 0) + (hr(b.returnTime) < 7 ? 80 : 0)));
    if (fSort === "netjes") l = [...l].sort((a, b) => a.tier - b.tier || a.cost - b.cost);
    if (fSort === "verlof") l = [...l].sort((a, b) => leaveDays(a.depart, a.ret) / Math.max(1, a.nights) - leaveDays(b.depart, b.ret) / Math.max(1, b.nights) || a.cost - b.cost);
    if (fSort === "vroeg") l = [...l].sort((a, b) => (a.depart < b.depart ? -1 : a.depart > b.depart ? 1 : a.cost - b.cost));
    return l;
  }, [flights, nightsFilter, originF, losOk, directOnly, fSort, dayF]);
  const [fCount, setFCount] = useState(10);
  const visible = showAll ? shownFlights : shownFlights.slice(0, fCount);
  const hotelsShown = useMemo(() => {
    let l = (hotels || []).filter((h) =>
      (!hFilt.refund || h.refundable || h.refundPrice) &&
      (!hFilt.beach || h.beachfront) &&
      (!hFilt.ai || (h.allInclusive || (h.boards || []).some((b) => b.code === "AI"))) &&
      (!hFilt.five || h.stars >= 5) &&
      (!hFilt.nine || h.rating >= 9));
    if (hSort === "review") l = [...l].sort((a, b) => b.rating - a.rating || a.price - b.price);
    if (hSort === "waarde") l = [...l].sort((a, b) => a.perNight / Math.max(1, a.rating - 6) - b.perNight / Math.max(1, b.rating - 6));
    if (hSort === "foto") l = [...l].sort((a, b) => ((b.ai && b.ai.score) || 0) - ((a.ai && a.ai.score) || 0) || a.price - b.price);
    return l;
  }, [hotels, hFilt, hSort]);
  const total = (sel && sel.cost ? sel.cost : 0) + (hotelSel ? hotelSel.price : 0);

  const buildResult = () => ({
      id: `${dest.id}-${sel.depart}-${sel.ret}-${sel.origin}-${hotelSel.id}`,
      destId: dest.id, cc: dest.cc, city: dest.city, country: dest.country, tags: dest.tags, hours: dest.hours, beach: dest.beach,
      temp: dest.temp[new Date(sel.depart + "T12:00:00Z").getUTCMonth()],
      origin: sel.origin, originName: sel.originName, airport: sel.airport,
      depart: sel.depart, ret: sel.ret, nights: sel.nights,
      backTo: sel.backTo || sel.origin, backToName: sel.backToName || sel.originName,
      flight: { estimate: false, kind: sel.kind || "retour", airline: sel.airline, airlineName: sel.airlineName, flightNumber: sel.flightNumber || "", legs: sel.legs || null, stopsOut: sel.stopsOut, stopsBack: sel.stopsBack, ticket: sel.ticket, bag: sel.bag, toAirport: sel.toAirport, cost: sel.cost, departTime: sel.departTime, returnTime: sel.returnTime },
      hotel: { id: hotelSel.id, name: hotelSel.name, stars: hotelSel.stars, rating: hotelSel.rating, boardLabel: hotelSel.boardLabel, room: hotelSel.room || "", refundable: hotelSel.refundable, photo: hotelSel.photos[0], lat: hotelSel.lat, lng: hotelSel.lng, address: hotelSel.address, place: places[hotelSel.id] || "" },
      hotelTotal: hotelSel.price, hotelEstimate: false,
      total, perPerson: Math.round(total / 2), alts: [],
      links: { flight: sel.links, hotel: hotelSel.links, packages: [] },
  });
  async function save(owner) {
    if (!sel || !sel.cost || !hotelSel) return;
    setSaved({ owner, state: "busy", key: sel.id + hotelSel.id });
    const ok = await onSave(buildResult(), owner);
    setSaved({ owner, state: ok ? "ok" : "err", key: sel.id + hotelSel.id });
  }
  // Geopend vanuit "Onze reizen": de bewaarde reis bijwerken met de nieuwe keuze
  async function replace() {
    if (!sel || !sel.cost || !hotelSel || !trip) return;
    setSaved({ owner: "replace", state: "busy", key: sel.id + hotelSel.id });
    const ok = await onReplace(trip.id, buildResult());
    setSaved({ owner: "replace", state: ok ? "ok" : "err", key: sel.id + hotelSel.id });
  }
  const unchanged = trip && sel && hotelSel && sel.depart === trip.result.depart && sel.ret === trip.result.ret && hotelSel.id === (trip.result.hotel && trip.result.hotel.id);

  return (
    <div className="rp-sheet-wrap" role="dialog" aria-modal="true" aria-label={`Alle opties voor ${dest.city}`}>
      <div className="rp-sheet-bg" onClick={onClose} />
      <div className="rp-sheet">
        <header className="rp-sheet-head">
          <div>
            <div className="rp-city">{dest.city}</div>
            <div className="rp-country">
              {trip ? `Jullie reis aanpassen: nu ${fmtDay(trip.result.depart)} tot ${fmtDay(trip.result.ret)}, ${eur(trip.result.total)}` : `${dest.country !== dest.city ? `${dest.country}, ` : ""}${Math.round(dest.hours)} uur vliegen`}
            </div>
          </div>
          <button className="rp-iconbtn" onClick={onClose} aria-label="Sluiten">✕</button>
        </header>

        <div className="rp-sheet-body">
          {err && <div className="rp-note"><span>{err}</span></div>}

          <DestInfo dest={dest} date={sel ? sel.depart : (search && search.when && search.when.months && search.when.months[0] ? search.when.months[0] + "-15" : null)} />

          <section>
            <h3 className="rp-step"><i>1</i>Kies jullie vlucht</h3>
            {!flights && <Loading label={wide ? "Ook Weeze, Keulen en Charleroi afzoeken" : "Retours, losse tickets en alle vertrekdagen afzoeken"} />}
            {flights && !flightLive && (
              <div className="rp-note">
                <span><b>Nog geen echte vluchtprijzen.</b> Koppel Travelpayouts in Vercel, dan staan hier alle vluchten met datum, tijden en prijs. Tot die tijd kun je zoeken op {initial ? `${fmtDay(initial.depart)} tot ${fmtDay(initial.ret)}` : "jullie data"} via de knoppen hieronder.</span>
              </div>
            )}
            {flights && !flightLive && (
              <div className="rp-btnrow" style={{ flexWrap: "wrap" }}>
                {(initial && initial.flightLinks ? initial.flightLinks : monthFlightLinks(dest, search)).map((l) => (
                  <a key={l.label} className="rp-btn" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
                ))}
              </div>
            )}
            {flights && flightLive && flights.length === 0 && (
              <div className="rp-note"><span>Geen vluchten gevonden die aan jullie eisen voldoen in deze periode. {!wide ? "Zoek ook vanaf verdere vliegvelden, of " : ""}probeer een andere maand of sta 1 overstap toe.</span></div>
            )}
            {flights && flightLive && (
              <div className="rp-scanbar">
                <span>
                  <b>{flights.length}</b> opties uit {(meta.checked || 0).toLocaleString("nl-NL")} gevonden prijzen{meta.losCount ? `, waarvan ${meta.losCount} met 2 losse tickets (vaak goedkoper)` : ""}.
                </span>
                {!wide ? (
                  <button className="rp-btn sm" onClick={() => { setWide(true); rsfx("takeoff"); }}>Zoek ook vanaf Weeze, Keulen en Charleroi</button>
                ) : (
                  <span className="rp-pill ok">Alle 8 vliegvelden doorzocht</span>
                )}
              </div>
            )}
            {flights && flightLive && flights.length > 0 && (
              <>
                <div className="rp-seg rp-viewseg">
                  <button className={view === "lijst" ? "on" : ""} onClick={() => setView("lijst")}>Lijst</button>
                  <button className={view === "kalender" ? "on" : ""} onClick={() => setView("kalender")}>Prijskalender</button>
                </div>
                <div className="rp-fbar">
                  <label className="rp-mini">
                    Sorteer
                    <select value={fSort} onChange={(e) => setFSort(e.target.value)}>
                      <option value="prijs">Goedkoopst</option>
                      <option value="tijden">Fijne tijden (niet midden in de nacht)</option>
                      <option value="netjes">Beste maatschappij</option>
                      <option value="verlof">Minste verlofdagen per nacht</option>
                      <option value="vroeg">Vroegste vertrek</option>
                    </select>
                  </label>
                  <label className="rp-mini">
                    Vertrek op
                    <select value={dayF} onChange={(e) => setDayF(e.target.value)}>
                      <option value="alle">Elke dag</option>
                      <option value="weekend">Do, vr of za</option>
                      <option value="week">Ma, di of wo</option>
                    </select>
                  </label>
                  {originOptions.length > 1 && (
                    <label className="rp-mini">
                      Vliegveld
                      <select value={originF} onChange={(e) => setOriginF(e.target.value)}>
                        <option value="alle">Alle vliegvelden</option>
                        {originOptions.map((o) => <option key={o} value={o}>{(flights.find((f) => f.origin === o) || {}).originName || o}</option>)}
                      </select>
                    </label>
                  )}
                  <button className={"rp-chip sm" + (directOnly ? " on" : "")} onClick={() => setDirectOnly((v) => !v)}>Alleen direct</button>
                  {meta.losCount > 0 && <button className={"rp-chip sm" + (losOk ? " on" : "")} onClick={() => setLosOk((v) => !v)}>Ook 2 losse tickets</button>}
                </div>
                {nightsOptions.length > 1 && (
                  <div className="rp-chips" style={{ marginBottom: 12 }}>
                    <button className={"rp-chip sm" + (nightsFilter === "alle" ? " on" : "")} onClick={() => setNightsFilter("alle")}>Alle lengtes</button>
                    {nightsOptions.map((n) => (
                      <button key={n} className={"rp-chip sm" + (nightsFilter === n ? " on" : "")} onClick={() => setNightsFilter(n)}>{n} nachten</button>
                    ))}
                  </div>
                )}
                {view === "kalender" && <PriceCalendar flights={shownFlights} sel={sel} onPick={setSel} />}
                {view === "lijst" && <div className="rp-flights">
                  {visible.map((f, i) => (
                    <button key={f.id} className={"rp-fopt" + (sel && sel.id === f.id ? " on" : "")} onClick={() => setSel(f)}>
                      <span className="rp-fopt-dates"><b>{fmtDay(f.depart)}</b><span>tot {fmtDay(f.ret)}</span></span>
                      <span className="rp-fopt-mid">
                        <span>{f.nights} nachten, vanaf {f.originName}{f.backTo && f.backTo !== f.origin ? `, terug op ${f.backToName}` : ""}</span>
                        <span className="rp-muted">{f.airlineName}{f.flightNumber ? ` ${f.flightNumber}` : ""}, {f.stopsOut === 0 && f.stopsBack === 0 ? "direct" : "1 overstap"}{f.departTime ? `, vertrek ${f.departTime}` : ""}{f.returnTime ? `, terug ${f.returnTime}` : ""}, {leaveDays(f.depart, f.ret)} verlofdagen</span>
                        {f.kind === "los" && <span className="rp-tag los">2 losse tickets</span>}
                      </span>
                      <span className="rp-fopt-price">{eur(f.cost)}{f.cheapest && <small>goedkoopst</small>}</span>
                    </button>
                  ))}
                </div>}
                {view === "lijst" && shownFlights.length === 0 && <div className="rp-note"><span>Geen vluchten met deze filters. Zet een filter uit.</span></div>}
                {view === "lijst" && shownFlights.length > fCount && !showAll && (
                  <div className="rp-btnrow" style={{ marginTop: 10 }}>
                    <button className="rp-btn" style={{ flex: 1 }} onClick={() => setFCount((c) => c + 20)}>Toon 20 meer</button>
                    <button className="rp-btn" style={{ flex: 1 }} onClick={() => setShowAll(true)}>Toon alle {shownFlights.length}</button>
                  </div>
                )}
                <p className="rp-hint">Prijs voor 2 personen, inclusief ruimbagage en reiskosten naar het vliegveld.</p>
              </>
            )}
          </section>

          <section>
            <h3 className="rp-step"><i>2</i>Kies jullie hotel{sel ? <span>{fmtDay(sel.depart)} tot {fmtDay(sel.ret)}, {sel.nights} nachten</span> : null}</h3>
            {sel && !hotels && <Loading label="Hotels zoeken en foto's bekijken" />}
            {hotels && !hotelInfo.live && (
              <div className="rp-note">
                <span><b>Nog geen echte hotelprijzen.</b> Koppel LiteAPI in Vercel, dan staan hier alle hotels met foto's en prijs voor deze data. Je kunt nu al zoeken met jullie filters:</span>
              </div>
            )}
            {hotels && !hotelInfo.live && (
              <div className="rp-btnrow" style={{ flexWrap: "wrap" }}>
                {(hotelInfo.searchLinks || []).map((l) => <a key={l.label} className="rp-btn" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
              </div>
            )}
            {hotels && hotelInfo.live && hotels.length === 0 && <div className="rp-note"><span>Geen hotels gevonden met deze eisen. {!hWide ? "Zoek ruimer (hieronder), of " : ""}kies "Maakt niet uit" bij maaltijden.</span></div>}
            {hotels && hotelInfo.live && (
              <div className="rp-scanbar">
                <span><b>{hotels.length}</b> hotels met een prijs voor deze data{hotelInfo.checked ? "" : ""}.</span>
                {!hWide ? (
                  <button className="rp-btn sm" onClick={() => { setHWide(true); rsfx("click"); }}>Meer hotels (ook 7,5+ en zonder bevestigd zwembad)</button>
                ) : (
                  <span className="rp-pill ok">Ruim gezocht</span>
                )}
              </div>
            )}
            {hotels && hotels.length > 0 && (
              <div className="rp-fbar">
                <label className="rp-mini">
                  Sorteer
                  <select value={hSort} onChange={(e) => setHSort(e.target.value)}>
                    <option value="prijs">Goedkoopst</option>
                    <option value="waarde">Beste prijs/kwaliteit</option>
                    <option value="review">Hoogste review</option>
                    <option value="foto">Mooiste foto's (AI)</option>
                  </select>
                </label>
                {[["refund", "Gratis annuleren"], ["beach", "Aan het strand"], ["ai", "All-inclusive mogelijk"], ["five", "5 sterren"], ["nine", "Review 9+"]].map(([k, l]) => (
                  <button key={k} className={"rp-chip sm" + (hFilt[k] ? " on" : "")} onClick={() => setHFilt((f) => ({ ...f, [k]: !f[k] }))}>{l}</button>
                ))}
              </div>
            )}
            {hotels && hotels.length > 0 && (
              <>
                {hotels.some((h) => h.lat) && (
                  <div className="rp-hotels-map">
                    <div className="rp-hotels-map-head">
                      <span>Waar liggen de hotels? Klik op een prijs om dat hotel te kiezen.</span>
                      <button className="rp-link" onClick={() => setShowMap((v) => !v)}>{showMap ? "Kaart verbergen" : "Kaart tonen"}</button>
                    </div>
                    {showMap && (
                      <HotelMap
                        hotels={hotelsShown.slice(0, Math.max(hCount, 30))}
                        selectedId={hotelSel && hotelSel.id}
                        hoverId={hoverId}
                        onPick={(h) => {
                          setHotelSel(h);
                          const el = document.getElementById("hotel-" + h.id);
                          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      />
                    )}
                  </div>
                )}
                <div className="rp-hotels">
                  {hotelsShown.slice(0, hCount).map((h) => (
                    <HotelCard key={h.id} h={h} place={places[h.id]} city={dest.lite} on={hotelSel && hotelSel.id === h.id} onPick={() => setHotelSel(h)} onHover={setHoverId} onMap={() => setMapHotel(h)} />
                  ))}
                </div>
                {hotelsShown.length === 0 && <div className="rp-note"><span>Geen hotels met deze filters. Zet een filter uit.</span></div>}
                {hotelsShown.length > hCount && <button className="rp-btn" style={{ marginTop: 12, width: "100%" }} onClick={() => setHCount((c) => c + 12)}>Toon 12 meer hotels (nog {hotelsShown.length - hCount})</button>}
              </>
            )}
          </section>
        </div>

        <footer className="rp-sheet-foot">
          <div>
            <div className="rp-foot-total">{sel && sel.cost && hotelSel ? eur(total) : "—"}</div>
            <div className="rp-pp">{sel && sel.cost && hotelSel ? `${eur(total / 2)} per persoon, vlucht + hotel` : "Kies een vlucht en een hotel"}</div>
          </div>
          <div className="rp-foot-actions">
            {sel && sel.cost && hotelSel ? (
              <button className="rp-btn pri rp-bookbtn" onClick={() => { setGuide("vlucht"); rsfx("takeoff"); }}>Boeken, stap voor stap</button>
            ) : (
              <>
                <a className={"rp-btn pri" + (!sel ? " dis" : "")} href={sel && sel.links ? (sel.links.find((l) => l.primary) || sel.links[0]).url : (initial && initial.flightUrl) || "#"} target="_blank" rel="noopener noreferrer">Zoek vlucht</a>
                <a className={"rp-btn pri" + (!hotelSel && !(hotelInfo.searchLinks || [])[0] ? " dis" : "")} href={hotelSel ? hotelSel.links[0].url : ((hotelInfo.searchLinks || [])[0] || {}).url || "#"} target="_blank" rel="noopener noreferrer">Zoek hotel</a>
              </>
            )}
            {trip && sel && sel.cost && hotelSel && (() => {
              const cur = saved && saved.owner === "replace" && saved.key === sel.id + hotelSel.id ? saved.state : null;
              return (
                <button className={"rp-btn" + (cur === "ok" ? " acc" : " pri")} data-sfx="own" disabled={unchanged || cur === "busy"} onClick={replace}>
                  {unchanged ? "Dit is jullie reis" : cur === "busy" ? "Bezig…" : cur === "ok" ? "✓ Reis bijgewerkt" : cur === "err" ? "Mislukt, probeer opnieuw" : "Wijzigingen opslaan"}
                </button>
              );
            })()}
            {!trip && sel && sel.cost && hotelSel && (
              <>
                {["justin", "quinty"].map((who) => {
                  const cur = saved && saved.key === sel.id + hotelSel.id && saved.owner === who ? saved.state : null;
                  const name = who === "quinty" ? "Quinty" : "Justin";
                  return (
                    <button key={who} className={"rp-btn" + (cur === "ok" ? " acc" : "")} data-sfx="own" disabled={cur === "busy"} onClick={() => save(who)}>
                      {cur === "busy" ? "Bezig…" : cur === "ok" ? `✓ Bewaard bij ${name}` : cur === "err" ? "Mislukt, probeer opnieuw" : `Bewaar bij ${name}`}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </footer>
      </div>
      {guide && sel && hotelSel && <BookingGuide r={buildResult()} trip={trip} start={guide} onClose={() => setGuide(null)} onBooked={onBooked} />}
      {mapHotel && <HotelMapModal hotel={mapHotel} city={dest.lite} place={places[mapHotel.id]} onClose={() => setMapHotel(null)} />}
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
    </svg>
  );
}

function HotelCard({ h, on, onPick, onHover, onMap, place, city }) {
  const [i, setI] = useState(0);
  const photos = h.photos.length ? h.photos : [""];
  return (
    <article id={"hotel-" + h.id} className={"rp-hotel" + (on ? " on" : "")} onMouseEnter={() => onHover && onHover(h.id)} onMouseLeave={() => onHover && onHover(null)}>
      <div className="rp-hotel-img">
        {photos[i] ? <img src={photos[i]} alt={h.name} loading="lazy" /> : <div className="rp-hotel-noimg" />}
        {photos.length > 1 && (
          <>
            <button className="rp-img-nav l" onClick={() => setI((i - 1 + photos.length) % photos.length)} aria-label="Vorige foto">‹</button>
            <button className="rp-img-nav r" onClick={() => setI((i + 1) % photos.length)} aria-label="Volgende foto">›</button>
            <span className="rp-img-count">{i + 1}/{photos.length}</span>
          </>
        )}
        {h.ai && <span className={"rp-img-ai" + (h.ai.score < 6 ? " lo" : "")}>Foto's {h.ai.score}/10</span>}
        {h.lat ? <button className="rp-img-map" onClick={onMap}><PinIcon /> Op de kaart</button> : null}
      </div>
      <div className="rp-hotel-body">
        <div className="rp-hotel-name">{h.name}</div>
        <LocationLink hotel={h} city={city} place={place} onOpen={onMap} />
        <div className="rp-leg-s">
          <span className="rp-stars">{"★".repeat(Math.round(h.stars || 0))}</span>
          {h.rating ? ` ${String(h.rating).replace(".", ",")}` : ""}{h.reviews ? ` (${h.reviews} reviews)` : ""}
        </div>
        <div className="rp-meta" style={{ marginTop: 8 }}>
          {h.boardLabel && <span className="rp-pill">{h.boardLabel}</span>}
          {h.pool && <span className="rp-pill">Zwembad</span>}
          {h.beachfront && <span className="rp-pill">Aan het strand</span>}
          {h.refundable && <span className="rp-pill ok">Gratis annuleren</span>}
          {h.deal && <span className="rp-pill deal">Topdeal</span>}
        </div>
        {(h.boards || []).length > 1 && (
          <div className="rp-boards">
            {h.boards.slice(0, 4).map((b) => (
              <span key={b.code}>{b.label} <b>{eur(b.price)}</b></span>
            ))}
          </div>
        )}
        {!h.refundable && h.refundPrice ? <p className="rp-hint" style={{ marginTop: 6 }}>Met gratis annuleren: {eur(h.refundPrice)} (+{eur(h.refundPrice - h.price)})</p> : null}
        {h.ai && h.ai.reden && <p className="rp-hint" style={{ marginTop: 8 }}>{h.ai.reden}</p>}
        <Reviews hotelId={h.id} />
        <div className="rp-hotel-foot">
          <div>
            <div className="rp-hotel-price">{eur(h.price)}</div>
            <div className="rp-pp">{eur(h.perNight)} per nacht</div>
          </div>
          <button className={"rp-btn" + (on ? " acc" : "")} onClick={onPick}>{on ? "Gekozen" : "Kies dit hotel"}</button>
        </div>
      </div>
    </article>
  );
}

function Loading({ label }) {
  return (
    <div className="rp-loading">
      <div className="rp-runway"><i /></div>
      <span>{label}</span>
    </div>
  );
}

// Klimaat (gem. max per maand) + praktische landinfo
function DestInfo({ dest, date }) {
  const info = countryInfo(dest, date);
  const [rate, setRate] = useState(null);
  useEffect(() => {
    let off = false;
    fetch(`/api/reis/info?dest=${encodeURIComponent(dest.id)}`).then((x) => x.json()).then((d) => !off && setRate(d.rate || null)).catch(() => {});
    return () => { off = true; };
  }, [dest.id]);
  const m = date ? new Date(date.slice(0, 10) + "T12:00:00Z").getUTCMonth() : -1;
  const max = Math.max(...dest.temp), min = Math.min(...dest.temp, 0);
  return (
    <section className="rp-destinfo">
      <div className="rp-climate" aria-label="Gemiddelde maximumtemperatuur per maand">
        {dest.temp.map((t, i) => (
          <div key={i} className={"rp-climate-col" + (i === m ? " on" : "")} title={`${MON[i]}: ${t}°`}>
            <span className="v">{t}°</span>
            <span className="b" style={{ height: Math.max(8, ((t - min) / Math.max(1, max - min)) * 56) + "px" }} />
            <span className="l">{MON[i].slice(0, 1)}</span>
          </div>
        ))}
      </div>
      {info && (
        <div className="rp-infopills">
          <span className="rp-pill">{info.diffLabel}</span>
          <span className="rp-pill">{info.currency}{rate ? `, 1 euro = ${Number(rate.perEur) >= 100 ? Math.round(rate.perEur).toLocaleString("nl-NL") : Number(rate.perEur).toLocaleString("nl-NL", { maximumFractionDigits: 2 })} ${rate.code}` : ""}</span>
          <span className={"rp-pill" + (info.needsAdapter ? " temp" : "")}>{info.plug}</span>
          <a className="rp-pill rp-pill-link" href={info.advies} target="_blank" rel="noopener noreferrer">Reisadvies</a>
        </div>
      )}
    </section>
  );
}

// Kalender: per vertrekdag de goedkoopste vlucht, gekleurd van goedkoop
// (groen) naar duur. Klik = die vlucht kiezen.
function PriceCalendar({ flights, sel, onPick }) {
  const byDay = new Map();
  for (const f of flights) {
    const cur = byDay.get(f.depart);
    if (!cur || f.cost < cur.cost) byDay.set(f.depart, f);
  }
  if (!byDay.size) return null;
  const costs = [...byDay.values()].map((f) => f.cost);
  const lo = Math.min(...costs), hi = Math.max(...costs);
  const months = [...new Set([...byDay.keys()].map((d) => d.slice(0, 7)))].sort();
  return (
    <div className="rp-cal-wrap">
      {months.map((mk) => {
        const [y, mo] = mk.split("-").map(Number);
        const first = new Date(Date.UTC(y, mo - 1, 1));
        const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const lead = (first.getUTCDay() + 6) % 7; // maandag eerst
        const cells = [];
        for (let i = 0; i < lead; i++) cells.push(<span key={"x" + i} />);
        for (let d = 1; d <= days; d++) {
          const iso = `${mk}-${String(d).padStart(2, "0")}`;
          const f = byDay.get(iso);
          if (!f) { cells.push(<span key={iso} className="rp-cal-day off">{d}</span>); continue; }
          const lvl = hi === lo ? 0 : Math.min(4, Math.floor(((f.cost - lo) / (hi - lo)) * 5));
          cells.push(
            <button key={iso} className={"rp-cal-day lv" + lvl + (sel && sel.depart === iso ? " on" : "")} onClick={() => onPick(f)} title={`${d} ${MON[mo - 1]}: ${eur(f.cost)}, ${f.nights} nachten`}>
              <b>{d}</b>
              <span>{eur(f.cost).replace("€", "")}</span>
            </button>
          );
        }
        return (
          <div key={mk} className="rp-cal">
            <h4>{MONTHS_LONG[mo - 1]} {y}</h4>
            <div className="rp-cal-grid">
              {["ma", "di", "wo", "do", "vr", "za", "zo"].map((d) => <span key={d} className="rp-cal-dow">{d}</span>)}
              {cells}
            </div>
          </div>
        );
      })}
      <div className="rp-cal-legend"><span className="lv0" />goedkoop<span className="lv4" />duurder</div>
    </div>
  );
}
const MONTHS_LONG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

// Zoeklinks voor een hele maand (als er nog geen vaste data zijn)
function monthFlightLinks(dest, search) {
  const m = (search && search.when && search.when.months && search.when.months[0]) || new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const label = `${MONTHS_LONG[mo - 1]} ${y}`;
  const q = encodeURIComponent(`Flights from Amsterdam to ${dest.city.split(" ·")[0]} in ${["January","February","March","April","May","June","July","August","September","October","November","December"][mo - 1]} ${y}`);
  return [
    { label: `Google Flights (${label})`, url: `https://www.google.com/travel/flights?hl=nl&curr=EUR&q=${q}` },
    { label: `Skyscanner (${label})`, url: `https://www.skyscanner.nl/transport/vluchten/ams/${dest.iata[0].toLowerCase()}/?adultsv2=2&cabinclass=economy&rtn=1&oym=${String(y).slice(2)}${String(mo).padStart(2, "0")}&iym=${String(y).slice(2)}${String(mo).padStart(2, "0")}` },
  ];
}

// Echte gastenreviews: pluspunten, minpunten en een paar recente reviews
function Reviews({ hotelId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data) {
      fetch(`/api/reis/reviews?hotelId=${encodeURIComponent(hotelId)}`)
        .then((r) => r.json())
        .then(setData)
        .catch(() => setData({ reviews: [], pros: [], cons: [] }));
    }
  }
  return (
    <div className="rp-rev">
      <button className="rp-link" onClick={toggle} aria-expanded={open}>{open ? "Reviews verbergen" : "Lees wat gasten zeggen"}</button>
      {open && !data && <p className="rp-hint">Reviews laden…</p>}
      {open && data && (
        <div className="rp-rev-body">
          {data.pros && data.pros.length > 0 && (
            <ul className="rp-rev-list pro">{data.pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
          )}
          {data.cons && data.cons.length > 0 && (
            <ul className="rp-rev-list con">{data.cons.map((p, i) => <li key={i}>{p}</li>)}</ul>
          )}
          {(data.reviews || []).slice(0, 3).map((r, i) => (
            <div key={i} className="rp-rev-item">
              <div className="rp-rev-top">
                {r.score != null && <b>{String(r.score).replace(".", ",")}</b>}
                <span>{[r.name, r.type, r.date].filter(Boolean).join(", ")}</span>
              </div>
              {r.headline && <div className="rp-rev-head">"{r.headline}"</div>}
              {r.pros && <div className="rp-rev-pc pro">{r.pros}</div>}
              {r.cons && <div className="rp-rev-pc con">{r.cons}</div>}
            </div>
          ))}
          {!(data.reviews || []).length && !(data.pros || []).length && <p className="rp-hint">Nog geen reviews beschikbaar voor dit hotel.</p>}
        </div>
      )}
    </div>
  );
}
