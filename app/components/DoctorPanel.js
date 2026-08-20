"use client";

/* STORE DOCTOR PANEL — één paneel, twee plekken:
   - /qa (Store Doctor): hele store scannen + fixen, welke store dan ook
   - Importer → "Controles": zelfde motor, gescoped op de zojuist
     geïmporteerde producten (created_at-filter)

   Flow: Scan (gratis, deterministisch) → rapport per categorie → per
   categorie een 1-tik-fix met verplichte backup → AI-checks als aparte
   knoppen met kostenraming vooraf (geslacht / kleur↔foto / watermerk /
   taal-restlaag) → AI-resultaten hebben hun eigen toepas-knoppen. */

import { useEffect, useRef, useState } from "react";
import { MARKETS, MARKET_SIZE_GUIDE } from "@/lib/sizes";

const LS_BACKUP = "sa_doctor_backup";
const LS_MARKET = "sa_doctor_market::"; // + store-domein
const WERKBOEK = "1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE"; // Import-werkboek (default)

// Slimme default: de store-valuta verraadt de markt
const CUR_MARKET = { USD: "USA", GBP: "UK", AUD: "AUS+NZ", NZD: "AUS+NZ", CAD: "CAN" };

// Chunk per AI-check (server verwerkt per call precies dit plukje)
const AI_CHUNK = { gender: 40, language: 25, "color-photo": 8, watermark: 4, sample: 12 };
// Ruwe kostenraming per product (haiku-tarieven) — alleen voor de knop-tekst
const AI_EST = { gender: 0.0006, language: 0.0007, "color-photo": 0.002, watermark: 0.004 };
const AI_META = {
  gender: { label: "Geslacht-check", desc: "Klopt de Men/Women-tag bij elke titel? (alleen draaien bij twijfel)" },
  "color-photo": { label: "Kleur ↔ foto-check", desc: "Toont de gekoppelde foto écht de kleur van de variant? (per kleurgroep beoordeeld)" },
  watermark: { label: "Watermerk/branding-check", desc: "Logo's, watermerken of tekst op bestaande productfoto's" },
  language: { label: "AI-taalcheck", desc: "Vindt vreemde taal die het woordenboek mist" },
  sample: { label: "AI-steekproef — patronen", desc: "12 producten uit alle hoeken in samenhang; zoekt fouten die zich herhalen (groot model)" },
};

function sfx(kind) {
  try {
    window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: kind }));
  } catch {}
}

export default function DoctorPanel({ store, since }) {
  const [max, setMax] = useState("1000");
  const [useSince, setUseSince] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rep, setRep] = useState(null);
  const [open, setOpen] = useState({});
  const [backupSheet, setBackupSheet] = useState("");

  const [fixBusy, setFixBusy] = useState(null); // "findingId|fixId"
  const [fixProg, setFixProg] = useState(null); // {done,total,fixed,failed,skipped}
  const [fixNotes, setFixNotes] = useState([]);
  const stopRef = useRef(false);

  const [aiBusy, setAiBusy] = useState(null);
  const [aiProg, setAiProg] = useState("");
  const [aiRes, setAiRes] = useState({});
  const [aiUsd, setAiUsd] = useState({});

  const [market, setMarket] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_BACKUP);
      setBackupSheet(v != null ? v : WERKBOEK);
    } catch {
      setBackupSheet(WERKBOEK);
    }
  }, []);

  // Markt per store onthouden; eerste keer afgeleid uit de valuta
  useEffect(() => {
    if (!store || !store.domain) return;
    let v = "";
    try {
      v = localStorage.getItem(LS_MARKET + store.domain) || "";
    } catch {}
    setMarket(v || CUR_MARKET[String(store.currency || "").toUpperCase()] || "USA");
  }, [store && store.domain]);

  function pickMarket(m) {
    setMarket(m);
    try {
      localStorage.setItem(LS_MARKET + store.domain, m);
    } catch {}
  }

  const storeBody = store
    ? { domain: store.domain, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret, name: store.name }
    : null;
  const adminUrl = (id) => `https://${store.domain}/admin/products/${id}`;

  /* ---------------- SCAN ---------------- */

  async function scan() {
    if (!store || busy) return;
    setBusy(true);
    setErr("");
    setRep(null);
    setAiRes({});
    setAiUsd({});
    try {
      const r = await fetch("/api/doctor-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store: storeBody,
          max: Number(max) || 1000,
          sinceISO: since && useSince ? since : null,
          vendorName: store.name || "",
          market,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      setRep(data);
      sfx(data.stats.errors ? "error" : "success");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- FIXES ---------------- */

  // Standaard-opties die élke fix meekrijgt (markt voor de maten-conversie,
  // storenaam voor de vendor-fix, kortingsmix voor de doorstreepprijzen).
  function fixOptions(extra) {
    return { vendorName: store.name || "", pcts: [30, 40, 50], menTemplate: "men", market, ...(extra || {}) };
  }

  function backupPlanFor(fixId) {
    const sheet = String(backupSheet || "").trim();
    if (!sheet) return null;
    const d = new Date();
    const tab = `Doctor ${fixId} ${d.getDate()}-${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
    return { sheetId: sheet, tab };
  }

  function askBackupSkip() {
    if (String(backupSheet || "").trim()) {
      try {
        localStorage.setItem(LS_BACKUP, backupSheet.trim());
      } catch {}
      return { ok: true, skipBackup: false };
    }
    const skip = window.confirm("Geen backup-sheet ingevuld. ZONDER backup doorgaan? (niet aan te raden bij verwijder-fixes)");
    return { ok: skip, skipBackup: skip };
  }

  // Kern: één fix over een id-lijst, in chunks tot done. Gooit bij een fout.
  async function execFix(fix, ids, options, skipBackup) {
    const backup = skipBackup ? null : backupPlanFor(fix.id);
    const tot = { done: 0, total: ids.length, fixed: 0, failed: 0, skipped: 0, label: fix.label };
    setFixProg({ ...tot });
    let cursor = 0;
    for (;;) {
      if (stopRef.current) break;
      const r = await fetch("/api/doctor-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: storeBody, fix: fix.id, ids, options, cursor, backup, skipBackup }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      tot.done = data.nextCursor != null ? data.nextCursor : tot.total;
      tot.fixed += data.fixed || 0;
      tot.failed += data.failed || 0;
      tot.skipped += data.skipped || 0;
      setFixProg({ ...tot });
      if (data.notes && data.notes.length) {
        setFixNotes((cur) => [...data.notes, ...cur].slice(0, 80));
      }
      if (data.done) break;
      cursor = data.nextCursor;
    }
    const backupTxt = backup ? ` · backup: "${backup.tab}"` : " · zonder backup";
    setFixNotes((cur) => [
      `✓ ${fix.label}: ${tot.fixed} aangepast · ${tot.skipped} overgeslagen · ${tot.failed} mislukt${backupTxt}`,
      ...cur,
    ]);
    return tot;
  }

  async function runFix(findingId, fix, ids, extraOptions) {
    if (!store || fixBusy || busy || aiBusy || !ids.length) return;
    if (fix.danger) {
      const zeker = window.confirm(
        `${fix.label}\n\n${ids.length} product(en). Dit is niet terug te draaien via de tool zelf — de oude waarden gaan wél eerst naar het backup-tabblad. Doorgaan?`
      );
      if (!zeker) return;
    }
    const b = askBackupSkip();
    if (!b.ok) return;
    setFixBusy(`${findingId}|${fix.id}`);
    setFixNotes([]);
    setErr("");
    stopRef.current = false;
    try {
      const tot = await execFix(fix, ids, fixOptions(extraOptions), b.skipBackup);
      sfx(tot.failed ? "error" : "success");
      // teller verversen — zelfde scope opnieuw scannen
      await scan();
    } catch (e) {
      setErr(`Fix gestopt: ${String(e.message || e)}`);
      sfx("error");
    } finally {
      setFixBusy(null);
      setFixProg(null);
    }
  }

  /* "Fix alle veilige punten": alle fixes met een bulk-vlag na elkaar, één
     bevestiging, per fix een eigen backup-tabblad, één re-scan aan het eind.
     Verwijder-acties, tekst-ingrepen en de maten-conversie zitten er bewust
     NIET bij — die blijven bewuste losse klikken. */
  async function bulkFix() {
    if (!store || !rep || fixBusy || busy || aiBusy) return;
    const jobs = new Map(); // fix-id → {fix, ids:Set} (translate-options zit in 2 checks → samenvoegen)
    for (const f of rep.findings) {
      for (const fx of f.fixes || []) {
        if (!fx.bulk) continue;
        if (!jobs.has(fx.id)) jobs.set(fx.id, { fix: fx, ids: new Set() });
        for (const id of f.ids) jobs.get(fx.id).ids.add(id);
      }
    }
    if (!jobs.size) return;
    const lijst = [...jobs.values()].map((j) => `· ${j.fix.label} (${j.ids.size})`).join("\n");
    if (!window.confirm(`Alle veilige fixes na elkaar draaien:\n\n${lijst}\n\nVerwijder-acties, titel-ingrepen en de maten-omrekening zitten hier bewust NIET bij. Doorgaan?`)) return;
    const b = askBackupSkip();
    if (!b.ok) return;
    setFixBusy("bulk");
    setFixNotes([]);
    setErr("");
    stopRef.current = false;
    let failedTotal = 0;
    try {
      for (const j of jobs.values()) {
        if (stopRef.current) break;
        const tot = await execFix(j.fix, [...j.ids], fixOptions(), b.skipBackup);
        failedTotal += tot.failed;
      }
      sfx(failedTotal ? "error" : "success");
      await scan();
    } catch (e) {
      setErr(`Bulk gestopt: ${String(e.message || e)}`);
      sfx("error");
    } finally {
      setFixBusy(null);
      setFixProg(null);
    }
  }

  /* ---------------- AI-CHECKS ---------------- */

  async function runAi(check) {
    if (!store || !rep || aiBusy || fixBusy) return;
    let ids = rep.productIds || [];
    if (!ids.length) return;
    if (check === "sample") {
      // 12 producten gelijk verspreid over de catalogus
      const step = Math.max(1, Math.floor(ids.length / 12));
      ids = ids.filter((_, i) => i % step === 0).slice(0, 12);
    }
    const est = check === "sample" ? "0.05" : (AI_EST[check] * ids.length).toFixed(2);
    const zeker = window.confirm(
      `${AI_META[check].label} over ${ids.length} producten — geschat ±$${est} aan AI-kosten. Starten?`
    );
    if (!zeker) return;
    setAiBusy(check);
    setErr("");
    stopRef.current = false;
    const chunk = AI_CHUNK[check];
    const all = [];
    let usd = 0;
    try {
      for (let i = 0; i < ids.length; i += chunk) {
        if (stopRef.current) break;
        setAiProg(`${Math.min(i + chunk, ids.length)}/${ids.length}`);
        const r = await fetch("/api/doctor-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store: storeBody, check, ids: ids.slice(i, i + chunk) }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || r.status);
        all.push(...(data.results || []));
        usd += data.aiUsd || 0;
        setAiRes((cur) => ({ ...cur, [check]: [...all] }));
        setAiUsd((cur) => ({ ...cur, [check]: usd }));
      }
      sfx(all.length ? "error" : "success");
    } catch (e) {
      setErr(`${AI_META[check].label} gestopt: ${String(e.message || e)}`);
      sfx("error");
    } finally {
      setAiBusy(null);
      setAiProg("");
    }
  }

  function applyGenderFix() {
    const list = aiRes.gender || [];
    if (!list.length) return;
    const labels = {};
    for (const m of list) labels[String(m.id)] = m.suggested;
    runFix("ai-gender", { id: "gender-tags", label: "Zet gender-tags goed" }, list.map((m) => m.id), { labels });
  }

  function applyWatermarkFix() {
    const list = (aiRes.watermark || []).filter((m) => m.imageId);
    if (!list.length) return;
    const images = {};
    for (const m of list) {
      const k = String(m.id);
      if (!images[k]) images[k] = [];
      images[k].push(m.imageId);
    }
    runFix(
      "ai-watermark",
      { id: "delete-flagged-images", label: "Verwijder geflagde foto's", danger: true },
      [...new Set(list.map((m) => m.id))],
      { images }
    );
  }

  /* ---------------- RENDER ---------------- */

  const scoreColor = (s) => (s >= 8.5 ? "var(--ok)" : s >= 6.5 ? "var(--warn)" : "var(--err)");
  const disabled = !store || busy || !!fixBusy || !!aiBusy;

  return (
    <div>
      <div className="kw-row" style={{ gridTemplateColumns: "1fr 2fr" }}>
        <div>
          <div className="field-label">Max producten</div>
          <input type="number" value={max} onChange={(e) => setMax(e.target.value)} />
        </div>
        <div>
          <div className="field-label">
            Backup-sheet <span className="opt">(oude waarden vóór elke fix)</span>
          </div>
          <input
            type="text"
            placeholder="Sheet ID of URL — leeg = fixes zonder backup"
            value={backupSheet}
            onChange={(e) => setBackupSheet(e.target.value)}
          />
        </div>
      </div>
      <div className="field-label">
        Doelmarkt <span className="opt">(stuurt de maten-check & omrekening)</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {MARKETS.map((m) => (
          <button
            key={m}
            type="button"
            className="btn-ghost btn-small"
            onClick={() => pickMarket(m)}
            style={market === m ? { borderColor: "var(--ok)", color: "var(--ok)", fontWeight: 700 } : {}}
          >
            {m}
          </button>
        ))}
        <button type="button" className="linklike" onClick={() => setShowGuide((v) => !v)}>
          {showGuide ? "▾" : "▸"} maten-spiekbrief
        </button>
      </div>
      {showGuide && market ? (
        <div className="hint" style={{ marginTop: 6 }}>
          {(MARKET_SIZE_GUIDE[market] || []).map((line, i) => (
            <div key={i}>· {line}</div>
          ))}
        </div>
      ) : null}

      {since ? (
        <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={useSince} onChange={(e) => setUseSince(e.target.checked)} />
          Alleen de producten van deze import-run controleren
        </label>
      ) : null}

      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn" onClick={scan} disabled={disabled}>
          {busy ? "Scannen…" : "✚ Scan producten"}
        </button>
        {(fixBusy || aiBusy) && (
          <button className="btn-ghost btn-small" onClick={() => { stopRef.current = true; }}>
            ■ Stop na deze stap
          </button>
        )}
      </div>
      {err && (
        <div className="hint" style={{ color: "var(--err)" }}>
          {err}
        </div>
      )}

      {fixProg && (
        <div className="prog-card" style={{ marginTop: 12 }}>
          <div className="prog-top">
            <span className="prog-title">Fix bezig… {fixProg.label ? `· ${fixProg.label}` : ""}</span>
            <span className="prog-count">
              {fixProg.done}/{fixProg.total}
              <span className="prog-sep"> · </span>
              {fixProg.fixed} aangepast
              {fixProg.failed ? <span className="err"> · {fixProg.failed} mislukt</span> : null}
            </span>
          </div>
          <div className="pbar">
            <div className="pbar-fill live" style={{ width: fixProg.total ? (fixProg.done / fixProg.total) * 100 + "%" : "0%" }} />
          </div>
        </div>
      )}

      {fixNotes.length > 0 && !fixProg && (
        <div className="logpanel" style={{ marginTop: 10, maxHeight: 140 }}>
          {fixNotes.map((n, i) => (
            <div className="log" key={i}>
              <span className={/MISLUKT|LET OP/.test(n) ? "err" : "muted"}>{n}</span>
            </div>
          ))}
        </div>
      )}

      {rep && (
        <div className="prog-card" style={{ marginTop: 12 }}>
          <div className="prog-top">
            <span className="prog-title">Rapport · {rep.scanned} producten</span>
            <span className="prog-count" style={{ color: scoreColor(rep.stats.score) }}>
              {String(rep.stats.score).replace(".", ",")}/10
            </span>
          </div>
          <div className="prog-meta">
            <span>
              <span className="err">{rep.stats.errors} fouten</span>
              <span className="prog-sep"> · </span>
              {rep.stats.warns} waarschuwingen
            </span>
          </div>

          {rep.findings.some((f) => (f.fixes || []).some((x) => x.bulk)) && (
            <div style={{ marginTop: 8 }}>
              <button className="btn-ghost btn-small" disabled={disabled} onClick={bulkFix}>
                {fixBusy === "bulk" ? "Bulk bezig…" : "⚡ Fix alle veilige punten in één keer"}
              </button>
              <span className="hint" style={{ marginLeft: 8 }}>
                verwijderen, titel-ingrepen en maten-omrekening blijven losse klikken
              </span>
            </div>
          )}

          <div className="logpanel" style={{ marginTop: 12 }}>
            {rep.findings.length === 0 && <div className="center-note">Alles schoon. Netjes.</div>}
            {rep.findings.map((f) => (
              <div key={f.id} className="log" style={{ display: "block" }}>
                <div
                  style={{ display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer" }}
                  onClick={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))}
                >
                  <span className={f.level === "error" ? "err" : "warn"}>{f.level === "error" ? "✗" : "!"}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{f.title}</span>
                  <span className="muted small">{f.count}×</span>
                  <span className="muted small">{open[f.id] ? "▾" : "▸"}</span>
                </div>
                {open[f.id] && (
                  <div style={{ paddingLeft: 20, marginTop: 6 }}>
                    <div className="hint" style={{ marginTop: 0 }}>{f.why}</div>
                    {(f.fixes || []).map((fx) => (
                      <button
                        key={fx.id}
                        className="btn-ghost btn-small"
                        style={{ marginRight: 8, marginTop: 6, ...(fx.danger ? { color: "var(--err)", borderColor: "var(--err)" } : {}) }}
                        disabled={disabled}
                        onClick={() => runFix(f.id, fx, f.ids)}
                      >
                        {fixBusy === `${f.id}|${fx.id}` ? "Bezig…" : `⚡ ${fx.label} (${f.count})`}
                      </button>
                    ))}
                    <div style={{ marginTop: 6 }}>
                      {f.examples.map((ex) => (
                        <div key={ex.id} className="hint" style={{ marginTop: 2 }}>
                          <a className="linklike" href={adminUrl(ex.id)} target="_blank" rel="noreferrer noopener">
                            {ex.title}
                          </a>
                          {ex.extra ? <span className="muted"> — {ex.extra}</span> : null}
                        </div>
                      ))}
                      {f.count > f.examples.length && (
                        <div className="hint muted">… en {f.count - f.examples.length} meer</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {rep && (
        <div style={{ marginTop: 14 }}>
          <div className="field-label">AI-checks (goedkoop model — kosten vooraf in beeld)</div>
          {Object.keys(AI_META).map((check) => (
            <div key={check} className="log" style={{ display: "block", marginTop: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn-ghost btn-small" disabled={disabled} onClick={() => runAi(check)}>
                  {aiBusy === check ? `Bezig… ${aiProg}` : `✦ ${AI_META[check].label}`}
                </button>
                <span className="hint" style={{ marginTop: 0, flex: 1 }}>
                  {AI_META[check].desc} · ±$
                  {check === "sample" ? "0.05" : (AI_EST[check] * (rep.productIds || []).length).toFixed(2)}
                </span>
                {aiUsd[check] != null && <span className="muted small">±${aiUsd[check].toFixed(3)} gebruikt</span>}
              </div>

              {aiRes[check] && (
                <div style={{ paddingLeft: 4, marginTop: 6 }}>
                  {aiRes[check].length === 0 && !aiBusy && (
                    <div className="hint" style={{ color: "var(--ok)" }}>Niets gevonden — schoon.</div>
                  )}
                  {aiRes[check].length > 0 && (
                    <>
                      {check === "gender" && (
                        <button className="btn-ghost btn-small" disabled={disabled} onClick={applyGenderFix}>
                          ⚡ Zet {aiRes.gender.length} gender-tag(s) goed
                        </button>
                      )}
                      {check === "watermark" && (
                        <button
                          className="btn-ghost btn-small"
                          style={{ color: "var(--err)", borderColor: "var(--err)" }}
                          disabled={disabled}
                          onClick={applyWatermarkFix}
                        >
                          ⚡ Verwijder {aiRes.watermark.filter((m) => m.imageId).length} geflagde foto('s)
                        </button>
                      )}
                      <div style={{ marginTop: 4 }}>
                        {aiRes[check].slice(0, 25).map((m, i) => (
                          <div key={i} className="hint" style={{ marginTop: 2 }}>
                            {m.id ? (
                              <a className="linklike" href={adminUrl(m.id)} target="_blank" rel="noreferrer noopener">
                                {m.title}
                              </a>
                            ) : (
                              <strong>{m.title}</strong>
                            )}
                            <span className="muted">
                              {check === "gender" && ` — ${m.current} → ${m.suggested}`}
                              {check === "color-photo" && ` — "${m.color}": ${m.why}`}
                              {check === "watermark" && ` — ${m.reason}`}
                              {check === "language" && ` — ${m.lang}: "${m.sample}"`}
                              {check === "sample" && ` — ${m.why}${m.affected ? ` (${m.affected} van de steekproef)` : ""}${m.example ? ` · bv. ${m.example}` : ""}`}
                            </span>
                          </div>
                        ))}
                        {aiRes[check].length > 25 && (
                          <div className="hint muted">… en {aiRes[check].length - 25} meer</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="hint">
            Kleur↔foto en taal-vondsten zijn handwerk (bewust — automatisch herschrijven is riskanter dan het probleem).
            Geslacht en watermerk hebben een eigen toepas-knop hierboven.
          </div>
        </div>
      )}
    </div>
  );
}
