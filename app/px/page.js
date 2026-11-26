"use client";

// PYTHAGO EXTERN (26-11-2026) — /px: dezelfde Pythago als in Attoh Tools, maar
// voor externe mensen (bijv. Cas). Alleen de gedeelde store(s), koppeling op
// de server, geen Attoh-navigatie. Niet ingelogd → inlogscherm (met de link
// die eerder op dit apparaat is gebruikt).
import { useEffect, useState } from "react";
import PythagoPage from "../pythago/page";
import PxLogin from "./PxLogin";

export default function PxPage() {
  const [me, setMe] = useState(undefined); // undefined = laden, null = niet ingelogd
  const [token, setToken] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("pyx-light");
    try {
      setToken(localStorage.getItem("px_token") || "");
    } catch {}
    fetch("/api/px", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "me" }) })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d && d.user ? d : null))
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="pyx-loading"><span className="pyd-spinner" /> Laden…</div>;
  if (!me) return <PxLogin token={token} />;
  return <PythagoPage ext={me} />;
}
