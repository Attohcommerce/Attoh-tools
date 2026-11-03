"use client";

/* COLLECTIES (Store Doctor, 02-11-2026)
   Overzicht van alle collecties met het aantal actieve producten, welke te
   leeg zijn (< 30) en hoeveel er nog bij moeten tot 40. Aanvinken → bladnaam
   → Aanvullen: de tool kijkt per collectie wat er verkoopt en welke keywords
   uit het All-batch keyword-geheugen van de markt erbij passen, verdeelt het
   tekort en zet dat als blad in de TPK-sheet van de store — klaar voor de
   Scraper (bron TPK-sheet → dat blad). */
import { useEffect, useMemo, useState } from "react";
import { orgLS } from "@/lib/org-client";

const LS_ORDERS_APP = "sa_orders_app::";

function todayTab() {
  const d = new Date();
  return `Aanvul collecties ${d.getDate()}-${d.getMonth() + 1}`;
}

export default function CollectionFill({ store, scanKey }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [sel, setSel] = useState({});
  const [tab, setTab] = useState(todayTab());
  const [result, setResult] = useState(null);
  const [showOk, setShowOk] = useState(false);

  const body = store
    ? { domain: store.domain, publicDomain: store.publicDomain, currency: store.currency, name: store.name, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret }
    : null;

  async function call(payload) {
    const r = await fetch("/api/collection-fill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const txt = await r.text();
    let d;
    try {
      d = JSON.parse(txt);
    } catch {
      throw new Error(`server gaf geen JSON (${r.status}) — waarschijnlijk tijdslimiet, probeer opnieuw`);
    }
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }

  async function scan() {
    if (!body) return;
    setBusy("scan");
    setErr("");
    setResult(null);
    try {
      const d = await call({ action: "scan", store: body });
      setData(d);
      const pre = {};
      for (const c of d.collections) if (!c.generic && !c.duplicateOf && c.status === "te-leeg") pre[c.id] = true;
      setSel(pre);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  // na elke Doctor-scan automatisch mee
  useEffect(() => {
    if (scanKey && store) scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanKey, store && store.domain]);

  const rows = data ? data.collections : [];
  const visible = useMemo(() => rows.filter((c) => showOk || c.status !== "ok" || sel[c.id]), [rows, showOk, sel]);
  const chosen = rows.filter((c) => sel[c.id]);
  const chosenGap = chosen.reduce((s, c) => s + c.gap, 0);
  const counts = useMemo(() => {
    const k = { teLeeg: 0, bijna: 0, ok: 0, gap: 0 };
    for (const c of rows) {
      if (c.generic) continue;
      if (c.status === "te-leeg") k.teLeeg++;
      else if (c.status === "bijna") k.bijna++;
      else if (c.status === "ok") k.ok++;
      k.gap += c.gap;
    }
    return k;
  }, [rows]);

  async function fill() {
    if (!chosen.length || !tab.trim()) return;
    setBusy("fill");
    setErr("");
    setResult(null);
    try {
      let ordersStore = null;
      try {
        const keys = JSON.parse(orgLS.getItem(LS_ORDERS_APP + store.domain) || "null");
        if (keys && keys.clientId && keys.clientSecret) ordersStore = { domain: store.domain, clientId: keys.clientId, clientSecret: keys.clientSecret };
      } catch {}
      const plan = await call({
        action: "plan",
        store: body,
        ordersStore,
        collections: chosen.map((c) => ({ id: c.id, title: c.title })),
        target: data.target,
      });
      const w = await call({ action: "write", plan, tab: tab.trim() });
      setResult({ plan, write: w });
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  if (!store) return null;
  const mem = data && data.memory;

  return (
    <div className="sd-card cf">
      <div className="cf-head">
        <div className="sd-card__title" style={{ marginBottom: 0 }}>
          Collecties <span className="sd-muted">doel {data ? data.target : 40} per collectie · minimaal {data ? data.min : 30}</span>
        </div>
        <button className="sd-btn sd-btn--small" onClick={scan} disabled={!!busy}>
          {busy === "scan" ? "Scannen…" : data ? "Opnieuw scannen" : "Collecties scannen"}
        </button>
      </div>

      {err && <div className="sd-alert" style={{ marginTop: 10 }}>{err}</div>}
      {!data && busy !== "scan" && <div className="sd-muted cf-empty">Scan de store (of klik op Collecties scannen) om het overzicht te zien.</div>}

      {data && (
        <>
          <div className="cf-tiles">
            <div className="cf-tile cf-tile--err"><b>{counts.teLeeg}</b><span>te leeg (&lt; {data.min})</span></div>
            <div className="cf-tile cf-tile--warn"><b>{counts.bijna}</b><span>bijna ({data.min}–{data.target - 1})</span></div>
            <div className="cf-tile cf-tile--ok"><b>{counts.ok}</b><span>op doel</span></div>
            <div className="cf-tile"><b>{counts.gap}</b><span>producten tekort</span></div>
          </div>

          <div className="cf-links">
            <span className={`sd-pill${mem.market ? " sd-pill--ok" : " sd-pill--warn"}`}>markt {mem.market || "onbekend"}</span>
            <span className={`sd-pill${mem.tpk ? " sd-pill--ok" : " sd-pill--warn"}`}>
              {mem.tpk ? <a href={mem.tpkUrl} target="_blank" rel="noreferrer">TPK-sheet gekoppeld ↗</a> : "geen TPK-sheet in het store-geheugen"}
            </span>
            <span className="sd-pill sd-pill--ok">All-batch keywords {mem.market || ""}</span>
            <label className="cf-toggle">
              <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} /> ook volle collecties tonen
            </label>
          </div>

          <div className="cf-list">
            {visible.map((c) => {
              const pct = Math.min(100, Math.round((c.active / data.target) * 100));
              const disabled = c.generic;
              return (
                <label key={c.id} className={`cf-row cf-row--${c.status}${sel[c.id] ? " is-on" : ""}${disabled ? " is-off" : ""}`}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={!!sel[c.id]}
                    onChange={(e) => setSel((s) => ({ ...s, [c.id]: e.target.checked }))}
                  />
                  <span className="cf-name">
                    {c.title}
                    {c.duplicateOf ? <em className="cf-dup">dubbel</em> : null}
                    {!c.published ? <em className="cf-dup">niet gepubliceerd</em> : null}
                  </span>
                  <span className="cf-bar"><i style={{ width: `${pct}%` }} /></span>
                  <span className="cf-num">{c.active}</span>
                  <span className="cf-gap">{disabled ? "hoofdcollectie" : c.gap ? `+${c.gap}` : "✓"}</span>
                </label>
              );
            })}
          </div>

          <div className="cf-action">
            <div className="cf-tabname">
              <span className="sd-muted">Bladnaam in de TPK-sheet</span>
              <input type="text" value={tab} onChange={(e) => setTab(e.target.value)} />
            </div>
            <button className="sd-btn sd-btn--gold" onClick={fill} disabled={!!busy || !chosen.length || !tab.trim() || !mem.tpk}>
              {busy === "fill" ? "Plan maken…" : `Aanvullen · ${chosen.length} collecties · +${chosenGap}`}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="cf-result">
          <div className="cf-result__top">
            <span className="sd-ok">
              ✓ {result.write.keywords} keywords · {result.write.products} producten ingepland in blad "{result.write.tab}"
              {result.write.scrapeReady ? " — scrape-ready" : ""}
            </span>
            <a className="sd-btn sd-btn--small" href={result.write.url} target="_blank" rel="noreferrer">Open blad ↗</a>
          </div>
          <div className="sd-muted cf-next">
            Volgende stap: Scraper → bron TPK-sheet → blad "{result.write.tab}" → scrapen. Kolom O geeft daarna het foto-cijfer.
          </div>
          {(result.plan.warnings || []).map((w, i) => (
            <div key={i} className="sd-note">{w}</div>
          ))}
          <div className="cf-plan">
            {result.plan.plans.map((p) => (
              <div key={p.id} className="cf-plan__coll">
                <div className="cf-plan__title">
                  <b>{p.title}</b> <span className="sd-muted">{p.current} → {result.plan.target} · +{p.planned || 0}</span>
                </div>
                <div className="cf-plan__kws">
                  {p.rows.map((r) => (
                    <span key={r.zoekterm} className={`sd-chip${r.src === "Verkocht" ? " sd-chip--ok" : ""}`} title={r.src === "Verkocht" ? `${r.orders} orders in 60 d` : `zoekvolume ${r.vol}`}>
                      {r.zoekterm} · {r.n}
                    </span>
                  ))}
                  {(p.notes || []).map((n, i) => (
                    <span key={i} className="sd-muted cf-plan__note">{n}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
