"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Header from "./components/Header";

/* ---------------- Iconen ---------------- */

function WeatherIcon({ kind }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (kind) {
    case "sun":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" {...s}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
        </svg>
      );
    case "cloud-sun":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" {...s}>
          <circle cx="8" cy="7.5" r="3" />
          <path d="M8 1.8v1.4M2.3 7.5h1.4M4 3.5l1 1M12 3.5l-1 1" />
          <path d="M8.5 19h9a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.8-1A3.7 3.7 0 0 0 8.5 19Z" />
        </svg>
      );
    case "rain":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" {...s}>
          <path d="M7.5 15h9a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2-1A3.9 3.9 0 0 0 7.5 15Z" />
          <path d="M9 18.4l-.8 2.2M13 18.4l-.8 2.2M17 18.4l-.8 2.2" />
        </svg>
      );
    case "snow":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" {...s}>
          <path d="M7.5 14h9a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2-1A3.9 3.9 0 0 0 7.5 14Z" />
          <path d="M9 18h.01M13 20h.01M17 18h.01M11 21h.01M15 17h.01" />
        </svg>
      );
    case "storm":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" {...s}>
          <path d="M7.5 14h9a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2-1A3.9 3.9 0 0 0 7.5 14Z" />
          <path d="M13 16l-2.5 4h3.4L11.6 23" />
        </svg>
      );
    case "fog":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" {...s}>
          <path d="M7.5 12h9a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2-1A3.9 3.9 0 0 0 7.5 12Z" />
          <path d="M4 16h16M6 19.5h12" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" {...s}>
          <path d="M7.5 17h9a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6-1A4 4 0 0 0 7.5 17Z" />
        </svg>
      );
  }
}

const MODULES = [
  {
    href: "/importer",
    code: "01",
    name: "Importer",
    tagline: "Scrape · AI Generate · Upload",
    body: "Haalt een product van een bron-URL, laat de AI een GMC-proof titel en beschrijving schrijven en zet het klaar in je Shopify-store.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v11" />
        <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    ),
  },
  {
    href: "/scraper",
    code: "02",
    name: "Product Scraper",
    tagline: "Competitor → Google Sheet",
    body: "Zoekt op keyword door je concurrent-stores, van best sellers naar beneden, en schrijft alles netjes weg in een sheet.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m20 20-4.6-4.6" />
        <path d="M8 10.5h5M10.5 8v5" />
      </svg>
    ),
  },
  {
    href: "/gmc-checklist",
    code: "03",
    name: "GMC Checklist",
    tagline: "Merchant Center audit",
    body: "Crawlt een winkel en controleert alles waar Google op afkeurt: policies, contactgegevens, betaalmethodes en productdata.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.8 4.5 6v6c0 4.4 3.2 7.9 7.5 9.2 4.3-1.3 7.5-4.8 7.5-9.2V6Z" />
        <path d="m8.8 11.8 2.3 2.3 4.1-4.4" />
      </svg>
    ),
  },
];

/* ---------------- Pagina ---------------- */

export default function HomePage() {
  const [me, setMe] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [now, setNow] = useState(null);
  const [typed, setTyped] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const timer = useRef(null);
  const lastFetch = useRef(0);

  const REFRESH_MS = 10 * 60 * 1000; // elke 10 minuten verversen
  const MIN_GAP_MS = 90 * 1000; // niet vaker dan dit bij terugkeren op het tabblad

  // Live klok — start pas client-side zodat server en client niet botsen
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);

  // Weer + nieuws: bij openen, daarna elke 10 minuten, en zodra je
  // terugkomt op het tabblad of je verbinding herstelt.
  const loadContext = useCallback(async (force = false) => {
    const since = Date.now() - lastFetch.current;
    if (!force && since < MIN_GAP_MS) return;
    lastFetch.current = Date.now();
    setSyncing(true);
    try {
      const res = await fetch("/api/context", { cache: "no-store" });
      if (res.ok) {
        setCtx(await res.json());
        setLastSync(new Date());
      }
    } catch {
      /* stil falen — de vorige gegevens blijven staan */
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    loadContext(true);
    const id = setInterval(() => loadContext(true), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") loadContext(false);
    };
    const onOnline = () => loadContext(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [loadContext]);

  const greeting = useMemo(() => {
    const h = now ? now.getHours() : null;
    if (h === null) return "";
    if (h < 6) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, [now]);

  const fullLine = useMemo(() => {
    if (!greeting) return "";
    const name = me && me.name ? me.name : "";
    return name ? `${greeting}, ${name}` : greeting;
  }, [greeting, me]);

  // Typemachine-effect
  useEffect(() => {
    if (!fullLine) return;
    clearInterval(timer.current);
    let i = 0;
    setTyped("");
    timer.current = setInterval(() => {
      i += 1;
      setTyped(fullLine.slice(0, i));
      if (i >= fullLine.length) clearInterval(timer.current);
    }, 38);
    return () => clearInterval(timer.current);
  }, [fullLine]);

  const dateLine = useMemo(() => {
    if (!now) return "";
    const s = now.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [now]);
  const timeLine = now
    ? now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "--:--:--";

  // "Synced 3m ago" — herberekent mee met de klok
  const syncLabel = useMemo(() => {
    if (syncing) return "Syncing…";
    if (!lastSync || !now) return "";
    const mins = Math.floor((now - lastSync) / 60000);
    if (mins < 1) return "Synced just now";
    return `Synced ${mins}m ago`;
  }, [syncing, lastSync, now]);

  const loc = ctx && ctx.location;
  const w = ctx && ctx.weather;
  const news = (ctx && ctx.news) || [];

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Command deck" />

      <div className="page home">
        {/* ---------- HUD strip ---------- */}
        <div className="hud">
          <span className="hud-dot" />
          <span className="hud-label">System online</span>
          <span className="hud-sep" />
          <span className="hud-label">
            {loc ? `${loc.city}${loc.country ? " · " + loc.country : ""}` : "Locating…"}
          </span>
          <span className="hud-sep" />
          <span className="hud-label">All modules ready</span>
          <span className="hud-grow" />
          {syncLabel ? (
            <button
              type="button"
              className={"hud-sync" + (syncing ? " on" : "")}
              onClick={() => loadContext(true)}
              title="Nu verversen"
            >
              <span className="hud-sync-dot" />
              {syncLabel}
            </button>
          ) : null}
          <span className="hud-clock">{timeLine}</span>
        </div>

        {/* ---------- Hero ---------- */}
        <section className="hero">
          <div className="hero-rings" aria-hidden="true">
            <svg viewBox="0 0 200 200" width="176" height="176">
              <circle className="ring ring-1" cx="100" cy="100" r="86" />
              <circle className="ring ring-2" cx="100" cy="100" r="66" />
              <circle className="ring ring-3" cx="100" cy="100" r="46" />
              <circle className="core" cx="100" cy="100" r="15" />
              <circle className="core-dot" cx="100" cy="100" r="5" />
            </svg>
          </div>

          <div className="hero-text">
            <h1 className="greet">
              {typed}
              <span className="caret" />
            </h1>
            <div className="greet-sub">
              {dateLine}
              {loc && loc.city ? ` · ${loc.city}` : ""}
            </div>
          </div>
        </section>

        {/* ---------- Tiles ---------- */}
        <section className="tiles">
          <div className="tile">
            <div className="tile-head">Weather</div>
            {w ? (
              <>
                <div className="tile-main">
                  <span className="tile-icon">
                    <WeatherIcon kind={w.icon} />
                  </span>
                  <span className="tile-big">{w.temp}°</span>
                </div>
                <div className="tile-sub">
                  {w.label} · feels {w.feels}°
                </div>
                <div className="tile-foot">
                  {w.high !== null ? `H ${w.high}° · L ${w.low}° · ` : ""}wind {w.wind} km/h
                </div>
              </>
            ) : (
              <div className="tile-loading">{ctx ? "Niet beschikbaar" : "Ophalen…"}</div>
            )}
          </div>

          <div className="tile">
            <div className="tile-head">Local time</div>
            <div className="tile-main">
              <span className="tile-big mono">{timeLine}</span>
            </div>
            <div className="tile-sub">{dateLine || "—"}</div>
            <div className="tile-foot">
              {loc && loc.timezone ? loc.timezone : "Tijdzone onbekend"}
            </div>
          </div>

          <div className="tile">
            <div className="tile-head">Operator</div>
            <div className="tile-main">
              <span className="tile-big">{me && me.name ? me.name : "—"}</span>
            </div>
            <div className="tile-sub">{me ? me.email : "Sessie laden…"}</div>
            <div className="tile-foot">Sa Collective LLC</div>
          </div>
        </section>

        {/* ---------- Modules ---------- */}
        <section>
          <div className="section-title">
            <span>Select a module</span>
            <span className="rule" />
          </div>
          <div className="modules">
            {MODULES.map((m) => (
              <Link key={m.href} href={m.href} className="mod">
                <span className="mod-code">{m.code}</span>
                <span className="mod-icon">{m.icon}</span>
                <span className="mod-name">{m.name}</span>
                <span className="mod-tag">{m.tagline}</span>
                <span className="mod-body">{m.body}</span>
                <span className="mod-go">
                  Openen
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
                  </svg>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ---------- Briefing ---------- */}
        <section>
          <div className="section-title">
            <span>Briefing{loc && loc.country ? ` — ${loc.country}` : ""}</span>
            <span className="rule" />
          </div>
          <div className="card">
            {news.length === 0 ? (
              <div className="center-note">
                {ctx ? "Geen nieuws opgehaald" : "Nieuws ophalen…"}
              </div>
            ) : (
              news.map((n, i) => (
                <a
                  key={i}
                  className="news"
                  href={n.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span className="news-idx">{String(i + 1).padStart(2, "0")}</span>
                  <span className="news-title">{n.title}</span>
                  {n.source ? <span className="news-src">{n.source}</span> : null}
                </a>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
