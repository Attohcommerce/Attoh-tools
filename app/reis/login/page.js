"use client";

import { useState } from "react";
import { rsfx } from "../ReisSound";
import FlapBoard from "../FlapBoard";

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
      if (res.ok) {
        rsfx("hello");
        setTimeout(() => (window.location.href = "/reis"), 450);
      } else {
        rsfx("error");
        setErr(data.error || "Inloggen lukt niet. Controleer je e-mail en wachtwoord.");
      }
    } catch {
      setErr("Geen verbinding. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rp-login">
      <div className="rp-login-art">
        <div className="rp-login-top">
          <div className="rp-brand"><Plane /> Attoh <small>Ultra Reisplanner</small></div>
          <span className="rp-for">voor Justin &amp; Quinty</span>
        </div>

        <FlapBoard rows={4} />

        <div className="rp-login-copy">
          <h1>Meer zon.<br />Minder euro's.</h1>
          <p>Elke vlucht, elk hotel en elke vertrekdag tegen elkaar weggestreept, tot alleen de goedkoopste mooie reis overblijft.</p>
        </div>
      </div>

      <div className="rp-login-form">
        <form onSubmit={submit}>
          <h2>Inchecken</h2>
          <p className="rp-lede" style={{ margin: "-6px 0 6px" }}>Log in om jullie volgende reis te vinden.</p>
          <label className="rp-field">
            E-mail
            <input className="rp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
          </label>
          <label className="rp-field">
            Wachtwoord
            <input className="rp-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <button className="rp-go" disabled={busy} data-sfx="own">{busy ? "Bezig met inloggen" : "Inloggen"}</button>
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
