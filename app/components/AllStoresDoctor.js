"use client";

/* STORE DOCTOR · ALLE STORES (31-10-2026)
   Eén scherm voor alle gekoppelde stores:
   1. Controleer — werkt de koppeling, valuta, markt (store-profiel / jouw
      keuze / valuta), rechten van de app. Er verandert niets.
   2. Scan alle stores — per store score, fouten en waarschuwingen.
   3. Fix alle stores — per store precies dezelfde FIX ALLES als in het
      losse paneel (lib/doctor-engine.js): veilige fixes, optioneel de
      AI-controles, eindscan. Stores met een blokkerend probleem worden
      overgeslagen; een fout in één store stopt de rest niet.
   Verwijderen gebeurt nooit automatisch. Alles gaat eerst naar de backup-sheet. */

import { useEffect, useMemo, useRef, useState } from "react";
import { orgLS } from "@/lib/org-client";
import { useOrgDef } from "./OrgProvider";
import { MARKETS } from "@/lib/sizes";
import { CUR_MARKET, MARKET_CURRENCY, AI_LABEL, aiEstimate, postJSON, scanStore, fixAllStore } from "@/lib/doctor-engine";
import RunDashboard, { useRun, ScoreRing } from "./RunDashboard";

const LS_BACKUP = "sa_doctor_backup";
const LS_SCOPE = "sa_doctor_scope";
const LS_LATEST = "sa_doctor_latest";
const LS_MARKET = "sa_doctor_market::";
const LS_BARESYS = "sa_doctor_baresys::";
const LS_AI = "sa_doctor_all_ai";
const LS_SKIP = "sa_doctor_all_skip";
const WERKBOEK = "1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE";

const PHASES_ALL = [
  { key: "check", label: "Controle" },
  { key: "scan", label: "Scan" },
  { key: "fixes", label: "Fixes" },
  { key: "ai", label: "AI-controles" },
  { key: "final", label: "Eindscan" },
];

const ls = {
  get(k, d = "") {
    try {
      const v = orgLS.getItem(k);
      return v == null ? d : v;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      orgLS.setItem(k, v);
    } catch {}
  },
};

function bodyOf(s) {
  return { domain: s.domain, token: s.token, clientId: s.clientId, clientSecret: s.clientSecret, name: s.name, publicDomain: s.publicDomain };
}
function shortName(s) {
  return String(s.name || s.domain || "").replace(/\.myshopify\.com$/, "").slice(0, 24);
}

export default function AllStoresDoctor({ stores, onOpenStore }) {
  const orgDoc = useOrgDef().doctor;
  const { run, api: runApi } = useRun();
  const stopRef = useRef(false);
  const [pausing, setPausing] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [backupSheet, setBackupSheet] = useState("");
  const [scope, setScope] = useState("all");
  const [latestN, setLatestN] = useState("100");
  const [withAi, setWithAi] = useState(true);
  const [rows, setRows] = useState({}); // domain → { market, include, check, status, rep, repAt, verslag, error, usd, fixed }
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [openRow, setOpenRow] = useState({});

  // instellingen + markt per store (gedeeld met het losse paneel)
  useEffect(() => {
    setBackupSheet(ls.get(LS_BACKUP, WERKBOEK));
    const sc = ls.get(LS_SCOPE, "all");
    setScope(orgDoc.latestOnly ? "latest" : sc === "latest" ? "latest" : "all");
    const n = ls.get(LS_LATEST, "100");
    if (Number(n) > 0) setLatestN(n);
    setWithAi(ls.get(LS_AI, "1") !== "0");
    let skip = [];
    try {
      skip = JSON.parse(ls.get(LS_SKIP, "[]")) || [];
    } catch {}
    const next = {};
    for (const s of stores) {
      next[s.domain] = {
        market: ls.get(LS_MARKET + s.domain, "") || CUR_MARKET[String(s.currency || "").toUpperCase()] || "USA",
        marketSaved: !!ls.get(LS_MARKET + s.domain, ""),
        include: !skip.includes(s.domain),
        status: "idle",
      };
    }
    setRows(next);
  }, [stores.length]);

  const upd = (domain, patch) => setRows((cur) => ({ ...cur, [domain]: { ...(cur[domain] || {}), ...(typeof patch === "function" ? patch(cur[domain] || {}) : patch) } }));

  function setMarket(domain, m) {
    ls.set(LS_MARKET + domain, m);
    upd(domain, { market: m, marketSaved: true });
  }
  function toggleInclude(domain) {
    setRows((cur) => {
      const nx = { ...cur, [domain]: { ...cur[domain], include: !cur[domain].include } };
      ls.set(LS_SKIP, JSON.stringify(Object.keys(nx).filter((d) => !nx[d].include)));
      return nx;
    });
  }
  function pickScope(v) {
    setScope(v);
    ls.set(LS_SCOPE, v);
  }
  function pickLatest(v) {
    setLatestN(String(v));
    ls.set(LS_LATEST, String(v));
  }
  function pickAi(v) {
    setWithAi(v);
    ls.set(LS_AI, v ? "1" : "0");
  }
  function pause() {
    stopRef.current = true;
    setPausing(true);
    runApi.log("Pauze gevraagd — de lopende stap maakt netjes af, daarna stopt de run", "warn");
  }

  /* ---------- problemen per store (uit de controle) ---------- */
  function problemsOf(s, row) {
    const out = [];
    const c = row && row.check;
    if (!c) return out;
    for (const p of c.problems || []) out.push(p);
    if (!c.ok) return out;
    const scopes = c.scopes || [];
    if (scopes.length && !scopes.includes("write_products")) out.push({ level: "block", text: "app mist het recht write_products — fixes kunnen niet" });
    const cur = String(c.currency || s.currency || "").toUpperCase();
    const want = MARKET_CURRENCY[row.market] || [];
    if (cur && want.length && !want.includes(cur)) out.push({ level: "warn", text: `valuta ${cur} past niet bij markt ${row.market}` });
    if (c.profile && c.profile.market && c.profile.market !== row.market) {
      out.push({ level: "warn", text: `store-profiel zegt markt ${c.profile.market}, gekozen is ${row.market}` });
    }
    if (!c.profile) out.push({ level: "info", text: "geen store-profiel — markt komt uit jouw keuze/valuta" });
    if (scopes.length && (!scopes.includes("read_themes") || !scopes.includes("write_themes"))) {
      out.push({ level: "info", text: "geen thema-rechten — de maattabel-afronding in het thema wordt overgeslagen" });
    }
    return out;
  }

  const included = stores.filter((s) => rows[s.domain] && rows[s.domain].include);
  const scanParams = (s) => ({
    max: 1000,
    sinceISO: null,
    latest: scope === "latest" || orgDoc.latestOnly ? Math.max(1, Math.min(1000, Number(latestN) || 100)) : 0,
    vendorName: s.name || "",
    market: (rows[s.domain] || {}).market || "",
    bareSystem: ls.get(LS_BARESYS + s.domain, ""),
    sizeGuides: orgDoc.sizeGuides,
  });

  /* ---------- 1. CONTROLE ---------- */
  async function preflight(inRun) {
    const list = included;
    if (!list.length) throw new Error("vink minstens één store aan");
    if (inRun) runApi.phase("check", "Koppelingen, valuta en markten controleren");
    for (const s of list) upd(s.domain, { status: "checking" });
    const res = await postJSON("/api/doctor-stores", { stores: list.map(bodyOf) }, { tries: 3, onRetry: (n, why) => runApi.log(`${why} — opnieuw`, "warn") });
    if (!res.ok) throw new Error(`Controle mislukt: ${res.error}`);
    const byDomain = {};
    for (const c of res.data.stores || []) byDomain[c.domain] = c;
    // Eerst zelf uitrekenen (niet in de setRows-updater: React voert die soms pas
    // later uit, en dan was `merged` nog leeg → "reading 'check'" bij Fix alle stores).
    const merged = {};
    const now = rowsRef.current || {};
    for (const s of list) {
      const c = byDomain[s.domain] || { ok: false, problems: [{ level: "block", text: "geen antwoord voor deze store" }] };
      const row = { ...(now[s.domain] || {}), check: c, status: "idle" };
      // nog geen eigen markt-keuze? dan wint het store-profiel
      if (!row.marketSaved && c.profile && c.profile.market) row.market = c.profile.market;
      merged[s.domain] = row;
    }
    setRows((cur) => {
      const nx = { ...cur };
      for (const s of list) {
        const m = merged[s.domain];
        const row = { ...(nx[s.domain] || {}), check: m.check, status: "idle" };
        if (!row.marketSaved && m.check.profile && m.check.profile.market) row.market = m.check.profile.market;
        nx[s.domain] = row;
      }
      return nx;
    });
    let blocks = 0;
    let warns = 0;
    for (const s of list) {
      const pr = problemsOf(s, merged[s.domain]);
      blocks += pr.some((p) => p.level === "block") ? 1 : 0;
      warns += pr.filter((p) => p.level === "warn").length;
      const c = merged[s.domain].check;
      runApi.log(
        `${shortName(s)}: ${c.ok ? `koppeling ✓ · ${c.currency || s.currency || "?"} · markt ${merged[s.domain].market}` : "koppeling werkt niet"}${pr.length ? ` · ${pr.map((p) => p.text).join(" · ")}` : ""}`,
        pr.some((p) => p.level === "block") ? "err" : pr.some((p) => p.level === "warn") ? "warn" : "ok"
      );
    }
    return { merged, blocks, warns };
  }

  async function runCheck() {
    if (busy) return;
    setErr("");
    setBusy("check");
    stopRef.current = false;
    runApi.start("Controle · alle stores", { phases: [{ key: "check", label: "Controle" }], sub: `${included.length} store(s)` });
    try {
      const { blocks, warns } = await preflight(true);
      runApi.finish(blocks ? "error" : "done", blocks ? `${blocks} store(s) met een blokkerend probleem` : warns ? `Klaar — ${warns} aandachtspunt(en)` : "Alles staat goed");
    } catch (e) {
      setErr(String(e.message || e));
      runApi.finish("error");
    } finally {
      setBusy("");
    }
  }

  /* ---------- 2. SCAN ALLE STORES ---------- */
  async function scanAll(inRun, merged) {
    const list = included.filter((s) => !problemsOf(s, merged ? merged[s.domain] : rows[s.domain]).some((p) => p.level === "block"));
    const reps = {};
    runApi.phase("scan", "Stores scannen");
    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) break;
      const s = list[i];
      runApi.store(i + 1, list.length, shortName(s));
      runApi.step(`Scan ${shortName(s)}`, { i: i + 1, of: list.length, total: 0 });
      upd(s.domain, { status: "scanning", error: "" });
      try {
        const params = { ...scanParams(s), market: (merged ? merged[s.domain] : rows[s.domain]).market };
        const rep = await scanStore(bodyOf(s), params, { onRetry: (n, why) => runApi.log(`${shortName(s)}: ${why}`, "warn") });
        reps[s.domain] = rep;
        upd(s.domain, { status: "scanned", rep, repAt: Date.now(), before: rep.stats });
        runApi.log(`${shortName(s)}: ${rep.scanned} producten · ${rep.stats.errors} fouten · score ${String(rep.stats.score).replace(".", ",")}`, rep.stats.errors ? "warn" : "ok");
      } catch (e) {
        upd(s.domain, { status: "error", error: String(e.message || e) });
        runApi.log(`${shortName(s)}: ${String(e.message || e)}`, "err");
      }
    }
    return { list, reps };
  }

  async function runScanAll() {
    if (busy) return;
    setErr("");
    setBusy("scan");
    stopRef.current = false;
    setPausing(false);
    runApi.start("Scan · alle stores", { phases: [{ key: "check", label: "Controle" }, { key: "scan", label: "Scan" }], sub: `${included.length} store(s) · ${scope === "latest" ? `laatste ${latestN} producten` : "hele store"}` });
    try {
      const { merged } = await preflight(true);
      const { reps } = await scanAll(true, merged);
      const n = Object.keys(reps).length;
      runApi.finish(stopRef.current ? "paused" : "done", `${n} store(s) gescand`);
    } catch (e) {
      setErr(String(e.message || e));
      runApi.finish("error");
    } finally {
      setBusy("");
      setPausing(false);
    }
  }

  /* ---------- 3. FIX ALLE STORES ---------- */
  async function runFixAll() {
    if (busy) return;
    setErr("");
    const sheet = String(backupSheet || "").trim();
    if (!sheet && !window.confirm("Geen backup-sheet ingevuld. ZONDER backup alle stores fixen? (niet aan te raden)")) return;
    if (sheet) ls.set(LS_BACKUP, sheet);
    setBusy("fix");
    stopRef.current = false;
    setPausing(false);
    runApi.start("FIX ALLES · alle stores", { phases: PHASES_ALL, sub: `${included.length} store(s) · ${scope === "latest" ? `laatste ${latestN} producten` : "hele store"} · AI ${withAi ? "aan" : "uit"}` });
    let usdAll = 0;
    try {
      // a. controle + verse scan van alle stores
      const { merged, blocks } = await preflight(true);
      if (blocks) runApi.log(`${blocks} store(s) met een blokkerend probleem worden overgeslagen`, "warn");
      const { list, reps } = await scanAll(true, merged);
      const ready = list.filter((s) => reps[s.domain]);
      if (!ready.length) throw new Error("geen enkele store klaar om te fixen (zie de meldingen)");
      if (stopRef.current) return runApi.finish("paused");

      // b. bevestigen met echte cijfers
      const lines = ready.map((s) => {
        const r = reps[s.domain];
        const fixable = (r.findings || []).filter((f) => (f.fixes || []).some((x) => !x.danger)).reduce((a, f) => a + f.count, 0);
        return `• ${shortName(s)} (${merged[s.domain].market}): ${r.stats.errors} fouten · ±${fixable} automatisch te fixen · ${(r.productIds || []).length} producten`;
      });
      const prodTotal = ready.reduce((a, s) => a + (reps[s.domain].productIds || []).length, 0);
      const est = withAi ? ready.reduce((a, s) => a + aiEstimate((reps[s.domain].productIds || []).length), 0) : 0;
      const warnTxt = ready
        .map((s) => problemsOf(s, merged[s.domain]).filter((p) => p.level === "warn").map((p) => `• ${shortName(s)}: ${p.text}`))
        .flat();
      runApi.phase("fixes", "Wacht op jouw akkoord");
      const ok = window.confirm(
        `FIX ALLES op ${ready.length} store(s), ${prodTotal} producten:\n\n${lines.join("\n")}\n\n` +
          (withAi ? `AI-controles: AAN — geschat ±$${est.toFixed(2)} in totaal\n` : "AI-controles: UIT\n") +
          (warnTxt.length ? `\nLet op:\n${warnTxt.join("\n")}\n` : "") +
          `\nPer store: veilige fixes → ${withAi ? "AI-controles → " : ""}eindscan. Verwijderen doe ik nooit automatisch; alles gaat eerst naar de backup-sheet. Starten?`
      );
      if (!ok) {
        runApi.finish("paused", "Niet gestart — er is niets aangepast");
        return;
      }

      // c. per store FIX ALLES
      for (let i = 0; i < ready.length; i++) {
        if (stopRef.current) break;
        const s = ready[i];
        const row = merged[s.domain];
        const sn = shortName(s);
        runApi.store(i + 1, ready.length, sn);
        runApi.log(`━━ ${sn} (${row.market}) ━━`, "info");
        upd(s.domain, { status: "fixing", error: "" });
        let storeFixed = 0;
        let storeUsd = 0;
        const d = new Date();
        const stamp = `${d.getDate()}-${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
        try {
          const { verslag, report } = await fixAllStore({
            storeBody: bodyOf(s),
            scanParams: { ...scanParams(s), market: row.market },
            report: reps[s.domain],
            fixOptions: (extra) => ({ vendorName: s.name || "", pcts: [30, 40, 50], menTemplate: "men", market: row.market, bareSystem: ls.get(LS_BARESYS + s.domain, ""), ...(extra || {}) }),
            backupFor: (fixId) => (sheet ? { sheetId: sheet, tab: `Doctor ${sn} ${fixId} ${stamp}`.slice(0, 95) } : null),
            skipBackup: !sheet,
            withAi,
            sizeGuides: orgDoc.sizeGuides,
            hooks: {
              phase: (k, label) => {
                if (k !== "done") runApi.phase(k, `${sn}: ${label}`);
              },
              report: (rep) => upd(s.domain, { rep, repAt: Date.now() }),
              fixStart: (fix, n, fi, of) => {
                runApi.step(`${sn} · ${fix.label}`, { i: fi, of, total: n });
                return { label: fix.label, last: { fixed: 0, skipped: 0, failed: 0 } };
              },
              fixProgress: (hd, t) => {
                runApi.progress(t.done, t.total);
                runApi.count({ fixed: t.fixed - hd.last.fixed, skipped: t.skipped - hd.last.skipped, failed: t.failed - hd.last.failed });
                storeFixed += t.fixed - hd.last.fixed;
                hd.last = t;
                upd(s.domain, { fixed: storeFixed });
              },
              fixNotes: (hd, lines2) => {
                lines2.filter((l) => /MISLUKT|time-out|LET OP/i.test(l)).slice(0, 2).forEach((l) => runApi.log(`${sn} · ${hd.label}: ${l}`, "warn"));
              },
              fixDone: (hd, t, e) => {
                if (e) runApi.log(`${sn} · ${hd.label}: ${e} — door met de volgende stap`, "err");
                else runApi.log(`${sn} · ${hd.label}: ${t.fixed} aangepast · ${t.skipped} overgeslagen${t.failed ? ` · ${t.failed} mislukt` : ""}`, t.failed ? "warn" : "ok");
              },
              aiStart: (check, n) => runApi.step(`${sn} · ${AI_LABEL[check] || check}`, { total: n }),
              aiProgress: (check, dn, t) => runApi.progress(dn, t),
              aiDone: (check, out, e) => {
                if (e) runApi.log(`${sn} · ${AI_LABEL[check] || check}: ${e} — door`, "err");
                else {
                  storeUsd += out.usd;
                  usdAll += out.usd;
                  runApi.usd(usdAll);
                  upd(s.domain, { usd: storeUsd });
                  runApi.log(`${sn} · ${AI_LABEL[check] || check}: ${out.results.length ? `${out.results.length} gevonden` : out.skipped ? "niets gevonden" : "schoon"}${out.skipped ? ` · ${out.skipped} niet gecontroleerd (AI haperde)` : ""}`, out.results.length || out.skipped ? "warn" : "ok");
                }
              },
              log: (t, k) => runApi.log(`${sn}: ${t}`, k),
              retry: (n, why) => runApi.log(`${sn}: ${why}`, "warn"),
              shouldStop: () => stopRef.current,
            },
          });
          upd(s.domain, {
            status: verslag.paused ? "paused" : "done",
            verslag,
            rep: report,
            repAt: Date.now(),
            after: report && report.stats,
            usd: verslag.usd,
          });
          runApi.log(
            `${sn}: klaar — score ${verslag.before ? String(verslag.before.score).replace(".", ",") : "?"} → ${verslag.after ? String(verslag.after.score).replace(".", ",") : "?"} · fouten ${verslag.before ? verslag.before.errors : "?"} → ${verslag.after ? verslag.after.errors : "?"}`,
            "ok"
          );
        } catch (e) {
          upd(s.domain, { status: "error", error: String(e.message || e) });
          runApi.log(`${sn}: gestopt — ${String(e.message || e)} · ik ga door met de volgende store`, "err");
        }
      }
      runApi.finish(stopRef.current ? "paused" : "done", stopRef.current ? "Gepauzeerd" : "Alle stores klaar");
    } catch (e) {
      setErr(String(e.message || e));
      runApi.log(String(e.message || e), "err");
      runApi.finish("error");
    } finally {
      setBusy("");
      setPausing(false);
    }
  }

  /* ---------- RENDER ---------- */
  const totals = useMemo(() => {
    let errs = 0;
    let warnsN = 0;
    let prods = 0;
    let scanned = 0;
    for (const s of included) {
      const r = rows[s.domain] && rows[s.domain].rep;
      if (!r) continue;
      scanned++;
      errs += r.stats.errors;
      warnsN += r.stats.warns;
      prods += r.scanned || 0;
    }
    return { errs, warns: warnsN, prods, scanned };
  }, [rows, included.length]);

  const statusChip = (st) =>
    ({
      idle: ["", "klaar om te starten"],
      checking: ["busy", "controleren…"],
      scanning: ["busy", "scannen…"],
      scanned: ["ok", "gescand"],
      fixing: ["busy", "fixen…"],
      done: ["ok", "klaar"],
      paused: ["warn", "gepauzeerd"],
      error: ["err", "fout"],
    })[st || "idle"] || ["", st];

  return (
    <div className="sd sd-all">
      <RunDashboard run={run} pausing={pausing} onPause={pause} onClose={() => runApi.clear()} />

      <div className="sd-hero">
        <div className="sd-hero__left">
          <div className="sd-eyebrow">Store Doctor · alle stores</div>
          <div className="sd-hero__title">{stores.length} gekoppelde stores</div>
          <div className="sd-hero__meta">
            <span className="sd-pill">{included.length} geselecteerd</span>
            <span className="sd-pill">{scope === "latest" || orgDoc.latestOnly ? `laatste ${latestN} producten` : "hele store"}</span>
            <span className={`sd-pill${withAi ? " sd-pill--gold" : ""}`}>AI {withAi ? "aan" : "uit"}</span>
            <span className={`sd-pill${String(backupSheet || "").trim() ? " sd-pill--ok" : " sd-pill--warn"}`}>
              {String(backupSheet || "").trim() ? "backup aan" : "zonder backup"}
            </span>
          </div>
        </div>
        <div className="sd-hero__actions">
          <button className="sd-btn sd-btn--ghost" onClick={runCheck} disabled={!!busy || !included.length}>
            {busy === "check" ? "Controleren…" : "✓ Controleer"}
          </button>
          <button className="sd-btn sd-btn--ghost" onClick={runScanAll} disabled={!!busy || !included.length}>
            {busy === "scan" ? "Scannen…" : "🔍 Scan alle stores"}
          </button>
          <button className="sd-btn sd-btn--gold" onClick={runFixAll} disabled={!!busy || !included.length}>
            {busy === "fix" ? "Bezig…" : "⚡ Fix alle stores"}
          </button>
        </div>
      </div>
      {err && <div className="sd-alert">{err}</div>}

      <details className="sd-card sd-settings">
        <summary>
          <span className="sd-card__title" style={{ margin: 0 }}>Instellingen voor alle stores</span>
          <span className="sd-muted"> · backup, selectie, AI</span>
        </summary>
        <div className="sd-settings__body">
          <div className="field-label">Welke producten</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <div className="seg">
              {!orgDoc.latestOnly && (
                <button type="button" className={scope === "all" ? "on" : ""} onClick={() => pickScope("all")} disabled={!!busy}>
                  Hele store
                </button>
              )}
              <button type="button" className={scope === "latest" || orgDoc.latestOnly ? "on" : ""} onClick={() => pickScope("latest")} disabled={!!busy}>
                Laatste producten
              </button>
            </div>
            {(scope === "latest" || orgDoc.latestOnly) && (
              <input type="number" min={1} max={1000} value={latestN} onChange={(e) => pickLatest(e.target.value)} disabled={!!busy} style={{ width: 90 }} />
            )}
          </div>
          <div className="field-label">
            Backup-sheet <span className="opt">(oude waarden vóór elke fix — één tabblad per store per fix)</span>
          </div>
          <input type="text" value={backupSheet} placeholder="Sheet ID of URL" onChange={(e) => setBackupSheet(e.target.value)} disabled={!!busy} />
          <label className="sd-check">
            <input type="checkbox" checked={withAi} onChange={(e) => pickAi(e.target.checked)} disabled={!!busy} />
            <span>
              AI-controles meenemen bij Fix alle stores <span className="sd-muted">(foto-audit, geslacht, taal, watermerk, kleur↔foto — de kosten zie je vóór de start)</span>
            </span>
          </label>
        </div>
      </details>

      {totals.scanned > 0 && (
        <div className="sd-card sd-overview">
          <div className="sd-overview__tiles sd-overview__tiles--4">
            <div className="sd-tile">
              <span className="sd-tile__num">{totals.scanned}</span>
              <span className="sd-tile__lbl">stores gescand</span>
            </div>
            <div className="sd-tile">
              <span className="sd-tile__num">{totals.prods}</span>
              <span className="sd-tile__lbl">producten</span>
            </div>
            <div className={`sd-tile${totals.errs ? " sd-tile--err" : " sd-tile--ok"}`}>
              <span className="sd-tile__num">{totals.errs}</span>
              <span className="sd-tile__lbl">fouten</span>
            </div>
            <div className={`sd-tile${totals.warns ? " sd-tile--warn" : ""}`}>
              <span className="sd-tile__num">{totals.warns}</span>
              <span className="sd-tile__lbl">waarschuwingen</span>
            </div>
          </div>
        </div>
      )}

      <div className="sd-stores">
        {stores.map((s) => {
          const row = rows[s.domain] || {};
          const pr = problemsOf(s, row);
          const blocked = pr.some((p) => p.level === "block");
          const [chipCls, chipTxt] = statusChip(row.status);
          const rep = row.rep;
          const v = row.verslag;
          const isOpen = !!openRow[s.domain];
          const cur = (row.check && row.check.currency) || s.currency || "—";
          return (
            <div key={s.domain} className={`sd-store${row.include ? "" : " is-off"}${blocked ? " is-blocked" : ""}${row.status === "fixing" || row.status === "scanning" ? " is-live" : ""}`}>
              <div className="sd-store__main">
                <label className="sd-store__pick" title="Meenemen in de run">
                  <input type="checkbox" checked={!!row.include} onChange={() => toggleInclude(s.domain)} disabled={!!busy} />
                </label>
                <div className="sd-store__id">
                  <div className="sd-store__name">{s.name || s.domain}</div>
                  <div className="sd-store__dom">{(row.check && row.check.publicDomain) || s.domain}</div>
                </div>
                <div className="sd-store__meta">
                  <span className="sd-pill">{cur}</span>
                  <select className="sd-select" value={row.market || ""} onChange={(e) => setMarket(s.domain, e.target.value)} disabled={!!busy} title="Doelmarkt (stuurt maten en omrekening)">
                    {MARKETS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {row.check && row.check.profile ? (
                    <span className="sd-pill sd-pill--ok" title="Store-profiel in Attoh Tools">
                      profiel {row.check.profile.market}
                      {row.check.profile.genders ? ` · ${row.check.profile.genders === "MV" ? "M+V" : row.check.profile.genders}` : ""}
                    </span>
                  ) : null}
                </div>
                <div className="sd-store__score">
                  {rep ? <ScoreRing score={rep.stats.score} size={48} /> : <span className="sd-muted small">—</span>}
                </div>
                <div className="sd-store__nums">
                  {rep ? (
                    <>
                      <span className={rep.stats.errors ? "sd-err" : "sd-ok"}>{rep.stats.errors} fouten</span>
                      <span className="sd-muted">{rep.stats.warns} waarsch.</span>
                    </>
                  ) : (
                    <span className="sd-muted small">nog niet gescand</span>
                  )}
                  {row.fixed ? <span className="sd-ok">{row.fixed} aangepast</span> : null}
                  {row.usd ? <span className="sd-muted">AI ${row.usd.toFixed(2)}</span> : null}
                </div>
                <span className={`sd-chip sd-chip--${chipCls}`}>{blocked ? "geblokkeerd" : chipTxt}</span>
                <button type="button" className="sd-chev-btn" onClick={() => setOpenRow((o) => ({ ...o, [s.domain]: !o[s.domain] }))}>
                  {isOpen ? "▾" : "▸"}
                </button>
              </div>
              {pr.length > 0 && (
                <div className="sd-store__probs">
                  {pr.map((p, i) => (
                    <span key={i} className={`sd-prob sd-prob--${p.level}`}>
                      {p.level === "block" ? "✗" : p.level === "warn" ? "!" : "i"} {p.text}
                    </span>
                  ))}
                </div>
              )}
              {row.error ? <div className="sd-store__err">{row.error}</div> : null}
              {isOpen && (
                <div className="sd-store__more">
                  {v && v.before && v.after ? (
                    <div className="sd-delta">
                      <div>
                        <span className="sd-delta__lbl">Score</span>
                        <span className="sd-delta__val">
                          {String(v.before.score).replace(".", ",")} → <strong>{String(v.after.score).replace(".", ",")}</strong>
                        </span>
                      </div>
                      <div>
                        <span className="sd-delta__lbl">Fouten</span>
                        <span className="sd-delta__val">
                          {v.before.errors} → <strong>{v.after.errors}</strong>
                        </span>
                      </div>
                      <div>
                        <span className="sd-delta__lbl">AI</span>
                        <span className="sd-delta__val">${(v.usd || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  ) : null}
                  {rep ? (
                    <div className="sd-list">
                      {(rep.findings || []).slice(0, 8).map((f) => (
                        <div key={f.id} className="sd-list__row">
                          <span className={`sd-i ${f.level === "error" && !f.soft ? "err" : "warn"}`}>{f.level === "error" && !f.soft ? "✗" : "!"}</span>
                          <span className="sd-list__txt">
                            {f.title} <span className="sd-muted">· {f.count}×</span>
                          </span>
                        </div>
                      ))}
                      {(rep.findings || []).length === 0 && <div className="sd-empty">Alles schoon.</div>}
                      {(rep.findings || []).length > 8 && <div className="sd-muted small">… en {(rep.findings || []).length - 8} meer</div>}
                    </div>
                  ) : (
                    <div className="sd-muted small">Nog geen rapport — scan eerst.</div>
                  )}
                  {v && (v.open || []).length > 0 && (
                    <>
                      <div className="sd-list__head">Voor jou om te beslissen</div>
                      {v.open.map((t, i) => (
                        <div key={i} className="sd-list__row">
                          <span className="sd-i warn">!</span>
                          <span className="sd-list__txt">{t}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {v && (v.errors || []).length > 0 && (
                    <>
                      <div className="sd-list__head">Meldingen</div>
                      {v.errors.map((t, i) => (
                        <div key={i} className="sd-list__row">
                          <span className="sd-i err">✗</span>
                          <span className="sd-list__txt">{t}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {onOpenStore ? (
                    <button type="button" className="sd-btn sd-btn--small" style={{ marginTop: 10 }} onClick={() => onOpenStore(s.domain)}>
                      Open in de losse Store Doctor ↓
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
