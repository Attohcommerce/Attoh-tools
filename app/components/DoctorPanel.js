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
import { MARKETS, MARKET_SIZE_GUIDE, BARE_SYSTEMS } from "@/lib/sizes";
import { orgLS } from "@/lib/org-client";
import { useOrgDef } from "./OrgProvider";
import { isShapesWardrobe, SW_TYPE_SHEET } from "@/lib/sw-product-types";
import { mergePlanItems, groupCounts, planMatchesStore } from "@/lib/change-plan";
import { AI_EST, CUR_MARKET, aiEstimate, scanStore, runFixLoop, runAiLoop, fixAllStore, titleSex } from "@/lib/doctor-engine";
import RunDashboard, { useRun, ScoreRing } from "./RunDashboard";

const LS_BACKUP = "sa_doctor_backup";
const LS_SCOPE = "sa_doctor_scope"; // "all" | "latest"
const LS_LATEST = "sa_doctor_latest"; // aantal nieuwste producten (max 1000)
const LATEST_CHOICES = [50, 100, 250, 500, 1000];
const LS_MARKET = "sa_doctor_market::"; // + store-domein
const LS_BARESYS = "sa_doctor_baresys::"; // + store-domein — wat kale maat-nummers zijn (us/uk/au/eu)
const WERKBOEK = "1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE"; // Import-werkboek (default)

// CUR_MARKET, AI_CHUNK, AI_EST en FIXALL_ORDER staan sinds 31-10 in lib/doctor-engine.js
// (gedeeld met "Alle stores").
const AI_META = {
  "photo-audit": { label: "Foto-audit (streng) — geslacht + collectie", desc: "Kijkt alleen naar de foto: man op de foto bij een Women's-product (of andersom) = misgenderd; jas/longsleeve in Tank Tops = verkeerde collectie" },
  gender: { label: "Geslacht-check (grondig)", desc: "Beoordeelt élk product op titel + omschrijving + foto: Men of Women — vangt ook producten die in beide collecties hangen" },
  "color-photo": { label: "Kleur ↔ foto-check", desc: "Toont de gekoppelde foto écht de kleur van de variant? (per kleurgroep beoordeeld)" },
  watermark: { label: "Watermerk/branding-check", desc: "Logo's, watermerken of tekst op bestaande productfoto's" },
  language: { label: "AI-taalcheck", desc: "Vindt vreemde taal die het woordenboek mist" },
  sample: { label: "AI-steekproef — patronen", desc: "12 producten uit alle hoeken in samenhang; zoekt fouten die zich herhalen (groot model)" },
};

/* FIX ALLES — de volgorde staat in lib/doctor-engine.js (FIXALL_ORDER). Verwijder-
   acties zitten er NOOIT in — die landen in het eindverslag. */

function sfx(kind) {
  try {
    window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: kind }));
  } catch {}
}

export default function DoctorPanel({ store, since }) {
  const [max, setMax] = useState("1000");
  // 19-10: "hele store" of "laatste N producten" (actief + draft, nieuwste eerst, max 1000)
  const [scope, setScope] = useState("all");
  const [latestN, setLatestN] = useState("100");
  const [useSince, setUseSince] = useState(true);
  /* Organisatie (20-10-2026, lib/org.js): Sa Collective scant ALLEEN de
     laatste N producten (nieuw toegevoegd) en laat maattabellen volledig
     buiten de Doctor (geen metafield-check, geen size-guide-fix). */
  const orgDoc = useOrgDef().doctor;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rep, setRep] = useState(null);
  const [open, setOpen] = useState({});
  const [backupSheet, setBackupSheet] = useState("");

  const [fixBusy, setFixBusy] = useState(null); // "findingId|fixId"
  const [fixProg, setFixProg] = useState(null); // {done,total,fixed,failed,skipped}
  // Fix-log als BLOKKEN per fix (i.p.v. één doorlopende brij): kop met
  // ✓/⚠ + samenvatting, details ingeklapt eronder.
  const [fixLog, setFixLog] = useState([]);
  const blockSeq = useRef(0);
  const stopRef = useRef(false);
  const [repAt, setRepAt] = useState(null);
  // Live dashboard (31-10): wat doet de Doctor nu, hoe ver, hoe lang nog
  const { run, api: runApi } = useRun();
  const [pausing, setPausing] = useState(false);
  const [flt, setFlt] = useState("all"); // rapport-filter: all | error | warn
  function pause() {
    stopRef.current = true;
    setPausing(true);
    runApi.log("Pauze gevraagd — de lopende stap maakt netjes af", "warn");
  }
  const isAlarm = (l) => /MISLUKT|time-out|LET OP|gestopt|mislukt/i.test(String(l));

  function newBlock(label, total) {
    const id = ++blockSeq.current;
    setFixLog((cur) => [{ id, label, total, status: "busy", sum: "", failed: 0, open: false, details: [] }, ...cur].slice(0, 16));
    return id;
  }
  function blockDetail(id, lines) {
    if (!lines || !lines.length) return;
    setFixLog((cur) => cur.map((b) => (b.id === id ? { ...b, details: [...b.details, ...lines].slice(0, 80) } : b)));
  }
  function blockDone(id, sum, failed) {
    setFixLog((cur) => cur.map((b) => (b.id === id ? { ...b, status: "done", sum, failed: failed || 0 } : b)));
  }
  function toggleBlock(id) {
    setFixLog((cur) => cur.map((b) => (b.id === id ? { ...b, open: !b.open } : b)));
  }

  const [aiBusy, setAiBusy] = useState(null);
  const [aiProg, setAiProg] = useState("");
  const [aiRes, setAiRes] = useState({});
  const [aiUsd, setAiUsd] = useState({});
  const [verslag, setVerslag] = useState(null); // eindverslag van FIX ALLES
  const [pricePlan, setPricePlan] = useState(null); // goedgekeurd prijsplan (public/price-plans)
  const [planName, setPlanName] = useState("");
  // Wijzigingsplan (31-10): algemene fixes van Claude (public/change-plans)
  const [cp, setCp] = useState(null);
  const [cpName, setCpName] = useState("");
  const [cpSel, setCpSel] = useState([]);
  const [cpIndex, setCpIndex] = useState([]);
  const [cpCheck, setCpCheck] = useState(null);
  useEffect(() => {
    fetch("/change-plans/index.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCpIndex(Array.isArray(d && d.plans) ? d.plans : []))
      .catch(() => {});
  }, []);

  const [market, setMarket] = useState("");
  const [bareSystem, setBareSystem] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  /* SHAPES WARDROBE (23-10): producttypes van Cas (media buyer). Alleen bij SW
     zichtbaar: losse knop + standaard vóór elke scan. */
  const isSW = isShapesWardrobe(store);
  const [swFirst, setSwFirst] = useState(true);
  const [swInfo, setSwInfo] = useState("");

  useEffect(() => {
    try {
      const v = orgLS.getItem(LS_BACKUP);
      setBackupSheet(v != null ? v : WERKBOEK);
    } catch {
      setBackupSheet(WERKBOEK);
    }
    try {
      const sc = orgLS.getItem(LS_SCOPE);
      if (sc === "all" || sc === "latest") setScope(sc);
      const n = orgLS.getItem(LS_LATEST);
      if (n && Number(n) > 0) setLatestN(n);
    } catch {}
    if (orgDoc.latestOnly) setScope("latest");
  }, []);

  function pickScope(v) {
    setScope(v);
    try {
      orgLS.setItem(LS_SCOPE, v);
    } catch {}
  }
  function pickLatest(v) {
    const raw = String(v).replace(/\D/g, "");
    const n = raw ? String(Math.min(1000, Number(raw))) : "";
    setLatestN(n);
    try {
      if (n) orgLS.setItem(LS_LATEST, n);
    } catch {}
  }
  const runScoped = !!(since && useSince); // importer: alleen de import-run
  const latestOn = (scope === "latest" || orgDoc.latestOnly) && !runScoped;

  // Markt per store onthouden; eerste keer afgeleid uit de valuta
  useEffect(() => {
    if (!store || !store.domain) return;
    let v = "";
    try {
      v = orgLS.getItem(LS_MARKET + store.domain) || "";
    } catch {}
    setMarket(v || CUR_MARKET[String(store.currency || "").toUpperCase()] || "USA");
    let b = "";
    try {
      b = orgLS.getItem(LS_BARESYS + store.domain) || "";
    } catch {}
    setBareSystem(b);
  }, [store && store.domain]);

  function pickMarket(m) {
    setMarket(m);
    try {
      orgLS.setItem(LS_MARKET + store.domain, m);
    } catch {}
  }
  function pickBareSystem(v) {
    setBareSystem(v);
    try {
      orgLS.setItem(LS_BARESYS + (store && store.domain), v);
    } catch {}
  }

  const storeBody = store
    ? { domain: store.domain, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret, name: store.name }
    : null;
  const adminUrl = (id) => `https://${store.domain}/admin/products/${id}`;

  /* ---------------- SCAN ---------------- */

  // Scan-parameters (zelfde selectie voor scan, FIX ALLES en de eindscan)
  function scanParamsNow() {
    return {
      max: Number(max) || 1000,
      sinceISO: since && useSince ? since : null,
      latest: latestOn ? Math.max(1, Math.min(1000, Number(latestN) || 100)) : 0,
      vendorName: store.name || "",
      market,
      bareSystem,
      sizeGuides: orgDoc.sizeGuides, // false (Sa Collective) = maattabellen niet ophalen/checken
    };
  }

  // opts: keepAi (AI-resultaten laten staan) · silent (geen geluid) · inRun (geen eigen dashboard)
  async function scan(opts = {}) {
    if (!store) return null;
    setBusy(true);
    setErr("");
    if (!opts.keepAi) {
      setRep(null);
      setAiRes({});
      setAiUsd({});
    }
    const own = !opts.inRun && !opts.silent;
    if (own) runApi.start(`Scan · ${store.name || store.domain}`, { phases: [{ key: "scan", label: "Scan" }], sub: `markt ${market || "—"}` });
    try {
      const data = await scanStore(storeBody, scanParamsNow(), {
        onRetry: (n, why) => runApi.log(`${why}${n ? ` — opnieuw (${n + 1})` : ""}`, "warn"),
      });
      setRep(data);
      setRepAt(new Date());
      runApi.log(`Scan klaar: ${data.scanned} producten · ${data.stats.errors} fouten · score ${String(data.stats.score).replace(".", ",")}`, data.stats.errors ? "warn" : "ok");
      if (data.partial && data.partial.length) runApi.log(`Let op: ${data.partial.join(" · ")}`, "warn");
      if (!opts.silent) sfx(data.stats.errors ? "error" : "success");
      if (own) runApi.finish("done", "Scan klaar");
      return data;
    } catch (e) {
      setErr(String(e.message || e));
      runApi.log(String(e.message || e), "err");
      if (own) runApi.finish("error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- FIXES ---------------- */

  // Standaard-opties die élke fix meekrijgt (markt voor de maten-conversie,
  // storenaam voor de vendor-fix, kortingsmix voor de doorstreepprijzen).
  function fixOptions(extra) {
    return { vendorName: store.name || "", pcts: [30, 40, 50], menTemplate: "men", market, bareSystem, ...(extra || {}) };
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
        orgLS.setItem(LS_BACKUP, backupSheet.trim());
      } catch {}
      return { ok: true, skipBackup: false };
    }
    const skip = window.confirm("Geen backup-sheet ingevuld. ZONDER backup doorgaan? (niet aan te raden bij verwijder-fixes)");
    return { ok: skip, skipBackup: skip };
  }

  // Kern: één fix over een id-lijst, in stappen tot klaar (lib/doctor-engine.js:
  // time-outs → opnieuw en kleinere stap; één hardnekkig product → overslaan).
  // Gooit alleen bij een échte fout (bv. backup-sheet niet bereikbaar).
  async function execFix(fix, ids, options, skipBackup) {
    const backup = skipBackup ? null : backupPlanFor(fix.id);
    const blockId = newBlock(fix.label, ids.length);
    runApi.step(fix.label, { total: ids.length });
    let last = { fixed: 0, skipped: 0, failed: 0 };
    setFixProg({ done: 0, total: ids.length, fixed: 0, failed: 0, skipped: 0, label: fix.label });
    let tot;
    try {
      tot = await runFixLoop(storeBody, fix, ids, {
        options,
        backup,
        skipBackup,
        shouldStop: () => stopRef.current,
        onProgress: (t) => {
          setFixProg({ ...t, label: fix.label });
          runApi.progress(t.done, t.total);
          runApi.count({ fixed: t.fixed - last.fixed, skipped: t.skipped - last.skipped, failed: t.failed - last.failed });
          last = t;
        },
        onNotes: (lines) => {
          blockDetail(blockId, lines);
          lines.filter(isAlarm).slice(0, 3).forEach((l) => runApi.log(`${fix.label}: ${l}`, "warn"));
        },
      });
    } catch (e) {
      const msg = String(e.message || e);
      blockDone(blockId, `gestopt: ${msg.slice(0, 120)}`, 1);
      runApi.log(`${fix.label} gestopt: ${msg}`, "err");
      throw e;
    }
    const backupTxt = backup ? ` · backup "${backup.tab}"` : " · zonder backup";
    let sum;
    if (options && options.dryRun) {
      sum = `controle: ${tot.fixed} zouden veranderen · ${tot.skipped} al goed of overgeslagen · ${tot.failed} mislukt — er is niets aangepast`;
    } else {
      sum = `${tot.fixed} aangepast · ${tot.skipped} overgeslagen · ${tot.failed} mislukt${backupTxt}${tot.stopped ? " · gepauzeerd" : ""}`;
    }
    blockDone(blockId, sum, tot.failed);
    runApi.log(`${fix.label}: ${sum}`, tot.failed ? "warn" : "ok");
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
    setFixLog([]);
    setErr("");
    stopRef.current = false;
    setPausing(false);
    runApi.start(fix.label, { phases: [{ key: "fixes", label: "Fix" }, { key: "final", label: "Herscan" }], sub: `${ids.length} product(en) · ${store.name || store.domain}` });
    runApi.phase("fixes", fix.label);
    try {
      const tot = await execFix(fix, ids, fixOptions(extraOptions), b.skipBackup);
      sfx(tot.failed ? "error" : "success");
      // teller verversen — AI-resultaten blijven staan voor vervolg-acties
      runApi.phase("final", "Rapport verversen");
      await scan({ keepAi: true, silent: true, inRun: true });
      runApi.finish(stopRef.current ? "paused" : "done");
    } catch (e) {
      setErr(`Fix gestopt: ${String(e.message || e)}`);
      runApi.finish("error");
      sfx("error");
    } finally {
      setFixBusy(null);
      setFixProg(null);
      setPausing(false);
    }
  }

  /* ============ PRIJSPLAN TOEPASSEN (30-10) ============
     Een goedgekeurd plan (public/price-plans/<naam>.json, gemaakt door Claude
     uit de prijsvoorstel-sheet) via de gewone Doctor-fix "set-prices":
     chunks, tijdbudget, backup-tabblad — en producten waarvan de prijs
     intussen handmatig is veranderd worden overgeslagen. */
  async function loadPricePlan() {
    const name = String(planName || "").trim().replace(/\.json$/i, "");
    if (!name) return;
    setErr("");
    try {
      const r = await fetch(`/price-plans/${encodeURIComponent(name)}.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(`plan "${name}" niet gevonden (${r.status})`);
      const plan = await r.json();
      if (!Array.isArray(plan.items) || !plan.items.length) throw new Error("plan is leeg");
      setPricePlan(plan);
    } catch (e) {
      setPricePlan(null);
      setErr(`Prijsplan: ${String(e.message || e)}`);
    }
  }

  function applyPricePlan() {
    if (!pricePlan || !store) return;
    const hay = `${store.name || ""} ${store.domain || ""} ${store.publicDomain || ""}`.toLowerCase();
    const want = String(pricePlan.domain || "").toLowerCase().replace(/\.(com|co\.uk|com\.au)$/, "");
    if (want && !hay.includes(want.replace(/[^a-z0-9]/g, "").slice(0, 8)) && !hay.replace(/[^a-z0-9]/g, "").includes(want.replace(/[^a-z0-9]/g, ""))) {
      if (!window.confirm(`Dit plan is voor ${pricePlan.store || pricePlan.domain}, maar de gekozen store is ${store.name || store.domain}. Toch doorgaan?`)) return;
    }
    if (!window.confirm(`${pricePlan.items.length} producten krijgen een nieuwe prijs (${pricePlan.note || pricePlan.store}). Starten?`)) return;
    const prices = {};
    for (const it of pricePlan.items) prices[String(it.id)] = { price: it.price, compareAt: it.compareAt, from: it.from };
    runFix("price-plan", { id: "set-prices", label: `Prijsplan ${pricePlan.store || ""} ${pricePlan.date || ""}`.trim() }, pricePlan.items.map((it) => it.id), { prices });
  }

  /* ============ WIJZIGINGSPLAN TOEPASSEN (31-10) ============
     Algemene fixes over de hele store (geslacht, tags, producttype, optie-
     namen/-waarden, omschrijving, status…) uit public/change-plans/<naam>.json,
     gemaakt door Claude na een volledige controle. Zelfde motor als het
     prijsplan: chunks, tijdbudget, backup-tabblad. Producten die intussen
     handmatig zijn veranderd worden overgeslagen (lib/change-plan.js).
     1. Controleer = droge run, verandert niets.  2. Zet door.  3. Draai terug. */
  async function loadChangePlan(nameArg) {
    const name = String(nameArg != null ? nameArg : cpName || "").trim().replace(/\.json$/i, "");
    if (!name) return;
    setErr("");
    setCpCheck(null);
    try {
      const r = await fetch(`/change-plans/${encodeURIComponent(name)}.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(`plan "${name}" niet gevonden (${r.status})`);
      const plan = await r.json();
      if (!Array.isArray(plan.items) || !plan.items.length) throw new Error("plan is leeg");
      if (!Array.isArray(plan.groups) || !plan.groups.length) plan.groups = [{ id: "__all", label: "Alle wijzigingen", default: true }];
      if (!plan.name) plan.name = name;
      setCp(plan);
      setCpSel(plan.groups.filter((g) => g.default !== false).map((g) => g.id));
    } catch (e) {
      setCp(null);
      setErr(`Wijzigingsplan: ${String(e.message || e)}`);
    }
  }

  function toggleCpGroup(id) {
    setCpCheck(null);
    setCpSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function cpBuild() {
    if (!cp || !cpSel.length) return { ids: [], map: {}, count: 0 };
    return mergePlanItems(cp, cpSel.includes("__all") ? [] : cpSel);
  }

  function cpStoreOk() {
    if (planMatchesStore(cp, store)) return true;
    return window.confirm(`Dit plan is voor ${cp.store || cp.domain}, maar de gekozen store is ${store.name || store.domain}. Toch doorgaan?`);
  }

  async function checkChangePlan() {
    if (!cp || !store || fixBusy || busy || aiBusy) return;
    const { ids, map } = cpBuild();
    if (!ids.length) return setErr("Wijzigingsplan: vink minstens één groep aan.");
    if (!cpStoreOk()) return;
    setFixBusy("change-plan|check");
    setFixLog([]);
    setErr("");
    stopRef.current = false;
    runApi.start(`Controle wijzigingsplan ${cp.name || cpName}`, { phases: [{ key: "fixes", label: "Controle" }], sub: "droge run — er verandert niets" });
    try {
      const tot = await execFix(
        { id: "apply-change-plan", label: `Controle "${cp.name || cpName}" — verandert niets` },
        ids,
        fixOptions({ plan: map, dryRun: true }),
        true
      );
      setCpCheck(tot);
      runApi.finish("done", "Controle klaar");
      sfx(tot.failed ? "error" : "success");
    } catch (e) {
      setErr(`Controle gestopt: ${String(e.message || e)}`);
      runApi.finish("error");
      sfx("error");
    } finally {
      setFixBusy(null);
      setFixProg(null);
    }
  }

  function applyChangePlan(revert) {
    if (!cp || !store) return;
    const { ids, map, count } = cpBuild();
    if (!ids.length) return setErr("Wijzigingsplan: vink minstens één groep aan.");
    if (!cpStoreOk()) return;
    const types = Object.values(map).filter((m) => m.set && m.set.product_type != null).length;
    const status = Object.values(map).filter((m) => m.set && m.set.status != null).length;
    const warn = [
      types ? `\n⚠ ${types} producttype-wijziging(en) — kan een vermeldingsgroep van de mediabuyer raken.` : "",
      status ? `\n⚠ ${status} product(en) krijgen een andere status (draft = niet meer zichtbaar in de winkel).` : "",
    ].join("");
    const msg = revert
      ? `TERUGDRAAIEN: ${ids.length} producten uit "${cp.name || cpName}" terug naar hoe ze waren (alleen waar de plan-waarde nog staat). Omschrijvingen en metafields gaan niet automatisch terug — die staan in het backup-tabblad. Starten?`
      : `${ids.length} producten (${count} wijzigingen) uit "${cp.name || cpName}" doorvoeren. Eerst gaat alles naar het backup-tabblad; producten die intussen veranderd zijn worden overgeslagen.${warn}\n\nStarten?`;
    if (!window.confirm(msg)) return;
    setCpCheck(null);
    runFix(
      "change-plan",
      { id: "apply-change-plan", label: `${revert ? "Terugdraaien" : "Wijzigingsplan"} ${cp.name || cpName}` },
      ids,
      { plan: map, revert: !!revert }
    );
  }

  /* ============ SW · PRODUCTTYPES VAN CAS ============
     1. /api/sw-types: welke producten (zelfde selectie als de scan) hebben
        geen exact type uit de lijst van Cas?
     2. Die producten via de gewone Doctor-fix "set-sw-type" (chunks + backup,
        AI kiest op foto + titel precies één type per product).
     Fotocheck (photo=true): ALLE producten uit de selectie langs de AI, ook
     die volgens de regels goed staan — vangt titels die liegen ("Mini Shorts"
     die een playsuit is, een "Wedge" die plat is). Alleen een andere soort op
     de foto wordt aangepast; seizoen blijft volgens de vaste regel. */
  async function swTypePass(skipBackup, photo = false) {
    setSwInfo(photo ? "Fotocheck: producten ophalen…" : "Producttypes controleren…");
    const r = await fetch("/api/sw-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store: storeBody,
        sinceISO: since && useSince ? since : null,
        latest: latestOn ? Math.max(1, Math.min(1000, Number(latestN) || 100)) : 0,
        max: Number(max) || 1000,
        all: photo,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.status);
    if (!data.toFix.length) {
      const msg = `Producttypes: alle ${data.total} producten hebben al een type uit de lijst van Cas.`;
      setSwInfo(msg);
      return { fixed: 0, total: data.total };
    }
    const why = Object.entries(data.reasons || {}).map(([k, v]) => `${v}× ${k}`).join(" · ");
    setSwInfo(
      photo
        ? `Fotocheck: AI bekijkt de foto van ${data.toFix.length} producten${data.bad ? ` (${data.bad} staan ook volgens de regels fout: ${why})` : ""}…`
        : `Producttypes: ${data.toFix.length} van ${data.total} zetten (${why})…`
    );
    const tot = await execFix(
      { id: "set-sw-type", label: photo ? "Fotocheck producttypes (SW)" : "Producttypes van Cas (SW)" },
      data.toFix,
      photo ? { ...fixOptions(), swPhotoCheck: true } : fixOptions(),
      skipBackup
    );
    setSwInfo(
      photo
        ? `Fotocheck: ${tot.fixed} aangepast · ${tot.skipped} klopten al · ${tot.failed} mislukt — van ${data.total} producten. Zie het logboek voor wat er veranderd is.`
        : `Producttypes: ${tot.fixed} gezet · ${tot.skipped} stonden al goed · ${tot.failed} mislukt — van ${data.total} producten gecontroleerd.`
    );
    return tot;
  }

  async function runSwTypes(photoArg) {
    if (!store || !isSW || fixBusy || busy || aiBusy) return;
    const photo = photoArg === true; // onClick geeft een event mee
    if (
      photo &&
      !window.confirm(
        "Fotocheck: de AI bekijkt de foto van ELK product in de selectie (ook als het type volgens de regels al klopt) en past alleen een andere soort aan (bv. 'Mini Shorts' die een playsuit is → Casual Set). Kost wat AI-tegoed en ±1 minuut per 100 producten. Doorgaan?"
      )
    )
      return;
    const b = askBackupSkip();
    if (!b.ok) return;
    setFixBusy("sw-types");
    setFixLog([]);
    setErr("");
    stopRef.current = false;
    runApi.start(photo ? "Fotocheck producttypes (SW)" : "Producttypes van Cas (SW)", { phases: [{ key: "fixes", label: "Producttypes" }, { key: "final", label: "Herscan" }] });
    try {
      const tot = await swTypePass(b.skipBackup, photo);
      sfx(tot.failed ? "error" : "success");
      runApi.phase("final", "Rapport verversen");
      if (rep) await scan({ keepAi: true, silent: true, inRun: true });
      runApi.finish("done");
    } catch (e) {
      setErr(`Producttypes gestopt: ${String(e.message || e)}`);
      setSwInfo("");
      runApi.finish("error");
      sfx("error");
    } finally {
      setFixBusy(null);
      setFixProg(null);
    }
  }

  // Scan-knop: bij SW eerst de producttypes van Cas (tenzij uitgevinkt)
  async function scanClick() {
    if (!store) return;
    if (isSW && swFirst) {
      const b = askBackupSkip();
      if (!b.ok) return;
      setFixBusy("sw-types");
      setFixLog([]);
      setErr("");
      stopRef.current = false;
      runApi.start(`Scan · ${store.name || store.domain}`, { phases: [{ key: "fixes", label: "Producttypes" }, { key: "scan", label: "Scan" }] });
      runApi.phase("fixes", "Producttypes van Cas");
      try {
        await swTypePass(b.skipBackup);
      } catch (e) {
        setErr(`Producttypes (Cas) overgeslagen: ${String(e.message || e)} — de scan loopt gewoon door.`);
        runApi.log(`Producttypes overgeslagen: ${String(e.message || e)}`, "warn");
      } finally {
        setFixBusy(null);
        setFixProg(null);
      }
      if (stopRef.current) return runApi.finish("paused");
      runApi.phase("scan", "Producten scannen");
      const r = await scan({ inRun: true });
      return runApi.finish(r ? "done" : "error", r ? "Scan klaar" : undefined);
    }
    await scan();
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
    const aiEst = aiEstimate(n).toFixed(2);
    const zeker = window.confirm(
      `FIX ALLES over ${rep ? n : "max " + n} producten (markt: ${market || "—"}):\n\n` +
        `1. Verse scan\n` +
        `2. Alle veilige fixes — foto's her-koppelen, gender uit titel, opties vertalen, maten klant-logisch, variant-prijzen, barcodes, vendor, product type, categorie, alt-teksten, maten-volgorde, templates, publiceren, doorstreepprijzen, titels, maattabellen\n` +
        `3. Alle AI-controles (geschat ±$${aiEst}) — foto-audit, geslacht, taal, watermerk, kleur↔foto, steekproef\n` +
        `4. Eindscan + verslag — verwijderen doe ik NOOIT automatisch\n\n` +
        `Bovenaan zie je live wat hij doet. Pauzeren kan altijd. Starten?`
    );
    if (!zeker) return;
    const b = askBackupSkip();
    if (!b.ok) return;
    setFixBusy("all");
    setErr("");
    setVerslag(null);
    setFixLog([]);
    setPausing(false);
    stopRef.current = false;
    runApi.start(`FIX ALLES · ${store.name || store.domain}`, { sub: `markt ${market || "—"} · ${latestOn ? `laatste ${latestN} producten` : "hele store"}` });
    let usdTotal = 0;
    try {
      const { verslag } = await fixAllStore({
        storeBody,
        scanParams: scanParamsNow(),
        fixOptions,
        backupFor: backupPlanFor,
        skipBackup: b.skipBackup,
        withAi: true,
        sizeGuides: orgDoc.sizeGuides,
        hooks: {
          phase: (k, label) => {
            runApi.phase(k, label);
            if (k !== "done") runApi.log(`— ${label} —`, "info");
            if (k === "ai") setFixProg(null);
          },
          report: (r) => {
            setRep(r);
            setRepAt(new Date());
          },
          fixStart: (fix, cnt, i, of) => {
            const id = newBlock(fix.label, cnt);
            runApi.step(fix.label, { i, of, total: cnt });
            setFixProg({ done: 0, total: cnt, fixed: 0, failed: 0, skipped: 0, label: fix.label });
            return { id, label: fix.label, last: { fixed: 0, skipped: 0, failed: 0 } };
          },
          fixProgress: (hd, t) => {
            setFixProg({ ...t, label: hd.label });
            runApi.progress(t.done, t.total);
            runApi.count({ fixed: t.fixed - hd.last.fixed, skipped: t.skipped - hd.last.skipped, failed: t.failed - hd.last.failed });
            hd.last = t;
          },
          fixNotes: (hd, lines) => {
            blockDetail(hd.id, lines);
            lines.filter(isAlarm).slice(0, 3).forEach((l) => runApi.log(`${hd.label}: ${l}`, "warn"));
          },
          fixDone: (hd, t, e) => {
            if (e) {
              blockDone(hd.id, `gestopt: ${String(e).slice(0, 120)}`, 1);
              runApi.log(`${hd.label}: ${e} — ik ga door met de volgende stap`, "err");
            } else {
              const sum = `${t.fixed} aangepast · ${t.skipped} overgeslagen · ${t.failed} mislukt`;
              blockDone(hd.id, sum, t.failed);
              runApi.log(`${hd.label}: ${sum}`, t.failed ? "warn" : "ok");
            }
          },
          aiStart: (check, cnt) => {
            setAiBusy(check);
            runApi.step((AI_META[check] || {}).label || check, { total: cnt });
          },
          aiProgress: (check, d, t) => {
            setAiProg(`${d}/${t}`);
            runApi.progress(d, t);
          },
          aiResults: (check, all, usd) => {
            setAiRes((cur) => ({ ...cur, [check]: all }));
            setAiUsd((cur) => ({ ...cur, [check]: usd }));
          },
          aiDone: (check, out, e) => {
            setAiBusy(null);
            setAiProg("");
            const lbl = (AI_META[check] || {}).label || check;
            if (e) runApi.log(`${lbl}: ${e} — ik ga door`, "err");
            else {
              usdTotal += out.usd;
              runApi.usd(usdTotal);
              runApi.log(`${lbl}: ${out.results.length ? `${out.results.length} gevonden` : out.skipped ? "niets gevonden" : "schoon"}${out.skipped ? ` · ${out.skipped} niet gecontroleerd (AI haperde)` : ""}`, out.results.length || out.skipped ? "warn" : "ok");
            }
          },
          log: (t, k) => runApi.log(t, k),
          retry: (nr, why) => runApi.log(`${why}${nr ? ` — opnieuw (${nr + 1})` : ""}`, "warn"),
          shouldStop: () => stopRef.current,
        },
      });
      setVerslag(verslag);
      runApi.finish(verslag.paused ? "paused" : "done", verslag.paused ? "Gepauzeerd" : verslag.errors.length ? "Klaar — met een paar meldingen" : "Klaar");
      sfx(verslag.paused ? "toggle" : "success");
    } catch (e) {
      setErr(`FIX ALLES gestopt: ${String(e.message || e)} — hieronder kun je per onderdeel verder.`);
      runApi.log(String(e.message || e), "err");
      runApi.finish("error");
      sfx("error");
    } finally {
      setFixBusy(null);
      setFixProg(null);
      setAiBusy(null);
      setAiProg("");
      setPausing(false);
    }
  }

  /* ---------------- AI-CHECKS ---------------- */

  // Kern van een AI-check: de chunk-loop, zonder bevestiging — gedeeld
  // tussen de losse knoppen en FIX ALLES. Resultaten streamen live naar
  // de UI; pauzeren (stopRef) stopt na het lopende plukje.
  async function runAiCore(check, idsAll) {
    setAiBusy(check);
    setFixProg(null); // AI-voortgang is zichtbaar op de check-knop zelf
    runApi.step((AI_META[check] || {}).label || check, { total: check === "sample" ? Math.min(12, (idsAll || []).length) : (idsAll || []).length });
    try {
      const out = await runAiLoop(storeBody, check, idsAll || [], {
        shouldStop: () => stopRef.current,
        onProgress: (d, t) => {
          setAiProg(`${d}/${t}`);
          runApi.progress(d, t);
        },
        onResults: (all, usd) => {
          setAiRes((cur) => ({ ...cur, [check]: all }));
          setAiUsd((cur) => ({ ...cur, [check]: usd }));
          runApi.usd(usd);
        },
        onNote: (t) => runApi.log(t, "warn"),
      });
      runApi.log(`${(AI_META[check] || {}).label || check}: ${out.results.length ? `${out.results.length} gevonden` : out.skipped ? "niets gevonden" : "schoon"}${out.skipped ? ` · ${out.skipped} niet gecontroleerd (AI haperde)` : ""}`, out.results.length || out.skipped ? "warn" : "ok");
      return out;
    } finally {
      setAiProg("");
    }
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
    setPausing(false);
    runApi.start(AI_META[check].label, { phases: [{ key: "ai", label: "AI-check" }], sub: `${cnt} producten · ±$${est}` });
    runApi.phase("ai", AI_META[check].label);
    try {
      const out = await runAiCore(check, baseIds);
      runApi.finish(stopRef.current ? "paused" : "done");
      sfx(out.results.length ? "error" : "success");
    } catch (e) {
      setErr(`${AI_META[check].label} gestopt: ${String(e.message || e)}`);
      runApi.log(String(e.message || e), "err");
      runApi.finish("error");
      sfx("error");
    } finally {
      setAiBusy(null);
      setAiProg("");
      setPausing(false);
    }
  }

  // Twijfel = de titel zegt expliciet het andere geslacht ("Men's …" → AI zegt Women)
  const genderDoubt = (m) => {
    const ts = titleSex(m.title);
    return !!ts && ts !== m.suggested;
  };

  function applyGenderFix(withDoubt) {
    const list = (aiRes.gender || []).filter((m) => withDoubt || !genderDoubt(m));
    if (!list.length) return;
    const labels = {};
    for (const m of list) labels[String(m.id)] = m.suggested;
    runFix("ai-gender", { id: "gender-tags", label: "Zet gender-tags goed" }, list.map((m) => m.id), { labels });
  }

  function applyPhotoGender(mode) {
    const list = (aiRes["photo-audit"] || []).filter((m) => m.kind === "gender");
    if (!list.length) return;
    if (mode === "archive") {
      runFix("ai-photo-archive", { id: "archive-products", label: "Misgenderde producten eruit (archiveren)" }, list.map((m) => m.id), {});
    } else {
      const labels = {};
      for (const m of list) labels[String(m.id)] = m.suggested;
      runFix("ai-photo-flip", { id: "gender-tags", label: "Omzetten naar het geslacht op de foto (titel + tags)" }, list.map((m) => m.id), { labels });
    }
  }

  function applyCollectionFit() {
    const list = (aiRes["photo-audit"] || []).filter((m) => m.kind === "fit");
    if (!list.length) return;
    const fit = {};
    for (const m of list) fit[String(m.id)] = { drop: m.drop, add: m.add };
    runFix("ai-photo-fit", { id: "fix-collection-fit", label: "Uit verkeerde collecties halen" }, list.map((m) => m.id), { fit });
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

  const disabled = !store || busy || !!fixBusy || !!aiBusy;

  const scopeLabel = runScoped ? "deze import-run" : latestOn ? `laatste ${latestN} producten` : `hele store (max ${max})`;
  const findingsShown = rep ? rep.findings.filter((f) => flt === "all" || (flt === "error" ? f.level === "error" && !f.soft : f.level === "warn" || f.soft)) : [];
  const nErr = rep ? rep.findings.filter((f) => f.level === "error" && !f.soft).length : 0;
  const nWarn = rep ? rep.findings.length - nErr : 0;

  return (
    <div className="sd">
      {/* 1. LIVE DASHBOARD — plakt bovenaan tijdens het scrollen */}
      <RunDashboard run={run} pausing={pausing} onPause={pause} onClose={() => runApi.clear()} />

      {/* 2. KOP + HOOFDACTIES */}
      <div className="sd-hero">
        <div className="sd-hero__left">
          <div className="sd-eyebrow">Store Doctor</div>
          <div className="sd-hero__title">{store.name || store.domain}</div>
          <div className="sd-hero__meta">
            <span className="sd-pill sd-pill--gold">{market || "geen markt"}</span>
            {store.currency ? <span className="sd-pill">{store.currency}</span> : null}
            <span className="sd-pill">{scopeLabel}</span>
            <span className={`sd-pill${String(backupSheet || "").trim() ? " sd-pill--ok" : " sd-pill--warn"}`}>
              {String(backupSheet || "").trim() ? "backup aan" : "zonder backup"}
            </span>
          </div>
        </div>
        <div className="sd-hero__actions">
          <button className="sd-btn sd-btn--ghost" onClick={scanClick} disabled={disabled}>
            {busy ? "Scannen…" : fixBusy === "sw-types" ? "Producttypes…" : "🔍 Scan"}
          </button>
          <button
            className="sd-btn sd-btn--gold"
            onClick={fixAll}
            disabled={disabled}
            title="Verse scan, alle veilige fixes, alle AI-controles en een eindscan met verslag. Verwijderen blijft altijd aan jou."
          >
            {fixBusy === "all" ? "FIX ALLES bezig…" : "⚡ FIX ALLES"}
          </button>
        </div>
      </div>
      {err && <div className="sd-alert">{err}</div>}

      {/* 3. INSTELLINGEN */}
      <details className="sd-card sd-settings" open={!rep}>
        <summary>
          <span className="sd-card__title" style={{ margin: 0 }}>Instellingen</span>
          <span className="sd-muted"> · {scopeLabel} · markt {market || "—"}</span>
        </summary>
        <div className="sd-settings__body">
      <div className="field-label">
        Welke producten{" "}
        <span className="opt">
          {runScoped
            ? "(nu: alleen deze import-run — vinkje onderaan)"
            : orgDoc.latestOnly
              ? "(Sa Collective: alleen de laatst toegevoegde producten, actief + draft — maattabellen blijven buiten beschouwing)"
              : "(actief + draft)"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", opacity: runScoped ? 0.5 : 1 }}>
        <div className="seg">
          {!orgDoc.latestOnly && (
            <button type="button" className={scope === "all" ? "on" : ""} onClick={() => pickScope("all")} disabled={busy || runScoped}>
              Hele store
            </button>
          )}
          <button type="button" className={scope === "latest" || orgDoc.latestOnly ? "on" : ""} onClick={() => pickScope("latest")} disabled={busy || runScoped}>
            Laatste producten
          </button>
        </div>
        {scope === "latest" || orgDoc.latestOnly ? (
          <>
            {LATEST_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                className="btn-ghost btn-small"
                onClick={() => pickLatest(n)}
                disabled={busy || runScoped}
                style={Number(latestN) === n ? { borderColor: "var(--ok)", color: "var(--ok)", fontWeight: 700 } : {}}
              >
                {n}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={1000}
              value={latestN}
              onChange={(e) => pickLatest(e.target.value)}
              disabled={busy || runScoped}
              style={{ width: 90 }}
              title="Aantal nieuwste producten (max 1000)"
            />
            <span className="hint" style={{ margin: 0 }}>nieuwste eerst, max 1000</span>
          </>
        ) : (
          <>
            <span className="hint" style={{ margin: 0 }}>max</span>
            <input type="number" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 90 }} disabled={busy || runScoped} />
            <span className="hint" style={{ margin: 0 }}>producten (oudste eerst)</span>
          </>
        )}
      </div>
      <div className="kw-row" style={{ gridTemplateColumns: "1fr", marginTop: 8 }}>
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
      <div className="field-label" style={{ marginTop: 8 }}>
        Kale maat-nummers zijn <span className="opt">(6/10/14, schoenen 5–11, "S(4-6)" — uit het nummer zelf niet te zien; zeg wat de bron is en de fix rekent om naar {market || "de doelmarkt"})</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {BARE_SYSTEMS.map((b) => (
          <button
            key={b.key || "auto"}
            type="button"
            className="btn-ghost btn-small"
            title={b.info}
            onClick={() => pickBareSystem(b.key)}
            style={bareSystem === b.key ? { borderColor: "var(--ok)", color: "var(--ok)", fontWeight: 700 } : {}}
          >
            {b.label}
          </button>
        ))}
        <span className="hint">{(BARE_SYSTEMS.find((b) => b.key === bareSystem) || BARE_SYSTEMS[0]).info}</span>
      </div>

      {since ? (
        <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={useSince} onChange={(e) => setUseSince(e.target.checked)} />
          Alleen de producten van deze import-run controleren
        </label>
      ) : null}

        </div>
      </details>

      {isSW ? (
        <div className="prog-card" style={{ marginTop: 12 }}>
          <div className="field-label" style={{ marginTop: 0 }}>
            Producttypes van Cas <span className="opt">(alleen Shapes Wardrobe · 1 type per product, gekozen op foto + titel)</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn-ghost btn-small" onClick={() => runSwTypes(false)} disabled={disabled}>
              {fixBusy === "sw-types" ? "Producttypes bezig…" : "🏷 Controleer & zet producttypes"}
            </button>
            <button
              className="btn-ghost btn-small"
              onClick={() => runSwTypes(true)}
              disabled={disabled}
              title="AI bekijkt de foto van elk product en zet alleen een andere soort recht (titels die niet kloppen)"
            >
              📷 Fotocheck alle producten
            </button>
            <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", margin: 0 }}>
              <input type="checkbox" checked={swFirst} onChange={(e) => setSwFirst(e.target.checked)} disabled={disabled} />
              Automatisch vóór elke scan
            </label>
            <a className="linklike" href={SW_TYPE_SHEET} target="_blank" rel="noreferrer noopener">
              lijst van Cas
            </a>
          </div>
          <div className="hint" style={{ marginBottom: 0 }}>
            {swInfo ||
              "Elk product moet precies één type uit de sheet van Cas hebben, letterlijk gespeld (\"SS - Mens - Sandals\"). Leeg, een eigen type, het verkeerde geslacht of seizoen wordt rechtgezet. Seizoen = vaste regel: AS standaard; SS voor zwemkleding, sandalen, shorts, singlets, herenschoenen, linnen/Hawaiian/zon, korte-mouw overhemden. Fotocheck = AI kijkt ook bij goede types naar de foto. Selectie = dezelfde als de scan hierboven. Oude waarden gaan eerst naar de backup-sheet."}
          </div>
        </div>
      ) : null}


      {/* 4. EINDVERSLAG FIX ALLES */}
      {verslag && !fixBusy && (
        <div className={`sd-card sd-verslag${verslag.paused ? " is-paused" : ""}`}>
          <div className="sd-card__title">
            Eindverslag FIX ALLES{verslag.paused ? " — gepauzeerd" : ""}
            <span className="sd-muted"> · AI ±${verslag.usd.toFixed(2)}</span>
          </div>
          {verslag.before && verslag.after ? (
            <div className="sd-delta">
              <div>
                <span className="sd-delta__lbl">Score</span>
                <span className="sd-delta__val">
                  {String(verslag.before.score).replace(".", ",")} → <strong>{String(verslag.after.score).replace(".", ",")}</strong>
                </span>
              </div>
              <div>
                <span className="sd-delta__lbl">Fouten</span>
                <span className="sd-delta__val">
                  {verslag.before.errors} → <strong>{verslag.after.errors}</strong>
                </span>
              </div>
              <div>
                <span className="sd-delta__lbl">Waarschuwingen</span>
                <span className="sd-delta__val">
                  {verslag.before.warns} → <strong>{verslag.after.warns}</strong>
                </span>
              </div>
            </div>
          ) : null}
          {verslag.paused && (
            <div className="sd-note">
              Gepauzeerd — werk hieronder per onderdeel verder, of druk nog een keer op FIX ALLES: hij pakt op waar het bleef.
            </div>
          )}
          <div className="sd-list">
            {verslag.auto.map((a, i) => (
              <div className="sd-list__row" key={"a" + i}>
                <span className={a.error ? "sd-i err" : a.failed ? "sd-i warn" : "sd-i ok"}>{a.error ? "✗" : "✓"}</span>
                <span className="sd-list__txt">
                  <strong>{a.label}</strong>
                  <span className="sd-muted">
                    {" "}
                    · {a.fixed} aangepast · {a.skipped} overgeslagen{a.failed ? ` · ${a.failed} mislukt` : ""}
                    {a.error ? ` · ${a.error}` : ""}
                  </span>
                </span>
              </div>
            ))}
            {verslag.ai.map((t, i) => (
              <div className="sd-list__row" key={"i" + i}>
                <span className="sd-i gold">✦</span>
                <span className="sd-list__txt">{t}</span>
              </div>
            ))}
            {(verslag.errors || []).length > 0 && (
              <>
                <div className="sd-list__head">Meldingen (de run ging door)</div>
                {verslag.errors.map((t, i) => (
                  <div className="sd-list__row" key={"e" + i}>
                    <span className="sd-i err">✗</span>
                    <span className="sd-list__txt">{t}</span>
                  </div>
                ))}
              </>
            )}
            {verslag.open.length > 0 && (
              <>
                <div className="sd-list__head">Voor jou om te beslissen</div>
                {verslag.open.map((t, i) => (
                  <div className="sd-list__row" key={"o" + i}>
                    <span className="sd-i warn">!</span>
                    <span className="sd-list__txt">{t}</span>
                  </div>
                ))}
              </>
            )}
            {!verslag.auto.length && !verslag.ai.length && <div className="sd-empty">Niets te fixen gevonden.</div>}
          </div>
        </div>
      )}

      {/* 5. OVERZICHT (rapport) */}
      {rep && (
        <div className="sd-card sd-overview">
          <div className="sd-overview__top">
            <ScoreRing score={rep.stats.score} />
            <div className="sd-overview__tiles">
              <div className={`sd-tile${rep.stats.errors ? " sd-tile--err" : " sd-tile--ok"}`}>
                <span className="sd-tile__num">{rep.stats.errors}</span>
                <span className="sd-tile__lbl">fouten</span>
              </div>
              <div className={`sd-tile${rep.stats.warns ? " sd-tile--warn" : ""}`}>
                <span className="sd-tile__num">{rep.stats.warns}</span>
                <span className="sd-tile__lbl">waarschuwingen</span>
              </div>
              <div className="sd-tile">
                <span className="sd-tile__num">{rep.scanned}</span>
                <span className="sd-tile__lbl">
                  {rep.statusCount ? `${rep.statusCount.active} actief · ${rep.statusCount.draft} draft` : "producten"}
                </span>
              </div>
              <div className="sd-tile">
                <span className="sd-tile__num">
                  {repAt ? `${String(repAt.getHours()).padStart(2, "0")}:${String(repAt.getMinutes()).padStart(2, "0")}` : "—"}
                </span>
                <span className="sd-tile__lbl">laatste scan</span>
              </div>
            </div>
          </div>
          {rep.partial && rep.partial.length > 0 && <div className="sd-note">{rep.partial.join(" · ")}</div>}
          <div className="sd-overview__bar">
            <div className="seg">
              <button type="button" className={flt === "all" ? "on" : ""} onClick={() => setFlt("all")}>
                Alles ({rep.findings.length})
              </button>
              <button type="button" className={flt === "error" ? "on" : ""} onClick={() => setFlt("error")}>
                Fouten ({nErr})
              </button>
              <button type="button" className={flt === "warn" ? "on" : ""} onClick={() => setFlt("warn")}>
                Waarschuwingen ({nWarn})
              </button>
            </div>
          </div>
          <div className="sd-findings">
            {rep.findings.length === 0 && <div className="sd-empty">Alles schoon. Netjes.</div>}
            {findingsShown.map((f) => {
              const isOpen = !!open[f.id];
              const main = (f.fixes || [])[0];
              return (
                <div key={f.id} className={`sd-finding is-${f.soft ? "soft" : f.level}${isOpen ? " open" : ""}`}>
                  <div className="sd-finding__head" onClick={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))}>
                    <span className="sd-finding__dot" />
                    <span className="sd-finding__title">{f.title}</span>
                    <span className="sd-count">{f.count}</span>
                    {main && !isOpen ? (
                      <button
                        type="button"
                        className={`sd-btn sd-btn--mini${main.danger ? " sd-btn--danger" : ""}`}
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          // verwijderen/archiveren nooit met één tik vanuit de dichte kaart: eerst openklappen
                          if (main.danger) setOpen((o) => ({ ...o, [f.id]: true }));
                          else runFix(f.id, main, f.ids);
                        }}
                        title={main.label}
                      >
                        {fixBusy === `${f.id}|${main.id}` ? "Bezig…" : main.danger ? "Bekijk" : "⚡ Fix"}
                      </button>
                    ) : null}
                    <span className="sd-chev">{isOpen ? "▾" : "▸"}</span>
                  </div>
                  {isOpen && (
                    <div className="sd-finding__body">
                      <div className="sd-finding__why">{f.why}</div>
                      {(f.fixes || []).length > 0 && (
                        <div className="sd-finding__fixes">
                          {(f.fixes || []).map((fx) => (
                            <button
                              key={fx.id}
                              className={`sd-btn sd-btn--small${fx.danger ? " sd-btn--danger" : ""}`}
                              disabled={disabled}
                              onClick={() => runFix(f.id, fx, f.ids)}
                            >
                              {fixBusy === `${f.id}|${fx.id}` ? "Bezig…" : `⚡ ${fx.label} (${f.count})`}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="sd-examples">
                        {f.examples.map((ex) => (
                          <div key={`${ex.id}-${ex.title}`} className="sd-examples__row">
                            <a className="linklike" href={adminUrl(ex.id)} target="_blank" rel="noreferrer noopener">
                              {ex.title}
                            </a>
                            {ex.extra ? <span className="sd-muted"> — {ex.extra}</span> : null}
                          </div>
                        ))}
                        {f.count > f.examples.length && <div className="sd-muted">… en {f.count - f.examples.length} meer</div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. LOGBOEK PER FIX */}
      {fixLog.length > 0 && (
        <details className="sd-card sd-log">
          <summary>
            <span className="sd-card__title" style={{ margin: 0 }}>Logboek per fix</span>
            <span className="sd-muted"> · {fixLog.length} stap(pen)</span>
          </summary>
          <div className="sd-list" style={{ marginTop: 10 }}>
            {fixLog.map((b) => (
              <div key={b.id} className="sd-list__row" style={{ display: "block" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span className={b.status === "busy" ? "sd-i" : b.failed ? "sd-i warn" : "sd-i ok"}>
                    {b.status === "busy" ? "▸" : b.failed ? "⚠" : "✓"}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{b.label}</span>
                  <span className="sd-muted small">{b.status === "busy" ? `bezig… (${b.total})` : b.sum}</span>
                </div>
                {b.details.length > 0 && (
                  <div style={{ paddingLeft: 22, marginTop: 3 }}>
                    {(b.open ? b.details : b.details.slice(0, 4)).map((d, i) => (
                      <div key={i} className="sd-muted small" style={{ marginTop: 1, ...(isAlarm(d) ? { color: "var(--err)" } : {}) }}>
                        {d}
                      </div>
                    ))}
                    {b.details.length > 4 && (
                      <button type="button" className="linklike" onClick={() => toggleBlock(b.id)}>
                        {b.open ? "▾ inklappen" : `▸ alle ${b.details.length} regels tonen`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 7. AI-CONTROLES */}
      {rep && (
        <div className="sd-card sd-ai">
          <div className="sd-card__title">
            AI-controles <span className="sd-muted">goedkoop model · kosten vooraf in beeld · draaien ook mee in FIX ALLES</span>
          </div>
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
                      {check === "photo-audit" && aiRes[check].some((m) => m.kind === "gender") && (
                        <>
                          <button
                            className="btn-ghost btn-small"
                            style={{ color: "var(--err)", borderColor: "var(--err)" }}
                            disabled={disabled}
                            onClick={() => applyPhotoGender("archive")}
                          >
                            ⚡ Haal {aiRes[check].filter((m) => m.kind === "gender").length} misgenderd(e) eruit (archiveren)
                          </button>{" "}
                          <button className="btn-ghost btn-small" disabled={disabled} onClick={() => applyPhotoGender("flip")}>
                            Of: zet om naar foto-geslacht
                          </button>{" "}
                        </>
                      )}
                      {check === "photo-audit" && aiRes[check].some((m) => m.kind === "fit") && (
                        <button className="btn-ghost btn-small" disabled={disabled} onClick={applyCollectionFit}>
                          ⚡ Haal {aiRes[check].filter((m) => m.kind === "fit").length} uit verkeerde collectie(s)
                        </button>
                      )}
                      {check === "gender" && aiRes.gender.some((m) => !genderDoubt(m)) && (
                        <button className="btn-ghost btn-small" disabled={disabled} onClick={() => applyGenderFix(false)}>
                          ⚡ Zet {aiRes.gender.filter((m) => !genderDoubt(m)).length} gender-tag(s) goed
                        </button>
                      )}{" "}
                      {check === "gender" && aiRes.gender.some(genderDoubt) && (
                        <button
                          className="btn-ghost btn-small"
                          style={{ color: "var(--warn)", borderColor: "var(--warn)" }}
                          disabled={disabled}
                          onClick={() => {
                            const n = aiRes.gender.filter(genderDoubt).length;
                            if (window.confirm(`${n} product(en) waar de titel iets anders zegt dan de AI. Heb je de foto's gecheckt? Dan nu ook die omzetten.`)) applyGenderFix(true);
                          }}
                        >
                          Ook {aiRes.gender.filter(genderDoubt).length} twijfelgeval(len) omzetten (na foto-check)
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
                              {check === "photo-audit" && ` — ${m.kind === "gender" ? "⚠ misgenderd: " : "collectie: "}${m.why}`}
                              {check === "gender" && ` — ${m.current} → ${m.suggested}${genderDoubt(m) ? " · ⚠ twijfel: titel zegt " + titleSex(m.title) : ""}`}
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
      {/* 8. PLANNEN VAN CLAUDE */}
      {store && (
        <details className="sd-card sd-plans">
          <summary>
            <span className="sd-card__title" style={{ margin: 0 }}>Plannen van Claude</span>
            <span className="sd-muted"> · prijsplan · wijzigingsplan</span>
          </summary>
          <div style={{ marginTop: 12 }}>
      {store && (
        <div>
          <div className="field-label">Prijsplan toepassen <span className="opt">goedgekeurd voorstel van Claude, bv. ssb-2026-10-30</span></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input type="text" value={planName} placeholder="naam van het plan" onChange={(e) => setPlanName(e.target.value)} style={{ maxWidth: 260 }} />
            <button className="btn-ghost btn-small" disabled={!planName.trim() || !!fixBusy || busy} onClick={loadPricePlan}>Laad plan</button>
            {pricePlan && (
              <button className="btn-ghost btn-small" disabled={!!fixBusy || busy || !!aiBusy} onClick={applyPricePlan}>
                ⚡ Zet {pricePlan.items.length} nieuwe prijzen door
              </button>
            )}
          </div>
          {pricePlan && (
            <div className="hint">
              {pricePlan.store} · {pricePlan.date} · {pricePlan.note} — voorbeeld: {pricePlan.items.slice(0, 3).map((it) => `"${String(it.title).split("|")[0].trim()}" $${it.from} → $${it.price}`).join(" · ")}
            </div>
          )}
        </div>
      )}

      {store && (
        <div style={{ marginTop: 14 }}>
          <div className="field-label">
            Wijzigingsplan toepassen{" "}
            <span className="opt">algemene fixes van Claude over de hele store (geslacht, tags, varianten…), bv. cc-2026-10-31</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input type="text" list="cp-plans" value={cpName} placeholder="naam van het plan" onChange={(e) => setCpName(e.target.value)} style={{ maxWidth: 260 }} />
            <datalist id="cp-plans">
              {cpIndex.map((x) => (
                <option key={x.name} value={x.name}>{`${x.store || ""} · ${x.date || ""}`}</option>
              ))}
            </datalist>
            <button className="btn-ghost btn-small" disabled={!cpName.trim() || !!fixBusy || busy} onClick={() => loadChangePlan()}>
              Laad plan
            </button>
          </div>
          {!cp && cpIndex.filter((x) => planMatchesStore(x, store)).length > 0 && (
            <div className="hint">
              Klaar voor deze store:{" "}
              {cpIndex
                .filter((x) => planMatchesStore(x, store))
                .map((x) => (
                  <a
                    key={x.name}
                    className="linklike"
                    style={{ marginRight: 8, cursor: "pointer" }}
                    onClick={() => {
                      setCpName(x.name);
                      loadChangePlan(x.name);
                    }}
                  >
                    {x.name}
                  </a>
                ))}
            </div>
          )}
          {cp &&
            (() => {
              const counts = groupCounts(cp);
              const sel = cpBuild();
              const types = Object.values(sel.map).filter((m) => m.set && m.set.product_type != null).length;
              const shown = (cp.items || []).filter((it) => cpSel.includes("__all") || cpSel.includes(it.group));
              const cpBusy = !!fixBusy || busy || !!aiBusy;
              return (
                <div className="log" style={{ display: "block", marginTop: 6 }}>
                  <div className="hint" style={{ marginTop: 0 }}>
                    <strong>{cp.store}</strong> · {cp.date} · {cp.note}
                  </div>
                  {cp.groups.map((g) => (
                    <label key={g.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, cursor: "pointer" }}>
                      <input type="checkbox" checked={cpSel.includes(g.id)} onChange={() => toggleCpGroup(g.id)} style={{ marginTop: 3 }} />
                      <span>
                        <strong>{g.label}</strong>{" "}
                        <span className="muted">({g.id === "__all" ? cp.items.length : counts[g.id] || 0} producten)</span>
                        {g.desc ? (
                          <span className="hint" style={{ display: "block", marginTop: 2 }}>
                            {g.desc}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                  {types > 0 && (
                    <div className="hint" style={{ color: "#b7791f" }}>
                      ⚠ {types} producttype-wijziging(en) in de selectie — check of de mediabuyer op die types filtert.
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    <button className="btn-ghost btn-small" disabled={cpBusy || !sel.ids.length} onClick={checkChangePlan}>
                      {fixBusy === "change-plan|check" ? "Bezig…" : "🔍 Controleer eerst (verandert niets)"}
                    </button>
                    <button className="btn-ghost btn-small" disabled={cpBusy || !sel.ids.length} onClick={() => applyChangePlan(false)}>
                      {fixBusy === "change-plan|apply-change-plan" ? "Bezig…" : `⚡ Zet ${sel.ids.length} producten door`}
                    </button>
                    <button className="btn-ghost btn-small" disabled={cpBusy || !sel.ids.length} onClick={() => applyChangePlan(true)}>
                      ↩ Draai terug
                    </button>
                  </div>
                  {cpCheck && (
                    <div className="hint">
                      Controle: <strong>{cpCheck.fixed}</strong> zouden veranderen · {cpCheck.skipped} al goed of overgeslagen · {cpCheck.failed} mislukt —
                      details in het fix-log.
                    </div>
                  )}
                  <details style={{ marginTop: 8 }}>
                    <summary className="hint" style={{ cursor: "pointer" }}>
                      Bekijk de {shown.length} wijzigingen
                    </summary>
                    {shown.slice(0, 400).map((it, i) => (
                      <div key={`${it.id}-${i}`} className="hint" style={{ marginTop: 2 }}>
                        <a className="linklike" href={adminUrl(it.id)} target="_blank" rel="noreferrer noopener">
                          {String(it.title || it.id).split("|")[0].trim()}
                        </a>
                        <span className="muted"> — {it.why}</span>
                      </div>
                    ))}
                    {shown.length > 400 && <div className="hint muted">… en {shown.length - 400} meer</div>}
                  </details>
                </div>
              );
            })()}
        </div>
      )}

          </div>
        </details>
      )}
    </div>
  );
}
