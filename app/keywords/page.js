"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { orderWindow, storeProfile } from "@/lib/verdeling";
import { seasonCheck, genderCheck, parseMonthLabel } from "@/lib/market-season";
import { orgLS } from "@/lib/org-client";
import { useOrg } from "../components/OrgProvider";

const LS_SHEET = "attoh_kw_sheet";
const LS_VSHEET = "attoh_kw_vsheet"; // doel-sheet van de verdeling
const LS_SRCSHEET = "attoh_kw_srcsheet"; // stats-sheet bij "Bestaand tabblad"

// Tabbladnaam veilig in A1-notatie: een apostrof in de naam ("Men's USA")
// brak anders de hele range ("Unable to parse range").
function a1Tab(name) {
  return `'${String(name || "").replace(/'/g, "''")}'`;
}

// Google-fouten vertalen naar wat je moet DOEN.
function explainSheetError(msg, tab) {
  const m = String(msg || "");
  if (/unable to parse range|not found/i.test(m)) {
    return `Tabblad "${tab}" niet gevonden in deze sheet — kopieer de exacte bladnaam (onderaan in Google Sheets: rechtsklik op het tabblad → Naam wijzigen → tekst kopiëren). Hoofdletters en spaties tellen mee.`;
  }
  if (/permission|403|forbidden/i.test(m)) {
    return "Geen toegang tot deze sheet — deel hem als Bewerker met attoh-sheets@attoh-tools.iam.gserviceaccount.com en probeer opnieuw.";
  }
  if (/requested entity was not found|404/i.test(m)) {
    return "Sheet niet gevonden — controleer de link (moet een docs.google.com/spreadsheets/d/…-link of het ID zijn).";
  }
  return m;
}
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

  /* DATA IS LAW. Keyword Planner exporteert per keyword ook concurrentie,
     biedingen en trend — precies de kolommen die verraden welk keyword een
     underdog is (vraag zonder concurrentie). Die gooiden we bij het
     samenvoegen weg voor de netheid; vanaf nu reizen ze allemaal mee. */
  const findCol = (...tests) =>
    headerCells.findIndex((h) => tests.some((t) => t.test(String(h || ""))));
  const compTxtIdx = findCol(/^Competition$/i);
  const compIdxIdx = findCol(/^Competition \(indexed/i);
  const bidLowIdx = findCol(/bid \(low/i);
  const bidHighIdx = findCol(/bid \(high/i);
  // Engelse én Nederlandse Keyword Planner-exports
  const chg3Idx = findCol(/^Three month change/i, /^Wijziging over 3 maanden/i);
  const yoyIdx = findCol(/^YoY change/i, /^Wijziging jaar op jaar/i);

  const clean = (v) => String(v || "").trim().replace(/^"|"$/g, "");
  const num = (v) => {
    const s = clean(v);
    return /^\d+$/.test(s) ? parseInt(s, 10) : 0;
  };
  // Decimalen (biedingen) en percentages (trend). Planner schrijft "25%",
  // "-100%" en "∞" (nieuw keyword zonder historie) — ∞ wordt 9999.
  const dec = (v) => {
    // NL-export schrijft "0,27": komma als decimaal (was: komma weg → 27)
    const raw = clean(v);
    const s = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) && s !== "" ? n : "";
  };
  const pct = (v) => {
    const s = clean(v);
    if (!s || s === "-") return "";
    if (s.includes("∞")) return 9999;
    const t = s.replace(/%/g, "");
    const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    return Number.isFinite(n) ? n : "";
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
      comp: compTxtIdx >= 0 ? clean(p[compTxtIdx]) : "",
      compIdx: compIdxIdx >= 0 ? dec(p[compIdxIdx]) : "",
      bidLow: bidLowIdx >= 0 ? dec(p[bidLowIdx]) : "",
      bidHigh: bidHighIdx >= 0 ? dec(p[bidHighIdx]) : "",
      chg3: chg3Idx >= 0 ? pct(p[chg3Idx]) : "",
      yoy: yoyIdx >= 0 ? pct(p[yoyIdx]) : "",
    });
  }
  return { rows: out, monthNames };
}

/* ---------- All keywords (geheugen v2): CSV's samenvoegen ----------
   Zelfde regel als stap 1 (hoogste gemiddelde wint, lege extra-velden
   aanvullen), maar de maanden worden op LABEL uitgelijnd in plaats van op
   positie: CSV's die op verschillende dagen zijn geëxporteerd hebben soms
   een andere maandreeks, en dan schoof sep onder okt. Laatste 12 maanden. */
function mergeKeywordFiles(list) {
  const monthMap = new Map(); // "2025-08" → "Aug 2025"
  for (const f of list) {
    for (const name of f.monthNames || []) {
      const p = parseMonthLabel(name);
      if (p) monthMap.set(p.key, String(name).trim());
    }
  }
  const axis = [...monthMap.keys()].sort().slice(-12);
  const labels = axis.map((k) => monthMap.get(k));
  const EXTRA = ["comp", "compIdx", "bidLow", "bidHigh", "chg3", "yoy"];
  const merged = new Map();
  for (const f of list) {
    if (!f.rows) continue;
    const keys = (f.monthNames || []).map((n) => {
      const p = parseMonthLabel(n);
      return p ? p.key : null;
    });
    const pos = axis.map((k) => keys.indexOf(k));
    for (const r of f.rows) {
      const k = String(r.kw || "").toLowerCase().trim();
      if (!k) continue;
      const row = { ...r, kw: k, months: pos.map((i) => (i >= 0 ? r.months[i] : "")) };
      const cur = merged.get(k);
      if (!cur) {
        merged.set(k, row);
        continue;
      }
      const win = row.avg > cur.avg ? row : cur;
      const lose = win === row ? cur : row;
      win.months = win.months.map((v, i) => (v === "" || v == null ? lose.months[i] : v));
      for (const fld of EXTRA) if (win[fld] === "" || win[fld] == null) win[fld] = lose[fld];
      merged.set(k, win);
    }
  }
  const rows = [...merged.values()].sort((a, b) => b.avg - a.avg);
  return { rows, labels };
}

const CURRENCY_MARKET = { USD: "USA", GBP: "UK", AUD: "AUS", NZD: "AUS", CAD: "CAN" };
const MARKET_SEG = [["USA", "USA"], ["UK", "UK"], ["AUS", "AUS + NZ"], ["CAN", "CAN"]];

/* ---------- Sessies (max 2 in localStorage) ---------- */

function loadSessions() {
  try {
    const raw = orgLS.getItem(LS_SESSIONS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, 2) : [];
  } catch {
    return [];
  }
}

function persistSessions(list) {
  try {
    orgLS.setItem(LS_SESSIONS, JSON.stringify(list.slice(0, 2)));
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
  const org = useOrg(); // organisatie (lib/org.js): hints in het Geheugen-tabblad
  const [files, setFiles] = useState([]);
  /* Bron voor de keyword-stats: verse CSV's uit Keyword Planner, of een
     tabblad dat er al staat. Bij een bestaand tabblad hoeft er niets
     samengevoegd of geüpload te worden — stap 2 en 3 draaien toch al
     server-side op sheet + bladnaam. */
  const [srcMode, setSrcMode] = useState("csv"); // "csv" | "sheet"
  const [srcTab, setSrcTab] = useState("");
  // MARKT VAN DE BATCHES — verplicht bij stap 1 (bewust GEEN default: de
  // markt is heilig, dus altijd een bewuste klik).
  const [srcMarket, setSrcMarket] = useState("");
  // Geheugen-tabblad (per markt: gekoppelde sheet + status)
  const [memStatus, setMemStatus] = useState(null);
  const [memBusy, setMemBusy] = useState("");
  const [memLinks, setMemLinks] = useState({ USA: "", UK: "", AUS: "", CAN: "" });
  // Eigen link-veld voor de stats-sheet bij "Bestaand tabblad" — die is vaak
  // een ANDER bestand dan de doel-sheet (bv. "Keyword Stats — alle batches").
  const [srcSheetLink, setSrcSheetLink] = useState(DEFAULT_RESEARCH_SHEET);
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
  /* Bekende store ingevuld → markt en man/vrouw automatisch goed zetten.
     Voorkomt runs op het verkeerde halfrond of met het verkeerde geslacht. */
  useEffect(() => {
    const p = storeProfile(vStore);
    if (!p) return;
    if (p.market) setVMarket(p.market);
    if (p.genders) setVGenders(p.genders);
  }, [vStore]);
  // Sessies + chat
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null); // null = nieuwe run
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  /* ---- Tabblad 2: Underdog keywords ---- */
  const [view, setView] = useState("run"); // "run" | "underdog"
  const [uOrgSheet, setUOrgSheet] = useState(DEFAULT_ORG_SHEET);
  const [uOrgTab, setUOrgTab] = useState("");
  // Stats-link bewust LEEG: Justin kiest zelf welk stats-bestand deze run
  // voedt (een vooringevulde link wees stilletjes naar het verkeerde bestand).
  // De laatst gebruikte link wordt wel onthouden.
  const [uStatsSheet, setUStatsSheet] = useState("");
  const [uStatsTab, setUStatsTab] = useState("");
  const [uProducts, setUProducts] = useState(250);
  const [uRunning, setURunning] = useState(false);
  const [uLogs, setULogs] = useState([]);
  const [uDoneUrl, setUDoneUrl] = useState("");
  // Looptijd + huidige stap: zonder dit was niet te zien of hij nog bezig
  // was, vastliep of klaar was.
  const [uElapsed, setUElapsed] = useState(0);
  const [uPhase, setUPhase] = useState("");

  /* ---- Tabblad 4: TPK — Top Performing Keywords (vervangt Bijvullen, 15-10-2026).
     Per store één TPK-sheet (store-geheugen), één blad per week. Orders van
     de laatste 30 dagen → winnende keywords → ±10 producten → scrape-ready blad. */
  const [tStore, setTStore] = useState(""); // domein uit sa_stores
  const [tSource, setTSource] = useState("shopify"); // shopify | csv
  const [tDays, setTDays] = useState(30);
  const [tN, setTN] = useState(10);
  const [tTab, setTTab] = useState("");
  const [tTabTouched, setTTabTouched] = useState(false);
  const [tCsv, setTCsv] = useState("");
  const [tBusy, setTBusy] = useState(""); // "" | analyse | write
  const [tResult, setTResult] = useState(null); // antwoord van stap 1
  const [tLogs, setTLogs] = useState([]);
  const [tDoneUrl, setTDoneUrl] = useState("");
  const [tTabs, setTTabs] = useState([]); // bestaande tabbladen in de TPK-sheet

  // ----- Geheugen v2: All keywords per markt (man/vrouw apart) + store-geheugen -----
  const [gStatus, setGStatus] = useState(null); // { all: [...], stores: [...] }
  const [gLogs, setGLogs] = useState([]);
  const [allMarket, setAllMarket] = useState("AUS");
  const [allGender, setAllGender] = useState("V"); // V | M
  const [allFiles, setAllFiles] = useState([]);
  const [allSheetInput, setAllSheetInput] = useState("");
  const [allLinkSheet, setAllLinkSheet] = useState("");
  const [allLinkTab, setAllLinkTab] = useState("");
  const [allBusy, setAllBusy] = useState(""); // "" | sheet | csv | link
  const [allNeedsForce, setAllNeedsForce] = useState(null); // { kind, season, genderChk }
  const [allDrag, setAllDrag] = useState(false);
  const allFileInput = useRef(null);
  const [shopStores, setShopStores] = useState([]); // zelfde lijst als de Importer (sa_stores)
  const [stSel, setStSel] = useState("");
  const [stForm, setStForm] = useState({ market: "", genders: "MV", aanvul: "", orgSheet: "", orgTab: "", tpk: "", importSheet: "" });
  const [stBusy, setStBusy] = useState(""); // "" | save | snap

  const fileInput = useRef(null);
  const chatEnd = useRef(null);

  useEffect(() => {
    try {
      const s = orgLS.getItem(LS_SHEET);
      if (s) setSheetLink(s);
      const ss = orgLS.getItem(LS_SRCSHEET);
      if (ss) setSrcSheetLink(ss);
      else if (s) setSrcSheetLink(s);
      const v = orgLS.getItem(LS_VSHEET);
      if (v) setVSheetLink(v);
      const st = orgLS.getItem("kw_store");
      if (st) setVStore(st);
      const mk = orgLS.getItem("kw_market");
      if (mk) setVMarket(mk);
      const uo = orgLS.getItem("kw_u_orgtab");
      if (uo) setUOrgTab(uo);
      const us = orgLS.getItem("kw_u_statstab");
      if (us) setUStatsTab(us);
      const usl = orgLS.getItem("kw_u_statssheet");
      if (usl) setUStatsSheet(usl);
      const ts = orgLS.getItem("kw_tpk_store");
      if (ts) setTStore(ts);
      const tsrc = orgLS.getItem("kw_tpk_source");
      if (tsrc === "csv" || tsrc === "shopify") setTSource(tsrc);
      const tn = Number(orgLS.getItem("kw_tpk_n"));
      if (tn > 0) setTN(tn);
      const td = Number(orgLS.getItem("kw_tpk_days"));
      if (td > 0) setTDays(td);
    } catch {}
    setSessions(loadSessions());
  }, []);

  useEffect(() => {
    if (chatEnd.current) chatEnd.current.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, chatBusy]);

  // Seconden-teller zolang de underdog-run loopt
  useEffect(() => {
    if (!uRunning) return;
    setUElapsed(0);
    const t = setInterval(() => setUElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [uRunning]);

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
  const canStart = !running && files.some((f) => f.rows) && sheetLink.trim() && tabName.trim() && !!srcMarket;

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
    const link = srcSheetLink.trim();
    if (!tab || !link || srcBusy) return;
    setSrcBusy(true);
    setSrcReady(false);
    setLogs([]);
    try {
      pushLog({ strong: true, text: `— Bestaand tabblad controleren: "${tab}"` });
      let data;
      try {
        data = await api("/api/sheets", {
          action: "read",
          sheetId: link,
          range: `${a1Tab(tab)}!A1:AD3`,
        });
      } catch (e) {
        throw new Error(explainSheetError(e.message, tab));
      }
      const values = data.values || [];
      if (!values.length) throw new Error(`Tabblad "${tab}" is leeg`);
      const header = (values[0] || []).map((h) => String(h || "").trim());
      // Zelfde herkenning als de verdeling-route: kolom "Keyword…", kolom
      // "Avg…", en maandkolommen ("Jul 2025" of "Searches: Jul 2025").
      const kwIdx = header.findIndex((h) => /^keyword/i.test(h));
      if (kwIdx === -1) {
        throw new Error(
          `Geen kolom "Keyword" gevonden in rij 1 van "${tab}" (gevonden: ${header.filter(Boolean).slice(0, 6).join(" · ") || "niets"}). Is dit wel een keyword-stats-tabblad?`
        );
      }
      const avgIdx = header.findIndex((h) => /^avg/i.test(h));
      if (avgIdx === -1) throw new Error(`Geen kolom "Avg. monthly search" gevonden in "${tab}"`);
      const MONTH_RE = /^(searches:\s*)?(jan|feb|ma?r|apr|ma?y|mei|jun|jul|aug|sep|o[ck]t|nov|dec)/i;
      const monthNames = header.filter((h) => MONTH_RE.test(h));
      if (monthNames.length < 4) {
        throw new Error(`Maar ${monthNames.length} maandkolommen gevonden in "${tab}" — er zijn er minstens 4 nodig (bv. "Sep 2025").`);
      }
      const extras = header.filter((h) => /competition|comp\. index|bid|verandering|change/i.test(h));
      pushLog({ ok: true, text: `Kolommen herkend: Keyword · Avg · ${monthNames.length} maanden (${monthNames[0]} … ${monthNames[monthNames.length - 1]})${extras.length ? ` · ${extras.length} extra Planner-kolommen (concurrentie/bids/trend)` : " · geen concurrentie/bid/trend-kolommen (stap 1 opnieuw draaien met CSV's voor de underdog-engine)"}` });
      const sample = values[1] ? String(values[1][kwIdx] || "") : "";
      if (sample) pushLog({ muted: true, text: `Eerste keyword: "${sample}"` });

      // Dit tabblad is vanaf nu de bron voor de merken-check en de verdeling —
      // dus ook de sheet-link van de sessie wijst nu naar deze stats-sheet.
      setSheetLink(link);
      setTabName(tab);
      setCleanTab(tab);
      setSrcReady(true);
      try {
        orgLS.setItem(LS_SRCSHEET, link);
        orgLS.setItem(LS_SHEET, link);
      } catch {}
      pushLog({ info: true, text: `Klaar — "${tab}" staat klaar voor de merken-check en de verdeling. Samenvoegen is niet nodig.` });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: String(e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setSrcBusy(false);
    }
  }

  /* ----- batch-geheugen ----- */

  async function loadMemStatus() {
    try {
      const r = await api("/api/keywords-memory", { action: "status" });
      setMemStatus(r.markets || []);
      const links = { USA: "", UK: "", AUS: "", CAN: "" };
      for (const row of r.markets || []) if (row.sheetUrl) links[row.market] = row.sheetUrl;
      setMemLinks(links);
    } catch (e) {
      setMemStatus([]);
      pushLog({ err: true, text: "Geheugen-status laden mislukt: " + (e.message || e) });
    }
  }

  async function memSaveLink(market) {
    setMemBusy(market + ":save");
    try {
      await api("/api/keywords-memory", { action: "configSet", market, link: memLinks[market] });
      pushLog({ ok: true, text: `Geheugen-sheet voor ${market} gekoppeld. Deel hem met de service account (attoh-sheets@attoh-tools.iam.gserviceaccount.com) als dat nog niet gebeurd is.` });
      await loadMemStatus();
    } catch (e) {
      pushLog({ err: true, text: `Koppelen mislukt (${market}): ` + (e.message || e) });
    } finally {
      setMemBusy("");
    }
  }

  async function memMake(market) {
    setMemBusy(market + ":make");
    try {
      pushLog({ strong: true, text: `— All-batch-tabblad maken uit geheugen ${market}…` });
      const r = await api("/api/keywords-memory", { action: "make", market });
      pushLog({ ok: true, text: `"${r.tab}" staat klaar (${r.rows ?? "?"} keywords) — 1-op-1 bruikbaar als bron voor de merken-check en de verdeling.` });
      window.open(r.url, "_blank", "noopener");
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: `All-batch maken mislukt (${market}): ` + (e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setMemBusy("");
    }
  }

  async function memUseAsSource(market) {
    // 1 klik: het geheugen-tabblad zelf als bron voor merken-check + verdeling.
    const row = (memStatus || []).find((x) => x.market === market);
    if (!row || !row.sheetUrl) return;
    setSrcMode("sheet");
    setView("run");
    setSrcSheetLink(row.sheetUrl);
    setSrcTab(`MEM ${market}`);
    setSheetLink(row.sheetUrl);
    setTabName(`MEM ${market}`);
    setCleanTab(`MEM ${market}`);
    setSrcReady(true);
    setVMarket(market);
    pushLog({ ok: true, text: `Geheugen ${market} staat klaar als bron ("MEM ${market}") — markt in de verdeling is op ${market} gezet.` });
  }

  /* ----- geheugen v2: All keywords per markt + store-geheugen ----- */

  function gLog(entry) {
    setGLogs((l) => {
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
  const sfx = (kind) => window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: kind }));

  async function loadGeheugen() {
    try {
      setShopStores(JSON.parse(orgLS.getItem("sa_stores") || "[]") || []);
    } catch {
      setShopStores([]);
    }
    try {
      const r = await api("/api/geheugen", { action: "status" });
      setGStatus({ all: r.all || [], stores: r.stores || [] });
    } catch (e) {
      setGStatus({ all: [], stores: [] });
      gLog({ err: true, text: "Geheugen laden mislukt: " + (e.message || e) });
    }
  }

  const curAll = (gStatus && (gStatus.all || []).find((x) => x.market === allMarket)) || null;
  const gWord = allGender === "M" ? "MAN" : "VROUW";

  // Sheet-link van de gekozen markt in het invulveld zetten
  useEffect(() => {
    setAllSheetInput(curAll && curAll.sheetUrl ? curAll.sheetUrl : "");
    setAllNeedsForce(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMarket, gStatus]);

  async function allSaveSheet() {
    setAllBusy("sheet");
    try {
      await api("/api/geheugen", { action: "allSheet", market: allMarket, link: allSheetInput });
      gLog({ ok: true, text: `All keywords-sheet voor ${allMarket} gekoppeld.` });
      await loadGeheugen();
    } catch (e) {
      gLog({ err: true, text: `Koppelen mislukt: ${e.message || e}` });
    } finally {
      setAllBusy("");
    }
  }

  async function addAllFiles(fileList) {
    const list = Array.from(fileList || []).filter((f) => /\.csv$/i.test(f.name));
    const parsed = [];
    for (const f of list) {
      try {
        parsed.push({ name: f.name, ...(await parseKeywordCsv(f)) });
      } catch (err) {
        parsed.push({ name: f.name, error: String(err.message || err) });
      }
    }
    setAllFiles((prev) => {
      const names = new Set(prev.map((p) => p.name));
      return [...prev, ...parsed.filter((p) => !names.has(p.name))].slice(0, 10);
    });
    setAllNeedsForce(null);
  }

  async function allRunCsv(force) {
    const good = allFiles.filter((f) => f.rows);
    if (!good.length || allBusy) return;
    setAllBusy("csv");
    try {
      gLog({ strong: true, text: `— All keywords ${allMarket} ${gWord}: ${good.length} CSV's samenvoegen` });
      const { rows, labels } = mergeKeywordFiles(good);
      const total = good.reduce((s, f) => s + f.rows.length, 0);
      gLog({ ok: true, text: `${total.toLocaleString("nl-NL")} rijen → ${rows.length.toLocaleString("nl-NL")} unieke keywords · ${labels.length} maanden (${labels[0] || "?"} … ${labels[labels.length - 1] || "?"})` });
      if (labels.length < 12) {
        gLog({ err: true, text: `Maar ${labels.length} maandkolommen — exporteer in Keyword Planner de laatste 12 maanden.` });
      }
      const season = seasonCheck(rows, labels, allMarket);
      const gchk = genderCheck(rows, allGender);
      gLog({ ok: season.ok && !season.inconclusive, err: !season.ok, muted: season.inconclusive, text: season.text });
      gLog({ ok: gchk.ok && !gchk.inconclusive, err: !gchk.ok, muted: gchk.inconclusive, text: gchk.text });
      if ((!season.ok || !gchk.ok) && !force) {
        setAllNeedsForce({ kind: "csv", season, genderChk: gchk });
        gLog({ err: true, text: 'Niet opgeslagen. Weet je zeker dat markt en vak kloppen? Klik dan links op "Toch opslaan".' });
        sfx("error");
        return;
      }
      setAllNeedsForce(null);
      const header = [
        "Keyword", "Avg. monthly search", ...labels,
        "Competition", "Comp. index", "Top bid low", "Top bid high", "3-mnd verandering %", "YoY verandering %",
      ];
      gLog({ strong: true, text: "— Tab klaarzetten in de All keywords-sheet" });
      const prep = await api("/api/geheugen", {
        action: "allPrepare", market: allMarket, gender: allGender, header, rowCount: rows.length,
      });
      gLog({ ok: true, text: `"${prep.tab}" ${prep.replaced ? "vervangen (vorige batch is weg)" : "aangemaakt"}` });
      const values = rows.map((r) => [
        r.kw, r.avg, ...r.months,
        r.comp ?? "", r.compIdx ?? "", r.bidLow ?? "", r.bidHigh ?? "", r.chg3 ?? "", r.yoy ?? "",
      ]);
      const CHUNK = 4000;
      for (let i = 0; i < values.length; i += CHUNK) {
        await api("/api/keywords-sheet", { action: "append", sheetId: prep.sheetId, tabName: prep.tab, rows: values.slice(i, i + CHUNK) });
        gLog({ key: "all-up", text: `Uploaden… ${Math.min(i + CHUNK, values.length).toLocaleString("nl-NL")} / ${values.length.toLocaleString("nl-NL")}` });
      }
      await api("/api/keywords-sheet", {
        action: "format", sheetId: prep.sheetId, tabId: prep.tabId, rowCount: values.length + 1, colCount: header.length,
      });
      const c = await api("/api/geheugen", {
        action: "allCommit", market: allMarket, gender: allGender, tab: prep.tab, tabId: prep.tabId,
        rows: rows.length, months: labels, files: good.map((f) => f.name), season, genderChk: gchk, forced: !!force,
      });
      gLog({ ok: true, text: `In het geheugen: ${prep.tab} · ${rows.length.toLocaleString("nl-NL")} keywords. Staat vast tot de volgende seizoenswissel (±3 maanden).`, href: c.meta && c.meta.url });
      setAllFiles([]);
      sfx("success");
      await loadGeheugen();
    } catch (e) {
      gLog({ err: true, text: String(e.message || e) });
      sfx("error");
    } finally {
      setAllBusy("");
    }
  }

  async function allRunLink(force) {
    if (allBusy || !allLinkSheet.trim() || !allLinkTab.trim()) return;
    setAllBusy("link");
    try {
      gLog({ strong: true, text: `— "${allLinkTab.trim()}" koppelen als All keywords ${allMarket} ${gWord}` });
      gLog({ key: "all-link", muted: true, text: "Hele tabblad lezen voor de seizoens- en geslachtscheck… (bij 100k rijen ±30 sec)" });
      const r = await api("/api/geheugen", {
        action: "allLink", market: allMarket, gender: allGender, link: allLinkSheet.trim(), tab: allLinkTab.trim(), force: !!force,
      });
      const season = r.needsForce ? r.season : r.meta.season;
      const gchk = r.needsForce ? r.genderChk : r.meta.genderChk;
      gLog({ key: "all-link", ok: true, text: `${(r.needsForce ? r.rows : r.meta.rows).toLocaleString("nl-NL")} keywords gelezen` });
      gLog({ ok: season.ok && !season.inconclusive, err: !season.ok, muted: season.inconclusive, text: season.text });
      gLog({ ok: gchk.ok && !gchk.inconclusive, err: !gchk.ok, muted: gchk.inconclusive, text: gchk.text });
      if (r.needsForce) {
        setAllNeedsForce({ kind: "link", season, genderChk: gchk });
        gLog({ err: true, text: 'Niet gekoppeld. Weet je zeker dat markt en vak kloppen? Klik dan links op "Toch opslaan".' });
        sfx("error");
        return;
      }
      setAllNeedsForce(null);
      gLog({ ok: true, text: `In het geheugen: ALL ${allMarket} ${gWord} → "${r.meta.tab}" · ${(r.meta.months || [])[0]} – ${(r.meta.months || []).slice(-1)[0]}`, href: r.meta.url });
      sfx("success");
      await loadGeheugen();
    } catch (e) {
      gLog({ key: "all-link", err: true, text: String(e.message || e) });
      sfx("error");
    } finally {
      setAllBusy("");
    }
  }

  const savedStores = (gStatus && gStatus.stores) || [];
  const stStore = shopStores.find((s) => s.domain === stSel) || null;
  const stSaved = savedStores.find((s) => s.domain === stSel) || null;

  function stSelect(domain) {
    setStSel(domain);
    const s = shopStores.find((x) => x.domain === domain);
    const saved = savedStores.find((x) => x.domain === domain);
    if (!s) return;
    const prof = storeProfile(s.publicDomain) || storeProfile(s.domain);
    setStForm({
      market: (saved && saved.market) || (prof && prof.market) || CURRENCY_MARKET[String(s.currency || "").toUpperCase()] || "",
      genders: (saved && saved.genders) || (prof && prof.genders) || "MV",
      aanvul: (saved && saved.aanvulUrl) || "",
      // Leeg = dezelfde sheet als de aanvul-sheet (alles in één sheet)
      orgSheet:
        saved && saved.orgSheetId && saved.orgSheetId !== saved.aanvulSheetId
          ? `https://docs.google.com/spreadsheets/d/${saved.orgSheetId}/edit`
          : "",
      orgTab: (saved && saved.orgTab) || "",
      // TPK-sheet (top performing keywords) en import-lijst (scraper/importer) — optioneel
      tpk: (saved && saved.tpkUrl) || "",
      importSheet: (saved && saved.importUrl) || "",
    });
  }

  async function stSave(quiet) {
    if (!stStore) return null;
    const r = await api("/api/geheugen", {
      action: "storeSave",
      // alleen publieke velden — credentials blijven in de browser
      store: { name: stStore.name, domain: stStore.domain, publicDomain: stStore.publicDomain, currency: stStore.currency },
      market: stForm.market,
      genders: stForm.genders,
      aanvul: stForm.aanvul,
      orgSheet: stForm.orgSheet,
      orgTab: stForm.orgTab,
      tpk: stForm.tpk,
      importSheet: stForm.importSheet,
    });
    if (!quiet) gLog({ ok: true, text: `Store-geheugen ${r.entry.name || r.entry.domain} opgeslagen (${r.entry.market} · ${r.entry.genders}${r.entry.tpkSheetId ? " · TPK-sheet gekoppeld" : " · geen TPK-sheet"}${r.entry.importSheetId ? " · import-lijst gekoppeld" : " · geen import-lijst"}).`, href: r.entry.aanvulUrl });
    return r.entry;
  }

  async function stSaveClick() {
    setStBusy("save");
    try {
      await stSave(false);
      await loadGeheugen();
    } catch (e) {
      gLog({ err: true, text: `Opslaan mislukt: ${e.message || e}` });
    } finally {
      setStBusy("");
    }
  }

  async function stSnapshot() {
    if (!stStore || stBusy) return;
    setStBusy("snap");
    try {
      await stSave(true);
      gLog({ strong: true, text: `— Store-geheugen bijwerken: ${stStore.name || stStore.domain}` });
      gLog({ key: "st-snap", muted: true, text: "Shopify uitlezen (producten + collecties) en de originele organization erbij…" });
      const r = await api("/api/geheugen", { action: "storeSnapshot", store: stStore });
      const s = r.snapshot || {};
      gLog({ key: "st-snap", ok: true, text: `${s.products} producten op de store · vrouw ${s.vrouw.keywords} keywords (${s.vrouw.products} producten) · man ${s.man.keywords} keywords (${s.man.products} producten)` });
      gLog({ text: `${s.collections} collecties · ${s.noCollection} producten zonder collectie${(r.topColls || []).length ? ` · grootste: ${r.topColls.join(" · ")}` : ""}` });
      if (s.origRows) gLog({ ok: true, text: `Originele organization: ${s.origRows} keywords meegenomen (kolom "Gepland in origineel")` });
      for (const w of s.warnings || []) gLog({ err: true, text: `Let op: ${w}` });
      if (!r.allV || !r.allM) {
        gLog({ err: true, text: `All keywords voor deze markt nog niet compleet (${r.allV ? "" : "vrouw "}${r.allM ? "" : "man"}ontbreekt) — zet die in blok 1.` });
      }
      gLog({ ok: true, text: `Geschreven in de aanvul-sheet: ${(r.written || []).join(", ")}`, href: r.url });
      sfx("success");
      await loadGeheugen();
    } catch (e) {
      gLog({ key: "st-snap", err: true, text: String(e.message || e) });
      sfx("error");
    } finally {
      setStBusy("");
    }
  }

  /* ----- stap 1: samenvoegen & opmaken ----- */

  async function start() {
    if (!canStart) return;
    setRunning(true);
    setLogs([]);
    setDoneUrl("");
    try {
      orgLS.setItem(LS_SHEET, sheetLink.trim());
    } catch {}

    const runLogs = [];
    const log = (entry) => {
      runLogs.push(entry);
      pushLog(entry);
    };

    try {
      log({ strong: true, text: `— Stap 1: CSV's samenvoegen · MARKT ${srcMarket}` });
      const merged = new Map();
      let monthNames = null;
      // Bij dubbele keywords wint de rij met het hoogste volume, maar lege
      // extra velden (concurrentie/bids/trend) worden aangevuld vanuit de
      // andere batch — geen data weggooien die één van de twee wél had.
      const EXTRA = ["comp", "compIdx", "bidLow", "bidHigh", "chg3", "yoy"];
      for (const f of files) {
        if (!f.rows) continue;
        if (!monthNames) monthNames = f.monthNames;
        for (const r of f.rows) {
          const k = r.kw.toLowerCase();
          const cur = merged.get(k);
          if (!cur) {
            merged.set(k, { ...r });
          } else {
            const win = r.avg > cur.avg ? { ...r } : { ...cur };
            const lose = r.avg > cur.avg ? cur : r;
            for (const fld of EXTRA) {
              if (win[fld] === "" || win[fld] == null) win[fld] = lose[fld];
            }
            merged.set(k, win);
          }
        }
      }
      const rows = [...merged.values()].sort((a, b) => b.avg - a.avg);
      log({ ok: true, text: `${totalRows} rijen gelezen → ${rows.length} unieke keywords` });

      log({ strong: true, text: "— Stap 2: nieuw tabblad aanmaken" });
      // Extra kolommen NA de maanden, zodat alle bestaande lezers (verdeling,
      // merken-check) die op naam zoeken gewoon blijven werken.
      const header = [
        "Keyword", "Avg. monthly search", ...monthNames,
        "Competition", "Comp. index", "Top bid low", "Top bid high",
        "3-mnd verandering %", "YoY verandering %",
      ];
      const created = await api("/api/keywords-sheet", {
        action: "create",
        sheetId: sheetLink.trim(),
        tabName: tabName.trim(),
        header,
        // Voor de capaciteits-check én een exact raster (geen 26-koloms
        // default die het workbook onnodig richting de 10M-cellenlimiet duwt)
        rowCount: rows.length,
        colCount: header.length,
      });
      log({ ok: true, text: `Tabblad "${created.title}" aangemaakt` });

      log({ strong: true, text: "— Stap 3: keywords uploaden" });
      const CHUNK = 4000;
      const values = rows.map((r) => [
        r.kw, r.avg, ...r.months,
        r.comp ?? "", r.compIdx ?? "", r.bidLow ?? "", r.bidHigh ?? "", r.chg3 ?? "", r.yoy ?? "",
      ]);
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

      /* ---- Stap 5: batch-geheugen (markt is heilig) ----
         Tabblad → markt registreren (de verdeling weigert straks een
         verkeerde markt) en de batch samenvoegen in het geheugen van deze
         markt, zodat een all-batch-tabblad altijd 1 klik is. */
      try {
        await api("/api/keywords-memory", {
          action: "register", sheetId: sheetLink.trim(), tab: created.title, market: srcMarket,
        });
      } catch {}
      try {
        log({ strong: true, text: `— Stap 5: opslaan in geheugen ${srcMarket}` });
        log({ key: "mem-prog", text: "Batch samenvoegen met het geheugen — dit kan bij grote batches een paar minuten duren…" });
        const mem = await api("/api/keywords-memory", {
          action: "merge", market: srcMarket, srcSheetId: sheetLink.trim(), srcTab: created.title, label: created.title,
        });
        if (mem.notConfigured) {
          log({ key: "mem-prog", err: true, text: `NIET in het geheugen opgeslagen: er is nog geen geheugen-sheet gekoppeld voor ${srcMarket}. Ga naar het Geheugen-tabblad bovenin, plak daar een (lege) sheet-link voor ${srcMarket} en draai stap 1 opnieuw — of laat het; deze run zelf is gewoon klaar.` });
        } else {
          log({ key: "mem-prog", ok: true, text: `Geheugen ${srcMarket} bijgewerkt: ${mem.added} nieuw · ${mem.updated} bijgewerkt · totaal ${mem.total} keywords. Booming-venster: ${mem.window}.` });
        }
      } catch (e) {
        log({ key: "mem-prog", err: true, text: `Geheugen bijwerken mislukt (${e.message || e}) — de run zelf is klaar; draai het later opnieuw via stap 1 of meld het.` });
      }

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

  /* Gekozen maanden in TIJDSVOLGORDE (21-9-2026): okt-nov-dec-jan, niet de
     kalendervolgorde jan-okt-nov-dec. De engine laat de laatste maand het
     zwaarst wegen en kijkt naar de maand ná het venster — in kalender-
     volgorde was dat bij een jaargrens-venster precies verkeerd om. */
  const orderedMonths = orderWindow(vMonths);

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
      orgLS.setItem(LS_VSHEET, vSheetLink.trim());
    } catch {}
    try {
      try {
        orgLS.setItem("kw_store", vStore.trim());
        orgLS.setItem("kw_market", vMarket);
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
      if (r.market && r.windowSeasons && r.windowSeasons.length) {
        const uniek = [...new Set(r.windowSeasons)];
        const NL = { spring: "lente", summer: "zomer", autumn: "herfst", winter: "winter" };
        pushLog({
          text: `Seizoen in ${r.market} voor ${orderedMonths.join("-")}: ${uniek.map((s) => NL[s] || s).join(" → ")} — soorten die eraan komen kregen voorrang, soorten die net voorbij zijn zijn gedempt.`,
        });
      }
      if (r.stats && r.stats.colorCapped) {
        pushLog({ text: `${r.stats.colorCapped} kleur-varianten geschrapt (kleur is een filter op dezelfde producten, geen aparte zoekvraag) — budget naar echte extra productsoorten.` });
      }
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

  /* ----- underdog-run ----- */

  const canUnderdog =
    !uRunning && uOrgSheet.trim() && uOrgTab.trim() && uStatsSheet.trim() &&
    uStatsTab.trim() && orderedMonths.length === 4;

  /* ---------- TPK — Top Performing Keywords ---------- */
  const tPush = (e) =>
    setTLogs((l) => {
      if (e.key) {
        const i = l.findIndex((x) => x.key === e.key);
        if (i >= 0) {
          const copy = [...l];
          copy[i] = e;
          return copy;
        }
      }
      return [...l, e];
    });
  const tShop = shopStores.find((s) => s.domain === tStore) || null;
  const tSaved = savedStores.find((s) => s.domain === tStore) || null;
  // Orders-app-sleutels van deze store (zelfde opslag als de Bills-pagina)
  const tOrdersKeys = (() => {
    if (!tStore) return null;
    try {
      const k = JSON.parse(orgLS.getItem("sa_orders_app::" + tStore) || "null");
      return k && k.clientId && k.clientSecret ? k : null;
    } catch {
      return null;
    }
  })();
  /* 20-10: geen Orders-app-sleutels → de Importer-koppeling van de store
     (Justins eigen app heeft read_orders; in Sa Collective is er geen
     Bills-pagina om losse Orders-app-sleutels in te vullen). */
  const tOrdersStore = (() => {
    if (!tShop) return null;
    if (tOrdersKeys) return { name: tShop.name, domain: tShop.domain, clientId: tOrdersKeys.clientId, clientSecret: tOrdersKeys.clientSecret, via: "orders-app" };
    if (tShop.token || (tShop.clientId && tShop.clientSecret)) {
      return { name: tShop.name, domain: tShop.domain, token: tShop.token || "", clientId: tShop.clientId || "", clientSecret: tShop.clientSecret || "", via: "importer" };
    }
    return null;
  })();
  const canTpkAnalyse = !tBusy && tStore && tSaved && tSaved.tpkSheetId && (tSource === "csv" ? tCsv.trim() : !!tOrdersStore) && Number(tN) > 0;
  const canTpkWrite = !tBusy && tResult && tResult.analysis && tTab.trim();

  function tRemember() {
    try {
      orgLS.setItem("kw_tpk_store", tStore);
      orgLS.setItem("kw_tpk_source", tSource);
      orgLS.setItem("kw_tpk_n", String(tN));
      orgLS.setItem("kw_tpk_days", String(tDays));
    } catch {}
  }

  /* Bladnaam voorstellen: (1) het weektab dat de scraper voor deze store het
     laatst gebruikte ("Scraper W3" → W3), (2) hoogste W-nummer in de
     TPK-sheet + 1, (3) W1. Handmatig getypt = blijft staan. */
  function tSuggestTab(tabs, domain) {
    let fromScraper = "";
    try {
      const byStore = JSON.parse(orgLS.getItem("sa_org_tab_by_store") || "{}") || {};
      const last = byStore[domain] || byStore[`${domain}|org`] || "";
      const m = String(last).match(/w(?:eek)?\s*(\d+)/i);
      if (m) fromScraper = `W${Number(m[1])}`;
    } catch {}
    if (fromScraper) return fromScraper;
    const nums = (tabs || []).map((t) => {
      const m = String(t).match(/^w(?:eek)?\s*(\d+)/i);
      return m ? Number(m[1]) : null;
    }).filter((n) => n !== null);
    if (nums.length) return `W${Math.max(...nums) + 1}`;
    return "W1";
  }

  async function tLoadTabs(domain) {
    const saved = savedStores.find((s) => s.domain === domain);
    if (!saved || !saved.tpkSheetId) {
      setTTabs([]);
      return;
    }
    try {
      const d = await api("/api/sheets", { action: "tabs", sheetId: saved.tpkSheetId });
      const titles = (d.tabs || []).map((t) => t.title).filter((t) => !/^(overzicht|log)$/i.test(t));
      setTTabs(titles);
      if (!tTabTouched) setTTab(tSuggestTab(titles, domain));
    } catch {
      setTTabs([]);
      if (!tTabTouched) setTTab(tSuggestTab([], domain));
    }
  }

  function tSelectStore(domain) {
    setTStore(domain);
    setTResult(null);
    setTDoneUrl("");
    setTTabTouched(false);
    try {
      orgLS.setItem("kw_tpk_store", domain);
    } catch {}
    tLoadTabs(domain);
  }

  async function tAnalyse() {
    if (!canTpkAnalyse) return;
    setTBusy("analyse");
    setTResult(null);
    setTDoneUrl("");
    setTLogs([]);
    tRemember();
    try {
      tPush({ strong: true, text: `— TPK: ${tShop.name || tShop.domain} · ${tSource === "csv" ? "CSV" : `orders laatste ${tDays} dagen`} · ${tN} producten` });
      tPush({ key: "t-step", text: tSource === "csv" ? "Stap 1/2 · CSV lezen, keywords tellen, verdeling berekenen…" : "Stap 1/2 · Orders uit Shopify halen, keywords tellen, verdeling berekenen…" });
      const r = await api("/api/tpk", {
        action: "analyse",
        store: { name: tShop.name, domain: tShop.domain, publicDomain: tShop.publicDomain, currency: tShop.currency },
        ordersStore: tSource === "csv" ? null : tOrdersStore,
        csvText: tSource === "csv" ? tCsv : "",
        days: Number(tDays) || 30,
        n: Number(tN) || 10,
        // het blad dat stap 2 gaat schrijven: telt niet mee als "vorige week" (overschrijven = herkansing)
        tab: tTab.trim(),
      });
      setTResult(r);
      const a = r.analysis;
      const t = a.totals;
      tPush({
        ok: true,
        key: "t-step",
        text: `Stap 1/2 · ${t.orders} orders · ${t.units} stuks${t.netLabel ? ` · ${t.netLabel}` : ""} · ${t.keywords} keywords met verkoop · ${t.winners} winnaar${t.winners === 1 ? "" : "s"} (≥ 10) · ${t.eligible} met ≥ 3 ${t.measure}.`,
      });
      const top = a.scrape.map((s) => `${s.zoekterm} ${s.n}`).join(" · ");
      tPush({ text: `Verdeling (${t.planned} producten over ${t.fed} keywords${t.big != null ? ` · ${t.big} met ≥ 15% van de orders → 3` : ""}): ${top}` });
      tPush({ muted: true, text: r.weeks && r.weeks.length ? `Trend en TPK t/m nu vergeleken met: ${r.weeks.join(", ")}` : "Geen eerdere TPK-weken — trend = nieuw." });
      if (r.ignoredWeeks && r.ignoredWeeks.length) tPush({ muted: true, text: `Niet meegeteld: ${r.ignoredWeeks.join(", ")} (verwijderd blad, of het blad dat stap 2 nu overschrijft) — stap 2 haalt die regels uit Log en Overzicht.` });
      for (const w of a.warnings || []) tPush({ err: true, text: `Let op: ${w}` });
      if (tTabs.includes(tTab.trim())) tPush({ err: true, text: `Blad "${tTab.trim()}" bestaat al in de TPK-sheet — stap 2 overschrijft het (Log-regels van dat blad worden vervangen, telt niet als extra week).` });
      tPush({ text: `Klopt de verdeling? Pas eventueel het aantal aan en draai opnieuw. Anders: stap 2 schrijft blad "${tTab.trim() || "…"}" + Log + Overzicht.` });
    } catch (e) {
      tPush({ key: "t-step", err: true, text: `Mislukt: ${e.message || e}` });
      sfx("error");
    } finally {
      setTBusy("");
    }
  }

  async function tWrite() {
    if (!canTpkWrite) return;
    setTBusy("write");
    tRemember();
    try {
      tPush({ key: "t-write", text: `Stap 2/2 · Blad "${tTab.trim()}" schrijven + Log + Overzicht…` });
      const r = await api("/api/tpk", {
        action: "write",
        store: { name: tShop.name, domain: tShop.domain, publicDomain: tShop.publicDomain, currency: tShop.currency },
        tab: tTab.trim(),
        analysis: tResult.analysis,
      });
      setTDoneUrl(r.url);
      tPush({ ok: true, key: "t-write", text: `✓ Klaar: "${r.tab}"${r.replaced ? " (overschreven)" : ""} — ${r.products} producten · ${r.keywords} keywords.` });
      const lc = r.logCleaned;
      if (lc && ((lc.goneTabs && lc.goneTabs.length) || lc.ownOld)) {
        tPush({
          muted: true,
          text: `Log opgeschoond:${lc.ownOld ? ` ${lc.ownOld} oude regels van "${r.tab}" vervangen` : ""}${lc.goneTabs && lc.goneTabs.length ? `${lc.ownOld ? " ·" : ""} regels + Overzicht-rij van verwijderde bladen weg (${lc.goneTabs.join(", ")})` : ""}.`,
        });
      }
      // Scrape-ready-check: het blad is teruggelezen zoals de scraper het leest (A1:J)
      const sr = r.scrapeReady;
      if (sr && sr.ok) {
        tPush({
          ok: true,
          text: `✓ Scrape-ready: blad "${r.tab}" teruggelezen zoals de scraper (A1:J) — ${sr.keywords} keywords · ${sr.products} producten${sr.women ? ` · ${sr.women} dames` : ""}${sr.men ? ` · ${sr.men} heren` : ""}. Scraper → Verdeling inladen → store → bron TPK-sheet → tabblad "${r.tab}".`,
        });
        for (const n of sr.notes || []) tPush({ muted: true, text: `Let op: ${n}` });
      } else if (sr) {
        tPush({ err: true, text: `✗ Niet scrape-ready — de scraper leest blad "${r.tab}" anders dan bedoeld: ${(sr.issues || []).join(" · ")}` });
        for (const n of sr.notes || []) tPush({ muted: true, text: `Let op: ${n}` });
      }
      // Scraper-suggestie: dit blad als laatst gebruikte TPK-tab van deze store
      try {
        const byStore = JSON.parse(orgLS.getItem("sa_org_tab_by_store") || "{}") || {};
        byStore[`${tStore}|tpk`] = r.tab;
        orgLS.setItem("sa_org_tab_by_store", JSON.stringify(byStore));
      } catch {}
      sfx(sr && !sr.ok ? "error" : "success");
      tLoadTabs(tStore);
    } catch (e) {
      tPush({ key: "t-write", err: true, text: `Mislukt: ${e.message || e}` });
      sfx("error");
    } finally {
      setTBusy("");
    }
  }

  // TPK-sheet-tabbladen (en de bladnaam-suggestie) laden zodra de TPK-tab open is
  useEffect(() => {
    if (view === "tpk" && gStatus && tStore) tLoadTabs(tStore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, gStatus, tStore]);

  async function runUnderdog() {
    if (!canUnderdog) return;
    setURunning(true);
    setUDoneUrl("");
    setULogs([]);
    // Regels met dezelfde key vervangen elkaar: de stap-voortgang blijft
    // één levende regel i.p.v. een stapel.
    const push = (e) =>
      setULogs((l) => {
        if (e.key) {
          const i = l.findIndex((x) => x.key === e.key);
          if (i >= 0) {
            const copy = [...l];
            copy[i] = e;
            return copy;
          }
        }
        return [...l, e];
      });
    try {
      orgLS.setItem("kw_u_orgtab", uOrgTab.trim());
      orgLS.setItem("kw_u_statstab", uStatsTab.trim());
      orgLS.setItem("kw_u_statssheet", uStatsSheet.trim());
      orgLS.setItem("kw_store", vStore.trim());
      orgLS.setItem("kw_market", vMarket);
    } catch {}
    try {
      push({
        strong: true,
        text: `— Underdog-run: ${vStore.trim() || "store ?"} · markt ${vMarket} · ${orderedMonths.join(", ")} · doel ${uProducts} producten (AI bepaalt het aantal keywords)`,
      });

      /* De run is opgeknipt in korte server-stappen die hier na elkaar worden
         aangeroepen — elke stap blijft ruim onder de Vercel-tijdslimiet,
         dus een HTTP 504 kan niet meer. Bonus: je ziet de voortgang live. */
      const budget = Math.max(20, Math.min(900, Number(uProducts) || 250));

      setUPhase("Stap 1/4 · sheets inlezen + algoritme");
      push({ text: "Stap 1/4 · Sheets inlezen en underdog-algoritme draaien (volume × trend × concurrentie × long-tail)…", key: "u-step" });
      const prep = await api("/api/keywords-underdog", {
        action: "prep",
        orgSheetId: uOrgSheet.trim(),
        orgTab: uOrgTab.trim(),
        statsSheetId: uStatsSheet.trim(),
        statsTab: uStatsTab.trim(),
        months: orderedMonths,
        genders: vGenders,
        market: vMarket,
        storeUrl: vStore.trim(),
        productTarget: budget,
      });
      if (prep.stats) {
        push({
          text: `Trechter: ${prep.stats.statsRows} keywords → ${prep.stats.kandidaten} kandidaten → ${prep.stats.naDedupe} uniek → ${prep.stats.poolNaarAi} naar de AI-review · familie van bestaande keywords geweerd: ${prep.stats.family} · seizoen ${prep.stats.seizoen}${prep.stats.compData ? " · concurrentie/bid/trend-data gebruikt" : ""}`,
        });
      }
      const aiRemovedAll = [];
      let pool = prep.pool || [];

      /* Stap 2: onbekende woorden — merk-risico's die de woordenlijst niet
         kent. In stukken van 50 (één snelle AI-call per verzoek) en per stuk
         een herkansing: één mislukte call kost hooguit zijn eigen 50
         verdachten, nooit meer de hele lijst van 118 zoals eerst. */
      if ((prep.suspects || []).length) {
        const S_CHUNK = 50;
        const total = prep.suspects.length;
        let weggefilterd = 0;
        for (let i = 0; i < total; i += S_CHUNK) {
          const part = prep.suspects.slice(i, i + S_CHUNK);
          setUPhase(`Stap 2/4 · merk-check ${Math.min(i + S_CHUNK, total)}/${total}`);
          push({ text: `Stap 2/4 · Merk-check ${Math.min(i + S_CHUNK, total)}/${total} verdachte keywords…`, key: "u-step" });
          let removals = null;
          for (let attempt = 0; attempt < 2 && !removals; attempt++) {
            try {
              const sv = await api("/api/keywords-underdog", { action: "sieve", suspects: part });
              removals = sv.removals || [];
            } catch {}
          }
          if (removals) {
            const drop = new Set(removals.map((v) => v.kw));
            for (const v of removals) aiRemovedAll.push(`${v.kw} (${v.reason})`);
            weggefilterd += drop.size;
            pool = pool.filter((c) => !drop.has(c.kw));
          } else {
            // Twee keer mislukt → alleen dít stuk uit voorzorg weren
            const sus = new Set(part.map((s) => s.kw));
            pool = pool.filter((c) => !sus.has(c.kw));
            weggefilterd += sus.size;
            push({ err: true, text: `Merk-check van ${sus.size} keywords bleef falen — dat stuk uit voorzorg geweerd; de run gaat door.` });
          }
        }
        push({ text: `Stap 2/4 · Merk-check klaar — ${weggefilterd} keywords geweerd, ${pool.length} over.`, key: "u-step" });
      } else {
        setUPhase("Stap 2/4 · merk-check overgeslagen");
        push({ text: "Stap 2/4 · Geen onbekende woorden in de pool — merk-check overgeslagen.", key: "u-step" });
      }

      /* Stap 3: AI-review in stukken — kiest de keepers en schrijft per
         keyword de scraper-uitleg. 25 per call: bij 60 duurde één Sonnet-call
         (uitleg-zinnen!) langer dan Vercel's 60s-venster → HTTP 504 midden in
         de review. 25 items ≈ 15-35s, ruim binnen de limiet. Mislukt een
         stuk twee keer, dan vallen alleen díe kandidaten af en loopt de run
         gewoon door. */
      const CHUNK = 25;
      const reviewOpts = {
        market: vMarket,
        months: orderedMonths,
        seasons: prep.windowSeasons || [],
        storeUrl: vStore.trim(),
        existing: Object.entries(prep.colProducts || {}).map(([col, products]) => ({ col, products })),
      };
      const pickedMap = new Map();
      let nietBeoordeeld = 0;
      for (let i = 0; i < pool.length; i += CHUNK) {
        const part = pool.slice(i, i + CHUNK);
        setUPhase(`Stap 3/4 · AI-review ${Math.min(i + CHUNK, pool.length)}/${pool.length}`);
        push({
          text: `Stap 3/4 · AI-review ${Math.min(i + CHUNK, pool.length)}/${pool.length} kandidaten…`,
          key: "u-step",
        });
        let rv = null;
        for (let attempt = 0; attempt < 2 && !rv; attempt++) {
          try {
            rv = await api("/api/keywords-underdog", {
              action: "review",
              items: part.map((c) => ({ kw: c.kw, col: c.col, windowVol: c.windowVol, avg: c.avg, compIdx: c.compIdx, growthPct: c.growthPct })),
              opts: reviewOpts,
            });
          } catch {}
        }
        if (!rv) {
          nietBeoordeeld += part.length;
          push({ err: true, text: `Review van ${part.length} kandidaten bleef falen — dat stuk overgeslagen; de run gaat door.` });
          continue;
        }
        for (const d of rv.drop || []) aiRemovedAll.push(`${d.kw} (${d.reason})`);
        for (const p of rv.picks || []) {
          const col = prep.colProducts && prep.colProducts[p.collection] != null ? p.collection : null;
          pickedMap.set(p.kw, { uitleg: p.uitleg || "", col });
        }
      }
      if (nietBeoordeeld) {
        push({ err: true, text: `Let op: ${nietBeoordeeld} kandidaten zijn niet beoordeeld door herhaalde fouten — de rest van de run is gewoon doorgegaan.` });
      }
      const picks = pool
        .filter((c) => pickedMap.has(c.kw))
        .map((c) => ({ ...c, col: pickedMap.get(c.kw).col || c.col, uitleg: pickedMap.get(c.kw).uitleg }));

      // Stap 4: budget vullen (collectie-plafond ~20%) en wegschrijven
      setUPhase("Stap 4/4 · wegschrijven");
      push({ text: `Stap 4/4 · ${picks.length} goedgekeurde underdogs — budget van ${budget} producten vullen en wegschrijven…`, key: "u-step" });
      const r = await api("/api/keywords-underdog", {
        action: "write",
        orgSheetId: uOrgSheet.trim(),
        orgTab: uOrgTab.trim(),
        productTarget: budget,
        picks,
      });
      r.aiRemoved = aiRemovedAll;
      r.stats = null;
      r.warnings = [...(prep.warnings || []), ...(r.warnings || [])];
      push({
        ok: true,
        text: `✓ ${r.totalUnderdogProducts} producten · ${r.added} keywords · ${(r.collections || []).length} collecties — onderaan "${uOrgTab.trim()}"`,
        key: "u-step",
      });
      push({ text: `Elk keyword staat er met Type "Underdog" en zijn uitleg in kolom J; het overzicht per collectie + de uitleg voor scraper en importer staan ernaast in K–N.` });
      {
        const cols6 = (r.collections || []).slice(0, 6).map((c) => `${c.col} ${c.products}p`).join(" · ");
        if (cols6) push({ text: `Spreiding (max ~20% per collectie): ${cols6}${(r.collections || []).length > 6 ? " · …" : ""}` });
      }
      if (r.aiRemoved && r.aiRemoved.length) {
        push({ text: `AI-review schrapte ${r.aiRemoved.length} keywords, o.a. ${r.aiRemoved.slice(0, 6).join(", ")}${r.aiRemoved.length > 6 ? " …" : ""}` });
      }
      for (const w of r.warnings || []) push({ err: true, text: `Let op: ${w}` });
      setUDoneUrl(r.url);
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes("504")) {
        push({
          err: true,
          text: "Time-out (HTTP 504): de server kapte de run af. Controleer of de nieuwste versie live staat (het log hoort \"doel … producten\" te zeggen, niet \"keywords\") en ververs de pagina hard met Ctrl+Shift+R. Check daarna of er géén half UNDERDOG-blok onderaan het organization-tabblad staat voordat je opnieuw draait.",
        });
      } else {
        push({ err: true, text: msg });
      }
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setURunning(false);
      setUPhase("");
    }
  }

  /* ---------- render ---------- */

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Keyword Planner → nette sheet" />
      <div className="page">
        {/* -------- Tool-tabbladen -------- */}
        <div className="srctabs" style={{ marginBottom: 14 }}>
          <button className={"srctab" + (view === "run" ? " on" : "")} onClick={() => setView("run")}>
            Keyword-batches & verdeling
          </button>
          <button className={"srctab" + (view === "underdog" ? " on" : "")} onClick={() => setView("underdog")}>
            Underdog keywords
          </button>
          <button className={"srctab" + (view === "geheugen" ? " on" : "")} onClick={() => { setView("geheugen"); loadMemStatus(); loadGeheugen(); }}>
            Geheugen
          </button>
          <button className={"srctab" + (view === "tpk" ? " on" : "")} onClick={() => { setView("tpk"); loadGeheugen(); }}>
            TPK
          </button>
        </div>

        {/* -------- Tabblad 2: Underdog keywords -------- */}
        {/* -------- Tabblad 3: Geheugen — All keywords per markt, store-geheugen, batch-geheugen -------- */}
        {view === "geheugen" && (() => {
          const fmtN = (n) => Number(n || 0).toLocaleString("nl-NL");
          const allRows = (gStatus && gStatus.all) || [];
          const filled = allRows.reduce((s, r) => s + (r.V ? 1 : 0) + (r.M ? 1 : 0), 0);
          const marketsDone = allRows.filter((r) => r.V && r.M).length;
          const snapCount = savedStores.filter((s) => s.snapshot).length;
          const curMeta = curAll ? curAll[allGender] : null;
          const GLABEL = { MV: "man + vrouw", V: "alleen dames", M: "alleen heren" };
          return (
          <div className="gh">
            {/* ---- de keten in één oogopslag ---- */}
            <div className="gh-steps">
              <div className={"gh-step" + (marketsDone ? " done" : "")}>
                <div className="gh-step-n">{marketsDone ? "✓" : "1"}</div>
                <div>
                  <div className="gh-step-t">All keywords</div>
                  <div className="gh-step-s">{filled}/8 vakken · {marketsDone} markt{marketsDone === 1 ? "" : "en"} compleet</div>
                </div>
              </div>
              <div className={"gh-step" + (snapCount ? " done" : "")}>
                <div className="gh-step-n">{snapCount ? "✓" : "2"}</div>
                <div>
                  <div className="gh-step-t">Store-geheugen</div>
                  <div className="gh-step-s">{snapCount}/{shopStores.length || 0} stores bijgewerkt</div>
                </div>
              </div>
              <div className="gh-step">
                <div className="gh-step-n">3</div>
                <div>
                  <div className="gh-step-t">Weekplanning</div>
                  <div className="gh-step-s">week-tabs in de aanvul-sheet</div>
                </div>
              </div>
              <div className="gh-step">
                <div className="gh-step-n">4</div>
                <div>
                  <div className="gh-step-t">Scraper → Importer</div>
                  <div className="gh-step-s">aanvul-sheet of TPK-sheet + weektab kiezen</div>
                </div>
              </div>
            </div>

            <div className="gh-main">
              <div className="gh-col">
                {/* ---- 1 · All keywords per markt ---- */}
                <div className="card">
                  <h2>
                    1 · All keywords per markt{" "}
                    <span className="opt">man en vrouw apart · klik een vak{org === "sacollective" ? " · gedeeld met ATTOH COMMERCE LTD (zelfde All batch-sheets)" : ""}</span>
                  </h2>
                  <div className="gh-matrix">
                    <div className="gh-mh" />
                    <div className="gh-mh">Vrouw</div>
                    <div className="gh-mh">Man</div>
                    <div className="gh-mh gh-mh-link">Sheet</div>
                    {MARKET_SEG.map(([m, label]) => {
                      const row = allRows.find((x) => x.market === m) || {};
                      return (
                        <React.Fragment key={m}>
                          <div className="gh-mk">{label}</div>
                          {["V", "M"].map((g) => {
                            const meta = row[g];
                            const on = allMarket === m && allGender === g;
                            const state = meta ? (meta.stale || meta.forced ? " stale" : " ok") : " empty";
                            return (
                              <button
                                key={g}
                                type="button"
                                className={"gh-tile" + state + (on ? " on" : "")}
                                onClick={() => {
                                  setAllMarket(m);
                                  setAllGender(g);
                                  setAllNeedsForce(null);
                                }}
                              >
                                {meta ? (
                                  <>
                                    <span className="gh-tile-big">✓ {fmtN(meta.rows)} keywords</span>
                                    <span className="gh-tile-sub">
                                      {(meta.months || [])[0]} – {(meta.months || []).slice(-1)[0]} · {meta.ageDays} d
                                      {meta.stale ? " · verversen" : ""}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="gh-tile-big">{gStatus === null ? "…" : "Leeg"}</span>
                                    <span className="gh-tile-sub">klik om te vullen</span>
                                  </>
                                )}
                              </button>
                            );
                          })}
                          <div className="gh-mlink">
                            {row.sheetUrl ? (
                              <a className="linklike" href={row.sheetUrl} target="_blank" rel="noreferrer noopener">
                                Openen ↗
                              </a>
                            ) : (
                              <span className="muted small">—</span>
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {/* actiepaneel voor het gekozen vak */}
                  <div className="gh-panel">
                    <div className="gh-panel-head">
                      <strong>
                        ALL {allMarket} {gWord}
                      </strong>
                      {curMeta ? (
                        <span className="muted small">
                          nu: {fmtN(curMeta.rows)} keywords uit {curMeta.source === "link" ? `"${curMeta.tab}"` : `${(curMeta.files || []).length} CSV's`} ·
                          een nieuwe batch vervangt deze ·{" "}
                          <a className="linklike" href={curMeta.url} target="_blank" rel="noreferrer noopener">
                            tab openen ↗
                          </a>
                        </span>
                      ) : (
                        <span className="muted small">nog leeg</span>
                      )}
                    </div>
                    <div className="gh-panel-grid">
                      <div>
                        <div className="gh-sub">A · CSV's slepen</div>
                        <div
                          className={"gh-drop" + (allDrag ? " over" : "")}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setAllDrag(true);
                          }}
                          onDragLeave={() => setAllDrag(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setAllDrag(false);
                            addAllFiles(e.dataTransfer.files);
                          }}
                          onClick={() => allFileInput.current && allFileInput.current.click()}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13 }}>Sleep de {gWord}-CSV's hierheen</div>
                          <div className="muted small">of klik · 1–10 Keyword Planner-exports</div>
                        </div>
                        <input
                          ref={allFileInput}
                          type="file"
                          accept=".csv"
                          multiple
                          style={{ display: "none" }}
                          onChange={(e) => {
                            addAllFiles(e.target.files);
                            e.target.value = "";
                          }}
                        />
                        {allFiles.length > 0 && (
                          <div className="gh-files">
                            {allFiles.map((f, i) => (
                              <div className="log" key={f.name + i}>
                                {f.error ? (
                                  <span className="err" style={{ flex: 1 }}>✗ {f.name} — {f.error}</span>
                                ) : (
                                  <>
                                    <span className="ok">✓</span>
                                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                                    <span className="muted small">{fmtN(f.rows.length)}</span>
                                  </>
                                )}
                                <button className="kw-x" onClick={() => setAllFiles((l) => l.filter((_, j) => j !== i))}>×</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="gh-row">
                          <button
                            className="btn gh-btn"
                            onClick={() => allRunCsv(false)}
                            disabled={!!allBusy || !allFiles.some((f) => f.rows) || !(curAll && curAll.sheetUrl)}
                          >
                            {allBusy === "csv" ? "Bezig…" : `⌕ Samenvoegen (${allFiles.filter((f) => f.rows).length})`}
                          </button>
                          {!(curAll && curAll.sheetUrl) && <span className="muted small">koppel eerst de sheet hieronder</span>}
                        </div>
                      </div>
                      <div>
                        <div className="gh-sub">B · Bestaand tabblad koppelen</div>
                        <input
                          type="text"
                          placeholder="Link van de sheet met de batch"
                          value={allLinkSheet}
                          onChange={(e) => setAllLinkSheet(e.target.value)}
                        />
                        <input
                          type="text"
                          style={{ marginTop: 8 }}
                          placeholder={`Exacte bladnaam, bv. SHAPES WARDROBE - 02/10 - ${gWord}`}
                          value={allLinkTab}
                          onChange={(e) => setAllLinkTab(e.target.value)}
                        />
                        <div className="gh-row">
                          <button
                            className="btn-ghost gh-btn"
                            onClick={() => allRunLink(false)}
                            disabled={!!allBusy || !allLinkSheet.trim() || !allLinkTab.trim()}
                          >
                            {allBusy === "link" ? "Controleren…" : "⌕ Koppelen"}
                          </button>
                          <span className="muted small">tabblad blijft waar het staat</span>
                        </div>
                      </div>
                    </div>

                    {allNeedsForce && (
                      <div className="gh-warn">
                        <strong>Controle niet geslaagd — niets opgeslagen.</strong>
                        <div style={{ marginTop: 4 }}>
                          {allNeedsForce.season && allNeedsForce.season.text}
                          <br />
                          {allNeedsForce.genderChk && allNeedsForce.genderChk.text}
                        </div>
                        <button
                          className="btn-ghost btn-small"
                          style={{ marginTop: 8 }}
                          disabled={!!allBusy}
                          onClick={() => (allNeedsForce.kind === "link" ? allRunLink(true) : allRunCsv(true))}
                        >
                          Toch opslaan — markt en vak kloppen
                        </button>
                      </div>
                    )}

                    <div className="gh-sheetline">
                      <span className="gh-sub">All keywords-sheet {allMarket}</span>
                      <input
                        type="text"
                        placeholder="Lege Google Sheet, gedeeld met attoh-sheets@attoh-tools.iam.gserviceaccount.com"
                        value={allSheetInput}
                        onChange={(e) => setAllSheetInput(e.target.value)}
                      />
                      <button className="btn-ghost btn-small" onClick={allSaveSheet} disabled={!!allBusy || !allSheetInput.trim()}>
                        {allBusy === "sheet" ? "Koppelen…" : curAll && curAll.sheetUrl ? "Bijwerken" : "Koppelen"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ---- 2 · Store-geheugen ---- */}
                <div className="card">
                  <h2>
                    2 · Store-geheugen <span className="opt">aanvul-sheet per store · klik een store{org === "sacollective" ? " · eigen geheugen van Sa Collective" : ""}</span>
                  </h2>
                  {shopStores.length === 0 ? (
                    <div className="hint">Nog geen stores gevonden — voeg ze eerst toe in de Importer (zelfde lijst).</div>
                  ) : (
                    <div className="gh-table">
                      <div className="gh-tr gh-th">
                        <div>Store</div>
                        <div>Markt</div>
                        <div>Geslacht</div>
                        <div>Aanvul-sheet</div>
                        <div>Laatste snapshot</div>
                      </div>
                      {shopStores.map((s) => {
                        const saved = savedStores.find((x) => x.domain === s.domain);
                        const snap = saved && saved.snapshot;
                        return (
                          <div key={s.domain} className={"gh-tr" + (stSel === s.domain ? " on" : "")} onClick={() => stSelect(s.domain)}>
                            <div className="gh-ellip">
                              <strong style={{ color: "var(--ink)" }}>{s.name || s.domain}</strong>
                              {s.publicDomain ? <span className="muted small"> · {s.publicDomain}</span> : null}
                            </div>
                            <div>{(saved && saved.market) || <span className="muted">—</span>}</div>
                            <div>{saved ? GLABEL[saved.genders] || saved.genders : <span className="muted">—</span>}</div>
                            <div>
                              {saved && saved.aanvulUrl ? (
                                <a className="linklike" href={saved.aanvulUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                                  Openen ↗
                                </a>
                              ) : (
                                <span className="muted small">niet gekoppeld</span>
                              )}
                              {saved && saved.importUrl ? (
                                <a className="linklike" style={{ marginLeft: 8 }} href={saved.importUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                                  import-lijst ↗
                                </a>
                              ) : null}
                              {saved && saved.tpkUrl ? (
                                <a className="linklike" style={{ marginLeft: 8 }} href={saved.tpkUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                                  TPK ↗
                                </a>
                              ) : null}
                            </div>
                            <div>
                              {snap ? (
                                <span>
                                  <span style={{ color: "var(--ok)" }}>✓</span> {String(snap.at).slice(5, 10).split("-").reverse().join("-")} · {fmtN(snap.products)} prod.
                                </span>
                              ) : (
                                <span className="muted small">nog niet</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {stStore && (
                    <div className="gh-panel">
                      <div className="gh-panel-head">
                        <strong>{stStore.name || stStore.domain}</strong>
                        {stSaved && stSaved.snapshot ? (
                          <span className="muted small">
                            vrouw {fmtN(stSaved.snapshot.vrouw.keywords)} keywords · man {fmtN(stSaved.snapshot.man.keywords)} keywords ·{" "}
                            {stSaved.snapshot.collections} collecties ·{" "}
                            {stSaved.snapshot.origRows ? `origineel ${fmtN(stSaved.snapshot.origRows)} keywords` : "zonder origineel"}
                          </span>
                        ) : (
                          <span className="muted small">nog geen snapshot</span>
                        )}
                      </div>
                      <div className="gh-form">
                        <div>
                          <div className="gh-sub">Markt</div>
                          <div className="seg">
                            {MARKET_SEG.map(([val, label]) => (
                              <button key={val} className={stForm.market === val ? "on" : ""} onClick={() => setStForm((f) => ({ ...f, market: val }))} type="button">
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="gh-sub">Geslacht store</div>
                          <div className="seg">
                            {[["MV", "Man + vrouw"], ["V", "Dames"], ["M", "Heren"]].map(([val, label]) => (
                              <button key={val} className={stForm.genders === val ? "on" : ""} onClick={() => setStForm((f) => ({ ...f, genders: val }))} type="button">
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="gh-span2">
                          <div className="gh-sub">Organization / aanvul-sheet <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(één sheet met weken, Plan en Collecties (import) is genoeg)</span></div>
                          <input
                            type="text"
                            placeholder="Lege Google Sheet, gedeeld met attoh-sheets@attoh-tools.iam.gserviceaccount.com"
                            value={stForm.aanvul}
                            onChange={(e) => setStForm((f) => ({ ...f, aanvul: e.target.value }))}
                          />
                        </div>
                        <div>
                          <div className="gh-sub">Aparte organization-sheet <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optioneel)</span></div>
                          <input
                            type="text"
                            placeholder="Leeg = zelfde sheet als hierboven"
                            value={stForm.orgSheet}
                            onChange={(e) => setStForm((f) => ({ ...f, orgSheet: e.target.value }))}
                          />
                        </div>
                        <div>
                          <div className="gh-sub">Bladnaam <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(leeg = automatisch)</span></div>
                          <input
                            type="text"
                            placeholder="Leeg = Collecties (import) → Plan"
                            value={stForm.orgTab}
                            onChange={(e) => setStForm((f) => ({ ...f, orgTab: e.target.value }))}
                          />
                        </div>
                        <div>
                          <div className="gh-sub">TPK-sheet <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(top performing keywords — één per store, blad per week)</span></div>
                          <input
                            type="text"
                            placeholder="Google Sheet, gedeeld met de service account — Keywords → TPK schrijft hierin"
                            value={stForm.tpk}
                            onChange={(e) => setStForm((f) => ({ ...f, tpk: e.target.value }))}
                          />
                        </div>
                        <div className="gh-span2">
                          <div className="gh-sub">Import-lijst sheet <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(scraper — hier komen de gescrapete producten in; de scraper vult hem in zodra je deze store kiest)</span></div>
                          <input
                            type="text"
                            placeholder="Google Sheet van de import-lijst, gedeeld met attoh-sheets@attoh-tools.iam.gserviceaccount.com — leeg = geen"
                            value={stForm.importSheet}
                            onChange={(e) => setStForm((f) => ({ ...f, importSheet: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="gh-row" style={{ marginTop: 14 }}>
                        <button className="btn gh-btn" onClick={stSnapshot} disabled={!!stBusy || !stForm.aanvul.trim() || !stForm.market}>
                          {stBusy === "snap" ? "Shopify uitlezen…" : "⟳ Store-geheugen bijwerken"}
                        </button>
                        <button className="btn-ghost gh-btn" onClick={stSaveClick} disabled={!!stBusy || !stForm.aanvul.trim()}>
                          {stBusy === "save" ? "Opslaan…" : "Alleen opslaan"}
                        </button>
                        <span className="muted small">schrijft ORG VROUW · ORG MAN · STORE COLLECTIES · INFO in dezelfde sheet — jouw eigen tabbladen blijven onaangeroerd</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ---- Batch-geheugen importer (bestond al) — ingeklapt ---- */}
                <details className="card gh-details">
                  <summary>
                    <h2>
                      Batch-geheugen importer <span className="opt">MEM/TOP per markt · booming zoektermen · klik om te openen</span>
                    </h2>
                  </summary>
                  <div className="hint" style={{ marginTop: 0, marginBottom: 6 }}>
                    Elke stap 1-run wordt hier per markt samengevoegd; de importer haalt er de booming zoektermen
                    van de komende 4 maanden uit. Werkt zoals altijd.
                  </div>
                  <div className="gh-memgrid">
                    {(memStatus || []).map((row) => (
                      <div key={row.market} className="gh-memcell">
                        <div className="gh-sub" style={{ marginBottom: 4 }}>{row.market}</div>
                        <div className="muted small" style={{ marginBottom: 8 }}>
                          {row.meta
                            ? `${fmtN(row.meta.rows)} keywords · ${String(row.meta.updatedAt || "").slice(0, 10)} · venster ${row.meta.window || "-"}`
                            : "nog leeg"}
                        </div>
                        <div className="gh-row" style={{ marginTop: 0 }}>
                          <input
                            type="text"
                            placeholder={`Sheet-link ${row.market}-geheugen`}
                            value={memLinks[row.market] || ""}
                            onChange={(e) => setMemLinks((l) => ({ ...l, [row.market]: e.target.value }))}
                          />
                          <button className="btn-ghost btn-small" onClick={() => memSaveLink(row.market)} disabled={!!memBusy || !(memLinks[row.market] || "").trim()}>
                            {memBusy === row.market + ":save" ? "…" : row.sheetUrl ? "Bijwerken" : "Koppelen"}
                          </button>
                        </div>
                        <div className="gh-row">
                          <button className="btn-ghost btn-small" onClick={() => memMake(row.market)} disabled={!!memBusy || !row.sheetUrl || !row.meta}>
                            {memBusy === row.market + ":make" ? "Bezig…" : "⚡ All-batch-tab"}
                          </button>
                          <button className="btn-ghost btn-small" onClick={() => memUseAsSource(row.market)} disabled={!!memBusy || !row.sheetUrl || !row.meta}>
                            → Als bron
                          </button>
                          {row.sheetUrl && (
                            <a className="linklike" href={row.sheetUrl} target="_blank" rel="noreferrer noopener">
                              Openen ↗
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                    {memStatus === null && <div className="hint">Status laden…</div>}
                  </div>
                </details>
              </div>

              {/* ---- log ---- */}
              <div className="gh-side">
                <div className="card">
                  <h2>
                    Log {(allBusy || stBusy) && <span className="opt">bezig…</span>}
                    {gLogs.length > 0 && !allBusy && !stBusy && (
                      <button className="linklike" style={{ marginLeft: "auto" }} onClick={() => setGLogs([])}>
                        wissen
                      </button>
                    )}
                  </h2>
                  {gLogs.length === 0 ? (
                    <div className="muted small">Elke stap laat hier zien wat hij doet en wat hij controleert.</div>
                  ) : (
                    <div className="logpanel">
                      {gLogs.map((l, i) => (
                        <div className="log" key={i}>
                          {l.ok ? <span className="ok">✓</span> : l.err ? <span className="err">✗</span> : null}
                          <span style={{ flex: 1, fontWeight: l.strong ? 600 : 400, opacity: l.muted ? 0.7 : 1 }}>
                            {l.text}
                            {l.href ? (
                              <>
                                {" · "}
                                <a className="linklike" href={l.href} target="_blank" rel="noreferrer noopener">
                                  openen ↗
                                </a>
                              </>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {view === "tpk" && (() => {
          const a = tResult && tResult.analysis;
          const pct = (x) => `${Math.round((x || 0) * 100)}%`;
          const GL = { MV: "dames + heren", V: "dames", M: "heren" };
          return (
          <div className="layout-scraper">
            <div>
              <div className="card">
                <h2>TPK <span className="opt">(top performing keywords — wat verkoopt, krijgt er producten bij)</span></h2>
                <div className="hint" style={{ marginBottom: 12 }}>
                  Elke week per store: orders van de laatste 30 dagen → welke keywords verkopen → ±10 extra
                  producten bovenop de aanvul-planning. Eén TPK-sheet per store (store-geheugen), één blad per
                  week. Het blad is direct scrape-ready: Scraper → Verdeling inladen → bron <b>TPK-sheet</b>.
                </div>

                <div className="field-label">Store <span className="opt">(TPK-sheet uit het geheugen)</span></div>
                {shopStores.length === 0 ? (
                  <div className="hint">Nog geen stores gevonden — voeg ze eerst toe in de Importer.</div>
                ) : (
                  <select value={tStore} onChange={(e) => tSelectStore(e.target.value)} disabled={!!tBusy} style={{ width: "100%" }}>
                    <option value="">— kies een store —</option>
                    {shopStores.map((s) => {
                      const sv = savedStores.find((x) => x.domain === s.domain);
                      return (
                        <option key={s.domain} value={s.domain}>
                          {s.name || s.domain}
                          {sv && sv.market ? ` · ${sv.market}` : ""}
                          {sv && sv.tpkSheetId ? "" : " · (geen TPK-sheet)"}
                        </option>
                      );
                    })}
                  </select>
                )}
                {tStore && tSaved && !tSaved.tpkSheetId && (
                  <div className="hint" style={{ color: "var(--warn)" }}>
                    Deze store heeft nog geen TPK-sheet: Geheugen → 2 · Store-geheugen → store aanklikken → veld "TPK-sheet" → Alleen opslaan.
                  </div>
                )}
                {tStore && tSaved && tSaved.tpkSheetId && (
                  <div className="hint">
                    <a className="linklike" href={tSaved.tpkUrl} target="_blank" rel="noreferrer noopener">TPK-sheet openen ↗</a>
                    {" · "}{GL[tSaved.genders] || tSaved.genders}
                    {tTabs.length ? ` · bladen: ${tTabs.join(", ")}` : " · nog geen weekbladen"}
                    {tSaved.snapshot ? "" : " · let op: nog geen store-snapshot (collecties blijven leeg)"}
                  </div>
                )}

                <div className="field-label">Data</div>
                <div className="seg">
                  {[["shopify", "Orders uit Shopify"], ["csv", "CSV plakken"]].map(([val, label]) => (
                    <button key={val} className={tSource === val ? "on" : ""} onClick={() => setTSource(val)} type="button">
                      {label}
                    </button>
                  ))}
                </div>
                {tSource === "shopify" ? (
                  <>
                    <div className="hint">
                      {tStore && !tOrdersStore
                        ? "Geen Orders-app-sleutels en geen Importer-koppeling voor deze store — koppel de store in de Importer (app met read_orders), of plak de CSV."
                        : tOrdersStore && tOrdersStore.via === "importer"
                          ? "Leest de orders via de Importer-koppeling van de store (de app moet read_orders hebben). Geannuleerde en test-orders tellen niet mee."
                          : "Leest de orders via de Orders-app van de store (zelfde sleutels als de Bills-pagina). Geannuleerde en test-orders tellen niet mee."}
                    </div>
                    <div className="field-label">Periode <span className="opt">(dagen terug)</span></div>
                    <input type="number" style={{ width: 110 }} min={7} max={120} value={tDays} onChange={(e) => setTDays(e.target.value)} />
                  </>
                ) : (
                  <>
                    <div className="field-label">Shopify → Analytics → Rapporten → "Verkopen per product" → laatste 30 dagen → Exporteren (CSV) — plak de inhoud hier</div>
                    <textarea
                      rows={6}
                      placeholder={"Product title,Orders,Net items sold,Net sales,…\nPlaid Oversized Button-Down Flannel Shirt | …,41,41,1842.50,…"}
                      value={tCsv}
                      onChange={(e) => setTCsv(e.target.value)}
                      style={{ width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    />
                  </>
                )}

                <div className="field-label">Aantal producten deze week</div>
                <input type="number" style={{ width: 110 }} min={1} max={60} value={tN} onChange={(e) => setTN(e.target.value)} />
                <div className="hint">
                  Regels (bewezen verkoop): alleen keywords met ≥ 3 orders, op volgorde van orders · ≥ 15% van alle orders → 3 producten, de rest 1 · tot het aantal vol is (blijft er over: van boven af bijplussen tot max 3).
                  Koptermen (jeans, shoe, top …) krijgen een verfijnde zoekterm op het best verkopende product: max 3 woorden, kopterm achteraan.
                  Na stap 2 wordt het blad teruggelezen zoals de scraper het leest en gecheckt (scrape-ready).
                </div>

                <div style={{ marginTop: 12 }}>
                  <button className="btn" onClick={tAnalyse} disabled={!canTpkAnalyse}>
                    {tBusy === "analyse" ? "Bezig…" : "1 · Analyseren"}
                  </button>
                </div>

                <div className="field-label" style={{ marginTop: 18 }}>
                  Naam van het weekblad <span className="opt">(voorstel volgt de scraper: zelfde W-nummer als de aanvul-week)</span>
                </div>
                <input
                  type="text"
                  placeholder="bv. W2"
                  value={tTab}
                  onChange={(e) => {
                    setTTab(e.target.value);
                    setTTabTouched(true);
                  }}
                />
                {tTabs.includes(tTab.trim()) && <div className="hint" style={{ color: "var(--warn)" }}>Bestaat al — stap 2 overschrijft dit blad.</div>}
                <div style={{ marginTop: 12 }}>
                  <button className="btn" onClick={tWrite} disabled={!canTpkWrite}>
                    {tBusy === "write" ? "Bezig…" : "2 · Schrijf naar TPK-sheet"}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <div className="card">
                <h2>
                  TPK-log
                  {tBusy && <span className="opt"> — bezig: stap {tBusy === "analyse" ? "1" : "2"}</span>}
                  {!tBusy && tDoneUrl && <span className="opt"> — klaar</span>}
                </h2>
                {tLogs.length === 0 && !tBusy && (
                  <div className="center-note" style={{ padding: "18px 8px" }}>
                    Kies een store en druk op "1 · Analyseren". Stap 1 schrijft niets; je ziet eerst de verdeling.
                  </div>
                )}
                <div className="logpanel">
                  {tLogs.map((l, i) => (
                    <div key={i} className={"logline" + (l.err ? " err" : l.ok ? " ok" : l.strong ? " strong" : l.muted ? " muted" : "")}>
                      {l.text}
                    </div>
                  ))}
                </div>
                {tDoneUrl && (
                  <div style={{ marginTop: 10 }}>
                    <a className="btn" href={tDoneUrl} target="_blank" rel="noreferrer">
                      ↗ Open het weekblad
                    </a>
                  </div>
                )}
              </div>

              {a && (
                <div className="card" style={{ marginTop: 18 }}>
                  <h2>
                    Verdeling <span className="opt">({a.totals.planned} producten · {a.totals.fed} keywords · {a.totals.measure})</span>
                  </h2>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", gap: "4px 12px", fontSize: 13, alignItems: "baseline" }}>
                    <div className="opt">#</div><div className="opt">Zoekterm · collectie</div><div className="opt">Orders</div><div className="opt">Aandeel</div><div className="opt">Aantal</div>
                    {a.scrape.map((s) => (
                      <React.Fragment key={s.key}>
                        <div>{s.rank}</div>
                        <div>
                          <strong>{s.zoekterm}</strong>
                          <span className="opt"> · {s.g === "M" ? "heren" : "dames"}{s.coll ? ` · ${s.coll}` : " · (geen collectie)"}{s.type === "Gelegenheid" ? " · gelegenheid" : ""}</span>
                          {s.keyword !== s.zoekterm.replace(/^mens /, "") && <span className="opt"> · uit "{s.keyword}"</span>}
                        </div>
                        <div style={{ textAlign: "right" }}>{s.m}</div>
                        <div style={{ textAlign: "right" }}>{pct(s.share)}</div>
                        <div style={{ textAlign: "right" }}><strong>{s.n}</strong></div>
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="hint" style={{ marginTop: 12 }}>Alle keywords met verkoop (staat vanaf kolom L in het blad):</div>
                  <div className="logpanel" style={{ maxHeight: 300, overflow: "auto" }}>
                    {a.ana.slice(0, 60).map((r) => (
                      <div key={r.key} className="logline">
                        {r.orders} {a.totals.measure === "stuks" ? "st." : "orders"} · {r.keyword} <span className="opt">— {r.g === "M" ? "heren" : "dames"} · {r.verdict} · {pct(r.share)} · {r.trend}{r.onStore != null ? ` · ${r.onStore} op store` : ""}{r.top ? ` · top: ${r.top}` : ""}</span>
                      </div>
                    ))}
                    {a.ana.length > 60 && <div className="logline muted">… en nog {a.ana.length - 60} keywords (staan allemaal in het blad)</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {view === "underdog" && (
          <div className="layout-scraper">
            <div>
              <div className="card">
                <h2>Underdog keywords <span className="opt">(niche kansen uit ALLE batch-data)</span></h2>
                <div className="hint" style={{ marginBottom: 12 }}>
                  Leest je bestaande Collection &amp; Product organization én de volledige batch-stats
                  (180k+ keywords) en kiest daaruit keywords met échte, liefst stijgende vraag maar
                  weinig concurrentie — geen varianten van wat er al staat. De selectie wordt onderaan
                  je bestaande organization-tabblad toegevoegd, gemarkeerd als "Underdog", met per
                  keyword een uitleg-zin voor de scraper (concurrenten gebruiken deze woorden vaak
                  niet letterlijk, dus de scraper moet straks op betekenis en foto matchen).
                </div>

                <div className="field-label">Collection &amp; Product organization — sheet</div>
                <input type="text" value={uOrgSheet} onChange={(e) => setUOrgSheet(e.target.value)} />
                <div className="field-label">Bladnaam van je organization-tabblad</div>
                <input
                  type="text"
                  placeholder='bv. "LGB - 16/08/2026"'
                  value={uOrgTab}
                  onChange={(e) => setUOrgTab(e.target.value)}
                />

                <div className="field-label">Alle batch-stats — sheet <span className="opt">(zelf invullen)</span></div>
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  value={uStatsSheet}
                  onChange={(e) => setUStatsSheet(e.target.value)}
                />
                <div className="field-label">Bladnaam van het stats-tabblad</div>
                <input
                  type="text"
                  placeholder='bv. "LGB alle batches"'
                  value={uStatsTab}
                  onChange={(e) => setUStatsTab(e.target.value)}
                />

                <div className="field-label">Store</div>
                <input
                  type="text"
                  placeholder="bv. ladyglamboutique.com"
                  value={vStore}
                  onChange={(e) => setVStore(e.target.value)}
                />
                <div className="field-label">Markt</div>
                <div className="seg">
                  {[["USA", "USA"], ["UK", "UK"], ["AUS", "AUS + NZ"], ["CAN", "CAN"]].map(([val, label]) => (
                    <button key={val} className={vMarket === val ? "on" : ""} onClick={() => setVMarket(val)} type="button">
                      {label}
                    </button>
                  ))}
                </div>
                <div className="field-label">Doelgroep</div>
                <div className="seg">
                  {[["V", "Vrouw"], ["M", "Man"]].map(([val, label]) => (
                    <button key={val} className={vGenders === val ? "on" : ""} onClick={() => setVGenders(val)} type="button">
                      {label}
                    </button>
                  ))}
                </div>
                <div className="field-label">
                  Maanden <span className="opt">(zelfde venster als je verdeling — {orderedMonths.length}/4)</span>
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
                <div className="field-label">Aantal underdog-producten <span className="opt">(20–900)</span></div>
                <input
                  type="number"
                  style={{ width: 110 }}
                  min={20}
                  max={900}
                  value={uProducts}
                  onChange={(e) => setUProducts(e.target.value)}
                />
                <div className="hint">
                  Jij kiest het aantal producten; de engine en de AI bepalen zelf hoeveel keywords
                  daarvoor nodig zijn (2–6 producten per keyword, sterkste underdogs eerst).
                </div>

                <div style={{ marginTop: 14 }}>
                  <button className="btn" onClick={runUnderdog} disabled={!canUnderdog}>
                    {uRunning
                      ? `Bezig… ${Math.floor(uElapsed / 60)}:${String(uElapsed % 60).padStart(2, "0")}`
                      : "⚑ Underdogs zoeken & toevoegen"}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <div className="card">
                <h2>
                  Underdog-log
                  {uRunning && (
                    <span className="opt">
                      {" "}— bezig: {uPhase || "…"} · {Math.floor(uElapsed / 60)}:
                      {String(uElapsed % 60).padStart(2, "0")}
                    </span>
                  )}
                  {!uRunning && uDoneUrl && <span className="opt"> — klaar</span>}
                </h2>
                {uLogs.length === 0 && !uRunning && (
                  <div className="center-note" style={{ padding: "18px 8px" }}>
                    Vul beide bladnamen in, kies je venster en start. De underdogs worden
                    onderaan je bestaande organization gezet — niets wordt overschreven.
                  </div>
                )}
                <div className="logpanel">
                  {uLogs.map((l, i) => (
                    <div key={i} className={"logline" + (l.err ? " err" : l.ok ? " ok" : l.strong ? " strong" : "")}>
                      {l.text}
                    </div>
                  ))}
                  {uRunning && (
                    <div className="logline muted">
                      ⏳ Nog bezig — {uPhase || "…"} ({Math.floor(uElapsed / 60)}:
                      {String(uElapsed % 60).padStart(2, "0")}). Laat dit tabblad open staan.
                    </div>
                  )}
                </div>
                {uDoneUrl && (
                  <div style={{ marginTop: 10 }}>
                    <a className="btn" href={uDoneUrl} target="_blank" rel="noreferrer">
                      ↗ Open de organization-sheet
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {view === "run" && (<>
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
                    <h2>Bestaande keyword-stats <span className="opt">(all-batch-stats-sheet)</span></h2>
                    <div className="field-label">Google Sheet-link van de stats-sheet</div>
                    <input
                      type="text"
                      placeholder="https://docs.google.com/spreadsheets/d/…"
                      value={srcSheetLink}
                      onChange={(e) => { setSrcSheetLink(e.target.value); setSrcReady(false); }}
                    />
                    <div className="field-label">Exacte bladnaam</div>
                    <input
                      type="text"
                      placeholder="bv. Keyword Stats — alle batches"
                      value={srcTab}
                      onChange={(e) => { setSrcTab(e.target.value); setSrcReady(false); }}
                      onKeyDown={(e) => { if (e.key === "Enter") useExistingTab(); }}
                    />
                    <div className="hint">
                      Plak de link van het bestand waar de stats al in staan en typ de bladnaam precies
                      zoals hij onderaan in Google Sheets staat. Hij controleert de kolommen
                      (Keyword · Avg. monthly search · maanden) en gebruikt het tabblad daarna direct
                      voor de merken-check en de verdeling — samenvoegen en uploaden slaat hij over.
                      De sheet moet gedeeld zijn met attoh-sheets@attoh-tools.iam.gserviceaccount.com.
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="btn"
                        onClick={useExistingTab}
                        disabled={srcBusy || !srcTab.trim() || !srcSheetLink.trim()}
                      >
                        {srcBusy ? "Controleren…" : srcReady ? "✓ Tabblad in gebruik" : "⌕ Tabblad inlezen"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                <h2>CSV-bestanden <span className="opt">(1–10, uit Keyword Planner)</span></h2>
                <div className="field-label">Markt van deze batches <span className="opt">(verplicht — bepaalt het geheugen)</span></div>
                <div className="seg">
                  {[["USA", "USA"], ["UK", "UK"], ["AUS", "AUS + NZ"], ["CAN", "CAN"]].map(([val, label]) => (
                    <button key={val} className={srcMarket === val ? "on" : ""} onClick={() => setSrcMarket(val)} type="button">
                      {label}
                    </button>
                  ))}
                </div>
                {!srcMarket && (
                  <div className="hint">Kies eerst de markt — elke batch wordt per markt onthouden, en de verdeling controleert hier later hard op.</div>
                )}
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

            {/* In "Bestaand tabblad"-modus staan link + bladnaam al in het blok
                hierboven; dit kaartje zou dan alleen verwarren ("Doel-sheet"?). */}
            {!(activeId === null && srcMode === "sheet") && (
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
                {activeId !== null ? "Tabblad" : "Naam nieuw tabblad"}
              </div>
              <input
                type="text"
                placeholder="bv. UK 4 augustus"
                value={tabName}
                onChange={(e) => {
                  setTabName(e.target.value);
                  if (activeId === null) setCleanTab(e.target.value);
                }}
                disabled={activeId !== null}
              />
              {activeId === null ? (
                <div className="hint">
                  Elke run maakt een nieuw tabblad — niets wordt overschreven.
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
            )}

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
                  {[
                    ["USA", "USA"],
                    ["UK", "UK"],
                    ["AUS", "AUS + NZ"],
                    ["CAN", "CAN"],
                  ].map(([val, label]) => (
                    <button key={val} className={vMarket === val ? "on" : ""} onClick={() => setVMarket(val)} type="button">
                      {label}
                    </button>
                  ))}
                </div>
                <div className="hint">
                  De markt stuurt nu de hele verdeling, niet alleen de taalcontrole. Het halfrond
                  bepaalt welk seizoen je gekozen maanden zijn — sep t/m dec is lente-zomer in
                  AUS + NZ en herfst-winter in USA/UK/CAN. Productsoorten die eraan komen krijgen
                  meer producten dan soorten die net voorbij zijn, en een gelegenheidskeyword telt
                  alleen vol mee als het evenement binnen je venster valt (spring racing carnival,
                  kerst, bruiloftseizoen). Daarbovenop blijft de controle op verkeerde-markt-woorden
                  staan (bv. Brits "jumpers"/"trainers" op een USA-store).
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
        </>)}
      </div>
    </>
  );
}
