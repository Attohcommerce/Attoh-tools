"use client";

// CLAUDE-KOPPELING (13-11-2026) — één connector voor Claude naar ALLE stores.
// 1. "Stores klaarzetten" stuurt je Shopify-koppelingen (sa_stores) naar de server.
// 2. Kopieer de link en voeg hem in claude.ai toe als eigen connector.
import { useEffect, useState } from "react";
import Header from "../components/Header";
import { orgLS } from "@/lib/org-client";

function loadStores() {
  try {
    return JSON.parse(orgLS.getItem("sa_stores") || "[]") || [];
  } catch {
    return [];
  }
}

export default function ClaudeLinkPage() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  async function call(action, extra = {}) {
    setBusy(action);
    setMsg("");
    try {
      const r = await fetch("/api/claude-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (action === "save") setMsg(`${j.saved} stores klaargezet voor Claude.`);
      if (action === "rotate") setMsg("Nieuwe sleutel gemaakt — de oude link werkt niet meer. Zet de nieuwe link in claude.ai.");
      const s = action === "status" || action === "rotate" ? j : await (await fetch("/api/claude-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) })).json();
      setInfo(s);
    } catch (e) {
      setMsg(`Mislukt: ${String(e.message || e)}`);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    call("status");
  }, []);

  const local = typeof window !== "undefined" ? loadStores() : [];

  return (
    <main>
      <Header title="Claude-koppeling" subtitle="Eén koppeling voor Claude naar al je stores" />
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 16px", display: "grid", gap: 16 }}>
        <section className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Stap 1 · Stores klaarzetten</h3>
          <p>Stuurt de {local.length} Shopify-koppelingen uit deze browser naar de server, zodat Claude erbij kan. Doe dit opnieuw als je een store toevoegt.</p>
          <button className="btn" disabled={!!busy} onClick={() => call("save", { stores: loadStores() })}>
            {busy === "save" ? "Bezig…" : "Stores klaarzetten"}
          </button>
          {info && info.stores && (
            <p style={{ marginBottom: 0, opacity: 0.8 }}>
              Nu klaar voor Claude: {info.stores.length ? info.stores.map((s) => s.name || s.domain).join(" · ") : "nog geen stores"}
            </p>
          )}
        </section>
        <section className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Stap 2 · Link in claude.ai zetten</h3>
          <p>claude.ai → Instellingen → Connectors → Custom connector toevoegen → naam "Attoh Stores" → plak deze link.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={info && info.url ? info.url : "…"} style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }} onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              disabled={!info || !info.url}
              onClick={() => {
                navigator.clipboard.writeText(info.url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Gekopieerd" : "Kopieer"}
            </button>
          </div>
          <p style={{ fontSize: 12, opacity: 0.7 }}>Deze link is je sleutel: deel hem met niemand. Uitgelekt? Maak een nieuwe.</p>
          <button className="btn" disabled={!!busy} onClick={() => window.confirm("Nieuwe sleutel maken? De oude link stopt dan met werken.") && call("rotate")}>
            Nieuwe sleutel
          </button>
        </section>
        {msg && <p>{msg}</p>}
      </div>
    </main>
  );
}
