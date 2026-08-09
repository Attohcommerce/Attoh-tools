"use client";

// Store QA — kijkt naar de HELE store in samenhang en zoekt systematische
// fouten voordat Merchant Center ze vindt.
import { useEffect, useState } from "react";
import Header from "../components/Header";

const LS_STORES = "sa_stores";
const LS_SELECTED = "sa_selected_store";

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export default function QaPage() {
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);
  const [max, setMax] = useState("500");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState({});

  useEffect(() => {
    setStores(load(LS_STORES, []));
    setSelected(load(LS_SELECTED, null));
  }, []);

  const store = stores.find((s) => s.domain === selected) || null;

  async function run() {
    if (!store || busy) return;
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      const r = await fetch("/api/store-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store: {
            domain: store.domain,
            token: store.token,
            clientId: store.clientId,
            clientSecret: store.clientSecret,
          },
          max: Number(max) || 500,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      setRes(data);
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: data.stats.errors ? "error" : "success" }));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const scoreColor = (s) => (s >= 8.5 ? "var(--ok)" : s >= 6.5 ? "var(--warn)" : "var(--err)");

  return (
    <>
      <Header icon="Q" title="Store QA" subtitle="Systematische fouten opsporen" />
      <div className="page layout-2col">
        <div>
          <div className="card">
            <h2>Controle draaien</h2>
            <div className="field-label">Store</div>
            {stores.length === 0 && (
              <div className="center-note">Koppel eerst een store in de Importer.</div>
            )}
            {stores.map((s) => (
              <div
                key={s.domain}
                className={"store-item" + (selected === s.domain ? " selected" : "")}
                onClick={() => setSelected(s.domain)}
              >
                <div>
                  <strong>{s.name}</strong> <span className="muted small">({s.currency})</span>
                </div>
                <div className="dom">{s.domain}</div>
              </div>
            ))}

            <div className="field-label">Maximaal aantal producten</div>
            <input type="number" value={max} onChange={(e) => setMax(e.target.value)} />
            <div className="hint">
              Controleert titels, foto's, prijzen, tags, collecties, templates en omschrijvingen —
              en laat daarna een AI-steekproef zoeken naar patronen die zich over veel producten
              herhalen.
            </div>

            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={run} disabled={!store || busy}>
                {busy ? "Bezig met controleren…" : "✓ Store controleren"}
              </button>
            </div>
            {err && <div className="hint" style={{ color: "var(--err)" }}>{err}</div>}
          </div>
        </div>

        <div>
          <div className="card prog-card" style={{ minHeight: 320 }}>
            {!res && <div className="center-note">Kies een store en start de controle.</div>}
            {res && (
              <>
                <div className="prog-top">
                  <span className="prog-title">Resultaat · {res.scanned} producten</span>
                  <span className="prog-count" style={{ color: scoreColor(res.stats.score) }}>
                    {String(res.stats.score).replace(".", ",")}/10
                  </span>
                </div>
                <div className="prog-meta">
                  <span>
                    <span className="err">{res.stats.errors} fouten</span>
                    <span className="prog-sep"> · </span>
                    {res.stats.warns} waarschuwingen
                  </span>
                </div>

                <div className="logpanel" style={{ marginTop: 12 }}>
                  {res.findings.length === 0 && (
                    <div className="center-note">Geen harde fouten gevonden. Netjes.</div>
                  )}
                  {res.findings.map((f) => (
                    <div key={f.id} className="log" style={{ display: "block" }}>
                      <div
                        style={{ display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer" }}
                        onClick={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))}
                      >
                        <span className={f.level === "error" ? "err" : "warn"}>
                          {f.level === "error" ? "✗" : "!"}
                        </span>
                        <span style={{ flex: 1, fontWeight: 600 }}>{f.title}</span>
                        <span className="muted small">{f.count}×</span>
                        <span className="muted small">{open[f.id] ? "▾" : "▸"}</span>
                      </div>
                      {open[f.id] && (
                        <div style={{ paddingLeft: 20, marginTop: 6 }}>
                          <div className="hint" style={{ marginTop: 0 }}>{f.why}</div>
                          {f.examples.map((ex) => (
                            <div key={ex.id} className="hint" style={{ marginTop: 2 }}>
                              <a
                                className="linklike"
                                href={`https://${store.domain}/admin/products/${ex.id}`}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {ex.title}
                              </a>
                              {ex.extra ? <span className="muted"> — {ex.extra}</span> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {res.aiFindings && res.aiFindings.length > 0 && (
                    <>
                      <div className="field-label">AI-steekproef — patronen</div>
                      {res.aiFindings.map((a, i) => (
                        <div key={i} className="log" style={{ display: "block" }}>
                          <div style={{ fontWeight: 600 }}>{a.title}</div>
                          <div className="hint" style={{ marginTop: 2 }}>
                            {a.why}
                            {a.affected ? ` (${a.affected} van de steekproef)` : ""}
                          </div>
                          {a.example && <div className="hint muted" style={{ marginTop: 0 }}>bv. {a.example}</div>}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
