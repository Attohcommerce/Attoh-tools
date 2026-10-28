"use client";

// Bestemming openen: stap 1 vlucht kiezen, stap 2 hotel kiezen, onderaan
// het totaal + boekknoppen. Zo simpel als een reisbureau-folder.
import { useEffect, useMemo, useState } from "react";
import { rsfx } from "./ReisSound";
import { countryInfo } from "@/lib/reis/countryinfo";
import { leaveDays } from "./fmt";

const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MON = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const eur = (n) => "€" + Math.round(n || 0).toLocaleString("nl-NL");
const fmtDay = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};

export default function Explore({ dest, search, initial, onClose, onSave }) {
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

  // Escape sluit, achtergrond niet laten scrollen
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let off = false;
    setFlights(null);
    fetch("/api/reis/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ search, destId: dest.id, what: "flights" }) })
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        if (d.error) throw new Error(d.error);
        setFlights(d.flights || []);
        setFlightLive(d.live !== false);
        const pick = (initial && (d.flights || []).find((f) => f.depart === initial.depart && f.ret === initial.ret)) || (d.flights || [])[0];
        if (pick) setSel(pick);
        else if (initial) setSel({ id: "init", depart: initial.depart, ret: initial.ret, nights: initial.nights, estimate: true });
      })
      .catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [dest.id]); // eslint-disable-line

  useEffect(() => {
    if (!sel) return;
    let off = false;
    setHotels(null);
    setHotelSel(null);
    fetch("/api/reis/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ search, destId: dest.id, what: "hotels", checkin: sel.depart, checkout: sel.ret }) })
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        if (d.error) throw new Error(d.error);
        setHotels(d.hotels || []);
        setHotelInfo({ live: d.live !== false, searchLinks: d.searchLinks || [], nights: d.nights });
        if (d.hotels && d.hotels[0]) setHotelSel(d.hotels[0]);
      })
      .catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [sel && sel.depart, sel && sel.ret]); // eslint-disable-line

  const nightsOptions = useMemo(() => [...new Set((flights || []).map((f) => f.nights))].sort((a, b) => a - b), [flights]);
  const shownFlights = (flights || []).filter((f) => nightsFilter === "alle" || f.nights === nightsFilter);
  const visible = showAll ? shownFlights : shownFlights.slice(0, 8);
  const total = (sel && sel.cost ? sel.cost : 0) + (hotelSel ? hotelSel.price : 0);

  function save(owner) {
    if (!sel || !sel.cost || !hotelSel) return;
    onSave({
      id: `${dest.id}-${sel.depart}-${sel.ret}-${sel.origin}-${hotelSel.id}`,
      destId: dest.id, cc: dest.cc, city: dest.city, country: dest.country, tags: dest.tags, hours: dest.hours, beach: dest.beach,
      temp: dest.temp[new Date(sel.depart + "T12:00:00Z").getUTCMonth()],
      origin: sel.origin, originName: sel.originName, airport: sel.airport,
      depart: sel.depart, ret: sel.ret, nights: sel.nights,
      flight: { estimate: false, airline: sel.airline, airlineName: sel.airlineName, stopsOut: sel.stopsOut, stopsBack: sel.stopsBack, ticket: sel.ticket, bag: sel.bag, toAirport: sel.toAirport, cost: sel.cost, departTime: sel.departTime, returnTime: sel.returnTime },
      hotel: { id: hotelSel.id, name: hotelSel.name, stars: hotelSel.stars, rating: hotelSel.rating, boardLabel: hotelSel.boardLabel, photo: hotelSel.photos[0] },
      hotelTotal: hotelSel.price, hotelEstimate: false,
      total, perPerson: Math.round(total / 2), alts: [],
      links: { flight: sel.links, hotel: hotelSel.links, packages: [] },
    }, owner);
  }

  return (
    <div className="rp-sheet-wrap" role="dialog" aria-modal="true" aria-label={`Alle opties voor ${dest.city}`}>
      <div className="rp-sheet-bg" onClick={onClose} />
      <div className="rp-sheet">
        <header className="rp-sheet-head">
          <div>
            <div className="rp-city">{dest.city}</div>
            <div className="rp-country">{dest.country !== dest.city ? `${dest.country}, ` : ""}{Math.round(dest.hours)} uur vliegen</div>
          </div>
          <button className="rp-iconbtn" onClick={onClose} aria-label="Sluiten">✕</button>
        </header>

        <div className="rp-sheet-body">
          {err && <div className="rp-note"><span>{err}</span></div>}

          <DestInfo dest={dest} date={sel ? sel.depart : (search && search.when && search.when.months && search.when.months[0] ? search.when.months[0] + "-15" : null)} />

          <section>
            <h3 className="rp-step"><i>1</i>Kies jullie vlucht</h3>
            {!flights && <Loading label="Alle vertrekdagen en vliegvelden afzoeken" />}
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
            {flights && flightLive && flights.length === 0 && <div className="rp-note"><span>Geen vluchten gevonden die aan jullie eisen voldoen in deze periode. Probeer een andere maand of sta 1 overstap toe.</span></div>}
            {flights && flightLive && flights.length > 0 && (
              <>
                <div className="rp-seg rp-viewseg">
                  <button className={view === "lijst" ? "on" : ""} onClick={() => setView("lijst")}>Lijst</button>
                  <button className={view === "kalender" ? "on" : ""} onClick={() => setView("kalender")}>Prijskalender</button>
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
                        <span>{f.nights} nachten, vanaf {f.originName}</span>
                        <span className="rp-muted">{f.airlineName}, {f.stopsOut === 0 && f.stopsBack === 0 ? "direct" : "1 overstap"}{f.departTime ? `, vertrek ${f.departTime}` : ""}, {leaveDays(f.depart, f.ret)} verlofdagen</span>
                      </span>
                      <span className="rp-fopt-price">{eur(f.cost)}{i === 0 && nightsFilter === "alle" && <small>goedkoopst</small>}</span>
                    </button>
                  ))}
                </div>}
                {view === "lijst" && shownFlights.length > 8 && !showAll && <button className="rp-btn" style={{ marginTop: 10, width: "100%" }} onClick={() => setShowAll(true)}>Toon alle {shownFlights.length} vluchten</button>}
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
            {hotels && hotelInfo.live && hotels.length === 0 && <div className="rp-note"><span>Geen hotels gevonden met deze eisen. Zet de reviewscore lager of kies "Maakt niet uit" bij maaltijden.</span></div>}
            {hotels && hotels.length > 0 && (
              <div className="rp-hotels">
                {hotels.map((h) => (
                  <HotelCard key={h.id} h={h} on={hotelSel && hotelSel.id === h.id} onPick={() => setHotelSel(h)} />
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="rp-sheet-foot">
          <div>
            <div className="rp-foot-total">{sel && sel.cost && hotelSel ? eur(total) : "—"}</div>
            <div className="rp-pp">{sel && sel.cost && hotelSel ? `${eur(total / 2)} per persoon, vlucht + hotel` : "Kies een vlucht en een hotel"}</div>
          </div>
          <div className="rp-foot-actions">
            <a className={"rp-btn pri" + (!sel ? " dis" : "")} href={sel && sel.links ? (sel.links.find((l) => l.primary) || sel.links[0]).url : (initial && initial.flightUrl) || "#"} target="_blank" rel="noopener noreferrer">Boek vlucht</a>
            <a className={"rp-btn pri" + (!hotelSel && !(hotelInfo.searchLinks || [])[0] ? " dis" : "")} href={hotelSel ? hotelSel.links[0].url : ((hotelInfo.searchLinks || [])[0] || {}).url || "#"} target="_blank" rel="noopener noreferrer">Boek hotel</a>
            {sel && sel.cost && hotelSel && (
              <>
                <button className="rp-btn" data-sfx="own" onClick={() => save("justin")}>Bewaar bij Justin</button>
                <button className="rp-btn" data-sfx="own" onClick={() => save("quinty")}>Bewaar bij Quinty</button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function HotelCard({ h, on, onPick }) {
  const [i, setI] = useState(0);
  const photos = h.photos.length ? h.photos : [""];
  return (
    <article className={"rp-hotel" + (on ? " on" : "")}>
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
      </div>
      <div className="rp-hotel-body">
        <div className="rp-hotel-name">{h.name}</div>
        <div className="rp-leg-s">
          <span className="rp-stars">{"★".repeat(Math.round(h.stars || 0))}</span>
          {h.rating ? ` ${String(h.rating).replace(".", ",")}` : ""}{h.reviews ? ` (${h.reviews} reviews)` : ""}
        </div>
        <div className="rp-meta" style={{ marginTop: 8 }}>
          {h.boardLabel && <span className="rp-pill">{h.boardLabel}</span>}
          {h.pool && <span className="rp-pill">Zwembad</span>}
          {h.beachfront && <span className="rp-pill">Aan het strand</span>}
          {h.refundable && <span className="rp-pill ok">Gratis annuleren</span>}
        </div>
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
