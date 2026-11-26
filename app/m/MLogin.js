"use client";

// Inloggen voor Dashboard Mobiel: telefoonlink (token) + e-mailadres.
import { useState } from "react";

export default function MLogin({ token }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/m/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, email }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Inloggen mislukt");
      try {
        localStorage.setItem("dm_token", token);
      } catch {}
      window.location.href = "/m";
    } catch (err) {
      setError(String(err.message || err));
      setBusy(false);
    }
  }

  return (
    <div className="ddm-login">
      <form className="ddm-login-card" onSubmit={submit}>
        <span className="ddm-logo big">£</span>
        <h1>Attoh Dashboard</h1>
        {token ? (
          <>
            <p>Log in met je e-mailadres.</p>
            <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jouw@email.com" autoComplete="email" autoCapitalize="none" autoFocus />
            {error && <div className="dd-error">{error}</div>}
            <button className="btn" disabled={busy || !email.trim()}>{busy ? "Bezig…" : "Inloggen"}</button>
          </>
        ) : (
          <p>Open je dashboard-link om in te loggen.</p>
        )}
      </form>
    </div>
  );
}
