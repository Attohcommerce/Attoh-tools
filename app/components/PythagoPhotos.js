"use client";

/* AI-FOTO'S OP PYTHAGO-CIJFERS (Store Doctor, 25-11-2026)
   De Store Doctor leest vanaf nu de opgeslagen Pythago-data van de store (zelfde data als /pythago,
   geen extra sync nodig) en zet met één klik infographics (of modelfoto's) klaar voor de producten
   die daar spend of sales hebben, of onder break-even draaien.
   Zelfde wachtrij als de importer en Pythago → Acties: /api/photo-queue. */
import { useEffect, useMemo, useState } from "react";

const GROUPS = [
  { id: "any", label: "Alles met spend of sales", hint: "Elk actief product dat in de gekozen periode spend of minstens één order had." },
  { id: "under", label: "Onder break-even", hint: "Pythago-advies \"Onder break-even\" of \"Draften\": spend boven de drempel, maar te weinig of geen verkoop." },
  { id: "sales", label: "Met sales", hint: "Elk actief product met minstens één order in de gekozen periode." },
  { id: "nosale", label: "Spend zonder sales", hint: "Spend in de gekozen periode, nog geen order." },
];
const inGroup = (r, w, g) => {
  const p = (r.per && r.per[w]) || {};
  const spend = Number(p.spend) || 0;
  const orders = Number(p.orders) || 0;
  if (g === "under") return r.advies === "Onder break-even" || r.advies === "Draften";
  if (g === "sales") return orders > 0;
  if (g === "nosale") return spend > 0 && orders === 0;
  return spend > 0 || orders > 0;
};

export default function PythagoPhotos({ store }) {
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [win, setWin] = useState(30);
  const [group, setGroup] = useState("any");
  const [kind, setKind] = useState("infographic");
  const [engine, setEngine] = useState("claude");
  const [openai, setOpenai] = useState(false);
  const [skipped, setSkipped] = useState([]);

  const domain = store ? store.domain : "";

  useEffect(() => {
    let off = false;
    setData(null);
    setLoaded(false);
    setErr("");
    setMsg("");
    setSkipped([]);
    if (!domain) return;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch("/api/pythago", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "load", domain }) }).then((r) => r.json()),
          fetch("/api/photo-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (off) return;
        if (a.error) throw new Error(a.error);
        setData(a.data || null);
        setStale(!!a.stale);
        setOpenai(!!b.openai);
      } catch (e) {
        if (!off) setErr(String(e.message || e));
      } finally {
        if (!off) setLoaded(true);
      }
    })();
    return () => {
      off = true;
    };
  }, [domain]);

  const active = useMemo(() => ((data && data.rows) || []).filter((r) => r.productId && r.status === "active"), [data]);
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, active.filter((r) => inGroup(r, win, g.id)).length])), [active, win]);
  const picked = useMemo(
    () => active.filter((r) => inGroup(r, win, group)).sort((a, b) => ((b.per[win] && b.per[win].spend) || 0) - ((a.per[win] && a.per[win].spend) || 0)),
    [active, win, group]
  );
  const word = kind === "infographic" ? "infographics" : "modelfoto's";

  async function run() {
    setBusy(true);
    setErr("");
    setMsg("");
    setSkipped([]);
    try {
      const ids = picked.map((r) => r.productId);
      const total = { added: 0, skipped: [] };
      let batch = "";
      for (let i = 0; i < ids.length; i += 250) {
        if (ids.length > 250) setMsg(`Bezig: ${Math.min(i + 250, ids.length)} van ${ids.length} producten…`);
        const res = await fetch("/api/photo-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // modelfoto's op Pythago-cijfers: AI kiest (mooie sets overslaan), 1 foto per kleur — zelfde standaard als Pythago → Acties
          body: JSON.stringify({ action: "enqueue", store, productIds: ids.slice(i, i + 250), mode: "ai", per: 1, engine, kind: kind === "infographic" ? "infographic" : "model", batch }),
        });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(d.error || "Klaarzetten mislukt");
        batch = batch || d.batch || "";
        total.added += d.added || 0;
        total.skipped.push(...(d.skipped || []));
      }
      setSkipped(total.skipped);
      setMsg(`${total.added} opdracht(en) klaargezet${total.skipped.length ? ` · ${total.skipped.length} overgeslagen` : ""}. ${engine === "openai" ? "De tool is begonnen en gaat vanzelf door." : "Claude pakt ze op zodra hij de wachtrij draait."}`);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (!store) return null;
  const synced = data && data.syncedAt ? new Date(data.syncedAt).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="sd-card cf">
      <div className="cf-head">
        <div className="sd-card__title" style={{ marginBottom: 0 }}>
          AI-foto's op Pythago-cijfers <span className="sd-muted">infographics voor producten met spend, sales of onder break-even · 1 klik</span>
        </div>
        {synced && <span className="sd-muted" style={{ fontSize: 12 }}>Pythago-sync: {synced}{stale ? " · verouderd" : ""}</span>}
      </div>

      {err && <div className="sd-alert" style={{ marginTop: 10 }}>{err}</div>}
      {msg && <div className="sd-ok" style={{ marginTop: 10 }}>{msg}</div>}
      {!loaded && <div className="sd-muted cf-empty">Pythago-data laden…</div>}
      {loaded && !data && !err && (
        <div className="sd-muted cf-empty">
          Nog geen Pythago-data voor deze store. Open <a href="/pythago">Pythago</a>, kies deze store en klik op Sync; daarna staan de cijfers hier vanzelf.
        </div>
      )}

      {data && (
        <>
          <div className="cf-tiles">
            {GROUPS.map((g) => (
              <button
                key={g.id} type="button" title={g.hint} onClick={() => setGroup(g.id)}
                className={"cf-tile" + (group === g.id ? " cf-tile--ok" : "")}
                style={{ cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit" }}
              >
                <b>{counts[g.id]}</b><span>{g.label}</span>
              </button>
            ))}
          </div>

          <div className="cf-action" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="sd-muted">Periode</span>
            {[7, 14, 30].map((w) => (
              <button key={w} type="button" className={"sd-btn sd-btn--small" + (win === w ? " sd-btn--gold" : "")} onClick={() => setWin(w)}>{w} dagen</button>
            ))}
            <span className="sd-muted" style={{ marginLeft: 10 }}>Soort</span>
            <button type="button" className={"sd-btn sd-btn--small" + (kind === "infographic" ? " sd-btn--gold" : "")} onClick={() => setKind("infographic")}>Infographic</button>
            <button type="button" className={"sd-btn sd-btn--small" + (kind === "model" ? " sd-btn--gold" : "")} onClick={() => setKind("model")}>Modelfoto</button>
            <span className="sd-muted" style={{ marginLeft: 10 }}>Motor</span>
            <button type="button" className={"sd-btn sd-btn--small" + (engine === "claude" ? " sd-btn--gold" : "")} onClick={() => setEngine("claude")}>Higgsfield via Claude</button>
            <button type="button" className={"sd-btn sd-btn--small" + (engine === "openai" ? " sd-btn--gold" : "")} disabled={!openai} title={openai ? "De tool maakt ze zelf" : "Zet eerst OPENAI_API_KEY in Vercel"} onClick={() => openai && setEngine("openai")}>OpenAI API</button>
          </div>

          <div className="sd-muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
            {(GROUPS.find((g) => g.id === group) || {}).hint}{" "}
            {kind === "infographic"
              ? "Eén infographic per product (4:5, stijl en tekst per productsoort). Komt achter de eerste foto('s). Producten die er al een hebben worden overgeslagen."
              : "Modelfoto: AI kiest (mooie sets overslaan), 1 foto per kleur. Schoenen, tassen en accessoires krijgen geen modelfoto."}
          </div>

          {picked.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="sd-muted" style={{ cursor: "pointer" }}>Bekijk de {picked.length} producten</summary>
              <div className="sd-list" style={{ marginTop: 6, maxHeight: 260, overflow: "auto" }}>
                {picked.slice(0, 300).map((r) => {
                  const p = r.per[win] || {};
                  return (
                    <div key={r.productId} className="sd-list__row" style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                      <span className="sd-muted" style={{ whiteSpace: "nowrap" }}>
                        spend {Number(p.spend || 0).toFixed(2)} · {p.orders || 0} order(s){p.roas != null ? ` · ROAS ${p.roas}` : ""} · {r.advies}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          <div className="cf-action">
            <span className="sd-muted" style={{ flex: 1 }}>
              <b>{picked.length}</b> producten · hoogstens ±{picked.length} {word}{engine === "claude" ? ` · ±${picked.length} credits` : ""}
            </span>
            <button className="sd-btn sd-btn--gold" onClick={run} disabled={busy || !picked.length}>
              {busy ? "Klaarzetten…" : `✦ Maak ${word} (${picked.length})`}
            </button>
          </div>

          {skipped.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary className="sd-muted" style={{ cursor: "pointer" }}>{skipped.length} overgeslagen</summary>
              <div className="sd-list" style={{ marginTop: 6, maxHeight: 200, overflow: "auto" }}>
                {skipped.slice(0, 200).map((x, i) => (
                  <div key={i} className="sd-list__row"><span className="sd-muted">{(x.title || x.productId || "").slice(0, 70)} — {x.why}</span></div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
