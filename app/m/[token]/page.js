"use client";

// Telefoonlink: /m/<token> → e-mailadres invullen → /m
// (al ingelogd op dit toestel → direct door naar /m)
import { useEffect } from "react";
import MLogin from "../MLogin";
import "../../dashboard/dashboard.css";

export default function MTokenPage({ params }) {
  const token = String((params && params.token) || "");
  useEffect(() => {
    fetch("/api/m", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "me" }) })
      .then((r) => {
        if (r.ok) {
          try {
            localStorage.setItem("dm_token", token);
          } catch {}
          window.location.replace("/m");
        }
      })
      .catch(() => {});
  }, [token]);
  return <MLogin token={token} />;
}
