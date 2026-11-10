"use client";

// PYTHAGO-DASHBOARD (03-11-2026, projectdoc 103) — Pythago (app.pythago.io)
// nagebouwd in Attoh Tools: zelfde dashboard, filters, opgeslagen filters,
// tags, kolommen, acties en background tasks, in de stijl van de tool.
//
// Data komt niet meer uit CSV-exports maar uit een sync (lib/pythago-sync.js):
// Google Ads per product via het script scripts/google-ads-products.js → tab
// Prod_<KEY> in "Attoh Ads Live", Shopify-orders/refunds via de Orders-app,
// producten via de Importer-koppeling. Het resultaat staat in Redis; de pagina
// synct zelf bij openen als de data ouder is dan 6 uur, en elke nacht via de
// cron (/api/pythago/cron) voor stores met "automatisch syncen" aan.
//
// Klassieke flow (CSV) + Conversion Booster: /pythago/booster — de knop
// "Conversion Booster" geeft het gesynchroniseerde resultaat daar door.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { sfx } from "../components/sfx";
import { orgLS } from "@/lib/org-client";
import "./pythago.css";

const LS_STORES = "sa_stores";
const LS_STORE = "sa_py_store";
const LS_SETTINGS = "sa_py_settings::"; // + domein (zelfde als de klassieke pagina)
const LS_ORDERS_APP = "sa_orders_app::"; // + domein (Bills-pagina)
const LS_ADS_SHEET = "attoh_dash_ads_sheet"; // zelfde sheet als het omzet-dashboard
const LS_DASH_CFG = "attoh_dash_cfg"; // domein → { key, on } (omzet-dashboard)
const LS_KEY = "sa_py_key::"; // + domein → SSB/LGB/…
const LS_COLS = "sa_py_cols::"; // + domein → { order, hidden, img }
const LS_VIEW = "sa_py_view::"; // + domein → { period, perPage }
const DEFAULT_ADS_SHEET = "1xac7M4--kCb2DKShQy7s2A13sgfl4NxW8CXbLGW4H8o";
// store → sleutel van de Ads-tabs (zelfde lijst als het omzet-dashboard; per store aan te passen)
const KNOWN = [
  { key: "SSB", match: /soul\s*society|0d6n10-zj/i },
  { key: "LGB", match: /lady\s*glam|lornvale|hu9f6r-ee/i },
  { key: "EMC", match: /everman|va3wjr-27/i },
  { key: "SW", match: /shapes\s*wardrobe|shapeswardrobe|6snnji-kr/i },
  { key: "CC", match: /clove|dyjxwd-p0/i },
];
const guessKey = (s) => {
  if (!s) return "";
  const hay = `${s.name || ""} ${s.domain || ""}`;
  const hit = KNOWN.find((k) => k.match.test(hay));
  return hit ? hit.key : "";
};
const DEFAULTS = { cogsPct: 35, feePct: 4.4, threshold: 5, ruleWindow: 30, minAge: 14, adsCurrency: "GBP" };
const ADVIES = ["Draften", "Onder break-even", "Winstgevend", "Verkoopt", "Nieuw", "Te weinig spend", "Niet op store", "Al draft"];
const TONE = {
  Draften: "var(--err)", "Onder break-even": "#f0b35a", Winstgevend: "var(--ok)", Verkoopt: "#4cc9f0",
  Nieuw: "#b48cff", "Te weinig spend": "var(--muted)", "Niet op store": "var(--faint)", "Al draft": "var(--faint)",
};
const PRESET_COLORS = ["#c9a227", "#3ecf8e", "#4cc9f0", "#b48cff", "#ff6b6b", "#f0b35a", "#ff8fab", "#8ad7ff", "#9ad96a", "#e0b341"];
const SYM = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", NZD: "NZ$", CAD: "C$" };
const EMPTY_FILTERS = {
  q: "", status: "all", type: "", tags: [], advies: [], inBoost: false,
  roasMin: "", roasMax: "", poasMin: "", poasMax: "", profitMin: "", profitMax: "", marginMin: "", marginMax: "",
  priceMin: "", priceMax: "", adDaysMin: "", costMin: "", clicksMin: "", clicksMax: "", ordersMin: "", ordersMax: "",
  pubFrom: "", pubTo: "", vendor: "",
};

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
const fmtMoney = (v, cur, dec = 2) => {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return `${n < 0 ? "-" : ""}${SYM[cur] || cur + " "}${s}`;
};
const fmtNum = (v, dec = 0) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const fmtPct = (v, dec = 2) => (v == null || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(dec)}%`);
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "zojuist";
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} uur geleden`;
  return `${Math.round(h / 24)} dagen geleden`;
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }) : "");
const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return v === "" || v == null || !Number.isFinite(n) ? null : n;
};

/* ---------- Kolommen (zoals Pythago, + onze extra's) ---------- */
function makeColumns(P) {
  const win = (w) => [
    { id: `roas${w}`, label: `ROAS ${w}D`, grp: `g${w}`, gl: true, get: (r) => r.per[w].roas, kind: "roas" },
    { id: `cost${w}`, label: `$ ${w}D`, grp: `g${w}`, get: (r) => r.per[w].spend, kind: "money" },
    { id: `rev${w}`, label: `↗ ${w}D`, grp: `g${w}`, get: (r) => r.per[w].net, kind: "money", sub: (r) => r.per[w].netShop },
    { id: `impr${w}`, label: `👁 ${w}D`, grp: `g${w}`, get: (r) => r.per[w].impr, kind: "int" },
  ];
  return [
    { id: "price", label: "Prijs", get: (r) => r.price, kind: "price" },
    { id: "cost", label: "Spend", get: (r) => r.per[P].spend, kind: "money", sub: (r) => r.per[P].spend, subMode: "shop" },
    { id: "conv", label: "Conv.", get: (r) => r.per[P].conv, kind: "num1", title: "Google-conversies" },
    { id: "qty", label: "Stuks", get: (r) => r.per[P].units, kind: "qty", title: "Shopify-stuks (refund-stuks tussen haakjes)" },
    { id: "cv", label: "Omzet", get: (r) => r.per[P].net, kind: "money", sub: (r) => r.per[P].netShop, title: "Shopify-omzet na refunds" },
    { id: "refunds", label: "Refunds", get: (r) => r.per[P].refunds, kind: "refund" },
    { id: "orders", label: "Orders", get: (r) => r.per[P].orders, kind: "int", def: false },
    { id: "clicks", label: "Klikken", get: (r) => r.per[P].clicks, kind: "int" },
    { id: "ctr", label: "CTR", get: (r) => r.per[P].ctr, kind: "pct" },
    { id: "cpc", label: "CPC", get: (r) => r.per[P].cpc, kind: "money" },
    { id: "cpa", label: "CPA", get: (r) => r.per[P].cpa, kind: "money", title: "spend per verkocht stuk" },
    ...win(7), ...win(14), ...win(30),
    { id: "margin", label: "Marge", get: (r) => r.per[P].margin, kind: "pct0", gl: true, title: "brutomarge na COGS + fees" },
    { id: "cog", label: "COGS", get: (r) => r.per[P].cog, kind: "money" },
    { id: "profit", label: "Netto winst", get: (r) => r.per[P].profit, kind: "money" },
    { id: "poas", label: "POAS", get: (r) => r.per[P].poas, kind: "roas" },
    { id: "adDays", label: "Ad-dagen", get: (r) => r.adDays, kind: "int", def: false },
    { id: "gRoas", label: "G-ROAS", get: (r) => r.per[P].gRoas, kind: "roas", def: false, title: "Google conv.waarde / spend" },
    { id: "type", label: "Type", get: (r) => r.type, kind: "text", def: false },
    { id: "age", label: "Leeftijd", get: (r) => r.age, kind: "int", def: false, title: "dagen live" },
    { id: "published", label: "Gepubliceerd", get: (r) => r.publishedAt, kind: "date" },
  ];
}
const ALL_COL_IDS = makeColumns(30).map((c) => c.id);

export default function PythagoPage() {
  const [stores, setStores] = useState([]);
  const [sel, setSel] = useState("");
  const [settings, setSettings] = useState(DEFAULTS);
  const [key, setKey] = useState("");
  const [adsSheet, setAdsSheet] = useState(DEFAULT_ADS_SHEET);
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [auto, setAuto] = useState(null);
  const [presets, setPresets] = useState([]);
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [period, setPeriod] = useState(30);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [menu, setMenu] = useState(""); // "tags" | "presets" | "cols" | "actions"
  const [tagQ, setTagQ] = useState("");
  const [sort, setSort] = useState({ key: "cost", dir: "desc" });
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [hideGone, setHideGone] = useState(true); // "Niet op store" verbergen
  const [picked, setPicked] = useState(() => new Set());
  const [cols, setCols] = useState({ order: ALL_COL_IDS, hidden: makeColumns(30).filter((c) => c.def === false).map((c) => c.id), img: 44 });
  const [full, setFull] = useState(false);
  const [modal, setModal] = useState(null); // { kind, ... }
  const [quar, setQuar] = useState({}); // hygiëne: productId → { at, label, … }
  const [hyPicked, setHyPicked] = useState(() => new Set());
  const [hyOpen, setHyOpen] = useState(true);
  const [showTasks, setShowTasks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [syncMeta, setSyncMeta] = useState(null); // lokale taak zolang de server-taak nog niet gepolld is
  const [now, setNow] = useState(0);
  const pollRef = useRef(null);

  const store = stores.find((s) => s.domain === sel) || null;
  const ordersKeys = useMemo(() => {
    if (!sel) return null;
    const k = load(LS_ORDERS_APP + sel, null);
    return k && k.clientId && k.clientSecret ? k : null;
  }, [sel]);
  const creds = useCallback(() => (store ? { name: store.name, domain: store.domain, currency: store.currency, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret } : null), [store]);
  const P = [7, 14, 30].includes(period) ? period : 30;
  const columns = useMemo(() => makeColumns(P), [P]);
  const adsCur = (data && data.adsCurrency) || settings.adsCurrency || "GBP";
  const shopCur = (data && data.shopCurrency) || (store && store.currency) || adsCur;
  const dual = adsCur !== shopCur;
  const be = (data && data.settings && data.settings.breakEvenRoas) || 1 / Math.max(0.05, 1 - settings.cogsPct / 100 - settings.feePct / 100);
  const running = tasks.find((t) => t.status === "running");
  const live = running || (syncing ? syncMeta : null); // de taak die nu loopt (server of net gestart)

  // klokje voor "bezig sinds" zolang er een sync loopt
  useEffect(() => {
    if (!live && !loading) return;
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [!!live, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- store kiezen + laden ---------- */
  useEffect(() => {
    const list = load(LS_STORES, []) || [];
    setStores(list);
    setAdsSheet(load(LS_ADS_SHEET, "") || DEFAULT_ADS_SHEET);
    const last = load(LS_STORE, "");
    if (last && list.some((s) => s.domain === last)) pickStore(last, list);
    else if (list[0]) pickStore(list[0].domain, list);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (e) => {
      if (e.target && e.target.closest && e.target.closest(".pyd-dd")) return;
      setMenu("");
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pickStore(domain, list) {
    const all = list || stores;
    const s = all.find((x) => x.domain === domain);
    setSel(domain);
    save(LS_STORE, domain);
    setSettings({ ...DEFAULTS, ...(load(LS_SETTINGS + domain, {}) || {}) });
    const cfg = load(LS_DASH_CFG, {}) || {};
    setKey(load(LS_KEY + domain, "") || (cfg[domain] && cfg[domain].key) || guessKey(s) || "");
    const c = load(LS_COLS + domain, null);
    if (c && Array.isArray(c.order)) {
      const order = [...c.order.filter((id) => ALL_COL_IDS.includes(id)), ...ALL_COL_IDS.filter((id) => !c.order.includes(id))];
      setCols({ order, hidden: Array.isArray(c.hidden) ? c.hidden : [], img: c.img || 44 });
    } else setCols({ order: ALL_COL_IDS, hidden: makeColumns(30).filter((x) => x.def === false).map((x) => x.id), img: 44 });
    const v = load(LS_VIEW + domain, {}) || {};
    setPeriod(v.period || 30);
    setPerPage(v.perPage || 25);
    setHideGone(v.hideGone !== false);
    setData(null);
    setTasks([]);
    setPicked(new Set());
    setPage(0);
    setFilters(EMPTY_FILTERS);
    setError("");
    setFlash("");
    loadData(domain);
  }

  async function api(body) {
    const res = await fetch("/api/pythago", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const txt = await res.text();
    let d;
    try {
      d = JSON.parse(txt);
    } catch {
      throw new Error(`server gaf geen JSON (${res.status}) — waarschijnlijk tijdslimiet, probeer opnieuw`);
    }
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    return d;
  }

  async function loadData(domain) {
    setLoading(true);
    try {
      const d = await api({ action: "load", domain });
      setData(d.data);
      setStale(!!d.stale);
      setTasks(d.tasks || []);
      setAuto(d.auto);
      setPresets(d.presets || []);
      setNotes(d.notes || {});
      setQuar(d.quar || {});
      if (d.tasks && d.tasks.some((t) => t.status === "running")) startPolling(domain);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // bij openen automatisch syncen als de data ontbreekt of ouder is dan 6 uur
  const autoStarted = useRef("");
  useEffect(() => {
    if (!store || loading || syncing || running) return;
    if (!stale && data) return;
    if (!key) return;
    if (autoStarted.current === store.domain) return;
    autoStarted.current = store.domain;
    const t = setTimeout(() => sync("automatisch bij openen"), 800);
    return () => clearTimeout(t);
  }, [store, loading, stale, data, key]); // eslint-disable-line react-hooks/exhaustive-deps

  function startPolling(domain) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const d = await api({ action: "tasks", domain });
        setTasks(d.tasks || []);
        if (!(d.tasks || []).some((t) => t.status === "running")) {
          stopPolling();
          if (!syncing) loadData(domain);
        }
      } catch {}
    }, 4000);
  }
  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }
  useEffect(() => () => stopPolling(), []);

  async function sync(source = "handmatig") {
    if (!store || syncing) return;
    if (!key) {
      setShowSettings(true);
      setError("Vul eerst de store-sleutel (SSB / LGB / EMC / SW) in bij instellingen — die bepaalt het tabblad Prod_<sleutel> in de Ads-sheet.");
      return;
    }
    setSyncing(true);
    setSyncMeta({ id: "local", name: `Sync ${store.name || store.domain}`, source, status: "running", startedAt: new Date().toISOString(), msg: "gestart" });
    setError("");
    setFlash("");
    startPolling(store.domain);
    try {
      const d = await api({ action: "sync", store: creds(), ordersStore: ordersKeys, adsSheetId: adsSheet, key, settings, source });
      setData(d.data);
      setStale(false);
      setTasks(d.tasks || []);
      setPicked(new Set());
      sfx("success");
      setFlash(`Gesynchroniseerd: ${d.data.rows.length} producten · ${d.data.adsItems} Ads-items · ${d.data.ordersCounted} orders · ${Math.round(d.data.syncMs / 1000)} s.`);
    } catch (e) {
      setError(`Sync mislukt: ${e.message || e}`);
      sfx("error");
      try {
        const t = await api({ action: "tasks", domain: store.domain });
        setTasks(t.tasks || []);
      } catch {}
    } finally {
      setSyncing(false);
      setSyncMeta(null);
      stopPolling();
    }
  }

  async function toggleAuto(on) {
    if (!store) return;
    try {
      await api({ action: "auto", enabled: on, store: creds(), ordersStore: ordersKeys, adsSheetId: adsSheet, key, settings });
      setAuto(on ? { enabled: true, savedAt: new Date().toISOString() } : null);
      sfx("toggle");
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  function saveSettings(next, nextKey, nextSheet) {
    setSettings(next);
    save(LS_SETTINGS + sel, next);
    setKey(nextKey);
    save(LS_KEY + sel, nextKey);
    setAdsSheet(nextSheet);
    save(LS_ADS_SHEET, nextSheet);
  }

  /* ---------- filteren / sorteren ---------- */
  // verwijderde producten (wel spend in het venster, niet meer in Shopify) standaard verbergen
  const goneCount = useMemo(() => (data ? data.rows.filter((r) => !r.onStore).length : 0), [data]);
  const rows = useMemo(() => (data ? (hideGone ? data.rows.filter((r) => r.onStore) : data.rows) : []), [data, hideGone]);
  const filtered = useMemo(() => {
    const f = filters;
    const q = f.q.trim().toLowerCase();
    const n = (k) => num(f[k]);
    const between = (v, lo, hi) => (lo == null || (v != null && v >= lo)) && (hi == null || (v != null && v <= hi));
    const lim = {
      roas: [n("roasMin"), n("roasMax")], poas: [n("poasMin"), n("poasMax")], profit: [n("profitMin"), n("profitMax")],
      margin: [n("marginMin"), n("marginMax")], price: [n("priceMin"), n("priceMax")], clicks: [n("clicksMin"), n("clicksMax")],
      orders: [n("ordersMin"), n("ordersMax")],
    };
    const adDaysMin = n("adDaysMin");
    const costMin = n("costMin");
    return rows.filter((r) => {
      if (f.status !== "all" && (r.status || "") !== f.status) return false;
      if (f.type && r.type !== f.type) return false;
      if (f.vendor && r.vendor !== f.vendor) return false;
      if (f.tags.length && !f.tags.every((t) => r.tags.includes(t))) return false;
      if (f.advies.length && !f.advies.includes(r.advies)) return false;
      if (f.inBoost && !(r.boost && r.boost.active)) return false;
      if (q && !(`${r.title} ${r.productId} ${r.handle} ${r.type} ${r.vendor} ${r.tags.join(" ")}`.toLowerCase().includes(q))) return false;
      const p = r.per[P];
      if (!between(p.roas == null ? 0 : p.roas, lim.roas[0], lim.roas[1])) return false;
      if (!between(p.poas == null ? 0 : p.poas, lim.poas[0], lim.poas[1])) return false;
      if (!between(p.profit, lim.profit[0], lim.profit[1])) return false;
      if ((lim.margin[0] != null || lim.margin[1] != null) && !between(p.margin, lim.margin[0], lim.margin[1])) return false;
      if ((lim.price[0] != null || lim.price[1] != null) && !between(r.price, lim.price[0], lim.price[1])) return false;
      if (!between(p.clicks, lim.clicks[0], lim.clicks[1])) return false;
      if (!between(p.orders, lim.orders[0], lim.orders[1])) return false;
      if (adDaysMin != null && r.adDays < adDaysMin) return false;
      if (costMin != null && p.spend < costMin) return false;
      if (f.pubFrom && (!r.publishedAt || r.publishedAt < f.pubFrom)) return false;
      if (f.pubTo && (!r.publishedAt || r.publishedAt > f.pubTo)) return false;
      return true;
    });
  }, [rows, filters, P]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (!sort.key) return list;
    const col = columns.find((c) => c.id === sort.key);
    const m = sort.dir === "asc" ? 1 : -1;
    const val = (r) => {
      if (sort.key === "product") return r.title.toLowerCase();
      if (sort.key === "status") return r.status;
      if (sort.key === "advies") return ADVIES.indexOf(r.advies);
      if (sort.key === "variants") return r.vcount;
      return col ? col.get(r) : 0;
    };
    list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return va.localeCompare(vb) * m;
      return (va - vb) * m;
    });
    return list;
  }, [filtered, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageRows = sorted.slice(page * perPage, page * perPage + perPage);
  useEffect(() => {
    if (page >= pageCount) setPage(0);
  }, [pageCount, page]);

  const kpi = useMemo(() => {
    const sum = (f) => filtered.reduce((a, r) => a + (r.per[P][f] || 0), 0);
    const spend = sum("spend");
    const net = sum("net");
    return { products: filtered.length, spend, net, netShop: sum("netShop"), spendShop: data ? spend / (data.fx.rate || 1) : spend, units: sum("units"), refundUnits: sum("refundUnits"), refunds: sum("refunds"), refundsShop: sum("refundsShop"), roas: spend > 0 ? net / spend : null };
  }, [filtered, P, data]);
  const counts = useMemo(() => {
    const c = {};
    for (const r of rows) c[r.advies] = (c[r.advies] || 0) + 1;
    c.inBoost = rows.filter((r) => r.boost && r.boost.active).length;
    return c;
  }, [rows]);

  function setF(patch) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }
  const activeFilterTags = useMemo(() => {
    const f = filters;
    const out = [];
    const rng = (label, a, b, suf = "") => {
      if (f[a] !== "" || f[b] !== "") out.push({ k: [a, b], t: `${label} ${f[a] !== "" ? `≥ ${f[a]}${suf}` : ""}${f[a] !== "" && f[b] !== "" ? " · " : ""}${f[b] !== "" ? `≤ ${f[b]}${suf}` : ""}` });
    };
    if (f.status !== "all") out.push({ k: ["status"], t: `Status: ${f.status}`, reset: { status: "all" } });
    if (f.type) out.push({ k: ["type"], t: `Type: ${f.type}` });
    if (f.vendor) out.push({ k: ["vendor"], t: `Vendor: ${f.vendor}` });
    for (const t of f.tags) out.push({ k: ["tags"], t: `Tag: ${t}`, reset: { tags: f.tags.filter((x) => x !== t) } });
    for (const a of f.advies) out.push({ k: ["advies"], t: a, reset: { advies: f.advies.filter((x) => x !== a) } });
    if (f.inBoost) out.push({ k: ["inBoost"], t: "In boost", reset: { inBoost: false } });
    rng("ROAS", "roasMin", "roasMax");
    rng("POAS", "poasMin", "poasMax");
    rng("Netto winst", "profitMin", "profitMax");
    rng("Marge", "marginMin", "marginMax", "%");
    rng("Prijs", "priceMin", "priceMax");
    rng("Klikken", "clicksMin", "clicksMax");
    rng("Orders", "ordersMin", "ordersMax");
    if (f.adDaysMin !== "") out.push({ k: ["adDaysMin"], t: `Ad-dagen ≥ ${f.adDaysMin}` });
    if (f.costMin !== "") out.push({ k: ["costMin"], t: `Spend ≥ ${f.costMin}` });
    if (f.pubFrom || f.pubTo) out.push({ k: ["pubFrom", "pubTo"], t: `Gepubliceerd ${f.pubFrom || "…"} – ${f.pubTo || "…"}` });
    return out;
  }, [filters]);
  function clearTag(tag) {
    if (tag.reset) return setF(tag.reset);
    const patch = {};
    for (const k of tag.k) patch[k] = EMPTY_FILTERS[k];
    setF(patch);
  }

  function clickSort(id) {
    setSort((s) => (s.key !== id ? { key: id, dir: id === "product" ? "asc" : "desc" } : s.dir === "desc" ? { key: id, dir: "asc" } : s.dir === "asc" && id !== "product" ? { key: "", dir: "desc" } : { key: id, dir: "desc" }));
  }
  const Th = ({ id, children, cls = "", title }) => (
    <th className={`sort ${cls} ${sort.key === id ? "on" : ""}`} onClick={() => clickSort(id)} title={title || ""}>
      {children}
      <span className="ar">{sort.key === id ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </th>
  );

  /* ---------- selectie + acties ---------- */
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pageIds = pageRows.filter((r) => r.onStore).map((r) => r.productId);
  const allPage = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  function togglePage() {
    setPicked((s) => {
      const n = new Set(s);
      if (allPage) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });
  }
  function selectAllDraften() {
    const ids = rows.filter((r) => r.advies === "Draften" && !(r.boost && r.boost.active)).map((r) => r.productId);
    setPicked(new Set(ids));
    setF({ advies: ["Draften"] });
    setFlash(`${ids.length} draft-kandidaten aangevinkt${counts.inBoost ? ` (producten in een lopende boost overgeslagen)` : ""}.`);
  }
  /* ---- hygiëne / quarantaine (RTM-regels, 10-11-2026) ---- */
  const HY_STORES = [/soulsociety/i]; // alleen SSB (RTM); uitbreiden per store
  const hyStore = !!(store && HY_STORES.some((re) => re.test(store.domain || "") || re.test(store.name || "")));
  const hyLabel = Number(settings.quarLabel) >= 0 ? Number(settings.quarLabel) : 4;
  const fxRate = (data && data.fx && data.fx.rate) || 1;
  const hygiene = useMemo(() => {
    if (!data) return { cands: [], inQuar: [] };
    const minAge = Number(settings.minAge) || 14;
    const cands = [];
    const inQuar = [];
    for (const r of data.rows || []) {
      if (!r.onStore || r.status !== "active") continue;
      const q = quar[r.productId];
      const p30 = r.per[30], p14 = r.per[14], p7 = r.per[7];
      const priceAds = r.price != null ? r.price * fxRate : null;
      const thr = Math.max(25, priceAds || 0);
      const reasons = [];
      if (p30.spend >= thr && p30.orders === 0 && p30.conv < 0.5) reasons.push(`£${Math.round(p30.spend)} spend ≥ ${priceAds ? "1× prijs" : "£25"}, 0 sales (30 d)`);
      if (p30.clicks >= 100 && p30.orders === 0) reasons.push(`${p30.clicks} kliks, 0 sales (30 d)`);
      if (p7.spend >= Math.max(15, (priceAds || 0) * 0.5) && p7.orders === 0 && p14.orders === 0 && p14.spend >= thr * 0.75) reasons.push(`loopt weg: £${Math.round(p7.spend)} in 7 d, 0 sales in 14 d`);
      if (q) {
        const days = Math.max(0, Math.round((Date.now() - new Date(q.at).getTime()) / 86400000));
        inQuar.push({ ...r, q, qDays: days, reasons, ready: days >= 14 && p14.orders === 0 });
        continue;
      }
      if (!reasons.length) continue;
      if (r.boost && r.boost.active) continue;
      if (r.age != null && r.age < minAge) continue;
      cands.push({ ...r, reasons, thr });
    }
    cands.sort((a, b) => b.per[30].spend - a.per[30].spend);
    inQuar.sort((a, b) => b.qDays - a.qDays);
    return { cands, inQuar };
  }, [data, quar, settings.minAge, fxRate]);
  function hyToggle(id) {
    setHyPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function doQuarantine(ids, on) {
    setModal(null);
    setSyncing(true);
    try {
      const rowsFor = (data ? data.rows : []).filter((r) => ids.includes(r.productId)).map((r) => ({ productId: r.productId, title: r.title, tags: r.tags, per: { 30: { spend: r.per[30].spend, clicks: r.per[30].clicks } } }));
      const r = await api({ action: "quarantine", store: creds(), productIds: ids, on, label: hyLabel, rows: rowsFor });
      if (r.quar) setQuar(r.quar);
      setData((d) => {
        if (!d) return d;
        const set = new Set(ids);
        return { ...d, rows: d.rows.map((row) => (set.has(row.productId) ? { ...row, tags: on ? [...(row.tags || []).filter((t) => t !== "quarantine"), "quarantine"] : (row.tags || []).filter((t) => t !== "quarantine") } : row)) };
      });
      setHyPicked(new Set());
      sfx(r.failed && r.failed.length ? "error" : "success");
      setFlash(`${r.done} product(en) ${on ? "in quarantaine gezet" : "uit quarantaine gehaald"} (feed-label custom_label_${r.label} + tag "quarantine")${r.failed && r.failed.length ? ` · ${r.failed.length} mislukt: ${r.failed[0].error}` : ""}.`);
    } catch (e) {
      setError(String(e.message || e));
      sfx("error");
    } finally {
      setSyncing(false);
    }
  }

  function askStatus(status, ids) {
    const list = (ids || [...picked]).filter(Boolean);
    if (!list.length) return;
    setModal({ kind: "status", status, ids: list });
  }
  async function doStatus(status, ids) {
    setModal(null);
    setSyncing(true);
    try {
      const r = await api({ action: "status", store: creds(), productIds: ids, status });
      setData((d) => {
        if (!d) return d;
        const set = new Set(r.results.filter((x) => x.ok).map((x) => x.productId));
        return { ...d, rows: d.rows.map((row) => (set.has(row.productId) ? { ...row, status, advies: status !== "active" ? "Al draft" : row.advies === "Al draft" ? "Verkoopt" : row.advies } : row)) };
      });
      setPicked(new Set());
      setHyPicked(new Set());
      if (r.quar) setQuar(r.quar);
      sfx("success");
      setFlash(`${r.done} product(en) op ${status} gezet${r.failed.length ? ` · ${r.failed.length} mislukt` : ""}.`);
    } catch (e) {
      setError(String(e.message || e));
      sfx("error");
    } finally {
      setSyncing(false);
    }
  }

  async function openVariants(r) {
    setModal({ kind: "variants", row: r, variants: null, w: P });
    try {
      const d = await api({ action: "variants", domain: sel, productId: r.productId });
      setModal((m) => (m && m.kind === "variants" && m.row.productId === r.productId ? { ...m, variants: d.variants || [] } : m));
    } catch (e) {
      setModal((m) => (m && m.kind === "variants" ? { ...m, variants: [], error: String(e.message || e) } : m));
    }
  }
  async function saveNote(productId, text) {
    try {
      const d = await api({ action: "notes", op: "set", domain: sel, productId, text });
      setNotes(d.notes || {});
      setModal(null);
      sfx("success");
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  /* ---------- opgeslagen filters ---------- */
  async function savePreset(p) {
    try {
      const d = await api({ action: "presets", op: "save", domain: sel, preset: { ...p, filters: p.filters || filters, period: P } });
      setPresets(d.presets || []);
      setModal(null);
      sfx("success");
      setFlash(`Filter "${p.name}" opgeslagen.`);
    } catch (e) {
      setError(String(e.message || e));
    }
  }
  async function deletePreset(id) {
    try {
      const d = await api({ action: "presets", op: "delete", domain: sel, id });
      setPresets(d.presets || []);
    } catch (e) {
      setError(String(e.message || e));
    }
  }
  function applyPreset(p) {
    setFilters({ ...EMPTY_FILTERS, ...(p.filters || {}) });
    if (p.period) setPeriod(p.period);
    setPage(0);
    setMenu("");
    sfx("toggle");
  }

  /* ---------- kolommen ---------- */
  const visibleCols = cols.order.map((id) => columns.find((c) => c.id === id)).filter((c) => c && !cols.hidden.includes(c.id));
  function saveCols(next) {
    setCols(next);
    save(LS_COLS + sel, next);
  }
  function moveCol(id, dir) {
    const i = cols.order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cols.order.length) return;
    const order = [...cols.order];
    [order[i], order[j]] = [order[j], order[i]];
    saveCols({ ...cols, order });
  }
  function setView(patch) {
    const v = { period: P, perPage, hideGone, ...patch };
    save(LS_VIEW + sel, v);
    if (patch.period) setPeriod(patch.period);
    if (patch.perPage) setPerPage(patch.perPage);
    if (typeof patch.hideGone === "boolean") {
      setHideGone(patch.hideGone);
      setPage(0);
      if (patch.hideGone && filters.advies.includes("Niet op store")) setF({ advies: filters.advies.filter((a) => a !== "Niet op store") });
    }
  }

  /* ---------- export ---------- */
  function exportCsv() {
    const head = ["Product", "Product-ID", "Status", "Advies", "Type", "Tags", "Varianten", ...visibleCols.map((c) => c.label), "Admin"];
    const lines = [head];
    for (const r of sorted) {
      lines.push([r.title, r.productId, r.status, r.advies, r.type, r.tags.join("|"), r.vcount, ...visibleCols.map((c) => c.get(r)), adminUrl(r)]);
    }
    const csv = lines.map((l) => l.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `pythago-${(store && store.name) || sel}-${P}d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }
  function openBooster() {
    if (!data) return;
    try {
      sessionStorage.setItem("sa_py_bridge", JSON.stringify({ domain: sel, result: data }));
    } catch {}
    window.location.href = "/pythago/booster";
  }
  const adminUrl = (r) => (store ? `https://${String(store.domain).replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/products/${r.productId}` : "#");
  const storeUrl = (r) => (store && store.publicDomain && r.handle ? `https://${String(store.publicDomain).replace(/^https?:\/\//, "")}/products/${r.handle}` : "");

  /* ---------- cellen ---------- */
  function cell(c, r) {
    const v = c.get(r);
    switch (c.kind) {
      case "roas": {
        if (v == null) return <span className="pyd-roas rn">—</span>;
        const cls = v <= 0 ? "r0" : v < be ? "r1" : "r2";
        return <span className={`pyd-roas ${cls}`}>{Number(v).toFixed(2)}</span>;
      }
      case "money":
        return (
          <>
            {v == null ? <span className="dim">—</span> : fmtMoney(v, adsCur)}
            {dual && c.sub && v != null ? <span className="pyd-sub">({c.subMode === "shop" ? fmtMoney(v / (data.fx.rate || 1), shopCur) : fmtMoney(c.sub(r), shopCur)})</span> : null}
          </>
        );
      case "refund":
        return v ? (
          <>
            <span className="pyd-neg">-{fmtMoney(v, adsCur)}</span>
            {dual ? <span className="pyd-sub">(-{fmtMoney(r.per[P].refundsShop, shopCur)})</span> : null}
          </>
        ) : (
          <span className="dim">—</span>
        );
      case "price":
        return v == null ? <span className="dim">—</span> : r.priceMax && r.priceMax !== v ? `${fmtMoney(v, shopCur)} – ${fmtMoney(r.priceMax, shopCur)}` : fmtMoney(v, shopCur);
      case "qty":
        return (
          <>
            {fmtNum(v)}
            {r.per[P].refundUnits ? <span className="pyd-sub pyd-neg">(-{r.per[P].refundUnits})</span> : null}
          </>
        );
      case "num1":
        return v ? fmtNum(v, v % 1 ? 2 : 0) : <span className="dim">0</span>;
      case "int":
        return v == null ? <span className="dim">—</span> : v === 0 ? <span className="dim">0</span> : fmtNum(v);
      case "pct":
        return v == null ? <span className="dim">—</span> : fmtPct(v);
      case "pct0":
        return v == null ? <span className="dim">—</span> : <span className={v < 0 ? "pyd-neg" : ""}>{fmtPct(v, 0)}</span>;
      case "date":
        return v ? fmtDate(v) : <span className="dim">—</span>;
      case "text":
        return v || <span className="dim">—</span>;
      default:
        return v == null ? "—" : String(v);
    }
  }

  const tagOptions = useMemo(() => {
    const q = tagQ.trim().toLowerCase();
    return (data ? data.tags : []).filter((t) => !q || t.tag.toLowerCase().includes(q)).slice(0, 200);
  }, [data, tagQ]);
  const vendors = useMemo(() => [...new Set(rows.map((r) => r.vendor).filter(Boolean))].sort(), [rows]);

  const ready = !!data;
  const periodLabel = data ? `${data.ranges[P].start} t/m ${data.ranges[P].end}` : "";

  /* ====================================================================== */
  return (
    <div className={`page pyd ${full ? "is-full" : ""}`}>
      {!full && <Header icon="Π" title="Pythago" subtitle="Productprestaties: Google Ads naast Shopify — 7 / 14 / 30 dagen, filters, draften" />}

      {/* ---------- bovenbalk ---------- */}
      <div className="pyd-bar">
        <div className="pyd-stores">
          {stores.map((s) => (
            <button key={s.domain} className={`pyd-chip ${s.domain === sel ? "on" : ""}`} onClick={() => pickStore(s.domain)}>
              <span className="dot" />
              {s.name || s.domain}
            </button>
          ))}
          {!stores.length && <span className="pyd-synced">Geen stores gekoppeld — koppel eerst een store in de Importer.</span>}
        </div>
        <div className="grow" />
        {data && (
          <span className="pyd-synced">
            Laatst gesynchroniseerd <b>{ago(data.syncedAt)}</b>
            {data.adsUpdated ? <span title="laatste run van het Google Ads-script">· Ads-script {String(data.adsUpdated).slice(5, 16)}</span> : null}
          </span>
        )}
        <label className="pyd-toggle" title="Elke nacht automatisch syncen (cron) — de koppeling van deze store wordt daarvoor op de server bewaard">
          <input type="checkbox" checked={!!(auto && auto.enabled)} onChange={(e) => toggleAuto(e.target.checked)} disabled={!store} /> automatisch syncen
        </label>
        <button className="pyd-ibtn" onClick={() => setShowSettings(true)} disabled={!store} title="Instellingen: COGS, fees, drempel, store-sleutel, Ads-sheet">⚙ Instellingen</button>
        <button className="pyd-ibtn" onClick={() => setShowTasks(true)} disabled={!store}>
          {running ? <span className="pyd-spinner" /> : "☰"} Taken{tasks.length ? ` (${tasks.length})` : ""}
        </button>
        <button className="btn btn-small" onClick={() => sync()} disabled={!store || syncing || !!running}>
          {syncing || running ? "Bezig met syncen…" : "⟳ Sync nu"}
        </button>
      </div>

      {/* ---------- taken-banner (compact; bij een lege pagina neemt het sync-scherm het over) ---------- */}
      {((live && data) || (!live && tasks[0] && Date.now() - Date.parse(tasks[0].finishedAt || tasks[0].startedAt) < 90000)) && (
        <div className={`pyd-tasks ${live ? "" : "idle"}`}>
          <div className="pyd-tasks__head">
            {live ? <span className="pyd-spinner" /> : null}
            {live ? "Background task running" : "Background tasks"}
            {live && <span className="pyd-tasks__time">{mmss(now - Date.parse(live.startedAt))}</span>}
            <button className="pyd-ibtn" onClick={() => setShowTasks(true)}>Alle taken</button>
          </div>
          {live ? (
            <>
              <div className="pyd-task">
                <span className="n">{live.name}</span>
                <span className="pyd-st running">in progress</span>
                <span className="m">{live.msg}</span>
                <span className="t">{live.source} · {clock(live.startedAt)}</span>
              </div>
              <SyncSteps task={live} compact />
            </>
          ) : (
            [tasks[0]].map((t) => (
              <div className="pyd-task" key={t.id}>
                <span className="n">{t.name}</span>
                <span className={`pyd-st ${t.status}`}>{t.status === "done" ? "klaar" : "mislukt"}</span>
                <span className="m">{t.msg}</span>
                <span className="t">{t.source} · {clock(t.startedAt)}{t.finishedAt ? ` → ${clock(t.finishedAt)}` : ""}</span>
              </div>
            ))
          )}
        </div>
      )}
      {error && <div className="pyd-err">{error}</div>}
      {flash && !error && <div className="pyd-ok">{flash}</div>}
      {data && data.warnings && data.warnings.length > 0 && <div className="pyd-warn">{data.warnings.join(" · ")}</div>}

      {/* ---------- eerste keer: uitleg ---------- */}
      {store && !data && !loading && !syncing && !running && (
        <div className="card pyd-setup">
          <h2>Nog geen data voor {store.name || sel}</h2>
          <ol>
            <li>Zet het script <code>scripts/google-ads-products.js</code> in het Google Ads-account van deze store (SHEET_ID = Attoh Ads Live, STORE = <code>{key || "SSB"}</code>), eerste run met DAGEN = 35.</li>
            <li>Controleer bij ⚙ Instellingen de store-sleutel, de Ads-sheet en de Orders-app (Bills-pagina) voor orders en refunds.</li>
            <li>Klik op <b>Sync nu</b>. Daarna synct de pagina zelf bij openen (ouder dan 6 uur) en elke nacht als "automatisch syncen" aan staat.</li>
          </ol>
        </div>
      )}
      {/* ---------- sync-/laadscherm zolang er nog geen dashboard is ---------- */}
      {store && !data && (live || loading) && <SyncStage task={live} store={store} now={now} />}

      {ready && (
        <>
          {/* ---------- filterbalk ---------- */}
          <div className="card pyd-filters">
            <div className="pyd-search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="text" placeholder="Zoek op naam, product-ID, type, vendor of tag…" value={filters.q} onChange={(e) => setF({ q: e.target.value })} />
            </div>
            <div className="pyd-row">
              <label className="lbl">
                Status
                <select value={filters.status} onChange={(e) => setF({ status: e.target.value })}>
                  <option value="all">Alles</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <label className="lbl">
                Type
                <select value={filters.type} onChange={(e) => setF({ type: e.target.value })}>
                  <option value="">Alle types</option>
                  {data.types.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <div className="pyd-dd">
                <button className={`pyd-ibtn ${filters.tags.length ? "on" : ""}`} onClick={() => setMenu(menu === "tags" ? "" : "tags")}>
                  Tags{filters.tags.length ? ` (${filters.tags.length})` : ""} ▾
                </button>
                {menu === "tags" && (
                  <div className="pyd-menu">
                    <div className="msearch"><input type="text" placeholder="Zoek tag…" value={tagQ} onChange={(e) => setTagQ(e.target.value)} autoFocus /></div>
                    {!tagOptions.length && <div className="empty">Geen tags{data.tags.length ? " gevonden" : " op deze store"}</div>}
                    {tagOptions.map((t) => (
                      <label key={t.tag} className={`mi ${filters.tags.includes(t.tag) ? "on" : ""}`}>
                        <input type="checkbox" checked={filters.tags.includes(t.tag)} onChange={(e) => setF({ tags: e.target.checked ? [...filters.tags, t.tag] : filters.tags.filter((x) => x !== t.tag) })} />
                        {t.tag}
                        <span className="cnt">{t.n}</span>
                      </label>
                    ))}
                    {filters.tags.length > 0 && (
                      <>
                        <div className="sep" />
                        <button className="mi" onClick={() => setF({ tags: [] })}>Tags wissen</button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button className={`pyd-ibtn ${showFilters || activeFilterTags.length ? "on" : ""}`} onClick={() => setShowFilters((v) => !v)}>
                ⚲ Filters{activeFilterTags.length ? ` (${activeFilterTags.length})` : ""}
              </button>
              <div className="pyd-dd">
                <button className="pyd-ibtn" onClick={() => setMenu(menu === "presets" ? "" : "presets")}>☆ Opgeslagen filters ▾</button>
                {menu === "presets" && (
                  <div className="pyd-menu">
                    {!presets.length && <div className="empty">Nog geen opgeslagen filters</div>}
                    {presets.map((p) => (
                      <button key={p.id} className="mi" onClick={() => applyPreset(p)}>
                        <span className="pyd-pdot" style={{ background: p.color || PRESET_COLORS[0] }} />
                        {p.name}
                        <span className="cnt">{p.scope === "all" ? "alle stores" : ""}</span>
                      </button>
                    ))}
                    <div className="sep" />
                    <button className="mi" onClick={() => { setMenu(""); setModal({ kind: "preset", preset: { name: "", color: PRESET_COLORS[0], scope: "store" } }); }}>+ Huidige filters opslaan</button>
                    <button className="mi" onClick={() => { setMenu(""); setModal({ kind: "presets" }); }}>⚙ Opgeslagen filters beheren</button>
                  </div>
                )}
              </div>
              <div className="grow" />
              <div className="pyd-period" title="Periode voor Spend · Conv. · Stuks · Omzet · Refunds · Klikken · CTR · CPC · CPA en de tegels (de 7D/14D/30D-kolommen staan altijd)">
                {[7, 14, 30].map((w) => (
                  <button key={w} className={P === w ? "on" : ""} onClick={() => setView({ period: w })}>{w} dagen</button>
                ))}
              </div>
              <button className="pyd-ibtn" onClick={exportCsv} title="Alle gefilterde rijen als CSV">⤓ Export CSV</button>
            </div>
            {showFilters && (
              <div className="pyd-panel">
                <div className="pyd-grp">
                  <h4>Prestaties</h4>
                  {[["ROAS", "roasMin", "roasMax"], ["POAS", "poasMin", "poasMax"]].map(([l, a, b]) => (
                    <div className="fr" key={a}>
                      <span>{l}</span>
                      <div className="mm">
                        <input type="number" step="0.1" placeholder="Min" value={filters[a]} onChange={(e) => setF({ [a]: e.target.value })} /> – <input type="number" step="0.1" placeholder="Max" value={filters[b]} onChange={(e) => setF({ [b]: e.target.value })} />
                      </div>
                    </div>
                  ))}
                  <div className="fr">
                    <span>Advies</span>
                    <select multiple size={4} value={filters.advies} onChange={(e) => setF({ advies: [...e.target.selectedOptions].map((o) => o.value) })}>
                      {ADVIES.map((a) => (
                        <option key={a} value={a}>{a} ({counts[a] || 0})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="pyd-grp">
                  <h4>Winstgevendheid</h4>
                  {[["Netto winst", "profitMin", "profitMax"], ["Marge %", "marginMin", "marginMax"], ["Prijs", "priceMin", "priceMax"]].map(([l, a, b]) => (
                    <div className="fr" key={a}>
                      <span>{l}</span>
                      <div className="mm">
                        <input type="number" placeholder="Min" value={filters[a]} onChange={(e) => setF({ [a]: e.target.value })} /> – <input type="number" placeholder="Max" value={filters[b]} onChange={(e) => setF({ [b]: e.target.value })} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pyd-grp">
                  <h4>Ad spend</h4>
                  <div className="fr"><span>Ad-dagen</span><div className="mm"><input type="number" placeholder="Min" value={filters.adDaysMin} onChange={(e) => setF({ adDaysMin: e.target.value })} /></div></div>
                  <div className="fr"><span>Spend</span><div className="mm"><input type="number" placeholder="Min" value={filters.costMin} onChange={(e) => setF({ costMin: e.target.value })} /></div></div>
                  <div className="fr">
                    <span>Klikken</span>
                    <div className="mm"><input type="number" placeholder="Min" value={filters.clicksMin} onChange={(e) => setF({ clicksMin: e.target.value })} /> – <input type="number" placeholder="Max" value={filters.clicksMax} onChange={(e) => setF({ clicksMax: e.target.value })} /></div>
                  </div>
                </div>
                <div className="pyd-grp">
                  <h4>Shopify</h4>
                  <div className="fr">
                    <span>Orders</span>
                    <div className="mm"><input type="number" placeholder="Min" value={filters.ordersMin} onChange={(e) => setF({ ordersMin: e.target.value })} /> – <input type="number" placeholder="Max" value={filters.ordersMax} onChange={(e) => setF({ ordersMax: e.target.value })} /></div>
                  </div>
                  <div className="fr">
                    <span>Vendor</span>
                    <select value={filters.vendor} onChange={(e) => setF({ vendor: e.target.value })}>
                      <option value="">Alle</option>
                      {vendors.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div className="fr">
                    <span>Boost</span>
                    <label className="pyd-toggle"><input type="checkbox" checked={filters.inBoost} onChange={(e) => setF({ inBoost: e.target.checked })} /> alleen in lopende boost ({counts.inBoost || 0})</label>
                  </div>
                </div>
                <div className="pyd-grp">
                  <h4>Publicatiedatum</h4>
                  <div className="fr"><span>Vanaf</span><input type="date" value={filters.pubFrom} onChange={(e) => setF({ pubFrom: e.target.value })} /></div>
                  <div className="fr"><span>Tot</span><input type="date" value={filters.pubTo} onChange={(e) => setF({ pubTo: e.target.value })} /></div>
                </div>
                <div className="pyd-panel__foot">
                  <span>Filters gelden op de gekozen periode ({P} dagen).</span>
                  <div className="grow" />
                  <button className="pyd-ibtn" onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })}>Alles wissen</button>
                  <button className="pyd-ibtn on" onClick={() => setModal({ kind: "preset", preset: { name: "", color: PRESET_COLORS[0], scope: "store" } })}>☆ Opslaan als filter</button>
                </div>
              </div>
            )}
            {activeFilterTags.length > 0 && (
              <div className="pyd-active">
                {activeFilterTags.map((t, i) => (
                  <span className="pyd-tag" key={i}>
                    {t.t}
                    <button onClick={() => clearTag(t)} title="Verwijder filter">×</button>
                  </span>
                ))}
                <button className="pyd-ibtn" style={{ height: 26, fontSize: 11.5 }} onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })}>Alles wissen</button>
              </div>
            )}
          </div>

          {/* ---------- valuta + periode ---------- */}
          <div className="pyd-cur">
            <span>Google Ads: <b>{adsCur}</b></span>
            <span>Shopify: <b>{shopCur}</b></span>
            {dual && <span className="mut">(bedragen in {adsCur}, {shopCur} tussen haakjes · koers 1 {shopCur} = {data.fx.rate} {adsCur})</span>}
            <span className="mut">· Periode {P} dagen: {periodLabel}</span>
            <span className="mut">· break-even ROAS {be.toFixed(2)}</span>
            <span className="mut">· {data.ordersCounted} orders · {data.adsItems} Ads-items</span>
          </div>

          {/* ---------- tegels ---------- */}
          <div className="pyd-tiles">
            <div className="pyd-tile"><div className="v">{fmtNum(kpi.products)}</div><div className="k">Producten (gefilterd)</div></div>
            <div className="pyd-tile">
              <div className="v">{fmtMoney(kpi.spend, adsCur, 0)}</div>
              {dual && <div className="v2">({fmtMoney(kpi.spendShop, shopCur, 0)})</div>}
              <div className="k">Product ad spend (gefilterd)</div>
              <div className="lnk">van {fmtMoney(data.totals[P].accountSpend || data.totals[P].spend, adsCur, 0)} account-spend · <button onClick={() => setModal({ kind: "breakdown" })}>uitsplitsing</button></div>
            </div>
            <div className="pyd-tile">
              <div className="v">{fmtNum(kpi.units)}</div>
              {kpi.refundUnits ? <div className="v2 pyd-neg">(-{kpi.refundUnits} retour)</div> : null}
              <div className="k">Shopify · stuks</div>
            </div>
            <div className="pyd-tile">
              <div className="v">{fmtMoney(kpi.net, adsCur, 0)}</div>
              {dual && <div className="v2">({fmtMoney(kpi.netShop, shopCur, 0)})</div>}
              <div className="k">Shopify · omzet (na refunds)</div>
            </div>
            <div className="pyd-tile">
              <div className="v red">{fmtMoney(kpi.refunds, adsCur, 0)}</div>
              {dual && <div className="v2">({fmtMoney(kpi.refundsShop, shopCur, 0)})</div>}
              <div className="k">Refunds</div>
            </div>
            <div className="pyd-tile">
              <div className="v" style={{ color: kpi.roas == null ? "var(--faint)" : kpi.roas < be ? "#f0b35a" : "var(--ok)" }}>{kpi.roas == null ? "—" : kpi.roas.toFixed(2)}</div>
              <div className="k">ROAS op Shopify-omzet</div>
            </div>
          </div>

          {/* ---------- advies-chips ---------- */}
          <div className="pyd-adv">
            <button className={`pyd-chip ${!filters.advies.length ? "on" : ""}`} onClick={() => setF({ advies: [] })}>Alles {rows.length}</button>
            {ADVIES.filter((a) => counts[a]).map((a) => (
              <button key={a} className={`pyd-chip ${filters.advies.length === 1 && filters.advies[0] === a ? "on" : ""}`} onClick={() => setF({ advies: filters.advies.length === 1 && filters.advies[0] === a ? [] : [a] })}>
                <span className="dot" style={{ background: TONE[a] }} />
                {a} {counts[a]}
              </button>
            ))}
            {counts.inBoost ? (
              <button className={`pyd-chip ${filters.inBoost ? "on" : ""}`} onClick={() => setF({ inBoost: !filters.inBoost })}>
                <span className="dot" style={{ background: "#4cc9f0" }} />In boost {counts.inBoost}
              </button>
            ) : null}
            {goneCount ? (
              <button
                className={`pyd-chip gone ${hideGone ? "" : "on"}`}
                onClick={() => setView({ hideGone: !hideGone })}
                title={hideGone ? "Producten die niet meer in Shopify staan maar wel spend hadden in dit venster — klik om ze te tonen" : "Klik om verwijderde producten weer te verbergen"}
              >
                <span className="dot" style={{ background: TONE["Niet op store"] }} />
                {hideGone ? `${goneCount} verwijderd verborgen` : `Verwijderd ${goneCount} · verbergen`}
              </button>
            ) : null}
            <span className="grow" />
            {counts.Draften ? (
              <button className="pyd-ibtn" onClick={selectAllDraften}>Selecteer alle Draften ({counts.Draften}){data.draftSpend ? ` · ${fmtMoney(data.draftSpend, adsCur, 0)} spend` : ""}</button>
            ) : null}
            <button className="pyd-ibtn" onClick={openBooster} title="Conversion Booster + schrijf naar sheet (klassieke pagina) met dit resultaat">⚡ Conversion Booster →</button>
          </div>

          {/* ---------- tabel ---------- */}
          <div className="card pyd-tablecard" style={{ position: "relative" }}>
            <div className="pyd-thead">
              <div>
                <h2 style={{ marginBottom: 2 }}>Product performance</h2>
                <div className="sub">{sorted.length} van {rows.length} producten{picked.size ? ` · ${picked.size} aangevinkt` : ""}</div>
              </div>
              <div className="grow" />
              {picked.size > 0 && (
                <select value="" onChange={(e) => { const v = e.target.value; if (v) askStatus(v); }}>
                  <option value="">Acties ({picked.size})</option>
                  <option value="draft">Op draft zetten</option>
                  <option value="active">Op active zetten</option>
                  <option value="archived">Archiveren</option>
                </select>
              )}
              {picked.size > 0 && (
                <button className="pyd-ibtn on" title="AI-modelfoto's maken voor de aangevinkte producten" onClick={() => (async () => {
                  let openai = false;
                  try { const d = await (await fetch("/api/photo-queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list" }) })).json(); openai = !!d.openai; } catch {}
                  setModal({ kind: "aiphoto", ids: [...picked], mode: "ai", engine: "claude", per: 1, openai, busy: false, msg: "" });
                })()}>✦ AI-foto's ({picked.size})</button>
              )}
              <div className="pyd-dd">
                <button className="pyd-ibtn" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(menu === "cols" ? "" : "cols")} title="Kolommen">▦ Kolommen</button>
                {menu === "cols" && (
                  <div className="pyd-cols">
                    <h4>Foto</h4>
                    <div className="slider">
                      <span>{cols.img}px</span>
                      <input type="range" min={28} max={80} step={4} value={cols.img} onChange={(e) => saveCols({ ...cols, img: Number(e.target.value) })} />
                    </div>
                    <h4>Kolommen (volgorde + zichtbaar)</h4>
                    {cols.order.map((id, i) => {
                      const c = columns.find((x) => x.id === id);
                      if (!c) return null;
                      const off = cols.hidden.includes(id);
                      return (
                        <div className={`ci ${off ? "off" : ""}`} key={id}>
                          <input type="checkbox" checked={!off} onChange={(e) => saveCols({ ...cols, hidden: e.target.checked ? cols.hidden.filter((x) => x !== id) : [...cols.hidden, id] })} />
                          <span>{c.label}</span>
                          <button onClick={() => moveCol(id, -1)} disabled={i === 0} title="omhoog">▲</button>
                          <button onClick={() => moveCol(id, 1)} disabled={i === cols.order.length - 1} title="omlaag">▼</button>
                        </div>
                      );
                    })}
                    <div className="sep" style={{ height: 1, background: "var(--line)", margin: "8px 4px" }} />
                    <button className="pyd-ibtn" style={{ width: "100%" }} onClick={() => saveCols({ order: ALL_COL_IDS, hidden: makeColumns(30).filter((x) => x.def === false).map((x) => x.id), img: 44 })}>Standaard</button>
                  </div>
                )}
              </div>
              <button className="pyd-ibtn" onClick={() => setFull((v) => !v)} title="Volledig scherm">{full ? "⤡ Verklein" : "⤢ Volledig"}</button>
            </div>

            <div className="pyd-wrap">
              <table className="pyd-table">
                <thead>
                  <tr>
                    <th className="c sticky" style={{ width: 34 }}><input type="checkbox" checked={allPage} onChange={togglePage} title="Alles op deze pagina" /></th>
                    <Th id="product" cls="l sticky2" >Product</Th>
                    <Th id="status" cls="c">Status</Th>
                    <Th id="variants" cls="c">Var.</Th>
                    {visibleCols.map((c) => (
                      <Th key={c.id} id={c.id} cls={`${c.grp || ""} ${c.gl ? "gl" : ""}`} title={c.title}>{c.label}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const note = notes[r.productId];
                    const isSel = picked.has(r.productId);
                    return (
                      <tr key={r.key || r.productId} className={isSel ? "sel" : ""}>
                        <td className="c sticky">{r.onStore ? <input type="checkbox" checked={isSel} onChange={() => toggle(r.productId)} /> : null}</td>
                        <td className="l prod sticky2">
                          <div className="pyd-prod">
                            {r.image ? (
                              <img className="pyd-img" src={r.image} alt="" loading="lazy" style={{ width: cols.img, height: cols.img }} onClick={() => setModal({ kind: "image", src: r.image.replace(/([?&])width=\d+/, "$1width=900"), title: r.title })} />
                            ) : (
                              <span className="pyd-noimg" style={{ width: cols.img, height: cols.img }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div className="pyd-title" title={r.title}>
                                {r.onStore ? <a href={adminUrl(r)} target="_blank" rel="noreferrer">{r.title}</a> : r.title}
                              </div>
                              <div className="pyd-id">ID: {r.productId || "—"}{r.type ? ` · ${r.type}` : ""}</div>
                              <div className="pyd-icons">
                                <span className="pyd-pill" style={{ color: TONE[r.advies] }}>{r.advies}</span>
                                {r.boost && (
                                  <span className="pyd-pill" style={{ color: r.boost.effect === "geen effect" ? "#f0b35a" : r.boost.effect ? "var(--ok)" : "#4cc9f0" }} title={r.boost.tab}>
                                    {r.boost.active ? `Boost · dag ${r.boost.day}/${r.boost.windowDays}` : r.boost.effect ? `Boost: ${r.boost.effect}` : "Boost"}
                                  </span>
                                )}
                                {r.onStore && (
                                  <>
                                    <button className={note ? "has" : ""} title={note ? `Notitie: ${note.text}` : "Notitie toevoegen"} onClick={() => setModal({ kind: "note", row: r, text: note ? note.text : "" })}>✎</button>
                                    <a href={adminUrl(r)} target="_blank" rel="noreferrer" title="Open in Shopify-admin">↗</a>
                                    {storeUrl(r) && <a href={storeUrl(r)} target="_blank" rel="noreferrer" title="Bekijk op de store">🛍</a>}
                                  </>
                                )}
                                {r.soldOut ? <span className="pyd-sub" title="varianten uitverkocht">{r.soldOut} uitverkocht</span> : null}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="c">
                          {r.onStore ? (
                            <button className={`pyd-pill pyd-status ${r.status}`} onClick={() => setModal({ kind: "rowstatus", row: r })} title="Status wijzigen">{r.status}</button>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        <td className="c">
                          {r.onStore ? <button className="pyd-vbtn" onClick={() => openVariants(r)} title={`${r.vcount} varianten${r.variants ? ` · ${r.variants} met spend` : ""} — klik voor de uitsplitsing`}>{r.vcount}{r.variants ? <span style={{ color: "var(--faint)", fontWeight: 500 }}> · {r.variants} ads</span> : null}</button> : <span className="dim">—</span>}
                        </td>
                        {visibleCols.map((c) => (
                          <td key={c.id} className={`${c.grp || ""} ${c.gl ? "gl" : ""} ${c.kind === "text" ? "l" : ""}`}>{cell(c, r)}</td>
                        ))}
                      </tr>
                    );
                  })}
                  {!pageRows.length && (
                    <tr>
                      <td colSpan={4 + visibleCols.length} className="pyd-empty">Geen producten voor deze filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pyd-pager">
              <span>Toon</span>
              <select value={perPage} onChange={(e) => { setView({ perPage: Number(e.target.value) }); setPage(0); }}>
                {[10, 25, 50, 100, 250].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span>per pagina · {page * perPage + 1}–{Math.min(sorted.length, (page + 1) * perPage)} van {sorted.length}</span>
              <div className="grow" />
              <button onClick={() => setPage(0)} disabled={page === 0}>«</button>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
              {Array.from({ length: Math.min(7, pageCount) }, (_, i) => {
                const start = Math.max(0, Math.min(page - 3, pageCount - 7));
                const n = start + i;
                return (
                  <button key={n} className={n === page ? "on" : ""} onClick={() => setPage(n)}>{n + 1}</button>
                );
              })}
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>›</button>
              <button onClick={() => setPage(pageCount - 1)} disabled={page >= pageCount - 1}>»</button>
            </div>
          </div>

          {/* ================================================================
              HYGIËNE — zombie-producten volgens de RTM-regels (alleen SSB)
              ================================================================ */}
          {hyStore && (
            <div className="card pyd-tablecard pyd-hy" style={{ marginTop: 18 }}>
              <div className="pyd-hy__head">
                <div>
                  <h3 style={{ margin: 0 }}>Hygiëne <span className="pyd-sub">zombie-producten · RTM-regels</span></h3>
                  <div className="pyd-sub" style={{ marginTop: 4 }}>
                    Kandidaat = 30 d: spend ≥ 1× verkoopprijs (min. £25) en 0 sales, óf ≥ 100 kliks en 0 sales; "loopt weg" = £15+ in 7 d zonder sale. Nieuwe producten (&lt; {settings.minAge || 14} d) en lopende boosts slaan we over.
                    <br />
                    <b>Quarantaine</b> = feed-label <code>custom_label_{hyLabel} = quarantine</code> + Shopify-tag "quarantine" → RTM sluit dat label uit in Main en test het klein. Na 14 d zonder sale → <b>Archiveren</b> (verdwijnt direct uit GMC; draft kan 30 d blijven hangen).
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="pyd-pill">{hygiene.cands.length} kandidaten</span>
                  <span className="pyd-pill">{hygiene.inQuar.length} in quarantaine</span>
                  <button className="btn-ghost btn-small" onClick={() => setHyOpen((v) => !v)}>{hyOpen ? "Inklappen" : "Uitklappen"}</button>
                </div>
              </div>
              {hyOpen && (
                <>
                  <div className="pyd-hy__bar">
                    <span className="pyd-sub">{hyPicked.size} aangevinkt</span>
                    <button className="btn-ghost btn-small" onClick={() => setHyPicked(new Set(hygiene.cands.map((r) => r.productId)))} disabled={!hygiene.cands.length}>Alle kandidaten</button>
                    <button className="btn-ghost btn-small" onClick={() => setHyPicked(new Set(hygiene.inQuar.filter((r) => r.ready).map((r) => r.productId)))} disabled={!hygiene.inQuar.some((r) => r.ready)}>Alle 14+ d zonder sale</button>
                    <button className="btn-ghost btn-small" onClick={() => setHyPicked(new Set())} disabled={!hyPicked.size}>Niets</button>
                    <div className="grow" />
                    <button className="btn btn-small" disabled={!hyPicked.size || syncing} onClick={() => setModal({ kind: "quar", on: true, ids: [...hyPicked].filter((id) => !quar[id]) })}>Quarantaine ({[...hyPicked].filter((id) => !quar[id]).length})</button>
                    <button className="btn-ghost btn-small" disabled={!hyPicked.size || syncing} onClick={() => setModal({ kind: "quar", on: false, ids: [...hyPicked].filter((id) => quar[id]) })}>Terug naar normaal ({[...hyPicked].filter((id) => quar[id]).length})</button>
                    <button className="btn-ghost btn-small" style={{ color: "var(--bad, #e5484d)" }} disabled={!hyPicked.size || syncing} onClick={() => askStatus("archived", [...hyPicked])}>Archiveren ({hyPicked.size})</button>
                  </div>
                  {[{ title: "Kandidaten", list: hygiene.cands, empty: "Geen zombie-kandidaten volgens de regels. Mooi." }, { title: "In quarantaine", list: hygiene.inQuar, empty: "Niets in quarantaine." }].map((blk) => (
                    <div key={blk.title} style={{ marginTop: 10 }}>
                      <div className="pyd-hy__sub">{blk.title} <span className="pyd-sub">({blk.list.length})</span></div>
                      {!blk.list.length ? (
                        <div className="pyd-empty">{blk.empty}</div>
                      ) : (
                        <div className="pyd-wrap">
                          <table className="pyd-table pyd-hy__table">
                            <thead>
                              <tr>
                                <th />
                                <th>Product</th>
                                <th>Prijs</th>
                                <th className="r">Spend 30 d</th>
                                <th className="r">Kliks 30 d</th>
                                <th className="r">Sales 30 d</th>
                                <th className="r">Spend 14 d</th>
                                <th className="r">Sales 14 d</th>
                                <th className="r">Spend 7 d</th>
                                <th className="r">Sales 7 d</th>
                                <th>{blk.title === "In quarantaine" ? "Sinds" : "Waarom"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {blk.list.map((r) => (
                                <tr key={r.productId} className={hyPicked.has(r.productId) ? "pyd-active" : ""}>
                                  <td><input type="checkbox" checked={hyPicked.has(r.productId)} onChange={() => hyToggle(r.productId)} /></td>
                                  <td className="pyd-prod">
                                    {r.image ? <img className="pyd-img" src={r.image} alt="" style={{ width: 32, height: 32 }} /> : <span className="pyd-noimg" />}
                                    <span>
                                      <b>{r.title}</b>
                                      <span className="pyd-id">{r.productId}{r.type ? ` · ${r.type}` : ""}{r.age != null ? ` · ${r.age} d live` : ""}</span>
                                    </span>
                                  </td>
                                  <td>{fmtMoney(r.price, shopCur)}</td>
                                  <td className="r">{fmtMoney(r.per[30].spend, adsCur)}</td>
                                  <td className="r">{fmtNum(r.per[30].clicks)}</td>
                                  <td className="r">{r.per[30].orders}</td>
                                  <td className="r">{fmtMoney(r.per[14].spend, adsCur)}</td>
                                  <td className="r">{r.per[14].orders}</td>
                                  <td className="r">{fmtMoney(r.per[7].spend, adsCur)}</td>
                                  <td className="r">{r.per[7].orders}</td>
                                  <td>
                                    {blk.title === "In quarantaine" ? (
                                      <span>
                                        <b>{r.qDays} d</b> <span className="pyd-sub">({fmtDate(r.q.at)})</span>
                                        {r.ready ? <span className="pyd-pill" style={{ marginLeft: 6, color: "var(--bad, #e5484d)" }}>14+ d, 0 sales → archiveren</span> : r.per[14].orders > 0 ? <span className="pyd-pill" style={{ marginLeft: 6, color: "var(--ok, #2f9e5a)" }}>verkoopt weer</span> : null}
                                      </span>
                                    ) : (
                                      r.reasons.map((x) => <span key={x} className="pyd-pill" style={{ marginRight: 4 }}>{x}</span>)
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}

      {modal && modal.kind === "quar" && (
        <div className="pyd-modal" onClick={() => setModal(null)}>
          <div className="pyd-box md" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div>
                <h3>{modal.ids.length} product(en) {modal.on ? "in quarantaine zetten" : "uit quarantaine halen"}</h3>
                <div className="sub">{modal.on ? `Zet feed-label custom_label_${hyLabel} = "quarantine" en tag "quarantine" in Shopify (${store.name || sel}). Het product blijft actief; RTM sluit het label uit in Main.` : "Haalt het feed-label en de tag weg; het product draait weer normaal mee."}</div>
              </div>
              <button className="x" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="pyd-list">
              {modal.ids.map((id) => {
                const r = (data ? data.rows : []).find((x) => x.productId === id);
                return <div className="li" key={id}><span className="grow">{r ? r.title : id}</span><span className="pyd-pill">{r ? `${fmtMoney(r.per[30].spend, adsCur)} · ${r.per[30].clicks} kliks · ${r.per[30].orders} sales` : ""}</span></div>;
              })}
            </div>
            <div className="pyd-box__foot">
              <button className="btn-ghost" onClick={() => setModal(null)}>Annuleren</button>
              <button className="btn" disabled={!modal.ids.length} onClick={() => doQuarantine(modal.ids, modal.on)}>{modal.on ? "Ja, in quarantaine" : "Ja, terug naar normaal"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODALS
          ==================================================================== */}
      {showTasks && (
        <div className="pyd-modal" onClick={() => setShowTasks(false)}>
          <div className="pyd-box md" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div><h3>Background tasks</h3><div className="sub">Syncs van {store ? store.name || sel : ""} — lopend en geschiedenis</div></div>
              <button className="x" onClick={() => setShowTasks(false)}>×</button>
            </div>
            <div className="pyd-list">
              {!tasks.length && <div className="pyd-empty">Nog geen taken.</div>}
              {tasks.map((t) => (
                <div className="li" key={t.id}>
                  {t.status === "running" ? <span className="pyd-spinner" /> : null}
                  <span className={`pyd-st ${t.status}`}>{t.status === "running" ? "in progress" : t.status === "done" ? "klaar" : "mislukt"}</span>
                  <span className="grow" title={t.msg}><b>{t.name}</b> — {t.msg}</span>
                  <span style={{ color: "var(--faint)", fontSize: 11.5, whiteSpace: "nowrap" }}>{t.source} · {ago(t.startedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSettings && store && (
        <SettingsModal
          settings={settings} storeKey={key} adsSheet={adsSheet} ordersKeys={ordersKeys} store={store}
          onClose={() => setShowSettings(false)}
          onSave={(s, k, sh, resync) => {
            saveSettings(s, k, sh);
            setShowSettings(false);
            if (resync) setTimeout(() => sync("instellingen gewijzigd"), 100);
          }}
        />
      )}

      {modal && modal.kind === "aiphoto" && (
        <div className="pyd-modal" onClick={() => !modal.busy && setModal(null)}>
          <div className="pyd-box md" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div><h3>AI-modelfoto's voor {modal.ids.length} product(en)</h3><div className="sub">De nieuwe foto komt vooraan bij de juiste kleur en in de omschrijving; de bestaande foto's blijven staan ({store.name || sel}).</div></div>
              <button className="x" onClick={() => !modal.busy && setModal(null)}>×</button>
            </div>
            <div style={{ padding: "4px 18px 0" }}>
              <div className="sub" style={{ margin: "8px 0 6px" }}>Waarmee maken</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className={`pyd-ibtn ${modal.engine === "claude" ? "on" : ""}`} onClick={() => setModal({ ...modal, engine: "claude" })}>Claude · Higgsfield MCP</button>
                <button className={`pyd-ibtn ${modal.engine === "openai" ? "on" : ""}`} disabled={!modal.openai} style={modal.openai ? undefined : { opacity: 0.55, cursor: "not-allowed" }} onClick={() => modal.openai && setModal({ ...modal, engine: "openai" })}>OpenAI API{modal.openai ? "" : " · coming soon"}</button>
              </div>
              <div className="sub" style={{ margin: "12px 0 6px" }}>Welke kleuren</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className={`pyd-ibtn ${modal.mode === "ai" ? "on" : ""}`} onClick={() => setModal({ ...modal, mode: "ai" })}>AI kiest (op fotocijfer)</button>
                <button className={`pyd-ibtn ${modal.mode === "5050" ? "on" : ""}`} onClick={() => setModal({ ...modal, mode: "5050" })}>50-50 (helft van de kleuren)</button>
                <button className={`pyd-ibtn ${modal.mode === "all" ? "on" : ""}`} onClick={() => setModal({ ...modal, mode: "all" })}>Alle kleuren</button>
              </div>
              <div className="sub" style={{ margin: "12px 0 6px" }}>Foto's per kleur</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[1, 2, 3, 4].map((n) => <button key={n} className={`pyd-ibtn ${modal.per === n ? "on" : ""}`} onClick={() => setModal({ ...modal, per: n })}>{n}</button>)}
              </div>
            </div>
            <div className="pyd-list">
              {modal.ids.map((id) => {
                const r = rows.find((x) => x.productId === id);
                return <div className="li" key={id}><span className="grow">{r ? r.title : id}</span></div>;
              })}
            </div>
            {modal.msg && <div className="sub" style={{ padding: "0 18px 8px" }}>{modal.msg}</div>}
            <div className="pyd-box__foot">
              <button className="btn-ghost" disabled={modal.busy} onClick={() => setModal(null)}>{modal.done ? "Sluiten" : "Annuleren"}</button>
              {!modal.done && (
                <button className="btn" disabled={modal.busy} onClick={async () => {
                  setModal({ ...modal, busy: true, msg: modal.mode === "ai" ? "Foto's beoordelen en klaarzetten…" : "Klaarzetten…" });
                  try {
                    const res = await fetch("/api/photo-queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enqueue", store, productIds: modal.ids, mode: modal.mode, per: modal.per, engine: modal.engine }) });
                    const d = await res.json();
                    if (!res.ok || d.error) throw new Error(d.error || "Klaarzetten mislukt");
                    const sk = (d.skipped || []).length;
                    setModal((m) => (m ? { ...m, busy: false, done: true, msg: `${d.added || 0} foto-opdracht(en) klaargezet${sk ? ` · ${sk} overgeslagen${d.skipped[0] && d.skipped[0].why ? ` (o.a. ${d.skipped[0].why})` : ""}` : ""}. ${m.engine === "openai" ? "De tool is begonnen en gaat vanzelf door." : "Claude pakt ze op."} De stand zie je in Importer → tab 4.` } : m));
                  } catch (e) {
                    setModal((m) => (m ? { ...m, busy: false, msg: String(e.message || e) } : m));
                  }
                }}>✦ Zet klaar ({modal.ids.length})</button>
              )}
            </div>
          </div>
        </div>
      )}

      {modal && modal.kind === "status" && (
        <div className="pyd-modal" onClick={() => setModal(null)}>
          <div className="pyd-box md" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div><h3>{modal.ids.length} product(en) op <b>{modal.status}</b> zetten</h3><div className="sub">Dit wijzigt de status in Shopify ({store.name || sel}). Niets gebeurt vanzelf — alleen na bevestigen.</div></div>
              <button className="x" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="pyd-list">
              {modal.ids.map((id) => {
                const r = rows.find((x) => x.productId === id);
                return <div className="li" key={id}><span className="grow">{r ? r.title : id}</span><span className="pyd-pill" style={{ color: r ? TONE[r.advies] : "var(--muted)" }}>{r ? r.advies : ""}</span></div>;
              })}
            </div>
            <div className="pyd-box__foot">
              <button className="btn-ghost" onClick={() => setModal(null)}>Annuleren</button>
              <button className="btn" onClick={() => doStatus(modal.status, modal.ids)}>Ja, op {modal.status}</button>
            </div>
          </div>
        </div>
      )}

      {modal && modal.kind === "rowstatus" && (
        <div className="pyd-modal" onClick={() => setModal(null)}>
          <div className="pyd-box sm" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div><h3>Status wijzigen</h3><div className="sub">{modal.row.title} · nu <b>{modal.row.status}</b></div></div>
              <button className="x" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="pyd-box__foot" style={{ justifyContent: "flex-start" }}>
              {["active", "draft", "archived"].filter((s) => s !== modal.row.status).map((s) => (
                <button key={s} className="pyd-ibtn" onClick={() => askStatus(s, [modal.row.productId])}>→ {s}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {modal && modal.kind === "note" && (
        <div className="pyd-modal" onClick={() => setModal(null)}>
          <div className="pyd-box sm" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div><h3>Notitie</h3><div className="sub">{modal.row.title}</div></div>
              <button className="x" onClick={() => setModal(null)}>×</button>
            </div>
            <textarea value={modal.text} onChange={(e) => setModal({ ...modal, text: e.target.value })} placeholder="Bijv. prijs verlaagd op 3-11, foto 1 vervangen…" autoFocus />
            <div className="pyd-box__foot">
              {modal.text && <button className="btn-ghost" onClick={() => saveNote(modal.row.productId, "")}>Verwijderen</button>}
              <button className="btn-ghost" onClick={() => setModal(null)}>Annuleren</button>
              <button className="btn" onClick={() => saveNote(modal.row.productId, modal.text)}>Opslaan</button>
            </div>
          </div>
        </div>
      )}

      {modal && modal.kind === "image" && (
        <div className="pyd-modal" onClick={() => setModal(null)}>
          <img className="pyd-bigimg" src={modal.src} alt={modal.title} />
        </div>
      )}

      {modal && modal.kind === "breakdown" && data && (
        <div className="pyd-modal" onClick={() => setModal(null)}>
          <div className="pyd-box sm" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div><h3>Ad spend uitsplitsing</h3><div className="sub">{periodLabel} · {adsCur}</div></div>
              <button className="x" onClick={() => setModal(null)}>×</button>
            </div>
            {(() => {
              const t = data.totals[P];
              const acc = t.accountSpend || t.spend;
              const rowsB = [["Totale ad spend (account)", acc, 100], ["Product ad spend (alle producten)", t.spend, acc ? (t.spend / acc) * 100 : 100], ["Product ad spend (gefilterd)", kpi.spend, acc ? (kpi.spend / acc) * 100 : 100], ["Niet aan een product toe te wijzen", Math.max(0, acc - t.spend), acc ? (Math.max(0, acc - t.spend) / acc) * 100 : 0]];
              return (
                <div className="pyd-bd">
                  {rowsB.map(([l, v, p]) => (
                    <div className="r" key={l}><span>{l}</span><span className="bar"><i style={{ width: `${Math.min(100, p)}%` }} /></span><b>{fmtMoney(v, adsCur, 0)}</b><span style={{ color: "var(--muted)" }}>{p.toFixed(0)}%</span></div>
                  ))}
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Het verschil: spend op items die niet meer in Shopify staan, Search/Display-verkeer van PMax zonder product, en dagen waarop het productscript nog niet draaide. Account-spend komt uit tab Ads_{key}; product-spend uit Prod_{key}.</p>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {modal && modal.kind === "preset" && (
        <PresetModal preset={modal.preset} onClose={() => setModal(null)} onSave={savePreset} />
      )}

      {modal && modal.kind === "presets" && (
        <div className="pyd-modal" onClick={() => setModal(null)}>
          <div className="pyd-box md" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div><h3>Opgeslagen filters</h3><div className="sub">Toepassen, overschrijven met de huidige filters, of verwijderen</div></div>
              <button className="x" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="pyd-list">
              {!presets.length && <div className="pyd-empty">Nog geen opgeslagen filters.</div>}
              {presets.map((p) => (
                <div className="li" key={p.id}>
                  <span className="pyd-pdot" style={{ background: p.color }} />
                  <span className="grow"><b>{p.name}</b> <span style={{ color: "var(--faint)" }}>· {p.scope === "all" ? "alle stores" : "deze store"} · {p.period || 30} d</span></span>
                  <button className="pyd-ibtn" onClick={() => { applyPreset(p); setModal(null); }}>Toepassen</button>
                  <button className="pyd-ibtn" onClick={() => savePreset({ ...p, filters })} title="Vervang de opgeslagen filters door wat nu actief is">Overschrijven</button>
                  <button className="pyd-ibtn" onClick={() => deletePreset(p.id)} style={{ color: "var(--err)" }}>Verwijder</button>
                </div>
              ))}
            </div>
            <div className="pyd-box__foot">
              <button className="btn" onClick={() => setModal({ kind: "preset", preset: { name: "", color: PRESET_COLORS[0], scope: "store" } })}>+ Nieuw uit huidige filters</button>
            </div>
          </div>
        </div>
      )}

      {modal && modal.kind === "variants" && (
        <div className="pyd-modal" onClick={() => setModal(null)}>
          <div className="pyd-box" onClick={(e) => e.stopPropagation()}>
            <div className="pyd-box__head">
              <div>
                <h3>Uitsplitsing per variant</h3>
                <div className="sub">{modal.row.title} · ID {modal.row.productId}</div>
              </div>
              <div className="pyd-period" style={{ marginLeft: "auto" }}>
                {[7, 14, 30].map((w) => (
                  <button key={w} className={modal.w === w ? "on" : ""} onClick={() => setModal({ ...modal, w })}>{w} dagen</button>
                ))}
              </div>
              <button className="x" onClick={() => setModal(null)}>×</button>
            </div>
            {(() => {
              const w = modal.w;
              const V = modal.variants;
              const t = modal.row.per[w];
              return (
                <>
                  <div className="pyd-vt">
                    {[["Varianten", modal.row.vcount], ["Spend", fmtMoney(t.spend, adsCur)], ["Google conv.", fmtNum(t.conv, 1)], ["Stuks", `${fmtNum(t.units)}${t.refundUnits ? ` (-${t.refundUnits})` : ""}`], ["Omzet (netto)", fmtMoney(t.net, adsCur)], ["ROAS", t.roas == null ? "—" : t.roas.toFixed(2)]].map(([k, v]) => (
                      <div className="pyd-tile" key={k}><div className="v" style={{ fontSize: 17 }}>{v}</div><div className="k">{k}</div></div>
                    ))}
                  </div>
                  {V === null && <div className="pyd-empty">Laden…</div>}
                  {modal.error && <div className="pyd-err">{modal.error}</div>}
                  {V && (
                    <div className="pyd-wrap" style={{ maxHeight: "55vh" }}>
                      <table className="pyd-table">
                        <thead>
                          <tr>
                            <th className="l">Variant</th><th>Prijs</th><th>Spend</th><th>Vertoningen</th><th>Klikken</th><th>G-conv.</th><th>Stuks</th><th>Omzet</th><th>Refunds</th><th>Netto</th><th>CTR</th><th>CPC</th><th>ROAS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...V].sort((a, b) => b.per[w].spend - a.per[w].spend || b.per[w].net - a.per[w].net).map((v) => {
                            const p = v.per[w];
                            const cls = p.roas == null ? "rn" : p.roas <= 0 ? "r0" : p.roas < be ? "r1" : "r2";
                            return (
                              <tr key={v.id}>
                                <td className="l" style={{ whiteSpace: "normal", color: "var(--ink)" }}>
                                  {v.title}{v.soldOut ? <span className="pyd-sub pyd-neg">uitverkocht</span> : null}
                                  {v.sku ? <span className="pyd-sub">SKU {v.sku}</span> : null}
                                  {v.item ? <span className="pyd-sub" style={{ fontFamily: "ui-monospace, monospace" }}>{v.item}</span> : null}
                                </td>
                                <td>{v.price ? fmtMoney(v.price, shopCur) : "—"}</td>
                                <td>{fmtMoney(p.spend, adsCur)}</td>
                                <td>{fmtNum(p.impr)}</td>
                                <td>{fmtNum(p.clicks)}</td>
                                <td>{fmtNum(p.conv, p.conv % 1 ? 1 : 0)}</td>
                                <td>{fmtNum(p.units)}{p.refundUnits ? <span className="pyd-sub pyd-neg">(-{p.refundUnits})</span> : null}</td>
                                <td>{fmtMoney(p.rev, adsCur)}</td>
                                <td>{p.refunds ? <span className="pyd-neg">-{fmtMoney(p.refunds, adsCur)}</span> : "—"}</td>
                                <td>{fmtMoney(p.net, adsCur)}</td>
                                <td>{p.ctr == null ? "—" : fmtPct(p.ctr)}</td>
                                <td>{p.cpc == null ? "—" : fmtMoney(p.cpc, adsCur)}</td>
                                <td><span className={`pyd-roas ${cls}`}>{p.roas == null ? "—" : p.roas.toFixed(2)}</span></td>
                              </tr>
                            );
                          })}
                          {!V.length && <tr><td colSpan={13} className="pyd-empty">Geen varianten gevonden — sync opnieuw.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- instellingen ---------- */
/* ---------- sync-voortgang ---------- */
const SYNC_STEPS = [
  { t: "Google Ads", d: "cijfers per product", m: /google ads/i },
  { t: "Shopify", d: "producten + orders", m: /^shopify/i },
  { t: "Orders", d: "refunds verwerken", m: /orders verwerken/i },
  { t: "Berekenen", d: "per product · 7 / 14 / 30 d", m: /per product/i },
  { t: "Opslaan", d: "dashboard vullen", m: /^opslaan/i },
];
const syncStage = (msg) => {
  const s = String(msg || "");
  for (let i = SYNC_STEPS.length - 1; i >= 0; i--) if (SYNC_STEPS[i].m.test(s)) return i;
  return 0;
};
const mmss = (ms) => {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function SyncSteps({ task, compact }) {
  const stage = task ? syncStage(task.msg) : 0;
  const started = task && task.msg !== "gestart";
  const pct = task ? Math.min(96, Math.round(((stage + (started ? 0.65 : 0.15)) / SYNC_STEPS.length) * 100)) : 6;
  return (
    <>
      <div className="pyd-prog"><i style={{ width: `${pct}%` }} /></div>
      <div className={`pyd-steps ${compact ? "compact" : ""}`}>
        {SYNC_STEPS.map((s, i) => {
          const st = !task ? "todo" : i < stage ? "done" : i === stage ? "active" : "todo";
          return (
            <div key={s.t} className={`pyd-step ${st}`}>
              <span className="i">{st === "done" ? "✓" : st === "active" ? <span className="pyd-spinner" /> : i + 1}</span>
              <span className="n">{s.t}</span>
              {!compact && <span className="d">{st === "active" && started ? String(task.msg).replace(/…$/, "") : s.d}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function SyncStage({ task, store, now }) {
  const name = store ? store.name || store.domain : "";
  const since = task ? now - Date.parse(task.startedAt) : 0;
  return (
    <div className="pyd-stage">
      <div className="pyd-stage__card">
        <div className="pyd-orb"><span>Π</span></div>
        <div className="pyd-stage__title">
          {task ? "Eerste sync van " : "Laden van "}{name}
          <small>Google Ads × Shopify</small>
        </div>
        <div className="pyd-stage__sub">
          {task
            ? "Even geduld — de eerste keer leest hij tot 35 dagen Ads-cijfers, alle producten en alle orders. Daarna gaat elke sync in seconden."
            : "Opgeslagen dashboard ophalen…"}
        </div>
        <SyncSteps task={task} />
        <div className="pyd-stage__meta">
          {task && <span>Gestart <b>{clock(task.startedAt)}</b> · {task.source}</span>}
          {task && <span>Bezig <b>{mmss(since)}</b></span>}
          {task && <span>Verwacht <b>1–2 min</b></span>}
        </div>
      </div>
      <div className="pyd-skel" aria-hidden="true">
        <div className="pyd-tiles">
          {[...Array(6)].map((_, i) => (
            <div className="pyd-tile" key={i}>
              <span className="pyd-sk" style={{ width: 84, height: 24 }} />
              <span className="pyd-sk" style={{ width: 56, height: 9 }} />
            </div>
          ))}
        </div>
        <div className="card pyd-skel__table">
          {[...Array(9)].map((_, i) => (
            <div className="pyd-skel-row" key={i}>
              <span className="pyd-sk" style={{ width: 14, height: 14 }} />
              <span className="pyd-sk" style={{ width: 40, height: 40, borderRadius: 8 }} />
              <span className="pyd-sk" style={{ width: `${48 + ((i * 37) % 44)}%`, height: 12 }} />
              {[...Array(7)].map((_, j) => (
                <span className="pyd-sk" key={j} style={{ width: `${36 + (((i + 1) * (j + 3) * 19) % 52)}%`, height: 12, justifySelf: "end" }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ settings, storeKey, adsSheet, ordersKeys, store, onClose, onSave }) {
  const [s, setS] = useState({ ...settings });
  const [k, setK] = useState(storeKey);
  const [sh, setSh] = useState(adsSheet);
  const set = (key, v) => setS((x) => ({ ...x, [key]: v }));
  const numS = (key) => ({ type: "number", value: s[key] ?? "", onChange: (e) => set(key, e.target.value === "" ? "" : Number(e.target.value)) });
  return (
    <div className="pyd-modal" onClick={onClose}>
      <div className="pyd-box md" onClick={(e) => e.stopPropagation()}>
        <div className="pyd-box__head">
          <div><h3>Instellingen · {store.name || store.domain}</h3><div className="sub">Per store onthouden. Regels voor het advies + waar de Ads-cijfers vandaan komen.</div></div>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="fgrid">
          <label><div className="field-label">Store-sleutel <span className="opt">tab Prod_&lt;sleutel&gt; / Ads_&lt;sleutel&gt;</span></div><input type="text" value={k} onChange={(e) => setK(e.target.value.toUpperCase().trim())} placeholder="SSB / LGB / EMC / SW" /></label>
          <label><div className="field-label">Ads-valuta <span className="opt">van het Google Ads-account</span></div>
            <select value={s.adsCurrency || "GBP"} onChange={(e) => set("adsCurrency", e.target.value)}>
              {["GBP", "USD", "EUR", "AUD", "NZD", "CAD"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}><div className="field-label">Ads-sheet <span className="opt">"Attoh Ads Live" (zelfde als het omzet-dashboard)</span></div><input type="text" value={sh} onChange={(e) => setSh(e.target.value.trim())} /></label>
          <label><div className="field-label">COGS %</div><input {...numS("cogsPct")} step="0.5" /></label>
          <label><div className="field-label">Fees % <span className="opt">betaalkosten e.d.</span></div><input {...numS("feePct")} step="0.1" /></label>
          <label><div className="field-label">Draft-drempel <span className="opt">spend in Ads-valuta</span></div><input {...numS("threshold")} step="1" /></label>
          <label><div className="field-label">Regelvenster</div>
            <select value={s.ruleWindow || 30} onChange={(e) => set("ruleWindow", Number(e.target.value))}>
              {[7, 14, 30].map((w) => <option key={w} value={w}>{w} dagen</option>)}
            </select>
          </label>
          <label><div className="field-label">Min. dagen live <span className="opt">jonger = Nieuw, nooit draften</span></div><input {...numS("minAge")} step="1" /></label>
          <label><div className="field-label">Wisselkoers <span className="opt">leeg = automatisch</span></div><input type="number" step="0.0001" value={s.fxOverride ?? ""} onChange={(e) => set("fxOverride", e.target.value === "" ? "" : Number(e.target.value))} placeholder={`1 ${store.currency || "…"} = ? ${s.adsCurrency || "GBP"}`} /></label>
        </div>
        <div className={ordersKeys ? "pyd-ok" : "pyd-warn"} style={{ marginTop: 12 }}>
          {ordersKeys ? "Orders + refunds via de Orders-app (Bills-pagina)." : "Geen Orders-app-sleutels voor deze store (Bills-pagina) — orders gaan via de Importer-koppeling; die moet read_orders hebben."}
        </div>
        <div className="pyd-box__foot">
          <button className="btn-ghost" onClick={onClose}>Annuleren</button>
          <button className="btn-ghost" onClick={() => onSave(s, k, sh, false)}>Opslaan</button>
          <button className="btn" onClick={() => onSave(s, k, sh, true)}>Opslaan + opnieuw syncen</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- filter opslaan ---------- */
function PresetModal({ preset, onClose, onSave }) {
  const [p, setP] = useState({ ...preset });
  return (
    <div className="pyd-modal" onClick={onClose}>
      <div className="pyd-box sm" onClick={(e) => e.stopPropagation()}>
        <div className="pyd-box__head">
          <div><h3>{p.id ? "Filter bewerken" : "Filter opslaan"}</h3><div className="sub">De huidige filters, zoekterm en periode worden bewaard.</div></div>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="fgrid">
          <label style={{ gridColumn: "1 / -1" }}><div className="field-label">Naam</div><input type="text" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="bijv. Draften > £20 spend" autoFocus /></label>
          <label><div className="field-label">Geldt voor</div>
            <select value={p.scope || "store"} onChange={(e) => setP({ ...p, scope: e.target.value })}>
              <option value="store">Alleen deze store</option>
              <option value="all">Alle stores</option>
            </select>
          </label>
          <div><div className="field-label">Kleur</div>
            <div className="pyd-colors">
              {PRESET_COLORS.map((c) => <button key={c} className={p.color === c ? "on" : ""} style={{ background: c }} onClick={() => setP({ ...p, color: c })} />)}
            </div>
          </div>
        </div>
        <div className="pyd-box__foot">
          <button className="btn-ghost" onClick={onClose}>Annuleren</button>
          <button className="btn" disabled={!p.name.trim()} onClick={() => onSave({ ...p, name: p.name.trim() })}>Opslaan</button>
        </div>
      </div>
    </div>
  );
}
