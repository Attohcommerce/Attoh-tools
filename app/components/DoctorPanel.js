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

const LS_BACKUP = "sa_doctor_backup";
const LS_SCOPE = "sa_doctor_scope"; // "all" | "latest"
const LS_LATEST = "sa_doctor_latest"; // aantal nieuwste producten (max 1000)
const LATEST_CHOICES = [50, 100, 250, 500, 1000];
const LS_MARKET = "sa_doctor_market::"; // + store-domein
const LS_BARESYS = "sa_doctor_baresys::"; // + store-domein — wat kale maat-nummers zijn (us/uk/au/eu)
const WERKBOEK = "1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE"; // Import-werkboek (default)

// Slimme default: de store-valuta verraadt de markt
const CUR_MARKET = { USD: "USA", GBP: "UK", AUD: "AUS+NZ", NZD: "AUS+NZ", CAD: "CAN" };

// Chunk per AI-check (server verwerkt per call precies dit plukje).
// Gender staat op 6: grondige modus met foto's — titel + omschrijving +
// eerste productfoto per product.
const AI_CHUNK = { "photo-audit": 5, gender: 6, language: 25, "color-photo": 8, watermark: 4, sample: 12 };
// Ruwe kostenraming per product (haiku-tarieven) — alleen voor de knop-tekst
const AI_EST = { "photo-audit": 0.003, gender: 0.002, language: 0.0007, "color-photo": 0.002, watermark: 0.004 };
const AI_META = {
  "photo-audit": { label: "Foto-audit (streng) — geslacht + collectie", desc: "Kijkt alleen naar de foto: man op de foto bij een Women's-product (of andersom) = misgenderd; jas/longsleeve in Tank Tops = verkeerde collectie" },
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
  "clean-size-labels",
  "convert-sizes",
  "shoe-us-eu-labels",
  "unify-variant-prices",
  "clear-barcodes",
  "set-vendor",
  "set-product-type",
  "set-sw-type", // alleen Shapes Wardrobe: type uit de lijst van Cas
  "set-category",
  "fill-category-attrs", // na de categorie: de velden hangen van de categorie af
  "fill-alt",
  "fix-size-order",
  "fix-men-template",
  "fix-women-template",
  "publish-products",
  "fix-compareat",
  "clean-titles",
  "fix-size-guides",
];

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
          latest: latestOn ? Math.max(1, Math.min(1000, Number(latestN) || 100)) : 0,
          vendorName: store.name || "",
          market,
          bareSystem,
          sizeGuides: orgDoc.sizeGuides, // false (Sa Collective) = maattabellen niet ophalen/checken
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.status);
      setRep(data);
      setRepAt(new Date());
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

  // Kern: één fix over een id-lijst, in chunks tot done. Gooit bij een fout.
  //
  // Vercel-timeout-guard: als de server géén JSON teruggeeft (Vercel's
  // "An error occurred with your deployment"-pagina bij een timeout, of een
  // 502/504 van de gateway) is de chunk te zwaar. Dan: zelfde cursor opnieuw
  // met een half zo grote chunk; bij chunk 1 nog steeds mis → dat ene
  // product overslaan (telt als mislukt) en doorgaan. Nooit meer een run die
  // halverwege dood valt op "Unexpected token 'A' … is not valid JSON".
  async function execFix(fix, ids, options, skipBackup) {
    const backup = skipBackup ? null : backupPlanFor(fix.id);
    const blockId = newBlock(fix.label, ids.length);
    const tot = { done: 0, total: ids.length, fixed: 0, failed: 0, skipped: 0, label: fix.label };
    setFixProg({ ...tot });
    let cursor = 0;
    let chunk = null; // null = server-standaard
    let gatewayFails = 0;
    try {
      for (;;) {
        if (stopRef.current) break;
        let r;
        let data = null;
        try {
          r = await fetch("/api/doctor-fix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ store: storeBody, fix: fix.id, ids, options, cursor, backup, skipBackup, chunk }),
          });
          const text = await r.text();
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
        } catch (e) {
          data = null; // netwerkfout → zelfde pad als gateway-fout
        }

        const gatewayError = !data || (!r.ok && [502, 503, 504].includes(r.status));
        if (gatewayError) {
          gatewayFails++;
          if (gatewayFails > 12) throw new Error("server blijft time-outen — probeer later opnieuw of kies een kleinere selectie");
          const current = chunk || (data && data.chunk) || 8;
          if (current > 1) {
            chunk = Math.max(1, Math.floor(current / 2));
            blockDetail(blockId, [`server-timeout (Vercel) — chunk verkleind naar ${chunk}, zelfde positie opnieuw`]);
            continue;
          }
          // chunk 1 en nog steeds mis: dit ene product overslaan
          tot.failed += 1;
          tot.done = cursor + 1;
          setFixProg({ ...tot });
          blockDetail(blockId, [`product ${ids[cursor]}: server-timeout ook als losse stap — overgeslagen`]);
          cursor += 1;
          if (cursor >= ids.length) break;
          continue;
        }

        if (!r.ok) throw new Error(data.error || r.status);
        tot.done = data.nextCursor != null ? data.nextCursor : tot.total;
        tot.fixed += data.fixed || 0;
        tot.failed += data.failed || 0;
        tot.skipped += data.skipped || 0;
        setFixProg({ ...tot });
        if (data.notes && data.notes.length) blockDetail(blockId, data.notes);
        if (data.done) break;
        cursor = data.nextCursor;
      }
    } catch (e) {
      blockDone(blockId, `gestopt: ${String(e.message || e).slice(0, 120)}`, tot.failed + 1);
      throw e;
    }
    const backupTxt = backup ? ` · backup "${backup.tab}"` : " · zonder backup";
    if (options && options.dryRun) {
      blockDone(blockId, `controle: ${tot.fixed} zouden veranderen · ${tot.skipped} al goed of overgeslagen · ${tot.failed} mislukt — er is niets aangepast`, tot.failed);
    } else {
      blockDone(blockId, `${tot.fixed} aangepast · ${tot.skipped} overgeslagen · ${tot.failed} mislukt${backupTxt}`, tot.failed);
    }
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
    try {
      const tot = await execFix(
        { id: "apply-change-plan", label: `Controle "${cp.name || cpName}" — verandert niets` },
        ids,
        fixOptions({ plan: map, dryRun: true }),
        true
      );
      setCpCheck(tot);
      sfx(tot.failed ? "error" : "success");
    } catch (e) {
      setErr(`Controle gestopt: ${String(e.message || e)}`);
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
    try {
      const tot = await swTypePass(b.skipBackup, photo);
      sfx(tot.failed ? "error" : "success");
      if (rep) await scan({ keepAi: true, silent: true });
    } catch (e) {
      setErr(`Producttypes gestopt: ${String(e.message || e)}`);
      setSwInfo("");
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
      try {
        await swTypePass(b.skipBackup);
      } catch (e) {
        setErr(`Producttypes (Cas) overgeslagen: ${String(e.message || e)} — de scan loopt gewoon door.`);
      } finally {
        setFixBusy(null);
        setFixProg(null);
      }
      if (stopRef.current) return;
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
    const aiEst = (n * (AI_EST["photo-audit"] + AI_EST.gender + AI_EST.language + AI_EST.watermark + AI_EST["color-photo"]) + 0.05).toFixed(2);
    const zeker = window.confirm(
      `FIX ALLES over ${rep ? n : "max " + n} producten (markt: ${market || "—"}):\n\n` +
        `1. Alle veilige fixes — foto's her-koppelen, gender uit titel (incl. dubbele Men+Women-tags), opties vertalen, maten klant-logisch maken, variant-prijzen gelijktrekken, barcodes, vendor, product type, alt-teksten, maten-volgorde, templates, publiceren, doorstreepprijzen, titels opschonen\n` +
        `2. Alle AI-controles (geschat ±$${aiEst}) — eerst de strenge foto-audit (man op de foto bij een Women's-product = eruit/gearchiveerd; jas in Tank Tops = uit die collectie), dan geslacht, taal, watermerk, kleur↔foto, steekproef\n` +
        `3. Eindverslag — verwijderen doe ik NOOIT automatisch; dat komt als beslissing in het verslag\n\n` +
        `Pauzeren kan altijd; daarna werk je gewoon per onderdeel verder. Starten?`
    );
    if (!zeker) return;
    const b = askBackupSkip();
    if (!b.ok) return;
    setFixBusy("all");
    setErr("");
    setVerslag(null);
    setFixLog([]);
    stopRef.current = false;
    const V = { auto: [], ai: [], open: [], usd: 0, paused: false };
    try {
      /* ALTIJD vers scannen — een oud rapport op het scherm (bv. van vóór
         een deploy of van een andere run) mag nooit het fix-plan sturen. */
      const report = await scan({ silent: true });
      if (!report) throw new Error("scan mislukt");

      /* FASE 1 — veilige fixes in logische volgorde */
      const jobs = new Map();
      for (const f of report.findings) {
        for (const fx of f.fixes || []) {
          if (!FIXALL_ORDER.includes(fx.id)) continue;
          if (!orgDoc.sizeGuides && fx.id === "fix-size-guides") continue; // Sa Collective: geen maattabellen
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
      let allIds = report.productIds || [];
      if (!stopRef.current && allIds.length) {
        /* Foto-audit eerst: misgenderd = eruit (archiveren), verkeerde collectie = tag eraf */
        const pa = await runAiCore("photo-audit", allIds);
        V.usd += pa.usd;
        const mis = pa.results.filter((m) => m.kind === "gender");
        const fitList = pa.results.filter((m) => m.kind === "fit" && !mis.some((x) => x.id === m.id));
        if (mis.length) {
          const tot = await execFix({ id: "archive-products", label: "Misgenderde producten eruit (archiveren)" }, mis.map((m) => m.id), fixOptions(), b.skipBackup);
          V.ai.push(`Foto-audit: ${mis.length} misgenderd product(en) → ${tot.fixed} gearchiveerd (terug te zetten via Products → Archived)`);
          const gone = new Set(mis.map((m) => String(m.id)));
          allIds = allIds.filter((id) => !gone.has(String(id)));
        }
        if (fitList.length) {
          const fit = {};
          for (const m of fitList) fit[String(m.id)] = { drop: m.drop, add: m.add };
          const tot = await execFix({ id: "fix-collection-fit", label: "Uit verkeerde collecties halen" }, fitList.map((m) => m.id), fixOptions({ fit }), b.skipBackup);
          V.ai.push(`Foto-audit: ${fitList.length} product(en) in een verkeerde collectie → ${tot.fixed} rechtgezet`);
        }
        if (!mis.length && !fitList.length) V.ai.push("Foto-audit: geslacht en collecties kloppen met de foto's");
      }
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

  const scoreColor = (s) => (s >= 8.5 ? "var(--ok)" : s >= 6.5 ? "var(--warn)" : "var(--err)");
  const disabled = !store || busy || !!fixBusy || !!aiBusy;

  return (
    <div>
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

      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={scanClick} disabled={disabled}>
          {busy ? "Scannen…" : fixBusy === "sw-types" ? "Producttypes zetten…" : "✚ Scan producten"}
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

      {fixLog.length > 0 && (
        <div className="logpanel" style={{ marginTop: 10, maxHeight: 260 }}>
          {fixLog.map((b) => (
            <div key={b.id} className="log" style={{ display: "block" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span className={b.status === "busy" ? "muted" : b.failed ? "warn" : "ok"}>
                  {b.status === "busy" ? "▸" : b.failed ? "⚠" : "✓"}
                </span>
                <span style={{ flex: 1, fontWeight: 600 }}>{b.label}</span>
                <span className="muted small">{b.status === "busy" ? `bezig… (${b.total})` : b.sum}</span>
              </div>
              {b.details.length > 0 && (
                <div style={{ paddingLeft: 20, marginTop: 3 }}>
                  {(b.open ? b.details : b.details.slice(0, 4)).map((d, i) => (
                    <div
                      key={i}
                      className="hint"
                      style={{ marginTop: 1, ...(/MISLUKT|LET OP/.test(d) ? { color: "var(--err)" } : {}) }}
                    >
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
            <span className="prog-title">
              Rapport · {rep.scope && rep.scope.mode === "latest" ? `laatste ${rep.scanned} producten` : `${rep.scanned} producten`}
              {rep.statusCount ? ` (${rep.statusCount.active} actief · ${rep.statusCount.draft} draft)` : ""}
            </span>
            <span className="prog-count" style={{ color: scoreColor(rep.stats.score) }}>
              {String(rep.stats.score).replace(".", ",")}/10
            </span>
          </div>
          <div className="prog-meta">
            <span>
              <span className="err">{rep.stats.errors} fouten</span>
              <span className="prog-sep"> · </span>
              {rep.stats.warns} waarschuwingen
              {repAt ? (
                <span className="muted">
                  <span className="prog-sep"> · </span>
                  bijgewerkt {String(repAt.getHours()).padStart(2, "0")}:{String(repAt.getMinutes()).padStart(2, "0")}
                </span>
              ) : null}
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

      {store && (
        <div style={{ marginTop: 14 }}>
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
                              {check === "photo-audit" && ` — ${m.kind === "gender" ? "⚠ misgenderd: " : "collectie: "}${m.why}`}
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
