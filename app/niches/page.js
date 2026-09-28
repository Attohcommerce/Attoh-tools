"use client";

import React, { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";
import {
  parsePlannerText, mergeBatches, keywordTrend, windowShare, nicheScorecard, windowFromKeys,
} from "@/lib/niche";
import { isJunkKeyword } from "@/lib/brands";

/* NICHE KIEZEN — stap 3 t/m 5 van het masterplan niche research.
   Markt is al gekozen. Per kandidaat-niche één Keyword Planner-batch (10
   seeds, 4 jaar historie). Deze pagina:
     1. voegt de batches samen tot één tabblad, met per keyword de niche
        waar het uit komt en de trend over meerdere jaren;
     2. schrijft een tweede tabblad "… · scorecard" met per niche vraag,
        groei, concurrentie, seizoensfit, breedte, merkaandeel en kansscore.
   De niche met het meeste volume wint niet vanzelf: de kansscore weegt. */

const LS_SHEET = "attoh_niche_sheet";

const MONTHS = [
  ["jan", "Jan"], ["feb", "Feb"], ["mrt", "Mrt"], ["apr", "Apr"], ["mei", "Mei"], ["jun", "Jun"],
  ["jul", "Jul"], ["aug", "Aug"], ["sep", "Sep"], ["okt", "Okt"], ["nov", "Nov"], ["dec", "Dec"],
];

function defaultWindow() {
  const m = new Date().getMonth() + 1; // vanaf volgende maand, zoals de verdeling
  return [0, 1, 2, 3].map((i) => MONTHS[(m + i) % 12][0]);
}

async function readFile(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-16le").decode(buf);
  if (!text.includes("\t") || text.charCodeAt(0) > 60000) {
    const alt = new TextDecoder("utf-8").decode(buf);
    if (alt.includes("\t")) text = alt;
  }
  return parsePlannerText(text, file.name);
}

const pct = (x) => Math.round((x || 0) * 100);

export default function NichesPage() {
  const [files, setFiles] = useState([]); // {name, niche, rows, monthNames, currency, error}
  const [sheetLink, setSheetLink] = useState("");
  useEffect(() => {
    try { setSheetLink(localStorage.getItem(LS_SHEET) || ""); } catch {}
  }, []);
  const [tabName, setTabName] = useState("");
  const [win, setWin] = useState([]);
  useEffect(() => setWin(defaultWindow()), []);
  const [minVol, setMinVol] = useState(20);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [cards, setCards] = useState(null);
  const [links, setLinks] = useState({ all: "", score: "" });

  function pushLog(entry) {
    setLogs((l) => {
      if (entry.key) {
        const i = l.findIndex((x) => x.key === entry.key);
        if (i >= 0) { const n = [...l]; n[i] = entry; return n; }
      }
      return [...l, entry];
    });
  }

  async function api(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function onFiles(e) {
    const list = [...(e.target.files || [])];
    const out = [];
    for (const f of list) {
      try {
        const p = await readFile(f);
        out.push({ name: f.name, niche: p.seed, ...p });
      } catch (err) {
        out.push({ name: f.name, error: String(err.message || err) });
      }
    }
    setFiles(out);
    setCards(null);
  }

  const good = files.filter((f) => !f.error);
  const dupNames = useMemo(() => {
    const seen = new Set(); const d = new Set();
    for (const f of good) { const k = f.niche.trim().toLowerCase(); if (seen.has(k)) d.add(k); seen.add(k); }
    return d;
  }, [good]);
  const canRun = !busy && good.length >= 2 && sheetLink.trim() && tabName.trim() && win.length && !dupNames.size && good.every((f) => f.niche.trim());

  function toggleMonth(k) {
    setWin((w) => (w.includes(k) ? w.filter((x) => x !== k) : [...w, k]));
  }

  async function run() {
    if (!canRun) return;
    setBusy(true);
    setLogs([]);
    setCards(null);
    setLinks({ all: "", score: "" });
    try { localStorage.setItem(LS_SHEET, sheetLink.trim()); } catch {}
    const sheetId = sheetLink.trim();
    try {
      /* ---- 1. samenvoegen + trends ---- */
      pushLog({ strong: true, text: `— Stap 1: ${good.length} batches samenvoegen` });
      const lens = new Set(good.map((f) => f.monthNames.length));
      if (lens.size > 1) pushLog({ err: true, text: "Let op: de batches hebben niet allemaal dezelfde periode. Draai ze allemaal met dezelfde datumrange (bij voorkeur 4 jaar), anders zijn groei en trends niet eerlijk te vergelijken." });
      const { rows, monthNames } = mergeBatches(good.map((f) => ({ ...f, niche: f.niche.trim() })));
      const windowIdx = windowFromKeys(win);
      for (const r of rows) {
        r.t = keywordTrend(r.months, monthNames);
        r.win = windowShare(r.months, monthNames, windowIdx);
        r.junk = isJunkKeyword(r.kw);
      }
      const total = good.reduce((s, f) => s + f.rows.length, 0);
      pushLog({ ok: true, text: `${total} rijen gelezen → ${rows.length} unieke keywords · ${monthNames.length} maanden historie (${monthNames[0]} – ${monthNames.at(-1)})` });
      if (monthNames.length < 36) pushLog({ err: true, text: `Maar ${monthNames.length} maanden historie: de trendlabels (stijger/hype) hebben er 36+ nodig. Zet in Keyword Planner de periode op 4 jaar.` });

      /* ---- 2. scorecard ---- */
      const sc = nicheScorecard(rows, monthNames, windowIdx);
      setCards(sc);
      pushLog({ ok: true, text: `Scorecard: nummer 1 is "${sc[0]?.niche}" (kansscore ${sc[0]?.kans})` });

      /* ---- 3. keyword-tabblad ---- */
      const keep = rows.filter((r) => r.avg >= minVol);
      pushLog({ strong: true, text: `— Stap 2: tabblad "${tabName.trim()}" (${keep.length} keywords ≥ ${minVol}/mnd; de rest telt wel mee in de scorecard)` });
      const cur = good.find((f) => f.currency)?.currency || "";
      const header = [
        "Keyword", "Niche", "Ook in niche", "Avg. monthly search", ...monthNames,
        "Competition", "Comp. index", `Top bid low ${cur}`.trim(), `Top bid high ${cur}`.trim(),
        "3-mnd verandering %", "YoY verandering %",
        "Laatste 12 mnd", "12 mnd ervoor", "Groei 1 jaar %", "Groei 2 jaar %",
        "Trend", "Piekmaand", `% in venster ${win.join("-")}`, "Merk/rommel",
      ];
      const created = await api("/api/keywords-sheet", {
        action: "create", sheetId, tabName: tabName.trim(), header, rowCount: keep.length, colCount: header.length,
      });
      const values = keep.map((r) => [
        r.kw, r.niche, r.alsoIn.join(", "), r.avg, ...r.months,
        r.comp ?? "", r.compIdx ?? "", r.bidLow ?? "", r.bidHigh ?? "", r.chg3 ?? "", r.yoy ?? "",
        r.t.L12, r.t.P12, pct(r.t.g1), pct(r.t.g2), r.t.label, r.t.peak, pct(r.win), r.junk ? "ja" : "",
      ]);
      const CHUNK = 3000;
      for (let i = 0; i < values.length; i += CHUNK) {
        await api("/api/keywords-sheet", { action: "append", sheetId, tabName: created.title, rows: values.slice(i, i + CHUNK) });
        pushLog({ key: "up1", text: `Uploaden… ${Math.min(i + CHUNK, values.length)} / ${values.length}` });
      }
      const base = 4 + monthNames.length; // eerste kolom na de maanden
      const fmt1 = await api("/api/niche-sheet", {
        action: "format", sheetId, tabId: created.tabId, rowCount: values.length + 1, colCount: header.length,
        decimalCols: [base + 2, base + 3],
        wideCols: [{ col: 1, px: 150 }, { col: 2, px: 150 }],
      });
      setLinks((l) => ({ ...l, all: fmt1.url }));
      pushLog({ ok: true, text: `"${created.title}" staat klaar` });

      /* ---- 4. scorecard-tabblad ---- */
      pushLog({ strong: true, text: "— Stap 3: scorecard-tabblad" });
      const sHeader = [
        "Niche", "Kansscore (0-100)", "Vraag (gem./mnd)", "Breedte (kw ≥100/mnd)", "Keywords",
        "Groei 1 jaar %", "Groei 2 jaar %", `Gem. bod ${cur}`.trim(), "Comp. index",
        `% volume in venster ${win.join("-")}`, "Seizoensfit (1 = vlak)", "% volume stijger/nieuwe piek",
        "% volume hype", "Merkaandeel %", "Signalen", "Top keywords", "Grootste stijgers",
      ];
      const sRows = sc.map((c) => [
        c.niche, c.kans, c.vraag, c.breedte, c.keywords, pct(c.g1), pct(c.g2),
        Math.round(c.bod * 100) / 100, Math.round(c.comp), pct(c.winShare), Math.round(c.seizoen * 100) / 100,
        pct(c.trendAandeel), pct(c.hypeAandeel), pct(c.merkaandeel), c.flags.join("; "),
        c.top.join(", "), c.stijgers.join(", "),
      ]);
      const created2 = await api("/api/keywords-sheet", {
        action: "create", sheetId, tabName: `${tabName.trim()} · scorecard`.slice(0, 99), header: sHeader,
        rowCount: sRows.length, colCount: sHeader.length,
      });
      await api("/api/keywords-sheet", { action: "append", sheetId, tabName: created2.title, rows: sRows });
      const fmt2 = await api("/api/niche-sheet", {
        action: "format", sheetId, tabId: created2.tabId, rowCount: sRows.length + 1, colCount: sHeader.length,
        decimalCols: [7, 10],
        wideCols: [{ col: 0, px: 170 }, { col: 14, px: 260 }, { col: 15, px: 320 }, { col: 16, px: 320 }],
      });
      setLinks((l) => ({ ...l, score: fmt2.url }));
      pushLog({ ok: true, text: `"${created2.title}" staat klaar — kies 1-2 niches uit de top 3 en draai daar de diepe batches op.` });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: "Mislukt: " + (e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Niche kiezen" />
      <div className="page">
        <div className="layout-scraper">
          <div>
            <div className="card">
              <h2>Niche kiezen <span className="opt">(markt al gekozen · 1 batch per kandidaat-niche)</span></h2>
              <div className="hint" style={{ marginBottom: 12 }}>
                Kies eerst je markt. Draai daarna per kandidaat-niche één Keyword Planner-batch van 10 seeds,
                allemaal op die markt, op dezelfde dag en met 4 jaar historie. Upload de CSV's hier: de tool
                voegt ze samen tot één tabblad (met per keyword de niche en de trend over meerdere jaren) en
                maakt een scorecard per niche.
              </div>

              <div className="field-label">Keyword Planner-CSV's <span className="opt">(één per niche)</span></div>
              <input type="file" accept=".csv" multiple onChange={onFiles} style={{ padding: 9 }} />
              {files.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {files.map((f, i) => (
                    <div className="log" key={i} style={{ gap: 8, alignItems: "center" }}>
                      {f.error ? (
                        <span className="err">✗ {f.name} — {f.error}</span>
                      ) : (
                        <>
                          <span className="ok">✓</span>
                          <input
                            type="text"
                            value={f.niche}
                            onChange={(e) => setFiles((l) => l.map((x, j) => (j === i ? { ...x, niche: e.target.value } : x)))}
                            style={{ flex: 1, padding: "4px 8px" }}
                            title="Naam van de niche (standaard: de eerste seed)"
                          />
                          <span className="muted small">{f.rows.length} rijen · {f.monthNames.length} mnd</span>
                          {dupNames.has(f.niche.trim().toLowerCase()) && <span className="err small">dubbele naam</span>}
                        </>
                      )}
                    </div>
                  ))}
                  <div className="hint">De nichenaam is standaard de eerste seed van de batch. Pas hem aan als je wilt (bv. "Kunstplanten").</div>
                </div>
              )}

              <div className="field-label">Lanceervenster <span className="opt">(de maanden waarin de store live gaat)</span></div>
              <div className="seg" style={{ flexWrap: "wrap" }}>
                {MONTHS.map(([k, label]) => (
                  <button key={k} type="button" className={win.includes(k) ? "on" : ""} onClick={() => toggleMonth(k)}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="field-label">Doel-sheet <span className="opt">(lege Google Sheet, gedeeld met attoh-sheets@attoh-tools.iam.gserviceaccount.com)</span></div>
              <input type="text" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheetLink} onChange={(e) => setSheetLink(e.target.value)} />
              <div className="field-label">Naam van het nieuwe tabblad</div>
              <input type="text" placeholder='bv. "canada 28/09 all keyword stats"' value={tabName} onChange={(e) => setTabName(e.target.value)} />
              <div className="field-label">Min. zoekvolume per maand in het tabblad <span className="opt">(de scorecard telt alles mee)</span></div>
              <input type="number" min={0} style={{ width: 110 }} value={minVol} onChange={(e) => setMinVol(Math.max(0, Number(e.target.value) || 0))} />

              <div style={{ marginTop: 14 }}>
                <button className="btn" onClick={run} disabled={!canRun}>
                  {busy ? "Bezig…" : "Samenvoegen + scorecard"}
                </button>
              </div>

              {logs.length > 0 && (
                <div className="logpanel" style={{ marginTop: 14 }}>
                  {logs.map((l, i) => (
                    <div key={i} className={"logline" + (l.err ? " err" : l.ok ? " ok" : l.strong ? " strong" : "")}>{l.text}</div>
                  ))}
                </div>
              )}
              {(links.all || links.score) && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {links.all && <a className="btn" href={links.all} target="_blank" rel="noreferrer">↗ Alle keywords</a>}
                  {links.score && <a className="btn" href={links.score} target="_blank" rel="noreferrer">↗ Scorecard</a>}
                </div>
              )}
            </div>
          </div>

          <div>
            {cards ? (
              <div className="card">
                <h2>Scorecard <span className="opt">(venster {win.join("-")})</span></h2>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto", gap: "6px 12px", fontSize: 13, alignItems: "baseline" }}>
                  <b>Kans</b><b>Niche</b><b>Vraag/mnd</b><b>Groei 1j</b><b>Venster</b><b>Bod</b>
                  {cards.map((c) => (
                    <React.Fragment key={c.niche}>
                      <span style={{ fontWeight: 600 }}>{c.kans}</span>
                      <span>
                        {c.niche}
                        {c.flags.length > 0 && <span className="opt"> · {c.flags.join(" · ")}</span>}
                      </span>
                      <span>{c.vraag.toLocaleString("nl-NL")}</span>
                      <span>{pct(c.g1)}%</span>
                      <span>{pct(c.winShare)}%</span>
                      <span>{c.bod.toFixed(2)}</span>
                    </React.Fragment>
                  ))}
                </div>
                <div className="hint" style={{ marginTop: 12 }}>
                  Kansscore = vraag × groei (1 en 2 jaar) × seizoensfit × aandeel stijgers ÷ gemiddeld bod,
                  met aftrek voor hype en merk-zoekopdrachten. Te smalle niches (minder dan 25 keywords met
                  ≥100 zoekopdrachten/mnd) krijgen 0. Het bod is het Search-bod uit Keyword Planner: goed om
                  niches te vergelijken, geen exacte Shopping-kostprijs.
                </div>
              </div>
            ) : (
              <div className="card">
                <h2>Zo werkt het</h2>
                <div className="hint">
                  1. Markt kiezen (bv. Canada) — alle batches op die locatie.<br /><br />
                  2. Per kandidaat-niche 10 seeds, periode 4 jaar, alle batches op dezelfde dag.<br /><br />
                  3. Hier uploaden → één tabblad met alle keywords + een scorecard-tabblad.<br /><br />
                  4. Trendlabels per keyword: <b>stijger</b> (2 jaar op rij ≥10% hoger), <b>nieuwe piek</b> (een
                  maand die het laatste jaar ≥1,8× zo hoog is als eerder), <b>hype</b> (eerst ≥50% omhoog,
                  daarna ≥25% omlaag), <b>daler</b>, <b>stabiel</b>.<br /><br />
                  5. Kies 1–2 niches uit de top 3, draai daar 10 diepe batches op en ga door met de gewone
                  keten (verdeling → scraper → importer).
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
