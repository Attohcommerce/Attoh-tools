"use client";

// Homescreen: begroeting + vertrekbord, snelle knoppen, waar het de komende
// maanden warm is (klik = alle opties), jullie bewaarde reizen en of de
// prijsbronnen live zijn.
import { useEffect, useMemo, useState } from "react";
import { DESTINATIONS } from "@/lib/reis/destinations";
import FlapBoard from "./FlapBoard";
import { daysUntil } from "./fmt";

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

export default function Home({ user, live, trips, fresh = [], recent = [], onRerun, onOpenTrip, onSearchTab, onSurprise, onOpenDest, onTripsTab }) {
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
  const isMatch = (t) => t.votes && t.votes.justin && t.votes.quinty;
  const shortlist = [...trips].sort((a, b) => (isMatch(b) ? 1 : 0) - (isMatch(a) ? 1 : 0)).slice(0, 4);
  const next = trips
    .filter((t) => t.status === "geboekt" && daysUntil(t.result.depart) >= 0)
    .sort((a, b) => (a.result.depart < b.result.depart ? -1 : 1))[0];
  const nextDays = next ? daysUntil(next.result.depart) : null;
  const packed = next && next.packing ? next.packing.filter((x) => x.done).length : 0;
  const drops = trips.filter((t) => {
    const h = (t.priceHistory || []).map((p) => p.total).filter(Boolean);
    return h.length > 1 && h[h.length - 1] < h[0];
  });

  return (
    <div className="rp-home">

      {fresh.length > 0 && (
        <button className="rp-fresh" onClick={onTripsTab}>
          <span className={"rp-owner " + fresh[0].savedBy}><i>{fresh[0].savedBy === "quinty" ? "Q" : "J"}</i></span>
          <span>
            <b>{fresh[0].savedBy === "quinty" ? "Quinty" : "Justin"} heeft {fresh.length === 1 ? "een nieuwe reis" : `${fresh.length} nieuwe reizen`} bewaard</b>
            <span>{fresh.slice(0, 3).map((t) => t.result.city).join(", ")}. Stem mee met een hartje.</span>
          </span>
          <span className="rp-fresh-go">Bekijken</span>
        </button>
      )}

      {next && (
        <button className="rp-next" onClick={() => onOpenTrip(next)}>
          <span className="rp-next-num">{nextDays}</span>
          <span className="rp-next-txt">
            <b>{nextDays === 0 ? `Vandaag naar ${next.result.city}!` : `${nextDays === 1 ? "dag" : "dagen"} tot ${next.result.city}`}</b>
            <span>{fmtDay(next.result.depart)} tot {fmtDay(next.result.ret)}, vanaf {next.result.originName}</span>
          </span>
          <span className="rp-next-pack">
            {next.packing ? (
              <>
                <span>Paklijst {packed}/{next.packing.length}</span>
                <span className="rp-bar"><i style={{ width: Math.round((packed / Math.max(1, next.packing.length)) * 100) + "%" }} /></span>
              </>
            ) : (
              <span>Paklijst maken</span>
            )}
          </span>
        </button>
      )}

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

      {recent.length > 0 && (
        <section className="rp-home-sec">
          <div className="rp-home-sec-head"><h2>Nog eens zoeken</h2></div>
          <div className="rp-chips">
            {recent.map((r) => (
              <button key={r.at} className="rp-chip rp-recent" onClick={() => onRerun(r.form)}>
                <RefreshIcon />{r.label}
              </button>
            ))}
          </div>
        </section>
      )}

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
          {shortlist.length === 0 ? (
            <p className="rp-lede" style={{ margin: 0 }}>Nog niets bewaard. Vind een reis en druk op Bewaren, dan staat hij hier voor jullie allebei.</p>
          ) : (
            <ul className="rp-mini">
              {shortlist.map((t) => {
                const h = (t.priceHistory || []).map((p) => p.total).filter(Boolean);
                const now = h[h.length - 1] || t.result.total;
                return (
                  <li key={t.id}>
                    <button className="rp-mini-btn" onClick={() => onOpenTrip(t)}>
                      <span className={"rp-owner " + t.owner}><i>{t.owner === "quinty" ? "Q" : "J"}</i></span>
                      <span className="rp-mini-main">
                        <b>{t.result.city}{isMatch(t) ? <em className="rp-match-tag">Match</em> : null}{t.status === "geboekt" ? <em className="rp-match-tag booked">Geboekt</em> : null}</b>
                        <span>{fmtDay(t.result.depart)} tot {fmtDay(t.result.ret)}</span>
                      </span>
                      <span className="rp-mini-price">{eur(now)}</span>
                    </button>
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
          <InstallTip />
        </div>
      </section>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" />
    </svg>
  );
}

// Tip om de planner als app op het beginscherm te zetten (alleen tonen als
// hij nog niet als app geopend is).
function InstallTip() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone;
    setShow(!standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
  }, []);
  if (!show) return null;
  return (
    <p className="rp-install">
      <b>Tip:</b> zet de planner op je beginscherm, dan opent hij als app.{" "}
      {ios ? "iPhone: tik op Deel en dan op Zet op beginscherm." : "Android: menu (drie puntjes) en dan App installeren of Toevoegen aan startscherm."}
    </p>
  );
}
