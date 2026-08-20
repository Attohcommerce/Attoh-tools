"use client";

/* STORE DOCTOR PANEL — één paneel, twee plekken:
   - /qa (Store Doctor): hele store scannen + fixen, welke store dan ook
   - Importer → "Controles": zelfde motor, gescoped op de zojuist
     geïmporteerde producten (created_at-filter)

   Twee manieren van werken:
   1. Per onderdeel: Scan → rapport per categorie → 1-tik-fix per punt,
      AI-checks als losse knoppen met kostenraming vooraf.
   2. FIX ALLES: één knop die alle veilige fixes én alle AI-controles in
      logische volgorde draait (gender wordt op titel + omschrijving + foto
      beoordeeld en direct toegepast) en eindigt met een eindverslag.
      Pauzeerbaar; verwijderen gebeurt NOOIT automatisch — dat komt als
      beslissing in het verslag. */

import { useEffect, useRef, useState } from "react";
import { MARKETS, MARKET_SIZE_GUIDE } from "@/lib/sizes";

const LS_BACKUP = "sa_doctor_backup";
const LS_MARKET = "sa_doctor_market::"; // + store-domein
const WERKBOEK = "1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE"; // Import-werkboek (default)

// Slimme default: de store-valuta verraadt de markt
const CUR_MARKET = { USD: "USA", GBP: "UK", AUD: "AUS+NZ", NZD: "AUS+NZ", CAD: "CAN" };

// Chunk per AI-check (server verwerkt per call precies dit plukje).
// Gender staat op 6: grondige modus met foto's — titel + omschrijving +
// eerste productfoto per product.
const AI_CHUNK = { gender: 6, language: 25, "color-photo": 8, watermark: 4, sample: 12 };
// Ruwe kostenraming per product (haiku-tarieven) — alleen voor de knop-tekst
const AI_EST = { gender: 0.002, language: 0.0007, "color-photo": 0.002, watermark: 0.004 };
const AI_META = {
  gender: { label: "Geslacht-check (grondig)", desc: "Beoordeelt élk product op titel + omschrijving + foto: Men of Women — vangt ook producten die in beide collecties hangen" },
  "color-photo": { label: "Kleur ↔ foto-check", desc: "Toont de gekoppelde foto écht de kleur van de variant? (per kleurgroep beoordeeld)" },
  watermark: { label: "Watermerk/branding-check", desc: "Logo's, watermerken of tekst op bestaande productfoto's" },
  language: { label: "AI-taalcheck", desc: "Vindt vreemde taal die het woordenboek mist" },
  sample: { label: "AI-steekproef — patronen", desc: "12 producten uit alle hoeken in samenhang; zoekt fouten die zich herhalen (groot model)" },
};

/* FIX ALLES — volgorde van de automatische fase. Bewust logisch geordend:
   eerst foto's her-koppelen (voedt alt-teksten), dan gender (voedt de
   template-fixes), dan taal/maten, dan de rest. Verwijder-acties zitten er
   NOOIT in — die landen in het eindverslag. */
const FIXALL_ORDER = [
  "relink-photos",
  "fix-gender-from-title",
  "translate-options",
  "convert-sizes",
  "clear-barcodes",
  "set-vendor",
  "set-product-type",
  "fill-alt",
  "fix-size-order",
  "fix-men-template",
  "fix-women-template",
  "publish-products",
  "fix-compareat",
  "clean-titles",
];

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
  const [verslag, setVerslag] = useState(null); // eindverslag van FIX ALLES

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

  async function scan(opts = {}) {
    if (!store) return null;
    setBusy(true);
    setErr("");
    if (!opts.keepAi) {
      setRep(null);
      setAiRes({});
      setAiUsd({});
    }
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
      if (!opts.silent) sfx(data.stats.errors ? "error" : "success");
      return data;
    } catch (e) {
      setErr(String(e.message || e));
      return null;
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
      // teller verversen — AI-resultaten blijven staan voor vervolg-acties
      await scan({ keepAi: true, silent: true });
    } catch (e) {
      setErr(`Fix gestopt: ${String(e.message || e)}`);
      sfx("error");
    } finally {
      setFixBusy(null);
      setFixProg(null);
    }
  }

  /* ================= FIX ALLES =================
     Eén knop die alles doet wat veilig kan, in logische volgorde, en al het
     overige expliciet in een eindverslag zet — er wordt niets stilzwijgend
     overgeslagen én niets verwijderd:
       1. scan (als die er nog niet is)
       2. alle veilige fixes (FIXALL_ORDER, incl. gender-uit-titel en de
          maten-omrekening naar de gekozen markt)
       3. alle AI-controles over de hele selectie; het geslacht-oordeel
          (titel + omschrijving + foto) wordt direct toegepast
       4. verse scan + eindverslag: wat is gefixt, wat vond de AI, en welke
          beslissingen (verwijderen etc.) aan jou zijn
     Pauzeren kan altijd: de lopende stap maakt netjes af, daarna sta je
     weer in het gewone scherm om per onderdeel verder te werken; nóg een
     keer FIX ALLES pakt gewoon op waar het bleef (gefixte punten komen
     niet terug uit de scan). */
  async function fixAll() {
    if (!store || fixBusy || busy || aiBusy) return;
    const n = rep ? (rep.productIds || []).length : Number(max) || 1000;
    const aiEst = (n * (AI_EST.gender + AI_EST.language + AI_EST.watermark + AI_EST["color-photo"]) + 0.05).toFixed(2);
    const zeker = window.confirm(
      `FIX ALLES over ${rep ? n : "max " + n} producten (markt: ${market || "—"}):\n\n` +
        `1. Alle veilige fixes — foto's her-koppelen, gender uit titel (incl. dubbele Men+Women-tags), opties vertalen, maten omrekenen, barcodes, vendor, product type, alt-teksten, maten-volgorde, templates, publiceren, doorstreepprijzen, titels opschonen\n` +
        `2. Alle AI-controles (geschat ±$${aiEst}) — geslacht op titel+omschrijving+foto (wordt direct toegepast), taal, watermerk, kleur↔foto, steekproef\n` +
        `3. Eindverslag — verwijderen doe ik NOOIT automatisch; dat komt als beslissing in het verslag\n\n` +
        `Pauzeren kan altijd; daarna werk je gewoon per onderdeel verder. Starten?`
    );
    if (!zeker) return;
    const b = askBackupSkip();
    if (!b.ok) return;
    setFixBusy("all");
    setErr("");
    setVerslag(null);
    setFixNotes([]);
    stopRef.current = false;
    const V = { auto: [], ai: [], open: [], usd: 0, paused: false };
    try {
      let report = rep || (await scan({ silent: true }));
      if (!report) throw new Error("scan mislukt");

      /* FASE 1 — veilige fixes in logische volgorde */
      const jobs = new Map();
      for (const f of report.findings) {
        for (const fx of f.fixes || []) {
          if (!FIXALL_ORDER.includes(fx.id)) continue;
          if (!jobs.has(fx.id)) jobs.set(fx.id, { fix: fx, ids: new Set() });
          for (const id of f.ids) jobs.get(fx.id).ids.add(id);
        }
      }
      for (const fid of FIXALL_ORDER) {
        if (stopRef.current) break;
        const j = jobs.get(fid);
        if (!j) continue;
        const tot = await execFix(j.fix, [...j.ids], fixOptions(), b.skipBackup);
        V.auto.push({ label: j.fix.label, fixed: tot.fixed, skipped: tot.skipped, failed: tot.failed });
      }

      /* FASE 2 — AI-controles over de hele selectie */
      setFixProg(null); // voortgang is nu zichtbaar bij de AI-knoppen zelf
      const allIds = report.productIds || [];
      if (!stopRef.current && allIds.length) {
        const g = await runAiCore("gender", allIds);
        V.usd += g.usd;
        if (g.results.length) {
          const labels = {};
          for (const m of g.results) labels[String(m.id)] = m.suggested;
          const tot = await execFix(
            { id: "gender-tags", label: "Gender rechtzetten (AI: titel + omschrijving + foto)" },
            g.results.map((m) => m.id),
            fixOptions({ labels }),
            b.skipBackup
          );
          V.ai.push(`Geslacht: ${g.results.length} product(en) fout ingedeeld → ${tot.fixed} rechtgezet, incl. dubbele Men+Women-tags`);
        } else {
          V.ai.push(stopRef.current ? "Geslacht: gepauzeerd vóór er resultaten waren" : "Geslacht: alle producten kloppen (titel + omschrijving + foto beoordeeld)");
        }
      }
      const AI_REST = [
        ["language", (nr) => (nr ? `AI-taalcheck: ${nr} product(en) met vreemde taal — lijst staat hieronder (handwerk)` : "AI-taalcheck: alles Engels")],
        ["watermark", (nr) => (nr ? `Watermerk-check: ${nr} foto('s) geflagd — verwijder-knop staat hieronder (jouw beslissing)` : "Watermerk-check: schoon")],
        ["color-photo", (nr) => (nr ? `Kleur↔foto: ${nr} afwijking(en) — lijst staat hieronder` : "Kleur↔foto: klopt")],
        ["sample", (nr) => (nr ? `Steekproef: ${nr} patroon/patronen gevonden — zie hieronder` : "Steekproef: geen terugkerende fouten")],
      ];
      for (const [check, lijn] of AI_REST) {
        if (stopRef.current) break;
        const out = await runAiCore(check, allIds);
        V.usd += out.usd;
        V.ai.push(lijn(out.results.length));
      }

      V.paused = stopRef.current;

      /* FASE 3 — eindstand + open beslissingen (niets valt stil weg) */
      const fresh = await scan({ keepAi: true, silent: true });
      if (fresh) {
        for (const f of fresh.findings) {
          const danger = (f.fixes || []).some((x) => x.danger);
          if (danger) V.open.push(`${f.title}: nog ${f.count} — verwijder-knop staat in het rapport; dat doe ik nooit automatisch`);
          else if (f.level === "error") V.open.push(`${f.title}: nog ${f.count} — zie het rapport hieronder`);
        }
        if (!V.open.length) V.open.push("Geen open fouten meer — loop hooguit de waarschuwingen in het rapport na.");
      }
      setVerslag(V);
      sfx(V.paused ? "toggle" : "success");
    } catch (e) {
      V.paused = true;
      setVerslag(V);
      setErr(`FIX ALLES gestopt: ${String(e.message || e)} — hieronder kun je per onderdeel verder.`);
      sfx("error");
    } finally {
      setFixBusy(null);
      setFixProg(null);
      setAiBusy(null);
      setAiProg("");
    }
  }

  /* ---------------- AI-CHECKS ---------------- */

  // Kern van een AI-check: de chunk-loop, zonder bevestiging — gedeeld
  // tussen de losse knoppen en FIX ALLES. Resultaten streamen live naar
  // de UI; pauzeren (stopRef) stopt na het lopende plukje.
  async function runAiCore(check, idsAll) {
    let ids = idsAll || [];
    if (check === "sample") {
      // 12 producten gelijk verspreid over de catalogus
      const step = Math.max(1, Math.floor(ids.length / 12));
      ids = ids.filter((_, i) => i % step === 0).slice(0, 12);
    }
    setAiBusy(check);
    setFixProg(null); // AI-voortgang is zichtbaar op de check-knop zelf
    const chunk = AI_CHUNK[check];
    const all = [];
    let usd = 0;
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
    setAiProg("");
    return { results: all, usd };
  }

  async function runAi(check) {
    if (!store || !rep || aiBusy || fixBusy || busy) return;
    const baseIds = rep.productIds || [];
    if (!baseIds.length) return;
    const cnt = check === "sample" ? Math.min(12, baseIds.length) : baseIds.length;
    const est = check === "sample" ? "0.05" : (AI_EST[check] * cnt).toFixed(2);
    const zeker = window.confirm(
      `${AI_META[check].label} over ${cnt} producten — geschat ±$${est} aan AI-kosten. Starten?`
    );
    if (!zeker) return;
    setErr("");
    stopRef.current = false;
    try {
      const out = await runAiCore(check, baseIds);
      sfx(out.results.length ? "error" : "success");
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

      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={() => scan()} disabled={disabled}>
          {busy ? "Scannen…" : "✚ Scan producten"}
        </button>
        <button
          className="btn"
          onClick={fixAll}
          disabled={disabled}
          title="Scant (indien nodig), draait alle veilige fixes én alle AI-controles in logische volgorde, en eindigt met een verslag. Verwijderen blijft altijd aan jou."
        >
          {fixBusy === "all" ? "FIX ALLES bezig…" : "⚡ FIX ALLES"}
        </button>
        {(fixBusy || aiBusy) && (
          <button className="btn-ghost btn-small" onClick={() => { stopRef.current = true; }}>
            {fixBusy === "all" ? "⏸ Pauzeer — daarna per onderdeel verder" : "■ Stop na deze stap"}
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

      {verslag && !fixProg && (
        <div className="prog-card" style={{ marginTop: 12 }}>
          <div className="prog-top">
            <span className="prog-title">
              Eindverslag FIX ALLES{verslag.paused ? " — gepauzeerd" : ""}
            </span>
            <span className="prog-count">AI ±${verslag.usd.toFixed(2)}</span>
          </div>
          {verslag.paused && (
            <div className="hint" style={{ marginTop: 4 }}>
              Gepauzeerd — hieronder werk je gewoon per onderdeel verder. Nóg een keer FIX ALLES
              pakt op waar het bleef (wat al gefixt is, komt niet terug uit de scan).
            </div>
          )}
          <div className="logpanel" style={{ marginTop: 8 }}>
            {verslag.auto.map((a, i) => (
              <div className="log" key={"a" + i}>
                <span className={a.failed ? "warn" : "ok"}>✓</span>
                <span style={{ flex: 1 }}>
                  {a.label}: {a.fixed} aangepast · {a.skipped} overgeslagen
                  {a.failed ? ` · ${a.failed} mislukt` : ""}
                </span>
              </div>
            ))}
            {verslag.ai.map((t, i) => (
              <div className="log" key={"i" + i}>
                <span className="ok">✦</span>
                <span style={{ flex: 1 }}>{t}</span>
              </div>
            ))}
            {verslag.open.length > 0 && (
              <>
                <div className="field-label">Voor jou om te beslissen</div>
                {verslag.open.map((t, i) => (
                  <div className="log" key={"o" + i}>
                    <span className="warn">!</span>
                    <span style={{ flex: 1 }}>{t}</span>
                  </div>
                ))}
              </>
            )}
            {!verslag.auto.length && !verslag.ai.length && (
              <div className="center-note">Niets te fixen gevonden.</div>
            )}
          </div>
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
