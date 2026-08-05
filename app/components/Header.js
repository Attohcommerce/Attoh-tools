"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isSoundOn, setSoundOn, sfx } from "./sfx";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/importer", label: "Importer" },
  { href: "/scraper", label: "Product Scraper" },
  { href: "/keywords", label: "Keywords" },
  { href: "/gmc-checklist", label: "GMC Checklist" },
];

export default function Header({ icon, title, subtitle }) {
  const pathname = usePathname();
  const [sound, setSound] = useState(true);

  useEffect(() => {
    setSound(isSoundOn());
  }, []);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    setSoundOn(next);
    if (next) sfx("toggle");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Alles wat op de pagina's is ingevuld in één keer wissen.
  // Shopify-koppelingen (sa_stores) en geluidsvoorkeur blijven staan.
  function resetSession() {
    if (!window.confirm("Reset session? Alle ingevulde velden, lijsten en sessies worden gewist. Shopify-koppelingen blijven bewaard.")) return;
    const KEYS = [
      // Scraper
      "sa_competitor_stores", "sa_scraper_keywords", "sa_sheet_work", "sa_sheet_memory",
      "sa_run_tab", "sa_new_tab", "sa_org_sheet", "sa_org_tab", "sa_last_active",
      // Importer
      "sa_url_queue", "sa_importlog_sheet", "sa_selected_store",
      // Keywords
      "attoh_kw_sheet", "attoh_kw_vsheet", "attoh_kw_sessions",
    ];
    try {
      for (const k of KEYS) localStorage.removeItem(k);
    } catch {}
    window.location.reload();
  }

  return (
    <div className="topbar">
      <span className="logo">{icon || "A"}</span>
      <span className="title">{title}</span>
      {subtitle ? <span className="subtitle">{subtitle}</span> : null}
      <span className="spacer" />
      <nav className="nav">
        {NAV.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={"navlink" + (pathname === l.href ? " active" : "")}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <button
        className={"soundbtn" + (sound ? " on" : "")}
        onClick={toggleSound}
        title={sound ? "Geluid uit" : "Geluid aan"}
        aria-label={sound ? "Geluid uit" : "Geluid aan"}
      >
        {sound ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.5v5h3.6L12 18.6V5.4L7.6 9.5H4Z" />
            <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.7a7.4 7.4 0 0 1 0 10.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.5v5h3.6L12 18.6V5.4L7.6 9.5H4Z" />
            <path d="m16 9.5 5 5M21 9.5l-5 5" />
          </svg>
        )}
      </button>
      <button className="resetbtn" onClick={resetSession} title="Alles wissen wat is ingevuld">
        Reset session
      </button>
      <button className="logout" onClick={logout} title="Uitloggen">
        Uitloggen
      </button>
    </div>
  );
}
