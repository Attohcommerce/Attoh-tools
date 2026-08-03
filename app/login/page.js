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
          <span className="logo">A</span>
          Attoh Tools
        </h1>
        <div className="sub">Scrape · AI Generate · Upload</div>

        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jij@voorbeeld.com"
          autoComplete="username"
          autoFocus
          required
        />

        <label htmlFor="password">Wachtwoord</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />

        <div style={{ marginTop: 24 }}>
          <button className="btn" disabled={busy}>
            {busy ? (
              <>
                <span className="spin" aria-hidden="true" />
                Bezig…
              </>
            ) : (
              "Inloggen"
            )}
          </button>
        </div>

        {err && <div className="login-err">{err}</div>}

        <div className="login-foot">Sa Collective LLC — interne tools</div>
      </form>
    </div>
  );
}
