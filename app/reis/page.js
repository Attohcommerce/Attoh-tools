"use client";

// ATTOH REISPLANNER — hoofdscherm (27-10-2026)
// Links het zoekpaneel, rechts de resultaten als instapkaarten.
// Tab "Onze reizen" = gedeelde opgeslagen reizen (bij Justin / bij Quinty).
import { useEffect, useMemo, useRef, useState } from "react";
import { VIBES, DESTINATIONS, ORIGINS } from "@/lib/reis/destinations";

const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MON = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MON_LONG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const eur = (n) => "€" + Math.round(n || 0).toLocaleString("nl-NL");
const fmtDay = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};

function nextMonths(n = 12) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    return { key: d.toISOString().slice(0, 7), m: d.getUTCMonth(), y: d.getUTCFullYear() };
  });
}

const DEFAULT_FORM = () => ({
  when: { mode: "maanden", months: [nextMonths(3)[1].key], from: "", to: "", depart: "", ret: "", flex: 2 },
  nights: { min: 10, max: 16, ideal: 13 },
  blocked: [],
  vibes: ["zon", "strand"],
  surprise: false,
  dests: [],
  useTemp: false,
  minTemp: 26,
  origins: ORIGINS.filter((o) => o.def).map((o) => o.code),
  flight: { shortHaulStops: 0, bags: true, noUlcc: false },
  hotel: { minStars: 4, pool: true, board: "geen", minReview: 8, aiCheck: true },
  budget: "",
  packages: true,
});

const LS_KEY = "attoh_reis_form_v1";
const lsGet = (k) => { try { return JSON.parse(window.localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export default function ReisPlanner() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("zoeken");
  const [form, setForm] = useState(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState("prijs");
  const [hidden, setHidden] = useState({});
  const [liked, setLiked] = useState({});
  const [trips, setTrips] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    fetch("/api/reis/me").then((r) => (r.status === 401 ? (window.location.href = "/reis/login") : r.json())).then((d) => d && setMe(d)).catch(() => {});
    const saved = lsGet(LS_KEY);
    if (saved && saved.when) setForm({ ...DEFAULT_FORM(), ...saved });
    const last = lsGet(LS_KEY + "_last");
    if (last && last.results) setOut(last);
    loadTrips();
  }, []);
  useEffect(() => { lsSet(LS_KEY, form); }, [form]);

  async function loadTrips() {
    try {
      const r = await fetch("/api/reis/trips");
      if (r.ok) setTrips((await r.json()).trips || []);
    } catch {}
  }

  const set = (path, val) =>
    setForm((f) => {
      const next = structuredClone(f);
      const keys = path.split(".");
      let o = next;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      o[keys[keys.length - 1]] = typeof val === "function" ? val(o[keys[keys.length - 1]]) : val;
      return next;
    });
  const toggleIn = (path, v) => set(path, (arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));

  async function search() {
    setBusy(true);
    setErr("");
    setOut(null);
    setHidden({});
    setPanelOpen(false);
    setProgress({ stage: "Zoekopdracht starten", routes: 0, flightOptions: 0, matches: 0, destinations: 0 });
    setTimeout(() => resultsRef.current && resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    const body = { ...form, minTemp: form.useTemp ? form.minTemp : null, budget: Number(form.budget) || null };
    try {
      const res = await fetch("/api/reis/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) throw new Error((await res.text()).slice(0, 200) || "Zoeken mislukt");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "stage") setProgress((p) => ({ ...p, stage: ev.label }));
          else if (ev.type === "count") setProgress((p) => ({ ...p, ...ev }));
          else if (ev.type === "done") { setOut(ev); lsSet(LS_KEY + "_last", ev); }
          else if (ev.type === "error") throw new Error(ev.error);
        }
      }
    } catch (e) {
      setErr(e.message || "Zoeken mislukt");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function saveTrip(result, owner) {
    const r = await fetch("/api/reis/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, result, search: out && out.query }) });
    if (r.ok) loadTrips();
  }
  async function feedback(result, weight) {
    if (weight < 0) setHidden((h) => ({ ...h, [result.id]: true }));
    else setLiked((l) => ({ ...l, [result.id]: !l[result.id] }));
    fetch("/api/reis/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destId: result.destId, tags: result.tags, weight }) }).catch(() => {});
  }

  async function logout() {
    await fetch("/api/reis/logout", { method: "POST" });
    window.location.href = "/reis/login";
  }

  const results = useMemo(() => {
    if (!out || !out.results) return [];
    const list = out.results.filter((r) => !hidden[r.id]);
    if (sort === "match") return [...list].sort((a, b) => b.match - a.match || a.total - b.total);
    return [...list].sort((a, b) => a.total - b.total);
  }, [out, hidden, sort]);

  const savedIds = useMemo(() => new Set(trips.map((t) => t.result && t.result.id)), [trips]);
  const user = me && me.user;

  return (
    <>
      <header className="rp-top">
        <div className="rp-brand"><PlaneIcon /> Attoh <small>Reisplanner</small></div>
        <nav className="rp-tabs">
          <button className={"rp-tab" + (tab === "zoeken" ? " on" : "")} onClick={() => setTab("zoeken")}>Zoeken</button>
          <button className={"rp-tab" + (tab === "reizen" ? " on" : "")} onClick={() => setTab("reizen")}>
            Onze reizen{trips.length ? <span className="count">{trips.length}</span> : null}
          </button>
        </nav>
        <span className="rp-spacer" />
        {user && (
          <div className="rp-user">
            <span className="rp-avatar" aria-hidden="true">{user.name[0]}</span>
            <span className="nm">{user.name}</span>
            <button className="rp-link" onClick={logout}>Uitloggen</button>
          </div>
        )}
      </header>

      {tab === "zoeken" ? (
        <main className={"rp-main" + (out || busy ? " has-results" : "")}>
          <aside className={"rp-panel" + (panelOpen ? " open" : "")}>
            <SearchForm form={form} set={set} toggleIn={toggleIn} onSearch={search} busy={busy} />
          </aside>
          <section ref={resultsRef} style={{ minWidth: 0, scrollMarginTop: 80 }}>
            {(out || busy) && (
              <button className="rp-btn rp-mobile-only" style={{ marginBottom: 14, width: "100%" }} onClick={() => setPanelOpen((o) => !o)}>
                {panelOpen ? "Zoekopdracht verbergen" : "Zoekopdracht aanpassen"}
              </button>
            )}
            {err && <div className="rp-note" style={{ background: "var(--accent-soft)" }}><b>Zoeken lukte niet.</b> {err}</div>}
            {busy && progress && <Progress p={progress} live={me && me.live} />}
            {!busy && !out && !err && <Empty user={user} live={me && me.live} />}
            {!busy && out && (
              <Results
                out={out}
                results={results}
                sort={sort}
                setSort={setSort}
                user={user}
                savedIds={savedIds}
                liked={liked}
                onSave={saveTrip}
                onFeedback={feedback}
              />
            )}
          </section>
        </main>
      ) : (
        <Saved trips={trips} reload={loadTrips} user={user} />
      )}

      <nav className="rp-bottomnav">
        <button className={tab === "zoeken" ? "on" : ""} onClick={() => setTab("zoeken")}>Zoeken</button>
        <button className={tab === "reizen" ? "on" : ""} onClick={() => setTab("reizen")}>Onze reizen{trips.length ? ` (${trips.length})` : ""}</button>
      </nav>
    </>
  );
}

// ── Zoekformulier ───────────────────────────────────────────────────
function SearchForm({ form, set, toggleIn, onSearch, busy }) {
  const months = useMemo(() => nextMonths(12), []);
  const [blk, setBlk] = useState({ from: "", to: "" });
  const [destQ, setDestQ] = useState("");
  const w = form.when;

  const flightSum = [
    form.origins.length + " vliegvelden",
    form.flight.bags ? "met ruimbagage" : "handbagage",
    form.flight.shortHaulStops ? "overstap oké" : "direct",
  ].join(", ");
  const hotelSum = [
    form.hotel.minStars + "+ sterren",
    form.hotel.pool ? "zwembad" : null,
    { geen: null, ontbijt: "ontbijt", halfpension: "halfpension", allin: "all-inclusive" }[form.hotel.board],
    form.hotel.minReview ? form.hotel.minReview + "+" : null,
  ].filter(Boolean).join(", ");

  const destMatches = destQ
    ? DESTINATIONS.filter((d) => (d.city + " " + d.country).toLowerCase().includes(destQ.toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      <h1 className="rp-h1">Waar gaan we heen?</h1>
      <p className="rp-lede">Vul zo weinig of zo veel in als je wilt. Hoe vrijer, hoe goedkoper hij kan zoeken.</p>

      <div className="rp-sec">
        <h3>Wanneer</h3>
        <div className="rp-seg" role="tablist">
          {[["maanden", "Flexibel per maand"], ["periode", "Periode"], ["vast", "Vaste data"]].map(([id, l]) => (
            <button key={id} className={w.mode === id ? "on" : ""} onClick={() => set("when.mode", id)}>{l}</button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          {w.mode === "maanden" && (
            <>
              <div className="rp-months">
                {months.map((m) => (
                  <button key={m.key} className={"rp-month" + (w.months.includes(m.key) ? " on" : "")} onClick={() => toggleIn("when.months", m.key)}>
                    {MON[m.m]}<small>{m.y}</small>
                  </button>
                ))}
              </div>
              <p className="rp-hint">Kies 1 tot 3 maanden. De tool zoekt elke vertrekdag in die maanden af.</p>
            </>
          )}
          {w.mode === "periode" && (
            <div className="rp-row">
              <label className="rp-field">Vroegst weg<input type="date" className="rp-input" value={w.from} onChange={(e) => set("when.from", e.target.value)} /></label>
              <label className="rp-field">Uiterlijk thuis<input type="date" className="rp-input" value={w.to} onChange={(e) => set("when.to", e.target.value)} /></label>
            </div>
          )}
          {w.mode === "vast" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="rp-row">
                <label className="rp-field">Heen<input type="date" className="rp-input" value={w.depart} onChange={(e) => set("when.depart", e.target.value)} /></label>
                <label className="rp-field">Terug<input type="date" className="rp-input" value={w.ret} onChange={(e) => set("when.ret", e.target.value)} /></label>
              </div>
              <label className="rp-field">Speling
                <select className="rp-select" value={w.flex} onChange={(e) => set("when.flex", Number(e.target.value))}>
                  {[0, 1, 2, 3, 5, 7].map((n) => <option key={n} value={n}>{n === 0 ? "Precies deze data" : `${n} ${n === 1 ? "dag" : "dagen"} eerder of later`}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      </div>

      {w.mode !== "vast" && (
        <div className="rp-sec">
          <h3>Hoe lang <span>wij houden van {form.nights.ideal} nachten</span></h3>
          <div className="rp-row">
            <Stepper label="Minimaal" value={form.nights.min} min={2} max={form.nights.max} onChange={(v) => set("nights.min", v)} />
            <Stepper label="Maximaal" value={form.nights.max} min={form.nights.min} max={28} onChange={(v) => set("nights.max", v)} />
          </div>
          <div style={{ marginTop: 10 }}>
            <Stepper label="Ideaal" value={form.nights.ideal} min={form.nights.min} max={form.nights.max} onChange={(v) => set("nights.ideal", v)} />
          </div>
          <p className="rp-hint">Langer of korter is soms goedkoper. Bij elk resultaat zie je wat een paar nachten extra kost.</p>
        </div>
      )}

      <div className="rp-sec">
        <h3>Waar hebben we zin in</h3>
        <div className="rp-chips">
          {VIBES.map((v) => (
            <button key={v.id} className={"rp-chip" + (form.vibes.includes(v.id) && !form.surprise ? " on" : "")} onClick={() => { set("surprise", false); toggleIn("vibes", v.id); }}>
              <span className="ic" aria-hidden="true">{v.icon}</span>{v.label}
            </button>
          ))}
        </div>
        <label className="rp-toggle" style={{ marginTop: 14 }}>
          <span>Verras ons<small>Gewoon de goedkoopste mooie reis, maakt niet uit waarheen</small></span>
          <Switch checked={form.surprise} onChange={(v) => set("surprise", v)} />
        </label>
      </div>

      <details className="rp-more">
        <summary>Bestemming <span className="sum">{form.dests.length ? form.dests.length + " gekozen" : "overal"}</span></summary>
        <div className="inner">
          <input className="rp-input" placeholder="Zoek een land of stad" value={destQ} onChange={(e) => setDestQ(e.target.value)} />
          {destMatches.length > 0 && (
            <div className="rp-chips">
              {destMatches.map((d) => (
                <button key={d.id} className={"rp-chip sm" + (form.dests.includes(d.id) ? " on" : "")} onClick={() => toggleIn("dests", d.id)}>{d.city}</button>
              ))}
            </div>
          )}
          {form.dests.length > 0 && (
            <div className="rp-chips">
              {form.dests.map((id) => {
                const d = DESTINATIONS.find((x) => x.id === id);
                return <button key={id} className="rp-chip sm on" onClick={() => toggleIn("dests", id)} aria-label={`${d.city} verwijderen`}>{d.city} ✕</button>;
              })}
            </div>
          )}
          <p className="rp-hint">Leeg laten = de tool kiest uit {DESTINATIONS.length} bestemmingen.</p>
        </div>
      </details>

      <details className="rp-more">
        <summary>Weer en data die niet kunnen <span className="sum">{[form.useTemp ? form.minTemp + "°+" : null, form.blocked.length ? form.blocked.length + " geblokkeerd" : null].filter(Boolean).join(", ") || "geen eisen"}</span></summary>
        <div className="inner">
          <label className="rp-toggle">
            <span>Minimaal {form.minTemp}°C overdag</span>
            <Switch checked={form.useTemp} onChange={(v) => set("useTemp", v)} />
          </label>
          {form.useTemp && <input type="range" className="rp-range" min={18} max={35} value={form.minTemp} onChange={(e) => set("minTemp", Number(e.target.value))} aria-label="Minimum temperatuur" />}
          <div>
            <div style={{ fontSize: 14.5, marginBottom: 8 }}>We kunnen niet weg tussen</div>
            <div className="rp-row">
              <input type="date" className="rp-input" value={blk.from} onChange={(e) => setBlk({ ...blk, from: e.target.value })} aria-label="Vanaf" />
              <input type="date" className="rp-input" value={blk.to} onChange={(e) => setBlk({ ...blk, to: e.target.value })} aria-label="Tot en met" />
              <button className="rp-iconbtn" style={{ flex: "none" }} aria-label="Toevoegen" onClick={() => { if (blk.from) { set("blocked", (b) => [...b, { from: blk.from, to: blk.to || blk.from }]); setBlk({ from: "", to: "" }); } }}>+</button>
            </div>
            {form.blocked.length > 0 && (
              <ul className="rp-blocked">
                {form.blocked.map((b, i) => (
                  <li key={i}>{fmtDay(b.from)} tot en met {fmtDay(b.to)}<button className="rp-link" onClick={() => set("blocked", (x) => x.filter((_, j) => j !== i))}>Verwijderen</button></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>

      <details className="rp-more">
        <summary>Vliegen <span className="sum">{flightSum}</span></summary>
        <div className="inner">
          <div className="rp-chips">
            {ORIGINS.map((o) => (
              <button key={o.code} className={"rp-chip sm" + (form.origins.includes(o.code) ? " on" : "")} onClick={() => toggleIn("origins", o.code)}>{o.short}</button>
            ))}
          </div>
          <p className="rp-hint" style={{ marginTop: -4 }}>Reiskosten naar het vliegveld tellen mee in de totaalprijs.</p>
          <label className="rp-toggle"><span>Ruimbagage<small>Wordt bij elke prijs opgeteld</small></span><Switch checked={form.flight.bags} onChange={(v) => set("flight.bags", v)} /></label>
          <label className="rp-toggle"><span>Overstap bij korte vluchten<small>Verre reizen: altijd max 1 overstap</small></span><Switch checked={form.flight.shortHaulStops === 1} onChange={(v) => set("flight.shortHaulStops", v ? 1 : 0)} /></label>
          <label className="rp-toggle"><span>Geen Ryanair en Wizz Air</span><Switch checked={form.flight.noUlcc} onChange={(v) => set("flight.noUlcc", v)} /></label>
        </div>
      </details>

      <details className="rp-more">
        <summary>Hotel <span className="sum">{hotelSum}</span></summary>
        <div className="inner">
          <div className="rp-seg">
            {[4, 5].map((s) => <button key={s} className={form.hotel.minStars === s ? "on" : ""} onClick={() => set("hotel.minStars", s)}>{s === 4 ? "4 of 5 sterren" : "Alleen 5 sterren"}</button>)}
          </div>
          <div className="rp-seg">
            {[["geen", "Maakt niet uit"], ["ontbijt", "Ontbijt"], ["halfpension", "Halfpension"], ["allin", "All-in"]].map(([id, l]) => (
              <button key={id} className={form.hotel.board === id ? "on" : ""} onClick={() => set("hotel.board", id)}>{l}</button>
            ))}
          </div>
          <label className="rp-field">Minimale reviewscore
            <select className="rp-select" value={form.hotel.minReview} onChange={(e) => set("hotel.minReview", Number(e.target.value))}>
              {[7, 7.5, 8, 8.5, 9].map((n) => <option key={n} value={n}>{String(n).replace(".", ",")} of hoger</option>)}
            </select>
          </label>
          <label className="rp-toggle"><span>Zwembad</span><Switch checked={form.hotel.pool} onChange={(v) => set("hotel.pool", v)} /></label>
          <label className="rp-toggle"><span>AI-fotocheck<small>Alleen hotels die er modern en verzorgd uitzien</small></span><Switch checked={form.hotel.aiCheck} onChange={(v) => set("hotel.aiCheck", v)} /></label>
        </div>
      </details>

      <details className="rp-more">
        <summary>Budget <span className="sum">{form.budget ? "max " + eur(form.budget) : "zo goedkoop mogelijk"}</span></summary>
        <div className="inner">
          <label className="rp-field">Maximaal voor 2 personen, alles inbegrepen
            <input className="rp-input" inputMode="numeric" placeholder="Bijvoorbeeld 2000" value={form.budget} onChange={(e) => set("budget", e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="rp-toggle"><span>Pakketreizen ernaast leggen<small>TUI, Corendon, Sunweb en D-reizen</small></span><Switch checked={form.packages} onChange={(v) => set("packages", v)} /></label>
        </div>
      </details>

      <button className="rp-go" onClick={onSearch} disabled={busy}>
        {busy ? "Bezig met zoeken" : "Zoek de goedkoopste reis"}
      </button>
    </div>
  );
}

function Stepper({ label, value, min, max, onChange }) {
  return (
    <div className="rp-field">
      {label}
      <div className="rp-stepper">
        <button onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label} minder`}>−</button>
        <span>{value} nachten</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} aria-label={`${label} meer`}>+</button>
      </div>
    </div>
  );
}

function Switch({ checked, onChange }) {
  return (
    <span className="rp-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </span>
  );
}

// ── Voortgang ───────────────────────────────────────────────────────
function Progress({ p, live }) {
  return (
    <div className="rp-progress" aria-live="polite">
      <h2>Reizen aan het vergelijken</h2>
      <div className="stage">{p.stage}</div>
      <div className="rp-counters">
        <div className="rp-counter"><b>{(p.destinations || 0).toLocaleString("nl-NL")}</b><span>bestemmingen</span></div>
        <div className="rp-counter"><b>{(p.flightOptions || 0).toLocaleString("nl-NL")}</b><span>vluchtopties bekeken</span></div>
        <div className="rp-counter"><b>{(p.matches || 0).toLocaleString("nl-NL")}</b><span>passen bij jullie eisen</span></div>
      </div>
      <div className="rp-runway"><i /></div>
      {live && !live.flights && <p className="rp-hint" style={{ marginTop: 16 }}>Nog geen live prijsbron gekoppeld. De tool rekent nu met schattingen.</p>}
    </div>
  );
}

function Empty({ user, live }) {
  return (
    <div className="rp-empty">
      <h2>{user ? `Hoi ${user.name}.` : "Hoi."} Waar gaan jullie naartoe?</h2>
      <p>Kies links wanneer jullie weg willen en waar je zin in hebt. De tool legt vluchten en hotels los van elkaar naast elkaar en zoekt de goedkoopste combinatie die aan jullie eisen voldoet.</p>
      <ol className="rp-how">
        <li><i>1</i><span><b>Vluchten van elk vliegveld.</b> Schiphol tot Düsseldorf, elke vertrekdag, met bagage en reiskosten erbij opgeteld.</span></li>
        <li><i>2</i><span><b>Hotels voor precies die datums.</b> 4 sterren of meer, zwembad, reviewscore 8 of hoger.</span></li>
        <li><i>3</i><span><b>AI kijkt naar de foto's.</b> Gedateerde hotels vallen af, ook als ze goedkoop zijn.</span></li>
        <li><i>4</i><span><b>Jullie boeken zelf.</b> Elke vlucht en elk hotel heeft een link met de datums al ingevuld.</span></li>
      </ol>
      {live && !live.flights && !live.hotels && (
        <div className="rp-note" style={{ marginTop: 26 }}>
          <span>De live prijsbronnen zijn nog niet gekoppeld, dus prijzen zijn voorlopig schattingen. De links naar Skyscanner en Booking werken wel al.</span>
        </div>
      )}
    </div>
  );
}

// ── Resultaten ──────────────────────────────────────────────────────
function Results({ out, results, sort, setSort, user, savedIds, liked, onSave, onFeedback }) {
  const anyEst = results.some((r) => r.flight.estimate || r.hotelEstimate);
  const st = out.stats || {};
  if (!results.length) {
    return (
      <div className="rp-empty">
        <h2>Niets gevonden</h2>
        <p>{out.message || "Geen reis die aan alle eisen voldoet. Maak de periode ruimer of haal een filter weg."}</p>
      </div>
    );
  }
  return (
    <div>
      <div className="rp-results-head">
        <div>
          <h2>{results.length} reizen gevonden</h2>
          <p>{(st.flightOptions || 0).toLocaleString("nl-NL")} vluchtopties vergeleken in {Math.max(1, Math.round((st.ms || 0) / 1000))} seconden</p>
        </div>
        <div className="rp-seg" style={{ minWidth: 240 }}>
          <button className={sort === "prijs" ? "on" : ""} onClick={() => setSort("prijs")}>Goedkoopst</button>
          <button className={sort === "match" ? "on" : ""} onClick={() => setSort("match")}>Beste match</button>
        </div>
      </div>
      {out.message && <div className="rp-note"><span>{out.message}</span></div>}
      {anyEst && (
        <div className="rp-note">
          <span><b>Sommige prijzen zijn schattingen.</b> Die zijn gemarkeerd. Klik door naar Skyscanner of Booking voor de echte prijs. Zodra de prijsbronnen gekoppeld zijn, rekent de tool met live prijzen.</span>
        </div>
      )}
      {st.errors && st.errors.length > 0 && (
        <div className="rp-note" style={{ background: "var(--surface)" }}><span>Niet elke bron reageerde: {st.errors[0]}</span></div>
      )}
      {results.map((r) => (
        <Ticket key={r.id} r={r} user={user} saved={savedIds.has(r.id)} liked={liked[r.id]} onSave={onSave} onFeedback={onFeedback} />
      ))}
    </div>
  );
}

function Ticket({ r, user, saved, liked, onSave, onFeedback }) {
  const [menu, setMenu] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const f = r.flight;
  const direct = f.stopsOut === 0 && f.stopsBack === 0;
  const h = r.hotel;
  return (
    <article className="rp-ticket" ref={ref}>
      {r.badge && <span className={"rp-badge" + (r.badge === "Beste deal" ? " deal" : "")}>{r.badge}</span>}
      <div className="rp-ticket-main">
        <div className="rp-dest">
          <span className="rp-city">{r.city}</span>
          <span className="rp-country">{r.country}</span>
        </div>
        <div className="rp-meta">
          {r.temp != null && <span className="rp-pill temp">{r.temp}° overdag</span>}
          {r.beach >= 8 && <span className="rp-pill">Mooi strand</span>}
          <span className="rp-pill">{Math.round(r.hours)} uur vliegen</span>
          {r.match >= 80 && <span className="rp-pill ok">Past bij jullie wensen</span>}
        </div>

        <div className="rp-dates">
          <div className="rp-date"><b>{fmtDay(r.depart)}</b><span>{f.departTime ? `${r.originName}, ${f.departTime}` : r.originName}</span></div>
          <div className="rp-path"><span>{r.nights} nachten</span></div>
          <div className="rp-date r"><b>{fmtDay(r.ret)}</b><span>{f.returnTime ? `terug ${f.returnTime}` : "terug"}</span></div>
        </div>

        <div className="rp-legs">
          <div className="rp-leg">
            <span className="rp-leg-ic"><PlaneIcon size={17} /></span>
            <div>
              <div className="rp-leg-t">{r.origin} naar {r.airport}, {direct ? "direct" : `${Math.max(f.stopsOut, f.stopsBack)} overstap`}</div>
              <div className="rp-leg-s">
                {f.airlineName}
                {f.verified ? ", live gecontroleerd" : ""}
                {f.estimate ? <span className="rp-pill est" style={{ marginLeft: 6 }}>schatting</span> : null}
              </div>
            </div>
          </div>
          <div className="rp-leg">
            <span className="rp-leg-ic"><BedIcon /></span>
            <div style={{ minWidth: 0 }}>
              {h ? (
                <>
                  <div className="rp-leg-t">{h.name}</div>
                  <div className="rp-leg-s">
                    <span className="rp-stars" aria-label={`${h.stars} sterren`}>{"★".repeat(Math.round(h.stars || 0))}</span>
                    {h.rating ? `  ${String(h.rating).replace(".", ",")} review` : ""}
                    {h.boardLabel ? `, ${h.boardLabel.toLowerCase()}` : ""}
                    {h.pool ? ", zwembad" : ""}
                    {h.beachfront ? ", aan het strand" : ""}
                  </div>
                  {h.ai && <div className="rp-leg-s"><span className={"rp-ai" + (h.ai.score < 6 ? " lo" : "")}>Foto's {h.ai.score}/10</span> {h.ai.reden}</div>}
                </>
              ) : (
                <>
                  <div className="rp-leg-t">4+ sterren met zwembad</div>
                  <div className="rp-leg-s">Hotelprijs geschat <span className="rp-pill est" style={{ marginLeft: 6 }}>schatting</span></div>
                </>
              )}
            </div>
          </div>
        </div>

        {r.alts && r.alts.length > 0 && (
          <div className="rp-alts">
            <span>Andere data:</span>
            {r.alts.map((a, i) => (
              <span key={i} className="rp-alt">
                {fmtDay(a.depart)}, <b>{a.nights}n</b> <span className={a.diff < 0 ? "dn" : "up"}>{a.diff < 0 ? "−" + eur(-a.diff) : "+" + eur(a.diff)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rp-ticket-stub">
        <div className="rp-stubtop">
          <div>
            <div className="rp-price">{eur(r.total)}</div>
            <div className="rp-pp">{eur(r.perPerson)} per persoon, alles samen</div>
            {r.overBudget && <div className="rp-over">Boven jullie budget</div>}
          </div>
        </div>
        <div className="rp-break">
          <div><span>Vluchten (2p)</span><span>{eur(f.ticket)}</span></div>
          {f.bag > 0 && <div><span>Ruimbagage</span><span>{eur(f.bag)}</span></div>}
          <div><span>Hotel, {r.nights} nachten</span><span>{eur(r.hotelTotal)}</span></div>
          <div><span>Naar {r.originName}</span><span>{eur(f.toAirport)}</span></div>
        </div>
        <div className="rp-actions">
          <div className="rp-btnrow">
            <div className="rp-menu">
              <button className="rp-btn pri" style={{ width: "100%" }} onClick={() => setMenu(menu === "flight" ? null : "flight")} aria-expanded={menu === "flight"}>Vlucht</button>
              {menu === "flight" && <LinkMenu title="Vlucht boeken bij" links={r.links.flight} />}
            </div>
            <div className="rp-menu">
              <button className="rp-btn pri" style={{ width: "100%" }} onClick={() => setMenu(menu === "hotel" ? null : "hotel")} aria-expanded={menu === "hotel"}>Hotel</button>
              {menu === "hotel" && <LinkMenu title="Hotel boeken bij" links={r.links.hotel} />}
            </div>
          </div>
          <div className="rp-btnrow" style={{ flex: "none" }}>
            <div className="rp-menu" style={{ flex: 1 }}>
              <button className={"rp-btn" + (saved ? " acc" : "")} style={{ width: "100%" }} onClick={() => setMenu(menu === "save" ? null : "save")}>{saved ? "Bewaard" : "Bewaren"}</button>
              {menu === "save" && (
                <div className="rp-menu-list">
                  <h4>Bewaren bij</h4>
                  <button onClick={() => { onSave(r, "justin"); setMenu(null); }}>Justin</button>
                  <button onClick={() => { onSave(r, "quinty"); setMenu(null); }}>Quinty</button>
                </div>
              )}
            </div>
            <button className={"rp-iconbtn" + (liked ? " on" : "")} onClick={() => onFeedback(r, 1)} aria-label="Leuk, meer zoals dit" title="Leuk, meer zoals dit"><HeartIcon filled={liked} /></button>
            <button className="rp-iconbtn" onClick={() => onFeedback(r, -1)} aria-label="Niet voor ons" title="Niet voor ons">✕</button>
          </div>
          {r.links.packages && r.links.packages.length > 0 && (
            <div className="rp-menu">
              <button className="rp-link" style={{ fontSize: 13 }} onClick={() => setMenu(menu === "pkg" ? null : "pkg")}>Vergelijk met pakketreizen</button>
              {menu === "pkg" && <LinkMenu title="Pakketreis zoeken bij" links={r.links.packages} />}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function LinkMenu({ title, links }) {
  return (
    <div className="rp-menu-list">
      <h4>{title}</h4>
      {links.map((l) => (
        <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className={l.primary ? "pri" : ""}>{l.label}</a>
      ))}
    </div>
  );
}

// ── Onze reizen ─────────────────────────────────────────────────────
function Saved({ trips, reload, user }) {
  const [who, setWho] = useState("alle");
  const list = trips.filter((t) => who === "alle" || t.owner === who);
  async function patch(id, p) {
    await fetch("/api/reis/trips", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...p }) });
    reload();
  }
  async function remove(id) {
    await fetch("/api/reis/trips", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    reload();
  }
  return (
    <div className="rp-saved">
      <div className="rp-saved-head">
        <div>
          <h1>Onze reizen</h1>
          <p className="rp-lede" style={{ margin: 0 }}>Alles wat jullie bewaard hebben. Met prijsalert aan wordt elke dag gecheckt of de prijs gezakt is.</p>
        </div>
        <div className="rp-seg" style={{ minWidth: 260 }}>
          {[["alle", "Allebei"], ["justin", "Justin"], ["quinty", "Quinty"]].map(([id, l]) => (
            <button key={id} className={who === id ? "on" : ""} onClick={() => setWho(id)}>{l}</button>
          ))}
        </div>
      </div>
      {!list.length && (
        <div className="rp-empty" style={{ paddingTop: 20 }}>
          <h2 style={{ fontSize: 30 }}>Nog niets bewaard</h2>
          <p>Zoek een reis en druk op Bewaren. Daarna staat hij hier, bij Justin of bij Quinty, en zien jullie hem allebei.</p>
        </div>
      )}
      {list.map((t) => {
        const r = t.result;
        const hist = (t.priceHistory || []).map((p) => p.total).filter(Boolean);
        const first = hist[0], last = hist[hist.length - 1];
        return (
          <article key={t.id} className="rp-ticket">
            <div className="rp-ticket-main">
              <div className="rp-dest">
                <span className="rp-city">{r.city}</span>
                <span className="rp-country">{r.country}</span>
                <span className={"rp-owner " + t.owner}><i>{t.owner === "quinty" ? "Q" : "J"}</i>bij {t.owner === "quinty" ? "Quinty" : "Justin"}</span>
              </div>
              <div className="rp-dates">
                <div className="rp-date"><b>{fmtDay(r.depart)}</b><span>{r.originName}</span></div>
                <div className="rp-path"><span>{r.nights} nachten</span></div>
                <div className="rp-date r"><b>{fmtDay(r.ret)}</b><span>terug</span></div>
              </div>
              <div className="rp-legs">
                <div className="rp-leg"><span className="rp-leg-ic"><PlaneIcon size={17} /></span><div><div className="rp-leg-t">{r.origin} naar {r.airport}</div><div className="rp-leg-s">{r.flight.airlineName}</div></div></div>
                <div className="rp-leg"><span className="rp-leg-ic"><BedIcon /></span><div><div className="rp-leg-t">{r.hotel ? r.hotel.name : "Hotel nog kiezen"}</div><div className="rp-leg-s">{r.hotel ? `${r.hotel.stars} sterren` : "Schatting"}</div></div></div>
              </div>
              <div className="rp-alts" style={{ marginTop: 16 }}>
                <span>Bewaard door {t.savedBy === "quinty" ? "Quinty" : "Justin"} op {fmtDay(t.createdAt.slice(0, 10))}</span>
              </div>
            </div>
            <div className="rp-ticket-stub">
              <div className="rp-price">{eur(last || r.total)}</div>
              {hist.length > 1 && <Spark values={hist} />}
              {first && last && last < first && <div className="rp-drop">{eur(first - last)} goedkoper dan bij bewaren</div>}
              <label className="rp-toggle" style={{ fontSize: 14 }}><span>Prijsalert</span><Switch checked={t.alert} onChange={(v) => patch(t.id, { alert: v })} /></label>
              <div className="rp-actions">
                <div className="rp-btnrow">
                  <a className="rp-btn pri" href={(r.links.flight.find((l) => l.primary) || r.links.flight[0]).url} target="_blank" rel="noopener noreferrer">Vlucht</a>
                  <a className="rp-btn pri" href={r.links.hotel[0].url} target="_blank" rel="noopener noreferrer">Hotel</a>
                </div>
                <div className="rp-btnrow">
                  <button className="rp-btn" onClick={() => patch(t.id, { owner: t.owner === "quinty" ? "justin" : "quinty" })}>Naar {t.owner === "quinty" ? "Justin" : "Quinty"}</button>
                  <button className="rp-btn" onClick={() => remove(t.id)}>Verwijderen</button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Spark({ values }) {
  const w = 200, h = 34;
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 3 - ((v - min) / Math.max(1, max - min)) * (h - 6)}`).join(" ");
  return (
    <svg className="rp-spark" width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="Prijsverloop">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PlaneIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 15.5v-1.9l-8-5V3.5a1.5 1.5 0 0 0-3 0v5.1l-8 5v1.9l8-2.5v5l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5l8 2.5Z" />
    </svg>
  );
}
function BedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="11" r="2" />
    </svg>
  );
}
function HeartIcon({ filled }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
    </svg>
  );
}
