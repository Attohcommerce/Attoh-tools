"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";

const CHUNK = 12; // items per API-call (server capt op 15)
const PARALLEL = 2; // chunks tegelijk in-flight

function parseDomains(text) {
  const out = [];
  const seen = new Set();
  for (const tok of String(text || "").split(/[\s,;]+/)) {
    let s = tok.trim();
    if (!s) continue;
    s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[\/?#]/)[0].toLowerCase();
    if (!s.includes(".")) continue;
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export default function TakenPage() {
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [input, setInput] = useState("");
  const [rows, setRows] = useState([]);
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | running | paused | done
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const ctrl = useRef({ paused: false, stopped: false });

  useEffect(() => {
    fetch("/api/taken")
      .then((r) => r.json())
      .then((d) => {
        const js = d.jobs || [];
        setJobs(js);
        let last = null;
        try {
          last = localStorage.getItem("taken:lastJob");
        } catch {}
        setJobId((js.find((j) => j.id === last) || js[0] || {}).id || null);
      })
      .catch(() => pushLog("err", "Kon de takenlijst niet laden — herlaad de pagina"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const job = useMemo(() => jobs.find((j) => j.id === jobId) || null, [jobs, jobId]);
  const busy = status === "running" || status === "paused";

  function pushLog(cls, msg) {
    setLog((l) => [{ cls, msg, t: Date.now() + Math.random() }, ...l].slice(0, 400));
  }

  function pickJob(id) {
    if (busy) return;
    setJobId(id);
    setRows([]);
    setLog([]);
    setDone(0);
    setTotal(0);
    setStatus("idle");
    try {
      localStorage.setItem("taken:lastJob", id);
    } catch {}
  }

  async function start() {
    if (!job || busy) return;
    const items = parseDomains(input);
    if (!items.length) {
      pushLog("warn", "Geen bruikbare domeinen gevonden in het invoerveld");
      return;
    }
    ctrl.current = { paused: false, stopped: false };
    setRows([]);
    setLog([]);
    setDone(0);
    setTotal(items.length);
    setStatus("running");
    pushLog("muted", `Start — ${items.length} stores · "${job.naam}"`);

    const chunks = [];
    for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
    let ci = 0;
    const lastKol = job.kolommen[job.kolommen.length - 1];

    async function workChunks() {
      while (ci < chunks.length) {
        if (ctrl.current.stopped) return;
        while (ctrl.current.paused && !ctrl.current.stopped) {
          await new Promise((r) => setTimeout(r, 300));
        }
        if (ctrl.current.stopped) return;
        const i = ci++;
        const mine = chunks[i];
        if (!mine) return;
        try {
          const res = await fetch("/api/taken", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jobId: job.id, items: mine }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
          const newRows = [];
          for (const r of data.results || []) {
            if (r.ok) newRows.push(r.row);
            else {
              const row = { [job.kolommen[0]]: r.item, [lastKol]: "FOUT: " + r.error };
              newRows.push(row);
              pushLog("err", `${r.item} — ${r.error}`);
            }
          }
          setRows((rs) => [...rs, ...newRows]);
        } catch (e) {
          setRows((rs) => [
            ...rs,
            ...mine.map((m) => ({ [job.kolommen[0]]: m, [lastKol]: "FOUT: " + String((e && e.message) || e) })),
          ]);
          pushLog("err", `Chunk mislukt (${mine.length} stores): ${String((e && e.message) || e)}`);
        }
        setDone((d) => d + mine.length);
      }
    }

    await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, workChunks));
    setStatus("done");
    pushLog("ok", ctrl.current.stopped ? "Gestopt door gebruiker" : "Klaar");
  }

  function togglePause() {
    if (!busy) return;
    ctrl.current.paused = !ctrl.current.paused;
    setStatus(ctrl.current.paused ? "paused" : "running");
  }

  function stop() {
    if (!busy) return;
    ctrl.current.stopped = true;
    ctrl.current.paused = false;
  }

  async function exportXlsx() {
    if (!rows.length || !job) return;
    try {
      if (!window.XLSX) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
          s.onload = res;
          s.onerror = () => rej(new Error("CDN niet bereikbaar"));
          document.head.appendChild(s);
        });
      }
      const aoa = [job.kolommen, ...rows.map((r) => job.kolommen.map((k) => (r[k] === undefined ? "" : r[k])))];
      const ws = window.XLSX.utils.aoa_to_sheet(aoa);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, "Resultaten");
      window.XLSX.writeFile(wb, `${job.id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      // CSV-fallback (BOM + puntkomma voor NL-Excel)
      const esc = (v) => '"' + String(v === undefined || v === null ? "" : v).replace(/"/g, '""') + '"';
      const csv =
        "\uFEFF" +
        [job.kolommen, ...rows.map((r) => job.kolommen.map((k) => r[k]))]
          .map((line) => line.map(esc).join(";"))
          .join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `${job.id}.csv`;
      a.click();
      pushLog("warn", "xlsx-CDN niet bereikbaar — als CSV gedownload");
    }
  }

  async function copyKeep() {
    if (!job) return;
    const list = rows.filter((r) => r._keep).map((r) => r[job.kolommen[0]]).filter(Boolean);
    if (!list.length) {
      pushLog("warn", "Nog geen domeinen met een positief verdict");
      return;
    }
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      pushLog("ok", `${list.length} domeinen gekopieerd naar het klembord`);
    } catch {
      pushLog("err", "Kopiëren mislukt — selecteer de rijen handmatig");
    }
  }

  const pct = total ? Math.round((done / total) * 100) : 0;
  const keepCount = rows.filter((r) => r._keep).length;

  return (
    <>
      <Header
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        }
        title="Attoh Tools"
        subtitle="Taken — custom runs"
      />
      <div className="page">
        <div className="layout-2col">
          <aside>
            <div className="card">
              <h2>Taken</h2>
              {jobs.length === 0 && <p className="hint">Laden…</p>}
              {jobs.map((j) => (
                <div
                  key={j.id}
                  className={"store-item" + (j.id === jobId ? " selected" : "")}
                  onClick={() => pickJob(j.id)}
                  style={{ cursor: busy ? "default" : "pointer", opacity: busy && j.id !== jobId ? 0.45 : 1 }}
                >
                  <div>
                    <strong>{j.naam}</strong>
                    <div className="hint" style={{ marginTop: 3 }}>{j.uitleg}</div>
                  </div>
                </div>
              ))}
              <p className="hint" style={{ marginTop: 14 }}>
                Nieuwe taak nodig? Vraag Claude — één bestand in lib/jobs/ en hij verschijnt hier vanzelf.
              </p>
            </div>
          </aside>

          <main>
            {job && (
              <div className="card">
                <h2>{job.naam}</h2>
                <p className="hint" style={{ marginTop: 4 }}>{job.uitleg}</p>

                <div style={{ marginTop: 14 }}>
                  <label className="field-label">{job.inputLabel || "Domeinen"}</label>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={job.placeholder || ""}
                    disabled={busy}
                    rows={8}
                    style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
                  />
                  <p className="hint" style={{ marginTop: 6 }}>
                    {parseDomains(input).length} unieke domeinen herkend
                  </p>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                  <button className="btn" onClick={start} disabled={busy || !parseDomains(input).length}>
                    {busy ? <span className="spin" /> : null}
                    {busy ? "Bezig…" : "Start run"}
                  </button>
                  {busy && (
                    <button className="btn-ghost" onClick={togglePause}>
                      {status === "paused" ? "Hervat" : "Pauzeer"}
                    </button>
                  )}
                  {busy && (
                    <button className="btn-ghost" onClick={stop}>
                      Stop
                    </button>
                  )}
                </div>

                {total > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span className="hint">
                        {status === "running" ? "Nu bezig…" : status === "paused" ? "Gepauzeerd" : "Klaar"}
                      </span>
                      <span className="hint">
                        {done}/{total} · {pct}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 999,
                        background: "rgba(255,255,255,.06)",
                        border: "1px solid var(--line)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: pct + "%",
                          background: "linear-gradient(90deg, var(--accent), var(--accent-hi))",
                          transition: "width .4s ease",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {job && rows.length > 0 && (
              <div className="card" style={{ marginTop: 16 }}>
                <h2>Resultaten</h2>
                <div style={{ overflowX: "auto", marginTop: 10 }}>
                  <table className="mini-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        {job.kolommen.map((k) => (
                          <th key={k} style={{ textAlign: "left" }}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {job.kolommen.map((k) => (
                            <td key={k}>{r[k] === undefined || r[k] === null ? "" : String(r[k])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
                  <button className="btn-ghost btn-small" onClick={exportXlsx}>
                    Download als xlsx
                  </button>
                  {job.keepLabel && (
                    <button className="btn-ghost btn-small" onClick={copyKeep}>
                      {job.keepLabel} ({keepCount})
                    </button>
                  )}
                </div>
              </div>
            )}

            {log.length > 0 && (
              <div className="card" style={{ marginTop: 16 }}>
                <h2>Log</h2>
                <div className="log" style={{ marginTop: 10 }}>
                  {log.map((l) => (
                    <div key={l.t} className={l.cls}>
                      {l.msg}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
