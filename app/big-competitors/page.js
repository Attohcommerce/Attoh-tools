"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { BC_MARKETS, BC_DEFAULTS } from "@/lib/bc-markets";

/* BIG COMPETITORS (23-11-2026, projectdoc 205) — Justin: "Stores met 200k+
   bezoek per maand importeren continu nieuwe producten. Scrape ze overnight,
   onthoud wat je al zag en zet wat nieuw is meteen als import-sheet klaar,
   verdeeld over mijn stores per markt, net onder hun prijs."

   Deze pagina is het overzicht: per markt de Competitor Import Sheet, de
   stores die meedoen en de competitors met hun live status (scant nu, laatste
   scan, laatste nieuwe product, nieuw vandaag / 7 dagen), de datum-bladen die
   klaarstaan om te importeren en een tijdlijn. De scan zelf draait op de
   server (lib/big-competitors.js): elke nacht via Vercel Cron en met "Nu
   scannen". */

const LS_MARKET = "attoh_bc_market";

async function api(body) {
  const res = await fetch("/api/big-competitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const fmtN = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("nl-NL"));
const AMS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" });
const AMS_TIME = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" });
const dayIso = (ts) => AMS_DAY.format(new Date(ts));
const dayShort = (iso) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}` : "");
const clock = (ts) => AMS_TIME.format(new Date(ts));

/** "net" · "12 min geleden" · "vandaag 02:04" · "gisteren 02:05" · "21-11 02:04" */
function when(ts, now) {
  if (!ts) return "nog niet";
  const diff = now - ts;
  if (diff < 60000) return "net";
  if (diff < 3600000) return `${Math.round(diff / 60000)} min geleden`;
  const d = dayIso(ts);
  if (d === dayIso(now)) return `vandaag ${clock(ts)}`;
  if (d === dayIso(now - 86400000)) return `gisteren ${clock(ts)}`;
  return `${dayShort(d)} ${clock(ts)}`;
}
function visitsLabel(n) {
  const v = Number(n) || 0;
  if (!v) return "";
  if (v >= 1e6) return `${(v / 1e6).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
}
const GENDER_LABEL = { M: "Heren", V: "Dames", MV: "Heren + dames" };
/** Nieuwe producten (in een blad gezet) vandaag en in de laatste 7 dagen. */
function newCounts(daily, now) {
  const d = daily || {};
  const today = dayIso(now);
  let week = 0;
  for (let i = 0; i < 7; i++) week += d[dayIso(now - i * 86400000)] || 0;
  return { today: d[today] || 0, week };
}

export default function BigCompetitorsPage() {
  const [info, setInfo] = useState(null);
  const [market, setMarket] = useState("USA");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [sheetEdit, setSheetEdit] = useState({}); // markt → tekst in het sheet-veld
  const [numEdit, setNumEdit] = useState({}); // markt → { undercut, maxPerRun }
  const [add, setAdd] = useState({ url: "", visits: "", name: "", gender: "auto" });
  const [addOther, setAddOther] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [tlMarket, setTlMarket] = useState(false); // tijdlijn alleen van de gekozen markt
  const [tick, setTick] = useState(0); // elke 20 s opnieuw tekenen ("3 min geleden")
  const pollRef = useRef(null);
  const wasRunning = useRef(false);

  async function loadInfo() {
    const d = await api({ action: "info" });
    setInfo(d);
    return d;
  }
  async function loadStatus() {
    const d = await api({ action: "status" });
    setInfo((prev) => (prev ? { ...prev, job: d.job, competitors: d.competitors, timeline: d.timeline, tabs: d.tabs, now: d.now } : prev));
    return d;
  }

  useEffect(() => {
    try {
      const m = localStorage.getItem(LS_MARKET);
      if (m && BC_MARKETS.some((x) => x.key === m)) setMarket(m);
    } catch {}
    loadInfo().catch((e) => setErr(String(e.message || e)));
    const t = setInterval(() => setTick((x) => x + 1), 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_MARKET, market);
    } catch {}
  }, [market]);

  const job = info && info.job;
  const running = !!(job && job.status === "running");
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadStatus().catch(() => {}), running ? 4000 : 30000);
    return () => pollRef.current && clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, !!info]);
  useEffect(() => {
    // scan net klaar → alles verversen (Pythago-status, bladen, runs)
    if (wasRunning.current && !running) loadInfo().catch(() => {});
    wasRunning.current = running;
  }, [running]);

  const now = Date.now() + tick * 0; // tick dwingt een nieuwe render af
  const competitors = (info && info.competitors) || [];
  const mk = info && info.markets ? info.markets[market] : null;
  const mInfo = BC_MARKETS.find((m) => m.key === market);
  const comps = competitors.filter((c) => c.market === market);
  const tabs = (info && info.tabs) || [];
  const timeline = (info && info.timeline) || [];
  const cur = job && job.cur;

  const totals = useMemo(() => {
    let active = 0;
    let known = 0;
    let today = 0;
    let week = 0;
    for (const c of competitors) {
      if (c.active !== false) active++;
      known += c.known || 0;
      const n = newCounts(c.daily, now);
      today += n.today;
      week += n.week;
    }
    return { active, known, today, week, open: tabs.filter((t) => !t.imported).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitors, tabs, tick]);

  const lastRun = info && info.runs && info.runs[0];

  async function act(name, fn) {
    setBusy(name);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  const start = (opts) =>
    act("start", async () => {
      await api({ action: "start", ...opts });
      await loadStatus();
    });
  const stop = () =>
    act("stop", async () => {
      await api({ action: "stop" });
      await loadStatus();
    });
  const resume = () =>
    act("resume", async () => {
      await api({ action: "resume" });
      await loadStatus();
    });

  const saveMarket = (patch, okMsg) =>
    act("market", async () => {
      const d = await api({ action: "saveMarket", market, ...patch });
      setInfo(d);
      setSheetEdit((s) => ({ ...s, [market]: undefined }));
      setNumEdit((s) => ({ ...s, [market]: undefined }));
      if (okMsg) setMsg(okMsg);
    });
  const saveSettings = (patch) =>
    act("settings", async () => {
      const d = await api({ action: "settings", ...patch });
      setInfo((prev) => ({ ...prev, cfg: d.cfg }));
    });

  const addCompetitor = () =>
    act("add", async () => {
      const d = await api({ action: "addCompetitor", market, ...add });
      setAdd({ url: "", visits: "", name: "", gender: "auto" });
      setMsg(d.entry.feed === "open" ? `${d.entry.name} toegevoegd — feed open${d.entry.expected ? `, ±${fmtN(d.entry.expected)} producten` : ""}. Klik "Scan" voor de eerste scan.` : `${d.entry.name} toegevoegd, maar de feed gaf geen antwoord${d.entry.feedStatus ? ` (HTTP ${d.entry.feedStatus})` : ""} — de scan probeert het opnieuw.`);
      await loadStatus();
    });
  const patchComp = (domain, patch) =>
    act(`comp:${domain}`, async () => {
      await api({ action: "updateCompetitor", domain, patch });
      await loadStatus();
    });
  const removeComp = (c) => {
    if (!window.confirm(`${c.name || c.domain} verwijderen? Het geheugen van deze competitor (${fmtN(c.known || 0)} producten) gaat mee weg.`)) return;
    act(`comp:${c.domain}`, async () => {
      await api({ action: "removeCompetitor", domain: c.domain });
      await loadStatus();
    });
  };
  const resetComp = (c) => {
    if (!window.confirm(`Geheugen van ${c.name || c.domain} wissen? De volgende scan ziet dan alles van de laatste ${info.cfg.maxAgeDays} dagen opnieuw als nieuw.`)) return;
    act(`comp:${c.domain}`, async () => {
      await api({ action: "resetCompetitor", domain: c.domain });
      await loadStatus();
    });
  };
  const markTab = (t, imported) =>
    act(`tab:${t.id}`, async () => {
      await api({ action: "markTab", id: t.id, imported });
      await loadStatus();
    });

  /* ---------------- status-regel bovenaan ---------------- */
  let dot = "idle";
  let main = "Wacht op de volgende scan";
  let sub = "";
  let pct = 0;
  if (running && job) {
    dot = "live";
    if (job.phase === "scan" && cur) {
      main = `Scant nu: ${cur.name || cur.domain}`;
      const exp = cur.expected || 0;
      pct = exp ? Math.min(98, Math.round((cur.seen / exp) * 100)) : Math.min(95, cur.page * 4);
      sub = `${fmtN(cur.seen)}${exp ? ` van ±${fmtN(exp)}` : ""} producten gelezen · ${cur.fresh || 0} nieuw · competitor ${Math.min(job.qi + 1, job.queue.length)} van ${job.queue.length}`;
    } else if (job.phase === "scan") {
      main = "Scan start…";
      sub = `${job.queue.length} competitor${job.queue.length === 1 ? "" : "s"} in de rij`;
    } else {
      main = "Verdelen over de stores en bladen schrijven…";
      pct = 99;
      sub = `${job.prog.fresh} nieuwe producten gevonden`;
    }
    if (job.stale) sub += " · even stil — wordt opnieuw aangezwengeld";
  } else if (job && job.status === "error") {
    dot = "err";
    main = "Laatste scan afgebroken";
    sub = job.error || "";
  } else if (job && job.status === "stopped") {
    main = "Scan gestopt";
    sub = "Klik Hervat om verder te gaan of start een nieuwe scan.";
  } else if (lastRun) {
    const p = lastRun.prog || {};
    main = p.placed ? `Laatste scan: ${p.placed} nieuwe producten in ${p.tabs} blad${p.tabs === 1 ? "" : "en"}` : p.fresh ? `Laatste scan: ${p.fresh} nieuw gevonden, niets weggeschreven` : "Laatste scan: niets nieuws";
    sub = `${when(lastRun.finishedAt, now)} · ${lastRun.label} · ${Math.max(1, Math.round((lastRun.finishedAt - lastRun.startedAt) / 60000))} min`;
  } else if (info) {
    main = "Nog geen scan gedraaid";
    sub = 'Koppel per markt de Competitor Import Sheet, voeg competitors toe en klik "Nu scannen".';
  }

  const sheetText = sheetEdit[market] !== undefined ? sheetEdit[market] : (mk && mk.sheetUrl) || "";
  const nums = { undercut: mk ? mk.undercut : BC_DEFAULTS.undercut, maxPerRun: mk ? mk.maxPerRun : BC_DEFAULTS.maxPerRun, ...(numEdit[market] || {}) };
  const numsDirty = mk && (Number(nums.undercut) !== mk.undercut || Number(nums.maxPerRun) !== mk.maxPerRun);
  const sheetDirty = mk && sheetText.trim() !== (mk.sheetUrl || "");

  // bladen per datum
  const shownTabs = tabs.filter((t) => t.market === market && (showDone || !t.imported));
  const days = [];
  for (const t of shownTabs) {
    let d = days.find((x) => x.date === t.date);
    if (!d) days.push((d = { date: t.date, tabs: [] }));
    d.tabs.push(t);
  }
  const doneCount = tabs.filter((t) => t.market === market && t.imported).length;
  const tl = tlMarket ? timeline.filter((e) => !e.market || e.market === market) : timeline;

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Big Competitors" />
      <div className="page">
        {/* ---------------- status ---------------- */}
        <div className="card">
          <h2>
            Big Competitors <span className="opt">nieuw toegevoegde producten van stores met 200k+ bezoek → import-blad per store, per datum</span>
          </h2>
          {info && !info.redis && <div className="card-warn" style={{ marginBottom: 12, padding: 10, borderRadius: 10 }}><div className="err">Redis ontbreekt — Big Competitors bewaart zijn geheugen in Redis.</div></div>}
          <div className="bc-hero-top">
            <span className={"bc-dot " + dot} />
            <div style={{ minWidth: 0 }}>
              <div className="bc-status-main">{main}</div>
              {sub && <div className="small muted" style={{ marginTop: 2 }}>{sub}</div>}
            </div>
            <div className="bc-actions">
              {!running ? (
                <>
                  <select value={scope} onChange={(e) => setScope(e.target.value)} title="Wat scannen?">
                    <option value="all">Alle markten</option>
                    {BC_MARKETS.map((m) => (
                      <option key={m.key} value={m.key}>Alleen {m.label}</option>
                    ))}
                  </select>
                  <button className="btn" style={{ width: "auto", padding: "11px 24px" }} disabled={!!busy || !info} onClick={() => start(scope === "all" ? {} : { markets: [scope] })}>
                    {busy === "start" ? "Starten…" : "Nu scannen"}
                  </button>
                  {job && (job.status === "stopped" || job.status === "error") && (
                    <button className="btn-ghost btn-small" disabled={!!busy} onClick={resume}>Hervat</button>
                  )}
                </>
              ) : (
                <button className="btn-ghost btn-small" disabled={!!busy} onClick={stop}>{job.stopRequested ? "Stopt na deze ronde…" : "Stop"}</button>
              )}
            </div>
          </div>
          {running && (
            <div className="pbar" style={{ marginTop: 14 }}>
              <div className="pbar-fill live" style={{ width: `${Math.max(3, pct)}%` }} />
            </div>
          )}
          {running && job && job.queue && (
            <div className="small muted" style={{ marginTop: 8 }}>
              {job.queue.map((q, i) => `${q.name} ${q.status === "klaar" || q.status === "deels" ? `✓ ${q.fresh || 0} nieuw` : q.status === "fout" ? "✗" : i === job.qi && job.phase === "scan" ? "…" : "wacht"}`).join(" · ")}
            </div>
          )}
          {err && <div className="hint err" style={{ marginTop: 10 }}>{err}</div>}
          {msg && <div className="hint" style={{ marginTop: 10, color: "var(--ok)" }}>{msg}</div>}

          <div className="cf-tiles bc-tiles">
            <div className="cf-tile"><b>{info ? totals.active : "—"}</b><span>competitors actief</span></div>
            <div className="cf-tile"><b>{info ? fmtN(totals.known) : "—"}</b><span>producten onthouden</span></div>
            <div className={"cf-tile" + (totals.today ? " cf-tile--ok" : "")}><b>{info ? totals.today : "—"}</b><span>nieuw vandaag</span></div>
            <div className="cf-tile"><b>{info ? totals.week : "—"}</b><span>nieuw laatste 7 dagen</span></div>
            <div className={"cf-tile" + (totals.open ? " cf-tile--warn" : "")}><b>{info ? totals.open : "—"}</b><span>bladen nog te importeren</span></div>
          </div>

          {info && (
            <div className="bc-opts">
              <label onClick={() => saveSettings({ nightly: !info.cfg.nightly })}>
                <span className={"switch" + (info.cfg.nightly ? " on" : "")} />
                Elke nacht automatisch scannen
              </label>
              <span>
                {info.cfg.nightly ? `Volgende nachtscan: ${dayIso(info.nextRun) === dayIso(now) ? "vandaag" : "vannacht"} ${clock(info.nextRun)}` : "Nachtscan staat uit — alleen met de knop"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Nieuw = hooguit
                <input
                  className="bc-num"
                  type="number"
                  min={7}
                  max={365}
                  defaultValue={info.cfg.maxAgeDays}
                  key={info.cfg.maxAgeDays}
                  onBlur={(e) => Number(e.target.value) !== info.cfg.maxAgeDays && saveSettings({ maxAgeDays: Number(e.target.value) })}
                />
                dagen geleden toegevoegd
              </span>
            </div>
          )}
        </div>

        {/* ---------------- per markt ---------------- */}
        <div className="card">
          <h2>
            Markt
            <span className="seg" style={{ marginLeft: 8 }}>
              {BC_MARKETS.map((m) => {
                const n = competitors.filter((c) => c.market === m.key && c.active !== false).length;
                return (
                  <button key={m.key} type="button" className={market === m.key ? "on" : ""} onClick={() => setMarket(m.key)}>
                    {m.label} <span style={{ opacity: 0.7 }}>· {n}</span>
                  </button>
                );
              })}
            </span>
            <span className="opt" style={{ marginLeft: "auto" }}>Australië doet niet mee</span>
          </h2>

          {!info && <div className="small muted">Laden…</div>}
          {info && mk && (
            <>
              <div className="field-label" style={{ marginTop: 0 }}>
                1 · Competitor Import Sheet {mInfo.label}
                <span className="opt">
                  {mk.sheetId ? (mk.sheetSource === "geheugen" ? "uit het store-geheugen (Keywords → Geheugen)" : mk.sheetSource === "standaard" ? "gekoppeld — de vaste sheet van deze markt" : "gekoppeld") : "nog niet gekoppeld"}
                </span>
              </div>
              <div className="bc-row">
                <input
                  type="text"
                  placeholder={`Link van de Google Sheet voor ${mInfo.label} — de tool maakt de bladen zelf`}
                  value={sheetText}
                  onChange={(e) => setSheetEdit((s) => ({ ...s, [market]: e.target.value }))}
                />
                <button className="btn-ghost btn-small" disabled={!!busy || !sheetDirty} onClick={() => saveMarket({ sheet: sheetText }, sheetText.trim() ? "Sheet gekoppeld." : "Sheet losgekoppeld.")}>
                  {busy === "market" ? "Opslaan…" : "Opslaan"}
                </button>
                {mk.sheetUrl && (
                  <a className="btn-ghost btn-small" href={mk.sheetUrl} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "none" }}>Open sheet ↗</a>
                )}
              </div>
              <div className="hint">
                Eén Google Sheet per markt, gedeeld als Bewerker met <b>{info.serviceAccount}</b>. Elke scan met nieuwe producten maakt een nieuw blad per store met de datum erbij
                (bijv. <i>24-11 · Soul Society Boutique (60)</i>) — ook als de vorige nog niet geïmporteerd zijn. Je kunt de link ook per store in Keywords → Geheugen zetten.
              </div>

              <div className="field-label">2 · Prijs en aantal</div>
              <div className="bc-opts">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Onze prijs
                  <input className="bc-num" type="number" min={0} max={100} value={nums.undercut} onChange={(e) => setNumEdit((s) => ({ ...s, [market]: { ...(s[market] || {}), undercut: e.target.value } }))} />
                  {mInfo.symbol} onder de concurrent
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Max
                  <input className="bc-num" type="number" min={5} max={1000} value={nums.maxPerRun} onChange={(e) => setNumEdit((s) => ({ ...s, [market]: { ...(s[market] || {}), maxPerRun: e.target.value } }))} />
                  nieuwe producten per scan
                </span>
                {numsDirty && (
                  <button className="btn-ghost btn-small" disabled={!!busy} onClick={() => saveMarket({ undercut: Number(nums.undercut), maxPerRun: Number(nums.maxPerRun) }, "Opgeslagen.")}>Opslaan</button>
                )}
              </div>
              <div className="hint">
                Voorbeeld: zij {mInfo.symbol}64,95 → wij {mInfo.symbol}
                {(Math.floor((64.95 - (Number(nums.undercut) || 0) + 0.05 + 1e-9) / 5) * 5 - 0.05).toFixed(2).replace(".", ",")} (naar beneden op het X4,95/X9,95-rooster). Doorstreepprijs: vast 50, 60 of 70% per product, aan te passen in kolom S.
                Vindt de scan meer dan het maximum, dan schuift de rest door naar de volgende scan (nieuwste eerst).
              </div>

              <div className="field-label">
                3 · Stores die meedoen <span className="opt">de tool verdeelt zelf: geslacht van de store + wat er volgens Pythago verkoopt</span>
              </div>
              <div className="bc-stores">
                {mk.stores.map((s) => (
                  <div key={s.domain} className={"bc-store" + (s.on ? "" : " off")}>
                    <span className={"switch" + (s.on ? " on" : "")} onClick={() => !busy && saveMarket({ stores: { [s.domain]: !s.on } })} title={s.on ? "Doet mee — klik om uit te zetten" : "Doet niet mee — klik om aan te zetten"} />
                    <div style={{ minWidth: 0 }}>
                      <b>{s.name}</b>
                      <div className="bc-sub">
                        {GENDER_LABEL[s.genders] || s.genders}
                        {s.on ? (s.pythago && s.pythago.hasData ? ` · Pythago: ${fmtN(s.pythago.orders)} orders in 30 dagen` : " · nog geen Pythago-cijfers (eerlijk verdeeld)") : ""}
                        {!s.native ? " · handmatig toegevoegd" : ""}
                      </div>
                    </div>
                  </div>
                ))}
                {!mk.stores.length && <div className="small muted" style={{ gridColumn: "1 / -1" }}>Nog geen store voor {mInfo.label} — voeg er hieronder één toe of zet de markt van de store goed in Keywords → Geheugen.</div>}
              </div>
              {mk.others.length > 0 && (
                <div className="bc-row" style={{ marginTop: 8 }}>
                  <select value={addOther} onChange={(e) => setAddOther(e.target.value)} style={{ width: "auto", margin: 0 }}>
                    <option value="">+ andere store toevoegen aan {mInfo.label}…</option>
                    {mk.others.map((s) => (
                      <option key={s.domain} value={s.domain}>{s.name}{s.market ? ` (staat op ${s.market})` : ""}</option>
                    ))}
                  </select>
                  {addOther && (
                    <button className="btn-ghost btn-small" disabled={!!busy} onClick={() => { saveMarket({ stores: { [addOther]: true } }); setAddOther(""); }}>Toevoegen</button>
                  )}
                </div>
              )}

              <div className="field-label">
                4 · Competitors {mInfo.label} <span className="opt">≥ {visitsLabel(BC_DEFAULTS.minVisits)} bezoek per maand · markt = waar het bezoek vandaan komt</span>
                {comps.length > 0 && !running && (
                  <button className="btn-ghost btn-small" style={{ marginLeft: "auto" }} disabled={!!busy} onClick={() => start({ markets: [market] })}>Scan {mInfo.label}</button>
                )}
              </div>
              <div className="bc-comps">
                {comps.map((c) => {
                  const scanning = running && cur && cur.domain === c.domain;
                  const n = newCounts(c.daily, now);
                  const off = c.active === false;
                  const gAuto = c.gender === "auto" || !c.gender;
                  let badge = <span className="badge bc-badge-off">wacht op eerste scan</span>;
                  if (off) badge = <span className="badge bc-badge-off">uit</span>;
                  else if (scanning) badge = <span className="badge badge-green">scant nu</span>;
                  else if (running && job.queue.some((q) => q.domain === c.domain && q.status === "wacht")) badge = <span className="badge badge-amber">in de rij</span>;
                  else if (c.lastStatus === "fout") badge = <span className="badge bc-badge-err">fout</span>;
                  else if (c.lastStatus === "deels") badge = <span className="badge badge-amber">deels gelezen</span>;
                  else if (c.lastStatus === "ok") badge = <span className="badge badge-green">ok</span>;
                  else if (c.feed === "dicht") badge = <span className="badge bc-badge-err">feed dicht</span>;
                  return (
                    <div key={c.domain} className={"bc-comp" + (scanning ? " scanning" : "") + (off ? " off" : "")}>
                      <div className="bc-comp-head">
                        <b>{c.name || c.domain}</b>
                        <a href={`https://${c.domain}`} target="_blank" rel="noreferrer noopener">{c.domain} ↗</a>
                        {c.visits ? <span className="badge bc-badge-off" title="Bezoek per maand">{visitsLabel(c.visits)}/mnd</span> : null}
                        <span style={{ marginLeft: "auto" }}>{badge}</span>
                      </div>
                      {scanning && (
                        <div>
                          <div className="pbar"><div className="pbar-fill live" style={{ width: `${Math.max(3, pct)}%` }} /></div>
                          <div className="small muted" style={{ marginTop: 5 }}>{fmtN(cur.seen)} producten gelezen · {cur.fresh || 0} nieuw</div>
                        </div>
                      )}
                      <div className="bc-facts">
                        <div className="bc-fact"><span>Laatste scan</span><b>{when(c.lastScanAt, now)}</b></div>
                        <div className="bc-fact"><span>Producten</span><b>{c.total ? fmtN(c.total) : c.expected ? `±${fmtN(c.expected)}` : "—"}</b></div>
                        <div className="bc-fact"><span>Onthouden</span><b>{fmtN(c.known || 0)}</b></div>
                        <div className="bc-fact" title={c.lastNewTitle || ""}><span>Laatste nieuwe product</span><b className={c.lastNewAt && now - c.lastNewAt < 86400000 ? "ok" : ""}>{c.lastNewAt ? when(c.lastNewAt, now) : "nog niets"}</b></div>
                        <div className="bc-fact"><span>Nieuw vandaag · 7 d</span><b className={n.today ? "ok" : ""}>{n.today} · {n.week}</b></div>
                        <div className="bc-fact" title="Nieuw gevonden maar nog niet in een blad (max per scan) — komt de volgende scan"><span>In de wachtrij</span><b>{fmtN(c.queued || 0)}</b></div>
                      </div>
                      {c.lastError && !scanning && <div className="small" style={{ color: c.lastStatus === "fout" ? "var(--err)" : "var(--warn)" }}>{c.lastError}</div>}
                      {c.currency && mInfo.currency !== c.currency && (
                        <div className="small" style={{ color: "var(--warn)" }}>Rekent in {c.currency}, niet in {mInfo.currency} — producten komen zonder prijs in het blad (prijsband van de importer).</div>
                      )}
                      <div className="bc-comp-foot">
                        <span className={"switch" + (off ? "" : " on")} onClick={() => !busy && patchComp(c.domain, { active: off })} title={off ? "Uit — klik om weer mee te scannen" : "Aan — klik om over te slaan"} />
                        <select value={gAuto ? "auto" : c.gender} onChange={(e) => patchComp(c.domain, { gender: e.target.value })} title="Geslacht van producten zonder men's/women's in de titel">
                          <option value="auto">Geslacht: automatisch{c.autoGender ? ` (${GENDER_LABEL[c.autoGender] || c.autoGender})` : ""}</option>
                          <option value="V">Alleen dames</option>
                          <option value="M">Alleen heren</option>
                          <option value="MV">Heren + dames</option>
                        </select>
                        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                          {!running && <button className="btn-ghost btn-small" disabled={!!busy} onClick={() => start({ domains: [c.domain] })}>Scan</button>}
                          <button className="btn-ghost btn-small" disabled={!!busy || running} onClick={() => resetComp(c)} title="Geheugen wissen: de volgende scan is weer een eerste scan">Wis geheugen</button>
                          <button className="btn-ghost btn-small" disabled={!!busy || running} onClick={() => removeComp(c)}>Verwijder</button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!comps.length && <div className="small muted">Nog geen competitors voor {mInfo.label}.</div>}

              <div className="field-label">Competitor toevoegen</div>
              <div className="bc-add">
                <input type="text" placeholder="Link of domein van de store, bijv. barbaradever.com" value={add.url} onChange={(e) => setAdd((a) => ({ ...a, url: e.target.value }))} />
                <input type="text" placeholder="Bezoek/mnd, bijv. 1.8M" value={add.visits} onChange={(e) => setAdd((a) => ({ ...a, visits: e.target.value }))} />
                <input type="text" placeholder="Naam (optioneel)" value={add.name} onChange={(e) => setAdd((a) => ({ ...a, name: e.target.value }))} />
                <select value={add.gender} onChange={(e) => setAdd((a) => ({ ...a, gender: e.target.value }))}>
                  <option value="auto">Geslacht: automatisch</option>
                  <option value="V">Alleen dames</option>
                  <option value="M">Alleen heren</option>
                  <option value="MV">Heren + dames</option>
                </select>
                <button className="btn-ghost btn-small" disabled={!!busy || !add.url.trim()} onClick={addCompetitor}>{busy === "add" ? "Checken…" : `Toevoegen aan ${mInfo.label}`}</button>
              </div>
            </>
          )}
        </div>

        {/* ---------------- datum-bladen ---------------- */}
        <div className="card">
          <h2>
            Klaar om te importeren — {mInfo.label} <span className="opt">één blad per store per datum · prijs en doorstreepprijs staan er al in</span>
            {doneCount > 0 && (
              <button className="linklike" style={{ marginLeft: "auto" }} onClick={() => setShowDone((v) => !v)}>{showDone ? "Verberg geïmporteerd" : `Toon ook geïmporteerd (${doneCount})`}</button>
            )}
          </h2>
          {!days.length && <div className="small muted">Nog geen bladen{doneCount ? " die open staan" : ""}. Na een scan met nieuwe producten staan ze hier, nieuwste datum bovenaan.</div>}
          {days.map((d) => (
            <div key={d.date} className="bc-day">
              <div className="bc-day-head">
                {dayShort(d.date)}{d.date === dayIso(now) ? " · vandaag" : d.date === dayIso(now - 86400000) ? " · gisteren" : ""} — {d.tabs.reduce((a, t) => a + (t.count || 0), 0)} producten
                {" · "}
                {d.tabs.map((t) => `${t.store} ${t.count}`).join(" · ")}
              </div>
              {d.tabs.map((t) => (
                <div key={t.id} className={"bc-tab" + (t.imported ? " done" : "")}>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ color: "var(--ink)" }}>{t.store}</b>
                    <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                  </div>
                  <div style={{ fontVariantNumeric: "tabular-nums" }}>{t.count} st.</div>
                  <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(t.competitors || []).join(", ")} · {t.time}</div>
                  <a className="btn-ghost btn-small" style={{ textDecoration: "none" }} href={t.url} target="_blank" rel="noreferrer noopener">Open blad ↗</a>
                  <a
                    className="btn-ghost btn-small"
                    style={{ textDecoration: "none", borderColor: "rgba(201,162,39,.5)", color: "var(--accent-hi)" }}
                    href={`/importer?bcSheet=${encodeURIComponent(t.sheetId)}&bcTab=${encodeURIComponent(t.title)}&bcStore=${encodeURIComponent(t.storeDomain)}&bcCur=${encodeURIComponent(t.currency || "")}&bcName=${encodeURIComponent(t.store)}`}
                  >
                    Importeren →
                  </a>
                  <label className="small muted" style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={!!t.imported} disabled={!!busy} onChange={(e) => markTab(t, e.target.checked)} /> geïmporteerd
                  </label>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* ---------------- tijdlijn ---------------- */}
        <div className="card">
          <h2>
            Tijdlijn <span className="opt">wanneer er gescand is, wat er nieuw was en waar het heen ging</span>
            <button className="linklike" style={{ marginLeft: "auto" }} onClick={() => setTlMarket((v) => !v)}>{tlMarket ? "Toon alle markten" : `Alleen ${mInfo.label}`}</button>
          </h2>
          {!tl.length && <div className="small muted">Nog niets gebeurd.</div>}
          <div className="bc-tl">
            {tl.map((e, i) => (
              <div key={`${e.t}-${i}`} className="bc-tl-item">
                <time title={new Date(e.t).toLocaleString("nl-NL")}>{dayIso(e.t) === dayIso(now) ? "vandaag" : dayShort(dayIso(e.t))} {clock(e.t)}</time>
                <span className={"bc-tl-dot " + (e.kind || "")} />
                <span>
                  {e.text}
                  {e.url && (
                    <>
                      {" "}
                      <a className="linklike" href={e.url} target="_blank" rel="noreferrer noopener">open ↗</a>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
