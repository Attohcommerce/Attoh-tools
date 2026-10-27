"use client";

// Homescreen: begroeting + vertrekbord, snelle knoppen, waar het de komende
// maanden warm is (klik = alle opties), jullie bewaarde reizen en of de
// prijsbronnen live zijn.
import { useMemo, useState } from "react";
import { DESTINATIONS } from "@/lib/reis/destinations";
import FlapBoard from "./FlapBoard";

const MON_LONG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MON = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const eur = (n) => "€" + Math.round(n || 0).toLocaleString("nl-NL");
const fmtDay = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};

// Kleur per regio voor de kaartjes (zee, woestijn, tropen…)
const REGION_TONE = {
  "Middellandse Zee": ["#2d7dd2", "#7cc6fe"],
  "Canarische Eilanden": ["#f08a24", "#ffd166"],
  "Atlantische kust": ["#1b998b", "#8fe3cf"],
  Europa: ["#5a4fcf", "#a79cff"],
  "Rode Zee": ["#e4572e", "#ffb07c"],
  "Noord-Afrika": ["#c8553d", "#f2b880"],
  "Atlantische Oceaan": ["#0f8b8d", "#7fd8be"],
  "Midden-Oosten": ["#d4a017", "#ffe08a"],
  "Zuidoost-Azië": ["#16a34a", "#86efac"],
  "Indische Oceaan": ["#0891b2", "#67e8f9"],
  Afrika: ["#b45309", "#fcd34d"],
  "Caribisch gebied": ["#0ea5e9", "#5eead4"],
  "Noord-Amerika": ["#334155", "#94a3b8"],
};

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "Goedenacht";
  if (h < 12) return "Goedemorgen";
  if (h < 18) return "Goedemiddag";
  return "Goedenavond";
}

export default function Home({ user, live, trips, onSearchTab, onSurprise, onOpenDest, onTripsTab }) {
  const months = useMemo(() => {
    const n = new Date();
    return [1, 2, 3].map((i) => {
      const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + i, 1));
      return { key: d.toISOString().slice(0, 7), m: d.getUTCMonth() };
    });
  }, []);
  const [mi, setMi] = useState(0);
  const month = months[mi];
  const warm = useMemo(
    () =>
      DESTINATIONS.filter((d) => d.temp[month.m] >= 26 && d.tags.some((t) => t === "strand" || t === "zon"))
        .sort((a, b) => b.beach * 2 + b.temp[month.m] - (a.beach * 2 + a.temp[month.m]))
        .slice(0, 12),
    [month]
  );
  const recent = trips.slice(0, 3);
  const drops = trips.filter((t) => {
    const h = (t.priceHistory || []).map((p) => p.total).filter(Boolean);
    return h.length > 1 && h[h.length - 1] < h[0];
  });

  return (
    <div className="rp-home">
      <section className="rp-hero">
        <div className="rp-hero-copy">
          <p className="rp-hello">{greeting()}{user ? `, ${user.name}` : ""}</p>
          <h1>Meer zon.<br />Minder euro's.</h1>
          <p className="rp-hero-sub">Zeg wanneer jullie weg willen en waar je zin in hebt. De planner legt elke vlucht naast elk hotel en zoekt de goedkoopste mooie combinatie.</p>
          <div className="rp-hero-cta">
            <button className="rp-go" onClick={onSearchTab}>Plan een reis</button>
            <button className="rp-btn rp-surprise" data-sfx="own" onClick={onSurprise}>Verras ons</button>
          </div>
        </div>
        <div className="rp-hero-board">
          <FlapBoard rows={5} />
        </div>
      </section>

      <section className="rp-home-sec">
        <div className="rp-home-sec-head">
          <h2>Lekker warm in {MON_LONG[month.m]}</h2>
          <div className="rp-seg">
            {months.map((m, i) => (
              <button key={m.key} className={mi === i ? "on" : ""} onClick={() => setMi(i)}>{MON[m.m]}</button>
            ))}
          </div>
        </div>
        <div className="rp-dests">
          {warm.map((d) => {
            const tone = REGION_TONE[d.region] || ["#2160e8", "#7cc6fe"];
            return (
              <button key={d.id} className="rp-destcard" onClick={() => onOpenDest(d, month.key)}>
                <span className="rp-destcard-top" style={{ background: `linear-gradient(135deg, ${tone[0]}, ${tone[1]})` }}>
                  <span className="rp-destcard-temp">{d.temp[month.m]}°</span>
                </span>
                <span className="rp-destcard-body">
                  <b>{d.city}</b>
                  <span>{d.country}</span>
                  <span className="rp-destcard-meta">
                    {Math.round(d.hours)} uur vliegen{d.beach >= 8 ? ", mooi strand" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="rp-hint">Klik op een bestemming voor alle vluchten en hotels in {MON_LONG[month.m]}.</p>
      </section>

      <section className="rp-home-grid">
        <div className="rp-home-card">
          <div className="rp-home-sec-head">
            <h2>Onze reizen</h2>
            {trips.length > 0 && <button className="rp-link" onClick={onTripsTab}>Alles bekijken ({trips.length})</button>}
          </div>
          {recent.length === 0 ? (
            <p className="rp-lede" style={{ margin: 0 }}>Nog niets bewaard. Vind een reis en druk op Bewaren, dan staat hij hier voor jullie allebei.</p>
          ) : (
            <ul className="rp-mini">
              {recent.map((t) => {
                const h = (t.priceHistory || []).map((p) => p.total).filter(Boolean);
                const now = h[h.length - 1] || t.result.total;
                return (
                  <li key={t.id}>
                    <span className={"rp-owner " + t.owner}><i>{t.owner === "quinty" ? "Q" : "J"}</i></span>
                    <span className="rp-mini-main"><b>{t.result.city}</b><span>{fmtDay(t.result.depart)} tot {fmtDay(t.result.ret)}</span></span>
                    <span className="rp-mini-price">{eur(now)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {drops.length > 0 && <p className="rp-drop" style={{ marginTop: 12 }}>{drops.length === 1 ? "1 bewaarde reis is goedkoper geworden" : `${drops.length} bewaarde reizen zijn goedkoper geworden`}</p>}
        </div>

        <div className="rp-home-card">
          <h2>Prijsbronnen</h2>
          <ul className="rp-status">
            <li><span className={"dot" + (live && live.flights ? " on" : "")} />Vluchtprijzen<span>{live && live.flights ? "live" : "nog koppelen (Travelpayouts)"}</span></li>
            <li><span className={"dot" + (live && live.hotels ? " on" : "")} />Hotelprijzen en foto's<span>{live && live.hotels ? "live" : "nog koppelen (LiteAPI)"}</span></li>
            <li><span className={"dot" + (live && live.vision ? " on" : "")} />AI-fotocheck<span>{live && live.vision ? "aan" : "uit"}</span></li>
            <li><span className={"dot" + (live && live.duffel ? " on" : "")} />Live controle top 5<span>{live && live.duffel ? "aan" : "optioneel (Duffel)"}</span></li>
          </ul>
        </div>
      </section>
    </div>
  );
}
