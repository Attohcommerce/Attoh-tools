"use client";

import Link from "next/link";

export default function Header({ icon, title, subtitle, links }) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <div className="topbar">
      <span className="logo">{icon}</span>
      <span className="title">{title}</span>
      <span className="subtitle">{subtitle}</span>
      <span className="spacer" />
      {links.map((l) => (
        <Link key={l.href} className="navlink" href={l.href}>
          {l.label}
        </Link>
      ))}
      <button className="logout" onClick={logout} title="Uitloggen">
        Uitloggen
      </button>
    </div>
  );
}
