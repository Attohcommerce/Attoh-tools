"use client";

// Persoonlijke link voor Pythago Extern: /px/<token> → e-mailadres invullen → /px
// (al ingelogd op dit apparaat → direct door naar /px)
import { useEffect } from "react";
import PxLogin from "../PxLogin";

export default function PxTokenPage({ params }) {
  const token = String((params && params.token) || "");
  useEffect(() => {
    fetch("/api/px", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "me" }) })
      .then((r) => {
        if (r.ok) {
          try {
            localStorage.setItem("px_token", token);
          } catch {}
          window.location.replace("/px");
        }
      })
      .catch(() => {});
  }, [token]);
  return <PxLogin token={token} />;
}
