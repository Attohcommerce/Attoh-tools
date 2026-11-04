"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { MARKETS, MARKET_GROUPS, DEFAULT_MARKET_KEYS } from "@/lib/finder-markets";

/* COMPETITOR FINDER (03-11-2026) — Justins wekelijkse competitor research,
   door de tool. Twee tikken: markten kiezen → Scan nu.
   De zoekopdrachten verzint de tool zelf: per markt de producttitels van de
   beste stores uit de competitor-sheet (+ een vaste startset per taal),
   roterend per scan. Zoekt op Google per land via Apify (geen VPN), vindt
   nieuwe Shopify-stores, geeft ze een dropship-score en zet ze rechts klaar
   om naar de sheet + scraper-lijst te gaan. Maandbezoek (TrendTrack) vul je
   in het vakje in of laat je Claude invullen (fase 2). */

const LS_MARKETS = "attoh_cf_markets";
const LS_FILTER = "attoh_cf_filter";
const VERDICT_LABEL = { dropship: "Dropship", twijfel: "Twijfel", merk: "Merk/retailer" };

async function api(body) {
  const res = await fetch("/api/competitor-finder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const fmtN = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("nl-NL"));

function ScoreBadge({ score, verdict }) {
  const cls = verdict === "dropship" ? "badge badge-green" : verdict === "twijfel" ? "badge badge-amber" : "badge";
  return (
    <span className={cls} style={verdict === "merk" ? { border: "1px solid var(--line)", color: "var(--muted)" } : {}}>
      {score} · {VERDICT_LABEL[verdict] || verdict}
    </span>
  );
}

export default function CompetitorFinderPage() {
  const [info, setInfo] = useState(null);
  const [cfg, setCfg] = useState({ minVisits: 8000, pages: 1, queriesPerMarket: 60, aliCheck: true, weekly: true, weeklyMarkets: DEFAULT_MARKET_KEYS.join(","), ownStores: "", sheetId: "", sheetTab: "Google competitors" });
  const [sel, setSel] = useState(DEFAULT_MARKET_KEYS);
  const [job, setJob] = useState(null);
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showQueries, setShowQueries] = useState(false);
  const [filter, setFilter] = useState("dropship");
  const [onlyAbove, setOnlyAbove] = useState(true); // alleen winkels ≥ grens maandbezoek (onbekend blijft zichtbaar)
  const [marketFilter, setMarketFilter] = useState("");
  const [checked, setChecked] = useState({});
  const [visits, setVisits] = useState({});
  const [open, setOpen] = useState({});
  const [qMarket, setQMarket] = useState("USA");
  const [qText, setQText] = useState("");
  const [qMeta, setQMeta] = useState(null);
  const pollRef = useRef(null);
  const logRef = useRef(null);

  async function loadInfo() {
    const d = await api({ action: "info" });
    setInfo(d);
    setCfg(d.cfg);
    setLast(d.last);
    return d;
  }
  async function loadStatus() {
    const d = await api({ action: "status" });
    setJob(d.job);
    if (d.last) setLast(d.last);
    return d.job;
  }
  useEffect(() => {
    try {
      const m = JSON.parse(localStorage.getItem(LS_MARKETS) || "null");
      if (Array.isArray(m) && m.length) setSel(m);
      const f = localStorage.getItem(LS_FILTER);
      if (f) setFilter(f);
      const oa = localStorage.getItem("attoh_cf_only_above");
      if (oa === "0") setOnlyAbove(false);
    } catch {}
    loadInfo().catch((e) => setErr(String(e.message || e)));
    loadStatus().catch(() => {});
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_MARKETS, JSON.stringify(sel));
    } catch {}
  }, [sel]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_FILTER, filter);
    } catch {}
  }, [filter]);

  const running = job && job.status === "running";
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (running) pollRef.current = setInterval(() => loadStatus().catch(() => {}), 4000);
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [running]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job && job.log && job.log.length]);

  // zoekopdrachten-paneel: set van de gekozen markt laden
  useEffect(() => {
    if (!showQueries) return;
    let alive = true;
    setQText("");
    setQMeta(null);
    api({ action: "queries", market: qMarket })
      .then((d) => {
        if (!alive) return;
        setQText((d.queries || []).join("\n"));
        setQMeta(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [qMarket, showQueries]);

  function toggleMarket(k) {
    setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  }
  async function saveCfg(patch) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    try {
      const d = await api({ action: "config", cfg: next });
      setCfg(d.cfg);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }
  async function start() {
    setErr("");
    setBusy("start");
    try {
      await api({ action: "config", cfg });
      const d = await api({ action: "start", markets: sel, pages: cfg.pages, aliCheck: cfg.aliCheck, queriesPerMarket: cfg.queriesPerMarket, sheet: { sheetId: cfg.sheetId, tab: cfg.sheetTab } });
      setJob(d.job);
      setChecked({});
      setTimeout(() => loadStatus().catch(() => {}), 2500);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  async function stop() {
    setBusy("stop");
    try {
      setJob((await api({ action: "stop" })).job);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  async function resume() {
    setBusy("resume");
    try {
      setJob((await api({ action: "resume" })).job);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  /* ---- resultaten ---- */
  const minV = Number(cfg && cfg.minVisits) || 8000;
  const results = useMemo(() => (job && job.results && job.results.length ? job.results : last && last.results ? last.results : []), [job, last]);
  const shown = useMemo(
    () =>
      results
        .filter((r) => !r.added && !r.ignored)
        .filter((r) => (filter === "alles" ? true : r.verdict === filter))
        .filter((r) => (marketFilter ? (r.markets || []).includes(marketFilter) : true))
        .filter((r) => (onlyAbove && r.visits != null && r.visits !== "" ? Number(r.visits) >= minV : true))
        .sort((a, b) => {
          const va = a.visits != null && a.visits !== "" ? Number(a.visits) : null;
          const vb = b.visits != null && b.visits !== "" ? Number(b.visits) : null;
          const ra = va == null ? 1 : va >= minV ? 0 : 2; // boven grens → onbekend → eronder
          const rb = vb == null ? 1 : vb >= minV ? 0 : 2;
          if (ra !== rb) return ra - rb;
          if (ra === 0 && va !== vb) return vb - va;
          return (b.score || 0) - (a.score || 0);
        }),
    [results, filter, marketFilter, onlyAbove, minV]
  );
  const marketsInResults = useMemo(() => {
    const s = new Set();
    for (const r of results) for (const m of r.markets || []) s.add(m);
    return [...s];
  }, [results]);
  const selected = shown.filter((r) => checked[r.domain]);

  function rowsFor(list) {
    return list.map((r) => {
      const v = visits[r.domain] != null && visits[r.domain] !== "" ? Number(String(visits[r.domain]).replace(/[^\d]/g, "")) : r.visits || "";
      const market = (r.markets || [])[0] || "";
      const extra = (r.markets || []).slice(1);
      const bits = [`score ${r.score}`];
      if (r.ali && r.ali.found) bits.push("AliExpress ✓");
      if (r.theme) bits.push(r.theme);
      if (r.ageMonths != null) bits.push(`±${r.ageMonths} mnd`);
      if (extra.length) bits.push(`ook ${extra.join("+")}`);
      const tld = r.domain.split(".").pop();
      const m = MARKETS.find((x) => x.key === market);
      if (m && tld.length === 2 && tld !== m.gl && !["co", "io"].includes(tld)) bits.push(`gevonden in ${market}, .${tld}-domein`);
      return { domain: r.domain, market, name: r.merchant || r.vendorTop || r.domain.split(".")[0], products: r.products, visits: v, note: bits.join(" · ") };
    });
  }
  async function addSelected() {
    if (!selected.length) return;
    setBusy("add");
    setErr("");
    try {
      const d = await api({ action: "add", rows: rowsFor(selected), sheet: { sheetId: cfg.sheetId, tab: cfg.sheetTab } });
      setChecked({});
      await loadStatus();
      alert(`${d.written.length} winkel(s) in de sheet gezet · ${d.listAdded.length} nieuw in de scraper-lijst${d.listDupes ? ` (${d.listDupes} stond er al)` : ""}`);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  async function ignoreSelected() {
    if (!selected.length) return;
    setBusy("ignore");
    try {
      await api({ action: "ignore", domains: selected.map((r) => r.domain) });
      setChecked({});
      await loadStatus();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  function checkAllShown(on) {
    const next = { ...checked };
    for (const r of shown) next[r.domain] = on;
    setChecked(next);
  }

  /* ---- zoekopdrachten-paneel ---- */
  async function refreshPool() {
    setBusy("pool");
    setErr("");
    try {
      const d = await api({ action: "poolRefresh", market: qMarket, sheet: { sheetId: cfg.sheetId } });
      const q = await api({ action: "queries", market: qMarket });
      setQText((q.queries || []).join("\n"));
      setQMeta(q);
      await loadInfo();
      if (!d.stores || !d.stores.length) alert(`Geen stores voor ${qMarket} in je sheet — de startset uit de code wordt gebruikt (${d.count} zoekopdrachten).`);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  async function saveManual() {
    setBusy("q");
    try {
      const d = await api({ action: "saveQueries", market: qMarket, queries: qText.split("\n") });
      setQText(d.queries.join("\n"));
      setQMeta({ ...(qMeta || {}), source: "handmatig", override: true });
      await loadInfo();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  async function backToAuto() {
    setBusy("q");
    try {
      const d = await api({ action: "clearQueries", market: qMarket });
      setQText((d.queries || []).join("\n"));
      setQMeta(d);
      await loadInfo();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  const perMarket = (info && info.perMarket) || {};
  const prog = job && job.prog;
  const pct = job ? (job.phase === "search" ? Math.round(((job.qCursor || 0) / Math.max(1, job.totalQueries || 1)) * 55) : job.phase === "resolve" ? 55 + Math.round(((job.nCursor || 0) / Math.max(1, job.totalNames || 1)) * 5) : job.phase === "audit" ? 60 + Math.round(((job.aCursor || 0) / Math.max(1, job.totalCandidates || 1)) * 36) : job.phase === "visits" ? 97 : 100) : 0;
  const estQueries = sel.length * Math.min(cfg.queriesPerMarket || 60, 300);
  const estUsd = (estQueries * (cfg.pages || 1) * 0.0018).toFixed(2);

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Competitor finder" />
      <div className="page">
        <div className="layout-scraper">
          <div>
            <div className="card">
              <h2>
                Competitor finder <span className="opt">(Google per land · geen VPN · geen handwerk)</span>
              </h2>
              <div className="hint" style={{ marginBottom: 12 }}>
                Kies je markten en klik <b>Scan nu</b>. De tool zoekt op Google in elk land met de producttitels van de beste stores uit je
                competitor-sheet, vindt nieuwe dropship-stores en zet ze rechts klaar. Elke scan gebruikt andere titels, dus je vindt
                steeds nieuwe stores.
              </div>

              {info && (!info.apify || !info.redis) && (
                <div className="card-warn" style={{ marginBottom: 12 }}>
                  {!info.apify && <div className="err">APIFY_TOKEN ontbreekt in Vercel — zonder Apify kan de finder niet zoeken.</div>}
                  {!info.redis && <div className="err">Redis ontbreekt — de scan heeft Redis nodig voor de voortgang.</div>}
                </div>
              )}

              <div className="field-label">
                1 · Markten <span className="opt">({sel.length} gekozen)</span>
                <span style={{ float: "right", display: "inline-flex", gap: 6 }}>
                  <button className="btn-ghost btn-small" type="button" onClick={() => setSel(DEFAULT_MARKET_KEYS)}>Jouw 7</button>
                  <button className="btn-ghost btn-small" type="button" onClick={() => setSel(MARKETS.map((m) => m.key))}>Alle</button>
                  <button className="btn-ghost btn-small" type="button" onClick={() => setSel([])}>Geen</button>
                </span>
              </div>
              {MARKET_GROUPS.map((g) => (
                <div key={g} style={{ marginBottom: 8 }}>
                  <div className="small muted" style={{ marginBottom: 4 }}>{g}</div>
                  <div className="seg">
                    {MARKETS.filter((m) => m.group === g).map((m) => {
                      const pm = perMarket[m.key];
                      return (
                        <button key={m.key} type="button" className={sel.includes(m.key) ? "on" : ""} onClick={() => toggleMarket(m.key)} title={pm ? `${pm.count} zoekopdrachten (${pm.source}${pm.stores && pm.stores.length ? ` · ${pm.stores.join(", ")}` : ""})` : ""}>
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="field-label" style={{ marginTop: 12 }}>2 · Scannen</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {!running ? (
                  <button className="btn" onClick={start} disabled={!!busy || !sel.length} style={{ fontSize: 15, padding: "12px 26px" }}>
                    {busy === "start" ? "Starten…" : "Scan nu"}
                  </button>
                ) : (
                  <button className="btn-ghost" onClick={stop} disabled={!!busy}>{job.stopRequested ? "Stopt na deze ronde…" : "Stop"}</button>
                )}
                {job && (job.status === "stopped" || job.status === "error") && <button className="btn-ghost" onClick={resume} disabled={!!busy}>Hervat</button>}
                <span className="small muted">±{estQueries} zoekopdrachten · ±${estUsd} Apify · {cfg.aliCheck ? "AliExpress-check aan" : "AliExpress-check uit"}</span>
              </div>
              {err && <div className="hint err" style={{ marginTop: 10 }}>{err}</div>}

              {job && (
                <div style={{ marginTop: 14 }}>
                  <div className="pbar"><div className={"pbar-fill" + (running ? " live" : "")} style={{ width: `${pct}%` }} /></div>
                  <div className="small muted" style={{ marginTop: 6 }}>
                    {job.status === "running" ? (job.phase === "search" ? "Apify zoekt op Google (alle markten tegelijk) — intussen worden gevonden winkels al gecheckt…" : job.phase === "resolve" ? "Merchantnamen opzoeken…" : job.phase === "visits" ? "Maandbezoek ophalen (SimilarWeb)…" : "Winkels checken…") : job.status === "done" ? "Klaar" : job.status === "stopped" ? "Gestopt" : `Fout: ${job.error || ""}`}
                    {" · "}zoekopdrachten {job.qCursor || 0}/{job.totalQueries}{job.totalNames ? ` · merchantnamen ${job.nCursor || 0}/${job.totalNames}` : ""} · winkels gecheckt {job.aCursor || 0}/{job.totalCandidates}
                  </div>
                  {Array.isArray(job.runs) && job.runs.length > 0 && (
                    <div className="small muted" style={{ marginTop: 4 }}>
                      Apify: {job.runs.filter((r) => r.kind === "search").map((r) => `${r.market} ${r.status === "klaar" ? "✓" : r.status === "fout" ? "✗" : `${r.total > 1 ? `${r.done}/${r.total} runs klaar · ` : ""}bezig ${Math.max(0, Math.round((Date.now() - (r.startedAt || Date.now())) / 1000))} s`}`).join(" · ")}
                      {job.runs.some((r) => r.kind === "resolve") ? ` · merchantnamen: ${job.runs.filter((r) => r.kind === "resolve").map((r) => `${r.market} ${r.status === "klaar" ? "✓" : r.status === "fout" ? "✗" : "bezig"}`).join(" · ")}` : ""}
                      {job.runs.some((r) => r.kind === "visits") ? ` · maandbezoek: ${job.runs.filter((r) => r.kind === "visits").map((r) => (r.status === "klaar" ? "✓" : r.status === "fout" ? "✗" : `bezig ${Math.max(0, Math.round((Date.now() - (r.startedAt || Date.now())) / 1000))} s`)).join(" · ")}` : ""}
                    </div>
                  )}
                  {prog && (
                    <div className="statline" style={{ marginTop: 10 }}>
                      <div className="stat"><div className="stat-k">Gezien</div><div className="stat-v">{prog.found}</div></div>
                      <div className="stat"><div className="stat-k">Merk/markt</div><div className="stat-v">{prog.excluded}</div></div>
                      <div className="stat"><div className="stat-k">Al bekend</div><div className="stat-v">{prog.known}</div></div>
                      <div className="stat"><div className="stat-k">Nieuw</div><div className="stat-v">{prog.candidates}</div></div>
                      <div className="stat"><div className="stat-k">Dropship</div><div className="stat-v" style={{ color: "var(--ok)" }}>{prog.dropship}</div></div>
                      <div className="stat"><div className="stat-k">Twijfel</div><div className="stat-v" style={{ color: "var(--warn)" }}>{prog.twijfel}</div></div>
                      <div className="stat"><div className="stat-k">Merk</div><div className="stat-v">{prog.merk}</div></div>
                      <div className="stat"><div className="stat-k">Geen Shopify</div><div className="stat-v">{prog.nonShopify}</div></div>
                      <div className="stat"><div className="stat-k">Geleerd</div><div className="stat-v">{prog.learned || 0}</div></div>
                    </div>
                  )}
                  <div className="logpanel" ref={logRef} style={{ marginTop: 12, minHeight: 120, maxHeight: 260 }}>
                    {(job.log || []).map((l, i) => (
                      <div key={i} className={"log " + (l.cls || "")}><span className={l.cls || ""}>{l.text}</span></div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn-ghost btn-small" type="button" onClick={() => setShowSettings((v) => !v)}>{showSettings ? "▾" : "▸"} Instellingen</button>
                <button className="btn-ghost btn-small" type="button" onClick={() => setShowQueries((v) => !v)}>{showQueries ? "▾" : "▸"} Zoekopdrachten (automatisch)</button>
              </div>

              {showSettings && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <div className="field-label">Zoekopdrachten per markt <span className="opt">(per scan)</span></div>
                      <input type="number" min={5} max={300} value={cfg.queriesPerMarket} onChange={(e) => setCfg({ ...cfg, queriesPerMarket: Number(e.target.value) || 60 })} onBlur={() => saveCfg({ queriesPerMarket: cfg.queriesPerMarket })} />
                    </div>
                    <div>
                      <div className="field-label">Pagina's per zoekopdracht</div>
                      <select value={cfg.pages} onChange={(e) => saveCfg({ pages: Number(e.target.value) })}>
                        <option value={1}>1 (top 10 + gesponsord)</option>
                        <option value={2}>2 (top 20)</option>
                        <option value={3}>3 (top 30)</option>
                      </select>
                    </div>
                    <div>
                      <div className="field-label">AliExpress-check <span className="opt">(foto → +30)</span></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6 }}>
                        <span className={"switch" + (cfg.aliCheck ? " on" : "")} role="switch" aria-checked={!!cfg.aliCheck} onClick={() => saveCfg({ aliCheck: !cfg.aliCheck })} />
                        <span className="small muted">{cfg.aliCheck ? "aan" : "uit"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="field-label">Competitor-sheet <span className="opt">(gedeeld met attoh-sheets@attoh-tools.iam.gserviceaccount.com als Bewerker)</span></div>
                  <input type="text" value={cfg.sheetId} onChange={(e) => setCfg({ ...cfg, sheetId: e.target.value })} onBlur={() => saveCfg({ sheetId: cfg.sheetId })} placeholder="https://docs.google.com/spreadsheets/d/…" />
                  <div className="field-label">Tabblad <span className="opt">(het dashboard met de marktblokken)</span></div>
                  <input type="text" value={cfg.sheetTab} onChange={(e) => setCfg({ ...cfg, sheetTab: e.target.value })} onBlur={() => saveCfg({ sheetTab: cfg.sheetTab })} />
                  <div className="field-label">Grens maandbezoek</div>
                  <input type="number" min={0} step={1000} value={cfg.minVisits} onChange={(e) => setCfg({ ...cfg, minVisits: Number(e.target.value) || 0 })} onBlur={() => saveCfg({ minVisits: cfg.minVisits })} style={{ width: 140 }} />

                  <div className="field-label">Elke maandag automatisch <span className="opt">(Vercel-cron, 06:20 NL-tijd)</span></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span className={"switch" + (cfg.weekly !== false ? " on" : "")} role="switch" aria-checked={cfg.weekly !== false} onClick={() => saveCfg({ weekly: !(cfg.weekly !== false) })} />
                    <span className="small muted">{cfg.weekly !== false ? "aan" : "uit"} · markten: {String(cfg.weeklyMarkets || "").split(",").filter(Boolean).join(" · ") || "—"}</span>
                    <button className="btn-ghost btn-small" type="button" onClick={() => saveCfg({ weeklyMarkets: sel.join(",") })} disabled={!sel.length}>Huidige selectie gebruiken</button>
                  </div>

                  <div className="field-label">Eigen stores <span className="opt">(nooit als concurrent tonen; standaard al: SSB, LGB, EMC, SW, C&C, L&L, Sa Collective)</span></div>
                  <input type="text" value={cfg.ownStores || ""} onChange={(e) => setCfg({ ...cfg, ownStores: e.target.value })} onBlur={() => saveCfg({ ownStores: cfg.ownStores || "" })} placeholder="extra domeinen, komma-gescheiden" />
                </div>
              )}

              {showQueries && (
                <div style={{ marginTop: 10 }}>
                  <div className="hint" style={{ marginBottom: 8 }}>
                    Per markt haalt de tool zelf de producttitels van de 4 beste stores uit je sheet (±60 per store) en vult aan met een vaste
                    startset per taal. Hij ververst dit elke 7 dagen. Je hoeft hier niets te doen; alleen kijken of zelf een eigen lijst opslaan.
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={qMarket} onChange={(e) => setQMarket(e.target.value)} style={{ width: 200 }}>
                      {MARKETS.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}{perMarket[m.key] ? ` · ${perMarket[m.key].count}` : ""}</option>
                      ))}
                    </select>
                    <span className="small muted">
                      {qMeta ? `${qMeta.override ? "eigen lijst" : qMeta.source}${qMeta.stores && qMeta.stores.length ? ` · uit ${qMeta.stores.map((s) => s.domain).join(", ")}` : ""}${qMeta.at ? ` · ${new Date(qMeta.at).toLocaleDateString("nl-NL")}` : ""}` : ""} · {qText.split("\n").filter((x) => x.trim()).length} regels
                    </span>
                  </div>
                  <textarea value={qText} onChange={(e) => setQText(e.target.value)} rows={10} style={{ marginTop: 8, fontSize: 12.5 }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button className="btn-ghost" onClick={refreshPool} disabled={!!busy}>{busy === "pool" ? "Bezig…" : "Vernieuwen uit sheet"}</button>
                    <button className="btn-ghost" onClick={saveManual} disabled={!!busy}>{busy === "q" ? "Opslaan…" : "Opslaan als eigen lijst"}</button>
                    {qMeta && qMeta.override && <button className="btn-ghost" onClick={backToAuto} disabled={!!busy}>Terug naar automatisch</button>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="card">
              <h2>
                Resultaten <span className="opt">({shown.length} getoond · {results.length} totaal{last && !running && last.at ? ` · laatste scan ${new Date(last.at).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""})</span>
              </h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div className="seg">
                  {[["dropship", "Dropship"], ["twijfel", "Twijfel"], ["merk", "Merk/retailer"], ["alles", "Alles"]].map(([k, l]) => (
                    <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
                  ))}
                </div>
                {marketsInResults.length > 1 && (
                  <select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)} style={{ width: 160 }}>
                    <option value="">alle markten</option>
                    {marketsInResults.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
                <span style={{ flex: 1 }} />
                <button className="btn-ghost btn-small" type="button" onClick={() => checkAllShown(true)}>Alles aanvinken</button>
                <button className="btn-ghost btn-small" type="button" onClick={() => checkAllShown(false)}>Niets</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" onClick={addSelected} disabled={!!busy || !selected.length}>{busy === "add" ? "Schrijven…" : `Toevoegen aan sheet + lijst (${selected.length})`}</button>
                <button className="btn-ghost" onClick={ignoreSelected} disabled={!!busy || !selected.length}>Negeren ({selected.length})</button>
                <button type="button" className="btn-ghost btn-small" style={onlyAbove ? { borderColor: "var(--accent)", color: "var(--accent-hi)", background: "var(--accent-dim)" } : {}} onClick={() => { const v = !onlyAbove; setOnlyAbove(v); try { localStorage.setItem("attoh_cf_only_above", v ? "1" : "0"); } catch {} }} title="Winkels met een bekend maandbezoek onder de grens verbergen">
                  {onlyAbove ? "✓ " : ""}alleen ≥ {fmtN(minV)} bezoek/mnd
                </button>
                <span className="small muted">Maandbezoek komt automatisch (SimilarWeb) aan het eind van de scan; wil je het TrendTrack-cijfer gebruiken, typ het in het vakje.</span>
              </div>

              {!shown.length ? (
                <div className="hint" style={{ marginTop: 14 }}>
                  {results.length ? "Niets in dit filter." : running ? "Resultaten verschijnen zodra de eerste winkels gecheckt zijn." : "Nog geen scan gedaan. Kies links je markten en klik Scan nu."}
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  {shown.map((r) => {
                    const isOpen = !!open[r.domain];
                    return (
                      <div key={r.domain} className="log" style={{ display: "block", padding: "10px 2px" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <input type="checkbox" checked={!!checked[r.domain]} onChange={(e) => setChecked({ ...checked, [r.domain]: e.target.checked })} />
                          <a href={`https://${r.domain}/`} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{r.domain}</a>
                          <ScoreBadge score={r.score} verdict={r.verdict} />
                          <span className="small muted">{(r.markets || []).join(" · ")}</span>
                          <span className="small muted">{r.products}{r.productsPlus ? "+" : ""} producten</span>
                          {r.ageMonths != null && <span className="small muted">±{r.ageMonths} mnd</span>}
                          {r.ali && r.ali.found && <span className="badge badge-green" title={r.ali.top || ""}>AliExpress ✓</span>}
                          {r.earlier && <span className="small muted">eerder gevonden</span>}
                          <span style={{ flex: 1 }} />
                          {r.visits != null && r.visits !== "" ? (
                            Number(r.visits) >= minV ? (
                              <span className="badge badge-green" title={`SimilarWeb${r.visitsMonths && r.visitsMonths.length ? ` · laatste maanden: ${r.visitsMonths.map((x) => fmtN(x)).join(" → ")}` : ""}`}>{fmtN(Number(r.visits))} bezoek/mnd</span>
                            ) : r.visitsNoData || Number(r.visits) === 0 ? (
                              <span className="badge" style={{ opacity: 0.7 }} title="SimilarWeb heeft geen data voor deze site — dat betekent meestal minder dan ±5.000 bezoek/mnd">&lt; 5.000 bezoek/mnd</span>
                            ) : (
                              <span className="badge" style={{ opacity: 0.7 }} title="Onder je grens">{fmtN(Number(r.visits))} bezoek/mnd</span>
                            )
                          ) : (
                            <span className="small muted">{running ? "bezoek volgt…" : "bezoek onbekend"}</span>
                          )}
                          <input type="text" placeholder="eigen cijfer" value={visits[r.domain] != null ? visits[r.domain] : ""} onChange={(e) => setVisits({ ...visits, [r.domain]: e.target.value })} style={{ width: 92, padding: "5px 8px", fontSize: 12.5 }} title="Eigen maandbezoek (bijv. uit TrendTrack) — overschrijft het SimilarWeb-cijfer bij toevoegen" />
                          <button className="btn-ghost btn-small" type="button" onClick={() => setOpen({ ...open, [r.domain]: !isOpen })}>{isOpen ? "minder" : "details"}</button>
                        </div>
                        <div className="small muted" style={{ marginTop: 4 }}>
                          via: {(r.via || []).slice(0, 2).map((v) => `${v.market} "${v.query}" (${v.source === "product" ? "gesponsord product" : v.source === "ad" ? "advertentie" : "organisch"})`).join(" · ")}
                          {r.merchant ? ` · merchant "${r.merchant}"` : ""}
                        </div>
                        {isOpen && (
                          <div className="small" style={{ marginTop: 6, color: "var(--ink-2)" }}>
                            {r.vendorTop && <div>vendor: {r.vendorTop}{r.vendors > 1 ? ` (+${r.vendors - 1} andere)` : ""}{r.theme ? ` · thema ${r.theme}` : ""}</div>}
                            <div style={{ color: "var(--ok)" }}>{(r.signals || []).join(" · ") || "geen signalen"}</div>
                            {(r.negatives || []).length > 0 && <div style={{ color: "var(--err)" }}>{r.negatives.join(" · ")}</div>}
                            {r.images && r.images.length > 0 && (
                              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                {r.images.map((src) => <img key={src} src={src} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {info && Array.isArray(info.history) && info.history.length > 0 && (
              <div className="card">
                <h2>Vorige scans <span className="opt">(laatste {Math.min(10, info.history.length)})</span></h2>
                {info.history.slice(0, 10).map((h, i) => (
                  <div key={i} className="log" style={{ fontSize: 12.5 }}>
                    <span className="muted">{new Date(h.at).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{h.label || "Scan"} · {(h.markets || []).join(", ")}</span>
                    <span className="muted">{h.prog ? `${h.prog.candidates} nieuw → ${h.prog.dropship} dropship · ${h.prog.twijfel} twijfel${h.prog.learned ? ` · ${h.prog.learned} geleerd` : ""}` : ""}{h.minutes ? ` · ${h.minutes} min` : ""}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="card">
              <h2>Zo werkt het</h2>
              <div className="hint">
                1. <b>Scan nu</b> (of elke maandag vanzelf) → de tool zoekt op Google in elk gekozen land (via Apify, geen VPN) met echte producttitels van de beste stores uit je sheet, geschud en roterend: elke scan andere titels.<br /><br />
                2. Alle winkels uit organisch + advertenties + gesponsorde producten → merken/marketplaces en je eigen stores eruit → wat al in je sheet of scraper-lijst staat slaat hij over. Gesponsorde producten waarvan Google alleen een redirect geeft, zoekt hij op merchantnaam alsnog op.<br /><br />
                3. Elke nieuwe Shopify-store krijgt een dropship-score 0–100 (één vendor, bulk-import, compare-at overal, trust bar, sale-banner, HK/Ltd-adres, thema, reviews-app, leeftijd; foto op AliExpress = +30).<br /><br />
                4. <b>Zelflerend</b>: de titels van elke gevonden dropship-store gaan in het zoekgeheugen van die markt, dus de volgende scan zoekt met hun woorden en vindt weer nieuwe stores (sneeuwbal).<br /><br />
                5. Vink aan → <b>Toevoegen</b>: rij in het juiste marktblok van je sheet + in de lijst van de Product Scraper. Bezoek/mnd uit TrendTrack in het vakje, of later door Claude. Merk/retailer en "geen Shopify" onthoudt hij; dropship die je niet toevoegt komt terug als "eerder gevonden".
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
