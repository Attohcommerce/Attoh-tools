"use client";
// 03 STORE DOCTOR — store nalopen, fixen in porties, en voorraad zetten.
import { useMemo, useRef, useState } from "react";
import { sfx } from "../components/sfx";
import { postJSON, creds, lsGet } from "./util";

// Volgorde van FIX ALLES: eerst wat bestellen zonder voorraad tegenhoudt,
// dan indeling (type/tags), dan collecties (na een nieuwe scan), dan de rest.
const FIX_ORDER = ["oversell", "classify", "title", "seo", "alt", "sku", "rewrite", "collections"];
const CHUNK = { rewrite: 3 };

export default function DoctorTab({ notify, store }) {
  const [view, setView] = useState("scan");
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState({});
  const [log, setLog] = useState([]);
  const [filter, setFilter] = useState("all");
  const stopRef = useRef(false);

  const addLog = (msg, cls = "") => setLog((l) => [...l.slice(-300), { t: new Date().toLocaleTimeString("nl-NL"), msg, cls }]);

  async function doScan() {
    if (!store) return notify("Kies eerst rechtsboven je store", true);
    setBusy("scan");
    try {
      const r = await postJSON("/api/pokemon/doctor", { store: creds(store), action: "scan" });
      setScan(r);
      sfx("ok");
      return r;
    } catch (e) {
      notify(e.message, true);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function runFix(finding, label) {
    const fix = finding.fix;
    const ids = finding.items.map((i) => i.id);
    const size = CHUNK[fix] || 20;
    let ok = 0;
    let fail = 0;
    addLog(`▶ ${label || finding.label}: ${ids.length}`);
    for (let i = 0; i < ids.length; i += size) {
      if (stopRef.current) break;
      setBusy(`${fix} ${Math.min(i + size, ids.length)}/${ids.length}`);
      try {
        const r = await postJSON("/api/pokemon/doctor", { store: creds(store), action: "fix", fix, ids: ids.slice(i, i + size), settings: lsGet("pk_settings", {}) });
        ok += (r.done || []).length;
        fail += (r.failed || []).length;
        for (const f of r.failed || []) addLog(`✕ ${f.id}: ${f.error}`, "err");
      } catch (e) {
        fail += Math.min(size, ids.length - i);
        addLog(`✕ ${e.message}`, "err");
      }
    }
    addLog(`✓ ${finding.label}: ${ok} gefixt${fail ? `, ${fail} mislukt` : ""}`, fail ? "err" : "ok");
    return { ok, fail };
  }

  async function fixOne(f) {
    stopRef.current = false;
    await runFix(f);
    setBusy("");
    sfx("success");
    await doScan();
  }

  async function fixAll() {
    if (!scan) return;
    const todo = FIX_ORDER.map((id) => scan.findings.find((f) => f.fix === id && f.items.length)).filter(Boolean);
    if (!todo.length) return notify("Niets om automatisch te fixen");
    const n = todo.reduce((s, f) => s + f.items.length, 0);
    if (!window.confirm(`FIX ALLES: ${todo.length} soorten fixes, ${n} acties.\n\n${todo.map((f) => `• ${f.label} (${f.items.length})`).join("\n")}\n\nConcept-producten blijven concept.`)) return;
    stopRef.current = false;
    setLog([]);
    let fresh = scan;
    for (const id of FIX_ORDER) {
      if (stopRef.current) break;
      // na "classify" nieuwe scan, zodat collecties/titels kloppen
      if (id === "collections" || id === "title") {
        const s = await postJSON("/api/pokemon/doctor", { store: creds(store), action: "scan" }).catch(() => null);
        if (s) fresh = s;
      }
      const f = fresh.findings.find((x) => x.fix === id && x.items.length);
      if (f) await runFix(f);
    }
    setBusy("");
    sfx("success");
    await doScan();
  }

  const findings = useMemo(() => {
    if (!scan) return [];
    const order = { error: 0, warn: 1, info: 2 };
    return scan.findings.filter((f) => filter === "all" || f.severity === filter).sort((a, b) => order[a.severity] - order[b.severity] || b.items.length - a.items.length);
  }, [scan, filter]);

  const s = scan && scan.summary;
  const ringColor = s ? (s.score >= 85 ? "var(--good)" : s.score >= 60 ? "#f59e0b" : "var(--bad)") : "var(--line)";

  return (
    <>
      <div className="pk-hero">
        <div>
          <h1>Store Doctor</h1>
          <p>Loopt je hele Pokémon-store na: niets mag bestelbaar zijn zonder voorraad, elke tekst in eigen woorden, alles in de juiste collectie. En als de levering binnen is zet je hier de voorraad.</p>
        </div>
        <div className="pk-tabs">
          <button className={"pk-tab" + (view === "scan" ? " on" : "")} onClick={() => setView("scan")}>
            Scan & fix
          </button>
          <button className={"pk-tab" + (view === "stock" ? " on" : "")} onClick={() => setView("stock")}>
            Voorraad
          </button>
        </div>
      </div>

      {!store ? (
        <div className="pk-empty">
          <b>Geen store gekozen</b>Kies rechtsboven je Pokémon-store (of koppel er een).
        </div>
      ) : view === "stock" ? (
        <StockPanel store={store} notify={notify} />
      ) : (
        <>
          <div className="pk-card" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <div className="pk-ring" style={{ background: `conic-gradient(${ringColor} ${(s ? s.score : 0) * 3.6}deg, var(--line) 0)` }}>
              <div style={{ width: 66, height: 66, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center" }}>{s ? s.score : "–"}</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h3 style={{ marginBottom: 2 }}>{store.name || store.domain}</h3>
              <div className="pk-hint">{s ? `${s.total} producten · ${s.soldOut} uitverkocht · ${s.inStock} op voorraad${s.seoChecked ? "" : " · SEO niet gecontroleerd"}` : "Nog niet gescand"}</div>
            </div>
            <div className="pk-row">
              <button className="pk-btn dark big" onClick={doScan} disabled={!!busy}>
                {busy === "scan" ? "Scannen…" : "🔍 Scan"}
              </button>
              <button className="pk-btn primary big" onClick={fixAll} disabled={!scan || !!busy}>
                ⚡ FIX ALLES
              </button>
              {busy && busy !== "scan" && (
                <button className="pk-btn big" onClick={() => (stopRef.current = true)}>
                  Pauze
                </button>
              )}
            </div>
            {busy && busy !== "scan" && <div className="pk-hint" style={{ width: "100%" }}>Bezig: {busy}</div>}
          </div>

          {scan && (
            <>
              <div className="pk-chips" style={{ margin: "16px 0 10px" }}>
                {[["all", "Alles"], ["error", "Fouten"], ["warn", "Waarschuwingen"], ["info", "Tips"]].map(([k, v]) => (
                  <button key={k} className={"pk-chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>
                    {v}
                    <span className="c">{k === "all" ? scan.findings.length : scan.findings.filter((f) => f.severity === k).length}</span>
                  </button>
                ))}
              </div>
              {findings.length === 0 ? (
                <div className="pk-empty">
                  <b>Alles in orde ✓</b>
                </div>
              ) : (
                findings.map((f) => (
                  <div key={f.id} className="pk-find">
                    <div className="pk-find-head" onClick={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))}>
                      <span className={"pk-sev " + f.severity} />
                      <span className="lbl">{f.label}</span>
                      <span className="cnt">{f.items.length}</span>
                      {f.fix && (
                        <button
                          className="pk-btn sm primary"
                          disabled={!!busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            fixOne(f);
                          }}
                        >
                          ⚡ Fix
                        </button>
                      )}
                      <span className="pk-hint">{open[f.id] ? "▲" : "▼"}</span>
                    </div>
                    {open[f.id] && (
                      <div className="pk-find-body">
                        <div className="why">{f.explain}</div>
                        <div className="pk-items">
                          {f.items.slice(0, 300).map((it, i) => (
                            <div key={it.id + "-" + i} className="pk-item">
                              {it.image ? <img src={it.image} alt="" /> : null}
                              {typeof it.id === "number" ? (
                                <a href={`https://${store.domain}/admin/products/${it.id}`} target="_blank" rel="noreferrer">
                                  {it.title}
                                </a>
                              ) : (
                                <span>{it.title}</span>
                              )}
                              <span className="d">{it.detail}</span>
                            </div>
                          ))}
                          {f.items.length > 300 && <div className="pk-hint">… en nog {f.items.length - 300}</div>}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}
          {log.length > 0 && (
            <div className="pk-log" style={{ marginTop: 16 }}>
              {log.map((l, i) => (
                <div key={i} className={l.cls}>
                  <span className="dim">{l.t}</span> {l.msg}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function StockPanel({ store, notify }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState("all");

  async function load() {
    setBusy(true);
    try {
      const r = await postJSON("/api/pokemon/doctor", { store: creds(store), action: "stocklist" });
      if (!r.ok) throw new Error(r.error);
      setList(r.products);
      setEdits({});
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const items = Object.entries(edits).map(([variantId, qty]) => {
      const p = list.find((x) => x.variants.some((v) => String(v.id) === variantId));
      return { productId: p.id, variantId, qty: Number(qty) };
    });
    if (!items.length) return;
    setBusy(true);
    try {
      let done = 0;
      const failed = [];
      for (let i = 0; i < items.length; i += 25) {
        const r = await postJSON("/api/pokemon/doctor", { store: creds(store), action: "stock", items: items.slice(i, i + 25) });
        if (r.ok === false) throw new Error(r.error);
        done += (r.done || []).length;
        failed.push(...(r.failed || []));
      }
      sfx(failed.length ? "error" : "success");
      notify(`${done} voorraad bijgewerkt${failed.length ? ` · ${failed.length} mislukt: ${failed[0].error}` : ""}`, !!failed.length);
      await load();
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    if (!list) return [];
    const qq = q.trim().toLowerCase();
    return list
      .flatMap((p) => p.variants.map((v) => ({ p, v })))
      .filter(({ p, v }) => (!qq || p.title.toLowerCase().includes(qq)) && (only === "all" || (only === "in" ? v.qty > 0 : v.qty <= 0)));
  }, [list, q, only]);

  return (
    <div className="pk-card">
      <div className="pk-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Voorraad</h3>
        <div className="pk-row">
          <button className="pk-btn" onClick={load} disabled={busy}>
            {list ? "↻ Vernieuwen" : "Laad producten"}
          </button>
          <button className="pk-btn primary" onClick={save} disabled={busy || !Object.keys(edits).length}>
            Opslaan ({Object.keys(edits).length})
          </button>
        </div>
      </div>
      <p className="pk-hint" style={{ marginBottom: 12 }}>
        Levering binnen? Vul per product het aantal in en klik Opslaan. Bij voorraad 0 toont de store weer "Sold out". Vraagt wel de scopes write_inventory en read_locations in de Shopify-app.
      </p>
      {list && (
        <>
          <div className="pk-toolbar">
            <input type="search" placeholder="Zoek product…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="all">Alles</option>
              <option value="out">Uitverkocht</option>
              <option value="in">Op voorraad</option>
            </select>
            <span className="pk-hint">{rows.length} varianten</span>
          </div>
          {rows.slice(0, 400).map(({ p, v }) => (
            <div key={v.id} className="pk-stock-row">
              {p.image ? <img src={p.image} alt="" /> : <span />}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.title}</div>
                <div className="pk-hint">
                  {v.title !== "Default Title" ? v.title + " · " : ""}
                  nu {v.qty}
                  {!v.tracked ? " · voorraad niet bijgehouden!" : v.policy === "continue" ? " · doorverkopen aan!" : ""}
                </div>
              </div>
              <input
                type="number"
                min="0"
                placeholder={String(v.qty)}
                value={edits[v.id] ?? ""}
                onChange={(e) =>
                  setEdits((m) => {
                    const n = { ...m };
                    if (e.target.value === "") delete n[v.id];
                    else n[v.id] = e.target.value;
                    return n;
                  })
                }
              />
              <span className="pk-hint hide-sm">{v.price}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
