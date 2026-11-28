"use client";

// LIVE SALES-AARDBOL (28-11-2026) — Dashboard Mobiel. Draaiende wereldbol zoals
// in Shopify Live View: komt er een nieuwe sale binnen, dan draait de bol naar
// die plek, er schiet een boog vanaf Nederland naartoe en de plek pingt.
// Daaronder de laatste 10 sales (store, aantal producten, bedrag, NL-tijd).
// Data: /api/m action "recent" (lib/recent-sales.js), elke 30 sec.
import { useCallback, useEffect, useRef, useState } from "react";
import createGlobe from "cobe";

const POLL_MS = 30000;
const HOME = [52.64, 5.06]; // Hoorn — vanaf hier vliegt de boog naar de sale
const PING_MS = 2600;
const STEP_MS = 3800; // tijd per nieuwe sale in de rij
const HOLD_MS = 5000; // na de laatste ping even blijven staan, dan weer draaien

function hexRgb(hex) {
  const h = String(hex || "#3ecf8e").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
// cobe: hoek waarbij [lat, lng] recht voor je staat
function anglesOf(lat, lng) {
  return [Math.PI - ((lng * Math.PI) / 180 - Math.PI / 2), (lat * Math.PI) / 180];
}
const nlDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(d);
function nlTime(iso) {
  const d = new Date(iso);
  const t = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }).format(d);
  const today = nlDay(new Date());
  const day = nlDay(d);
  if (day === today) return t;
  const y = nlDay(new Date(Date.now() - 86400000));
  return (day === y ? "gisteren " : day.slice(8, 10) + "-" + day.slice(5, 7) + " ") + t;
}
function money(v, cur) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD", maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${cur} ${Number(v).toFixed(2)}`;
  }
}

export default function SalesGlobe({ domains, colors }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState(0);
  const [sales, setSales] = useState([]);
  const [fresh, setFresh] = useState({}); // id → true voor net binnengekomen sales
  const [toast, setToast] = useState(null);
  const [updated, setUpdated] = useState("");
  const [err, setErr] = useState("");

  // animatie-staat (refs, zodat de render-loop niet steeds opnieuw start)
  const anim = useRef({ phi: 0, theta: 0.3, target: null, holdUntil: 0, pings: [], arc: null, markers: [] });
  const seen = useRef(null); // Set met order-id's; null = eerste keer laden
  const queue = useRef([]);
  const busyUntil = useRef(0);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  const key = (domains || []).join(",");

  // canvasgrootte = breedte van de kaart (max 340 px)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => setSize(Math.min(340, Math.floor(el.clientWidth)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // wereldbol + render-loop
  useEffect(() => {
    if (!size || !canvasRef.current) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: dpr,
      width: size * dpr,
      height: size * dpr,
      phi: anim.current.phi,
      theta: anim.current.theta,
      dark: 1,
      diffuse: 1.25,
      mapSamples: 16000,
      mapBrightness: 5.5,
      mapBaseBrightness: 0.03,
      baseColor: [0.16, 0.18, 0.24],
      markerColor: [0.24, 0.81, 0.56],
      glowColor: [0.22, 0.32, 0.55],
      markers: [],
      arcs: [],
      arcColor: [0.24, 0.81, 0.56],
      arcWidth: 0.6,
      arcHeight: 0.35,
      markerElevation: 0.01,
    });
    let raf = 0;
    const frame = () => {
      const a = anim.current;
      const now = performance.now();
      if (a.target) {
        // kortste weg naar de nieuwe plek
        let d = a.target[0] - a.phi;
        d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        a.phi += d * 0.075;
        a.theta += (a.target[1] - a.theta) * 0.075;
        if (now > a.holdUntil && Math.abs(d) < 0.01) a.target = null;
      } else {
        a.phi += 0.0028;
        a.theta += (0.3 - a.theta) * 0.01;
      }
      a.pings = a.pings.filter((p) => now - p.t0 < PING_MS);
      const pingMarkers = a.pings.map((p) => {
        const t = (now - p.t0) / PING_MS;
        const pulse = Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t);
        return { location: p.loc, size: 0.035 + 0.11 * pulse, color: p.color };
      });
      const arcs = a.arc && now - a.arc.t0 < 4200 ? [{ from: HOME, to: a.arc.to, color: a.arc.color }] : [];
      globe.update({ phi: a.phi, theta: a.theta, markers: a.markers.concat(pingMarkers), arcs });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      globe.destroy();
    };
  }, [size]);

  const colorOf = useCallback((k) => hexRgb((colorsRef.current || {})[k]), []);

  // één sale afspelen: draaien → boog → ping
  const play = useCallback((s, quiet) => {
    if (!s.place) return;
    const a = anim.current;
    const loc = [s.place.lat, s.place.lng];
    const [phi, theta] = anglesOf(loc[0], loc[1]);
    a.target = [phi, Math.max(-0.9, Math.min(0.9, theta * 0.85))];
    a.holdUntil = performance.now() + HOLD_MS;
    if (quiet) return;
    const color = colorOf(s.key);
    setTimeout(() => {
      a.arc = { to: loc, color, t0: performance.now() };
      setTimeout(() => a.pings.push({ loc, color, t0: performance.now() }), 900);
    }, 700);
    setToast(s);
    setTimeout(() => setToast((t) => (t && t.id === s.id ? null : t)), STEP_MS);
    try {
      navigator.vibrate && navigator.vibrate(25);
    } catch {}
  }, [colorOf]);

  // wachtrij: nieuwe sales één voor één
  useEffect(() => {
    const t = setInterval(() => {
      if (!queue.current.length || Date.now() < busyUntil.current) return;
      const s = queue.current.shift();
      busyUntil.current = Date.now() + STEP_MS;
      play(s, false);
    }, 400);
    return () => clearInterval(t);
  }, [play]);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const r = await fetch("/api/m", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recent", domains: key.split(",") }),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const list = j.sales || [];
      setSales(list);
      setErr(j.errors && j.errors.length ? `Geen data: ${j.errors.map((e) => e.key).join(", ")}` : "");
      setUpdated(new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }).format(new Date()));
      // vaste stippen voor de laatste sales
      anim.current.markers = list
        .filter((s) => s.place)
        .map((s) => ({ location: [s.place.lat, s.place.lng], size: 0.028, color: colorOf(s.key) }));
      if (seen.current === null) {
        // eerste keer: niets afspelen, wel naar de laatste sale draaien
        seen.current = new Set(list.map((s) => s.id));
        if (list[0]) play(list[0], true);
        return;
      }
      const nieuw = list.filter((s) => !seen.current.has(s.id)).reverse(); // oudste eerst
      for (const s of nieuw) seen.current.add(s.id);
      if (nieuw.length) {
        queue.current.push(...nieuw);
        setFresh((f) => {
          const n = { ...f };
          for (const s of nieuw) n[s.id] = true;
          return n;
        });
      }
    } catch (e) {
      setErr(String(e.message || e));
    }
  }, [key, play, colorOf]);

  useEffect(() => {
    seen.current = null;
    load();
    const t = setInterval(load, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const last10 = sales.slice(0, 10);

  return (
    <section className="dd-card ddm-live">
      <div className="ddm-live-head">
        <span className="dd-live"><span className="dd-livedot" />LIVE SALES</span>
        <span className="muted small">{updated ? `bijgewerkt ${updated}` : "laden…"}</span>
      </div>

      <div className="ddm-globe" ref={wrapRef}>
        {size > 0 && <canvas ref={canvasRef} style={{ width: size, height: size }} />}
        {toast && (
          <div className="ddm-toast" key={toast.id}>
            <i style={{ background: (colors || {})[toast.key] || "#3ecf8e" }} />
            <b>{toast.key || toast.store}</b>
            <span>{money(toast.amount, toast.currency)}</span>
            {toast.city ? <span className="muted">· {toast.city}</span> : null}
          </div>
        )}
      </div>

      <div className="ddm-feed">
        <div className="ddm-feed-head">Laatste 10 sales</div>
        {last10.length === 0 && <div className="muted small ddm-feed-empty">Nog geen sales in de laatste 48 uur.</div>}
        {last10.map((s) => (
          <button
            key={s.id}
            className={"ddm-sale" + (fresh[s.id] ? " is-new" : "")}
            onClick={() => {
              busyUntil.current = Date.now() + STEP_MS;
              play(s, false);
            }}
          >
            <span className="ddm-sale-time">{nlTime(s.at)}</span>
            <span className="ddm-sale-store"><i style={{ background: (colors || {})[s.key] || "#888" }} />{s.key || s.store}</span>
            <span className="ddm-sale-items">{s.items} {s.items === 1 ? "product" : "producten"}</span>
            <span className="ddm-sale-amount">{money(s.amount, s.currency)}</span>
          </button>
        ))}
        {err && <div className="muted small ddm-feed-err">{err}</div>}
      </div>
    </section>
  );
}
