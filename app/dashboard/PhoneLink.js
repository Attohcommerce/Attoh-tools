"use client";

// Telefoonlink voor het dashboard (⚙ in het dashboard): link maken voor een
// e-mailadres, kopiëren, vernieuwen of weghalen. De link opent /m/<token>;
// inloggen = die link + dat e-mailadres. Zie lib/dash-ext.js.
import { useEffect, useState } from "react";

const LS_MAIL = "attoh_dash_m_mail";

export default function PhoneLink() {
  const [links, setLinks] = useState(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function call(body) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/dashboard/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Mislukt");
      setLinks(d.links || []);
      return d;
    } catch (e) {
      setMsg(String(e.message || e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    try {
      setEmail(localStorage.getItem(LS_MAIL) || "");
    } catch {}
    call({ action: "list" });
  }, []);

  async function copy(link) {
    try {
      await navigator.clipboard.writeText(link);
      setMsg("Link gekopieerd");
    } catch {
      setMsg(link);
    }
  }

  return (
    <div className="dd-phone">
      <p className="muted small">Maak een link voor je eigen e-mailadres. Open de link op je telefoon, vul dat e-mailadres in en je ziet het dashboard. Geen wachtwoord en geen sleutels nodig. Alleen kijken.</p>
      <form
        className="dd-phone-new"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            localStorage.setItem(LS_MAIL, email.trim());
          } catch {}
          const d = await call({ action: "create", email });
          const mine = d && (d.links || []).find((l) => l.email === email.trim().toLowerCase());
          if (mine) copy(mine.link);
        }}
      >
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jouw@email.com" autoComplete="email" />
        <button className="btn" disabled={busy || !email.trim()}>Maak link + kopieer</button>
      </form>
      {msg && <div className="small" style={{ color: "var(--ok)" }}>{msg}</div>}
      {(links || []).map((l) => (
        <div key={l.id} className="dd-phone-row">
          <div className="dd-phone-info">
            <strong>{l.email}</strong>
            <span className="muted small">{l.lastSeen ? `laatst gebruikt ${new Date(l.lastSeen).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "nog niet gebruikt"}</span>
            <code>{l.link}</code>
          </div>
          <div className="dd-phone-acts">
            <button type="button" className="dd-chip on" onClick={() => copy(l.link)}>Kopieer</button>
            <button type="button" className="dd-chip" disabled={busy} onClick={() => confirm("Nieuwe link maken? De oude link werkt dan niet meer en je telefoon wordt uitgelogd.") && call({ action: "reset", id: l.id })}>Nieuwe link</button>
            <button type="button" className="dd-chip" disabled={busy} onClick={() => confirm(`Toegang van ${l.email} weghalen?`) && call({ action: "delete", id: l.id })}>Weg</button>
          </div>
        </div>
      ))}
    </div>
  );
}
