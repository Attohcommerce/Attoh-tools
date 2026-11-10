"use client";
// 03 IMPORTLIJST — wat moet er in de store? Per regel zoekt de tool de
// producten bij de concurrenten, en importeert één product met onze titel,
// huisstijl-omschrijving, de beste foto's, varianten en collecties.
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../components/sfx";
import { postJSON, creds, money, lsGet } from "./util";
import { RELEASE_DATES } from "@/lib/pokemon/brain";

const SET_ORDER = ["Delta Reign", "30th Celebration", "Ascended Heroes", "Perfect Order", "Chaos Rising", "Pitch Black", "", "Nihil Zero", "Ninja Spinner", "Abyss Eye", "Storm Emeralda"];

export default function ListTab({ notify, store, goDoctor }) {
  const [rows, setRows] = useState([]);
  const [preset, setPreset] = useState(true);
  const [brain, setBrain] = useState("");
  const [matches, setMatches] = useState({});
  const [imported, setImported] = useState({});
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [settings, setSettings] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [run, setRun] = useState(null);
  const [log, setLog] = useState([]);
  const stopRef = useRef(false);
  const fileRef = useRef(null);
  const addLog = (msg, cls = "") => setLog((l) => [...l.slice(-300), { t: new Date().toLocaleTimeString("nl-NL"), msg, cls }]);

  async function loadList() {
    setLoading(true);
    try {
      const r = await fetch("/api/pokemon/importlist").then((x) => x.json());
      setRows(r.rows || []);
      setPreset(!!r.preset);
      setBrain(r.brain || "");
    } catch (e) {
      notify("Lijst laden mislukt: " + e.message, true);
    } finally {
      setLoading(false);
    }
  }
  async function doMatch(s = settings) {
    setMatching(true);
    try {
      const r = await postJSON("/api/pokemon/importlist", { action: "match", settings: s, store: creds(store) });
      setMatches(Object.fromEntries((r.matches || []).map((m) => [m.id, m])));
      setImported(r.imported || {});
      if (!r.groups) notify("De scraper heeft nog niets: scrape eerst de concurrenten", true);
    } catch (e) {
      notify("Matchen mislukt: " + e.message, true);
    } finally {
      setMatching(false);
    }
  }
  useEffect(() => {
    loadList();
    fetch("/api/pokemon/settings")
      .then((r) => r.json())
      .then((d) => setSettings({ ...d.settings, ...lsGet("pk_settings", {}) }))
      .catch(() => setSettings(lsGet("pk_settings", {})));
  }, []);
  useEffect(() => {
    if (settings && rows.length) doMatch(settings);
  }, [settings && settings.priceMode, settings && settings.ending, rows.length, store && store.domain]);

  const bySet = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.type === "Case" ? "Cases" : r.lang === "Japanese" ? `${r.set || "Overig"} (Japanese)` : r.set || "Overig 2026";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    const order = (k) => {
      if (k === "Cases") return 99;
      const base = k.replace(" (Japanese)", "");
      const i = SET_ORDER.indexOf(k.endsWith("(Japanese)") ? base : base === "Overig 2026" ? "" : base);
      return (k.endsWith("(Japanese)") ? 50 : 0) + (i < 0 ? 40 : i);
    };
    return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0]));
  }, [rows]);

  const stats = useMemo(() => {
    const st = { total: rows.length, found: 0, missing: 0, done: 0 };
    for (const r of rows) {
      const m = matches[r.id];
      if (imported[r.id]) st.done++;
      if (m && m.ok) st.found++;
      else if (m) st.missing++;
    }
    return st;
  }, [rows, matches, imported]);

  const visible = (r) => {
    const m = matches[r.id];
    if (r.include === false && filter !== "all") return false;
    if (filter === "found") return m && m.ok && !imported[r.id];
    if (filter === "missing") return m && !m.ok;
    if (filter === "done") return !!imported[r.id];
    return true;
  };

  function toggle(id) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function selectFound() {
    setSel(new Set(rows.filter((r) => r.include !== false && matches[r.id] && matches[r.id].ok && !imported[r.id]).map((r) => r.id)));
  }

  async function uploadCsv(file) {
    const text = await file.text();
    try {
      const r = await postJSON("/api/pokemon/importlist", { action: "save", csv: text });
      setRows(r.rows || []);
      setPreset(false);
      setSel(new Set());
      notify(`Lijst geladen: ${r.count} regels`);
    } catch (e) {
      notify("CSV niet gelukt: " + e.message, true);
    }
  }
  async function resetPreset() {
    if (!window.confirm("Terug naar de ingebouwde lijst met alle 2026-releases? Je eigen lijst wordt vervangen.")) return;
    const r = await postJSON("/api/pokemon/importlist", { action: "reset" });
    setRows(r.rows || []);
    setPreset(true);
    setSel(new Set());
  }
  async function downloadCsv() {
    const r = await fetch("/api/pokemon/importlist").then((x) => x.json());
    const blob = new Blob(["﻿" + (r.csv || "")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pokemon-importlijst.csv";
    a.click();
  }

  async function doPreview() {
    const ids = [...sel].slice(0, 2);
    if (!ids.length) return;
    setPreview({ loading: true });
    try {
      const r = await postJSON("/api/pokemon/importlist", { action: "import", dryRun: true, ids, settings });
      setPreview({ items: r.previews || [], errors: r.results || [], usd: r.usage && r.usage.usd });
    } catch (e) {
      setPreview(null);
      notify(e.message, true);
    }
  }

  async function doImport() {
    if (!store) return notify("Kies eerst rechtsboven je Pokémon-store", true);
    const ids = [...sel].filter((id) => !imported[id] && matches[id] && matches[id].ok);
    if (!ids.length) return;
    if (!window.confirm(`${ids.length} producten uit de importlijst in ${store.name || store.domain} zetten?\n\nAlles komt op uitverkocht (voorraad 0) met "Notify me".`)) return;
    stopRef.current = false;
    const st = { done: 0, total: ids.length, ok: 0, fail: 0, skipped: 0, usd: 0 };
    setRun({ ...st });
    setLog([]);
    addLog(`▶ ${ids.length} regels naar ${store.domain}`);
    // Volgorde: oud → nieuw per set (nieuwste set komt als laatste → bovenaan in Shopify); cases als
    // allerlaatste, dan staat het losse product al in de store.
    const rowOf = (id) => rows.find((r) => r.id === id) || {};
    const rel = (r) => RELEASE_DATES[r.set] || "0000";
    ids.sort((a, b) => {
      const ra = rowOf(a);
      const rb = rowOf(b);
      return (ra.type === "Case") - (rb.type === "Case") || rel(ra).localeCompare(rel(rb)) || String(ra.set).localeCompare(String(rb.set));
    });
    const chunks = [];
    for (let i = 0; i < ids.length; i += 2) chunks.push(ids.slice(i, i + 2));
    async function worker() {
      while (chunks.length && !stopRef.current) {
        const ck = chunks.shift();
        try {
          const r = await postJSON("/api/pokemon/importlist", { action: "import", store: creds(store), ids: ck, settings });
          for (const x of r.results || []) {
            if (x.skipped) {
              st.skipped++;
              addLog(`↷ ${x.id} — ${x.reason || "overgeslagen"}`, "dim");
              if (x.id && x.handle) setImported((m) => ({ ...m, [x.id]: { id: x.id, handle: x.handle } }));
            } else if (x.ok) {
              st.ok++;
              sfx("ok");
              addLog(`✓ ${x.title} · ${money(x.price, "EUR")} · ${x.variants > 1 ? x.variants + " varianten · " : ""}${x.images} foto's${x.removedImages ? ` (${x.removedImages} geweigerd: shopbranding)` : ""} · ${Math.round((x.copy || 0) * 100)}% overlap${x.colErrors && x.colErrors.length ? " · collectie-fout" : ""}`, "ok");
              setImported((m) => ({ ...m, [x.id]: { id: x.id, handle: x.handle } }));
            } else {
              st.fail++;
              addLog(`✕ ${x.id}: ${x.error}`, "err");
            }
          }
          st.usd += (r.usage && r.usage.usd) || 0;
        } catch (e) {
          st.fail += ck.length;
          addLog(`✕ portie ${ck.join(", ")} mislukt: ${e.message}`, "err");
        }
        st.done += ck.length;
        setRun({ ...st });
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    setSel(new Set());
    setRun({ ...st, finished: true });
    sfx(st.fail ? "error" : "success");
    notify(`Klaar: ${st.ok} geïmporteerd, ${st.skipped} overgeslagen, ${st.fail} mislukt`, !!st.fail);
  }

  if (loading) return <div className="pk-empty">Lijst laden…</div>;

  return (
    <>
      <div className="pk-hero">
        <div>
          <h1>Importlijst</h1>
          <p>
            {preset ? "Ingebouwde lijst: alle sealed 2026-releases (EN + JP) + cases." : "Je eigen lijst (CSV)."} Per regel zoekt de tool het product bij alle concurrenten, kiest de beste foto's en de laagste prijs, en schrijft een omschrijving in onze huisstijl{brain ? ` (brein ${brain})` : ""}.
          </p>
        </div>
        <div className="pk-row">
          <span className="pk-badge good">{stats.found} gevonden</span>
          <span className="pk-badge bad">{stats.missing} niet gevonden</span>
          <span className="pk-badge">{stats.done} al in de store</span>
          <button className="pk-btn sm" onClick={() => doMatch()} disabled={matching}>
            {matching ? "Zoeken…" : "↻ Opnieuw zoeken"}
          </button>
        </div>
      </div>

      <div className="pk-toolbar">
        <div className="pk-chips">
          {[
            ["all", "Alles"],
            ["found", "Gevonden, nog niet in store"],
            ["missing", "Niet gevonden"],
            ["done", "In de store"],
          ].map(([k, l]) => (
            <button key={k} className={"pk-chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
        <span className="pk-spacer" />
        <button className="pk-btn sm" onClick={downloadCsv}>
          ⬇ CSV
        </button>
        <button className="pk-btn sm" onClick={() => fileRef.current && fileRef.current.click()}>
          ⬆ Eigen lijst (CSV)
        </button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: "none" }} onChange={(e) => e.target.files[0] && uploadCsv(e.target.files[0])} />
        {!preset && (
          <button className="pk-btn sm ghost" onClick={resetPreset}>
            2026-lijst terugzetten
          </button>
        )}
      </div>

      {bySet.map(([name, list]) => {
        const vis = list.filter(visible);
        if (!vis.length) return null;
        const found = list.filter((r) => matches[r.id] && matches[r.id].ok).length;
        return (
          <div key={name} className="pk-card" style={{ marginBottom: 16 }}>
            <div className="pk-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <b>{name}</b>
              <span className="pk-hint">
                {found}/{list.length} gevonden
              </span>
            </div>
            <table className="pk-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th style={{ width: 54 }} />
                  <th>Product</th>
                  <th>Type</th>
                  <th>Bij</th>
                  <th style={{ textAlign: "right" }}>Onze prijs</th>
                </tr>
              </thead>
              <tbody>
                {vis.map((r) => {
                  const m = matches[r.id];
                  const done = imported[r.id];
                  const ok = m && m.ok;
                  return (
                    <tr key={r.id} style={{ opacity: r.include === false ? 0.45 : 1, cursor: ok && !done ? "pointer" : "default" }} onClick={() => ok && !done && toggle(r.id)}>
                      <td>{done ? "✓" : ok ? <input type="checkbox" readOnly checked={sel.has(r.id)} /> : "✕"}</td>
                      <td>{m && m.match && m.match.image ? <img src={m.match.image} alt="" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 6, background: "#fff" }} /> : null}</td>
                      <td>
                        <b>{r.title}</b>
                        <div className="pk-hint">
                          {r.id}
                          {r.variants && r.variants.length ? ` · ${r.variants.length} varianten (${r.option || "Design"}): ${r.variants.join(", ")}` : ""}
                          {r.type === "Case" ? ` · ${r.caseQty}× ${r.caseOf}` : ""}
                          {m && !m.ok ? ` · ${m.why}` : ""}
                          {done ? " · staat in de store" : ""}
                        </div>
                      </td>
                      <td>
                        {r.type}
                        {r.lang === "Japanese" ? " · JP" : ""}
                      </td>
                      <td className="pk-hint">{m && m.match ? m.match.sources.map((s) => `${s.domain.replace(/^www\./, "").split(".")[0]} ${money(s.price, s.currency)}`).join(" · ") : "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{m && m.price ? money(m.price, (m.match && m.match.currency) || "EUR") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {run && (
        <div className="pk-card" style={{ marginTop: 18 }}>
          <div className="pk-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <b>
              {run.finished ? "Klaar" : "Importeren…"} {run.done}/{run.total}
            </b>
            <span className="pk-hint">
              ✓ {run.ok} · ↷ {run.skipped} · ✕ {run.fail} · AI ${run.usd.toFixed(2)}
            </span>
          </div>
          <div className="pk-bar">
            <i style={{ width: (100 * run.done) / Math.max(1, run.total) + "%" }} />
          </div>
          {log.length > 0 && (
            <div className="pk-log" style={{ marginTop: 12 }}>
              {log.map((l, i) => (
                <div key={i} className={l.cls}>
                  <span className="dim">{l.t}</span> {l.msg}
                </div>
              ))}
            </div>
          )}
          {!run.finished && (
            <button className="pk-btn sm ghost" style={{ marginTop: 10 }} onClick={() => (stopRef.current = true)}>
              Stoppen na deze portie
            </button>
          )}
          {run.finished && (
            <div className="pk-row" style={{ marginTop: 12 }}>
              <button className="pk-btn dark" onClick={goDoctor}>
                Store Doctor draaien →
              </button>
            </div>
          )}
        </div>
      )}

      <div className="pk-dock">
        <div className="count">
          <span>{sel.size}</span> geselecteerd
        </div>
        <button className="pk-btn sm" onClick={selectFound}>
          Selecteer alle gevonden
        </button>
        <button className="pk-btn sm ghost" onClick={() => setSel(new Set())} disabled={!sel.size}>
          Wissen
        </button>
        <button className="pk-btn sm" onClick={doPreview} disabled={!sel.size}>
          👁 Voorbeeld (2)
        </button>
        <button className="pk-btn primary" onClick={doImport} disabled={!sel.size || (run && !run.finished)}>
          Importeer {sel.size || ""}
        </button>
      </div>

      {preview && (
        <div className="pk-modal-bg" onClick={() => setPreview(null)}>
          <div className="pk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pk-modal-head">
              <h3>Voorbeeld in onze huisstijl</h3>
              <button className="pk-btn ghost sm" onClick={() => setPreview(null)}>
                ✕
              </button>
            </div>
            <div className="pk-modal-body">
              {preview.loading ? (
                <p>De AI schrijft…</p>
              ) : (
                <>
                  {(preview.errors || []).filter((x) => !x.ok).map((x) => (
                    <p key={x.id} style={{ color: "var(--bad)" }}>
                      {x.id}: {x.error}
                    </p>
                  ))}
                  {preview.items.map((it) => (
                    <div key={it.id} style={{ marginBottom: 26 }}>
                      <div className="pk-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                        <span className="pk-label">
                          {it.id} · strategie {it.strategy} · {money(it.price, "EUR")} · bronnen: {(it.sources || []).map((s) => s.domain).join(", ")}
                        </span>
                        <span className={"pk-badge " + ((it.listing.copy || 0) > 0.15 ? "bad" : "good")}>{Math.round((it.listing.copy || 0) * 100)}% overlap</span>
                      </div>
                      <h3 style={{ margin: "6px 0 10px" }}>{it.listing.title}</h3>
                      <div dangerouslySetInnerHTML={{ __html: it.listing.descriptionHtml }} />
                      <p className="pk-hint" style={{ marginTop: 10 }}>
                        SEO: {it.listing.seoTitle} — {it.listing.seoDescription}
                      </p>
                    </div>
                  ))}
                  {preview.usd ? <p className="pk-hint">AI-kosten: ${preview.usd.toFixed(3)}</p> : null}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
