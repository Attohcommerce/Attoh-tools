"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";

/* TREND SCRAPER (27-11-2026) — Justin: "scraper voor AliExpress en Temu om
   producten te vinden die NU trending zijn. Wat op AliExpress en Temu
   verkoopt, verkoopt ook via Google Ads."

   Stap 1  Bron(nen) + markt + preset (of eigen keywords) → "Zoek trending".
           De zoektocht draait op Apify (asynchroon); deze pagina pollt.
   Stap 2  Resultaten: foto, titel, verkocht, rating, prijs, trendscore.
           Filteren op groep / geslacht / minimaal verkocht, aanvinken.
   Stap 3  "→ Import-wachtrij": de aangevinkte producten staan daarna in de
           Importer, tab "Trending" (foto's met Chinese tekst/maattabellen
           worden daar automatisch weggefilterd; slechte foto's → AI-foto's).
   Extra   "Trending keywords" → kopieerbaar lijstje voor de Keywords-tool. */

async function api(body) {
  const res = await fetch("/api/trend-scraper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const fmtN = (n) => (n ? Number(n).toLocaleString("nl-NL") : "—");
const G_LABEL = { V: "Vrouw", M: "Man", U: "Unisex" };

export default function TrendScraperPage() {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [sources, setSources] = useState({ aliexpress: true, temu: true });
  const [market, setMarket] = useState("US");
  const [preset, setPreset] = useState("winter-hanish");
  const [ownKw, setOwnKw] = useState("");
  const [ownGender, setOwnGender] = useState("V");
  const [perKeyword, setPerKeyword] = useState(20);
  const [minSold, setMinSold] = useState(100);
  const [job, setJob] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState("");
  const [picked, setPicked] = useState({});
  const [fGroup, setFGroup] = useState("");
  const [fGender, setFGender] = useState("");
  const [fSource, setFSource] = useState("");
  const [fMinSold, setFMinSold] = useState(0);
  const [queue, setQueue] = useState([]);
  const [keywords, setKeywords] = useState(null);
  const [preview, setPreview] = useState(null);
  const pollRef = useRef(null);

  async function loadInfo() {
    const d = await api({ action: "info" });
    setInfo(d);
    setJob(d.job || null);
    if (d.job && d.job.done) {
      const r = await api({ action: "results" });
      setResults(r.results || null);
    }
    const q = await api({ action: "queue" });
    setQueue(q.queue || []);
  }
  useEffect(() => {
    loadInfo().catch((e) => setErr(e.message));
  }, []);

  const running = !!(job && !job.done);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!running) return;
    pollRef.current = setInterval(async () => {
      try {
        const d = await api({ action: "tick" });
        setJob(d.job || null);
        if (d.results) {
          setResults(d.results);
          setPicked({});
          setMsg(`Klaar: ${d.results.total} trending producten gevonden.`);
        }
      } catch (e) {
        setErr(e.message);
      }
    }, 6000);
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [running]);

  const presetKws = (info && info.presets && info.presets[preset] && info.presets[preset].keywords) || [];
  const ownList = ownKw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((kw) => ({ kw, gender: ownGender, group: "Eigen keywords" }));

  async function start() {
    setErr("");
    setMsg("");
    setBusy("start");
    try {
      const d = await api({
        action: "start",
        sources: Object.keys(sources).filter((k) => sources[k]),
        market,
        preset: ownList.length ? null : preset,
        keywords: ownList.length ? ownList : undefined,
        perKeyword,
        minSold,
      });
      setJob(d.job);
      setResults(null);
      setMsg("Zoektocht gestart op Apify — dit duurt meestal 2–8 minuten. Je mag deze pagina open laten of later terugkomen.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  const items = (results && results.items) || [];
  const groups = useMemo(() => [...new Set(items.map((i) => i.group).filter(Boolean))], [items]);
  const shown = useMemo(
    () =>
      items.filter(
        (i) =>
          (!fGroup || i.group === fGroup) &&
          (!fGender || i.gender === fGender) &&
          (!fSource || i.source === fSource) &&
          (!fMinSold || i.sold >= fMinSold)
      ),
    [items, fGroup, fGender, fSource, fMinSold]
  );
  const pickedList = items.filter((i) => picked[i.url]);
  const inQueue = new Set(queue.map((q) => q.url));

  function pickTop(n) {
    const next = {};
    for (const i of shown.slice(0, n)) if (!inQueue.has(i.url)) next[i.url] = true;
    setPicked(next);
  }

  async function toQueue() {
    setBusy("queue");
    try {
      const d = await api({ action: "queueAdd", items: pickedList });
      setMsg(`${d.added} producten in de import-wachtrij gezet (totaal ${d.total}). Open de Importer → tab "Trending".`);
      setPicked({});
      const q = await api({ action: "queue" });
      setQueue(q.queue || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  async function loadKeywords() {
    setBusy("kw");
    try {
      const d = await api({ action: "keywords", limit: 80 });
      setKeywords(d.keywords || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  async function testOne(url) {
    setPreview({ url, loading: true });
    try {
      const d = await api({ action: "preview", url });
      setPreview({ url, ...d });
    } catch (e) {
      setPreview({ url, ok: false, error: e.message });
    }
  }

  const avail = info && info.available;

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Trend Scraper · AliExpress + Temu" />
      <div className="page">
        {err ? <div className="hint err" style={{ marginBottom: 10 }}>{err}</div> : null}
        {msg ? <div className="hint" style={{ marginBottom: 10 }}>{msg}</div> : null}
        {avail && !avail.apify ? <div className="hint err">APIFY_TOKEN ontbreekt in Vercel — zonder Apify kan de Trend Scraper niet zoeken.</div> : null}

        <div className="card">
          <h2>
            🔥 Zoek trending producten
            <span className="opt">AliExpress + Temu, gesorteerd op meest verkocht</span>
          </h2>
          <div className="field-label">Bronnen</div>
          <div className="seg" style={{ marginBottom: 10 }}>
            {["aliexpress", "temu"].map((s) => (
              <button key={s} className={sources[s] ? "on" : ""} onClick={() => setSources({ ...sources, [s]: !sources[s] })}>
                {sources[s] ? "✓ " : ""}
                {s === "aliexpress" ? "AliExpress" : "Temu"}
              </button>
            ))}
          </div>
          <div className="field-label">Markt</div>
          <div className="seg" style={{ marginBottom: 10 }}>
            {Object.entries((info && info.markets) || {}).map(([k, m]) => (
              <button key={k} className={market === k ? "on" : ""} onClick={() => setMarket(k)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="field-label">Preset</div>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ marginBottom: 6 }}>
            {Object.entries((info && info.presets) || {}).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label} ({p.keywords.length} zoekopdrachten)
              </option>
            ))}
          </select>
          <details style={{ marginBottom: 10 }}>
            <summary className="small muted">Bekijk de {presetKws.length} zoekopdrachten van deze preset</summary>
            <div className="small muted" style={{ columns: 3, marginTop: 6 }}>
              {presetKws.map((k) => (
                <div key={k.kw}>
                  {k.kw} <span className="opt">· {G_LABEL[k.gender]}</span>
                </div>
              ))}
            </div>
          </details>
          <div className="field-label">
            Of eigen keywords <span className="opt">(één per regel — vervangt de preset)</span>
          </div>
          <textarea rows={3} value={ownKw} onChange={(e) => setOwnKw(e.target.value)} placeholder={"sherpa lined jacket women\nfleece lined leggings"} />
          {ownList.length ? (
            <div className="seg" style={{ margin: "6px 0 10px" }}>
              {["V", "M", "U"].map((g) => (
                <button key={g} className={ownGender === g ? "on" : ""} onClick={() => setOwnGender(g)}>
                  {G_LABEL[g]}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end", margin: "10px 0" }}>
            <label className="small">
              Producten per keyword
              <input type="number" min={5} max={60} value={perKeyword} onChange={(e) => setPerKeyword(Number(e.target.value) || 20)} style={{ width: 80, display: "block" }} />
            </label>
            <label className="small">
              Minimaal verkocht
              <input type="number" min={0} value={minSold} onChange={(e) => setMinSold(Number(e.target.value) || 0)} style={{ width: 90, display: "block" }} />
            </label>
            <span className="grow" />
            <button className="btn" disabled={running || busy === "start" || !Object.values(sources).some(Boolean)} onClick={start}>
              {running ? "Bezig met zoeken…" : busy === "start" ? "Starten…" : "🔥 Zoek trending"}
            </button>
          </div>
          {job ? (
            <div className="small muted">
              {job.done ? "Laatste zoektocht klaar" : "Zoektocht loopt"} · gestart {new Date(job.startedAt).toLocaleString("nl-NL")} · {job.keywords.length} keywords ·{" "}
              {job.runs.map((r) => `${r.source === "aliexpress" ? "AliExpress" : "Temu"}: ${r.error ? "fout — " + r.error : r.status}${r.count != null ? ` (${r.count})` : ""}`).join(" · ")}
              {running ? (
                <button className="btn-ghost btn-small" style={{ marginLeft: 8 }} onClick={() => api({ action: "stop" }).then(() => setJob(null))}>
                  Stop
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {results ? (
          <div className="card">
            <h2>
              📈 Trending producten
              <span className="opt">
                {fmtN(results.total)} gevonden · {Object.entries(results.skipped || {}).map(([k, v]) => `${v} ${k}`).join(" · ") || "niets weggefilterd"}
              </span>
            </h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
              <select value={fSource} onChange={(e) => setFSource(e.target.value)}>
                <option value="">Alle bronnen</option>
                <option value="aliexpress">AliExpress</option>
                <option value="temu">Temu</option>
              </select>
              <select value={fGroup} onChange={(e) => setFGroup(e.target.value)}>
                <option value="">Alle groepen</option>
                {groups.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <select value={fGender} onChange={(e) => setFGender(e.target.value)}>
                <option value="">Man + vrouw</option>
                <option value="V">Vrouw</option>
                <option value="M">Man</option>
                <option value="U">Unisex</option>
              </select>
              <label className="small">
                min. verkocht <input type="number" value={fMinSold} onChange={(e) => setFMinSold(Number(e.target.value) || 0)} style={{ width: 80 }} />
              </label>
              <span className="grow" />
              <button className="btn-ghost btn-small" onClick={() => pickTop(25)}>Top 25 aanvinken</button>
              <button className="btn-ghost btn-small" onClick={() => pickTop(50)}>Top 50</button>
              <button className="btn-ghost btn-small" onClick={() => setPicked({})}>Niets</button>
              <button className="btn" disabled={!pickedList.length || busy === "queue"} onClick={toQueue}>
                → Import-wachtrij ({pickedList.length})
              </button>
            </div>
            <div style={{ maxHeight: "65vh", overflow: "auto" }}>
              <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", position: "sticky", top: 0, background: "var(--card, #111)" }}>
                    <th></th>
                    <th>Foto</th>
                    <th>Product</th>
                    <th>Bron</th>
                    <th>Score</th>
                    <th>Verkocht</th>
                    <th>Rating</th>
                    <th>Prijs</th>
                    <th>Groep</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 600).map((i) => (
                    <tr key={i.url} style={{ borderTop: "1px solid rgba(127,127,127,.15)", opacity: inQueue.has(i.url) ? 0.45 : 1 }}>
                      <td>
                        <input type="checkbox" disabled={inQueue.has(i.url)} checked={!!picked[i.url]} onChange={(e) => setPicked({ ...picked, [i.url]: e.target.checked })} />
                      </td>
                      <td>{i.image ? <img src={i.image} alt="" loading="lazy" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} /> : null}</td>
                      <td style={{ maxWidth: 380 }}>
                        <a href={i.url} target="_blank" rel="noreferrer" className="linklike">
                          {i.title.slice(0, 110)}
                        </a>
                        <div className="muted">
                          {i.keyword} · {G_LABEL[i.gender] || "—"}
                          {inQueue.has(i.url) ? " · al in wachtrij" : ""}
                        </div>
                      </td>
                      <td>{i.source === "aliexpress" ? "AliExpress" : "Temu"}</td>
                      <td>
                        <b>{i.score}</b>
                      </td>
                      <td>{i.soldText || fmtN(i.sold)}</td>
                      <td>{i.rating ? `${i.rating}★` : "—"}</td>
                      <td>{i.price ? `$${i.price.toFixed(2)}` : "—"}</td>
                      <td className="muted">{i.group}</td>
                      <td>
                        <button className="btn-ghost btn-small" onClick={() => testOne(i.url)}>Test foto's</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length > 600 ? <div className="hint">Eerste 600 van {shown.length} getoond — filter verder.</div> : null}
          </div>
        ) : null}

        {preview ? (
          <div className="card">
            <h2>
              🧪 Foto-test
              <span className="opt">zo komt dit product in de importer binnen</span>
              <button className="btn-ghost btn-small" style={{ marginLeft: "auto" }} onClick={() => setPreview(null)}>Sluiten</button>
            </h2>
            {preview.loading ? (
              <div className="small muted">Details ophalen + foto's controleren… (±20–40 sec)</div>
            ) : preview.ok ? (
              <>
                <div className="small">
                  <b>{preview.product.title}</b> · {preview.product.variants.length} varianten ·{" "}
                  {preview.photo ? `${preview.photo.kept} goede foto's, ${preview.photo.dropped} eruit (${Object.entries(preview.photo.reasons || {}).map(([k, v]) => `${v}× ${k}`).join(", ") || "—"}) · fotocijfer ${preview.photo.score}` : ""}
                  {preview.photo && preview.photo.needsAiPhotos ? <span className="badge badge-amber" style={{ marginLeft: 6 }}>krijgt AI-foto's</span> : <span className="badge badge-green" style={{ marginLeft: 6 }}>foto's goed</span>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {preview.product.images.map((im) => (
                    <img key={im.src} src={im.src} alt="" style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 6 }} />
                  ))}
                </div>
              </>
            ) : (
              <div className="hint err">{preview.error}</div>
            )}
          </div>
        ) : null}

        <div className="card">
          <h2>
            📥 Import-wachtrij
            <span className="opt">{queue.length} producten · importeren via Importer → tab "Trending"</span>
          </h2>
          {queue.length ? (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {queue.slice(0, 80).map((q) => (
                  <img key={q.url} title={q.title} src={q.image} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                ))}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <a className="btn" href="/importer?bron=trending">Naar de Importer →</a>
                <button className="btn-ghost btn-small" onClick={() => api({ action: "queueClear" }).then(() => setQueue([]))}>Wachtrij leegmaken</button>
              </div>
            </>
          ) : (
            <div className="small muted">Nog leeg. Vink producten aan en klik "→ Import-wachtrij".</div>
          )}
        </div>

        <div className="card">
          <h2>
            🔑 Trending keywords
            <span className="opt">productsoorten die nu het vaakst terugkomen in de bestsellers — voor de Keywords-tool</span>
          </h2>
          <button className="btn-ghost btn-small" disabled={!results || busy === "kw"} onClick={loadKeywords}>
            {busy === "kw" ? "Bezig…" : "Haal trending keywords uit de resultaten"}
          </button>
          {keywords ? (
            <>
              <textarea readOnly rows={8} style={{ marginTop: 8 }} value={keywords.map((k) => k.kw).join("\n")} />
              <div className="hint">{keywords.length} keywords — kopieer ze naar Keywords (stap 1) of de Product Scraper.</div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
