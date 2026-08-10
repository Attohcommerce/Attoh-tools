"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";

const LS_SHEET = "attoh_kw_sheet";
const LS_VSHEET = "attoh_kw_vsheet"; // doel-sheet van de verdeling
const LS_SESSIONS = "attoh_kw_sessions"; // max 2, nieuwste eerst

const MONTHS = [
  { key: "jan", label: "Jan" }, { key: "feb", label: "Feb" }, { key: "mrt", label: "Mrt" },
  { key: "apr", label: "Apr" }, { key: "mei", label: "Mei" }, { key: "jun", label: "Jun" },
  { key: "jul", label: "Jul" }, { key: "aug", label: "Aug" }, { key: "sep", label: "Sep" },
  { key: "okt", label: "Okt" }, { key: "nov", label: "Nov" }, { key: "dec", label: "Dec" },
];

// Standaard: 4 maanden vanaf VOLGENDE maand. De lopende maand is grotendeels
// voorbij tegen de tijd dat producten live staan en campagnes leren — wie in
// augustus draait, wil sep-okt-nov-dec zien, niet aug-nov. Drie runs op rij
// stond het venster één maand te vroeg omdat dit de standaard was.
function defaultMonths() {
  const m = new Date().getMonth() + 1;
  return [0, 1, 2, 3].map((i) => MONTHS[(m + i) % 12].key);
}

/* ---------- Keyword Planner CSV parsen (UTF-16, tab-gescheiden) ---------- */

async function parseKeywordCsv(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-16le").decode(buf);
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
      monthNames.push(m[1].trim());
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
    out.push({ kw, avg: num(p[avgIdx]), months: monthIdx.map((i) => num(p[i])) });
  }
  return { rows: out, monthNames };
}

/* ---------- Sessies (max 2 in localStorage) ---------- */

function loadSessions() {
  try {
    const raw = localStorage.getItem(LS_SESSIONS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, 2) : [];
  } catch {
    return [];
  }
}

function persistSessions(list) {
  try {
    localStorage.setItem(LS_SESSIONS, JSON.stringify(list.slice(0, 2)));
  } catch {}
}

/* ---------- Pagina ---------- */

// Vaste keyword-research-sheet — staat altijd automatisch ingevuld;
// alleen de bladnaam kies je nog zelf per run.
const DEFAULT_RESEARCH_SHEET =
  "https://docs.google.com/spreadsheets/d/1nsUSUjWAWqLZOIkzNEipRPnWbVKryC29iSy9fByhcGw/edit";

// Vaste "Collection & Product organization"-doelsheet (stap 2) — automatisch
// ingevuld; de naam van het nieuwe tabblad kies je zelf per run.
const DEFAULT_ORG_SHEET =
  "https://docs.google.com/spreadsheets/d/1MaVHQ76s54lrZkNPfr-J32y7GvjJpLfV2j-m0MvXO3g/edit";

export default function KeywordsPage() {
  const [files, setFiles] = useState([]);
  /* Bron voor de keyword-stats: verse CSV's uit Keyword Planner, of een
     tabblad dat er al staat. Bij een bestaand tabblad hoeft er niets
     samengevoegd of geüpload te worden — stap 2 en 3 draaien toch al
     server-side op sheet + bladnaam. */
  const [srcMode, setSrcMode] = useState("csv"); // "csv" | "sheet"
  const [srcTab, setSrcTab] = useState("");
  const [srcBusy, setSrcBusy] = useState(false);
  const [srcReady, setSrcReady] = useState(false);
  const [sheetLink, setSheetLink] = useState(DEFAULT_RESEARCH_SHEET);
  const [tabName, setTabName] = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [doneUrl, setDoneUrl] = useState("");
  const [cleanTab, setCleanTab] = useState("");
  const [topN, setTopN] = useState("500");
  const [cleaning, setCleaning] = useState(false);
  // Stap 3: Collection & Product organization
  const [vSheetLink, setVSheetLink] = useState(DEFAULT_ORG_SHEET);
  const [vTabName, setVTabName] = useState("Collection & Product organization");
  const [vGenders, setVGenders] = useState("MV"); // MV | V | M
  const [vMonths, setVMonths] = useState(defaultMonths);
  const [vRunning, setVRunning] = useState(false);
  const [vDoneUrl, setVDoneUrl] = useState("");
  const [vTotal, setVTotal] = useState("1000"); // 1–2000 producten
  const [vChoice, setVChoice] = useState(false); // keuze-paneel bij lage aantallen
  const [vStore, setVStore] = useState(""); // store-URL/naam — context voor AI + log
  const [vMarket, setVMarket] = useState("USA"); // USA | UK | AUS | CAN
  // Sessies + chat
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null); // null = nieuwe run
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const fileInput = useRef(null);
  const chatEnd = useRef(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem(LS_SHEET);
      if (s) setSheetLink(s);
      const v = localStorage.getItem(LS_VSHEET);
      if (v) setVSheetLink(v);
      const st = localStorage.getItem("kw_store");
      if (st) setVStore(st);
      const mk = localStorage.getItem("kw_market");
      if (mk) setVMarket(mk);
    } catch {}
    setSessions(loadSessions());
  }, []);

  useEffect(() => {
    if (chatEnd.current) chatEnd.current.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, chatBusy]);

  function pushLog(entry) {
    setLogs((l) => {
      // Entries met dezelfde key vervangen elkaar (live voortgang op één regel
      // i.p.v. een stapel losse regels).
      if (entry.key) {
        const i = l.findIndex((x) => x.key === entry.key);
        if (i >= 0) {
          const next = [...l];
          next[i] = entry;
          return next;
        }
      }
      return [...l, entry];
    });
  }

  // Wat is de tool NU aan het doen / wat was de laatste afgeronde stap?
  const lastPhase = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].strong) return String(logs[i].text || "").replace(/^—\s*/, "");
    }
    return "";
  }, [logs]);
  const anyBusy = running || vRunning || cleaning;

  /* ----- sessies beheren ----- */

  function upsertSession(patch) {
    setSessions((prev) => {
      let list = [...prev];
      const i = list.findIndex((s) => s.id === patch.id);
      if (i >= 0) list[i] = { ...list[i], ...patch };
      else list = [patch, ...list].slice(0, 2); // max 2 — oudste valt eraf
      persistSessions(list);
      return list;
    });
  }

  function openSession(s) {
    setActiveId(s.id);
    setSheetLink(s.sheetLink || sheetLink);
    setTabName(s.tabName);
    setCleanTab(s.tabName);
    setDoneUrl(s.doneUrl || "");
    setVDoneUrl(s.verdelingUrl || "");
    setLogs(s.logs || []);
    setChatMsgs(s.chat || []);
    setFiles([]);
  }

  function newSession() {
    setActiveId(null);
    setTabName("");
    setCleanTab("");
    setDoneUrl("");
    setVDoneUrl("");
    setLogs([]);
    setChatMsgs([]);
    setFiles([]);
  }

  const activeSession = sessions.find((s) => s.id === activeId) || null;

  /* ----- bestanden ----- */

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
  const canStart = !running && files.some((f) => f.rows) && sheetLink.trim() && tabName.trim();

  async function api(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /* ----- bestaand tabblad als bron ----- */

  // Leest alleen de kop van het tabblad (paar rijen) om te controleren of het
  // écht een keyword-stats-lijst is. De volledige lijst blijft in de sheet:
  // de merken-check en de verdeling lezen hem daar zelf, server-side.
  async function useExistingTab() {
    const tab = srcTab.trim();
    if (!tab || !sheetLink.trim() || srcBusy) return;
    setSrcBusy(true);
    setSrcReady(false);
    setLogs([]);
    try {
      pushLog({ strong: true, text: `— Bestaand tabblad controleren: "${tab}"` });
      const data = await api("/api/sheets", {
        action: "read",
        sheetId: sheetLink.trim(),
        range: `'${tab}'!A1:Z3`,
      });
      const values = data.values || [];
      if (!values.length) throw new Error(`Tabblad "${tab}" is leeg of bestaat niet`);
      const header = (values[0] || []).map((h) => String(h || "").trim());
      if (!/^keyword$/i.test(header[0] || "")) {
        throw new Error(`Kolom A van "${tab}" moet "Keyword" heten, niet "${header[0] || "(leeg)"}"`);
      }
      const avgIdx = header.findIndex((h) => /^avg/i.test(h));
      if (avgIdx === -1) throw new Error(`Geen kolom "Avg. monthly search" gevonden in "${tab}"`);
      const monthNames = header.slice(avgIdx + 1).filter(Boolean);
      if (monthNames.length < 4) {
        throw new Error(`Maar ${monthNames.length} maandkolommen gevonden — er zijn er minstens 4 nodig`);
      }
      pushLog({ ok: true, text: `Kolommen herkend: ${monthNames.join(" · ")}` });
      const sample = values[1] ? String(values[1][0] || "") : "";
      if (sample) pushLog({ muted: true, text: `Eerste keyword: "${sample}"` });

      // Dit tabblad is vanaf nu de bron voor de merken-check en de verdeling.
      setTabName(tab);
      setCleanTab(tab);
      setSrcReady(true);
      pushLog({ info: true, text: `Klaar — "${tab}" staat klaar voor de merken-check en de verdeling. Samenvoegen is niet nodig.` });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: String(e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setSrcBusy(false);
    }
  }

  /* ----- stap 1: samenvoegen & opmaken ----- */

  async function start() {
    if (!canStart) return;
    setRunning(true);
    setLogs([]);
    setDoneUrl("");
    try {
      localStorage.setItem(LS_SHEET, sheetLink.trim());
    } catch {}

    const runLogs = [];
    const log = (entry) => {
      runLogs.push(entry);
      pushLog(entry);
    };

    try {
      log({ strong: true, text: "— Stap 1: CSV's samenvoegen" });
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
      log({ ok: true, text: `${totalRows} rijen gelezen → ${rows.length} unieke keywords` });

      log({ strong: true, text: "— Stap 2: nieuw tabblad aanmaken" });
      const header = ["Keyword", "Avg. monthly search", ...monthNames];
      const created = await api("/api/keywords-sheet", {
        action: "create",
        sheetId: sheetLink.trim(),
        tabName: tabName.trim(),
        header,
      });
      log({ ok: true, text: `Tabblad "${created.title}" aangemaakt` });

      log({ strong: true, text: "— Stap 3: keywords uploaden" });
      const CHUNK = 4000;
      const values = rows.map((r) => [r.kw, r.avg, ...r.months]);
      for (let i = 0; i < values.length; i += CHUNK) {
        await api("/api/keywords-sheet", {
          action: "append",
          sheetId: sheetLink.trim(),
          tabName: created.title,
          rows: values.slice(i, i + CHUNK),
        });
        log({ key: "upload-prog", text: `Uploaden… ${Math.min(i + CHUNK, values.length)} / ${values.length} rijen` });
      }

      log({ strong: true, text: "— Stap 4: opmaken" });
      const fmt = await api("/api/keywords-sheet", {
        action: "format",
        sheetId: sheetLink.trim(),
        tabId: created.tabId,
        rowCount: values.length + 1,
        colCount: header.length,
      });
      log({ ok: true, text: "Opmaak klaar — geel, filters, grijze keyword-kolom" });
      setDoneUrl(fmt.url);
      setCleanTab(created.title);
      log({ info: true, text: `Klaar! ${rows.length} keywords in "${created.title}".` });

      // Sessie opslaan (max 2) — voortgangs-spam (zelfde key) eruit,
      // alleen de laatste stand bewaren
      const compactLogs = runLogs.filter(
        (l, i) => !l.key || runLogs.findLastIndex((x) => x.key === l.key) === i
      );
      const id = `${created.tabId}-${created.title}`;
      setActiveId(id);
      upsertSession({
        id,
        tabName: created.title,
        sheetLink: sheetLink.trim(),
        doneUrl: fmt.url,
        rowCount: rows.length,
        logs: compactLogs.slice(-30),
        chat: [],
        ts: Date.now(),
      });

      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: String(e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setRunning(false);
    }
  }

  /* ----- stap 2: merken-check ----- */

  const canClean = !cleaning && !running && sheetLink.trim() && cleanTab.trim();

  async function runClean() {
    if (!canClean) return;
    setCleaning(true);
    try {
      pushLog({ strong: true, text: `— Merken-check: bovenste ${topN} van "${cleanTab}"` });
      pushLog({ text: "Merkenlijst + AI beoordelen de keywords — dit kan een minuutje duren…" });
      const r = await api("/api/keywords-sheet", {
        action: "clean",
        sheetId: sheetLink.trim(),
        tabName: cleanTab.trim(),
        topN: Number(topN) || 500,
      });
      const names = r.removed.map((x) => x.kw);
      pushLog({ ok: true, text: `${r.removedCount} van ${r.checked} rijen verwijderd.` });
      if (names.length) {
        pushLog({
          text: `Weg: ${names.slice(0, 40).join(", ")}${names.length > 40 ? ` … en ${names.length - 40} meer` : ""}`,
        });
      }
      if (activeSession) {
        upsertSession({ id: activeSession.id, cleanedCount: (activeSession.cleanedCount || 0) + r.removedCount });
      }
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: String(e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setCleaning(false);
    }
  }

  /* ----- stap 3: Collection & Product organization ----- */

  const step1Done = Boolean(doneUrl) || activeId !== null || srcReady;

  function toggleMonth(key) {
    setVMonths((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= 4) return prev; // max 4 — eerst eentje uitzetten
      return [...prev, key];
    });
  }

  // Gekozen maanden in kalendervolgorde tonen/versturen
  const orderedMonths = MONTHS.filter((m) => vMonths.includes(m.key)).map((m) => m.key);

  const canVerdeling =
    !vRunning && !running && step1Done &&
    vSheetLink.trim() && vTabName.trim() && orderedMonths.length === 4 &&
    sheetLink.trim() && cleanTab.trim();

  const clampTotal = () => Math.max(1, Math.min(2000, Number(vTotal) || 1000));

  // Bij een klein aantal producten eerst de keuze voorleggen (annuleren /
  // AI-focus / eerlijke spreiding); daarboven direct starten met spreiding.
  function startVerdeling() {
    if (!canVerdeling) return;
    if (clampTotal() <= 300) {
      setVChoice(true);
      return;
    }
    runVerdeling("spread");
  }

  async function runVerdeling(mode) {
    if (!canVerdeling) return;
    setVChoice(false);
    setVRunning(true);
    setVDoneUrl("");
    try {
      localStorage.setItem(LS_VSHEET, vSheetLink.trim());
    } catch {}
    try {
      try {
        localStorage.setItem("kw_store", vStore.trim());
        localStorage.setItem("kw_market", vMarket);
      } catch {}
      const gLabel = vGenders === "MV" ? "man + vrouw" : vGenders === "V" ? "vrouw" : "man";
      const mLabel = mode === "focus" ? "AI-focus (zwakke soorten vallen weg)" : "eerlijke spreiding";
      pushLog({ strong: true, text: `— Verdeling: ${vStore.trim() || "store ?"} · markt ${vMarket} · ${orderedMonths.join(", ")} · ${gLabel} · ${clampTotal()} producten · ${mLabel}` });
      pushLog({ text: "AI en verdeel-engine bepalen de collecties en productaantallen — momentje…" });
      const r = await api("/api/keywords-verdeling", {
        sourceSheetId: sheetLink.trim(),
        sourceTab: cleanTab.trim(),
        targetSheetId: vSheetLink.trim(),
        targetTab: vTabName.trim(),
        months: orderedMonths,
        genders: vGenders,
        total: clampTotal(),
        mode,
        market: vMarket,
        storeUrl: vStore.trim(),
      });
      pushLog({ ok: true, text: `${r.keywordCount} keywords → ${r.totalProducts} producten in "${r.title}"` });
      const top = (r.collections || []).slice(0, 5).map((c) => `${c.col} ${c.products}`).join(" · ");
      if (top) pushLog({ text: `Grootste collecties: ${top}` });
      if (r.stats && r.stats.variantMerged) {
        pushLog({ text: `${r.stats.variantMerged} close-variants samengevouwen (identiek volume = zelfde zoekvraag, dubbel geteld door Keyword Planner) — budget vrijgekomen voor échte extra keywords.` });
      }
      if (r.droppedCollections && r.droppedCollections.length) {
        pushLog({ text: `Bewust weggelaten (focus): ${r.droppedCollections.join(", ")}` });
      }
      if (r.aiRemoved && r.aiRemoved.length) {
        pushLog({ text: `AI-nacontrole verwijderde: ${r.aiRemoved.join(", ")}` });
      }
      if (r.warnings && r.warnings.length) {
        for (const w of r.warnings) pushLog({ err: true, text: `Let op: ${w}` });
      }
      setVDoneUrl(r.url);
      if (activeSession) {
        upsertSession({ id: activeSession.id, verdelingUrl: r.url, verdelingTab: r.title });
      }
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: String(e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setVRunning(false);
    }
  }

  /* ----- sessie-chat ----- */

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatBusy || !activeSession) return;
    setChatInput("");
    const nextMsgs = [...chatMsgs, { role: "user", content: text }];
    setChatMsgs(nextMsgs);
    setChatBusy(true);
    try {
      const r = await api("/api/keywords-chat", {
        sheetId: activeSession.sheetLink,
        tabName: activeSession.tabName,
        history: chatMsgs.map(({ role, content }) => ({ role, content })),
        message: text,
      });
      const withReply = [
        ...nextMsgs,
        { role: "assistant", content: r.reply, actions: r.actions || [] },
      ];
      setChatMsgs(withReply);
      // Tabblad hernoemd via chat? Sessie mee laten bewegen.
      const patch = {
        id: activeSession.id,
        chat: withReply.slice(-20),
      };
      if (r.tabName && r.tabName !== activeSession.tabName) {
        patch.tabName = r.tabName;
        setCleanTab(r.tabName);
      }
      upsertSession(patch);
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "ok" }));
    } catch (e) {
      setChatMsgs((m) => [...m, { role: "assistant", content: `Er ging iets mis: ${e.message}`, error: true }]);
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setChatBusy(false);
    }
  }

  /* ---------- render ---------- */

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Keyword Planner → nette sheet" />
      <div className="page">
        {/* -------- Sessies -------- */}
        <div className="sess-bar">
          <button
            className={"sess-tab" + (activeId === null ? " on" : "")}
            onClick={newSession}
          >
            + Nieuwe run
          </button>
          {sessions.map((s) => (
            <button
              key={s.id}
              className={"sess-tab" + (activeId === s.id ? " on" : "")}
              onClick={() => openSession(s)}
              title={s.tabName}
            >
              {s.tabName}
              <span className="sess-meta">{s.rowCount ? `${s.rowCount} kw` : ""}</span>
            </button>
          ))}
          <span className="sess-note">max 2 sessies bewaard</span>
        </div>

        <div className="layout-scraper">
          {/* -------- Links: invoer -------- */}
          <div>
            {activeId === null && (
              <div className="card">
                <div className="srctabs">
                  <button
                    className={"srctab" + (srcMode === "csv" ? " on" : "")}
                    onClick={() => { setSrcMode("csv"); setSrcReady(false); }}
                  >
                    CSV-bestanden
                  </button>
                  <button
                    className={"srctab" + (srcMode === "sheet" ? " on" : "")}
                    onClick={() => { setSrcMode("sheet"); setFiles([]); }}
                  >
                    Bestaand tabblad
                  </button>
                </div>

                {srcMode === "sheet" ? (
                  <>
                    <h2>Bestaande keyword-stats <span className="opt">(al in de sheet)</span></h2>
                    <div className="field-label">Exacte bladnaam</div>
                    <input
                      type="text"
                      placeholder="bv. 9 augustus latest test"
                      value={srcTab}
                      onChange={(e) => { setSrcTab(e.target.value); setSrcReady(false); }}
                    />
                    <div className="hint">
                      De sheet-link hieronder wordt gebruikt. Hij controleert of het tabblad bestaat
                      en of de kolommen kloppen (Keyword · Avg. monthly search · maanden) en gebruikt
                      het daarna direct — samenvoegen en uploaden slaat hij over.
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="btn"
                        onClick={useExistingTab}
                        disabled={srcBusy || !srcTab.trim() || !sheetLink.trim()}
                      >
                        {srcBusy ? "Controleren…" : srcReady ? "✓ Tabblad in gebruik" : "⌕ Tabblad inlezen"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            )}

            <div className="card">
              <h2>{activeId === null ? "Doel-sheet" : "Sessie"}</h2>
              <div className="field-label">Google Sheet-link</div>
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={sheetLink}
                onChange={(e) => setSheetLink(e.target.value)}
                disabled={activeId !== null}
              />
              <div className="field-label">
                {activeId !== null ? "Tabblad" : srcMode === "sheet" ? "Tabblad (uit het blok hierboven)" : "Naam nieuw tabblad"}
              </div>
              <input
                type="text"
                placeholder="bv. UK 4 augustus"
                value={tabName}
                onChange={(e) => {
                  setTabName(e.target.value);
                  if (activeId === null) setCleanTab(e.target.value);
                }}
                disabled={activeId !== null || srcMode === "sheet"}
              />
              {activeId === null ? (
                <div className="hint">
                  {srcMode === "sheet"
                    ? "Er wordt niets aangemaakt of overschreven — de tool leest dit bestaande tabblad."
                    : "Elke run maakt een nieuw tabblad — niets wordt overschreven."}
                </div>
              ) : (
                doneUrl && (
                  <div style={{ marginTop: 12 }}>
                    <a className="linklike" href={doneUrl} target="_blank" rel="noreferrer noopener">
                      Tabblad openen ↗
                    </a>
                  </div>
                )
              )}
            </div>

            {activeId === null && srcMode === "csv" && (
              <div style={{ marginTop: 16 }}>
                <button className="btn" onClick={start} disabled={!canStart}>
                  {running ? "Bezig…" : "⌕ Samenvoegen & opmaken"}
                </button>
              </div>
            )}

            {/* -------- Stap 2: merken-check -------- */}
            <div className="card" style={{ marginTop: 18, opacity: canClean || cleaning ? 1 : 0.55 }}>
              <h2>Merken-check <span className="opt">(AI + merkenlijst)</span></h2>
              <div className="field-label">Aantal bovenste rijen checken</div>
              <input
                type="number"
                min="10"
                max="800"
                value={topN}
                onChange={(e) => setTopN(e.target.value)}
              />
              <div className="hint">
                Verwijdert merken, winkels en platforms uit de bovenste rijen van "{cleanTab || "…"}".
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btn-ghost" onClick={runClean} disabled={!canClean}>
                  {cleaning ? "AI checkt…" : "Check & verwijder merken"}
                </button>
              </div>
            </div>

            {/* -------- Stap 3: Collection & Product organization -------- */}
            {step1Done && (
              <div className="card" style={{ marginTop: 18 }}>
                <h2>
                  Collection & Product organization <span className="opt">(AI-verdeling)</span>
                </h2>
                <div className="field-label">Google Sheet-link (doel)</div>
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  value={vSheetLink}
                  onChange={(e) => setVSheetLink(e.target.value)}
                />
                <div className="field-label">Naam nieuw tabblad</div>
                <input
                  type="text"
                  placeholder="Collection & Product organization"
                  value={vTabName}
                  onChange={(e) => setVTabName(e.target.value)}
                />
                <div className="field-label">Store</div>
                <input
                  type="text"
                  placeholder="bv. soulsocietyboutique.com"
                  value={vStore}
                  onChange={(e) => setVStore(e.target.value)}
                />
                <div className="field-label">Markt</div>
                <div className="seg">
                  {["USA", "UK", "AUS", "CAN"].map((m) => (
                    <button key={m} className={vMarket === m ? "on" : ""} onClick={() => setVMarket(m)} type="button">
                      {m}
                    </button>
                  ))}
                </div>
                <div className="hint">
                  De AI-nacontrole gebruikt de markt om verkeerde-markt-woorden te schrappen
                  (bv. Brits "jumpers"/"trainers" op een USA-store).
                </div>
                <div className="field-label">Doelgroep</div>
                <div className="seg">
                  {[
                    ["MV", "Man + Vrouw"],
                    ["V", "Vrouw"],
                    ["M", "Man"],
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      className={vGenders === val ? "on" : ""}
                      onClick={() => setVGenders(val)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="field-label">
                  Maanden <span className="opt">(kies er 4 — {orderedMonths.length}/4)</span>
                </div>
                <div className="mcal">
                  {MONTHS.map((m) => {
                    const on = vMonths.includes(m.key);
                    const full = !on && vMonths.length >= 4;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        className={"mcal-m" + (on ? " on" : "") + (full ? " dim" : "")}
                        onClick={() => toggleMonth(m.key)}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                <div className="field-label">
                  Aantal producten <span className="opt">(1–2000)</span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="2000"
                  value={vTotal}
                  onChange={(e) => setVTotal(e.target.value)}
                  onBlur={() => setVTotal(String(Math.max(1, Math.min(2000, Number(vTotal) || 1000))))}
                />
                <div className="hint">
                  Verdeelt dit aantal producten over keywords en collecties uit "{cleanTab || "…"}" —
                  sterke trends krijgen meer producten. Bij ≤300 producten krijg je eerst een keuze
                  hoe streng de verdeling mag zijn.
                </div>
                <div style={{ marginTop: 12 }}>
                  <button className="btn" onClick={startVerdeling} disabled={!canVerdeling}>
                    {vRunning ? "AI verdeelt…" : "⚖ Maak verdeling"}
                  </button>
                </div>
                {vChoice && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 14,
                      border: "1px solid var(--warn)",
                      borderRadius: 10,
                      background: "var(--warn-dim)",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      Let op: {clampTotal()} producten is weinig voor een volle store
                    </div>
                    <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
                      Met zo weinig producten kan niet elke collectie gevuld worden. Kies hoe de
                      verdeling daarmee omgaat:
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn btn-small" onClick={() => runVerdeling("focus")}>
                        AI-focus (aanrader) — zwakke productsoorten vallen weg, budget naar kansrijke
                      </button>
                      <button className="btn-ghost btn-small" onClick={() => runVerdeling("spread")}>
                        Eerlijke spreiding — alles wat goed is komt erin, kleinere aantallen per keyword
                      </button>
                      <button className="btn-ghost btn-small" onClick={() => setVChoice(false)}>
                        Annuleren
                      </button>
                    </div>
                  </div>
                )}
                {vDoneUrl && (
                  <div style={{ marginTop: 12 }}>
                    <a className="linklike" href={vDoneUrl} target="_blank" rel="noreferrer noopener">
                      Tabblad openen ↗
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* -------- Rechts: voortgang -------- */}
          <div>
            <div className="card prog-card" style={{ minHeight: 320 }}>
              {logs.length > 0 && (
                <div className="prog-top">
                  <span className="prog-title">{anyBusy ? "Nu bezig" : "Laatste stap"}</span>
                  <span className="prog-count" style={{ fontSize: 13 }}>
                    {lastPhase || "—"}
                    {anyBusy ? <span className="prog-sep"> · draait…</span> : <span className="ok"> · ✓ afgerond</span>}
                  </span>
                </div>
              )}
              {logs.length === 0 && (
                <div className="center-note">
                  {activeId === null
                    ? "Kies links je CSV-exports, plak de sheet-link, geef het tabblad een naam en start."
                    : "Sessie geladen — gebruik de chat hieronder om aanpassingen te doen."}
                </div>
              )}
              <div className="logpanel">
              {logs.map((l, i) => (
                <div className="log" key={i}>
                  {l.ok ? <span className="ok">✓</span> : l.err ? <span className="err">✗</span> : null}
                  <span style={{ flex: 1, fontWeight: l.strong ? 600 : 400 }}>{l.text}</span>
                </div>
              ))}
              </div>
              {doneUrl && activeId === null && (
                <div style={{ marginTop: 14 }}>
                  <a className="btn-ghost" href={doneUrl} target="_blank" rel="noreferrer noopener" style={{ display: "inline-flex", width: "auto" }}>
                    Tabblad openen ↗
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* -------- Sessie-chat -------- */}
        {activeSession && (
          <div className="card chat">
            <h2>Sessie-chat <span className="opt">— vraag aanpassingen op "{activeSession.tabName}"</span></h2>
            <div className="chat-msgs">
              {chatMsgs.length === 0 && (
                <div className="center-note" style={{ padding: "22px 10px" }}>
                  Typ wat er anders moet — bijvoorbeeld "verwijder alle keywords met 'wedding'",
                  "sorteer op Nov 2025" of "draai de merken-check nog eens over de top 300".
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div key={i} className={"chat-msg " + (m.role === "user" ? "user" : "ai")}>
                  <div className="chat-bubble">{m.content}</div>
                  {m.actions && m.actions.length > 0 && (
                    <div className="chat-actions">
                      {m.actions.map((a, j) => (
                        <span className="chat-action" key={j}>⚙ {a.summary}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {chatBusy && (
                <div className="chat-msg ai">
                  <div className="chat-bubble muted">Bezig met je sheet…</div>
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <div className="chat-inputrow">
              <input
                type="text"
                placeholder="Wat moet er veranderd worden?"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                disabled={chatBusy}
              />
              <button className="btn chat-send" onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>
                {chatBusy ? "…" : "Stuur"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
