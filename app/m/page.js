"use client";

// DASHBOARD MOBIEL (26-11-2026) — /m: hetzelfde omzet-dashboard als in Attoh
// Tools, compact voor de telefoon. Stores en sleutels komen van de server.
// Niet ingelogd → inlogscherm (met de link die eerder op dit toestel is gebruikt).
import { useEffect, useState } from "react";
import DashboardPage from "../dashboard/page";
import MLogin from "./MLogin";
import "../dashboard/dashboard.css";

export default function MPage() {
  const [me, setMe] = useState(undefined); // undefined = laden, null = niet ingelogd
  const [token, setToken] = useState("");

  useEffect(() => {
    try {
      setToken(localStorage.getItem("dm_token") || "");
    } catch {}
    fetch("/api/m", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "me" }), cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d && d.user ? d : null))
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="ddm-loading"><div className="dd-skeleton" /></div>;
  if (!me) return <MLogin token={token} />;
  return <DashboardPage ext={me} />;
}
