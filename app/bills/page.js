"use client";

// KUNGFUBUY BILLS → COGS. Upload de dagelijkse Kungfubuy-bills (PDF, ook
// een backlog van oude bills tegelijk), en de tool doet de rest:
//   parse (ordernummers, aantallen, bedragen, storecode) →
//   Shopify-lookup (echte orderdatum, dag in Londen) →
//   EUR→£ met de ECB-dagkoers van de orderdatum →
//   "Zet in sheet": logregels naar het COGS Log-tabblad + per datum de som
//   naar kolom V van de juiste maandtab. Dupes kunnen nooit dubbel tellen.
// De storecode op de bill (bijv. "xi1vf0-h1") koppel je één keer aan een
// gekoppelde store; daarna herkent de tool elke volgende bill vanzelf.

import { useEffect, useRef, useState } from "react";
import Header from "../components/Header";

const LS_STORES = "sa_stores";
const LS_SELECTED = "sa_selected_store";
const LS_SHEET = "sa_bills_sheet";
const LS_CODES = "sa_bill_codes";
const LS_ORDERS_APP = "sa_orders_app::"; // + store-domein → { clientId, clientSecret }
const DEFAULT_SHEET = "1hwv6MnKzOFlGhxe5vWSApglqwZDTYp-boT0fqGgoFiM"; // P&L Sheet SSB

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

const money = (n, cur = "£") =>
  n == null || !Number.isFinite(Number(n))
    ? "—"
    : cur + Number(n).toFixed(2).replace(".", ",");

export default function BillsPage() {
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sheetId, setSheetId] = useState("");
  const [codes, setCodes] = useState({}); // storecode → { name, domain }
  // Orders-app: aparte Dev Dashboard-app (bijv. "P&L Sync") met read_orders /
  // read_all_orders. De Importer-koppeling houdt z'n producten-app; alleen
  // de order-lookup hier gebruikt deze sleutels. Leeg = terugvallen op de
  // store-koppeling zelf.
  const [ordersApp, setOrdersApp] = useState({ clientId: "", clientSecret: "" });
  const [ordersTest, setOrdersTest] = useState(null); // resultaat "Test koppeling"

  const [bills, setBills] = useState([]); // geparste PDF's
  const [enriched, setEnriched] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [busy, setBusy] = useState(""); // "" | "parse" | "analyse" | "commit"
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [logs, setLogs] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setStores(load(LS_STORES, []));
    setSelected(load(LS_SELECTED, null));
    setCodes(load(LS_CODES, {}));
    const s = load(LS_SHEET, "");
    setSheetId(s || DEFAULT_SHEET);
  }, []);

  const store = stores.find((s) => s.domain === selected) || null;

  // Orders-app-sleutels per store laden
  useEffect(() => {
    if (!store || !store.domain) return;
    const v = load(LS_ORDERS_APP + store.domain, null);
    setOrdersApp(v && typeof v === "object" ? { clientId: v.clientId || "", clientSecret: v.clientSecret || "" } : { clientId: "", clientSecret: "" });
    setOrdersTest(null);
  }, [store && store.domain]);

  function changeOrdersApp(patch) {
    const next = { ...ordersApp, ...patch };
    setOrdersApp(next);
    setOrdersTest(null);
    if (store && store.domain) save(LS_ORDERS_APP + store.domain, next);
  }

  // Het store-object voor alles wat ORDERS leest: Orders-app-sleutels als
  // die ingevuld zijn, anders de gewone koppeling (oude gedrag).
  function ordersStoreBody() {
    if (!store) return null;
    const useOrdersApp = ordersApp.clientId.trim() && ordersApp.clientSecret.trim();
    return useOrdersApp
      ? { name: store.name, domain: store.domain, clientId: ordersApp.clientId.trim(), clientSecret: ordersApp.clientSecret.trim() }
      : { name: store.name, domain: store.domain, clientId: store.clientId, clientSecret: store.clientSecret, token: store.token };
  }

  async function testOrders() {
    if (!store) return;
    setOrdersTest({ busy: true });
    try {
      const res = await fetch("/api/bills/test-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: ordersStoreBody() }),
      });
      const data = await res.json().catch(() => ({}));
      setOrdersTest(data);
      pushLog(
        data.ok
          ? { ok: true, text: `Orders-koppeling werkt: ${data.shop} · ${data.count} orders zichtbaar via ${data.via}.` }
          : { err: true, text: `Orders-koppeling: ${data.error}` }
      );
    } catch (e) {
      setOrdersTest({ ok: false, error: String(e.message) });
    }
  }

  function pushLog(line) {
    setLogs((l) => [...l, line]);
  }

  function pickStore(domain) {
    setSelected(domain);
    save(LS_SELECTED, domain);
  }
  function changeSheet(v) {
    setSheetId(v);
    save(LS_SHEET, v);
  }

  /* ---------- Upload & parse ---------- */

  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter((f) =>
      /pdf$/i.test(f.name || "") || f.type === "application/pdf"
    );
    if (!files.length) return;
    setBusy("parse");
    setEnriched(null);
    setCommitted(null);
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/bills/parse", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        let added = false;
        setBills((prev) => {
          if (data.invoiceNo && prev.some((b) => b.invoiceNo === data.invoiceNo)) return prev;
          added = true;
          return [...prev, data];
        });
        if (!added && data.invoiceNo) {
          pushLog({ warn: true, text: `${f.name}: invoice ${data.invoiceNo} stond al in de lijst — overgeslagen.` });
          continue;
        }
        const sum = data.rows.reduce((a, r) => a + (r.cost || 0), 0);
        const cur = data.rows[0] ? data.rows[0].currency : "";
        pushLog({
          ok: true,
          text: `${f.name} · invoice ${data.invoiceNo || "?"} (${data.invoiceDate || "?"}) · ${data.rows.length} order${data.rows.length === 1 ? "" : "s"} · ${sum.toFixed(2)} ${cur}`,
        });
        for (const w of data.warnings || []) pushLog({ warn: true, text: `${f.name}: ${w}` });
      } catch (e) {
        pushLog({ err: true, text: `${f.name}: ${e.message}` });
      }
    }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
  }

  /* ---------- Storecodes ---------- */

  const allRows = bills.flatMap((b) =>
    (b.rows || []).map((r) => ({ ...r, invoiceNo: b.invoiceNo, invoiceDate: b.invoiceDate }))
  );

  const codeGroups = {};
  for (const r of allRows) {
    const c = r.store || "?";
    if (!codeGroups[c]) codeGroups[c] = { count: 0 };
    codeGroups[c].count++;
  }
  const unknownCodes = Object.keys(codeGroups).filter((c) => c !== "?" && !codes[c]);
  const eligibleRows = allRows.filter(
    (r) => store && codes[r.store] && codes[r.store].domain === store.domain
  );
  const foreignRows = allRows.filter(
    (r) => store && codes[r.store] && codes[r.store].domain !== store.domain
  );

  function linkCode(code) {
    if (!store) return;
    const next = { ...codes, [code]: { name: store.name, domain: store.domain } };
    setCodes(next);
    save(LS_CODES, next);
    pushLog({ ok: true, text: `Storecode ${code} gekoppeld aan ${store.name}.` });
  }
  function unlinkCode(code) {
    const next = { ...codes };
    delete next[code];
    setCodes(next);
    save(LS_CODES, next);
  }

  /* ---------- Analyse (Shopify + koers + dupe-check) ---------- */

  async function analyse() {
    if (!store || !sheetId.trim() || !eligibleRows.length) return;
    setBusy("analyse");
    setEnriched(null);
    setCommitted(null);
    const chunks = [];
    for (let i = 0; i < eligibleRows.length; i += 100) chunks.push(eligibleRows.slice(i, i + 100));
    setProgress({ done: 0, total: eligibleRows.length });
    const out = [];
    try {
      for (const chunk of chunks) {
        const res = await fetch("/api/bills/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store: ordersStoreBody(),
            sheetId: sheetId.trim(),
            rows: chunk,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        out.push(...data.rows);
        setProgress({ done: out.length, total: eligibleRows.length });
      }
      setEnriched(out);
      const ok = out.filter((r) => r.status === "ok");
      const dupes = out.filter((r) => r.status === "dupe");
      const missing = out.filter((r) => r.status === "niet_gevonden");
      const today = out.filter((r) => r.status === "vandaag");
      pushLog({
        strong: true,
        text: `Analyse klaar: ${ok.length} nieuw · ${dupes.length} al gelogd · ${missing.length} niet gevonden in Shopify${
          today.length ? ` · ${today.length} van vandaag (wacht tot morgen)` : ""
        }.`,
      });
      if (today.length) {
        pushLog({
          warn: true,
          text: `${today.length} order${today.length === 1 ? "" : "s"} van vandaag wordt bewust NIET ingevuld — de dag is pas morgen compleet. Upload de bill morgen (opnieuw): alleen deze orders gaan dan mee, de rest valt vanzelf als dupe af.`,
        });
      }
      for (const r of out) {
        if (r.status === "vandaag") continue;
        if (r.status === "niet_gevonden") pushLog({ err: true, text: `Order ${r.order}: ${r.note}` });
        else if (r.status === "koers_mislukt") pushLog({ err: true, text: `Order ${r.order}: ${r.note}` });
        else if (r.note) pushLog({ warn: true, text: `Order ${r.order}: ${r.note}` });
      }
    } catch (e) {
      pushLog({ err: true, text: `Analyse gestopt: ${e.message}` });
    }
    setBusy("");
  }

  /* ---------- Zet in sheet ---------- */

  const okRows = (enriched || []).filter((r) => r.status === "ok");

  async function commit() {
    if (!okRows.length || !sheetId.trim()) return;
    setBusy("commit");
    try {
      const res = await fetch("/api/bills/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId: sheetId.trim(), rows: okRows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.logCreated) pushLog({ ok: true, text: `Tabblad "COGS Log" aangemaakt.` });
      if (data.tooEarlySkipped) {
        pushLog({
          warn: true,
          text: `${data.tooEarlySkipped} order${data.tooEarlySkipped === 1 ? "" : "s"} van vandaag overgeslagen — vandaag wordt nooit ingevuld, morgen uploaden.`,
        });
      }
      for (const r of data.results || []) {
        if (r.written) {
          pushLog({
            ok: true,
            text: `${r.date} → ${money(r.sum)} in ${r.tab}!V${r.row}${r.note ? ` (${r.note})` : ""}`,
          });
        } else {
          pushLog({ warn: true, text: `${r.date}: ${r.note}` });
        }
      }
      pushLog({
        strong: true,
        text: `Klaar: ${data.appended} regel${data.appended === 1 ? "" : "s"} naar het COGS Log geschreven${
          data.dupesSkipped ? `, ${data.dupesSkipped} dupe${data.dupesSkipped === 1 ? "" : "s"} overgeslagen` : ""
        }.`,
      });
      setCommitted(data);
    } catch (e) {
      pushLog({ err: true, text: `Schrijven mislukt: ${e.message}` });
    }
    setBusy("");
  }

  function resetAll() {
    setBills([]);
    setEnriched(null);
    setCommitted(null);
    setLogs([]);
    setProgress({ done: 0, total: 0 });
  }

  /* ---------- Overzicht per datum ---------- */

  const vandaagRows = (enriched || []).filter((r) => r.status === "vandaag");
  const perDate = {};
  for (const r of okRows) {
    if (!perDate[r.date]) perDate[r.date] = { dateNL: r.dateNL, orders: 0, stuks: 0, orig: 0, cur: r.currency, gbp: 0, tabMissing: !r.tabExists };
    const d = perDate[r.date];
    d.orders++;
    d.stuks += r.stuks || 0;
    d.orig += r.cost || 0;
    d.gbp += r.gbp || 0;
    if (!r.tabExists) d.tabMissing = true;
  }
  const dates = Object.keys(perDate).sort();
  const totalGbp = okRows.reduce((a, r) => a + (r.gbp || 0), 0);

  const canAnalyse = Boolean(store && sheetId.trim() && eligibleRows.length && !busy);
  const canCommit = Boolean(okRows.length && !busy && !committed);

  return (
    <>
      <Header icon="£" title="Bills" subtitle="Kungfubuy → COGS in het P&L-sheet" />
      <div className="page layout-2col">
        <div>
          <div className="card">
            <h2>Store</h2>
            {stores.length === 0 && (
              <div className="center-note">Koppel eerst een store in de Importer.</div>
            )}
            {stores.map((s) => (
              <div
                key={s.domain}
                className={"store-item" + (selected === s.domain ? " selected" : "")}
                onClick={() => pickStore(s.domain)}
              >
                <div>
                  <strong>{s.name}</strong> <span className="muted small">({s.currency})</span>
                </div>
                <div className="dom">{s.domain}</div>
              </div>
            ))}
            <div className="hint">
              De orderdatum komt per ordernummer uit Shopify van deze store. De Importer-koppeling
              blijft voor producten; voor orders vul je hieronder de aparte Orders-app in.
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h2>Orders-app <span className="opt">— Dev Dashboard-app met read_orders</span></h2>
            <div className="field-label">Client ID</div>
            <input
              type="text"
              value={ordersApp.clientId}
              onChange={(e) => changeOrdersApp({ clientId: e.target.value })}
              placeholder="Client ID van bijv. P&L Sync"
              disabled={!store}
            />
            <div className="field-label" style={{ marginTop: 8 }}>Client secret</div>
            <input
              type="password"
              value={ordersApp.clientSecret}
              onChange={(e) => changeOrdersApp({ clientSecret: e.target.value })}
              placeholder="Client secret"
              disabled={!store}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn-ghost btn-small" onClick={testOrders} disabled={!store || (ordersTest && ordersTest.busy)}>
                {ordersTest && ordersTest.busy ? <span className="spin" /> : null} Test koppeling
              </button>
              {ordersTest && !ordersTest.busy && (
                <span className={"small " + (ordersTest.ok ? "" : "muted")} style={ordersTest.ok ? { color: "var(--ok)" } : { color: "var(--err)" }}>
                  {ordersTest.ok ? `✓ ${ordersTest.shop} · ${ordersTest.count} orders leesbaar` : `✗ ${ordersTest.error}`}
                </span>
              )}
            </div>
            <div className="hint">
              Sleutels worden per store in deze browser bewaard en alleen voor de order-lookup
              gebruikt. Leeg = de gewone store-koppeling. Vereist in het Dev Dashboard: app
              geïnstalleerd op deze store, scopes <strong>read_orders</strong> (+{" "}
              <strong>read_all_orders</strong> voor bills ouder dan 60 dagen) en{" "}
              <strong>Protected customer data access</strong> aangezet.
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h2>P&amp;L Sheet</h2>
            <div className="field-label">Sheet-link of ID</div>
            <input
              type="text"
              value={sheetId}
              onChange={(e) => changeSheet(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
            />
            <div className="hint">
              Deel de sheet één keer met het service account (Bewerker). De regels landen in het
              tabblad <strong>COGS Log</strong>; kolom V van de maandtab wordt per datum de som van
              dat log — handmatige V-waarden voor die datums worden dus overschreven.
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h2>Storecodes</h2>
            {Object.keys(codes).length === 0 && unknownCodes.length === 0 && (
              <div className="center-note">
                Nog geen codes gekoppeld. Upload een bill; de code uit de Store-kolom verschijnt
                hier en koppel je één keer.
              </div>
            )}
            {Object.entries(codes).map(([code, v]) => (
              <div className="toggle-row" key={code}>
                <span>
                  <strong>{code}</strong> <span className="muted small">→ {v.name}</span>
                </span>
                <button className="btn-ghost btn-small" onClick={() => unlinkCode(code)}>
                  ✕
                </button>
              </div>
            ))}
            {unknownCodes.map((code) => (
              <div className="toggle-row" key={code}>
                <span>
                  <span className="badge badge-amber">nieuw</span> <strong>{code}</strong>{" "}
                  <span className="muted small">({codeGroups[code].count} regels)</span>
                </span>
                <button
                  className="btn-ghost btn-small"
                  disabled={!store}
                  onClick={() => linkCode(code)}
                >
                  Koppel aan {store ? store.name : "…"}
                </button>
              </div>
            ))}
            <div className="hint">
              Kungfubuy zet geen storenaam maar een code op de bill. Eén keer koppelen is genoeg —
              daarna herkent de tool elke volgende bill vanzelf, en regels van een ándere store
              worden nooit in deze sheet gezet.
            </div>
          </div>
        </div>

        <div>
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
            <h2>Bills uploaden</h2>
            <div className="hint" style={{ marginTop: 0 }}>
              Sleep hier één of meer Kungfubuy-PDF's in (dagelijkse bill of een hele backlog — ook
              honderden orders per bill).
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => addFiles(e.target.files)}
            />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                className="btn-ghost"
                disabled={busy === "parse"}
                onClick={() => fileRef.current && fileRef.current.click()}
              >
                {busy === "parse" ? "Bezig met lezen…" : "Kies PDF's"}
              </button>
              {bills.length > 0 && (
                <>
                  <span className="badge badge-green">
                    {bills.length} bill{bills.length === 1 ? "" : "s"} ·{" "}
                    {allRows.length} orderregel{allRows.length === 1 ? "" : "s"}
                  </span>
                  <button className="btn-ghost btn-small" onClick={resetAll}>
                    Wis lijst
                  </button>
                </>
              )}
            </div>

            {bills.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <table className="mini-table">
                  <tbody>
                    <tr>
                      <td>Invoice</td>
                      <td>Factuurdatum</td>
                      <td>Orders</td>
                      <td>Stuks</td>
                      <td>Bedrag</td>
                    </tr>
                    {bills.map((b) => {
                      const sum = (b.rows || []).reduce((a, r) => a + (r.cost || 0), 0);
                      const cur = b.rows && b.rows[0] ? b.rows[0].currency : "";
                      const stuks = (b.rows || []).reduce((a, r) => a + (r.stuks || 0), 0);
                      return (
                        <tr key={b.invoiceNo || b.name}>
                          <td>{b.invoiceNo || b.name}</td>
                          <td>{b.invoiceDate || "?"}</td>
                          <td>{(b.rows || []).length}</td>
                          <td>{stuks}</td>
                          <td>
                            {sum.toFixed(2)} {cur}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {foreignRows.length > 0 && (
                  <div className="hint">
                    {foreignRows.length} regel{foreignRows.length === 1 ? "" : "s"} van een andere
                    gekoppelde store — die blijven hier buiten.
                  </div>
                )}
                {unknownCodes.length > 0 && (
                  <div className="hint" style={{ color: "var(--warn)" }}>
                    Eerst de nieuwe storecode koppelen (links) — anders weet de tool niet zeker dat
                    deze bill bij {store ? store.name : "de gekozen store"} hoort.
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <button className="btn" disabled={!canAnalyse} onClick={analyse}>
                    {busy === "analyse"
                      ? `Analyseren… ${progress.done}/${progress.total}`
                      : `Analyseer ${eligibleRows.length} orderregel${eligibleRows.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {enriched && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2>Controle vooraf</h2>
              {dates.length > 0 ? (
                <>
                  <table className="mini-table">
                    <tbody>
                      <tr>
                        <td>Datum (orderdag)</td>
                        <td>Orders</td>
                        <td>Stuks</td>
                        <td>Origineel</td>
                        <td>COGS £</td>
                      </tr>
                      {dates.map((d) => (
                        <tr key={d}>
                          <td>
                            {perDate[d].dateNL}
                            {perDate[d].tabMissing ? " ⚠" : ""}
                          </td>
                          <td>{perDate[d].orders}</td>
                          <td>{perDate[d].stuks}</td>
                          <td>
                            {perDate[d].orig.toFixed(2)} {perDate[d].cur}
                          </td>
                          <td>{money(perDate[d].gbp)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td>
                          <strong>Totaal</strong>
                        </td>
                        <td>
                          <strong>{okRows.length}</strong>
                        </td>
                        <td>
                          <strong>{okRows.reduce((a, r) => a + (r.stuks || 0), 0)}</strong>
                        </td>
                        <td />
                        <td>
                          <strong>{money(totalGbp)}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="hint">
                    Koers: ECB-dagkoers van de orderdatum zelf (weekend = laatste bankdag ervoor) —
                    zo klopt ook een backlog van oude bills per dag. Kolom V wordt de som van het
                    volledige COGS Log voor die datum.
                  </div>
                  {vandaagRows.length > 0 && (
                    <div className="hint" style={{ color: "var(--warn)" }}>
                      {vandaagRows.length} order{vandaagRows.length === 1 ? "" : "s"} van vandaag
                      staat hier bewust niet tussen — vandaag wordt nooit ingevuld. Upload de bill
                      morgen (opnieuw) en alleen die orders gaan alsnog mee.
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <button className="btn" disabled={!canCommit} onClick={commit}>
                      {busy === "commit"
                        ? "Schrijven…"
                        : committed
                        ? "In sheet gezet ✓"
                        : `Zet in sheet — ${okRows.length} order${okRows.length === 1 ? "" : "s"} · ${money(totalGbp)}`}
                    </button>
                  </div>
                </>
              ) : (
                <div className="center-note">
                  Geen nieuwe regels om te schrijven — alles staat al in het COGS Log, is niet
                  gevonden, of is van vandaag (vandaag wordt nooit ingevuld — zie log).
                </div>
              )}
            </div>
          )}

          {logs.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2>Log</h2>
              <div className="logpanel">
                {[...logs].reverse().map((l, i) => (
                  <div className="log" key={logs.length - i}>
                    {l.err ? (
                      <>
                        <span className="err">✗</span> <span style={{ flex: 1 }}>{l.text}</span>
                      </>
                    ) : l.warn ? (
                      <span className="warn">{l.text}</span>
                    ) : l.strong ? (
                      <strong>{l.text}</strong>
                    ) : l.ok ? (
                      <>
                        <span className="ok">✓</span> <span style={{ flex: 1 }}>{l.text}</span>
                      </>
                    ) : (
                      <span className="muted">{l.text}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
