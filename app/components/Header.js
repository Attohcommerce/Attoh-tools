"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/importer", label: "Importer" },
  { href: "/scraper", label: "Product Scraper" },
  { href: "/gmc-checklist", label: "GMC Checklist" },
];

export default function Header({ icon, title, subtitle }) {
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
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
      <button className="logout" onClick={logout} title="Uitloggen">
        Uitloggen
      </button>
    </div>
  );
}
