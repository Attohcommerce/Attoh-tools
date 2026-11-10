"use client";
// Store kiezen (zelfde koppelingen als de Importer) + nieuwe store koppelen.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { saveStores } from "./util";

export default function StorePicker({ stores, setStores, picked, setPicked, status }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const [f, setF] = useState({ name: "", domain: "", mode: "client", token: "", clientId: "", clientSecret: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    setErr("");
    const domain = f.domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    if (!/\.myshopify\.com$/.test(domain)) {
      setErr("Gebruik het .myshopify.com-adres (Shopify → Instellingen → Domeinen).");
      return;
    }
    const c = f.mode === "client" ? { clientId: f.clientId.trim(), clientSecret: f.clientSecret.trim() } : { token: f.token.trim() };
    setBusy(true);
    try {
      const res = await fetch("/api/shopify-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, ...c }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Koppelen mislukt");
      const store = { name: f.name.trim() || d.shop.name, domain, ...c, currency: d.shop.currency };
      const next = [...stores.filter((s) => s.domain !== domain), store];
      setStores(next);
      saveStores(next);
      setPicked(domain);
      setOpen(false);
      setF({ name: "", domain: "", mode: "client", token: "", clientId: "", clientSecret: "" });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="pk-store" title={status || ""}>
        <span className={"dot" + (picked ? " on" : "")} />
        <select value={picked} onChange={(e) => (e.target.value === "__add" ? setOpen(true) : setPicked(e.target.value))}>
          <option value="">Kies je Pokémon-store…</option>
          {stores.map((s) => (
            <option key={s.domain} value={s.domain}>
              {s.name || s.domain}
            </option>
          ))}
          <option value="__add">＋ Nieuwe store koppelen</option>
        </select>
      </div>
      {open && mounted && createPortal(
        <div className="pk pk-modal-bg pk-modal-bg--portal" onClick={() => setOpen(false)}>
          <div className="pk-modal narrow" onClick={(e) => e.stopPropagation()}>
            <div className="pk-modal-head">
              <h3>Store koppelen</h3>
              <button className="pk-btn ghost sm" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="pk-modal-body">
              <div className="pk-field">
                <div className="pk-label">Naam</div>
                <input type="text" placeholder="bijv. Pokémon store" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </div>
              <div className="pk-field">
                <div className="pk-label">Shopify-adres</div>
                <input type="text" placeholder="jouwstore.myshopify.com" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} />
              </div>
              <div className="pk-field pk-row">
                <button className={"pk-chip" + (f.mode === "client" ? " on" : "")} onClick={() => setF({ ...f, mode: "client" })}>
                  Client ID + secret
                </button>
                <button className={"pk-chip" + (f.mode === "token" ? " on" : "")} onClick={() => setF({ ...f, mode: "token" })}>
                  Admin token (shpat_)
                </button>
              </div>
              {f.mode === "client" ? (
                <>
                  <div className="pk-field">
                    <div className="pk-label">Client ID</div>
                    <input type="text" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} />
                  </div>
                  <div className="pk-field">
                    <div className="pk-label">Client secret</div>
                    <input type="password" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} />
                  </div>
                </>
              ) : (
                <div className="pk-field">
                  <div className="pk-label">Admin API token</div>
                  <input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
                </div>
              )}
              <p className="pk-hint" style={{ marginTop: 10 }}>
                Scopes die de app nodig heeft: read/write_products, read/write_inventory, read_locations, read/write_files.
              </p>
              {err && <p style={{ color: "var(--bad)", marginTop: 10, fontSize: 13 }}>{err}</p>}
              <div className="pk-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                <button className="pk-btn primary" onClick={add} disabled={busy}>
                  {busy ? "Testen…" : "Koppelen"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
