"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";

/* IMPORTPLANNEN (28-11-2026) — Justin: "Ik maak in de chat met Claude het
   plan, en voer het via de tool door voor alle stores tegelijk."

   Claude zet het plan klaar via de Attoh-connector (import_plan put), op basis
   van ALL KEYWORDS (keywords_lookup) en het store-geheugen. Hier: plan kiezen,
   per store bekijken (keywords, collectie, man/vrouw, aantal, volume) en met
   één klik per store een blad in de TPK-sheet zetten, in het scraper-formaat.
   Daarna gewoon Product Scraper → TPK-sheet + dat blad → Importer. */

async function api(body) {
  const res = await fetch("/api/import-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const fmtN = (n) => (n ? Number(n).toLocaleString("nl-NL") : "—");

export default function ImportplannenPage() {
  const [plans, setPlans] = useState(null);
  const [plan, setPlan] = useState(null);
  const [openStore, setOpenStore] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [results, setResults] = useState(null);

  async function load() {
    const d = await api({ action: "list" });
    setPlans(d.plans || []);
    if (!plan && d.plans && d.plans[0]) pick(d.plans[0].id);
  }
  async function pick(id) {
    setErr("");
    setResults(null);
    try {
      const d = await api({ action: "get", id });
      setPlan(d.plan);
      setOpenStore(d.plan.stores[0] ? d.plan.stores[0].store : "");
      if (d.plan.applied) setResults(d.plan.applied);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apply(stores) {
    if (!plan) return;
    setBusy(stores ? stores[0] : "all");
    setErr("");
    try {
      const d = await api({ action: "apply", id: plan.id, stores });
      setResults((prev) => {
        const map = new Map((prev || []).map((r) => [r.store, r]));
        for (const r of d.results) map.set(r.store, r);
        return [...map.values()];
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  const totals = useMemo(() => {
    if (!plan) return null;
    let kw = 0;
    let prod = 0;
    for (const s of plan.stores) {
      kw += s.rows.length;
      prod += s.rows.reduce((a, r) => a + r.count, 0);
    }
    return { kw, prod };
  }, [plan]);
  const resOf = (name) => (results || []).find((r) => r.store && (r.store === name || name.toLowerCase().includes(String(r.store).toLowerCase()) || String(r.store).toLowerCase().includes(name.toLowerCase())));

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Importplannen" />
      <div className="page">
        {err ? <div className="hint err" style={{ marginBottom: 10 }}>{err}</div> : null}

        <div className="card">
          <h2>
            🗂 Importplannen
            <span className="opt">gemaakt door Claude in de chat · per store een blad in de TPK-sheet · daarna Product Scraper</span>
          </h2>
          {plans === null ? (
            <div className="small muted">Laden…</div>
          ) : !plans.length ? (
            <div className="small muted">Nog geen plannen. Vraag Claude in de chat: "maak het importplan voor deze week".</div>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {plans.map((p) => (
                <button key={p.id} className={plan && plan.id === p.id ? "btn btn-small" : "btn-ghost btn-small"} onClick={() => pick(p.id)}>
                  {p.week ? `${p.week} · ` : ""}
                  {p.name} ({p.stores} stores · {p.products} producten)
                </button>
              ))}
            </div>
          )}
        </div>

        {plan ? (
          <div className="card">
            <h2>
              {plan.week ? `${plan.week} · ` : ""}
              {plan.name}
              <span className="opt">
                {plan.stores.length} stores · {totals.kw} keywords · {totals.prod} producten{plan.source ? ` · bron: ${plan.source}` : ""}
              </span>
            </h2>
            {plan.note ? <div className="small" style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{plan.note}</div> : null}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <button className="btn" disabled={!!busy} onClick={() => apply(null)}>
                {busy === "all" ? "Bezig…" : `✓ Zet in de TPK-sheets (alle ${plan.stores.length} stores)`}
              </button>
              <span className="small muted">Bestaat het blad al, dan wordt het overschreven. Er wordt verder niets aan de sheets of stores veranderd.</span>
            </div>

            {plan.stores.map((s) => {
              const n = s.rows.reduce((a, r) => a + r.count, 0);
              const r = resOf(s.store);
              const open = openStore === s.store;
              return (
                <div key={s.store} style={{ borderTop: "1px solid rgba(127,127,127,.2)", padding: "10px 0" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="linklike" onClick={() => setOpenStore(open ? "" : s.store)} style={{ fontWeight: 700 }}>
                      {open ? "▾" : "▸"} {s.store}
                    </button>
                    <span className="small muted">
                      blad &quot;{s.tab}&quot; · {s.rows.length} keywords · {n} producten · {s.rows.filter((x) => x.gender === "V").reduce((a, x) => a + x.count, 0)} V / {s.rows.filter((x) => x.gender === "M").reduce((a, x) => a + x.count, 0)} M
                    </span>
                    <span style={{ flex: 1 }} />
                    {r ? (
                      r.ok ? (
                        <a className="badge badge-green" href={r.sheet} target="_blank" rel="noreferrer">
                          ✓ in TPK-sheet · {r.products} producten{r.scrapeReady ? " · scrape-ready" : ""}
                        </a>
                      ) : (
                        <span className="badge bc-badge-err">✗ {r.error}</span>
                      )
                    ) : null}
                    <button className="btn-ghost btn-small" disabled={!!busy} onClick={() => apply([s.store])}>
                      {busy === s.store ? "Bezig…" : "Alleen deze store"}
                    </button>
                  </div>
                  {s.note ? <div className="small muted" style={{ marginTop: 4 }}>{s.note}</div> : null}
                  {open ? (
                    <div style={{ maxHeight: "50vh", overflow: "auto", marginTop: 8 }}>
                      <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ textAlign: "left" }}>
                            <th>Keyword</th>
                            <th>Collectie</th>
                            <th>Groep</th>
                            <th>Aantal</th>
                            <th>Volume venster</th>
                            <th>Gem./mnd</th>
                            <th>Piek</th>
                            <th>Type</th>
                            <th>Waarom</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.rows
                            .slice()
                            .sort((a, b) => b.count - a.count || b.vol - a.vol)
                            .map((x) => (
                              <tr key={x.gender + x.keyword} style={{ borderTop: "1px solid rgba(127,127,127,.12)" }}>
                                <td>{x.keyword}</td>
                                <td>{x.collection}</td>
                                <td>{x.gender}</td>
                                <td>
                                  <b>{x.count}</b>
                                </td>
                                <td>{fmtN(x.vol)}</td>
                                <td>{fmtN(x.avg)}</td>
                                <td>{x.peak}</td>
                                <td>{x.type}</td>
                                <td className="muted" style={{ maxWidth: 360 }}>{x.uitleg}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="hint" style={{ marginTop: 10 }}>
              Daarna per store: Product Scraper → bron TPK-sheet → blad &quot;{plan.stores[0] ? plan.stores[0].tab : "Plan"}&quot; → run → Importer.
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
