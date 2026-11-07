"use client";
// 01 SCRAPER — concurrenten toevoegen en met één klik alles ophalen.
import { useEffect, useRef, useState } from "react";
import { sfx } from "../components/sfx";
import { postJSON, ago } from "./util";

const PLATFORM_LABEL = { shopify: "Shopify", woocommerce: "WooCommerce", generic: "Overig (sitemap)" };

export default function ScraperTab({ notify, comps, setComps, goImport }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [all, setAll] = useState(false);
  const [prog, setProg] = useState({}); // domain → {state, pos, total, count, error}
  const [log, setLog] = useState([]);
  const [redis, setRedis] = useState(true);
  const stopRef = useRef(false);

  const addLog = (t, cls = "") => setLog((l) => [...l.slice(-200), { t: new Date().toLocaleTimeString("nl-NL"), msg: t, cls }]);

  async function refresh() {
    const r = await fetch("/api/pokemon/competitors").then((x) => x.json()).catch(() => null);
    if (r) {
      setComps(r.comps || []);
      setRedis(r.redis !== false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function add() {
    if (!input.trim()) return;
    setAdding(true);
    try {
      const r = await postJSON("/api/pokemon/competitors", { action: "add", domains: input });
      setComps(r.comps || []);
      setInput("");
      sfx("ok");
      notify(`${(r.added || []).length} concurrent(en) toegevoegd`);
    } catch (e) {
      notify(e.message, true);
    } finally {
      setAdding(false);
    }
  }

  async function remove(d) {
    if (!window.confirm(`${d} weghalen? De gescrapete producten van deze winkel verdwijnen uit de importer.`)) return;
    const r = await postJSON("/api/pokemon/competitors", { action: "remove", domain: d });
    setComps(r.comps || []);
  }

  async function setPlatform(d, platform) {
    const r = await postJSON("/api/pokemon/competitors", { action: "platform", domain: d, platform });
    setComps(r.comps || []);
  }

  async function scrapeOne(d) {
    setProg((p) => ({ ...p, [d]: { state: "busy" } }));
    addLog(`▶ ${d} — scrapen…`);
    for (let round = 0; round < 200; round++) {
      if (stopRef.current) {
        setProg((p) => ({ ...p, [d]: { ...p[d], state: "paused" } }));
        addLog(`⏸ ${d} gepauzeerd`, "dim");
        return;
      }
      try {
        const r = await postJSON("/api/pokemon/scrape", { domain: d, all });
        if (r.comp) setComps((cs) => cs.map((c) => (c.domain === d ? r.comp : c)));
        setProg((p) => ({ ...p, [d]: { state: r.done ? "done" : "busy", pos: r.pos, total: r.total, count: r.count } }));
        if (r.total) addLog(`  ${d}: ${r.pos}/${r.total} pagina's gelezen · ${r.count} Pokémon-producten`, "dim");
        if (r.done) {
          addLog(`✓ ${d}: ${r.count} Pokémon-producten${r.seen ? ` (van ${r.seen} totaal)` : ""}${r.partial ? " — niet alles binnen, nog eens scrapen vult aan" : ""}${r.note ? ` — ${r.note}` : ""}`, r.count ? "ok" : "err");
          return r.count;
        }
      } catch (e) {
        setProg((p) => ({ ...p, [d]: { state: "error", error: e.message } }));
        addLog(`✕ ${d}: ${e.message}`, "err");
        return 0;
      }
    }
  }

  async function scrapeAll(list) {
    stopRef.current = false;
    setBusy(true);
    let total = 0;
    // 3 winkels tegelijk
    const queue = [...list];
    async function worker() {
      while (queue.length && !stopRef.current) {
        const d = queue.shift();
        total += (await scrapeOne(d)) || 0;
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    setBusy(false);
    sfx("success");
    notify(`Klaar — ${total} producten opgehaald`);
  }

  const totalProducts = comps.reduce((s, c) => s + (c.count || 0), 0);

  return (
    <>
      <div className="pk-hero">
        <div>
          <h1>Scraper</h1>
          <p>Zet de winkels van je concurrenten erin en haal met één klik al hun Pokémon-producten op: foto's, prijzen en teksten. Shopify en WooCommerce gaan in seconden, andere winkels via hun sitemap.</p>
        </div>
        <div className="pk-row">
          <button className="pk-btn dark big" disabled={busy || !comps.length} onClick={() => scrapeAll(comps.map((c) => c.domain))}>
            ⚡ Scrape alles ({comps.length})
          </button>
          {busy && (
            <button className="pk-btn big" onClick={() => (stopRef.current = true)}>
              Pauze
            </button>
          )}
        </div>
      </div>

      {!redis && (
        <div className="pk-card" style={{ borderColor: "var(--bad)", marginBottom: 14 }}>
          <b>Redis is niet ingesteld.</b> De Pokémon-tool bewaart de concurrenten en producten in dezelfde Redis-database als de rest van Attoh Tools (STORAGE2_REDIS_URL in Vercel).
        </div>
      )}

      <div className="pk-grid2">
        <div className="pk-sticky">
          <div className="pk-card">
            <h3>＋ Concurrenten toevoegen</h3>
            <textarea placeholder={"pokemonwinkel.nl\nhttps://www.kaartenshop.com\n…één per regel of met komma's"} value={input} onChange={(e) => setInput(e.target.value)} />
            <div className="pk-row" style={{ marginTop: 10, justifyContent: "space-between" }}>
              <span className="pk-hint">Platform wordt vanzelf herkend.</span>
              <button className="pk-btn primary" onClick={add} disabled={adding || !input.trim()}>
                {adding ? "Herkennen…" : "Toevoegen"}
              </button>
            </div>
          </div>
          <div className="pk-card">
            <h3>Instellingen</h3>
            <label className="pk-check">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              Alles meenemen, niet alleen Pokémon
            </label>
            <p className="pk-hint" style={{ marginTop: 6 }}>
              Standaard filtert de scraper op Pokémon (naam, set, Pikachu/Charizard …) en laat One Piece, Magic, Yu-Gi-Oh en Lorcana weg.
            </p>
          </div>
          <div className="pk-card">
            <div className="pk-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="pk-stat">
                <div className="k">Concurrenten</div>
                <div className="v">{comps.length}</div>
              </div>
              <div className="pk-stat">
                <div className="k">Producten</div>
                <div className="v">{totalProducts.toLocaleString("nl-NL")}</div>
              </div>
            </div>
            <button className="pk-btn yellow" style={{ width: "100%", marginTop: 12 }} onClick={goImport} disabled={!totalProducts}>
              Naar de importer →
            </button>
          </div>
        </div>

        <div>
          <div className="pk-card">
            {comps.length === 0 ? (
              <div className="pk-empty">
                <b>Nog geen concurrenten</b>
                Plak links de winkels uit je competitor research.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="pk-table">
                  <thead>
                    <tr>
                      <th>Winkel</th>
                      <th>Platform</th>
                      <th>Pokémon</th>
                      <th>Laatst</th>
                      <th style={{ width: 210 }}>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c) => {
                      const pr = prog[c.domain] || {};
                      const pct = pr.total ? Math.round((100 * (pr.pos || 0)) / pr.total) : pr.state === "done" ? 100 : pr.state === "busy" ? 35 : 0;
                      return (
                        <tr key={c.domain}>
                          <td className="pk-dom">
                            <a href={`https://${c.domain}`} target="_blank" rel="noreferrer">
                              {c.domain}
                            </a>
                          </td>
                          <td>
                            <select value={c.platform || "generic"} onChange={(e) => setPlatform(c.domain, e.target.value)} className={"pk-badge " + (c.platform || "generic")}>
                              {Object.entries(PLATFORM_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="pk-num">
                            <b>{c.count != null ? c.count : "—"}</b>
                            {c.seen ? <span className="pk-hint"> / {c.seen}</span> : null}
                          </td>
                          <td className="pk-hint">{ago(c.lastScraped)}</td>
                          <td>
                            {pr.state === "busy" || pr.state === "done" ? (
                              <div className="pk-col">
                                <div className="pk-bar">
                                  <i style={{ width: pct + "%" }} />
                                </div>
                                <span className="pk-hint">{pr.state === "done" ? `✓ ${pr.count} producten` : pr.total ? `${pr.pos}/${pr.total} pagina's` : "bezig…"}</span>
                              </div>
                            ) : pr.state === "error" ? (
                              <span className="pk-badge bad" title={pr.error}>
                                fout
                              </span>
                            ) : c.partial ? (
                              <span className="pk-badge warn">half — nog eens</span>
                            ) : c.lastScraped ? (
                              <span className="pk-badge good">klaar</span>
                            ) : (
                              <span className="pk-badge">nieuw</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                            <button className="pk-btn sm" disabled={busy || pr.state === "busy"} onClick={async () => { setBusy(true); stopRef.current = false; await scrapeOne(c.domain); setBusy(false); }}>
                              Scrape
                            </button>{" "}
                            <button className="pk-btn sm ghost" onClick={() => remove(c.domain)} title="Weghalen">
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {log.length > 0 && (
            <div className="pk-log" style={{ marginTop: 14 }}>
              {log.map((l, i) => (
                <div key={i} className={l.cls}>
                  <span className="dim">{l.t}</span> {l.msg}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
