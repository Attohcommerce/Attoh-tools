"use client";

/* PLANNEN VAN CLAUDE · ALLE STORES (21-11-2026)
   Eén prijsplan-set (public/price-plans/sets/<naam>.json) koppelt per store
   (myshopify-domein) een gewoon prijsplan uit public/price-plans/. Zelfde motor
   als "Prijsplan toepassen" in het losse paneel: Doctor-fix "set-prices" in
   stappen, backup-tabblad per store, en producten waarvan de prijs intussen
   handmatig is veranderd worden overgeslagen ("from" klopt niet meer).
   1. Laad de set.  2. Controleer eerst (droge run, verandert niets).  3. Zet door. */

import { useEffect, useState } from "react";
import { runFixLoop } from "@/lib/doctor-engine";

function shortName(s) {
  return String(s.name || s.domain || "").replace(/\.myshopify\.com$/, "").slice(0, 24);
}

export default function AllStoresPricePlans({ stores, included, bodyOf, backupSheet, busy, setBusy, runApi, stopRef, setPausing, onSaveBackup }) {
  const [setName, setSetName] = useState("");
  const [available, setAvailable] = useState([]);
  const [planSet, setPlanSet] = useState(null); // { name, note, plans: { domain: plan } }
  const [err, setErr] = useState("");
  const [result, setResult] = useState({}); // domain → { mode, fixed, skipped, failed }

  useEffect(() => {
    fetch("/price-plans/sets/index.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setAvailable(Array.isArray(j) ? j : []))
      .catch(() => setAvailable([]));
  }, []);

  async function loadSet(nameArg) {
    const name = String(nameArg != null ? nameArg : setName || "").trim().replace(/\.json$/i, "");
    if (!name) return;
    setSetName(name);
    setErr("");
    setResult({});
    try {
      const r = await fetch(`/price-plans/sets/${encodeURIComponent(name)}.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(`set "${name}" niet gevonden (${r.status})`);
      const set = await r.json();
      const plans = {};
      for (const [domain, planName] of Object.entries(set.plans || {})) {
        const pr = await fetch(`/price-plans/${encodeURIComponent(planName)}.json`, { cache: "no-store" });
        if (!pr.ok) throw new Error(`plan "${planName}" niet gevonden (${pr.status})`);
        const plan = await pr.json();
        if (Array.isArray(plan.items) && plan.items.length) plans[domain] = { ...plan, name: planName };
      }
      if (!Object.keys(plans).length) throw new Error("set is leeg");
      setPlanSet({ ...set, name, plans });
    } catch (e) {
      setPlanSet(null);
      setErr(`Plannen: ${String(e.message || e)}`);
    }
  }

  const targets = planSet ? included.filter((s) => planSet.plans[s.domain]) : [];
  const totalItems = targets.reduce((a, s) => a + planSet.plans[s.domain].items.filter((it) => it.id).length, 0);

  async function runAll(dryRun) {
    if (busy || !planSet || !targets.length) return;
    setErr("");
    const sheet = String(backupSheet || "").trim();
    if (!dryRun) {
      if (!sheet && !window.confirm("Geen backup-sheet ingevuld. ZONDER backup alle prijzen aanpassen? (niet aan te raden)")) return;
      const lines = targets.map((s) => `• ${shortName(s)}: ${planSet.plans[s.domain].items.length} producten`);
      if (!window.confirm(`${totalItems} producten krijgen een nieuwe prijs in ${targets.length} store(s):\n\n${lines.join("\n")}\n\n${planSet.note || ""}\n\nProducten waarvan de prijs intussen is veranderd worden overgeslagen. Oude prijzen gaan eerst naar de backup-sheet. Starten?`)) return;
      if (sheet && onSaveBackup) onSaveBackup(sheet);
    }
    setBusy(dryRun ? "plan-check" : "plan");
    stopRef.current = false;
    setPausing(false);
    setResult({});
    runApi.start(`${dryRun ? "Controle" : "Prijsplannen"} · ${planSet.name}`, {
      phases: [{ key: "fixes", label: dryRun ? "Controle" : "Prijzen" }],
      sub: `${targets.length} store(s) · ${totalItems} producten${dryRun ? " · droge run — er verandert niets" : ""}`,
    });
    runApi.phase("fixes", dryRun ? "Controleren" : "Prijzen aanpassen");
    const d = new Date();
    const stamp = `${d.getDate()}-${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (stopRef.current) break;
        const s = targets[i];
        const plan = planSet.plans[s.domain];
        const sn = shortName(s);
        const items = plan.items.filter((it) => it.id);
        const prices = {};
        for (const it of items) prices[String(it.id)] = { price: it.price, compareAt: it.compareAt, from: it.from, discount: it.discount, raiseOnly: it.raiseOnly };
        const label = `${dryRun ? "Controle " : ""}prijsplan ${plan.name}`;
        runApi.store(i + 1, targets.length, sn);
        runApi.step(`${sn} · ${label}`, { i: i + 1, of: targets.length, total: items.length });
        let last = { fixed: 0, skipped: 0, failed: 0 };
        try {
          const tot = await runFixLoop(bodyOf(s), { id: "set-prices", label }, items.map((it) => it.id), {
            options: { vendorName: s.name || "", prices, dryRun: !!dryRun },
            backup: !dryRun && sheet ? { sheetId: sheet, tab: `Doctor ${sn} prijsplan ${stamp}`.slice(0, 95) } : null,
            skipBackup: dryRun || !sheet,
            shouldStop: () => stopRef.current,
            onProgress: (t) => {
              runApi.progress(t.done, t.total);
              runApi.count({ fixed: t.fixed - last.fixed, skipped: t.skipped - last.skipped, failed: t.failed - last.failed });
              last = t;
            },
            onNotes: (lines) => lines.filter((l) => /MISLUKT|time-out|LET OP/i.test(l)).slice(0, 2).forEach((l) => runApi.log(`${sn}: ${l}`, "warn")),
          });
          setResult((cur) => ({ ...cur, [s.domain]: { dryRun, ...tot } }));
          runApi.log(
            dryRun
              ? `${sn}: ${tot.fixed} zouden veranderen · ${tot.skipped} al goed of overgeslagen${tot.failed ? ` · ${tot.failed} mislukt` : ""}`
              : `${sn}: ${tot.fixed} prijzen aangepast · ${tot.skipped} overgeslagen${tot.failed ? ` · ${tot.failed} mislukt` : ""}${sheet ? "" : " · zonder backup"}`,
            tot.failed ? "warn" : "ok"
          );
        } catch (e) {
          setResult((cur) => ({ ...cur, [s.domain]: { dryRun, error: String(e.message || e) } }));
          runApi.log(`${sn}: gestopt — ${String(e.message || e)} · ik ga door met de volgende store`, "err");
        }
      }
      runApi.finish(stopRef.current ? "paused" : "done", stopRef.current ? "Gepauzeerd" : dryRun ? "Controle klaar — er is niets aangepast" : "Alle prijsplannen klaar");
    } catch (e) {
      setErr(String(e.message || e));
      runApi.finish("error");
    } finally {
      setBusy("");
      setPausing(false);
    }
  }

  return (
    <details className="sd-card sd-settings" open={!!planSet}>
      <summary>
        <span className="sd-card__title" style={{ margin: 0 }}>Plannen van Claude</span>
        <span className="sd-muted"> · prijsplan voor alle stores in één keer</span>
      </summary>
      <div className="sd-settings__body">
        <div className="field-label">
          Prijsplan-set toepassen <span className="opt">één plan per store, gemaakt door Claude, bv. uitschieters-2026-11-21</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input type="text" value={setName} placeholder="naam van de set" onChange={(e) => setSetName(e.target.value)} disabled={!!busy} style={{ maxWidth: 260 }} />
          <button type="button" className="sd-btn sd-btn--ghost sd-btn--small" disabled={!setName.trim() || !!busy} onClick={() => loadSet()}>
            Laad plannen
          </button>
          {available.length > 0 && <span className="sd-muted small">Klaar:</span>}
          {available.map((n) => (
            <button key={n} type="button" className="sd-pill" style={{ cursor: "pointer" }} disabled={!!busy} onClick={() => loadSet(n)}>
              {n}
            </button>
          ))}
        </div>
        {err && <div className="sd-alert" style={{ marginTop: 8 }}>{err}</div>}
        {planSet && (
          <>
            <div className="sd-muted small" style={{ marginTop: 8 }}>
              {planSet.note}
            </div>
            <div className="sd-list" style={{ marginTop: 8 }}>
              {stores
                .filter((s) => planSet.plans[s.domain])
                .map((s) => {
                  const p = planSet.plans[s.domain];
                  const on = included.some((x) => x.domain === s.domain);
                  const r = result[s.domain];
                  return (
                    <div key={s.domain} className="sd-list__row">
                      <span className={`sd-i ${r && (r.error || r.failed) ? "err" : r ? "ok" : on ? "warn" : ""}`}>{r ? (r.error || r.failed ? "✗" : "✓") : on ? "•" : "–"}</span>
                      <span className="sd-list__txt">
                        {shortName(s)} <span className="sd-muted">· {p.items.length} producten · {p.note}</span>
                        {!on && <span className="sd-muted"> · niet aangevinkt, wordt overgeslagen</span>}
                        {r && !r.error && (
                          <span className="sd-muted">
                            {" "}
                            · {r.dryRun ? `${r.fixed} zouden veranderen` : `${r.fixed} aangepast`} · {r.skipped} overgeslagen{r.failed ? ` · ${r.failed} mislukt` : ""}
                          </span>
                        )}
                        {r && r.error && <span className="sd-muted"> · fout: {r.error}</span>}
                      </span>
                    </div>
                  );
                })}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" className="sd-btn sd-btn--ghost" disabled={!!busy || !targets.length} onClick={() => runAll(true)}>
                {busy === "plan-check" ? "Controleren…" : "🔍 Controleer eerst"}
              </button>
              <button type="button" className="sd-btn sd-btn--gold" disabled={!!busy || !targets.length} onClick={() => runAll(false)}>
                {busy === "plan" ? "Bezig…" : `⚡ Zet ${totalItems} nieuwe prijzen door (${targets.length} stores)`}
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
