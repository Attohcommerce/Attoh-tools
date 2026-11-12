"use client";

/* FITNOTES (Store Doctor, 03-11-2026)
   "Model is 5'9" (175 cm) and wears size S" — alleen bij producten waar een
   model het product draagt. Scan → AI-voorstel (lengte + maat uit de eigen
   maten van het product) → aanpassen → Opslaan. Opslag: metafields
   custom.model_height_cm + custom.model_size (ook met één tik in de
   Shopify-admin aan te passen). De Liquid-snippet hieronder zet hem op de
   productpagina. */
import { useEffect, useMemo, useState } from "react";

const CHUNK = 8;

export const FIT_NOTE_LIQUID = `{%- comment -%} Fitnote — Attoh Tools / Store Doctor. Leest custom.model_height_cm + custom.model_size. Stijl: zelfde als de icoon-regels (verzending/retour) {%- endcomment -%}
<style>.sg-fit[data-fit="snug"] .sg-fit-dot{left:40%}.sg-fit[data-fit="snug"] .sg-fit-labels span:nth-child(2){color:var(--sg-ink);font-weight:600}</style>
{%- assign fn_h = product.metafields.custom.model_height_cm.value -%}
{%- assign fn_s = product.metafields.custom.model_size.value -%}
{%- if fn_h != blank and fn_s != blank -%}
  {%- assign fn_in = fn_h | times: 1.0 | divided_by: 2.54 | round -%}
  {%- assign fn_ft = fn_in | divided_by: 12 -%}
  {%- assign fn_rest = fn_in | modulo: 12 -%}
  <div class="fit-note">
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M6 20V9M10 20v-6M14 20V9M18 20v-6"/><path d="M4 4h16"/></svg>
    <span>Model is {% if localization.country.iso_code == 'US' %}{{ fn_ft }}'{{ fn_rest }}" ({{ fn_h }} cm){% else %}{{ fn_h }} cm ({{ fn_ft }}'{{ fn_rest }}"){% endif %} and wears size {{ fn_s }}</span>
  </div>
  <style>
    .fit-note{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-size:13px;line-height:1.45;letter-spacing:.01em;color:inherit}
    .fit-note span{opacity:.75}
    .fit-note svg{flex:0 0 auto;width:15px;height:15px;opacity:.85}
  </style>
{%- endif -%}`;

function inchLabel(cm) {
  const n = Number(cm);
  if (!n) return "";
  const inch = Math.round(n / 2.54);
  return `${Math.floor(inch / 12)}'${inch % 12}"`;
}

export default function FitNotes({ store, scanKey }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [prog, setProg] = useState(null); // {done, total, usd}
  const [sugg, setSugg] = useState({}); // id → {model, height, size, sizes, why, build, on}
  const [showExisting, setShowExisting] = useState(false);
  const [edit, setEdit] = useState({}); // bestaande fitnotes aanpassen: id → {height, size}
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [sc, setSc] = useState(null); // maattabellen: {total, shoes, done, todo[]}

  const body = store
    ? { domain: store.domain, publicDomain: store.publicDomain, currency: store.currency, name: store.name, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret }
    : null;

  async function call(payload) {
    const r = await fetch("/api/fit-note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const txt = await r.text();
    let d;
    try {
      d = JSON.parse(txt);
    } catch {
      throw new Error(`server gaf geen JSON (${r.status}) — waarschijnlijk tijdslimiet, probeer opnieuw`);
    }
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }

  async function scan() {
    if (!body) return;
    setBusy("scan");
    setErr("");
    setMsg("");
    try {
      setData(await call({ action: "scan", store: body }));
      try {
        setSc(await call({ action: "sizecharts-scan", store: body }));
      } catch {}
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (scanKey && store) scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanKey, store && store.domain]);
  useEffect(() => {
    setData(null);
    setSc(null);
    setSugg({});
    setEdit({});
  }, [store && store.domain]);

  const rows = data ? data.rows : [];
  const missing = useMemo(() => rows.filter((r) => !(r.height && r.size)), [rows]);
  const existing = useMemo(() => rows.filter((r) => r.height && r.size), [rows]);
  const todo = missing.filter((r) => !sugg[r.id]);

  async function analyze() {
    const ids = todo.map((r) => r.id);
    if (!ids.length) return;
    setBusy("ai");
    setErr("");
    setMsg("");
    let usd = 0;
    setProg({ done: 0, total: ids.length, usd: 0 });
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        let d;
        for (let t = 0; t < 3; t++) {
          try {
            d = await call({ action: "analyze", store: body, ids: part });
            break;
          } catch (e) {
            if (t === 2) throw e;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        usd += d.aiUsd || 0;
        setSugg((s) => {
          const n = { ...s };
          for (const r of d.rows) n[r.id] = { ...r, on: r.model };
          // producten die de server oversloeg (bv. schoen) → geen model
          for (const id of part) if (!n[id]) n[id] = { id, model: false, why: "overgeslagen", on: false };
          return n;
        });
        setProg({ done: Math.min(ids.length, i + CHUNK), total: ids.length, usd });
      }
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  function setS(id, patch) {
    setSugg((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  }

  const chosen = missing.filter((r) => sugg[r.id] && sugg[r.id].on && sugg[r.id].height && sugg[r.id].size);

  async function save(list, label) {
    if (!list.length) return;
    setBusy("save");
    setErr("");
    setMsg("");
    try {
      let saved = 0;
      let cleared = 0;
      for (let i = 0; i < list.length; i += 40) {
        const d = await call({ action: "write", store: body, rows: list.slice(i, i + 40) });
        saved += d.saved || 0;
        cleared += d.cleared || 0;
        if (d.errors && d.errors.length) throw new Error(d.errors.join(" · "));
      }
      setMsg(`✓ ${label}: ${saved} opgeslagen${cleared ? ` · ${cleared} gewist` : ""}`);
      // lokaal bijwerken zonder nieuwe scan
      setData((dd) => {
        if (!dd) return dd;
        const by = new Map(list.map((x) => [String(x.id), x]));
        const rows2 = dd.rows.map((r) => {
          const x = by.get(String(r.id));
          if (!x) return r;
          const ok = Number(x.height) >= 120 && String(x.size || "").trim();
          return { ...r, height: ok ? Number(x.height) : null, size: ok ? String(x.size).trim() : "" };
        });
        return { ...dd, rows: rows2, withNote: rows2.filter((r) => r.height && r.size).length };
      });
      setEdit({});
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  async function sizeChartsSmall() {
    if (!sc || !sc.todo.length) return;
    setBusy("sc");
    setErr("");
    setMsg("");
    try {
      let n = 0;
      for (let i = 0; i < sc.todo.length; i += 100) {
        const d = await call({ action: "sizecharts-apply", store: body, ids: sc.todo.slice(i, i + 100) });
        if (d.errors && d.errors.length) throw new Error(d.errors.join(" · "));
        n += d.updated || 0;
      }
      setMsg(`✓ ${n} maattabellen staan nu op "Runs snug — choose one size up for your desired fit."`);
      setSc(await call({ action: "sizecharts-scan", store: body }));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  /* 09-11 (EMC): heren-model één maat groter. Eerst tellen (verandert niets),
     dan na een vinkje doorzetten. Alleen fitnotes die nog precies op de oude
     regel staan; handmatig aangepaste blijven zoals ze zijn. */
  async function resizeMen() {
    if (!body) return;
    setBusy("resize");
    setErr("");
    setMsg("");
    try {
      const d = await call({ action: "resize", store: body, dryRun: true });
      if (!d.todo) {
        setMsg(`✓ Heren-fitnotes: niets te doen (${d.men} heren-fitnotes, ${d.untouched} met een eigen maat blijven staan)`);
        return;
      }
      const ex = (d.rows || []).slice(0, 4).map((r) => `• ${String(r.title).split("|")[0].trim()}: ${r.from} → ${r.size}`).join("\n");
      const ok = window.confirm(`${d.todo} heren-fitnotes gaan één maat omhoog (model draagt een maatje groter):\n${ex}${d.todo > 4 ? "\n…" : ""}\n\n${d.untouched} fitnotes met een eigen maat blijven staan. Doorzetten?`);
      if (!ok) return;
      const w = await call({ action: "resize", store: body, dryRun: false });
      if (w.errors && w.errors.length) throw new Error(w.errors.join(" · "));
      setMsg(`✓ ${w.saved} heren-fitnotes staan nu één maat groter`);
      setData(await call({ action: "scan", store: body }));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  /* 12-11 Justin (LGB): "Lijkt me onrealistisch dat zij een XL draagt" — de AI
     kijkt opnieuw naar de foto van elk product MET fitnote (postuur + lengte).
     Wijkt de maat of lengte (meer dan 4 cm) af, dan eerst een lijstje tonen en
     pas na een vinkje opslaan. Producten zonder zichtbaar model blijven staan. */
  async function recheckExisting() {
    const list = existing.slice();
    if (!list.length || !body) return;
    setBusy("recheck");
    setErr("");
    setMsg("");
    let usd = 0;
    const changes = [];
    setProg({ done: 0, total: list.length, usd: 0 });
    try {
      for (let i = 0; i < list.length; i += CHUNK) {
        const part = list.slice(i, i + CHUNK);
        let d;
        for (let t = 0; t < 3; t++) {
          try {
            d = await call({ action: "analyze", store: body, ids: part.map((r) => r.id) });
            break;
          } catch (e) {
            if (t === 2) throw e;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        usd += d.aiUsd || 0;
        const by = new Map((d.rows || []).map((r) => [String(r.id), r]));
        for (const cur of part) {
          const a = by.get(String(cur.id));
          if (!a || !a.model || !a.size || !a.height) continue;
          const sizeDiff = String(a.size).trim().toUpperCase() !== String(cur.size).trim().toUpperCase();
          const hDiff = Math.abs(Number(a.height) - Number(cur.height)) > 4;
          if (sizeDiff || hDiff) changes.push({ id: cur.id, title: cur.title, fromSize: cur.size, fromHeight: cur.height, size: a.size, height: a.height, build: a.build });
        }
        setProg({ done: Math.min(list.length, i + CHUNK), total: list.length, usd });
      }
      if (!changes.length) {
        setMsg(`✓ Bestaande fitnotes: alles klopt met de foto's (${list.length} gecontroleerd · $${usd.toFixed(3)})`);
        return;
      }
      const ex = changes.slice(0, 6).map((r) => `• ${String(r.title).split("|")[0].trim()}: ${r.fromSize} → ${r.size} (${r.build}, ${r.fromHeight} → ${r.height} cm)`).join("\n");
      const ok = window.confirm(`${changes.length} van ${list.length} fitnotes kloppen niet met het model op de foto:\n${ex}${changes.length > 6 ? "\n…" : ""}\n\nAanpassen naar wat de foto laat zien?`);
      if (!ok) {
        setMsg(`${changes.length} fitnotes wijken af — niets aangepast`);
        return;
      }
      setBusy("");
      await save(changes.map((r) => ({ id: r.id, height: r.height, size: r.size })), "Fitnotes gecorrigeerd");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  async function copyLiquid() {
    try {
      await navigator.clipboard.writeText(FIT_NOTE_LIQUID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  if (!store) return null;
  const analyzed = missing.filter((r) => sugg[r.id]);
  const noModel = analyzed.filter((r) => !sugg[r.id].model).length;

  return (
    <div className="sd-card cf fn">
      <div className="cf-head">
        <div className="sd-card__title" style={{ marginBottom: 0 }}>
          Fitnotes <span className="sd-muted">“Model is 5'9" (175 cm) and wears size S” · alleen als een model het product draagt</span>
        </div>
        <div className="fn-headbtns">
          <button className="sd-btn sd-btn--small" onClick={copyLiquid}>{copied ? "✓ gekopieerd" : "Liquid-snippet kopiëren"}</button>
          <button className="sd-btn sd-btn--small" onClick={scan} disabled={!!busy}>
            {busy === "scan" ? "Scannen…" : data ? "Opnieuw scannen" : "Fitnotes scannen"}
          </button>
          <button className="sd-btn sd-btn--small" onClick={resizeMen} disabled={!!busy} title="Bestaande heren-fitnotes van de oude regel één maat groter (eerst tellen, dan bevestigen)">
            {busy === "resize" ? "Bezig…" : "Heren-model +1 maat"}
          </button>
        </div>
      </div>

      {err && <div className="sd-alert" style={{ marginTop: 10 }}>{err}</div>}
      {msg && <div className="sd-ok" style={{ marginTop: 10 }}>{msg}</div>}
      {!data && busy !== "scan" && <div className="sd-muted cf-empty">Scan de store (of klik op Fitnotes scannen) om te zien welke kledingstukken nog geen fitnote hebben.</div>}

      {data && (
        <>
          <div className="cf-tiles">
            <div className="cf-tile cf-tile--err"><b>{missing.length}</b><span>zonder fitnote</span></div>
            <div className="cf-tile cf-tile--ok"><b>{existing.length}</b><span>met fitnote</span></div>
            <div className="cf-tile"><b>{data.apparel}</b><span>kledingstukken</span></div>
            <div className="cf-tile"><b>{data.skipped}</b><span>overgeslagen (schoenen, tassen, accessoires)</span></div>
          </div>

          {sc && (
            <div className="cf-action" style={{ borderTop: 0, paddingTop: 0, marginTop: 4 }}>
              <span className="sd-muted" style={{ flex: 1 }}>
                Maattabellen: <b>{sc.done}</b> van {sc.total - sc.shoes} op “Runs snug — choose one size up for your desired fit” · {sc.shoes} schoenen blijven true to size
              </span>
              <button className="sd-btn sd-btn--small" onClick={sizeChartsSmall} disabled={!!busy || !sc.todo.length}>
                {busy === "sc" ? "Bezig…" : sc.todo.length ? `Maattabellen: fits snug · ${sc.todo.length}` : "✓ alle maattabellen"}
              </button>
            </div>
          )}

          <div className="cf-action" style={{ borderTop: 0, paddingTop: 0 }}>
            <button className="sd-btn sd-btn--gold" onClick={analyze} disabled={!!busy || !todo.length}>
              {busy === "ai" && prog ? `AI kijkt naar de foto's… ${prog.done}/${prog.total}` : `Fitnotes voorstellen (AI) · ${todo.length} producten`}
            </button>
            {prog && (
              <span className="sd-muted">
                {prog.done}/{prog.total} beoordeeld · ${prog.usd.toFixed(3)}
                {analyzed.length ? ` · ${analyzed.length - noModel} met model · ${noModel} zonder model` : ""}
              </span>
            )}
            <button className="sd-btn sd-btn--small" onClick={recheckExisting} disabled={!!busy || !existing.length} title="AI kijkt opnieuw naar de foto: past de maat bij het postuur van het model? (eerst een lijstje, dan bevestigen)">
              {busy === "recheck" && prog ? `Controleren… ${prog.done}/${prog.total}` : `Bestaande fitnotes controleren (AI) · ${existing.length}`}
            </button>
            <label className="cf-toggle">
              <input type="checkbox" checked={showExisting} onChange={(e) => setShowExisting(e.target.checked)} /> bestaande fitnotes tonen / aanpassen
            </label>
          </div>

          {analyzed.length > 0 && (
            <>
              <div className="fn-list">
                {analyzed.map((r) => {
                  const s = sugg[r.id];
                  const sizes = s.sizes && s.sizes.length ? s.sizes : r.sizes;
                  return (
                    <div key={r.id} className={`fn-row${s.on ? " is-on" : ""}${s.model ? "" : " is-off"}`}>
                      <input type="checkbox" checked={!!s.on} disabled={!s.model && !s.height} onChange={(e) => setS(r.id, { on: e.target.checked })} />
                      {r.img ? <img src={r.img} alt="" className="fn-img" /> : <span className="fn-img" />}
                      <span className="fn-title" title={r.title}>
                        {r.title}
                        {!s.model && <em className="cf-dup">{s.why || "geen model"}</em>}
                        {s.model && s.build && s.build !== "standard" && <em className="cf-dup">{s.build}</em>}
                      </span>
                      {s.model ? (
                        <>
                          <span className="fn-h">
                            <input type="number" min={140} max={210} value={s.height || ""} onChange={(e) => setS(r.id, { height: Number(e.target.value) })} />
                            <span className="sd-muted">cm · {inchLabel(s.height)}</span>
                          </span>
                          {sizes && sizes.length ? (
                            <select value={s.size || ""} onChange={(e) => setS(r.id, { size: e.target.value })}>
                              {sizes.map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          ) : (
                            <input className="fn-size" value={s.size || ""} placeholder="maat" onChange={(e) => setS(r.id, { size: e.target.value })} />
                          )}
                        </>
                      ) : (
                        <span className="sd-muted fn-skip">geen fitnote</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="cf-action">
                <span className="sd-muted" style={{ flex: 1 }}>
                  Voorbeeld: {chosen[0] ? `Model is ${inchLabel(sugg[chosen[0].id].height)} (${sugg[chosen[0].id].height} cm) and wears size ${sugg[chosen[0].id].size}` : "—"}
                </span>
                <button
                  className="sd-btn sd-btn--gold"
                  disabled={!!busy || !chosen.length}
                  onClick={() => save(chosen.map((r) => ({ id: r.id, height: sugg[r.id].height, size: sugg[r.id].size })), "Fitnotes")}
                >
                  {busy === "save" ? "Opslaan…" : `Opslaan · ${chosen.length} fitnotes`}
                </button>
              </div>
            </>
          )}

          {showExisting && (
            <>
              <div className="fn-list">
                {existing.length === 0 && <div className="sd-muted cf-empty">Nog geen fitnotes in deze store.</div>}
                {existing.map((r) => {
                  const e = edit[r.id] || { height: r.height, size: r.size };
                  const changed = !!edit[r.id];
                  return (
                    <div key={r.id} className={`fn-row is-on${changed ? " is-changed" : ""}`}>
                      <span />
                      {r.img ? <img src={r.img} alt="" className="fn-img" /> : <span className="fn-img" />}
                      <span className="fn-title" title={r.title}>{r.title}</span>
                      <span className="fn-h">
                        <input type="number" min={140} max={210} value={e.height || ""} onChange={(x) => setEdit((m) => ({ ...m, [r.id]: { ...e, height: Number(x.target.value) } }))} />
                        <span className="sd-muted">cm · {inchLabel(e.height)}</span>
                      </span>
                      {r.sizes && r.sizes.length ? (
                        <select value={e.size || ""} onChange={(x) => setEdit((m) => ({ ...m, [r.id]: { ...e, size: x.target.value } }))}>
                          <option value="">— wissen —</option>
                          {r.sizes.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="fn-size" value={e.size || ""} onChange={(x) => setEdit((m) => ({ ...m, [r.id]: { ...e, size: x.target.value } }))} />
                      )}
                    </div>
                  );
                })}
              </div>
              {Object.keys(edit).length > 0 && (
                <div className="cf-action">
                  <span className="sd-muted" style={{ flex: 1 }}>Maat leeg = fitnote wissen.</span>
                  <button
                    className="sd-btn sd-btn--gold"
                    disabled={!!busy}
                    onClick={() => save(Object.entries(edit).map(([id, v]) => ({ id: Number(id), height: v.height, size: v.size })), "Aanpassingen")}
                  >
                    {busy === "save" ? "Opslaan…" : `Wijzigingen opslaan · ${Object.keys(edit).length}`}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
