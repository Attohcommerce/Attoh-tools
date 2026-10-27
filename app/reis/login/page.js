"use client";

import { useEffect, useState } from "react";
import { rsfx } from "../ReisSound";

// Vertrekbord: rijen klapperen (split-flap) door bestemmingen heen.
const ROWS = [
  ["PHUKET", "13N", "1.167"],
  ["DUBAI", "8N", "1.284"],
  ["CURACAO", "13N", "1.690"],
  ["BODRUM", "10N", "943"],
  ["BALI", "16N", "1.512"],
  ["MALDIVEN", "9N", "2.150"],
  ["HURGHADA", "13N", "1.021"],
  ["SANTORINI", "7N", "1.098"],
  ["MAURITIUS", "14N", "1.940"],
  ["KRETA", "11N", "896"],
  ["CANCUN", "13N", "1.733"],
  ["ZANZIBAR", "12N", "1.455"],
];
const W = { city: 10, nights: 3, price: 6 };
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.";
const pad = (s, n, right) => (right ? String(s).padStart(n, " ") : String(s).padEnd(n, " ")).slice(0, n);
const rowText = (r) => pad(r[0], W.city) + pad(r[1], W.nights, true) + "€" + pad(r[2], W.price, true);

function useFlapBoard(count) {
  const [idx, setIdx] = useState(() => Array.from({ length: count }, (_, i) => i));
  const [shown, setShown] = useState(() => Array.from({ length: count }, (_, i) => rowText(ROWS[i])));
  useEffect(() => {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let row = 0;
    let timers = [];
    const flipRow = (r, nextIdx) => {
      const target = rowText(ROWS[nextIdx]);
      if (reduce) {
        setShown((s) => s.map((x, i) => (i === r ? target : x)));
        return;
      }
      const start = performance.now();
      const tick = setInterval(() => {
        const t = performance.now() - start;
        setShown((s) =>
          s.map((x, i) => {
            if (i !== r) return x;
            return target
              .split("")
              .map((ch, k) => {
                const doneAt = 120 + k * 38;
                if (t >= doneAt) return ch;
                if (ch === " " && x[k] === " ") return " ";
                return CHARS[Math.floor(Math.random() * CHARS.length)];
              })
              .join("");
          })
        );
        if (t > 120 + target.length * 38 + 40) clearInterval(tick);
      }, 55);
      timers.push(tick);
    };
    const loop = setInterval(() => {
      setIdx((cur) => {
        const used = new Set(cur);
        let n = (Math.max(...cur) + 1) % ROWS.length;
        while (used.has(n)) n = (n + 1) % ROWS.length;
        const next = cur.map((v, i) => (i === row ? n : v));
        flipRow(row, n);
        row = (row + 1) % count;
        return next;
      });
    }, 2400);
    return () => { clearInterval(loop); timers.forEach(clearInterval); };
  }, [count]);
  return { idx, shown };
}

export default function ReisLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { shown } = useFlapBoard(4);

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

        <div className="rp-board" aria-hidden="true">
          <div className="rp-board-head">
            <span>Bestemming</span><span>Nachten</span><span>Samen</span>
          </div>
          {shown.map((txt, r) => (
            <div className="rp-board-row" key={r}>
              {txt.split("").map((ch, k) => (
                <span key={k} className={"rp-flap" + (k === W.city + W.nights ? " eur" : "") + (k === W.city || k === W.city + W.nights ? " gap" : "")}>
                  {ch === " " ? " " : ch}
                </span>
              ))}
            </div>
          ))}
        </div>

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
