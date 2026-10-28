"use client";

// Bewaarde reis openen: status (idee → favoriet → geboekt), aftellen,
// stemmen, landinfo, delen, boekingsnummers, gedeelde paklijst, notities.
import { useEffect, useMemo, useRef, useState } from "react";
import { DEST_BY_ID } from "@/lib/reis/destinations";
import { countryInfo } from "@/lib/reis/countryinfo";
import { makePackingList, PACK_CATS } from "@/lib/reis/packing";
import { eur, fmtDay, countdownLabel, daysUntil, whatsappUrl, shareTrip, PEOPLE, leaveDays } from "./fmt";
import { rsfx } from "./ReisSound";
import { confetti } from "./confetti";

const STATUS = [
  ["idee", "Idee"],
  ["favoriet", "Favoriet"],
  ["geboekt", "Geboekt"],
];

export default function TripSheet({ trip, user, onClose, onChanged }) {
  const [t, setT] = useState(trip);
  const [tab, setTab] = useState(trip.status === "geboekt" ? "paklijst" : "overzicht");
  const [toast, setToast] = useState("");
  useEffect(() => setT(trip), [trip]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const r = t.result;
  const dest = DEST_BY_ID[r.destId];
  const info = useMemo(() => countryInfo(dest, r.depart), [dest, r.depart]);
  const [live, setLive] = useState(null);
  useEffect(() => {
    let off = false;
    fetch(`/api/reis/info?dest=${encodeURIComponent(r.destId)}&depart=${r.depart}&ret=${r.ret}`)
      .then((x) => x.json()).then((d) => !off && setLive(d)).catch(() => {});
    return () => { off = true; };
  }, [r.destId, r.depart, r.ret]);

  async function patch(p, optimistic) {
    if (optimistic) setT((x) => ({ ...x, ...optimistic }));
    const res = await fetch("/api/reis/trips", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, ...p }) });
    if (res.ok) {
      const { trip: nt } = await res.json();
      setT(nt);
      onChanged && onChanged(nt);
    }
  }
  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  function setStatus(s) {
    if (s === t.status) return;
    if (s === "geboekt") {
      rsfx("fanfare");
      confetti();
    } else rsfx("toggle");
    patch({ status: s }, { status: s });
  }
  const myVote = Boolean(t.votes && t.votes[user && user.id]);
  const match = t.votes && t.votes.justin && t.votes.quinty;

  return (
    <div className="rp-sheet-wrap" role="dialog" aria-modal="true" aria-label={`Reis naar ${r.city}`}>
      <div className="rp-sheet-bg" onClick={onClose} />
      <div className="rp-sheet rp-trip">
        <header className="rp-sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="rp-city">{r.city}</div>
            <div className="rp-country">{fmtDay(r.depart)} tot {fmtDay(r.ret)}, {r.nights} nachten, {leaveDays(r.depart, r.ret)} verlofdagen</div>
          </div>
          <button className="rp-iconbtn" onClick={onClose} aria-label="Sluiten">✕</button>
        </header>

        <div className="rp-sheet-body">
          <div className="rp-trip-top">
            <div className="rp-seg" role="group" aria-label="Status">
              {STATUS.map(([id, l]) => (
                <button key={id} data-sfx="own" className={(t.status || "idee") === id ? "on" : ""} onClick={() => setStatus(id)}>{l}</button>
              ))}
            </div>
            {t.status === "geboekt" && daysUntil(r.depart) >= 0 && (
              <div className="rp-countdown">
                <b>{daysUntil(r.depart)}</b>
                <span>{daysUntil(r.depart) === 1 ? "dag" : "dagen"} tot vertrek</span>
              </div>
            )}
          </div>

          <div className="rp-subtabs" role="tablist">
            {[["overzicht", "Overzicht"], ["paklijst", `Paklijst${t.packing ? ` ${t.packing.filter((x) => x.done).length}/${t.packing.length}` : ""}`], ["notities", "Notities"]].map(([id, l]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{l}</button>
            ))}
          </div>

          {tab === "overzicht" && (
            <div className="rp-trip-grid">
              <section className="rp-home-card">
                <div className="rp-price">{eur(r.total)}</div>
                <div className="rp-pp">{eur(r.total / 2)} per persoon, alles samen</div>
                <div className="rp-break" style={{ marginTop: 12 }}>
                  <div><span>Vlucht {r.origin} → {r.airport}{r.flight.airlineName ? `, ${r.flight.airlineName}` : ""}</span><span>{eur(r.flight.cost)}</span></div>
                  <div><span>{r.hotel && r.hotel.name ? r.hotel.name : "Hotel"}</span><span>{eur(r.hotelTotal)}</span></div>
                </div>
                <div className="rp-btnrow" style={{ marginTop: 14 }}>
                  <a className="rp-btn pri" href={(r.links.flight.find((l) => l.primary) || r.links.flight[0]).url} target="_blank" rel="noopener noreferrer">Boek vlucht</a>
                  <a className="rp-btn pri" href={r.links.hotel[0].url} target="_blank" rel="noopener noreferrer">Boek hotel</a>
                </div>
              </section>

              <section className="rp-home-card">
                <h3 className="rp-card-h">Willen we dit allebei?</h3>
                <div className="rp-votes">
                  {["justin", "quinty"].map((p) => (
                    <span key={p} className={"rp-vote " + p + (t.votes && t.votes[p] ? " yes" : "")}>
                      <i>{PEOPLE[p][0]}</i>{PEOPLE[p]} {t.votes && t.votes[p] ? "wil" : "twijfelt nog"}
                    </span>
                  ))}
                </div>
                {match && <p className="rp-match">Match! Jullie willen allebei naar {r.city}.</p>}
                <button
                  className={"rp-btn" + (myVote ? " acc" : "")}
                  style={{ marginTop: 12, width: "100%" }}
                  data-sfx="own"
                  onClick={() => {
                    if (!myVote) rsfx("heart");
                    const votes = { ...(t.votes || {}), [user.id]: !myVote };
                    if (!myVote && votes.justin && votes.quinty) setTimeout(() => confetti(), 120);
                    patch({ vote: !myVote }, { votes });
                  }}
                >
                  {myVote ? "Ik wil hierheen ♥" : "Ik wil hierheen"}
                </button>
              </section>

              {info && (
                <section className="rp-home-card">
                  <h3 className="rp-card-h">Handig om te weten</h3>
                  <ul className="rp-facts">
                    <li><span>Tijd</span><b>{info.diffLabel}</b></li>
                    <li><span>Geld</span><b>{info.currency}{live && live.rate ? `, 1 euro = ${fmtRate(live.rate.perEur)} ${live.rate.code}` : ""}</b></li>
                    <li><span>Stekker</span><b>{info.plug}</b></li>
                    <li><span>Vliegen</span><b>±{Math.round(dest.hours)} uur</b></li>
                  </ul>
                  {live && live.forecast && live.forecast.length > 0 && (
                    <div className="rp-forecast" aria-label="Weersverwachting">
                      {live.forecast.map((f) => (
                        <div key={f.date} title={f.label}>
                          <span className="d">{fmtDay(f.date).split(" ").slice(0, 2).join(" ")}</span>
                          <span className="i" aria-hidden="true">{f.icon}</span>
                          <b>{f.max}°</b>
                          <span className="r">{f.rain != null ? `${f.rain}%` : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <a className="rp-link" href={info.advies} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 10 }}>Officieel reisadvies bekijken</a>
                </section>
              )}

              <section className="rp-home-card">
                <h3 className="rp-card-h">Delen</h3>
                <div className="rp-btnrow">
                  <a className="rp-btn" href={whatsappUrl(r)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  <button className="rp-btn" onClick={async () => { const how = await shareTrip(r); if (how) flash(how === "gekopieerd" ? "Gekopieerd" : "Gedeeld"); }}>Kopieer / deel</button>
                </div>
              </section>

              {t.status === "geboekt" && <Booking t={t} onSave={(b) => { patch({ booking: b }); flash("Opgeslagen"); }} />}
            </div>
          )}

          {tab === "paklijst" && <Packing t={t} user={user} onSave={(list) => patch({ packing: list }, { packing: list })} />}

          {tab === "notities" && <Notes t={t} onSave={(note) => { patch({ note }); flash("Opgeslagen"); }} />}
        </div>
        {toast && <div className="rp-toast" role="status">{toast}</div>}
      </div>
    </div>
  );
}

function Booking({ t, onSave }) {
  const [b, setB] = useState(t.booking || { flightRef: "", hotelRef: "", extra: "" });
  return (
    <section className="rp-home-card">
      <h3 className="rp-card-h">Boekingsgegevens</h3>
      <div style={{ display: "grid", gap: 10 }}>
        <label className="rp-field">Boekingsnummer vlucht<input className="rp-input" value={b.flightRef} onChange={(e) => setB({ ...b, flightRef: e.target.value })} placeholder="Bijvoorbeeld ABC123" /></label>
        <label className="rp-field">Bevestigingsnummer hotel<input className="rp-input" value={b.hotelRef} onChange={(e) => setB({ ...b, hotelRef: e.target.value })} /></label>
        <label className="rp-field">Extra (transfer, stoelen, ophaaltijd)<input className="rp-input" value={b.extra} onChange={(e) => setB({ ...b, extra: e.target.value })} /></label>
        <button className="rp-btn pri" onClick={() => onSave(b)}>Opslaan</button>
      </div>
    </section>
  );
}

function Notes({ t, onSave }) {
  const [v, setV] = useState(t.note || "");
  const dirty = v !== (t.note || "");
  return (
    <section>
      <textarea
        className="rp-input rp-notes"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => dirty && onSave(v)}
        placeholder="Restaurants die we willen proberen, uitjes, wat we nog moeten regelen…"
      />
      <p className="rp-hint">Wordt automatisch opgeslagen als je ergens anders klikt. Jullie zien allebei dezelfde notities.</p>
    </section>
  );
}

function Packing({ t, user, onSave }) {
  const [list, setList] = useState(t.packing || null);
  const [text, setText] = useState("");
  const [cat, setCat] = useState("Overig");
  const [hideDone, setHideDone] = useState(false);
  const timer = useRef(null);
  const pending = useRef(false);
  // Wijzigingen van de ander overnemen, behalve als jij net aan het vinken bent
  useEffect(() => { if (!pending.current) setList(t.packing || null); }, [t.packing]);

  function commit(next) {
    setList(next);
    pending.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { pending.current = false; onSave(next); }, 500);
  }

  if (!list) {
    return (
      <div className="rp-empty" style={{ padding: "12px 0" }}>
        <h2 style={{ fontSize: 28 }}>Paklijst maken</h2>
        <p>De planner maakt een lijst op maat voor deze reis: het weer daar, strand of stad, de vlucht, de stekker en het aantal nachten. Daarna kunnen jullie hem samen afvinken en aanvullen.</p>
        <button className="rp-go" style={{ maxWidth: 320 }} data-sfx="own" onClick={() => { rsfx("save"); commit(makePackingList(t)); }}>Maak onze paklijst</button>
      </div>
    );
  }
  const done = list.filter((x) => x.done).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  const cats = PACK_CATS.filter((c) => list.some((x) => x.cat === c)).concat([...new Set(list.map((x) => x.cat))].filter((c) => !PACK_CATS.includes(c)));

  return (
    <div className="rp-pack">
      <div className="rp-pack-head">
        <div>
          <b>{done} van {list.length} ingepakt</b>
          <div className="rp-bar"><i style={{ width: pct + "%" }} /></div>
        </div>
        <label className="rp-toggle" style={{ fontSize: 14 }}>
          <span>Verberg ingepakt</span>
          <span className="rp-switch"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /><i /></span>
        </label>
      </div>
      {pct === 100 && <p className="rp-match">Alles ingepakt. Goede reis!</p>}

      <form className="rp-pack-add" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; commit([...list, { id: "u" + Date.now().toString(36), text: text.trim(), cat, done: false, by: "" }]); setText(""); }}>
        <input className="rp-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Iets toevoegen" aria-label="Item toevoegen" />
        <select className="rp-select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categorie">
          {PACK_CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className="rp-btn pri" type="submit">Toevoegen</button>
      </form>

      {cats.map((c) => {
        const items = list.filter((x) => x.cat === c && (!hideDone || !x.done));
        if (!items.length) return null;
        return (
          <div key={c} className="rp-pack-cat">
            <h4>{c}</h4>
            <ul>
              {items.map((x) => (
                <li key={x.id} className={x.done ? "done" : ""}>
                  <label>
                    <input
                      type="checkbox"
                      checked={x.done}
                      onChange={() => {
                        if (!x.done) rsfx("check");
                        commit(list.map((y) => (y.id === x.id ? { ...y, done: !y.done, by: !y.done ? user.id : "" } : y)));
                      }}
                    />
                    <span className="rp-check" aria-hidden="true" />
                    <span className="txt">{x.text}</span>
                    {x.done && x.by && <span className={"rp-by " + x.by}>{x.by === "quinty" ? "Q" : "J"}</span>}
                  </label>
                  <button className="rp-x" aria-label={`${x.text} verwijderen`} onClick={() => commit(list.filter((y) => y.id !== x.id))}>✕</button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <button className="rp-link" style={{ marginTop: 18 }} onClick={() => { if (window.confirm("Paklijst opnieuw maken? Eigen items en vinkjes verdwijnen.")) commit(makePackingList(t)); }}>Paklijst opnieuw maken</button>
    </div>
  );
}

function fmtRate(v) {
  const n = Number(v);
  if (n >= 100) return Math.round(n).toLocaleString("nl-NL");
  return n.toLocaleString("nl-NL", { maximumFractionDigits: n < 1 ? 3 : 2 });
}
