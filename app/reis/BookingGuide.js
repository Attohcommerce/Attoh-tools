"use client";

// BOEKHULP (28-10-2026) — in plaats van "klik → onduidelijke buitenlandse
// site" eerst een rustig scherm: precies WAT je boekt (data, tijden,
// vluchtnummer, bagage, kamer), WAAR je het het makkelijkst boekt (met
// uitleg per site), een checklist, en daarna de boekingscodes invullen.
import { useEffect, useState } from "react";
import { rsfx } from "./ReisSound";

const DAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MON = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const eur = (n) => "€" + Math.round(n || 0).toLocaleString("nl-NL");
const longDay = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const AIRPORTS = {
  AMS: "Schiphol", RTM: "Rotterdam", EIN: "Eindhoven", BRU: "Brussel", DUS: "Düsseldorf", NRN: "Weeze", CGN: "Keulen", CRL: "Charleroi",
};
let FAR = {};
const ap = (code) => (AIRPORTS[code] ? `${AIRPORTS[code]} (${code})` : FAR[code] ? `${FAR[code]} (${code})` : code);

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
    return true;
  }
}

function CopyBtn({ text, label = "Kopieer" }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="rp-copy"
      onClick={async () => { await copy(text); setOk(true); rsfx("check"); setTimeout(() => setOk(false), 1600); }}
    >
      {ok ? "✓ Gekopieerd" : label}
    </button>
  );
}

function SiteList({ links, open }) {
  return (
    <div className="rp-sites">
      {(links || []).map((l, i) => (
        <a
          key={l.label + i}
          className={"rp-site" + (i === 0 ? " top" : "")}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => open && open(l)}
        >
          <span className="rp-site-main">
            <b>{l.label}{i === 0 && <em>Aanrader</em>}</b>
            {l.why && <span>{l.why}</span>}
          </span>
          <span className="rp-site-go" aria-hidden="true">↗</span>
        </a>
      ))}
    </div>
  );
}

function Check({ items, id }) {
  const [done, setDone] = useState({});
  return (
    <ul className="rp-checklist">
      {items.map((t, i) => (
        <li key={i}>
          <label>
            <input type="checkbox" checked={!!done[i]} onChange={() => { setDone((d) => ({ ...d, [i]: !d[i] })); rsfx("toggle"); }} />
            <span>{t}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function legText(l) {
  return `${l.dir}: ${longDay(l.date)}${l.time ? ` om ${l.time}` : ""}, ${ap(l.from)} naar ${ap(l.to)}, ${l.airlineName}${l.flightNumber ? ` ${l.flightNumber}` : ""}${l.stops ? `, ${l.stops} overstap` : ", direct"}`;
}

export default function BookingGuide({ r, trip, start = "vlucht", onClose, onBooked }) {
  const [step, setStep] = useState(start);
  const [refs, setRefs] = useState({ flightRef: (trip && trip.booking && trip.booking.flightRef) || "", hotelRef: (trip && trip.booking && trip.booking.hotelRef) || "" });
  const [state, setState] = useState(null);
  const f = r.flight || {};
  const h = r.hotel || null;
  const legs = f.legs && f.legs.length ? f.legs : null;
  const backTo = r.backTo || r.origin;
  FAR = { [r.airport]: r.city.split(" ·")[0] };
  for (const l of legs || []) { if (!AIRPORTS[l.from]) FAR[l.from] = r.city.split(" ·")[0]; if (!AIRPORTS[l.to]) FAR[l.to] = r.city.split(" ·")[0]; }

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flightSummary = legs
    ? legs.map(legText).join("\n")
    : [
        `Heen: ${longDay(r.depart)}${f.departTime ? ` om ${f.departTime}` : ""}, ${ap(r.origin)} naar ${ap(r.airport)}`,
        `Terug: ${longDay(r.ret)}${f.returnTime ? ` om ${f.returnTime}` : ""}, ${ap(r.airport)} naar ${ap(backTo)}`,
        `${f.airlineName || "Maatschappij"}${f.flightNumber ? ` (${f.flightNumber})` : ""}, ${f.stopsOut || f.stopsBack ? "max 1 overstap" : "direct"}`,
      ].join("\n");
  const fullText = `${r.city}\n2 volwassenen, economy, 1 koffer per persoon\n${flightSummary}${h ? `\nHotel: ${h.name}, ${longDay(r.depart)} tot ${longDay(r.ret)} (${r.nights} nachten)${h.boardLabel ? `, ${h.boardLabel}` : ""}` : ""}`;

  async function markBooked() {
    setState("busy");
    try {
      let id = trip && trip.id;
      if (!id) {
        const res = await fetch("/api/reis/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: r }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Mislukt");
        id = d.trip.id;
      }
      const res = await fetch("/api/reis/trips", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "geboekt", booking: { flightRef: refs.flightRef, hotelRef: refs.hotelRef, extra: "" } }),
      });
      if (!res.ok) throw new Error("Mislukt");
      setState("ok");
      rsfx("fanfare");
      onBooked && onBooked();
    } catch {
      setState("err");
      rsfx("error");
    }
  }

  const steps = [
    { id: "vlucht", label: "Vlucht" },
    ...(h || (r.links && r.links.hotel && r.links.hotel.length) ? [{ id: "hotel", label: "Hotel" }] : []),
    { id: "klaar", label: "Geboekt?" },
  ];
  const idx = steps.findIndex((s) => s.id === step);
  const next = steps[idx + 1];

  return (
    <div className="rp-sheet-wrap rp-guide" role="dialog" aria-modal="true" aria-label="Boekhulp">
      <div className="rp-sheet-bg" onClick={onClose} />
      <div className="rp-sheet rp-guide-sheet">
        <header className="rp-sheet-head">
          <div>
            <div className="rp-city">Zo boek je {r.city.split(" ·")[0]}</div>
            <div className="rp-country">Stap voor stap. Wij boeken niks zelf, jullie houden de controle.</div>
          </div>
          <button className="rp-iconbtn" onClick={onClose} aria-label="Sluiten">✕</button>
        </header>

        <nav className="rp-guide-steps">
          {steps.map((s, i) => (
            <button key={s.id} className={(s.id === step ? "on" : "") + (i < idx ? " done" : "")} onClick={() => { setStep(s.id); rsfx("click"); }}>
              <i>{i < idx ? "✓" : i + 1}</i>{s.label}
            </button>
          ))}
        </nav>

        <div className="rp-sheet-body">
          {step === "vlucht" && (
            <>
              <section className="rp-gcard">
                <div className="rp-gcard-head">
                  <h4>Dit boek je</h4>
                  <CopyBtn text={flightSummary} label="Kopieer gegevens" />
                </div>
                {legs ? (
                  <div className="rp-note warm"><span><b>Twee losse tickets.</b> Deze combinatie is goedkoper dan een retour. Je boekt de heen- en terugvlucht apart, elk met de eigen knoppen hieronder.</span></div>
                ) : null}
                <div className="rp-glegs">
                  {(legs || [
                    { dir: "Heen", date: r.depart, time: f.departTime, from: r.origin, to: r.airport, airlineName: f.airlineName, flightNumber: f.flightNumber, stops: f.stopsOut },
                    { dir: "Terug", date: r.ret, time: f.returnTime, from: r.airport, to: backTo, airlineName: f.airlineName, flightNumber: "", stops: f.stopsBack },
                  ]).map((l) => (
                    <div key={l.dir} className="rp-gleg">
                      <span className="rp-gleg-dir">{l.dir}</span>
                      <div>
                        <b>{longDay(l.date)}{l.time ? `, ${l.time}` : ""}</b>
                        <span>{ap(l.from)} → {ap(l.to)}</span>
                        <span className="rp-muted">{l.airlineName || "Maatschappij zie je bij het boeken"}{l.flightNumber ? `, vlucht ${l.flightNumber}` : ""}, {l.stops ? `${l.stops} overstap` : "direct"}{l.pricePP ? `, ${eur(l.pricePP)} p.p.` : ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <dl className="rp-gfacts">
                  <div><dt>Wie</dt><dd>2 volwassenen, economy</dd></div>
                  <div><dt>Bagage</dt><dd>{f.bag ? `1 koffer (20–23 kg) per persoon erbij boeken, wij rekenden ${eur(f.bag)}` : "1 koffer per persoon zit er meestal al bij, check het even"}</dd></div>
                  <div><dt>Wij zagen</dt><dd>{eur(f.ticket)} tickets{f.bag ? ` + ${eur(f.bag)} bagage` : ""} = <b>{eur((f.ticket || 0) + (f.bag || 0))}</b> voor jullie twee</dd></div>
                </dl>
                <p className="rp-hint">Prijzen komen uit zoekopdrachten van de afgelopen 1–2 dagen. Op de site kan het €10–50 afwijken. Veel duurder? Kies dan een andere dag, die staan allemaal in de lijst.</p>
              </section>

              {legs ? (
                legs.map((l) => (
                  <section key={l.dir} className="rp-gcard">
                    <h4>{l.dir}vlucht boeken ({longDay(l.date)})</h4>
                    <SiteList links={l.links} />
                  </section>
                ))
              ) : (
                <section className="rp-gcard">
                  <h4>Waar boek je het makkelijkst?</h4>
                  <p className="rp-hint" style={{ marginTop: 0 }}>Begin bovenaan. Google Flights opent met jullie data en 2 personen al ingevuld, in het Nederlands.</p>
                  <SiteList links={(r.links && r.links.flight) || []} />
                </section>
              )}

              <section className="rp-gcard">
                <h4>Checklist tijdens het boeken</h4>
                <Check items={[
                  "Namen precies zoals in het paspoort (ook tweede voornamen als die erin staan)",
                  "1 ruimbagage per persoon toegevoegd, heen én terug",
                  "Stoelen kiezen is niet nodig, tenzij jullie per se naast elkaar willen",
                  "Geen dure annulerings- of reisverzekering via de boekingssite (jullie eigen verzekering is vaak goedkoper)",
                  "Bevestigingsmail met boekingscode ontvangen",
                ]} />
              </section>
            </>
          )}

          {step === "hotel" && !h && (
            <section className="rp-gcard">
              <h4>Hotel zoeken voor {longDay(r.depart)} tot {longDay(r.ret)}</h4>
              <p className="rp-hint" style={{ marginTop: 0 }}>Er is nog geen vast hotel gekozen. Deze links openen met jullie data en filters al ingevuld. Tip: open de bestemming in de planner om alle hotels met foto's te zien.</p>
              <SiteList links={(r.links && r.links.hotel) || []} />
            </section>
          )}
          {step === "hotel" && h && (
            <>
              <section className="rp-gcard">
                <div className="rp-gcard-head">
                  <h4>Dit boek je</h4>
                  <CopyBtn text={`${h.name}\n${longDay(r.depart)} tot ${longDay(r.ret)} (${r.nights} nachten), 2 volwassenen${h.boardLabel ? `, ${h.boardLabel}` : ""}`} label="Kopieer gegevens" />
                </div>
                <div className="rp-ghotel">
                  {h.photo ? <img src={h.photo} alt={h.name} /> : null}
                  <div>
                    <b>{h.name}</b>
                    <span>{"★".repeat(Math.round(h.stars || 0))}{h.rating ? ` ${String(h.rating).replace(".", ",")}` : ""}</span>
                    {h.address && <span className="rp-muted">{h.address}</span>}
                  </div>
                </div>
                <dl className="rp-gfacts">
                  <div><dt>Inchecken</dt><dd>{longDay(r.depart)}</dd></div>
                  <div><dt>Uitchecken</dt><dd>{longDay(r.ret)} ({r.nights} nachten)</dd></div>
                  <div><dt>Kamer</dt><dd>2 volwassenen, 1 kamer{h.room ? `: ${h.room}` : ""}</dd></div>
                  {h.boardLabel && <div><dt>Maaltijd</dt><dd>{h.boardLabel}</dd></div>}
                  <div><dt>Wij zagen</dt><dd><b>{eur(r.hotelTotal)}</b> voor alle nachten{h.refundable ? ", gratis annuleren" : ""}</dd></div>
                </dl>
                <p className="rp-hint">Tip: kies een kamer met gratis annuleren. Dan kan de Prijskiller later nog iets goedkopers vinden en kun je kosteloos wisselen.</p>
              </section>
              <section className="rp-gcard">
                <h4>Waar boek je het hotel?</h4>
                <SiteList links={(r.links && r.links.hotel) || []} />
              </section>
              <section className="rp-gcard">
                <h4>Checklist</h4>
                <Check items={[
                  "Zelfde data als de vlucht (inchecken op de aankomstdag)",
                  "2 volwassenen, 1 kamer",
                  "Juiste maaltijd gekozen",
                  "Gratis annuleren aangevinkt als dat kan",
                  "Laat aankomst? Zet het in de opmerking voor het hotel",
                ]} />
              </section>
            </>
          )}

          {step === "klaar" && (
            <section className="rp-gcard">
              <h4>Alles geboekt?</h4>
              <p className="rp-hint" style={{ marginTop: 0 }}>Vul de boekingscodes in. Dan staat de reis bij Onze reizen als geboekt, met aftellen, paklijst en weerbericht.</p>
              <div style={{ display: "grid", gap: 10 }}>
                <label className="rp-field">Boekingscode vlucht{legs ? " (heen en terug)" : ""}<input className="rp-input" value={refs.flightRef} onChange={(e) => setRefs({ ...refs, flightRef: e.target.value })} placeholder={legs ? "Bijv. KX7P2Q en LM4R8T" : "Bijv. KX7P2Q"} /></label>
                <label className="rp-field">Boekingsnummer hotel<input className="rp-input" value={refs.hotelRef} onChange={(e) => setRefs({ ...refs, hotelRef: e.target.value })} placeholder="Bijv. 4821339102" /></label>
              </div>
              <button className="rp-go" style={{ marginTop: 16, width: "100%" }} disabled={state === "busy" || state === "ok"} onClick={markBooked}>
                {state === "busy" ? "Opslaan…" : state === "ok" ? "✓ Geboekt! Goede reis" : state === "err" ? "Mislukt, probeer opnieuw" : "Zet op geboekt"}
              </button>
              <div style={{ marginTop: 14 }}><CopyBtn text={fullText} label="Kopieer hele reis (voor WhatsApp)" /></div>
            </section>
          )}
        </div>

        <footer className="rp-sheet-foot">
          <div>
            <div className="rp-foot-total">{eur(r.total)}</div>
            <div className="rp-pp">{eur(r.total / 2)} per persoon, vlucht + hotel</div>
          </div>
          <div className="rp-foot-actions">
            {idx > 0 && <button className="rp-btn" onClick={() => setStep(steps[idx - 1].id)}>Terug</button>}
            {next ? (
              <button className="rp-btn pri" onClick={() => { setStep(next.id); rsfx("click"); }}>
                {step === "vlucht" ? "Vlucht geboekt, nu het hotel" : step === "hotel" ? "Hotel geboekt, verder" : "Verder"}
              </button>
            ) : (
              <button className="rp-btn" onClick={onClose}>Sluiten</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
