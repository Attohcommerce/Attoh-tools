"use client";

// PRIJSKILLER! — scherm met betere varianten van een bewaarde reis.
import { useEffect, useState } from "react";
import { eur, fmtDay } from "./fmt";
import { rsfx } from "./ReisSound";
import { confetti } from "./confetti";

const KIND = {
  "zelfde-hotel": "Zelfde hotel, andere data",
  "ander-hotel": "Vergelijkbaar hotel in de buurt, zelfde data",
  "ander-hotel-andere-data": "Vergelijkbaar hotel in de buurt, andere data",
};

export default function PriceKiller({ trip, onClose, onReplaced, onSavedNew }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState(0);
  const [done, setDone] = useState({});
  const r = trip.result;

  useEffect(() => {
    rsfx("takeoff");
    const steps = setInterval(() => setStep((s) => Math.min(3, s + 1)), 2200);
    fetch("/api/reis/pricekiller", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: trip.id }) })
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(d.error || "Prijskiller mislukt");
        setData(d);
        if (d.options.some((o) => o.diff < 0)) { rsfx("fanfare"); confetti(); } else rsfx("chime");
      })
      .catch((e) => { setErr(e.message); rsfx("error"); })
      .finally(() => clearInterval(steps));
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { clearInterval(steps); window.removeEventListener("keydown", onKey); };
  }, [trip.id]); // eslint-disable-line

  async function replace(o) {
    setDone((d) => ({ ...d, [o.result.id]: "busy" }));
    const res = await fetch("/api/reis/trips", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: trip.id, result: o.result }) });
    if (res.ok) { rsfx("save"); setDone((d) => ({ ...d, [o.result.id]: "vervangen" })); onReplaced && onReplaced(); }
    else setDone((d) => ({ ...d, [o.result.id]: "fout" }));
  }
  async function saveNew(o) {
    setDone((d) => ({ ...d, [o.result.id + "n"]: "busy" }));
    const res = await fetch("/api/reis/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner: trip.owner, result: o.result, search: trip.search }) });
    if (res.ok) { rsfx("save"); setDone((d) => ({ ...d, [o.result.id + "n"]: "bewaard" })); onSavedNew && onSavedNew(); }
    else setDone((d) => ({ ...d, [o.result.id + "n"]: "fout" }));
  }

  const best = data && data.options[0];
  const STEPS = ["Vluchten rond jullie data verzamelen", "Jullie hotel op andere data checken", "Vergelijkbare hotels in de buurt zoeken", "Beste combinaties uitrekenen"];

  return (
    <div className="rp-sheet-wrap" role="dialog" aria-modal="true" aria-label="Prijskiller">
      <div className="rp-sheet-bg" onClick={onClose} />
      <div className="rp-sheet rp-pk">
        <header className="rp-sheet-head rp-pk-head">
          <div>
            <div className="rp-pk-title"><Bolt /> Prijskiller!</div>
            <div className="rp-country">{r.city}, {fmtDay(r.depart)} tot {fmtDay(r.ret)}, nu {eur(r.total)}</div>
          </div>
          <button className="rp-iconbtn" onClick={onClose} aria-label="Sluiten">✕</button>
        </header>
        <div className="rp-sheet-body">
          {!data && !err && (
            <div className="rp-pk-run">
              <div className="rp-pk-bolt"><Bolt size={42} /></div>
              <ol>
                {STEPS.map((s, i) => <li key={i} className={i < step ? "done" : i === step ? "now" : ""}>{s}</li>)}
              </ol>
              <div className="rp-runway"><i /></div>
            </div>
          )}
          {err && <div className="rp-note"><span>{err}</span></div>}
          {data && (
            <>
              <div className={"rp-pk-verdict" + (best && best.diff < 0 ? " win" : "")}>
                {best && best.diff < 0 ? (
                  <>
                    <b>Gekilld: tot {eur(-best.diff)} goedkoper</b>
                    <span>{best.label}. {data.options.filter((o) => o.diff < 0).length} goedkopere opties gevonden.</span>
                  </>
                ) : best ? (
                  <>
                    <b>Niet goedkoper, wel meer reis voor bijna hetzelfde</b>
                    <span>Jullie huidige prijs is al scherp. Hieronder: langer weg voor een kleine meerprijs.</span>
                  </>
                ) : (
                  <>
                    <b>Jullie hebben al de beste deal</b>
                    <span>Geen goedkopere combinatie gevonden rond deze data en in de buurt van dit hotel.</span>
                  </>
                )}
                <small>{data.stats.flightsChecked.toLocaleString("nl-NL")} vluchtopties, {data.stats.datesChecked} datumcombinaties en {data.stats.hotelsChecked} hotelprijzen gecheckt in {Math.max(1, Math.round(data.stats.ms / 1000))} sec.</small>
              </div>

              {data.base && data.base.total !== r.total && (
                <div className="rp-note" style={{ background: "var(--surface)" }}>
                  <span>Jullie huidige reis kost vandaag <b>{eur(data.base.total)}</b> ({data.base.total < r.total ? `${eur(r.total - data.base.total)} goedkoper` : `${eur(data.base.total - r.total)} duurder`} dan toen jullie hem bewaarden).</span>
                </div>
              )}

              <div className="rp-pk-list">
                {data.options.map((o) => {
                  const st = done[o.result.id], st2 = done[o.result.id + "n"];
                  return (
                    <article key={o.result.id} className="rp-pk-opt">
                      <div className="rp-pk-opt-main">
                        <span className="rp-pk-kind">{KIND[o.kind]}</span>
                        <b className="rp-pk-label">{o.label || "Andere combinatie"}</b>
                        <div className="rp-pk-dates">{fmtDay(o.depart)} tot {fmtDay(o.ret)}, {o.nights} nachten{o.origin !== r.origin ? `, vanaf ${o.result.originName}` : ""}</div>
                        <div className="rp-leg-s">
                          {o.hotel.name}{o.hotel.distKm ? ` (${o.hotel.distKm.toFixed(1).replace(".", ",")} km van jullie hotel)` : ""}, {"★".repeat(Math.round(o.hotel.stars || 0))}{o.hotel.rating ? ` ${String(o.hotel.rating).replace(".", ",")}` : ""}, {String(o.hotel.boardLabel || "").toLowerCase()}
                        </div>
                        <div className="rp-leg-s">Vlucht {eur(o.flight.cost)}{o.flight.airlineName ? `, ${o.flight.airlineName}` : ""} · hotel {eur(o.hotelTotal)}</div>
                      </div>
                      <div className="rp-pk-opt-side">
                        <div className="rp-pk-total">{eur(o.total)}</div>
                        <div className={"rp-pk-diff" + (o.diff < 0 ? " dn" : " up")}>{o.diff < 0 ? `−${eur(-o.diff)}` : `+${eur(o.diff)}`}</div>
                        <div className="rp-pp">{eur(o.perNight)} per nacht</div>
                        <div className="rp-pk-actions">
                          <button className="rp-btn pri" disabled={st === "busy" || st === "vervangen"} onClick={() => replace(o)}>{st === "vervangen" ? "✓ Vervangen" : st === "busy" ? "Bezig…" : st === "fout" ? "Mislukt" : "Vervang onze reis"}</button>
                          <button className="rp-btn" disabled={st2 === "busy" || st2 === "bewaard"} onClick={() => saveNew(o)}>{st2 === "bewaard" ? "✓ Bewaard" : st2 === "busy" ? "Bezig…" : "Bewaar als extra reis"}</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <p className="rp-hint">Hij zocht van {data.stats.months.map((m) => ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"][Number(m.slice(5, 7)) - 1]).join(" t/m ").replace(/ t\/m .* t\/m /, " t/m ")}, {Math.max(3, r.nights - 3)} tot {r.nights + 4} nachten, en vergelijkbare hotels binnen 3 km.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Bolt({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 2 4 13.5h6.2L9 22l11-12.5h-6.4L13.5 2Z" />
    </svg>
  );
}

export function PriceKillerButton({ onClick, small }) {
  return (
    <button className={"rp-killbtn" + (small ? " sm" : "")} data-sfx="own" onClick={onClick}>
      <Bolt /> Prijskiller!
    </button>
  );
}
