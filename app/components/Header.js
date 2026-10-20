"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isSoundOn, setSoundOn, sfx } from "./sfx";
import { ORG_LIST, orgOf } from "@/lib/org";
import { switchOrg, orgLS } from "@/lib/org-client";
import { useOrg } from "./OrgProvider";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/importer", label: "Importer" },
  { href: "/scraper", label: "Product Scraper" },
  { href: "/keywords", label: "Keywords" },
  { href: "/niches", label: "Niche kiezen" },
  { href: "/qa", label: "Store Doctor" },
  { href: "/size-guide", label: "Size Guide" },
  { href: "/gmc-checklist", label: "GMC Checklist" },
  { href: "/bills", label: "Bills" },
  { href: "/pythago", label: "Pythago" },
];

export default function Header({ icon, title, subtitle }) {
  const pathname = usePathname();
  const [sound, setSound] = useState(true);
  // Organisatie (20-10-2026): attoh (alles) of sacollective (beperkte set).
  // Komt via de root layout uit de cookie — klopt al bij de eerste render.
  const org = useOrg();
  const orgDef = orgOf(org);

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

  function pickOrg(id) {
    if (id === org) return;
    sfx("toggle");
    switchOrg(id);
  }

  // Alles wat op de pagina's is ingevuld in één keer wissen — alleen van de
  // organisatie waar je nu in zit. Shopify-koppelingen (sa_stores) en
  // geluidsvoorkeur blijven staan.
  function resetSession() {
    if (!window.confirm(`Reset session (${orgDef.name})? Alle ingevulde velden, lijsten en sessies worden gewist. Shopify-koppelingen blijven bewaard.`)) return;
    const KEYS = [
      // Scraper
      "sa_competitor_stores", "sa_scraper_keywords", "sa_sheet_work", "sa_sheet_memory",
      "sa_run_tab", "sa_new_tab", "sa_org_sheet", "sa_org_tab", "sa_last_active",
      // Importer
      "sa_url_queue", "sa_importlog_sheet", "sa_selected_store",
      // Keywords
      "attoh_kw_sheet", "attoh_kw_vsheet", "attoh_kw_sessions",
      // Niche kiezen
      "attoh_niche_sheet",
    ];
    try {
      for (const k of KEYS) orgLS.removeItem(k);
    } catch {}
    window.location.reload();
  }

  const nav = NAV.filter((l) => l.href === "/" || orgDef.tools.includes(l.href));

  return (
    <div className="topbar" data-org={org}>
      <span className="logo">{icon || "A"}</span>
      <span className="title">{title}</span>
      {subtitle ? <span className="subtitle">{subtitle}</span> : null}
      <div className="orgswitch" role="group" aria-label="Organisatie" title="Organisatie: eigen stores, eigen geheugen, eigen tools">
        {ORG_LIST.map((o) => (
          <button
            key={o.id}
            type="button"
            className={"orgbtn" + (o.id === org ? " on" : "")}
            onClick={() => pickOrg(o.id)}
            title={o.name}
          >
            <span className="orgletter">{o.letter}</span>
            <span className="orgname">{o.short}</span>
          </button>
        ))}
      </div>
      <span className="spacer" />
      <nav className="nav">
        {nav.map((l) => (
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
