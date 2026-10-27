"use client";

import { useState } from "react";

export default function ReisLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/reis/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) window.location.href = "/reis";
      else setErr(data.error || "Inloggen lukt niet. Controleer je e-mail en wachtwoord.");
    } catch {
      setErr("Geen verbinding. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rp-login">
      <div className="rp-login-art">
        <div className="rp-brand">
          <Plane /> Attoh <small>Reisplanner</small>
        </div>
        <svg className="route" viewBox="0 0 400 300" fill="none" aria-hidden="true">
          <path d="M10 260 C 120 250, 140 80, 260 90 S 380 40, 390 20" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" strokeDasharray="6 8" />
          <circle cx="10" cy="260" r="7" fill="currentColor" fillOpacity=".5" />
          <circle cx="390" cy="20" r="9" fill="var(--sun)" />
        </svg>
        <div>
          <h1>Vlucht los. Hotel los. Samen goedkoper.</h1>
          <p style={{ marginTop: 16 }}>
            Duizenden combinaties van vluchten en hotels naast elkaar gelegd, zodat jullie de goedkoopste mooie reis vinden zonder uren te vergelijken.
          </p>
        </div>
      </div>
      <div className="rp-login-form">
        <form onSubmit={submit}>
          <h2>Inloggen</h2>
          <label className="rp-field">
            E-mail
            <input className="rp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
          </label>
          <label className="rp-field">
            Wachtwoord
            <input className="rp-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <button className="rp-go" disabled={busy}>{busy ? "Bezig met inloggen" : "Inloggen"}</button>
          {err && <div className="rp-err">{err}</div>}
        </form>
      </div>
    </div>
  );
}

function Plane() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 15.5v-1.9l-8-5V3.5a1.5 1.5 0 0 0-3 0v5.1l-8 5v1.9l8-2.5v5l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5l8 2.5Z" />
    </svg>
  );
}
