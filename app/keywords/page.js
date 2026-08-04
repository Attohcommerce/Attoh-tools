"use client";

import { useRef, useState } from "react";
import Header from "../components/Header";

const LS_SHEET = "attoh_kw_sheet";
const LS_LASTTAB = "attoh_kw_lasttab";

/* ---------- Keyword Planner CSV parsen (UTF-16, tab-gescheiden) ---------- */

async function parseKeywordCsv(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-16le").decode(buf);
  // Fallback voor het geval iemand een UTF-8 export aanlevert
  if (!text.includes("\t") || text.charCodeAt(0) > 60000) {
    const alt = new TextDecoder("utf-8").decode(buf);
    if (alt.includes("\t")) text = alt;
  }
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const hi = lines.findIndex((l) => l.startsWith("Keyword\t"));
  if (hi === -1) throw new Error(`${file.name}: geen Keyword Planner-export`);

  const headerCells = lines[hi].split("\t");
  const avgIdx = headerCells.findIndex((h) => h.startsWith("Avg. monthly searches"));
  const monthIdx = [];
  const monthNames = [];
  headerCells.forEach((h, i) => {
    const m = h.match(/^Searches:\s*(.+)$/);
    if (m) {
      monthIdx.push(i);
      monthNames.push(m[1].trim()); // "jul 2025"
    }
  });
  if (avgIdx === -1 || monthIdx.length === 0) {
    throw new Error(`${file.name}: kolommen niet herkend`);
  }

  const clean = (v) => String(v || "").trim().replace(/^"|"$/g, "");
  const num = (v) => {
    const s = clean(v);
    return /^\d+$/.test(s) ? parseInt(s, 10) : 0;
  };

  const out = [];
  for (const l of lines.slice(hi + 1)) {
    if (!l.trim()) continue;
    const p = l.split("\t");
    const kw = clean(p[0]);
    if (!kw) continue;
    out.push({
      kw,
      avg: num(p[avgIdx]),
      months: monthIdx.map((i) => num(p[i])),
    });
  }
  return { rows: out, monthNames };
}

/* ---------- Pagina ---------- */

export default function KeywordsPage() {
  const [files, setFiles] = useState([]); // {name, rows, monthNames}
  const [sheetLink, setSheetLink] = useState("");
  const [tabName, setTabName] = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [doneUrl, setDoneUrl] = useState("");
  // Stap 2 — merken-check
  const [cleanTab, setCleanTab] = useState("");
  const [topN, setTopN] = useState("500");
  const [cleaning, setCleaning] = useState(false);
  const fileInput = useRef(null);

  useState(() => {
    try {
      const s = localStorage.getItem(LS_SHEET);
      if (s) setSheetLink(s);
      const t = localStorage.getItem(LS_LASTTAB);
      if (t) setCleanTab(t);
    } catch {}
  });

  function pushLog(entry) {
    setLogs((l) => [...l, entry]);
  }

  async function onFiles(e) {
    const list = Array.from(e.target.files || []).slice(0, 10);
    const parsed = [];
    for (const f of list) {
      try {
        const r = await parseKeywordCsv(f);
        parsed.push({ name: f.name, ...r });
      } catch (err) {
        parsed.push({ name: f.name, error: String(err.message || err) });
      }
    }
    setFiles(parsed);
    if (fileInput.current) fileInput.current.value = "";
  }

  const totalRows = files.reduce((s, f) => s + (f.rows ? f.rows.length : 0), 0);
  const canStart =
    !running && files.some((f) => f.rows) && sheetLink.trim() && tabName.trim();

  async function api(body) {
    const res = await fetch("/api/keywords-sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function start() {
    if (!canStart) return;
    setRunning(true);
    setLogs([]);
    setDoneUrl("");
    try {
      localStorage.setItem(LS_SHEET, sheetLink.trim());
    } catch {}

    try {
      // 1. Samenvoegen + ontdubbelen (hoogste volume wint)
      pushLog({ strong: true, text: "— Stap 1: CSV's samenvoegen" });
      const merged = new Map();
      let monthNames = null;
      for (const f of files) {
        if (!f.rows) continue;
        if (!monthNames) monthNames = f.monthNames;
        for (const r of f.rows) {
          const k = r.kw.toLowerCase();
          const cur = merged.get(k);
          if (!cur || r.avg > cur.avg) merged.set(k, r);
        }
      }
      const rows = [...merged.values()].sort((a, b) => b.avg - a.avg);
      pushLog({ ok: true, text: `${totalRows} rijen gelezen → ${rows.length} unieke keywords` });

      // 2. Tabblad aanmaken met nette headers
      pushLog({ strong: true, text: "— Stap 2: nieuw tabblad aanmaken" });
      const header = ["Keyword", "Avg. monthly search", ...monthNames];
      const created = await api({
        action: "create",
        sheetId: sheetLink.trim(),
        tabName: tabName.trim(),
        header,
      });
      pushLog({ ok: true, text: `Tabblad "${created.title}" aangemaakt` });

      // 3. Rijen uploaden in blokken (binnen de serverless bodylimiet blijven)
      pushLog({ strong: true, text: "— Stap 3: keywords uploaden" });
      const CHUNK = 4000;
      const values = rows.map((r) => [r.kw, r.avg, ...r.months]);
      for (let i = 0; i < values.length; i += CHUNK) {
        const part = values.slice(i, i + CHUNK);
        await api({
          action: "append",
          sheetId: sheetLink.trim(),
          tabName: created.title,
          rows: part,
        });
        pushLog({ text: `${Math.min(i + CHUNK, values.length)} / ${values.length} rijen` });
      }

      // 4. Opmaak: geel + vet + filters, kolom A grijs, rij 1 vast
      pushLog({ strong: true, text: "— Stap 4: opmaken" });
      const fmt = await api({
        action: "format",
        sheetId: sheetLink.trim(),
        tabId: created.tabId,
        rowCount: values.length + 1,
        colCount: header.length,
      });
      pushLog({ ok: true, text: "Opmaak klaar — geel, filters, grijze keyword-kolom" });
      setDoneUrl(fmt.url);
      setCleanTab(created.title);
      try {
        localStorage.setItem(LS_LASTTAB, created.title);
      } catch {}
      pushLog({ info: true, text: `Klaar! ${rows.length} keywords in "${created.title}". Stap 2 (merken-check) staat nu open.` });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: String(e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setRunning(false);
    }
  }

  const canClean = !cleaning && !running && sheetLink.trim() && cleanTab.trim();

  async function runClean() {
    if (!canClean) return;
    setCleaning(true);
    try {
      pushLog({ strong: true, text: `— Merken-check: bovenste ${topN} van "${cleanTab}"` });
      pushLog({ text: "Merkenlijst + AI beoordelen de keywords — dit kan een minuutje duren…" });
      const r = await api({
        action: "clean",
        sheetId: sheetLink.trim(),
        tabName: cleanTab.trim(),
        topN: Number(topN) || 500,
      });
      const names = r.removed.map((x) => x.kw);
      const shown = names.slice(0, 40).join(", ");
      pushLog({
        ok: true,
        text: `${r.removedCount} van ${r.checked} rijen verwijderd (merken/platforms/rommel).`,
      });
      if (names.length) {
        pushLog({
          text: `Weg: ${shown}${names.length > 40 ? ` … en ${names.length - 40} meer` : ""}`,
        });
      }
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: String(e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setCleaning(false);
    }
  }

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Keyword Planner → nette sheet" />
      <div className="page">
        <div className="layout-scraper">
          {/* -------- Links: invoer -------- */}
          <div>
            <div className="card">
              <h2>CSV-bestanden <span className="opt">(1–10, uit Keyword Planner)</span></h2>
              <input
                ref={fileInput}
                type="file"
                accept=".csv"
                multiple
                onChange={onFiles}
                style={{ padding: 9 }}
              />
              {files.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {files.map((f, i) => (
                    <div className="log" key={i}>
                      {f.error ? (
                        <span className="err">✗ {f.name} — {f.error}</span>
                      ) : (
                        <>
                          <span className="ok">✓</span>
                          <span style={{ flex: 1 }}>{f.name}</span>
                          <span className="muted small">{f.rows.length} rijen</span>
                        </>
                      )}
                    </div>
                  ))}
                  <div className="hint">Samen {totalRows} rijen — dubbelingen worden samengevoegd.</div>
                </div>
              )}
            </div>

            <div className="card">
              <h2>Doel-sheet</h2>
              <div className="field-label">Google Sheet-link</div>
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={sheetLink}
                onChange={(e) => setSheetLink(e.target.value)}
              />
              <div className="hint">
                Deel de sheet één keer met het service-account (Bewerker). De link wordt onthouden.
              </div>
              <div className="field-label">Naam nieuw tabblad</div>
              <input
                type="text"
                placeholder="bv. UK 4 augustus"
                value={tabName}
                onChange={(e) => setTabName(e.target.value)}
              />
              <div className="hint">
                Elke run maakt een nieuw tabblad in dezelfde sheet — niets wordt overschreven.
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={start} disabled={!canStart}>
                {running ? "Bezig…" : "⌕ Samenvoegen & opmaken"}
              </button>
            </div>

            {/* -------- Stap 2: merken-check (pas actief na een run) -------- */}
            <div className="card" style={{ marginTop: 18, opacity: canClean || cleaning ? 1 : 0.55 }}>
              <h2>Stap 2 — merken-check <span className="opt">(AI + merkenlijst)</span></h2>
              <div className="field-label">Tabblad</div>
              <input
                type="text"
                placeholder="wordt gevuld na stap 1"
                value={cleanTab}
                onChange={(e) => setCleanTab(e.target.value)}
              />
              <div className="field-label">Aantal bovenste rijen checken</div>
              <input
                type="number"
                min="10"
                max="800"
                value={topN}
                onChange={(e) => setTopN(e.target.value)}
              />
              <div className="hint">
                Verwijdert merken, winkels, platforms en niet-keywords uit de bovenste rijen
                van het tabblad. De rest blijft staan — de sortering verschuift gewoon omhoog.
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btn-ghost" onClick={runClean} disabled={!canClean}>
                  {cleaning ? "AI checkt…" : "Check & verwijder merken"}
                </button>
              </div>
            </div>
          </div>

          {/* -------- Rechts: voortgang -------- */}
          <div>
            <div className="card" style={{ minHeight: 320 }}>
              {logs.length === 0 && (
                <div className="center-note">
                  Kies links je CSV-exports, plak de sheet-link, geef het tabblad een naam
                  en klik op Samenvoegen & opmaken.
                  <br />
                  <br />
                  De tool maakt er één schone lijst van: titelrijen en overbodige kolommen
                  verdwijnen, "Searches:" gaat uit de maandkoppen, de header wordt geel met
                  filters en de keyword-kolom grijs — klaar om te checken.
                </div>
              )}
              {logs.map((l, i) => (
                <div className="log" key={i}>
                  {l.ok ? <span className="ok">✓</span> : l.err ? <span className="err">✗</span> : null}
                  <span style={{ flex: 1, fontWeight: l.strong ? 600 : 400 }}>{l.text}</span>
                </div>
              ))}
              {doneUrl && (
                <div style={{ marginTop: 14 }}>
                  <a className="btn-ghost" href={doneUrl} target="_blank" rel="noreferrer noopener" style={{ display: "inline-flex", width: "auto" }}>
                    Tabblad openen ↗
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
