"use client";

/* SIZE GUIDE PANEL — maattabellen voor élk product van een store.
   Flow: Scan → Bouw (image-search → AI-match → AliExpress-tabel → normaliseren
   → cijfer) → Schrijf (metafield custom.size_guide + status, met logtabblad).
   Groen/amber/standaard worden automatisch geschreven; rood komt in de
   review-lijst met vier handmatige routes: AliExpress-URL plakken,
   screenshot laten lezen, standaardtabel, of verwijderen. */

import { useEffect, useRef, useState } from "react";
import { MARKETS } from "@/lib/sizes";
import { formatCell, unitSuffix } from "@/lib/sizeguide";

const LS_LOG = "sa_sizeguide_log";
const LS_MARKET = "sa_doctor_market::"; // zelfde sleutel als de Store Doctor → één doelmarkt per store
const WERKBOEK = "1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE";
const CUR_MARKET = { USD: "USA", GBP: "UK", AUD: "AUS+NZ", NZD: "AUS+NZ", CAD: "CAN" };

const VERDICT_LABEL = { green: "groen", amber: "amber", standard: "standaard", red: "rood", none: "geen maten" };

function sfx(kind) {
  try {
    window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: kind }));
  } catch {}
}

function badgeClass(v) {
  if (v === "green") return "badge badge-green";
  if (v === "amber" || v === "standard") return "badge badge-amber";
  return "badge";
}

/* Zelfde weergave-regels als de theme-snippet: tabel + in/cm-knop */
export function GuidePreview({ guide }) {
  const [unit, setUnit] = useState(guide.unit_default || "in");
  useEffect(() => setUnit(guide.unit_default || "in"), [guide]);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <span className="badge">{guide.status}</span>
        <span className="muted small">{guide.market} · {guide.gender} · {guide.family}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="seg">
          <button className={unit === "in" ? "on" : ""} onClick={() => setUnit("in")} type="button">in</button>
          <button className={unit === "cm" ? "on" : ""} onClick={() => setUnit("cm")} type="button">cm</button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="mini-table">
          <tbody>
            <tr>
              {guide.columns.map((c) => (
                <td key={c.key} style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {c.label}
                  {unitSuffix(c.kind, unit) ? <span className="muted"> ({unitSuffix(c.kind, unit)})</span> : null}
                </td>
              ))}
            </tr>
            {guide.rows.map((r, i) => (
              <tr key={i}>
                {guide.columns.map((c) => (
                  <td key={c.key} style={{ whiteSpace: "nowrap" }}>{formatCell(r[c.key], c.kind, unit)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>{guide.note}</div>
    </div>
  );
}

// Screenshot verkleinen tot max 1600px (Vercel-bodylimiet ±4,5 MB) → data-URL
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default function SizeGuidePanel({ store, since }) {
  const [market, setMarket] = useState("USA");
  const [logSheet, setLogSheet] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [useSearch, setUseSearch] = useState(true);
  const [fallbackStandard, setFallbackStandard] = useState(true);
  const [autoWrite, setAutoWrite] = useState(true);

  const [items, setItems] = useState(null);
  const [counts, setCounts] = useState(null);
  const [results, setResults] = useState({}); // id → build-result
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);
  const [err, setErr] = useState("");
  const [prog, setProg] = useState(null); // {done,total,green,amber,standard,red,usd}
  const [log, setLog] = useState([]);
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [probe, setProbe] = useState(null);
  const [envInfo, setEnvInfo] = useState(null); // {apify, proxy, redis} — bij laden opgehaald
  const stopRef = useRef(false);
  const fileRef = useRef(null);
  const fileTarget = useRef(null);
  // Eén logtabblad per sessie/store — alle writes (batch én handmatig) eronder
  const tabRef = useRef("");

  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_LOG);
      setLogSheet(v != null ? v : WERKBOEK);
    } catch {
      setLogSheet(WERKBOEK);
    }
    // Instellingen-check bij laden (geen AliExpress-request): staat de Apify-token er?
    fetch("/api/size-guide/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envOnly: true }) })
      .then((r) => r.json())
      .then((d) => d && d.env && setEnvInfo(d.env))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!store || !store.domain) return;
    let v = "";
    try {
      v = localStorage.getItem(LS_MARKET + store.domain) || "";
    } catch {}
    setMarket(v || CUR_MARKET[String(store.currency || "").toUpperCase()] || "USA");
    setItems(null);
    setResults({});
    setLog([]);
    setProg(null);
    tabRef.current = `SizeGuide ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  }, [store && store.domain]);

  function pickMarket(m) {
    setMarket(m);
    try {
      localStorage.setItem(LS_MARKET + store.domain, m);
    } catch {}
  }
  function saveLogSheet(v) {
    setLogSheet(v);
    try {
      localStorage.setItem(LS_LOG, v);
    } catch {}
  }
  function addLog(text, cls) {
    setLog((cur) => [{ text, cls: cls || "", t: Date.now() + Math.random() }, ...cur].slice(0, 120));
  }

  const storeBody = store ? { domain: store.domain, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret, name: store.name } : null;
  const backup = logSheet ? { sheetId: logSheet.trim(), tab: tabRef.current } : null;

  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /* ---------- Probe ---------- */
  async function runProbe() {
    setErr("");
    setProbe({ busy: true });
    try {
      const d = await post("/api/size-guide/probe", {});
      setProbe(d);
      if (d.ok) addLog(`Probe oké via ${d.via} (${d.ms} ms): ${d.headers.join(" | ")} — ${d.rows.length} rijen, unit ${d.unit}`, "ok");
      else addLog(`Probe: ${d.blocked ? "GEBLOKKEERD — " : ""}${d.message || d.reason} (via ${d.via || "?"})`, d.blocked ? "err" : "warn");
    } catch (e) {
      setProbe({ ok: false, error: String(e.message) });
      addLog(`Probe mislukt: ${e.message}`, "err");
    }
  }

  /* ---------- Scan ---------- */
  async function scan() {
    setErr("");
    setBusy(true);
    setItems(null);
    setResults({});
    try {
      const d = await post("/api/size-guide/scan", { store: storeBody, sinceISO: since || null });
      setItems(d.items);
      setCounts(d.counts);
      addLog(`Scan: ${d.counts.total} producten · ${d.counts.withGuide} met maattabel · ${d.counts.noSizes} zonder maten${d.metafieldsReadable ? "" : " · LET OP: metafields niet leesbaar (" + d.metafieldsError + ")"}`, "ok");
      sfx("done");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Schrijven (chunk-loop) ---------- */
  async function writeMany(list, label) {
    if (!list.length) return { written: 0, failed: 0 };
    let cursor = 0;
    let written = 0;
    let failed = 0;
    const bk = backup;
    while (cursor < list.length) {
      const d = await post("/api/size-guide/write", { store: storeBody, items: list, cursor, backup: bk, skipBackup: !bk });
      written += d.written || 0;
      failed += d.failed || 0;
      for (const n of d.notes || []) addLog(`schrijffout: ${n}`, "err");
      cursor = d.nextCursor;
      if (d.done) break;
    }
    addLog(`${label || "Geschreven"}: ${written} maattabel(len) naar Shopify${failed ? ` · ${failed} mislukt` : ""}${bk ? ` · log: ${bk.tab}` : ""}`, failed ? "warn" : "ok");
    setItems((cur) => (cur || []).map((it) => {
      const w = list.find((x) => String(x.id) === String(it.id));
      return w && w.guide ? { ...it, sgStatus: w.guide.status } : it;
    }));
    return { written, failed };
  }

  /* ---------- Bouwen (batch) ---------- */
  function selection() {
    return (items || []).filter((it) => it.sizes.length && (!onlyMissing || !it.sgStatus || it.sgStatus === "standard"));
  }

  async function run() {
    const list = selection();
    if (!list.length) {
      setErr("Niets te doen — alle producten met maten hebben al een maattabel (zet 'alleen zonder maattabel' uit om te herbouwen).");
      return;
    }
    if (!logSheet && !window.confirm("Geen log-sheet ingevuld. Doorgaan zonder log?")) return;
    setErr("");
    // Zonder APIFY_TOKEN kan er niet op foto gezocht worden — dan zou de hele
    // run stilletjes in standaardtabellen eindigen. Eerst hard waarschuwen.
    if (useSearch) {
      try {
        const e = await post("/api/size-guide/probe", { envOnly: true });
        if (e.env && !e.env.apify) {
          const go = window.confirm(
            "APIFY_TOKEN staat niet in Vercel — AliExpress zoeken op foto kan niet draaien.\n\n" +
              "Doorgaan betekent: ALLEEN standaardtabellen (geen leveranciersmaten).\n" +
              "Annuleer, zet APIFY_TOKEN in Vercel → Environment Variables, redeploy, en start dan opnieuw."
          );
          if (!go) return;
        }
      } catch {}
    }
    setBusy(true);
    stopRef.current = false;
    const p = { done: 0, total: list.length, green: 0, amber: 0, standard: 0, red: 0, usd: 0 };
    setProg({ ...p });
    addLog(`Start: ${list.length} producten · markt ${market} · image-search ${useSearch ? "aan" : "uit"} · vangnet ${fallbackStandard ? "aan" : "uit"}`, "muted");
    const toWrite = [];
    let cursor = 0;
    try {
      while (cursor < list.length && !stopRef.current) {
        const d = await post("/api/size-guide/build", { store: storeBody, market, items: list, cursor, useSearch, fallbackStandard });
        for (const r of d.results) {
          setResults((cur) => ({ ...cur, [r.id]: r }));
          p.done++;
          p.usd += (r.ai && r.ai.usd) || 0;
          const v = r.ok ? r.verdict : r.verdict === "none" ? "none" : "red";
          if (p[v] != null) p[v]++;
          const t = String(r.title || r.id).slice(0, 48);
          if (r.ok) {
            addLog(`${t}: ${VERDICT_LABEL[r.verdict]} ${r.score}/10${r.source === "standard" ? ` (standaard — ${r.fallbackReason})` : r.match && r.match.via ? ` · match ${r.match.via} ${Math.round((r.match.confidence || 0) * 100)}%` : ""}${r.missing && r.missing.length ? ` · ontbreekt: ${r.missing.join("/")}` : ""}`, r.verdict === "green" ? "ok" : "warn");
            if (autoWrite && r.guide && (r.verdict === "green" || r.verdict === "amber" || r.verdict === "standard")) toWrite.push(r);
          } else {
            addLog(`${t}: ${r.verdict === "none" ? "geen maten" : "ROOD"} — ${r.reason}`, r.verdict === "none" ? "muted" : "err");
          }
        }
        setProg({ ...p });
        cursor = d.nextCursor;
        if (d.done) break;
        // tussentijds wegschrijven zodat een stop/504 niets kost
        if (toWrite.length >= 20) {
          await writeMany(toWrite.splice(0, toWrite.length), "Tussentijds geschreven");
        }
      }
      if (toWrite.length) await writeMany(toWrite.splice(0, toWrite.length), "Geschreven");
      addLog(`Klaar: ${p.done}/${p.total} · groen ${p.green} · amber ${p.amber} · standaard ${p.standard} · rood ${p.red} · AI-kosten ±$${p.usd.toFixed(2)}${stopRef.current ? " (gestopt)" : ""}`, "ok");
      sfx("done");
    } catch (e) {
      setErr(e.message);
      addLog(`Run gestopt: ${e.message}`, "err");
      if (toWrite.length) {
        try {
          await writeMany(toWrite, "Geschreven vóór de fout");
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Handmatige routes per product ---------- */
  async function rowBuild(it, opts, label) {
    setErr("");
    setRowBusy(it.id);
    try {
      const d = await post("/api/size-guide/build", { store: storeBody, market, items: [it], cursor: 0, ...opts });
      const r = d.results[0];
      setResults((cur) => ({ ...cur, [r.id]: r }));
      if (r.ok && r.guide) {
        await writeMany([r], `${label}: ${VERDICT_LABEL[r.verdict]} ${r.score}/10 — geschreven`);
        setOpenId(r.id);
      } else {
        addLog(`${label}: ${r.reason}`, "err");
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setRowBusy(null);
    }
  }
  function rowAli(it) {
    const v = window.prompt("AliExpress product-URL of ID:", "");
    if (!v) return;
    rowBuild(it, { aliInput: v.trim(), useSearch: false, fallbackStandard: false }, "AliExpress-URL");
  }
  function rowStandard(it) {
    rowBuild(it, { useSearch: false, fallbackStandard: true, force: true }, "Standaardtabel");
  }
  function rowRetry(it) {
    rowBuild(it, { useSearch: true, fallbackStandard, force: true }, "Opnieuw gezocht");
  }
  function rowScreenshot(it) {
    fileTarget.current = it;
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }
  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    const it = fileTarget.current;
    if (!file || !it) return;
    setRowBusy(it.id);
    try {
      const dataUrl = await fileToDataUrl(file);
      const d = await post("/api/size-guide/read-image", { item: it, market, dataUrl });
      const r = d.result;
      setResults((cur) => ({ ...cur, [r.id]: r }));
      if (r.ok && r.guide) {
        await writeMany([r], `Screenshot gelezen: ${VERDICT_LABEL[r.verdict]} ${r.score}/10 — geschreven`);
        setOpenId(r.id);
      } else {
        addLog(`Screenshot: ${r.reason}${r.chart ? ` (gelezen: ${r.chart.headers.join(" | ")})` : ""}`, "err");
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setRowBusy(null);
    }
  }
  async function rowRemove(it) {
    if (!window.confirm(`Maattabel van "${it.title}" verwijderen?`)) return;
    setRowBusy(it.id);
    try {
      const d = await post("/api/size-guide/remove", { store: storeBody, ids: [it.id] });
      addLog(`Verwijderd: ${it.title.slice(0, 48)}${d.errors && d.errors.length ? " — " + d.errors.join("; ") : ""}`, d.ok ? "ok" : "err");
      setItems((cur) => (cur || []).map((x) => (x.id === it.id ? { ...x, sgStatus: null } : x)));
      setResults((cur) => {
        const n = { ...cur };
        delete n[it.id];
        return n;
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setRowBusy(null);
    }
  }

  /* ---------- Lijst ---------- */
  const rowsAll = (items || []).map((it) => ({ it, r: results[it.id] || null }));
  const verdictOf = ({ it, r }) => {
    if (!it.sizes.length) return "none";
    if (r) return r.ok ? r.verdict : r.verdict === "none" ? "none" : "red";
    if (it.sgStatus) return it.sgStatus === "standard" ? "standard" : "written";
    return "missing";
  };
  const rows = rowsAll.filter((x) => {
    const v = verdictOf(x);
    if (filter === "all") return true;
    if (filter === "review") return v === "red" || v === "amber";
    if (filter === "missing") return v === "missing";
    if (filter === "standard") return v === "standard";
    if (filter === "green") return v === "green" || v === "written";
    return true;
  });
  const sel = items ? selection().length : 0;

  return (
    <div>
      {/* ---------- instellingen ---------- */}
      <div className="field-label">Doelmarkt <span className="opt">— bepaalt de maatkolom (US/AU/UK) en de standaard-eenheid</span></div>
      <div className="seg" style={{ marginBottom: 10 }}>
        {MARKETS.map((m) => (
          <button key={m} type="button" className={market === m ? "on" : ""} onClick={() => pickMarket(m)} disabled={busy}>{m}</button>
        ))}
      </div>
      <div className="field-label">Log-sheet (ID) <span className="opt">— per run een tabblad "SizeGuide &lt;datum&gt;" met herkomst, cijfer en JSON</span></div>
      <input type="text" value={logSheet} onChange={(e) => saveLogSheet(e.target.value)} placeholder="Google Sheet ID" disabled={busy} style={{ width: "100%", marginBottom: 10 }} />
      <div className="toggle-row"><span className={"switch" + (onlyMissing ? " on" : "")} onClick={() => !busy && setOnlyMissing(!onlyMissing)} /> Alleen producten zonder maattabel (of met standaardtabel)</div>
      <div className="toggle-row"><span className={"switch" + (useSearch ? " on" : "")} onClick={() => !busy && setUseSearch(!useSearch)} /> AliExpress zoeken op foto (Apify + AI-match){envInfo && !envInfo.apify ? <span className="badge" style={{ marginLeft: 8 }}>APIFY_TOKEN ontbreekt in Vercel</span> : null}</div>
      <div className="toggle-row"><span className={"switch" + (fallbackStandard ? " on" : "")} onClick={() => !busy && setFallbackStandard(!fallbackStandard)} /> Vangnet: standaardtabel als er geen betrouwbare match is</div>
      <div className="toggle-row"><span className={"switch" + (autoWrite ? " on" : "")} onClick={() => !busy && setAutoWrite(!autoWrite)} /> Groen, amber en standaard direct naar Shopify schrijven</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        <button className="btn" onClick={scan} disabled={busy || !store}>{busy && !items ? <span className="spin" /> : null} Scan store</button>
        <button className="btn" onClick={run} disabled={busy || !items || !sel}>Bouw maattabellen ({sel})</button>
        {busy && <button className="btn-ghost" onClick={() => (stopRef.current = true)}>Stop na dit product</button>}
        <button className="btn-ghost btn-small" onClick={runProbe} disabled={busy}>Probe AliExpress</button>
      </div>
      {probe && !probe.busy && (
        <div className={"hint"} style={{ marginTop: 6 }}>
          {probe.ok ? `AliExpress bereikbaar via ${probe.via} (${probe.ms} ms) · ` : `AliExpress: ${probe.blocked ? "GEBLOKKEERD" : "niet gelukt"} — ${probe.message || probe.error || probe.reason} · `}
          {probe.env ? `Apify ${probe.env.apify ? "✓" : "✗ (APIFY_TOKEN)"} · proxy ${probe.env.proxy ? "✓" : "—"} · cache ${probe.env.redis ? "✓" : "—"}` : ""}
        </div>
      )}
      {err && <div className="log err" style={{ marginTop: 10 }}>{err}</div>}

      {/* ---------- voortgang ---------- */}
      {prog && (
        <div className="prog-card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong>{prog.done}/{prog.total}</strong>
            <span className="badge badge-green">groen {prog.green}</span>
            <span className="badge badge-amber">amber {prog.amber}</span>
            <span className="badge badge-amber">standaard {prog.standard}</span>
            <span className="badge">rood {prog.red}</span>
            <span className="muted small">AI ±${prog.usd.toFixed(2)}</span>
          </div>
          <div className="progressbar" style={{ marginTop: 8 }}><div style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div>
        </div>
      )}
      {log.length > 0 && (
        <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto" }}>
          {log.map((l) => (
            <div key={l.t} className={"log " + l.cls}>{l.text}</div>
          ))}
        </div>
      )}

      {/* ---------- lijst ---------- */}
      {items && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="seg">
              {[["all", `alle (${rowsAll.length})`], ["review", "review"], ["missing", "zonder"], ["standard", "standaard"], ["green", "met tabel"]].map(([k, l]) => (
                <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <span className="muted small">{counts ? `${counts.withGuide} met maattabel · ${counts.noSizes} zonder maten` : ""}</span>
          </div>
          <table className="mini-table" style={{ marginTop: 8 }}>
            <tbody>
              {rows.slice(0, 400).map(({ it, r }) => {
                const v = verdictOf({ it, r });
                const open = openId === it.id;
                return (
                  <tr key={it.id}>
                    <td style={{ width: 44 }}>{it.image ? <img src={it.image + (it.image.includes("?") ? "&" : "?") + "width=80"} alt="" style={{ width: 36, height: 48, objectFit: "cover", borderRadius: 6 }} /> : null}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <strong>{it.title}</strong>
                        <span className={badgeClass(v)}>{v === "written" ? it.sgStatus : VERDICT_LABEL[v] || v}</span>
                        {r && r.score != null && <span className="muted small">{r.score}/10</span>}
                        {r && r.match && r.match.via && r.match.pid && <span className="muted small">match {r.match.via} {Math.round((r.match.confidence || 0) * 100)}%</span>}
                      </div>
                      <div className="muted small">{it.family} · {it.gender} · {it.sizes.length ? it.sizes.join(" / ") : "geen maten"}{r && !r.ok && r.reason ? ` · ${r.reason}` : ""}{r && r.fallbackReason ? ` · vangnet: ${r.fallbackReason}` : ""}{r && r.issues && r.issues.length ? ` · ${r.issues.join("; ")}` : ""}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        {r && r.guide && <button className="btn-ghost btn-small" onClick={() => setOpenId(open ? null : it.id)}>{open ? "sluit" : "bekijk"}</button>}
                        {it.sizes.length > 0 && (
                          <>
                            <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id} onClick={() => rowAli(it)}>AliExpress-URL…</button>
                            <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id} onClick={() => rowScreenshot(it)}>Screenshot → AI…</button>
                            <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id} onClick={() => rowStandard(it)}>Standaardtabel</button>
                            <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id || !useSearch} onClick={() => rowRetry(it)}>Zoek opnieuw</button>
                          </>
                        )}
                        {(it.sgStatus || (r && r.guide)) && <button className="btn-ghost btn-small" disabled={busy || rowBusy === it.id} onClick={() => rowRemove(it)}>Verwijder</button>}
                        {rowBusy === it.id && <span className="spin" />}
                      </div>
                      {open && r && r.guide && <GuidePreview guide={r.guide} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 400 && <div className="hint">Eerste 400 getoond — filter om de rest te zien.</div>}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />
    </div>
  );
}
