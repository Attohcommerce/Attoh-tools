"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || "Inloggen mislukt");
      }
    } catch {
      setErr("Er ging iets mis — probeer opnieuw");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>
          <span className="logo" style={{ width: 26, height: 26, borderRadius: 8, background: "#111", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⌂</span>
          Shopify Product Importer
        </h1>
        <div className="sub">Inloggen vereist</div>
        <label>E-mail</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jij@voorbeeld.com"
          autoFocus
          required
        />
        <label>Wachtwoord</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />
        <div style={{ marginTop: 18 }}>
          <button className="btn" disabled={busy}>
            {busy ? "Bezig…" : "Inloggen"}
          </button>
        </div>
        {err && <div className="login-err">{err}</div>}
      </form>
    </div>
  );
}
