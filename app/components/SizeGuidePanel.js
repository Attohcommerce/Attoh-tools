"use client";

/* SIZE GUIDE PANEL — maattabellen voor élk product van een store.
   Flow: Scan → Bouw (image-search → AI-match → AliExpress-tabel → normaliseren
   → cijfer) → Schrijf (metafield custom.size_guide + status, met logtabblad).
   Groen/amber/standaard worden automatisch geschreven; rood komt in de
   review-lijst met vier handmatige routes: AliExpress-URL plakken,
   screenshot laten lezen, standaardtabel, of verwijderen. */

import { useEffect, useRef, useState } from "react";
import { MARKETS } from "@/lib/sizes";
import { formatCell, unitSuffix, checkGuide, KIND_LABEL } from "@/lib/sizeguide";

const LS_LOG = "sa_sizeguide_log";
const LS_COMP_STORES = "sa_competitor_stores"; // scraper-lijst (zelfde localStorage) → bron-stores voor maattabellen
const LS_MARKET = "sa_doctor_market::"; // zelfde sleutel als de Store Doctor → één doelmarkt per store
const WERKBOEK = "1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE";
const CUR_MARKET = { USD: "USA", GBP: "UK", AUD: "AUS+NZ", NZD: "AUS+NZ", CAD: "CAN" };

const LS_OPTS = "sa_sizeguide_opts";
/* Instellingen-menu: elke stap los aan/uit. rec = aanbeveling ("aan" | "uit" | "optioneel"). */
const OPTION_DEFS = [
  { key: "onlyMissing", label: "Alleen producten zonder tabel (of met standaardtabel)", info: "Uit = álle producten met maten opnieuw bouwen, ook die al een leveranciers- of handmatige tabel hebben.", rec: "aan" },
  { key: "fallbackStandard", label: "Standaardtabel per productsoort", info: "Lichaamsmaten per soort (top, jurk, broek, schoen…) met exact de maten van het product. Uit = product zonder bron krijgt niets.", rec: "aan" },
  { key: "autoWrite", label: "Direct naar Shopify schrijven", info: "Groen, amber en standaard meteen wegschrijven. Uit = alleen bekijken, niets aangepast.", rec: "aan" },
  { key: "useLog", label: "Log-sheet bijhouden", info: "Elke write eerst in een tabblad van het werkboek (herkomst, cijfer, JSON). Uit = ±1 s per 60 producten sneller, geen backup om terug te zetten.", rec: "optioneel" },
  { key: "ownImage", label: "Eigen productfoto's scannen op een maattabel (AI)", info: "Alleen als een productfoto een maattabel is. Kost ±$0,002 en 2–5 s per product.", rec: "uit" },
  { key: "source", label: "Bron-store van de concurrent doorzoeken", info: "Indexeert eerst alle scraper-stores (minuten), daarna per product 2–10 s. Levert echte leveranciersmaten als het bronproduct gevonden wordt.", rec: "uit" },
  { key: "ali", label: "AliExpress-maattabel ophalen", info: "Alleen voor producten met een bekend AliExpress-ID (cache of handmatig). Vaak geblokkeerd; 5–20 s per product.", rec: "uit" },
  { key: "search", label: "AliExpress zoeken op foto (Apify + AI-match)", info: "Search-by-image + AI kiest de match. Kost ±$0,01 en 10–20 s per product; vindt vaak niets. Vereist APIFY_TOKEN.", rec: "uit", needs: "ali" },
  { key: "browser", label: "Echte browser bij blokkade (Apify Playwright)", info: "Laatste redmiddel als AliExpress blokkeert. Kost ±$0,005–0,01 en 20–40 s per product.", rec: "uit", needs: "ali" },
];
const PRESET_FAST = { onlyMissing: true, fallbackStandard: true, autoWrite: true, useLog: true, ownImage: false, source: false, ali: false, search: false, browser: false };
const PRESET_FULL = { onlyMissing: true, fallbackStandard: true, autoWrite: true, useLog: true, ownImage: true, source: true, ali: true, search: true, browser: true };
function loadOpts() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_OPTS) || "null");
    if (v && typeof v === "object") return { ...PRESET_FAST, ...v };
  } catch {}
  return { ...PRESET_FAST };
}

const VERDICT_LABEL = { green: "groen", amber: "amber", standard: "standaard", red: "rood", none: "geen maten" };
const CHECK_LABEL = { ok: "✓ klopt", warn: "let op", error: "past niet", missing: "geen tabel", skip: "n.v.t." };

function sfx(kind) {
  try {
    window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: kind }));
  } catch {}
}

function badgeClass(v) {
  if (v === "green") return "badge badge-green";
  if (v === "amber" || v === "standard") return "badge badge-amber";
  return "badge";
}

/* Zelfde weergave-regels als de theme-snippet: tabel + in/cm-knop */
export function GuidePreview({ guide }) {
  const [unit, setUnit] = useState(guide.unit_default || "in");
  useEffect(() => setUnit(guide.unit_default || "in"), [guide]);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <span className="badge">{guide.status}</span>
        <span className="muted small">{guide.market} · {guide.gender} · {guide.family}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="seg">
          <button className={unit === "in" ? "on" : ""} onClick={() => setUnit("in")} type="button">in</button>
          <button className={unit === "cm" ? "on" : ""} onClick={() => setUnit("cm")} type="button">cm</button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="mini-table">
          <tbody>
            <tr>
              {guide.columns.map((c) => (
                <td key={c.key} style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {c.label}
                  {unitSuffix(c.kind, unit) ? <span className="muted"> ({unitSuffix(c.kind, unit)})</span> : null}
                </td>
              ))}
            </tr>
            {guide.rows.map((r, i) => (
              <tr key={i}>
                {guide.columns.map((c) => (
                  <td key={c.key} style={{ whiteSpace: "nowrap" }}>{formatCell(r[c.key], c.kind, unit)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        Fit: {guide.fit === "small" ? "runs small" : guide.fit === "large" ? "runs large" : "true to size"} · {guide.note}
      </div>
    </div>
  );
}

// Screenshot verkleinen tot max 1600px (Vercel-bodylimiet ±4,5 MB) → data-URL
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default function SizeGuidePanel({ store, since }) {
  const [market, setMarket] = useState("USA");
  const [logSheet, setLogSheet] = useState("");
  const [opts, setOpts] = useState(PRESET_FAST);
  const [optsOpen, setOptsOpen] = useState(false);
  const onlyMissing = opts.onlyMissing;
  const useSearch = opts.search && opts.ali;
  const fallbackStandard = opts.fallbackStandard;
  const autoWrite = opts.autoWrite;
  const steps = { ownImage: opts.ownImage, source: opts.source, ali: opts.ali, search: opts.search && opts.ali, browser: opts.browser && opts.ali, fallbackStandard: opts.fallbackStandard };
  const fastRun = !steps.ownImage && !steps.source && !steps.ali;
  function setOpt(key, val) {
    setOpts((cur) => {
      const next = { ...cur, [key]: val };
      if (key === "ali" && !val) {
        next.search = false;
        next.browser = false;
      }
      if ((key === "search" || key === "browser") && val) next.ali = true;
      try {
        localStorage.setItem(LS_OPTS, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  function applyPreset(p) {
    setOpts({ ...p });
    try {
      localStorage.setItem(LS_OPTS, JSON.stringify(p));
    } catch {}
  }

  const [items, setItems] = useState(null);
  const [counts, setCounts] = useState(null);
  const [kindsInfo, setKindsInfo] = useState(null); // [{kind,label,count}]
  const [checks, setChecks] = useState({}); // id → checkGuide-resultaat
  const [checkSum, setCheckSum] = useState(null); // {ok,warn,error,missing,skip}
  const [results, setResults] = useState({}); // id → build-result
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);
  const [err, setErr] = useState("");
  const [prog, setProg] = useState(null); // {done,total,green,amber,standard,red,usd}
  const [log, setLog] = useState([]);
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [probe, setProbe] = useState(null);
  const [envInfo, setEnvInfo] = useState(null); // {apify, proxy, redis} — bij laden opgehaald
  const [cloud, setCloud] = useState(null); // publieke job-status van de cloud-run (pc mag uit)
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudSeen = useRef(""); // laatste job-id+status die we in het log hebben gemeld
  const stopRef = useRef(false);
  const fileRef = useRef(null);
  const fileTarget = useRef(null);
  // Eén logtabblad per sessie/store — alle writes (batch én handmatig) eronder
  const tabRef = useRef("");
  // Bron-store-domeinen (concurrenten) — gevuld door indexSources(); gaat met elke build-call mee
  const srcDomainsRef = useRef(null);

  useEffect(() => {
    setOpts(loadOpts());
    try {
      const v = localStorage.getItem(LS_LOG);
      setLogSheet(v != null ? v : WERKBOEK);
    } catch {
      setLogSheet(WERKBOEK);
    }
    // Instellingen-check bij laden (geen AliExpress-request): staat de Apify-token er?
    fetch("/api/size-guide/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envOnly: true }) })
      .then((r) => r.json())
      .then((d) => d && d.env && setEnvInfo(d.env))
      .catch(() => {});
  }, []);
  // Cloud-run: bij store-keuze de status ophalen en zolang hij loopt elke 8 s
  // pollen (de status-route start zelf een tick als de keten stil ligt).
  useEffect(() => {
    if (!store || !store.domain) return;
    let stop = false;
    let timer = null;
    const poll = async () => {
      try {
        const d = await post("/api/size-guide/job", { action: "status", domain: store.domain });
        if (stop) return;
        setCloud(d.job || null);
        const running = d.job && d.job.status === "running";
        timer = setTimeout(poll, running ? 8000 : 45000);
      } catch {
        if (!stop) timer = setTimeout(poll, 30000);
      }
    };
    poll();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store && store.domain]);

  useEffect(() => {
    if (!store || !store.domain) return;
    let v = "";
    try {
      v = localStorage.getItem(LS_MARKET + store.domain) || "";
    } catch {}
    setMarket(v || CUR_MARKET[String(store.currency || "").toUpperCase()] || "USA");
    setItems(null);
    setResults({});
    setLog([]);
    setProg(null);
    tabRef.current = `SizeGuide ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  }, [store && store.domain]);

  function pickMarket(m) {
    setMarket(m);
    try {
      localStorage.setItem(LS_MARKET + store.domain, m);
    } catch {}
  }
  function saveLogSheet(v) {
    setLogSheet(v);
    try {
      localStorage.setItem(LS_LOG, v);
    } catch {}
  }
  function addLog(text, cls) {
    setLog((cur) => [{ text, cls: cls || "", t: Date.now() + Math.random() }, ...cur].slice(0, 120));
  }

  const storeBody = store ? { domain: store.domain, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret, name: store.name } : null;
  const backup = opts.useLog && logSheet ? { sheetId: logSheet.trim(), tab: tabRef.current } : null;

  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /* ---------- Bron-stores (concurrenten) indexeren ----------
     Scraper-lijst uit localStorage + alle domeinen uit de Geheugen-sheet →
     per domein een index in Redis (24 u). Snel als alles al gecachet is. */
  async function indexSources(quiet) {
    let local = [];
    try {
      const v = JSON.parse(localStorage.getItem(LS_COMP_STORES) || "[]");
      if (Array.isArray(v)) local = v.map((x) => (typeof x === "string" ? x : x && (x.domain || x.url) ? x.domain || x.url : "")).filter(Boolean);
    } catch {}
    let cursor = 0;
    let domains = local;
    let built = 0;
    let failed = [];
    for (let guard = 0; guard < 60; guard++) {
      const d = await post("/api/size-guide/source-index", { domains: local, cursor });
      domains = d.domains || domains;
      for (const r of d.results || []) {
        if (r.ok && !r.cached) built++;
        if (!r.ok) failed.push(r.domain);
      }
      cursor = d.nextCursor;
      if (!quiet && !d.done) addLog(`Bron-stores indexeren… ${Math.min(cursor, domains.length)}/${domains.length}`, "muted");
      if (d.done) break;
    }
    srcDomainsRef.current = domains;
    if (!quiet) addLog(`Bron-stores: ${domains.length} domeinen (${built} nieuw geïndexeerd${failed.length ? `, ${failed.length} niet bereikbaar` : ""})`, "muted");
    return domains;
  }
  async function sourceDomains() {
    if (srcDomainsRef.current) return srcDomainsRef.current;
    try {
      return await indexSources(true);
    } catch {
      return [];
    }
  }

  /* ---------- Probe ---------- */
  async function runProbe() {
    setErr("");
    setProbe({ busy: true });
    try {
      const d = await post("/api/size-guide/probe", {});
      setProbe(d);
      if (d.ok) addLog(`Probe oké via ${d.via} (${d.ms} ms): ${d.headers.join(" | ")} — ${d.rows.length} rijen, unit ${d.unit}`, "ok");
      else addLog(`Probe: ${d.blocked ? "GEBLOKKEERD — " : ""}${d.message || d.reason} (via ${d.via || "?"})`, d.blocked ? "err" : "warn");
    } catch (e) {
      setProbe({ ok: false, error: String(e.message) });
      addLog(`Probe mislukt: ${e.message}`, "err");
    }
  }

  /* ---------- Scan ---------- */
  async function scan() {
    setErr("");
    setBusy(true);
    setItems(null);
    setResults({});
    try {
      const d = await post("/api/size-guide/scan", { store: storeBody, sinceISO: since || null });
      setItems(d.items);
      setCounts(d.counts);
      setKindsInfo(d.kinds || null);
      addLog(`Scan: ${d.counts.total} producten · ${d.counts.withGuide} met maattabel (AliExpress ${d.counts.aliexpress || 0} · bron-store ${d.counts.source || 0} · handmatig ${d.counts.manual || 0} · standaard ${d.counts.standard || 0}) · ${d.counts.noSizes} zonder maten${d.metafieldsReadable ? "" : " · LET OP: metafields niet leesbaar (" + d.metafieldsError + ")"}`, "ok");
      if (d.kinds) addLog(`Productsoorten: ${d.kinds.map((k) => `${k.label} ${k.count}`).join(" · ")}`, "muted");
      runCheck(d.items);
      sfx("done");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Check alles (client-side, gratis) ----------
     Zelfde controle als de Store Doctor: hoort de tabel bij de productSOORT
     (rok zonder bust, blouse zonder inseam, schoen = voetlengte), kloppen
     de rijen met de variantmaten, geslacht, markt. */
  function runCheck(list) {
    const src = list || items || [];
    const next = {};
    const sum = { ok: 0, warn: 0, error: 0, missing: 0, skip: 0, standard: 0 };
    for (const it of src) {
      const c = checkGuide(it.guide || null, it, market);
      next[it.id] = c;
      sum[c.level] = (sum[c.level] || 0) + 1;
      if (c.standard) sum.standard++;
    }
    setChecks(next);
    setCheckSum(sum);
    addLog(`Check: ${sum.ok} kloppen · ${sum.warn} let op · ${sum.error} passen niet · ${sum.missing} zonder tabel · ${sum.skip} n.v.t. · ${sum.standard} standaardtabel`, sum.error || sum.missing ? "warn" : "ok");
    return next;
  }

  // Onbekende productsoorten door de AI laten bepalen (alleen tekst, spotgoedkoop)
  async function classifyUnknown() {
    const unknown = (items || []).filter((it) => it.kind === "unknown");
    if (!unknown.length) return;
    setRowBusy("kinds");
    try {
      let usd = 0;
      const map = {};
      for (let i = 0; i < unknown.length; i += 40) {
        const chunk = unknown.slice(i, i + 40);
        const d = await post("/api/size-guide/kinds", { items: chunk.map((it) => ({ id: it.id, title: it.title })) });
        for (const k of d.kinds || []) map[k.id] = k.kind;
        usd += (d.ai && d.ai.usd) || 0;
      }
      const next = (items || []).map((it) => (map[it.id] ? { ...it, kind: map[it.id] } : it));
      setItems(next);
      const cnt = {};
      for (const it of next) cnt[it.kind] = (cnt[it.kind] || 0) + 1;
      setKindsInfo(Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ kind: k, label: KIND_LABEL[k] || k, count: n })));
      addLog(`AI-soorten: ${Object.keys(map).length} van ${unknown.length} onbekende producten ingedeeld (±$${usd.toFixed(3)})`, "ok");
      runCheck(next);
    } catch (e) {
      setErr(e.message);
    } finally {
      setRowBusy(null);
    }
  }

  function problemList() {
    return (items || []).filter((it) => {
      const c = checks[it.id];
      return c && (c.level === "error" || c.level === "missing" || c.level === "warn");
    });
  }

  /* ---------- Schrijven (chunk-loop) ---------- */
  async function writeMany(list, label) {
    if (!list.length) return { written: 0, failed: 0 };
    let cursor = 0;
    let written = 0;
    let failed = 0;
    const bk = backup;
    while (cursor < list.length) {
      const d = await post("/api/size-guide/write", { store: storeBody, items: list, cursor, backup: bk, skipBackup: !bk });
      written += d.written || 0;
      failed += d.failed || 0;
      for (const n of d.notes || []) addLog(`schrijffout: ${n}`, "err");
      cursor = d.nextCursor;
      if (d.done) break;
    }
    addLog(`${label || "Geschreven"}: ${written} maattabel(len) naar Shopify${failed ? ` · ${failed} mislukt` : ""}${bk ? ` · log: ${bk.tab}` : ""}`, failed ? "warn" : "ok");
    setItems((cur) => {
      const next = (cur || []).map((it) => {
        const w = list.find((x) => String(x.id) === String(it.id));
        return w && w.guide ? { ...it, sgStatus: w.guide.status, guide: w.guide } : it;
      });
      // check-status meteen bijwerken voor de geschreven producten
      setChecks((cc) => {
        const n = { ...cc };
        for (const w of list) {
          const it = next.find((x) => String(x.id) === String(w.id));
          if (it) n[it.id] = checkGuide(it.guide || null, it, market);
        }
        return n;
      });
      return next;
    });
    return { written, failed };
  }

  function describeSteps() {
    if (fastRun) return "SNEL: alleen standaardtabellen (geen AliExpress, geen bron-stores, geen AI)";
    const on = OPTION_DEFS.filter((d) => !["onlyMissing", "autoWrite", "useLog"].includes(d.key) && opts[d.key] && (!d.needs || opts[d.needs])).map((d) => d.label.split(" (")[0].toLowerCase());
    return `stappen: ${on.join(" · ")}`;
  }

  /* Korte bronvermelding voor het log: waar komt de tabel vandaan (of waarom niet) */
  function describeSource(r) {
    if (r.source === "standard") {
      const why = (r.tried && r.tried.length ? r.tried : [r.fallbackReason]).filter(Boolean).join(" · ");
      return ` (standaard — ${String(why).slice(0, 220)})`;
    }
    const m = r.match || {};
    if (r.source === "source") return ` · bron: ${m.via === "own-image" ? "eigen maattabel-foto" : m.reason || "bron-store"}`;
    if (m.via) return ` · AliExpress ${m.via} ${Math.round((m.confidence || 0) * 100)}%${r.chart && r.chart.via ? ` (${r.chart.via})` : ""}`;
    return "";
  }

  /* ---------- Bouwen (batch) ---------- */
  function selection() {
    return (items || []).filter((it) => it.sizes.length && (!onlyMissing || !it.sgStatus || it.sgStatus === "standard"));
  }

  async function run(customList, customLabel) {
    const list = customList || selection();
    if (!list.length) {
      setErr(customList ? "Geen problemen om te herstellen." : "Niets te doen — alle producten met maten hebben al een maattabel (zet 'alleen zonder maattabel' uit om te herbouwen).");
      return;
    }
    if (opts.useLog && !logSheet && !window.confirm("Geen log-sheet ingevuld. Doorgaan zonder log?")) return;
    setErr("");
    // Zonder APIFY_TOKEN kan er niet op foto gezocht worden — dan zou de hele
    // run stilletjes in standaardtabellen eindigen. Eerst hard waarschuwen.
    if (useSearch) {
      try {
        const e = await post("/api/size-guide/probe", { envOnly: true });
        if (e.env && !e.env.apify) {
          const go = window.confirm(
            "APIFY_TOKEN staat niet in Vercel — AliExpress zoeken op foto kan niet draaien.\n\n" +
              "Doorgaan betekent: ALLEEN standaardtabellen (geen leveranciersmaten).\n" +
              "Annuleer, zet APIFY_TOKEN in Vercel → Environment Variables, redeploy, en start dan opnieuw."
          );
          if (!go) return;
        }
      } catch {}
    }
    setBusy(true);
    stopRef.current = false;
    const p = { done: 0, total: list.length, green: 0, amber: 0, standard: 0, red: 0, usd: 0 };
    setProg({ ...p });
    addLog(`${customLabel || "Start"}: ${list.length} producten · markt ${market} · ${describeSteps()}`, "muted");
    const toWrite = [];
    let cursor = 0;
    try {
      let srcDomains = [];
      if (steps.source) {
        try {
          srcDomains = await indexSources(false);
        } catch (e) {
          addLog(`Bron-stores overgeslagen: ${e.message}`, "warn");
        }
      }
      while (cursor < list.length && !stopRef.current) {
        const d = await post("/api/size-guide/build", { store: storeBody, market, items: list, cursor, useSearch, useSource: steps.source, sourceDomains: srcDomains, fallbackStandard, steps });
        for (const r of d.results) {
          setResults((cur) => ({ ...cur, [r.id]: r }));
          p.done++;
          p.usd += (r.ai && r.ai.usd) || 0;
          const v = r.ok ? r.verdict : r.verdict === "none" ? "none" : "red";
          if (p[v] != null) p[v]++;
          const t = String(r.title || r.id).slice(0, 48);
          if (r.ok) {
            addLog(`${t}: ${VERDICT_LABEL[r.verdict]} ${r.score}/10${describeSource(r)}${r.missing && r.missing.length ? ` · ontbreekt: ${r.missing.join("/")}` : ""}`, r.verdict === "green" ? "ok" : "warn");
            if (autoWrite && r.guide && (r.verdict === "green" || r.verdict === "amber" || r.verdict === "standard")) toWrite.push(r);
          } else {
            addLog(`${t}: ${r.verdict === "none" ? "geen maten" : "ROOD"} — ${r.reason}`, r.verdict === "none" ? "muted" : "err");
          }
        }
        setProg({ ...p });
        cursor = d.nextCursor;
        if (d.fatal) {
          // Zoekdienst ligt eruit (Apify-plan/quota/token): stoppen, niets
          // overschrijven — de rest wordt de volgende run gewoon opgepakt.
          addLog(`GESTOPT — zoeken op foto kan niet: ${d.fatal}`, "err");
          setErr(`Zoeken op foto kan niet: ${d.fatal}. Los dit op (Apify-plan/token) en klik opnieuw op Bouw maattabellen — de resterende ${list.length - cursor} producten zijn niet aangeraakt.`);
          stopRef.current = true;
          break;
        }
        if (d.done) break;
        // tussentijds wegschrijven zodat een stop/504 niets kost
        if (toWrite.length >= 20) {
          await writeMany(toWrite.splice(0, toWrite.length), "Tussentijds geschreven");
        }
      }
      if (toWrite.length) await writeMany(toWrite.splice(0, toWrite.length), "Geschreven");
      addLog(`Klaar: ${p.done}/${p.total} · groen ${p.green} · amber ${p.amber} · standaard ${p.standard} · rood ${p.red} · AI-kosten ±$${p.usd.toFixed(2)}${stopRef.current ? " (gestopt)" : ""}`, "ok");
      sfx("done");
    } catch (e) {
      setErr(e.message);
      addLog(`Run gestopt: ${e.message}`, "err");
      if (toWrite.length) {
        try {
          await writeMany(toWrite, "Geschreven vóór de fout");
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Cloud-run: hele batch server-side (pc mag uit) ----------
     Zelfde selectie/instellingen als "Bouw maattabellen", maar de loop draait
     in Vercel (Redis-state, ticks van ±45 s die elkaar aanroepen). Deze
     pagina hoeft niet open te blijven; de status-poll toont de voortgang. */
  async function cloudStart(customList, customLabel) {
    const list = customList || selection();
    if (!list.length) {
      setErr("Niets te doen — alle producten met maten hebben al een maattabel (zet 'alleen zonder maattabel' uit om te herbouwen).");
      return;
    }
    if (opts.useLog && !logSheet && !window.confirm("Geen log-sheet ingevuld. Doorgaan zonder log?")) return;
    setErr("");
    setCloudBusy(true);
    try {
      let srcDomains = [];
      if (steps.source) {
        try {
          srcDomains = await indexSources(false);
        } catch (e) {
          addLog(`Bron-stores overgeslagen: ${e.message}`, "warn");
        }
      }
      const slim = list.map(({ guide, ...it }) => it);
      const d = await post("/api/size-guide/job", {
        action: "start",
        store: storeBody,
        market,
        items: slim,
        useSearch,
        useSource: steps.source,
        sourceDomains: srcDomains,
        fallbackStandard,
        steps,
        autoWrite,
        backup,
        skipBackup: !backup,
        label: customLabel || "Cloud-run",
      });
      setCloud(d.job);
      addLog(`Cloud-run gestart: ${list.length} producten · markt ${market}${d.kicked ? "" : " · eerste tick kon niet gestart worden — de status-poll pakt 'm op"}. Je mag deze pagina (en de pc) sluiten; de voortgang staat hier zodra je terugkomt.`, "ok");
      sfx("done");
    } catch (e) {
      setErr(e.message);
    } finally {
      setCloudBusy(false);
    }
  }
  async function cloudAction(action) {
    if (!store) return;
    setErr("");
    setCloudBusy(true);
    try {
      const d = await post("/api/size-guide/job", { action, domain: store.domain });
      setCloud(d.job);
      if (action === "resume") addLog("Cloud-run hervat.", "muted");
      if (action === "stop") addLog("Cloud-run: stop gevraagd — stopt na de lopende ronde.", "warn");
    } catch (e) {
      setErr(e.message);
    } finally {
      setCloudBusy(false);
    }
  }
  // Klaar/gestopt → één keer melden en de lijst verversen (scan), zodat de
  // nieuwe tabellen en de check-badges kloppen.
  useEffect(() => {
    if (!cloud || cloud.status === "running") return;
    const key = `${cloud.id}:${cloud.status}`;
    if (cloudSeen.current === key) return;
    cloudSeen.current = key;
    const p = cloud.prog || {};
    addLog(`Cloud-run ${cloud.status === "done" ? "klaar" : cloud.status === "stopped" ? "gestopt" : "gestopt met fout"}: ${p.done || 0}/${cloud.total} · groen ${p.green || 0} · amber ${p.amber || 0} · standaard ${p.standard || 0} · rood ${p.red || 0} · geschreven ${p.written || 0}${cloud.error ? ` · ${cloud.error}` : ""}`, cloud.status === "done" ? "ok" : "warn");
    if (items && !busy && cloud.finishedAt && Date.now() - cloud.finishedAt < 10 * 60 * 1000) scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud && cloud.id, cloud && cloud.status]);

  /* ---------- Handmatige routes per product ---------- */
  async function rowBuild(it, o, label) {
    setErr("");
    setRowBusy(it.id);
    try {
      const srcDomains = o.aliInput || !steps.source ? [] : await sourceDomains();
      const d = await post("/api/size-guide/build", { store: storeBody, market, items: [it], cursor: 0, useSource: !o.aliInput && steps.source, sourceDomains: srcDomains, steps, ...o });
      const r = d.results[0];
      setResults((cur) => ({ ...cur, [r.id]: r }));
      if (r.ok && r.guide) {
        await writeMany([r], `${label}: ${VERDICT_LABEL[r.verdict]} ${r.score}/10 — geschreven`);
        setOpenId(r.id);
      } else {
        addLog(`${label}: ${r.reason}`, "err");
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setRowBusy(null);
    }
  }
  function rowAli(it) {
    const v = window.prompt("AliExpress product-URL of ID:", "");
    if (!v) return;
    rowBuild(it, { aliInput: v.trim(), useSearch: false, fallbackStandard: false }, "AliExpress-URL");
  }
  function rowStandard(it) {
    rowBuild(it, { useSearch: false, fallbackStandard: true, force: true, steps: { ownImage: false, source: false, ali: false, search: false, browser: false, fallbackStandard: true } }, "Standaardtabel");
  }
  function rowRetry(it) {
    rowBuild(it, { useSearch: true, fallbackStandard, force: true, steps: { ...steps, ali: true, search: true } }, "Opnieuw gezocht");
  }
  function rowScreenshot(it) {
    fileTarget.current = it;
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }
  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    const it = fileTarget.current;
    if (!file || !it) return;
    setRowBusy(it.id);
    try {
      const dataUrl = await fileToDataUrl(file);
      const d = await post("/api/size-guide/read-image", { item: it, market, dataUrl });
      const r = d.result;
      setResults((cur) => ({ ...cur, [r.id]: r }));
      if (r.ok && r.guide) {
        await writeMany([r], `Screenshot gelezen: ${VERDICT_LABEL[r.verdict]} ${r.score}/10 — geschreven`);
        setOpenId(r.id);
      } else {
        addLog(`Screenshot: ${r.reason}${r.chart ? ` (gelezen: ${r.chart.headers.join(" | ")})` : ""}`, "err");
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setRowBusy(null);
    }
  }
  async function rowRemove(it) {
    if (!window.confirm(`Maattabel van "${it.title}" verwijderen?`)) return;
    setRowBusy(it.id);
    try {
      const d = await post("/api/size-guide/remove", { store: storeBody, ids: [it.id] });
      addLog(`Verwijderd: ${it.title.slice(0, 48)}${d.errors && d.errors.length ? " — " + d.errors.join("; ") : ""}`, d.ok ? "ok" : "err");
      setItems((cur) => (cur || []).map((x) => (x.id === it.id ? { ...x, sgStatus: null } : x)));
      setResults((cur) => {
        const n = { ...cur };
        delete n[it.id];
        return n;
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setRowBusy(null);
    }
  }

  /* ---------- Lijst ---------- */
  const rowsAll = (items || []).map((it) => ({ it, r: results[it.id] || null }));
  const verdictOf = ({ it, r }) => {
    if (!it.sizes.length) return "none";
    if (r) return r.ok ? r.verdict : r.verdict === "none" ? "none" : "red";
    if (it.sgStatus) return it.sgStatus === "standard" ? "standard" : "written";
    return "missing";
  };
  const rows = rowsAll.filter((x) => {
    const v = verdictOf(x);
    const c = checks[x.it.id];
    if (filter === "all") return true;
    if (filter === "problems") return c && (c.level === "error" || c.level === "missing" || c.level === "warn");
    if (filter === "review") return v === "red" || v === "amber";
    if (filter === "missing") return v === "missing";
    if (filter === "standard") return v === "standard";
    if (filter === "green") return v === "green" || v === "written";
    return true;
  });
  const sel = items ? selection().length : 0;

  return (
    <div>
      {/* ---------- instellingen ---------- */}
      <div className="field-label">Doelmarkt <span className="opt">— bepaalt de maatkolom (US/AU/UK) en de standaard-eenheid</span></div>
      <div className="seg" style={{ marginBottom: 10 }}>
        {MARKETS.map((m) => (
          <button key={m} type="button" className={market === m ? "on" : ""} onClick={() => pickMarket(m)} disabled={busy}>{m}</button>
        ))}
      </div>
      <div className="field-label">Log-sheet (ID) <span className="opt">— per run een tabblad "SizeGuide &lt;datum&gt;" met herkomst, cijfer en JSON</span></div>
      <input type="text" value={logSheet} onChange={(e) => saveLogSheet(e.target.value)} placeholder="Google Sheet ID" disabled={busy} style={{ width: "100%", marginBottom: 10 }} />
      {/* ---------- instellingen-menu: elke stap los aan/uit ---------- */}
      <div style={{ border: "1px solid var(--line, #e8e4de)", borderRadius: 6, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setOptsOpen(!optsOpen)}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: 0, padding: "10px 12px", cursor: "pointer", font: "inherit", textAlign: "left" }}
        >
          <span style={{ display: "inline-block", transform: optsOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
          <strong>Instellingen</strong>
          <span className={fastRun ? "badge badge-green" : "badge badge-amber"}>{fastRun ? "snel — alleen standaardtabellen" : "volledig — met bronnen (traag, kost geld)"}</span>
          <span className="muted small">{OPTION_DEFS.filter((d) => opts[d.key] && (!d.needs || opts[d.needs])).length}/{OPTION_DEFS.length} aan</span>
        </button>
        {optsOpen && (
          <div style={{ padding: "0 12px 12px" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button type="button" className="btn-ghost btn-small" onClick={() => applyPreset(PRESET_FAST)} disabled={busy}>Preset: Snel (aanbevolen)</button>
              <button type="button" className="btn-ghost btn-small" onClick={() => applyPreset(PRESET_FULL)} disabled={busy}>Preset: Volledig (leveranciersmaten)</button>
            </div>
            {OPTION_DEFS.map((d) => {
              const blocked = d.needs && !opts[d.needs];
              const on = !!opts[d.key] && !blocked;
              const recCls = d.rec === "aan" ? "badge badge-green" : d.rec === "uit" ? "badge" : "badge badge-amber";
              return (
                <div key={d.key} className="toggle-row" style={{ alignItems: "flex-start", opacity: blocked ? 0.5 : 1, padding: "6px 0" }}>
                  <span className={"switch" + (on ? " on" : "")} onClick={() => !busy && !blocked && setOpt(d.key, !opts[d.key])} style={{ flex: "none", marginTop: 2 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span>
                      {d.label}
                      <span className={recCls} style={{ marginLeft: 8 }}>{d.rec === "aan" ? "aan laten" : d.rec === "uit" ? "uit laten" : "optioneel"}</span>
                      {blocked ? <span className="muted small" style={{ marginLeft: 8 }}>(vereist AliExpress)</span> : null}
                      {d.key === "search" && envInfo && !envInfo.apify ? <span className="badge" style={{ marginLeft: 8 }}>APIFY_TOKEN ontbreekt in Vercel</span> : null}
                    </span>
                    <span className="muted small">{d.info}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        <button className="btn" onClick={scan} disabled={busy || !store}>{busy && !items ? <span className="spin" /> : null} Scan store</button>
        <button className="btn" onClick={() => run()} disabled={busy || !items || !sel}>Bouw maattabellen ({sel}){fastRun ? " — snel" : ""}</button>
        <button className="btn" onClick={() => cloudStart()} disabled={busy || cloudBusy || !items || !sel || (cloud && cloud.status === "running")} title="Draait volledig in Vercel — deze pagina en je pc mogen dicht">
          {cloudBusy ? <span className="spin" /> : null} Bouw in de cloud ({sel}) — pc mag uit
        </button>
        <button className="btn-ghost" onClick={() => runCheck()} disabled={busy || !items}>Check alles</button>
        {checkSum && problemList().length > 0 && (
          <button className="btn-ghost" onClick={() => run(problemList(), "Herstel problemen")} disabled={busy}>Herstel problemen ({problemList().length})</button>
        )}
        {busy && <button className="btn-ghost" onClick={() => (stopRef.current = true)}>Stop na dit product</button>}
        <button className="btn-ghost btn-small" onClick={runProbe} disabled={busy}>Probe AliExpress</button>
      </div>
      {probe && !probe.busy && (
        <div className={"hint"} style={{ marginTop: 6 }}>
          {probe.ok ? `AliExpress bereikbaar via ${probe.via} (${probe.ms} ms) · ` : `AliExpress: ${probe.blocked ? "GEBLOKKEERD" : "niet gelukt"} — ${probe.message || probe.error || probe.reason} · `}
          {probe.env ? `Apify ${probe.env.apify ? "✓" : "✗ (APIFY_TOKEN)"} · proxy ${probe.env.proxy ? "✓" : "—"} · browser ${probe.env.browser ? "✓" : "—"} · cache ${probe.env.redis ? "✓" : "—"}` : ""}
        </div>
      )}
      {err && <div className="log err" style={{ marginTop: 10 }}>{err}</div>}
      {kindsInfo && (
        <div className="hint" style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span>Productsoorten: {kindsInfo.map((k) => `${k.label} ${k.count}`).join(" · ")}</span>
          {kindsInfo.some((k) => k.kind === "unknown") && (
            <button className="btn-ghost btn-small" onClick={classifyUnknown} disabled={busy || rowBusy === "kinds"}>
              {rowBusy === "kinds" ? <span className="spin" /> : null} Onbekende soorten bepalen (AI)
            </button>
          )}
        </div>
      )}
      {checkSum && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
          <span className="badge badge-green">{checkSum.ok} kloppen</span>
          <span className="badge badge-amber">{checkSum.warn} let op</span>
          <span className="badge">{checkSum.error} passen niet</span>
          <span className="badge">{checkSum.missing} zonder tabel</span>
          <span className="muted small">{checkSum.standard} standaardtabel · {checkSum.skip} n.v.t. (accessoires / geen maten)</span>
        </div>
      )}

      {/* ---------- cloud-run status ---------- */}
      {cloud && (
        <div className="prog-card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong>
              Cloud-run {cloud.status === "running" ? (cloud.stale ? "· keten stil, wordt hervat…" : cloud.stopRequested ? "· stopt…" : "· draait") : cloud.status === "done" ? "· klaar" : cloud.status === "stopped" ? "· gestopt" : "· fout"}
            </strong>
            <strong>{(cloud.prog && cloud.prog.done) || 0}/{cloud.total}</strong>
            <span className="badge badge-green">groen {cloud.prog ? cloud.prog.green : 0}</span>
            <span className="badge badge-amber">amber {cloud.prog ? cloud.prog.amber : 0}</span>
            <span className="badge badge-amber">standaard {cloud.prog ? cloud.prog.standard : 0}</span>
            <span className="badge">rood {cloud.prog ? cloud.prog.red : 0}</span>
            <span className="muted small">geschreven {cloud.prog ? cloud.prog.written : 0}{cloud.pendingWrites ? ` (+${cloud.pendingWrites} wacht)` : ""} · AI ±${cloud.prog ? Number(cloud.prog.usd || 0).toFixed(2) : "0.00"} · ticks {cloud.ticks || 0}</span>
            <span style={{ flex: 1 }} />
            {cloud.status === "running" && <button className="btn-ghost btn-small" onClick={() => cloudAction("stop")} disabled={cloudBusy || cloud.stopRequested}>Stop cloud-run</button>}
            {cloud.status !== "running" && cloud.status !== "done" && <button className="btn-ghost btn-small" onClick={() => cloudAction("resume")} disabled={cloudBusy}>Hervat</button>}
            {cloud.status === "running" && cloud.stale && <button className="btn-ghost btn-small" onClick={() => cloudAction("resume")} disabled={cloudBusy}>Hervat nu</button>}
          </div>
          <div className="progressbar" style={{ marginTop: 8 }}><div style={{ width: `${Math.round((((cloud.prog && cloud.prog.done) || 0) / Math.max(1, cloud.total)) * 100)}%` }} /></div>
          {cloud.error && <div className="log err" style={{ marginTop: 8 }}>{cloud.error}</div>}
          {cloud.log && cloud.log.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto" }}>
              {cloud.log.slice(-40).reverse().map((l, i) => (
                <div key={`${l.t}-${i}`} className={"log " + (l.cls || "")}>{l.text}</div>
              ))}
            </div>
          )}
          <div className="hint" style={{ marginTop: 6 }}>Draait in Vercel — deze pagina en je pc mogen dicht. Gestart {new Date(cloud.startedAt).toLocaleString("nl-NL")}{cloud.finishedAt ? ` · klaar ${new Date(cloud.finishedAt).toLocaleString("nl-NL")}` : ""}.</div>
        </div>
      )}

      {/* ---------- voortgang ---------- */}
      {prog && (
        <div className="prog-card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong>{prog.done}/{prog.total}</strong>
            <span className="badge badge-green">groen {prog.green}</span>
            <span className="badge badge-amber">amber {prog.amber}</span>
            <span className="badge badge-amber">standaard {prog.standard}</span>
            <span className="badge">rood {prog.red}</span>
            <span className="muted small">AI ±${prog.usd.toFixed(2)}</span>
          </div>
          <div className="progressbar" style={{ marginTop: 8 }}><div style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div>
        </div>
      )}
      {log.length > 0 && (
        <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto" }}>
          {log.map((l) => (
            <div key={l.t} className={"log " + l.cls}>{l.text}</div>
          ))}
        </div>
      )}

      {/* ---------- lijst ---------- */}
      {items && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="seg">
              {[["all", `alle (${rowsAll.length})`], ["problems", `problemen (${problemList().length})`], ["review", "review"], ["missing", "zonder"], ["standard", "standaard"], ["green", "met tabel"]].map(([k, l]) => (
                <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <span className="muted small">{counts ? `${counts.withGuide} met maattabel · ${counts.noSizes} zonder maten` : ""}</span>
          </div>
          <table className="mini-table" style={{ marginTop: 8 }}>
            <tbody>
              {rows.slice(0, 400).map(({ it, r }) => {
                const v = verdictOf({ it, r });
                const c = checks[it.id];
                const open = openId === it.id;
                const shownGuide = (r && r.guide) || it.guide || null;
                return (
                  <tr key={it.id}>
                    <td style={{ width: 44 }}>{it.image ? <img src={it.image + (it.image.includes("?") ? "&" : "?") + "width=80"} alt="" style={{ width: 36, height: 48, objectFit: "cover", borderRadius: 6 }} /> : null}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <strong>{it.title}</strong>
                        <span className={badgeClass(v)}>{v === "written" ? it.sgStatus : VERDICT_LABEL[v] || v}</span>
                        {c && c.level !== "skip" && (
                          <span className={c.level === "ok" ? "badge badge-green" : c.level === "warn" ? "badge badge-amber" : "badge"} title={c.issues.join("; ")}>{CHECK_LABEL[c.level]}</span>
                        )}
                        {r && r.score != null && <span className="muted small">{r.score}/10</span>}
                        {r && r.match && r.match.via && r.match.pid && <span className="muted small">match {r.match.via} {Math.round((r.match.confidence || 0) * 100)}%</span>}
                      </div>
                      <div className="muted small">{KIND_LABEL[it.kind] || it.kind} · {it.gender} · {it.sizes.length ? it.sizes.join(" / ") : "geen maten"}{r && !r.ok && r.reason ? ` · ${r.reason}` : ""}{r && r.fallbackReason ? ` · vangnet: ${r.fallbackReason}` : ""}{r && r.issues && r.issues.length ? ` · ${r.issues.join("; ")}` : ""}</div>
                      {c && c.issues && c.issues.length > 0 && c.level !== "ok" && <div className={"small " + (c.level === "warn" ? "muted" : "")} style={c.level === "warn" ? {} : { color: "var(--err)" }}>{c.issues.join(" · ")}</div>}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        {shownGuide && <button className="btn-ghost btn-small" onClick={() => setOpenId(open ? null : it.id)}>{open ? "sluit" : "bekijk"}</button>}
                        {it.sizes.length > 0 && (
                          <>
                            <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id} onClick={() => rowAli(it)}>AliExpress-URL…</button>
                            <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id} onClick={() => rowScreenshot(it)}>Screenshot → AI…</button>
                            <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id} onClick={() => rowStandard(it)}>Standaardtabel</button>
                            <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id || !useSearch} onClick={() => rowRetry(it)}>Zoek opnieuw</button>
                          </>
                        )}
                        {(it.sgStatus || (r && r.guide)) && <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id} onClick={() => rowRemove(it)}>Verwijder</button>}
                        {rowBusy === it.id && <span className="spin" />}
                      </div>
                      {open && shownGuide && <GuidePreview guide={shownGuide} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 400 && <div className="hint">Eerste 400 getoond — filter om de rest te zien.</div>}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />
    </div>
  );
}
