"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Header from "./components/Header";

const MODULES = [
  {
    href: "/importer",
    name: "Importer",
    tagline: "Scrape · AI · Upload",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v11" />
        <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    ),
  },
  {
    href: "/scraper",
    name: "Product Scraper",
    tagline: "Competitor → Sheet",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m20 20-4.6-4.6" />
      </svg>
    ),
  },
  {
    href: "/keywords",
    name: "Keywords",
    tagline: "Planner → sheet",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16M4 12h10M4 19h13" />
        <circle cx="18.5" cy="12" r="2.2" />
      </svg>
    ),
  },
  {
    href: "/gmc-checklist",
    name: "GMC Checklist",
    tagline: "Merchant audit",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.8 4.5 6v6c0 4.4 3.2 7.9 7.5 9.2 4.3-1.3 7.5-4.8 7.5-9.2V6Z" />
        <path d="m8.8 11.8 2.3 2.3 4.1-4.4" />
      </svg>
    ),
  },
];

export default function HomePage() {
  const [me, setMe] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [now, setNow] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [hov, setHov] = useState(null);
  const lastFetch = useRef(0);

  const REFRESH_MS = 10 * 60 * 1000;
  const MIN_GAP_MS = 90 * 1000;

  // Opstartgeluid — één keer per sessie
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("attoh_booted")) {
        sessionStorage.setItem("attoh_booted", "1");
        window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "boot" }));
      }
    } catch {}
  }, []);

  // Klok
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

  // Weer + nieuws: bij openen, elke 10 min, bij terugkeren op tabblad en bij reconnect
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

  const dateLine = useMemo(() => {
    if (!now) return "";
    return now.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }, [now]);

  const timeLine = now
    ? now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : "--:--:--";

  const syncLabel = useMemo(() => {
    if (syncing) return "Syncing";
    if (!lastSync || !now) return "";
    const m = Math.floor((now - lastSync) / 60000);
    return m < 1 ? "Synced just now" : `Synced ${m}m ago`;
  }, [syncing, lastSync, now]);

  const name = me && me.name ? me.name : "";
  const loc = ctx && ctx.location;
  const w = ctx && ctx.weather;
  const news = ((ctx && ctx.news) || []).slice(0, 5);

  return (
    <>
      <Header icon="A" title="Attoh Tools" subtitle="Command deck" />

      <div className="page deck">
        {/* ---------- Kop ---------- */}
        <section className="deck-head">
          <div className="deck-date">
            {dateLine}
            {loc && loc.city ? `  ·  ${loc.city}` : ""}
          </div>
          <h1 className="deck-greet">
            {greeting}
            {name ? `, ${name}` : ""}
          </h1>
        </section>

        {/* ---------- Orbit ---------- */}
        <section className="orbit">
          <div className="o-core" aria-hidden="true">
            <svg viewBox="0 0 320 320">
              <defs>
                <radialGradient id="og" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#e6c04d" stopOpacity="0.5" />
                  <stop offset="55%" stopColor="#c9a227" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#c9a227" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="160" cy="160" r="70" fill="url(#og)" />
              <circle className="o-r1" cx="160" cy="160" r="152" />
              <circle className="o-r2" cx="160" cy="160" r="118" />
              <circle className="o-r3" cx="160" cy="160" r="84" />
              <circle className="o-dot" cx="160" cy="160" r="5" />
            </svg>
            <div className={"o-read" + (hov !== null ? " on" : "")}>
              {hov !== null ? MODULES[hov].name : "Attoh"}
            </div>
          </div>

          {MODULES.map((m, i) => (
            <Link
              key={m.href}
              href={m.href}
              className={`onode pos-${i}`}
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
              onFocus={() => setHov(i)}
              onBlur={() => setHov(null)}
            >
              <span className="on-icon">{m.icon}</span>
              <span className="on-name">{m.name}</span>
              <span className="on-tag">{m.tagline}</span>
            </Link>
          ))}
        </section>

        {/* ---------- Statuslijn ---------- */}
        <section className="statline">
          <div className="stat">
            <span className="stat-k">Weather</span>
            <span className="stat-v">
              {w ? `${w.temp}°  ·  ${w.label}` : ctx ? "—" : "…"}
            </span>
            <span className="stat-s">
              {w && w.high !== null ? `H ${w.high}°  L ${w.low}°` : " "}
            </span>
          </div>
          <div className="stat">
            <span className="stat-k">Local time</span>
            <span className="stat-v mono">{timeLine}</span>
            <span className="stat-s">{(loc && loc.timezone) || " "}</span>
          </div>
          <div className="stat">
            <span className="stat-k">Operator</span>
            <span className="stat-v">{name || "—"}</span>
            <span className="stat-s">{(me && me.company) || " "}</span>
          </div>
        </section>

        {/* ---------- Briefing ---------- */}
        <section className="brief">
          <div className="brief-head">
            <span className="brief-title">
              Briefing{loc && loc.country ? ` — ${loc.country}` : ""}
            </span>
            {syncLabel ? (
              <button
                type="button"
                className={"brief-sync" + (syncing ? " on" : "")}
                onClick={() => loadContext(true)}
                title="Nu verversen"
              >
                {syncLabel}
              </button>
            ) : null}
          </div>
          {news.length === 0 ? (
            <div className="brief-empty">{ctx ? "Geen nieuws beschikbaar" : "Laden…"}</div>
          ) : (
            news.map((n, i) => (
              <a
                key={i}
                className="news"
                href={n.link}
                target="_blank"
                rel="noreferrer noopener"
                style={{ animationDelay: `${i * 55}ms` }}
              >
                <span className="news-idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="news-title">{n.title}</span>
                {n.source ? <span className="news-src">{n.source}</span> : null}
              </a>
            ))
          )}
        </section>
      </div>
    </>
  );
}
