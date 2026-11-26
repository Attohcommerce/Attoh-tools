"use client";

// Inloggen voor Pythago Extern: persoonlijke link (token) + eigen e-mailadres.
import { useState } from "react";

export default function PxLogin({ token }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/px/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, email }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Inloggen mislukt");
      try {
        localStorage.setItem("px_token", token);
      } catch {}
      window.location.href = "/px";
    } catch (err) {
      setError(String(err.message || err));
      setBusy(false);
    }
  }

  return (
    <div className="pyx-login">
      <form className="pyx-login__card" onSubmit={submit}>
        <div className="pyx-brand big"><span className="pyx-logo">π</span>Pythago</div>
        {token ? (
          <>
            <p>Log in met je e-mailadres.</p>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="naam@bedrijf.com" autoComplete="email" autoFocus />
            {error && <div className="pyd-err">{error}</div>}
            <button className="btn" disabled={busy || !email.trim()}>{busy ? "Bezig…" : "Inloggen"}</button>
          </>
        ) : (
          <p>Open je persoonlijke Pythago-link om in te loggen.</p>
        )}
      </form>
    </div>
  );
}
