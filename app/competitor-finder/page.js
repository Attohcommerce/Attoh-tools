"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { MARKETS, MARKET_GROUPS, DEFAULT_MARKET_KEYS, DEFAULT_QUERIES_EN, isEnglishMarket } from "@/lib/finder-markets";

/* COMPETITOR FINDER (03-11-2026) — Justins wekelijkse competitor research,
   door de tool: per markt op Google zoeken via Apify (land = countryCode,
   dus geen VPN), alle winkels uit organisch + "Gesponsorde producten",
   bekende winkels en merken eruit, Shopify-check + dropship-score, en de
   gekozen winkels naar de competitor-sheet (juiste marktblok) + de lijst
   van de Product Scraper. Het maandbezoek (TrendTrack) komt in fase 2. */

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
    <span className={cls} style={verdict === "merk" ? { border: "1px solid var(--line)", color: "var(--muted)" } : {}} title={VERDICT_LABEL[verdict] || ""}>
      {score} · {VERDICT_LABEL[verdict] || verdict}
    </span>
  );
}

export default function CompetitorFinderPage() {
  const [info, setInfo] = useState(null);
  const [cfg, setCfg] = useState({ minVisits: 8000, pages: 1, aliCheck: true, sheetId: "", sheetTab: "Google competitors" });
  const [sel, setSel] = useState(DEFAULT_MARKET_KEYS);
  const [queriesPerMarket, setQueriesPerMarket] = useState("");
  const [job, setJob] = useState(null);
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("dropship");
  const [marketFilter, setMarketFilter] = useState("");
  const [checked, setChecked] = useState({});
  const [visits, setVisits] = useState({});
  const [open, setOpen] = useState({});
  // zoekopdrachten-editor
  const [qMarket, setQMarket] = useState("NL/BE");
  const [qText, setQText] = useState("");
  const [qSource, setQSource] = useState("");
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

  // pollen zolang de scan loopt
  const running = job && job.status === "running";
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (running) {
      pollRef.current = setInterval(() => loadStatus().catch(() => {}), 4000);
    }
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [running]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job && job.log && job.log.length]);

  // editor: zoekopdrachten van de gekozen markt laden
  useEffect(() => {
    let alive = true;
    setQText("");
    setQSource("");
    api({ action: "queries", market: qMarket })
      .then((d) => {
        if (!alive) return;
        setQText((d.queries || []).join("\n"));
        setQSource(d.source || "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [qMarket]);

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
      const d = await api({
        action: "start",
        markets: sel,
        pages: cfg.pages,
        aliCheck: cfg.aliCheck,
        queriesPerMarket: queriesPerMarket ? Number(queriesPerMarket) : undefined,
        sheet: { sheetId: cfg.sheetId, tab: cfg.sheetTab },
      });
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
      const d = await api({ action: "stop" });
      setJob(d.job);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  async function resume() {
    setBusy("resume");
    try {
      const d = await api({ action: "resume" });
      setJob(d.job);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  /* ---- resultaten ---- */
  const results = useMemo(() => {
    const src = job && job.results && job.results.length ? job.results : last && last.results ? last.results : [];
    return src;
  }, [job, last]);
  const shown = useMemo(() => {
    return results
      .filter((r) => !r.added && !r.ignored)
      .filter((r) => (filter === "alles" ? true : r.verdict === filter))
      .filter((r) => (marketFilter ? (r.markets || []).includes(marketFilter) : true))
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [results, filter, marketFilter]);
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
      const extraMarkets = (r.markets || []).slice(1);
      const noteBits = [`score ${r.score}`];
      if (r.ali && r.ali.found) noteBits.push("AliExpress ✓");
      if (r.theme) noteBits.push(r.theme);
      if (r.ageMonths != null) noteBits.push(`±${r.ageMonths} mnd`);
      if (extraMarkets.length) noteBits.push(`ook ${extraMarkets.join("+")}`);
      const tld = r.domain.split(".").pop();
      const m = MARKETS.find((x) => x.key === market);
      if (m && tld.length === 2 && tld !== m.gl && !["com", "co", "net", "shop", "store", "online"].includes(tld)) noteBits.push(`gevonden in ${market}, .${tld}-domein`);
      return { domain: r.domain, market, name: r.merchant || r.vendorTop || r.domain.split(".")[0], products: r.productsPlus ? r.products : r.products, visits: v, note: noteBits.join(" · ") };
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
      await loadInfo();
      setErr("");
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
      await loadInfo();
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

  /* ---- zoekopdrachten-editor ---- */
  const qMarketDef = MARKETS.find((m) => m.key === qMarket);
  async function saveQueries() {
    setBusy("q");
    try {
      const d = await api({ action: "saveQueries", market: qMarket, queries: qText.split("\n") });
      setQText(d.queries.join("\n"));
      setQSource("handmatig");
      await loadInfo();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  async function localize() {
    setBusy("loc");
    setErr("");
    try {
      const d = await api({ action: "localize", market: qMarket });
      setQText(d.queries.join("\n"));
      setQSource("ai");
      await loadInfo();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  function resetEnglish() {
    setQText(DEFAULT_QUERIES_EN.join("\n"));
  }

  const perMarket = (info && info.perMarket) || {};
  const prog = job && job.prog;
  const pct = job
    ? job.phase === "search"
      ? Math.round(((job.qCursor || 0) / Math.max(1, job.totalQueries || 1)) * 60)
      : job.phase === "audit"
      ? 60 + Math.round(((job.aCursor || 0) / Math.max(1, job.totalCandidates || 1)) * 40)
      : 100
    : 0;
  const missingQueries = sel.filter((k) => !perMarket[k] || !perMarket[k].count);

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Competitor finder" />
      <div className="page">
        <div className="layout-scraper">
          <div>
            <div className="card">
              <h2>
                Competitor finder <span className="opt">(Google per land via Apify · geen VPN)</span>
              </h2>
              <div className="hint" style={{ marginBottom: 12 }}>
                Zoekt per markt op Google zoals jij dat doet (categorie-keyword + dropship-titel), haalt alle winkels uit
                organisch én de "Gesponsorde producten", gooit merken, marketplaces en alles wat al in je sheet of
                scraper-lijst staat eruit, en geeft elke nieuwe Shopify-store een dropship-score. Rechts kies je wat
                naar de sheet gaat. Maandbezoek (TrendTrack) vul je in of komt via Claude.
              </div>

              {info && (!info.apify || !info.redis) && (
                <div className="card-warn" style={{ marginBottom: 12 }}>
                  {!info.apify && <div className="err">APIFY_TOKEN ontbreekt in Vercel — zonder Apify kan de finder niet zoeken.</div>}
                  {!info.redis && <div className="err">REDIS_URL ontbreekt — de scan heeft Redis nodig voor de voortgang.</div>}
                </div>
              )}

              <div className="field-label">
                Markten <span className="opt">({sel.length} gekozen)</span>
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
                      const n = pm ? pm.count : isEnglishMarket(m) ? DEFAULT_QUERIES_EN.length : 0;
                      return (
                        <button key={m.key} type="button" className={sel.includes(m.key) ? "on" : ""} onClick={() => toggleMarket(m.key)} title={n ? `${n} zoekopdrachten (${pm ? pm.source : "standaard"})` : "nog geen zoekopdrachten — klik AI lokaliseren hieronder"}>
                          {m.label} <span className="opt" style={{ opacity: 0.7 }}>{n ? n : "⚠"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {missingQueries.length > 0 && (
                <div className="hint err" style={{ marginTop: 4 }}>
                  Nog geen zoekopdrachten voor: {missingQueries.join(", ")}. Kies de markt hieronder bij "Zoekopdrachten" en klik "AI lokaliseren".
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 10 }}>
                <div>
                  <div className="field-label">Pagina's per zoekopdracht</div>
                  <select value={cfg.pages} onChange={(e) => saveCfg({ pages: Number(e.target.value) })}>
                    <option value={1}>1 (top 10 + gesponsord)</option>
                    <option value={2}>2 (top 20)</option>
                    <option value={3}>3 (top 30)</option>
                  </select>
                </div>
                <div>
                  <div className="field-label">Zoekopdrachten per markt <span className="opt">(leeg = alle)</span></div>
                  <input type="number" min={4} max={200} placeholder="alle" value={queriesPerMarket} onChange={(e) => setQueriesPerMarket(e.target.value)} />
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

              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                {!running ? (
                  <button className="btn" onClick={start} disabled={!!busy || !sel.length || missingQueries.length > 0}>
                    {busy === "start" ? "Starten…" : "Scan nu"}
                  </button>
                ) : (
                  <button className="btn-ghost" onClick={stop} disabled={!!busy}>
                    {job.stopRequested ? "Stopt na deze ronde…" : "Stop"}
                  </button>
                )}
                {job && (job.status === "stopped" || job.status === "error") && (
                  <button className="btn-ghost" onClick={resume} disabled={!!busy}>Hervat</button>
                )}
                {job && job.stale && <span className="small err">keten stil — status-poll start hem opnieuw</span>}
                <span className="small muted">
                  Kosten: ±{(sel.reduce((a, k) => a + ((perMarket[k] && perMarket[k].count) || 0), 0) * (cfg.pages || 1) * 0.0018).toFixed(2)} USD Apify per scan
                </span>
              </div>
              {err && <div className="hint err" style={{ marginTop: 10 }}>{err}</div>}

              {job && (
                <div style={{ marginTop: 14 }}>
                  <div className="pbar"><div className={"pbar-fill" + (running ? " live" : "")} style={{ width: `${pct}%` }} /></div>
                  <div className="small muted" style={{ marginTop: 6 }}>
                    {job.status === "running" ? (job.phase === "search" ? "Zoeken op Google…" : "Winkels checken…") : job.status === "done" ? "Klaar" : job.status === "stopped" ? "Gestopt" : `Fout: ${job.error || ""}`}
                    {" · "}zoekopdrachten {job.qCursor || 0}/{job.totalQueries} · winkels gecheckt {job.aCursor || 0}/{job.totalCandidates}
                  </div>
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
                    </div>
                  )}
                  <div className="logpanel" ref={logRef} style={{ marginTop: 12, minHeight: 120, maxHeight: 260 }}>
                    {(job.log || []).map((l, i) => (
                      <div key={i} className={"log " + (l.cls || "")}><span className={l.cls || ""}>{l.text}</span></div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <h2>
                Zoekopdrachten per markt <span className="opt">(wat de finder intikt op Google)</span>
              </h2>
              <div className="hint" style={{ marginBottom: 10 }}>
                Engelse markten gebruiken de standaardset (categorie-keyword + dropship-titel, dames én heren). Voor
                andere talen maakt de AI één keer een lokale set zoals lokale dropshippers hun titels schrijven; daarna
                pas je hem hier aan. Eén zoekopdracht per regel.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select value={qMarket} onChange={(e) => setQMarket(e.target.value)} style={{ width: 200 }}>
                  {MARKETS.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}{perMarket[m.key] && perMarket[m.key].count ? ` · ${perMarket[m.key].count}` : " · ⚠"}</option>
                  ))}
                </select>
                <span className="small muted">{qSource ? `bron: ${qSource}` : ""} · {qText.split("\n").filter((x) => x.trim()).length} regels</span>
              </div>
              <textarea value={qText} onChange={(e) => setQText(e.target.value)} rows={12} style={{ marginTop: 8, fontSize: 12.5 }} placeholder={qMarketDef && !isEnglishMarket(qMarketDef) ? 'Nog leeg — klik "AI lokaliseren"' : ""} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={saveQueries} disabled={!!busy}>{busy === "q" ? "Opslaan…" : "Opslaan"}</button>
                <button className="btn-ghost" onClick={localize} disabled={!!busy}>{busy === "loc" ? "AI bezig…" : `AI lokaliseren (${qMarketDef ? qMarketDef.lang.split(" ")[0] : ""})`}</button>
                <button className="btn-ghost" onClick={resetEnglish} disabled={!!busy}>Engelse standaard laden</button>
              </div>
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
                <span className="spacer" style={{ flex: 1 }} />
                <button className="btn-ghost btn-small" type="button" onClick={() => checkAllShown(true)}>Alles aanvinken</button>
                <button className="btn-ghost btn-small" type="button" onClick={() => checkAllShown(false)}>Niets</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" onClick={addSelected} disabled={!!busy || !selected.length}>
                  {busy === "add" ? "Schrijven…" : `Toevoegen aan sheet + lijst (${selected.length})`}
                </button>
                <button className="btn-ghost" onClick={ignoreSelected} disabled={!!busy || !selected.length}>Negeren ({selected.length})</button>
                <span className="small muted">Bezoek/mnd onder {fmtN(cfg.minVisits)} → beter eerst in de wachtrij laten; vul het TrendTrack-cijfer in het vakje in.</span>
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
                          <span className="spacer" style={{ flex: 1 }} />
                          <input
                            type="text"
                            placeholder="bezoek/mnd"
                            value={visits[r.domain] != null ? visits[r.domain] : r.visits || ""}
                            onChange={(e) => setVisits({ ...visits, [r.domain]: e.target.value })}
                            style={{ width: 110, padding: "5px 8px", fontSize: 12.5 }}
                            title="Maandbezoek uit TrendTrack"
                          />
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

            <div className="card">
              <h2>Zo werkt het</h2>
              <div className="hint">
                1. Kies markten en klik <b>Scan nu</b>. De tool zoekt via Apify op Google in dat land (geen VPN).<br /><br />
                2. Alle winkels uit organisch + gesponsorde producten → merken/marketplaces eruit → wat al in je sheet,
                scraper-lijst of eerder genegeerd is, slaat hij over.<br /><br />
                3. Elke nieuwe winkel: Shopify? → dropship-score 0–100 (één vendor, bulk-import, compare-at overal,
                trust bar, sale-banner, Ltd/HK-adres, thema, reviews-app, leeftijd; AliExpress-foto = +30).<br /><br />
                4. Vink aan → <b>Toevoegen</b>: rij in het juiste marktblok van je sheet + in de lijst van de Product
                Scraper. Vul het TrendTrack-bezoek in het vakje in als je het weet; anders laat Claude het invullen.<br /><br />
                5. Merk/retailer en "geen Shopify" onthoudt hij — volgende scan niet opnieuw gecheckt. Dropship/twijfel
                die je niet toevoegt komt de volgende keer meteen terug als "eerder gevonden".
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
