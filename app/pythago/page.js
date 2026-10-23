"use client";

// PYTHAGO — wat kost elk product aan Google Ads en wat levert het op in Shopify?
// 7 / 14 / 30 dagen naast elkaar, vaste formules, advies per product en een
// knop om de aangevinkte producten op draft te zetten (17-10-2026, doc 56).
//
// Nodig per run: (1) store (koppeling uit de Importer + Orders-app van de
// Bills-pagina), (2) de Google Ads-export "Producten" van de afgelopen 30
// dagen met segment Dag (CSV). De CSV wordt hier in de browser gelezen; alleen
// de opgetelde cijfers per item gaan naar de server.
//
// CONVERSION BOOSTER (23-10-2026, doc 64): vóór het draften eerst een kans.
// Onder de tabel: categorieën aanvinken → 1 · Analyseer (AI kijkt per product
// naar listing + cijfers: Boost · Draft nu · Laten lopen) → vinkjes nalopen →
// 2 · Schrijf naar sheet (blad "CVR BOOST dd-mm" + CVR Log) + tekst voor Claude
// op het klembord → Claude doet de fixes → Klaar → blad verbergen, boost-
// venster loopt. Producten in een lopende boost slaat "Selecteer alle
// Draften" over; na het venster toont de tabel of de boost werkte.

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { sfx } from "../components/sfx";
import { parseAdsExport, combineExports, slimAds } from "@/lib/pythago-csv";
import { buildClaudeText } from "@/lib/cvr-text";
import { orgLS } from "@/lib/org-client";

const LS_STORES = "sa_stores";
const LS_STORE = "sa_py_store";
const LS_SETTINGS = "sa_py_settings::"; // + domein
const LS_SHEET = "sa_py_sheet::"; // + domein
const LS_ORDERS_APP = "sa_orders_app::"; // + domein (Bills-pagina)
const LS_BILLS_SHEET = "sa_bills_sheet::"; // + domein (P&L-sheet)
const LS_CVR = "sa_cvr_settings::"; // + domein (Conversion Booster)

const DEFAULTS = { cogsPct: 35, feePct: 4.4, threshold: 5, ruleWindow: 30, minAge: 14 };
const ADVIES = ["Draften", "Onder break-even", "Winstgevend", "Verkoopt", "Nieuw", "Te weinig spend", "Niet op store", "Al draft"];
const TONE = {
  Draften: "var(--err)",
  "Onder break-even": "var(--warn)",
  Winstgevend: "var(--ok)",
  Verkoopt: "#7fb2ff",
  Nieuw: "#a99bff",
  "Te weinig spend": "var(--muted)",
  "Niet op store": "var(--faint)",
  "Al draft": "var(--faint)",
};
const CVR_CATS = ["Draften", "Onder break-even", "Verkoopt", "Winstgevend", "Te weinig spend"];
const CVR_DEFAULTS = { categories: ["Draften", "Onder break-even"], minClicks: 20, maxPerRun: 25, windowDays: 14, allowRepeat: false };
const VERDICTS = ["Boost", "Draft nu", "Laten lopen"];
const VTONE = { Boost: "#4cc9f0", "Draft nu": "var(--err)", "Laten lopen": "var(--muted)" };
const BOOST_TONE = "#4cc9f0";

function load(key, fallback) {
  try {
    const v = orgLS.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    orgLS.setItem(key, JSON.stringify(value));
  } catch {}
}
const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const ddmm = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}` : String(iso || "");
};

/* Google Ads geeft CSV soms als UTF-16 ("Excel CSV") — BOM of nul-bytes herkennen. */
async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 4 && buf[1] === 0 && buf[3] === 0);
  return new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(buf);
}

/* Label voor de boost-status van een product in de tabel. */
function boostLabel(b) {
  if (!b) return null;
  const short = String(b.tab || "").replace(/^CVR BOOST\s*/i, "");
  if (b.status === "open") return { text: `Boost ${short} · open`, color: BOOST_TONE, title: `In boost "${b.tab}" — nog niet klaar gemeld. Wordt niet gedraft.` };
  if (b.status === "venster") return { text: `Boost ${short} · dag ${b.day}/${b.windowDays}`, color: BOOST_TONE, title: `Boost "${b.tab}" klaar op ${ddmm(b.doneAt)} — venster van ${b.windowDays} dagen loopt. Wordt niet gedraft.` };
  if (b.effect === "geen effect") return { text: `Geboost ${short} · geen effect`, color: "var(--warn)", title: `${b.effectText || ""} — telt weer gewoon mee voor Draften.` };
  if (b.effect === "beter") return { text: `Boost ${short} · beter`, color: "var(--ok)", title: b.effectText || "" };
  return { text: `Boost ${short} werkt ✓`, color: "var(--ok)", title: b.effectText || "" };
}

export default function PythagoPage() {
  const [stores, setStores] = useState([]);
  const [sel, setSel] = useState("");
  const [files, setFiles] = useState([]); // [{ name, parsed?, error? }]
  const [settings, setSettings] = useState(DEFAULTS);
  const [fxOverride, setFxOverride] = useState("");
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState("Draften");
  const [sort, setSort] = useState({ key: "", dir: "desc" }); // "" = volgorde van de server (advies, dan spend)
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [sheet, setSheet] = useState("");
  const [tab, setTab] = useState(`Pythago ${today()}`);
  const [doneUrl, setDoneUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [logs, setLogs] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  // Conversion Booster
  const [cvr, setCvr] = useState(CVR_DEFAULTS);
  const [bRun, setBRun] = useState(null);
  const [bPicked, setBPicked] = useState(() => new Set());
  const [bTab, setBTab] = useState("");
  const [bFilter, setBFilter] = useState("Alles");
  const [bDone, setBDone] = useState(null); // { url, tab, text }
  const [runs, setRuns] = useState([]);

  const push = (e) => setLogs((l) => [...l, e]);
  const store = stores.find((s) => s.domain === sel) || null;
  const ordersKeys = useMemo(() => {
    if (!sel) return null;
    const k = load(LS_ORDERS_APP + sel, null);
    return k && k.clientId && k.clientSecret ? k : null;
  }, [sel]);
  const creds = () => (store ? { name: store.name, domain: store.domain, currency: store.currency, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret } : null);

  useEffect(() => {
    const list = load(LS_STORES, []) || [];
    setStores(list);
    const last = load(LS_STORE, "");
    if (last && list.some((s) => s.domain === last)) pickStore(last);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pickStore(domain) {
    setSel(domain);
    save(LS_STORE, domain);
    setSettings({ ...DEFAULTS, ...(load(LS_SETTINGS + domain, {}) || {}) });
    setCvr({ ...CVR_DEFAULTS, ...(load(LS_CVR + domain, {}) || {}) });
    const bills = load(LS_BILLS_SHEET + domain, "");
    setSheet(load(LS_SHEET + domain, "") || bills || "");
    setResult(null);
    setPicked(new Set());
    setDoneUrl("");
    setBRun(null);
    setBPicked(new Set());
    setBDone(null);
    setRuns([]);
  }

  function setS(k, v) {
    setSettings((s) => {
      const n = { ...s, [k]: v };
      if (sel) save(LS_SETTINGS + sel, n);
      return n;
    });
  }
  function setC(k, v) {
    setCvr((s) => {
      const n = { ...s, [k]: v };
      if (sel) save(LS_CVR + sel, n);
      return n;
    });
  }
  const toggleCat = (c) => setC("categories", cvr.categories.includes(c) ? cvr.categories.filter((x) => x !== c) : [...cvr.categories, c]);

  async function addFiles(list) {
    const arr = [...(list || [])].filter((f) => /\.(csv|tsv|txt)$/i.test(f.name) || /csv|text/.test(f.type));
    if (!arr.length) {
      push({ err: true, text: "Alleen CSV-bestanden — kies in Google Ads bij Downloaden voor .csv." });
      return;
    }
    const next = [];
    for (const f of arr) {
      try {
        const parsed = parseAdsExport(await readText(f), f.name);
        next.push({ name: f.name, parsed });
      } catch (e) {
        next.push({ name: f.name, error: String(e.message || e) });
      }
    }
    setFiles((cur) => [...cur.filter((c) => !next.some((n) => n.name === c.name)), ...next]);
    setResult(null);
  }

  const okFiles = files.filter((f) => f.parsed);
  const combined = useMemo(() => (okFiles.length ? combineExports(okFiles.map((f) => f.parsed)) : null), [files]); // eslint-disable-line react-hooks/exhaustive-deps
  const canAnalyse = !busy && store && combined && combined.end;

  async function api(body) {
    const res = await fetch("/api/pythago", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  async function apiCvr(body) {
    const res = await fetch("/api/cvr-boost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function analyse() {
    if (!canAnalyse) return;
    setBusy("analyse");
    setResult(null);
    setPicked(new Set());
    setDoneUrl("");
    setBRun(null);
    setBPicked(new Set());
    setBDone(null);
    setLogs([]);
    try {
      const ads = slimAds(combined);
      push({ strong: true, text: `— Pythago: ${store.name || store.domain} · Ads ${combined.start} t/m ${combined.end} · ${ads.items.length} items met spend` });
      push({ text: ordersKeys ? "Shopify-orders via de Orders-app (Bills-pagina) · producten via de Importer-koppeling…" : "Geen Orders-app-sleutels voor deze store — orders via de Importer-koppeling (werkt alleen als die read_orders heeft)…" });
      const r = await api({
        action: "analyse",
        store: creds(),
        ordersStore: ordersKeys,
        ads,
        settings,
        fxOverride: fxOverride ? Number(String(fxOverride).replace(",", ".")) : undefined,
      });
      const res = r.result;
      setResult(res);
      setRuns(res.boostRuns || []);
      const c = res.counts || {};
      setFilter(c.Draften ? "Draften" : "Alles");
      const cur = res.adsCurrency === "GBP" ? "£" : res.adsCurrency + " ";
      push({ ok: true, text: `Klaar: ${res.rows.length} producten · ${res.ordersCounted} Shopify-orders · koers 1 ${res.shopCurrency} = ${res.fx.rate} ${res.adsCurrency} · break-even ROAS ${res.settings.breakEvenRoas}.` });
      push({ text: `Advies: ${ADVIES.filter((a) => c[a]).map((a) => `${a} ${c[a]}`).join(" · ")}${res.draftSpend ? ` — ${cur}${res.draftSpend.toFixed(2)} spend op draft-kandidaten (${res.settings.ruleWindow} d)` : ""}` });
      const inBoost = res.rows.filter((x) => x.boost && x.boost.active).length;
      const judged = res.rows.filter((x) => x.boost && x.boost.status === "klaar" && x.boost.effect);
      if (inBoost || judged.length) {
        push({ text: `Conversion Booster: ${inBoost} product(en) in een lopende boost (worden niet gedraft)${judged.length ? ` · ${judged.filter((x) => x.boost.effect !== "geen effect").length} boost(s) met effect, ${judged.filter((x) => x.boost.effect === "geen effect").length} zonder effect (tellen weer mee voor Draften)` : ""}.` });
      }
      for (const w of res.warnings || []) push({ err: true, text: `Let op: ${w}` });
      sfx("success");
    } catch (e) {
      push({ err: true, text: `Mislukt: ${e.message || e}` });
      sfx("error");
    } finally {
      setBusy("");
    }
  }

  async function writeSheet() {
    if (!result || !sheet.trim() || !tab.trim() || busy) return;
    setBusy("write");
    try {
      save(LS_SHEET + sel, sheet.trim());
      const r = await api({ action: "write", sheet: sheet.trim(), tab: tab.trim(), result });
      setDoneUrl(r.url);
      push({ ok: true, text: `✓ Blad "${r.tab}"${r.replaced ? " (overschreven)" : ""} — ${r.rows} producten, met filter en kleuren per advies.` });
      sfx("success");
    } catch (e) {
      push({ err: true, text: `Schrijven mislukt: ${e.message || e}${/permission|403/i.test(String(e.message)) ? " — deel de sheet als Bewerker met attoh-sheets@attoh-tools.iam.gserviceaccount.com." : ""}` });
      sfx("error");
    } finally {
      setBusy("");
    }
  }

  async function draftPicked() {
    const ids = [...picked];
    if (!ids.length || busy) return;
    const names = result.rows.filter((x) => picked.has(x.productId)).map((x) => x.title);
    if (!window.confirm(`${ids.length} product(en) op draft zetten in ${store.name || store.domain}?\n\n${names.slice(0, 12).join("\n")}${names.length > 12 ? `\n… en ${names.length - 12} meer` : ""}`)) return;
    setBusy("draft");
    try {
      const r = await api({
        action: "draft",
        store: { name: store.name, domain: store.domain, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret },
        productIds: ids,
      });
      const ok = new Set(r.results.filter((x) => x.ok).map((x) => x.productId));
      setResult((res) => ({ ...res, rows: res.rows.map((x) => (ok.has(x.productId) ? { ...x, status: "draft", advies: "Al draft", drafted: true } : x)) }));
      setPicked(new Set());
      push({ ok: true, text: `✓ ${r.drafted} product(en) op draft gezet.` });
      for (const f of r.failed || []) push({ err: true, text: `Niet gelukt: ${f.productId} — ${f.error}` });
      sfx(r.failed && r.failed.length ? "error" : "success");
    } catch (e) {
      push({ err: true, text: `Draften mislukt: ${e.message || e}` });
      sfx("error");
    } finally {
      setBusy("");
    }
  }

  /* ---------------- Conversion Booster ---------------- */

  async function refreshRuns() {
    try {
      const r = await apiCvr({ action: "list", store: { domain: store.domain } });
      setRuns(r.runs || []);
    } catch {}
  }

  async function boosterAnalyse() {
    if (!result || busy) return;
    if (!cvr.categories.length) {
      push({ err: true, text: "Vink minstens één categorie aan voor de Conversion Booster." });
      return;
    }
    setBusy("booster");
    setBRun(null);
    setBDone(null);
    setBFilter("Alles");
    try {
      push({ strong: true, text: `— Conversion Booster: ${cvr.categories.join(", ")} · min. ${cvr.minClicks} klikken (30 d) · max ${cvr.maxPerRun} producten · AI bekijkt per product listing + cijfers…` });
      const r = await apiCvr({ action: "analyse", store: creds(), result, settings: cvr });
      const run = r.run;
      setBRun(run);
      setBPicked(new Set(run.items.filter((it) => it.pick).map((it) => it.productId)));
      setBTab(run.tabSuggestion);
      push({ ok: true, text: run.stat });
      if (run.summary) for (const l of String(run.summary).split(/\n+/).filter(Boolean)) push({ text: l });
      for (const e of run.errors || []) push({ err: true, text: `Let op: ${e}` });
      if (run.ai && run.ai.calls) push({ text: `AI: ${run.ai.calls} call(s) · ±$${Number(run.ai.usd || 0).toFixed(2)}` });
      sfx("success");
    } catch (e) {
      push({ err: true, text: `Booster mislukt: ${e.message || e}` });
      sfx("error");
    } finally {
      setBusy("");
    }
  }

  const bItems = useMemo(() => (bRun ? bRun.items.filter((it) => bFilter === "Alles" || it.ai.verdict === bFilter) : []), [bRun, bFilter]);
  const bToggle = (id) =>
    setBPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function boosterWrite() {
    if (!bRun || busy) return;
    const items = bRun.items.filter((it) => bPicked.has(it.productId));
    if (!items.length) {
      push({ err: true, text: "Geen producten aangevinkt voor de boost." });
      return;
    }
    if (!sheet.trim()) {
      push({ err: true, text: "Vul bij 4 · Naar sheet de Google Sheet van de store in (standaard de P&L-sheet)." });
      return;
    }
    const title = (bTab || bRun.tabSuggestion || `CVR BOOST ${today()}`).trim();
    // klembord binnen de klik (anders weigert de browser het na de server-call)
    const text = buildClaudeText({ ...bRun, tab: title, items });
    const copied = await copyText(text);
    setBusy("bwrite");
    try {
      save(LS_SHEET + sel, sheet.trim());
      const r = await apiCvr({ action: "write", store: { name: store.name, domain: store.domain }, sheet: sheet.trim(), tab: title, run: { ...bRun, items } });
      setBDone({ url: r.url, tab: r.tab, text: r.text || text });
      push({ ok: true, text: `✓ Blad "${r.tab}"${r.replaced ? " (overschreven)" : ""} — ${r.rows} producten · CVR Log +${r.logged}${copied ? " · tekst voor Claude staat op het klembord" : " · klembord geweigerd, gebruik \"Kopieer opnieuw\""}` });
      if (r.logErr) push({ err: true, text: `CVR Log niet bijgewerkt: ${r.logErr}` });
      if (r.stateErr) push({ err: true, text: `Geheugen niet bijgewerkt — Pythago weet niet van deze boost: ${r.stateErr}` });
      const ids = new Set(items.map((it) => it.productId));
      setResult((res) => ({
        ...res,
        rows: res.rows.map((x) => (ids.has(x.productId) ? { ...x, boost: { tab: r.tab, date: bRun.date, status: "open", active: true, day: 0, windowDays: cvr.windowDays } } : x)),
      }));
      refreshRuns();
      sfx("success");
    } catch (e) {
      push({ err: true, text: `Schrijven mislukt: ${e.message || e}${/permission|403/i.test(String(e.message)) ? " — deel de sheet als Bewerker met attoh-sheets@attoh-tools.iam.gserviceaccount.com." : ""}` });
      sfx("error");
    } finally {
      setBusy("");
    }
  }

  async function boosterDone(run) {
    if (busy) return;
    if (!window.confirm(`Boost "${run.tab}" klaar melden?\n\nHet blad wordt verborgen en het boost-venster van ${run.windowDays} dagen start — die ${run.products} producten worden tot die tijd niet gedraft.`)) return;
    setBusy("bdone");
    try {
      const r = await apiCvr({ action: "done", store: { domain: store.domain }, tab: run.tab });
      push({ ok: true, text: `✓ Boost "${run.tab}" klaar — blad verborgen, venster loopt t/m dag ${r.run.windowDays}.` });
      setResult((res) => ({ ...res, rows: res.rows.map((x) => (x.boost && x.boost.tab === run.tab && x.boost.status === "open" ? { ...x, boost: { ...x.boost, status: "venster", day: 1, doneAt: r.run.doneAt } } : x)) }));
      await refreshRuns();
      sfx("success");
    } catch (e) {
      push({ err: true, text: `Klaar melden mislukt: ${e.message || e}` });
      sfx("error");
    } finally {
      setBusy("");
    }
  }
  async function boosterShow(run, hidden) {
    if (busy) return;
    setBusy("bshow");
    try {
      await apiCvr({ action: "show", store: { domain: store.domain }, tab: run.tab, hidden });
      push({ ok: true, text: `✓ Blad "${run.tab}" ${hidden ? "verborgen" : "weer zichtbaar"}.` });
      await refreshRuns();
    } catch (e) {
      push({ err: true, text: `Mislukt: ${e.message || e}` });
    } finally {
      setBusy("");
    }
  }
  async function boosterReopen(run) {
    if (busy) return;
    if (!window.confirm(`Boost "${run.tab}" heropenen? Het venster en het gemeten effect worden gewist; de producten worden weer niet gedraft tot je opnieuw Klaar meldt.`)) return;
    setBusy("breopen");
    try {
      await apiCvr({ action: "reopen", store: { domain: store.domain }, tab: run.tab });
      push({ ok: true, text: `✓ Boost "${run.tab}" heropend.` });
      setResult((res) => ({ ...res, rows: res.rows.map((x) => (x.boost && x.boost.tab === run.tab ? { ...x, boost: { ...x.boost, status: "open", active: true, effect: null, effectText: "" } } : x)) }));
      await refreshRuns();
    } catch (e) {
      push({ err: true, text: `Mislukt: ${e.message || e}` });
    } finally {
      setBusy("");
    }
  }

  /* ---------------- tabel ---------------- */

  const ADV_ORDER = Object.fromEntries(ADVIES.map((a, i) => [a, i]));
  const SORT = {
    advies: (x) => ADV_ORDER[x.advies] ?? 99,
    title: (x) => String(x.title || "").toLowerCase(),
    age: (x) => (x.age == null ? -1 : x.age),
    s7: (x) => x.per[7].spend, o7: (x) => x.per[7].orders, r7: (x) => (x.per[7].roas == null ? -1 : x.per[7].roas),
    s14: (x) => x.per[14].spend, o14: (x) => x.per[14].orders, r14: (x) => (x.per[14].roas == null ? -1 : x.per[14].roas),
    s30: (x) => x.per[30].spend, c30: (x) => x.per[30].clicks, o30: (x) => x.per[30].orders, v30: (x) => x.per[30].rev,
    r30: (x) => (x.per[30].roas == null ? -1 : x.per[30].roas), g30: (x) => x.per[30].conv, p30: (x) => x.profit30,
  };
  const rows = useMemo(() => {
    if (!result) return [];
    const needle = q.trim().toLowerCase();
    let list = result.rows.filter((x) => (filter === "Alles" || (filter === "In boost" ? x.boost && x.boost.active : x.advies === filter)) && (!needle || String(x.title || "").toLowerCase().includes(needle)));
    if (sort.key && SORT[sort.key]) {
      const get = SORT[sort.key];
      const m = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * m;
      });
    }
    return list;
  }, [result, filter, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  // klik op een kolomkop: eerst hoog → laag (tekst: A → Z), nog een klik draait om, derde klik = standaard
  const sortBy = (key) =>
    setSort((s) => {
      const first = key === "title" || key === "advies" ? "asc" : "desc";
      if (s.key !== key) return { key, dir: first };
      if (s.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
      return { key: "", dir: "desc" };
    });
  const Th = ({ k, children, l, g, title }) => (
    <th className={(l ? "l " : "") + (g ? "gl " : "") + "py-sort" + (sort.key === k ? " on" : "")} onClick={() => sortBy(k)} title={title || "Klik om te sorteren"}>
      {children}
      <span className="py-arrow">{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </th>
  );
  const RW = result ? result.settings.ruleWindow : 30;
  const cur = result ? (result.adsCurrency === "GBP" ? "£" : result.adsCurrency === "EUR" ? "€" : result.adsCurrency === "USD" ? "$" : "") : "£";
  const money = (n) => (n == null ? "—" : `${cur}${Number(n).toFixed(2)}`);
  const roasCell = (v) => {
    if (v == null) return <span style={{ color: "var(--faint)" }}>—</span>;
    const be = result.settings.breakEvenRoas;
    return <span style={{ color: v >= be ? "var(--ok)" : v > 0 ? "var(--warn)" : "var(--err)" }}>{v.toFixed(2)}</span>;
  };
  const draftable = (x) => x.productId && x.status === "active" && !x.drafted;
  const inBoostCount = result ? result.rows.filter((x) => x.boost && x.boost.active).length : 0;
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  function selectAllDraften() {
    const all = result.rows.filter((x) => x.advies === "Draften" && draftable(x));
    const skip = all.filter((x) => x.boost && x.boost.active);
    setPicked(new Set(all.filter((x) => !(x.boost && x.boost.active)).map((x) => x.productId)));
    if (skip.length) push({ text: `Selecteer alle Draften: ${skip.length} product(en) in een lopende boost overgeslagen (vink ze handmatig aan als je ze toch wilt draften).` });
  }
  const shopSym = result ? (result.shopCurrency === "USD" ? "$" : result.shopCurrency === "AUD" ? "A$" : result.shopCurrency === "NZD" ? "NZ$" : result.shopCurrency === "GBP" ? "£" : result.shopCurrency === "EUR" ? "€" : `${result.shopCurrency} `) : "";
  const activeRuns = runs.filter((r) => r.status !== "klaar");
  const doneRuns = runs.filter((r) => r.status === "klaar");

  return (
    <>
      <Header icon="Π" title="Pythago" subtitle="Spend per product (Google Ads) naast de echte verkopen (Shopify)" />
      <style>{`
        .py-files { display: grid; gap: 6px; margin-top: 10px; }
        .py-file { font-size: 12.5px; color: var(--ink-2); border: 1px solid var(--line); border-radius: 9px; padding: 7px 10px; display: flex; justify-content: space-between; gap: 10px; }
        .py-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
        .py-grid input, .py-grid select { width: 100%; }
        .py-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
        .py-tile { border: 1px solid var(--line); border-radius: 11px; padding: 10px 12px; background: rgba(255,255,255,0.02); }
        .py-tile .k { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--faint); }
        .py-tile .v { font-size: 17px; font-weight: 600; color: var(--ink); margin-top: 3px; font-variant-numeric: tabular-nums; }
        .py-tile .s { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
        .py-wrap { overflow: auto; max-height: 72vh; border: 1px solid var(--line); border-radius: 12px; }
        .py-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; font-variant-numeric: tabular-nums; }
        .py-table th { position: sticky; background: #15151b; color: var(--muted); font-weight: 600; text-align: right; padding: 8px 10px; font-size: 11px; white-space: nowrap; border-bottom: 1px solid var(--line); z-index: 2; }
        .py-table thead tr:first-child th { top: 0; height: 30px; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); }
        .py-table thead tr:nth-child(2) th { top: 30px; }
        .py-table th.l, .py-table td.l { text-align: left; }
        .py-table th.grp { text-align: center; border-left: 1px solid var(--line-hi); }
        .py-table .gl { border-left: 1px solid var(--line-hi); }
        .py-sort { cursor: pointer; user-select: none; }
        .py-sort:hover { color: var(--ink); }
        .py-sort.on { color: var(--accent-hi); }
        .py-arrow { margin-left: 5px; font-size: 9px; opacity: .55; }
        .py-sort.on .py-arrow { opacity: 1; }
        .py-table td { padding: 8px 10px; border-top: 1px solid var(--line); text-align: right; color: var(--ink-2); white-space: nowrap; }
        .py-table tbody tr:nth-child(even) td { background: rgba(255,255,255,0.015); }
        .py-table tbody tr:hover td { background: var(--panel-hi); }
        .py-table td.t { min-width: 260px; max-width: 380px; white-space: normal; color: var(--ink); line-height: 1.35; }
        .py-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .py-meta { margin-top: 4px; font-size: 11px; color: var(--muted); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .py-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; border: 1px solid currentColor; }
        .py-search { width: 220px; }
        .py-img { display: block; width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); background: rgba(255,255,255,0.04); }
        .py-noimg { display: inline-block; }
        .py-table td { vertical-align: middle; }
        .py-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: middle; }
        /* Conversion Booster */
        .cb-cats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
        .cb-cat { display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border: 1px solid var(--line); border-radius: 99px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; user-select: none; }
        .cb-cat.on { border-color: var(--accent); color: var(--ink); background: rgba(255,255,255,0.03); }
        .cb-cat input { margin: 0; }
        .cb-cat .n { color: var(--muted); font-size: 11px; }
        .cb-grid { display: grid; grid-template-columns: repeat(5, minmax(120px, 180px)); gap: 8px 12px; align-items: end; }
        .cb-grid input { width: 100%; }
        .cb-sum { border: 1px solid var(--line); border-radius: 11px; padding: 10px 12px; margin: 12px 0; font-size: 13px; line-height: 1.5; color: var(--ink-2); white-space: pre-line; }
        .cb-sum b { color: var(--ink); }
        .cb-bar { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 10px; }
        .cb-bar input[type="text"] { width: 200px; }
        .py-table td.cb-txt { white-space: normal; min-width: 260px; max-width: 420px; text-align: left; color: var(--ink-2); font-size: 12.5px; line-height: 1.4; }
        .py-table td.cb-txt ol { margin: 0; padding-left: 16px; }
        .cb-runs { display: grid; gap: 6px; margin-top: 8px; }
        .cb-run { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; border: 1px solid var(--line); border-radius: 9px; padding: 8px 11px; font-size: 12.5px; color: var(--ink-2); }
        .cb-run b { color: var(--ink); }
        .cb-run .acts { display: flex; gap: 6px; flex-wrap: wrap; }
        .cb-skip { margin-top: 10px; font-size: 12px; color: var(--muted); }
        .cb-skip summary { cursor: pointer; }
        .cb-skip ul { margin: 6px 0 0; padding-left: 18px; }
        @media (max-width: 1100px) { .py-tiles { grid-template-columns: 1fr 1fr; } .cb-grid { grid-template-columns: 1fr 1fr; } }
      `}</style>
      <div className="page layout-scraper" style={result ? { paddingBottom: 0 } : undefined}>
        <div>
          <div className="card">
            <h2>1 · Store</h2>
            {stores.length === 0 ? (
              <div className="center-note">Koppel eerst een store in de Importer.</div>
            ) : (
              <select value={sel} onChange={(e) => pickStore(e.target.value)} disabled={!!busy} style={{ width: "100%" }}>
                <option value="">— kies een store —</option>
                {stores.map((s) => (
                  <option key={s.domain} value={s.domain}>
                    {s.name || s.domain} {s.currency ? `(${s.currency})` : ""}
                  </option>
                ))}
              </select>
            )}
            {store && (
              <div className="hint">
                Producten + draften: Importer-koppeling. Orders:{" "}
                {ordersKeys ? <b>Orders-app ✓</b> : <span style={{ color: "var(--warn)" }}>geen Orders-app-sleutels — vul ze in op de Bills-pagina (anders proberen we de Importer-koppeling)</span>}
              </div>
            )}
          </div>

          <div
            className="card"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            style={dragOver ? { outline: "1px solid var(--accent)", outlineOffset: 2 } : undefined}
          >
            <h2>2 · Google Ads-export</h2>
            <div className="hint" style={{ marginTop: 0 }}>
              Google Ads → <b>Campagnes → Producten</b> → periode <b>Afgelopen 30 dagen</b> → <b>Segment → Tijd → Dag</b> → kolommen
              Item-ID, Kosten, Klikken, Conversies en Conv.waarde aan → <b>Downloaden → .csv</b>. Sleep het bestand hierin.
              (Drie losse exports van 30, 14 en 7 dagen zonder segment mag ook.)
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv,.tsv,.txt" multiple style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-ghost" onClick={() => fileRef.current && fileRef.current.click()} disabled={!!busy}>
                Kies CSV
              </button>
              {files.length > 0 && (
                <button className="btn-ghost" onClick={() => { setFiles([]); setResult(null); }} disabled={!!busy}>
                  Wissen
                </button>
              )}
            </div>
            {files.length > 0 && (
              <div className="py-files">
                {files.map((f) => (
                  <div className="py-file" key={f.name}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                    {f.parsed ? (
                      <span style={{ color: "var(--ok)", whiteSpace: "nowrap" }}>
                        {f.parsed.rows.length} regels · {f.parsed.hasDay ? "per dag" : "totaal"}
                        {f.parsed.period ? ` · ${f.parsed.period.from} → ${f.parsed.period.to}` : ""}
                      </span>
                    ) : (
                      <span style={{ color: "var(--err)" }}>{f.error}</span>
                    )}
                  </div>
                ))}
                {combined && combined.warnings.map((w, i) => (
                  <div key={i} className="hint" style={{ color: "var(--warn)", margin: 0 }}>{w}</div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2>3 · Regels</h2>
            <div className="py-grid">
              <div>
                <div className="field-label">COGS %</div>
                <input type="number" step="0.1" value={settings.cogsPct} onChange={(e) => setS("cogsPct", e.target.value)} />
              </div>
              <div>
                <div className="field-label">Fees %</div>
                <input type="number" step="0.1" value={settings.feePct} onChange={(e) => setS("feePct", e.target.value)} />
              </div>
              <div>
                <div className="field-label">Draft-drempel (spend)</div>
                <input type="number" step="0.5" value={settings.threshold} onChange={(e) => setS("threshold", e.target.value)} />
              </div>
              <div>
                <div className="field-label">Regelvenster</div>
                <select value={settings.ruleWindow} onChange={(e) => setS("ruleWindow", Number(e.target.value))}>
                  <option value={30}>30 dagen</option>
                  <option value={14}>14 dagen</option>
                </select>
              </div>
              <div>
                <div className="field-label">Min. dagen live</div>
                <input type="number" value={settings.minAge} onChange={(e) => setS("minAge", e.target.value)} />
              </div>
              <div>
                <div className="field-label">Koers <span className="opt">(leeg = automatisch)</span></div>
                <input type="text" placeholder={result ? String(result.fx.rate) : "auto"} value={fxOverride} onChange={(e) => setFxOverride(e.target.value)} />
              </div>
            </div>
            <div className="hint">
              Break-even ROAS = 1 / (1 − COGS − fees) ={" "}
              <b>{(1 / Math.max(0.05, 1 - Number(settings.cogsPct || 0) / 100 - Number(settings.feePct || 0) / 100)).toFixed(2)}</b>. Draften = spend ≥ drempel in het
              regelvenster, 0 verkopen in Shopify én 0 Google-conversies, product minstens {settings.minAge || 0} dagen live.
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={analyse} disabled={!canAnalyse}>
                {busy === "analyse" ? "Bezig…" : "Analyseren"}
              </button>
            </div>
          </div>

          {result && (
            <div className="card">
              <h2>4 · Naar sheet <span className="opt">(optioneel)</span></h2>
              <div className="field-label">Google Sheet <span className="opt">(standaard de P&L-sheet van de store · ook voor de Conversion Booster)</span></div>
              <input type="text" placeholder="link van de sheet (gedeeld met de service account)" value={sheet} onChange={(e) => setSheet(e.target.value)} style={{ width: "100%" }} />
              <div className="field-label">Bladnaam</div>
              <input type="text" value={tab} onChange={(e) => setTab(e.target.value)} style={{ width: "100%" }} />
              <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn" onClick={writeSheet} disabled={!!busy || !sheet.trim() || !tab.trim()}>
                  {busy === "write" ? "Bezig…" : "Schrijf naar sheet"}
                </button>
                {doneUrl && (
                  <a className="linklike" href={doneUrl} target="_blank" rel="noreferrer noopener">
                    Openen ↗
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h2>Log {busy && <span className="opt">— bezig</span>}</h2>
            {logs.length === 0 && !busy && (
              <div className="center-note" style={{ padding: "18px 8px" }}>
                Kies een store, sleep de Google Ads-export erin en druk op Analyseren.
              </div>
            )}
            <div className="logpanel">
              {logs.map((l, i) => (
                <div key={i} className={"logline" + (l.err ? " err" : l.ok ? " ok" : l.strong ? " strong" : "")}>
                  {l.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="page" style={{ paddingTop: 22, maxWidth: 1640, display: result ? "grid" : "none" }}>
          {result && (
            <div className="card">
              <h2>
                {result.store.name || result.store.domain} <span className="opt">· {result.period.from} t/m {result.period.to}</span>
              </h2>
              <div className="py-tiles">
                {[7, 14, 30].map((w) => (
                  <div className="py-tile" key={w}>
                    <div className="k">{(result.windowDays && result.windowDays[w]) || w} dagen</div>
                    <div className="v">{money(result.totals[w].spend)}</div>
                    <div className="s">
                      omzet {money(result.totals[w].rev)} · ROAS {result.totals[w].roas == null ? "—" : result.totals[w].roas.toFixed(2)}
                    </div>
                  </div>
                ))}
                <div className="py-tile">
                  <div className="k">Draft-kandidaten</div>
                  <div className="v" style={{ color: result.counts.Draften ? "var(--err)" : "var(--ok)" }}>{result.counts.Draften || 0}</div>
                  <div className="s">
                    {money(result.draftSpend)} spend zonder verkoop ({RW} d){inBoostCount ? ` · ${inBoostCount} in boost` : ""}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 10 }}>
                <div className="seg">
                  {["Alles", ...ADVIES].filter((a) => a === "Alles" || result.counts[a]).map((a) => (
                    <button key={a} className={filter === a ? "on" : ""} onClick={() => setFilter(a)} type="button">
                      {a !== "Alles" && <span className="py-dot" style={{ background: TONE[a] }} />}
                      {a} {a === "Alles" ? result.rows.length : result.counts[a]}
                    </button>
                  ))}
                  {inBoostCount > 0 && (
                    <button className={filter === "In boost" ? "on" : ""} onClick={() => setFilter("In boost")} type="button">
                      <span className="py-dot" style={{ background: BOOST_TONE }} />
                      In boost {inBoostCount}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input className="py-search" type="text" placeholder="Zoek product…" value={q} onChange={(e) => setQ(e.target.value)} />
                  {sort.key && (
                    <button className="btn-ghost btn-small" type="button" onClick={() => setSort({ key: "", dir: "desc" })}>
                      Sortering wissen
                    </button>
                  )}
                  {result.counts.Draften > 0 && (
                    <button className="btn-ghost btn-small" type="button" disabled={!!busy} onClick={selectAllDraften} title="Producten in een lopende boost worden overgeslagen">
                      Selecteer alle Draften
                    </button>
                  )}
                  <button className="btn btn-small" type="button" onClick={draftPicked} disabled={!!busy || picked.size === 0}>
                    {busy === "draft" ? "Bezig…" : `Draft geselecteerde (${picked.size})`}
                  </button>
                </div>
              </div>

              <div className="py-wrap">
                <table className="py-table">
                  <thead>
                    <tr>
                      <th className="l" colSpan={4} />
                      <th className="grp" colSpan={3}>{(result.windowDays && result.windowDays[7]) || 7} dagen</th>
                      <th className="grp" colSpan={3}>{(result.windowDays && result.windowDays[14]) || 14} dagen</th>
                      <th className="grp" colSpan={6}>{(result.windowDays && result.windowDays[30]) || 30} dagen</th>
                      <th className="grp" />
                    </tr>
                    <tr>
                      <th className="l" />
                      <th className="l">Foto</th>
                      <Th k="title" l>Product</Th>
                      <Th k="age" title="Dagen sinds het product live staat">Dagen live</Th>
                      <Th k="s7" g>Spend</Th>
                      <Th k="o7">Orders</Th>
                      <Th k="r7">ROAS</Th>
                      <Th k="s14" g>Spend</Th>
                      <Th k="o14">Orders</Th>
                      <Th k="r14">ROAS</Th>
                      <Th k="s30" g>Spend</Th>
                      <Th k="c30">Klikken</Th>
                      <Th k="o30">Orders</Th>
                      <Th k="v30">Omzet</Th>
                      <Th k="r30">ROAS</Th>
                      <Th k="g30" title="Google-conversies (TrackBee) in 30 dagen">G-conv</Th>
                      <Th k="p30" g title="Omzet × (1 − COGS − fees) − spend, 30 dagen">Winst 30d</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td className="l" colSpan={17} style={{ color: "var(--muted)", padding: 18 }}>
                          Geen producten in deze selectie.
                        </td>
                      </tr>
                    )}
                    {rows.map((x) => {
                      const bl = boostLabel(x.boost);
                      return (
                        <tr key={x.productId || x.title}>
                          <td className="l">
                            {draftable(x) ? <input type="checkbox" checked={picked.has(x.productId)} onChange={() => toggle(x.productId)} disabled={!!busy} /> : null}
                          </td>
                          <td className="l">
                            {x.image ? (
                              <a href={x.image.replace(/([?&])width=\d+/, "$1width=800")} target="_blank" rel="noreferrer noopener">
                                <img className="py-img" src={x.image} alt="" loading="lazy" />
                              </a>
                            ) : (
                              <span className="py-img py-noimg" />
                            )}
                          </td>
                          <td className="l t" title={x.title}>
                            <div className="py-title">
                              {x.productId && x.status && result.store.domain ? (
                                <a className="linklike" href={`https://${result.store.domain}/admin/products/${x.productId}`} target="_blank" rel="noreferrer noopener">
                                  {x.title}
                                </a>
                              ) : (
                                x.title
                              )}
                            </div>
                            <div className="py-meta">
                              <span className="py-pill" style={{ color: TONE[x.advies] }}>
                                {x.advies}
                              </span>
                              {bl && (
                                <span className="py-pill" style={{ color: bl.color }} title={bl.title}>
                                  {bl.text}
                                </span>
                              )}
                              {x.variants > 1 && <span>{x.variants} varianten met spend</span>}
                              {x.status && x.status !== "active" && <span>{x.status}</span>}
                            </div>
                          </td>
                          <td>{x.age ?? "—"}</td>
                          <td className="gl">{money(x.per[7].spend)}</td>
                          <td>{x.per[7].orders}</td>
                          <td>{roasCell(x.per[7].roas)}</td>
                          <td className="gl">{money(x.per[14].spend)}</td>
                          <td>{x.per[14].orders}</td>
                          <td>{roasCell(x.per[14].roas)}</td>
                          <td className="gl">{money(x.per[30].spend)}</td>
                          <td>{x.per[30].clicks}</td>
                          <td>{x.per[30].orders}</td>
                          <td>{money(x.per[30].rev)}</td>
                          <td>{roasCell(x.per[30].roas)}</td>
                          <td>{x.per[30].conv}</td>
                          <td className="gl" style={{ color: x.profit30 >= 0 ? "var(--ok)" : "var(--err)", fontWeight: 600 }}>{money(x.profit30)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="hint">
                ROAS = Shopify-omzet ({result.shopCurrency} → {result.adsCurrency}, koers {result.fx.rate}) / Google Ads-spend. Groen ≥ break-even {result.settings.breakEvenRoas}, oranje
                eronder, rood = spend zonder omzet. Orders zijn álle Shopify-orders van het product in die dagen (niet alleen via Google).
                {inBoostCount > 0 && <> Producten met een blauw boost-label zitten in een lopende Conversion Boost en worden door "Selecteer alle Draften" overgeslagen.</>}
              </div>
            </div>
          )}

          {result && (
            <div className="card">
              <h2>
                Conversion Booster <span className="opt">— vóór het draften eerst een kans: AI kijkt per product wat er aan de listing mis is</span>
              </h2>
              <div className="cb-cats">
                {CVR_CATS.map((c) => (
                  <label key={c} className={"cb-cat" + (cvr.categories.includes(c) ? " on" : "")}>
                    <input type="checkbox" checked={cvr.categories.includes(c)} onChange={() => toggleCat(c)} disabled={!!busy} />
                    <span className="py-dot" style={{ background: TONE[c], marginRight: 0 }} />
                    {c} <span className="n">{result.counts[c] || 0}</span>
                  </label>
                ))}
              </div>
              <div className="cb-grid">
                <div>
                  <div className="field-label">Min. klikken (30 d)</div>
                  <input type="number" value={cvr.minClicks} onChange={(e) => setC("minClicks", e.target.value)} title="Minder klikken = te weinig data om over conversie te oordelen → Afwachten" />
                </div>
                <div>
                  <div className="field-label">Max producten per run</div>
                  <input type="number" value={cvr.maxPerRun} onChange={(e) => setC("maxPerRun", e.target.value)} title="Hoogste spend eerst (max 40)" />
                </div>
                <div>
                  <div className="field-label">Boost-venster (dagen)</div>
                  <input type="number" value={cvr.windowDays} onChange={(e) => setC("windowDays", e.target.value)} title="Zo lang wordt een geboost product niet gedraft nadat je Klaar hebt gemeld" />
                </div>
                <div>
                  <div className="field-label">Opnieuw boosten</div>
                  <label className="cb-cat" style={{ padding: "7px 11px" }}>
                    <input type="checkbox" checked={!!cvr.allowRepeat} onChange={(e) => setC("allowRepeat", e.target.checked)} disabled={!!busy} />
                    na "geen effect"
                  </label>
                </div>
                <div>
                  <button className="btn" onClick={boosterAnalyse} disabled={!!busy || !cvr.categories.length} style={{ width: "100%" }}>
                    {busy === "booster" ? "AI kijkt…" : "1 · Analyseer (AI)"}
                  </button>
                </div>
              </div>
              <div className="hint">
                Kandidaten = actieve producten in de aangevinkte categorieën, minstens {cvr.minClicks || 0} klikken in 30 dagen, niet al in een boost. De AI ziet per product de cijfers (7/14/30 d),
                titel, begin van de omschrijving, foto 1, prijs/compare-at, varianten en voorraad, size guide en hoe de rest van het producttype in deze run doet. Oordeel: <b>Boost</b> (aanwijsbaar listing-probleem, gaat naar Claude) ·{" "}
                <b>Draft nu</b> (niets fixbaars, gewoon draften) · <b>Laten lopen</b>. Analyseren schrijft niets.
              </div>

              {bRun && (
                <>
                  <div className="cb-sum">
                    <b>{bRun.stat}</b>
                    {bRun.summary ? `\n${bRun.summary}` : ""}
                  </div>
                  <div className="cb-bar">
                    <div className="seg">
                      {["Alles", ...VERDICTS].filter((v) => v === "Alles" || bRun.counts[v]).map((v) => (
                        <button key={v} className={bFilter === v ? "on" : ""} onClick={() => setBFilter(v)} type="button">
                          {v !== "Alles" && <span className="py-dot" style={{ background: VTONE[v] }} />}
                          {v} {v === "Alles" ? bRun.items.length : bRun.counts[v]}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button className="btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => setBPicked(new Set(bRun.items.filter((it) => it.ai.verdict === "Boost").map((it) => it.productId)))}>
                        Selecteer alle Boost
                      </button>
                      <span className="field-label" style={{ margin: 0 }}>Bladnaam</span>
                      <input type="text" value={bTab} onChange={(e) => setBTab(e.target.value)} placeholder={bRun.tabSuggestion} />
                      <button className="btn btn-small" type="button" onClick={boosterWrite} disabled={!!busy || bPicked.size === 0 || !sheet.trim()} title={!sheet.trim() ? "Vul bij 4 · Naar sheet de sheet van de store in" : "Blad + CVR Log schrijven en de tekst voor Claude op het klembord zetten"}>
                        {busy === "bwrite" ? "Bezig…" : `2 · Schrijf naar sheet + kopieer voor Claude (${bPicked.size})`}
                      </button>
                      {bDone && (
                        <>
                          <button className="btn-ghost btn-small" type="button" onClick={async () => push((await copyText(bDone.text)) ? { ok: true, text: "✓ Tekst voor Claude opnieuw gekopieerd." } : { err: true, text: "Klembord geweigerd — open het blad en kopieer vandaar." })}>
                            Kopieer opnieuw
                          </button>
                          <a className="linklike" href={bDone.url} target="_blank" rel="noreferrer noopener">
                            Openen ↗
                          </a>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="py-wrap" style={{ maxHeight: "64vh" }}>
                    <table className="py-table">
                      <thead>
                        <tr>
                          <th className="l" />
                          <th className="l">Foto</th>
                          <th className="l">Product</th>
                          <th>Prio</th>
                          <th className="l">Oorzaak</th>
                          <th className="l">Verslag (AI)</th>
                          <th className="l">Acties (AI)</th>
                          <th className="gl">Spend 30d</th>
                          <th>Klikken</th>
                          <th>CTR</th>
                          <th>Orders</th>
                          <th>ROAS</th>
                          <th className="gl">Prijs</th>
                          <th>Foto's</th>
                          <th>Uitverkocht</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bItems.length === 0 && (
                          <tr>
                            <td className="l" colSpan={15} style={{ color: "var(--muted)", padding: 18 }}>
                              Geen producten in deze selectie.
                            </td>
                          </tr>
                        )}
                        {bItems.map((it) => (
                          <tr key={it.productId}>
                            <td className="l">
                              <input type="checkbox" checked={bPicked.has(it.productId)} onChange={() => bToggle(it.productId)} disabled={!!busy} />
                            </td>
                            <td className="l">
                              {it.image ? (
                                <a href={it.image.replace(/([?&])width=\d+/, "$1width=800")} target="_blank" rel="noreferrer noopener">
                                  <img className="py-img" src={it.image} alt="" loading="lazy" />
                                </a>
                              ) : (
                                <span className="py-img py-noimg" />
                              )}
                            </td>
                            <td className="l t" title={it.title}>
                              <div className="py-title">
                                <a className="linklike" href={it.adminUrl} target="_blank" rel="noreferrer noopener">
                                  {it.title}
                                </a>
                              </div>
                              <div className="py-meta">
                                <span className="py-pill" style={{ color: VTONE[it.ai.verdict] }}>{it.ai.verdict}</span>
                                <span className="py-pill" style={{ color: TONE[it.advies] }}>{it.advies}</span>
                                {it.type && <span>{it.type}</span>}
                                {it.storeUrl && (
                                  <a className="linklike" href={it.storeUrl} target="_blank" rel="noreferrer noopener">
                                    store ↗
                                  </a>
                                )}
                              </div>
                            </td>
                            <td>{it.ai.prio ?? "—"}</td>
                            <td className="l">{it.ai.cause || "—"}</td>
                            <td className="cb-txt">{it.ai.report || "—"}</td>
                            <td className="cb-txt">
                              {it.ai.actions && it.ai.actions.length ? (
                                <ol>
                                  {it.ai.actions.map((a, i) => (
                                    <li key={i}>{a}</li>
                                  ))}
                                </ol>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="gl">{money(it.m.spend30)}</td>
                            <td>{it.m.clicks30}</td>
                            <td>{it.m.ctr == null ? "—" : `${(it.m.ctr * 100).toFixed(1)}%`}</td>
                            <td>{it.m.orders30}</td>
                            <td>{roasCell(it.m.roas30)}</td>
                            <td className="gl">
                              {it.listing.price == null ? "—" : `${shopSym}${Number(it.listing.price).toFixed(2)}`}
                              {it.listing.compareAt ? <span style={{ color: "var(--muted)" }}> / {shopSym}{Number(it.listing.compareAt).toFixed(2)}</span> : null}
                            </td>
                            <td>{it.listing.images ?? "—"}</td>
                            <td title={(it.listing.soldOutNames || []).join(", ")} style={{ color: it.listing.soldOut ? "var(--warn)" : undefined }}>
                              {it.listing.soldOut || 0}/{it.listing.variants ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(bRun.waiting.length > 0 || bRun.boosted.length > 0 || bRun.overflow.length > 0) && (
                    <details className="cb-skip">
                      <summary>
                        Niet beoordeeld: {bRun.waiting.length} afwachten (minder dan {cvr.minClicks} klikken){bRun.boosted.length ? ` · ${bRun.boosted.length} al geboost` : ""}{bRun.overflow.length ? ` · ${bRun.overflow.length} boven het maximum van ${bRun.settings.maxPerRun}` : ""}
                      </summary>
                      <ul>
                        {bRun.waiting.slice(0, 40).map((w) => (
                          <li key={w.productId}>{w.title} — {w.advies}, {w.clicks} klikken, {money(w.spend)}</li>
                        ))}
                        {bRun.boosted.map((w) => (
                          <li key={w.productId}>{w.title} — {w.reason}</li>
                        ))}
                        {bRun.overflow.slice(0, 40).map((w) => (
                          <li key={w.productId}>{w.title} — {w.advies}, {money(w.spend)} (volgende run)</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="hint">
                    Stap 2 schrijft het blad "{bTab || bRun.tabSuggestion}" in de sheet van stap 4 (kleur per verdict, met foto, verslag en acties), zet elke rij in het blad "CVR Log" en kopieert de tekst voor
                    Claude. Plak die in de chat, of zeg daar "doe {bTab || bRun.tabSuggestion} van {result.store.name || result.store.domain}". Is Claude klaar → hieronder <b>Klaar</b>: blad verborgen, boost-venster van {cvr.windowDays} dagen start.
                  </div>
                </>
              )}

              <h2 style={{ marginTop: 18 }}>
                Lopende boosts <span className="opt">{activeRuns.length ? `· ${activeRuns.length}` : "· geen"}</span>
              </h2>
              {activeRuns.length === 0 && doneRuns.length === 0 && <div className="hint" style={{ marginTop: 0 }}>Nog geen boosts voor deze store.</div>}
              <div className="cb-runs">
                {activeRuns.map((r) => (
                  <div className="cb-run" key={r.tab + (r.createdAt || "")}>
                    <div>
                      <b>{r.tab}</b> · {r.products} product{r.products === 1 ? "" : "en"} ·{" "}
                      {r.status === "open" ? (
                        <span style={{ color: BOOST_TONE }}>open — wacht op Claude{r.createdAt ? ` (sinds ${ddmm(r.createdAt)})` : ""}</span>
                      ) : (
                        <span style={{ color: "var(--ok)" }}>klaar op {ddmm(r.doneAt)} · venster dag {r.day}/{r.windowDays}</span>
                      )}
                      {r.hidden ? " · blad verborgen" : ""}
                    </div>
                    <div className="acts">
                      {r.url && (
                        <a className="linklike" href={r.url} target="_blank" rel="noreferrer noopener">
                          Blad ↗
                        </a>
                      )}
                      {r.status === "open" ? (
                        <button className="btn btn-small" type="button" disabled={!!busy} onClick={() => boosterDone(r)}>
                          Klaar → blad verbergen
                        </button>
                      ) : (
                        <>
                          <button className="btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => boosterShow(r, !r.hidden)}>
                            {r.hidden ? "Toon blad" : "Verberg blad"}
                          </button>
                          <button className="btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => boosterReopen(r)}>
                            Heropen
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {doneRuns.length > 0 && (
                <details className="cb-skip">
                  <summary>Afgeronde boosts: {doneRuns.length}</summary>
                  <div className="cb-runs">
                    {doneRuns.map((r) => (
                      <div className="cb-run" key={r.tab + (r.createdAt || "")}>
                        <div>
                          <b>{r.tab}</b> · {r.products} product{r.products === 1 ? "" : "en"} · klaar op {ddmm(r.doneAt)} ·{" "}
                          {Object.keys(r.effects || {}).length ? Object.entries(r.effects).map(([k, v]) => `${k} ${v}`).join(" · ") : "effect nog niet gemeten (volgende Pythago-run)"}
                          {r.hidden ? " · blad verborgen" : ""}
                        </div>
                        <div className="acts">
                          {r.url && (
                            <a className="linklike" href={r.url} target="_blank" rel="noreferrer noopener">
                              Blad ↗
                            </a>
                          )}
                          <button className="btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => boosterShow(r, !r.hidden)}>
                            {r.hidden ? "Toon blad" : "Verberg blad"}
                          </button>
                          <button className="btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => boosterReopen(r)}>
                            Heropen
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
      </div>
    </>
  );
}
