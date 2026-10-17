"use client";

// PYTHAGO — wat kost elk product aan Google Ads en wat levert het op in Shopify?
// 7 / 14 / 30 dagen naast elkaar, vaste formules, advies per product en een
// knop om de aangevinkte producten op draft te zetten (17-10-2026, doc 56).
//
// Nodig per run: (1) store (koppeling uit de Importer + Orders-app van de
// Bills-pagina), (2) de Google Ads-export "Producten" van de afgelopen 30
// dagen met segment Dag (CSV). De CSV wordt hier in de browser gelezen; alleen
// de opgetelde cijfers per item gaan naar de server.

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { sfx } from "../components/sfx";
import { parseAdsExport, combineExports, slimAds } from "@/lib/pythago-csv";

const LS_STORES = "sa_stores";
const LS_STORE = "sa_py_store";
const LS_SETTINGS = "sa_py_settings::"; // + domein
const LS_SHEET = "sa_py_sheet::"; // + domein
const LS_ORDERS_APP = "sa_orders_app::"; // + domein (Bills-pagina)
const LS_BILLS_SHEET = "sa_bills_sheet::"; // + domein (P&L-sheet)

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

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/* Google Ads geeft CSV soms als UTF-16 ("Excel CSV") — BOM of nul-bytes herkennen. */
async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 4 && buf[1] === 0 && buf[3] === 0);
  return new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(buf);
}

export default function PythagoPage() {
  const [stores, setStores] = useState([]);
  const [sel, setSel] = useState("");
  const [files, setFiles] = useState([]); // [{ name, parsed?, error? }]
  const [settings, setSettings] = useState(DEFAULTS);
  const [fxOverride, setFxOverride] = useState("");
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState("Draften");
  const [picked, setPicked] = useState(() => new Set());
  const [sheet, setSheet] = useState("");
  const [tab, setTab] = useState(`Pythago ${today()}`);
  const [doneUrl, setDoneUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [logs, setLogs] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const push = (e) => setLogs((l) => [...l, e]);
  const store = stores.find((s) => s.domain === sel) || null;
  const ordersKeys = useMemo(() => {
    if (!sel) return null;
    const k = load(LS_ORDERS_APP + sel, null);
    return k && k.clientId && k.clientSecret ? k : null;
  }, [sel]);

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
    const bills = load(LS_BILLS_SHEET + domain, "");
    setSheet(load(LS_SHEET + domain, "") || bills || "");
    setResult(null);
    setPicked(new Set());
    setDoneUrl("");
  }

  function setS(k, v) {
    setSettings((s) => {
      const n = { ...s, [k]: v };
      if (sel) save(LS_SETTINGS + sel, n);
      return n;
    });
  }

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

  async function analyse() {
    if (!canAnalyse) return;
    setBusy("analyse");
    setResult(null);
    setPicked(new Set());
    setDoneUrl("");
    setLogs([]);
    try {
      const ads = slimAds(combined);
      push({ strong: true, text: `— Pythago: ${store.name || store.domain} · Ads ${combined.start} t/m ${combined.end} · ${ads.items.length} items met spend` });
      push({ text: ordersKeys ? "Shopify-orders via de Orders-app (Bills-pagina) · producten via de Importer-koppeling…" : "Geen Orders-app-sleutels voor deze store — orders via de Importer-koppeling (werkt alleen als die read_orders heeft)…" });
      const r = await api({
        action: "analyse",
        store: { name: store.name, domain: store.domain, currency: store.currency, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret },
        ordersStore: ordersKeys,
        ads,
        settings,
        fxOverride: fxOverride ? Number(String(fxOverride).replace(",", ".")) : undefined,
      });
      const res = r.result;
      setResult(res);
      const c = res.counts || {};
      setFilter(c.Draften ? "Draften" : "Alles");
      const cur = res.adsCurrency === "GBP" ? "£" : res.adsCurrency + " ";
      push({ ok: true, text: `Klaar: ${res.rows.length} producten · ${res.ordersCounted} Shopify-orders · koers 1 ${res.shopCurrency} = ${res.fx.rate} ${res.adsCurrency} · break-even ROAS ${res.settings.breakEvenRoas}.` });
      push({ text: `Advies: ${ADVIES.filter((a) => c[a]).map((a) => `${a} ${c[a]}`).join(" · ")}${res.draftSpend ? ` — ${cur}${res.draftSpend.toFixed(2)} spend op draft-kandidaten (${res.settings.ruleWindow} d)` : ""}` });
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

  const rows = result ? result.rows.filter((x) => filter === "Alles" || x.advies === filter) : [];
  const RW = result ? result.settings.ruleWindow : 30;
  const cur = result ? (result.adsCurrency === "GBP" ? "£" : result.adsCurrency === "EUR" ? "€" : result.adsCurrency === "USD" ? "$" : "") : "£";
  const money = (n) => (n == null ? "—" : `${cur}${Number(n).toFixed(2)}`);
  const roasCell = (v) => {
    if (v == null) return <span style={{ color: "var(--faint)" }}>—</span>;
    const be = result.settings.breakEvenRoas;
    return <span style={{ color: v >= be ? "var(--ok)" : v > 0 ? "var(--warn)" : "var(--err)" }}>{v.toFixed(2)}</span>;
  };
  const draftable = (x) => x.productId && x.status === "active" && !x.drafted;
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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
        .py-wrap { overflow: auto; max-height: 620px; border: 1px solid var(--line); border-radius: 10px; }
        .py-table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
        .py-table th { position: sticky; top: 0; background: #15151b; color: var(--muted); font-weight: 600; text-align: right; padding: 8px 9px; font-size: 11px; white-space: nowrap; border-bottom: 1px solid var(--line); z-index: 1; }
        .py-table th.l, .py-table td.l { text-align: left; }
        .py-table td { padding: 7px 9px; border-top: 1px solid var(--line); text-align: right; color: var(--ink-2); white-space: nowrap; }
        .py-table td.t { max-width: 340px; overflow: hidden; text-overflow: ellipsis; color: var(--ink); }
        .py-table tr:hover td { background: var(--panel-hi); }
        .py-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: middle; }
        @media (max-width: 1100px) { .py-tiles { grid-template-columns: 1fr 1fr; } }
      `}</style>
      <div className="page layout-scraper">
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
              <div className="field-label">Google Sheet <span className="opt">(standaard de P&L-sheet van de store)</span></div>
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
          {result && (
            <div className="card">
              <h2>
                {result.store.name || result.store.domain} <span className="opt">· {result.period.from} t/m {result.period.to}</span>
              </h2>
              <div className="py-tiles">
                {[7, 14, 30].map((w) => (
                  <div className="py-tile" key={w}>
                    <div className="k">{w} dagen</div>
                    <div className="v">{money(result.totals[w].spend)}</div>
                    <div className="s">
                      omzet {money(result.totals[w].rev)} · ROAS {result.totals[w].roas == null ? "—" : result.totals[w].roas.toFixed(2)}
                    </div>
                  </div>
                ))}
                <div className="py-tile">
                  <div className="k">Draft-kandidaten</div>
                  <div className="v" style={{ color: result.counts.Draften ? "var(--err)" : "var(--ok)" }}>{result.counts.Draften || 0}</div>
                  <div className="s">{money(result.draftSpend)} spend zonder verkoop ({RW} d)</div>
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
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {result.counts.Draften > 0 && (
                    <button className="btn-ghost btn-small" type="button" disabled={!!busy} onClick={() => setPicked(new Set(result.rows.filter((x) => x.advies === "Draften" && draftable(x)).map((x) => x.productId)))}>
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
                      <th className="l" />
                      <th className="l">Advies</th>
                      <th className="l">Product</th>
                      <th>Dagen live</th>
                      <th>Spend 7d</th>
                      <th>Spend 14d</th>
                      <th>Spend 30d</th>
                      <th>Klikken 30d</th>
                      <th>Orders 7/14/30</th>
                      <th>Omzet 30d</th>
                      <th>ROAS 7d</th>
                      <th>ROAS 14d</th>
                      <th>ROAS 30d</th>
                      <th>Google conv 30d</th>
                      <th>Winst 30d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
                      <tr key={x.productId || x.title}>
                        <td className="l">
                          {draftable(x) ? <input type="checkbox" checked={picked.has(x.productId)} onChange={() => toggle(x.productId)} disabled={!!busy} /> : null}
                        </td>
                        <td className="l">
                          <span className="py-dot" style={{ background: TONE[x.advies] }} />
                          {x.advies}
                        </td>
                        <td className="l t" title={x.title}>
                          {x.productId && result.store.domain ? (
                            <a className="linklike" href={`https://${result.store.domain}/admin/products/${x.productId}`} target="_blank" rel="noreferrer noopener">
                              {x.title}
                            </a>
                          ) : (
                            x.title
                          )}
                        </td>
                        <td>{x.age ?? "—"}</td>
                        <td>{money(x.per[7].spend)}</td>
                        <td>{money(x.per[14].spend)}</td>
                        <td>{money(x.per[30].spend)}</td>
                        <td>{x.per[30].clicks}</td>
                        <td>
                          {x.per[7].orders}/{x.per[14].orders}/{x.per[30].orders}
                        </td>
                        <td>{money(x.per[30].rev)}</td>
                        <td>{roasCell(x.per[7].roas)}</td>
                        <td>{roasCell(x.per[14].roas)}</td>
                        <td>{roasCell(x.per[30].roas)}</td>
                        <td>{x.per[30].conv}</td>
                        <td style={{ color: x.profit30 >= 0 ? "var(--ok)" : "var(--err)" }}>{money(x.profit30)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="hint">
                ROAS = Shopify-omzet ({result.shopCurrency} → {result.adsCurrency}, koers {result.fx.rate}) / Google Ads-spend. Groen ≥ break-even {result.settings.breakEvenRoas}, oranje
                eronder, rood = spend zonder omzet. Orders zijn álle Shopify-orders van het product in die dagen (niet alleen via Google).
              </div>
            </div>
          )}

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
    </>
  );
}
