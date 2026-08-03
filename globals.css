"use client";

import { useState } from "react";
import Header from "../components/Header";

export default function GmcChecklistPage() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState(null);
  const [err, setErr] = useState("");

  async function start() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setErr("");
    setChecks(null);
    try {
      const res = await fetch("/api/gmc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      setChecks(data.checks || []);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const passCount = (checks || []).filter((c) => c.status === "pass").length;

  return (
    <>
      <Header
        icon="C"
        title="GMC Checklist"
        subtitle="Automatische Merchant Center audit"
        links={[
          { href: "/scraper", label: "Product Scraper" },
          { href: "/", label: "← Terug naar Importer" },
        ]}
      />
      <div className="page">
        <div className="layout-scraper">
          <div>
            <div className="card">
              <h2>Winkel</h2>
              <input
                type="text"
                placeholder="jouwstore.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && start()}
              />
              <div className="hint">Alleen de publieke site wordt gecrawld — geen Shopify-koppeling nodig</div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={start} disabled={busy || !url.trim()}>
                {busy ? "Bezig met crawlen…" : "⌕ Checklist starten"}
              </button>
            </div>
          </div>

          <div>
            <div className="card" style={{ minHeight: 300 }}>
              {!checks && !busy && !err && (
                <div className="center-note">Vul links een winkel-URL in en klik op Checklist starten</div>
              )}
              {busy && <div className="center-note">Site wordt gecrawld — dit duurt even…</div>}
              {err && (
                <div className="log">
                  <span className="err">✗ {err}</span>
                </div>
              )}
              {checks && (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <strong>
                      {passCount}/{checks.length} checks geslaagd
                    </strong>
                  </div>
                  {checks.map((c, i) => (
                    <div className="check-item" key={i}>
                      <span className="check-icon">
                        {c.status === "pass" ? (
                          <span className="ok">✓</span>
                        ) : c.status === "warn" ? (
                          <span className="warn">⚠</span>
                        ) : (
                          <span className="err">✗</span>
                        )}
                      </span>
                      <span style={{ flex: 1 }}>
                        <strong>{c.name}</strong>
                        {c.detail ? <div className="muted small">{c.detail}</div> : null}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
