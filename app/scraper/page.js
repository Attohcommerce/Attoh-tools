"use client";

import { useEffect, useRef, useState } from "react";
import Header from "../components/Header";
import { analyzeKeyword, alternativeIsSafe, hardAttributes } from "@/lib/fashion";

const LS = {
  stores: "sa_competitor_stores",
  keywords: "sa_scraper_keywords",
  workSheet: "sa_sheet_work",
  memSheet: "sa_sheet_memory",
  runTab: "sa_run_tab",
  newTab: "sa_new_tab",
  orgSheet: "sa_org_sheet",
  orgTab: "sa_org_tab",
};

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

const HEADER_ROW = [
  "LINK", "TITEL", "KEYWORD", "GEVONDEN VIA", "MATCH", "GESLACHT",
  "DUBBELE FOTO", "LITERAL-TWIJFEL", "COLLECTIE", "TYPE", "TITELVORM",
];

// Stores verlopen automatisch na 14 dagen zonder gebruik van de tool
const STORE_TTL_DAYS = 14;
const LS_LAST_ACTIVE = "sa_last_active";

// Slim zoeken (underdog-keywords) — de trap-ladder per keyword:
//   store 1-2   → alleen het originele keyword (+ eerder bewezen winnaar)
//   store 3+    → ook de AI-alternatieven (vóór de run al klaargezet)
//   store 8+    → ook het brede vangnet (kale producttype, bv. "dress")
//   store 6     → instructie-paneel (overslaan / doorgaan) — loopt gewoon door
//   store 20    → nog steeds 0? automatisch door naar het volgende keyword
const ALTS_AT = 3;
const BROAD_AT = 8;
const STALL_PROMPT_AT = 6;
const STALL_AUTO_AT = 20;

// Geleerde kennis blijft bewaard tussen runs:
const LS_ALTS = "sa_kw_alts"; // kw → AI-alternatieven (cache, geen dubbele AI-calls)
const LS_ALT_HITS = "sa_kw_alt_hits"; // kw → alternatief dat eerder écht producten vond
// kw → product-briefing (wat IS dit product?). Het versienummer hoort bij de
// VELDEN in de briefing: zodra er een veld bijkomt (zoals titleForm) moeten
// oude briefings opnieuw gemaakt worden. Zonder dit nummer bleef een briefing
// van vóór titleForm eeuwig in de cache staan en bleef kolom K leeg.
const BRIEF_VERSION = 2;
const LS_BRIEFS = `sa_kw_briefs_v${BRIEF_VERSION}`;

// Maximaal aandeel van één concurrent in de hele import-lijst. Zonder deze
// grens kwam de helft van de store van één winkel — zelfde leveranciersfoto's,
// zelfde assortiment, en daarmee een herkenbare kopie.
const MAX_STORE_SHARE = 0.25;

// Breed vangnet: het kale producttype uit het keyword ("black knee high boots"
// → "boots"). Lukt dat niet, dan het laatste woord van het beste AI-alternatief.
function broadTermFor(keyword, alts) {
  try {
    const a = analyzeKeyword(String(keyword).toLowerCase());
    if (a && a.typeTerms && a.typeTerms.length > 1) {
      return a.typeTerms[0].join(" ");
    }
  } catch {}
  if (alts && alts.length) {
    const w = alts[alts.length - 1].split(/\s+/);
    return w[w.length - 1];
  }
  return null;
}

// Vaste geheugen-sheet — staat altijd automatisch ingevuld, ook na
// Reset session, nieuwe logins of een andere browser.
const DEFAULT_MEM_SHEET =
  "https://docs.google.com/spreadsheets/d/1gbu2XAZMPBIbyr47B_rBvoHDcWoVaTNUuBNwmp9ucJg/edit";

// Vaste import-werksheet (de import-lijst) — automatisch ingevuld;
// alleen de bladnaam per run kies je zelf.
const DEFAULT_WORK_SHEET =
  "https://docs.google.com/spreadsheets/d/1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE/edit";

// Vaste "Collection & Product organization"-sheet — automatisch ingevuld;
// de exacte bladnaam geef je zelf door (niet automatisch).
const DEFAULT_ORG_SHEET =
  "https://docs.google.com/spreadsheets/d/1MaVHQ76s54lrZkNPfr-J32y7GvjJpLfV2j-m0MvXO3g/edit";

/**
 * Geplakte keyword-lijsten parsen — snapt alles:
 *  - één keyword per regel ("occasion dress")
 *  - keyword + aantal als twee kolommen ("occasion dress<tab>10")
 *  - een hele rij náást elkaar uit een sheet ("kw1<tab>kw2<tab>kw3…")
 *  - komma- of puntkomma-gescheiden lijsten
 */
function parseKwPaste(text) {
  const out = [];
  for (const line of String(text || "").split(/\n+/)) {
    if (!line.trim()) continue;
    const cells = line.split(/\t|;|,/).map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;
    if (cells.length === 2 && /^\d+$/.test(cells[1])) {
      // klassiek: keyword + aantal
      out.push({ k: cells[0], n: Number(cells[1]) });
    } else if (cells.every((c, i) => i % 2 === 1 ? /^\d+$/.test(c) : !/^\d+$/.test(c)) && cells.length % 2 === 0 && cells.length > 2) {
      // afwisselend keyword, aantal, keyword, aantal…
      for (let i = 0; i < cells.length; i += 2) out.push({ k: cells[i], n: Number(cells[i + 1]) });
    } else {
      // elke cel is een eigen keyword (hele rij gekopieerd)
      for (const c of cells) {
        if (/^\d+$/.test(c)) continue; // losse getallen overslaan
        out.push({ k: c, n: 10 });
      }
    }
  }
  return out;
}

function storeOf(link) {
  try {
    return new URL(link).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function ScraperPage() {
  const [storeInput, setStoreInput] = useState("");
  const [storeList, setStoreList] = useState([]);
  const [kw, setKw] = useState({ vrouw: [{ k: "", n: 10 }], man: [{ k: "", n: 10 }] });
  const [workSheet, setWorkSheet] = useState("");
  const [memSheet, setMemSheet] = useState("");
  const [runTab, setRunTab] = useState("");
  const [newTabName, setNewTabName] = useState("");
  const [saEmail, setSaEmail] = useState(null);
  // Verdeling (Collection & Product organization) inladen
  const [orgSheet, setOrgSheet] = useState("");
  const [orgTab, setOrgTab] = useState("Collection & Product organization");
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgInfo, setOrgInfo] = useState(null);

  const [running, setRunning] = useState(false);
  const [checkBusy, setCheckBusy] = useState("");
  const [logs, setLogs] = useState([]);
  // Instructie-paneel voor vastgelopen keywords
  const [stall, setStall] = useState(null); // {kw, gender} zolang het paneel zichtbaar is
  const stallDecision = useRef(null); // "skip" | "ai" | "continue"
  // Pauzeren / stoppen tijdens de run
  const [paused, setPaused] = useState(false);
  const controlRef = useRef("run"); // "run" | "pause" | "stop-save" | "stop-delete"
  // Voortgangsbalk
  const [prog, setProg] = useState(null); // {target, found, kwDone, kwTotal, currentKw, currentGender, kwTarget, kwFound}

  useEffect(() => {
    // Stores automatisch wissen als de tool 14+ dagen niet gebruikt is
    const lastActive = Number(load(LS_LAST_ACTIVE, 0)) || 0;
    const expired = lastActive && Date.now() - lastActive > STORE_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (expired) {
      save(LS.stores, []);
      setStoreList([]);
    } else {
      setStoreList(load(LS.stores, []));
    }
    save(LS_LAST_ACTIVE, Date.now());
    setKw(load(LS.keywords, { vrouw: [{ k: "", n: 10 }], man: [{ k: "", n: 10 }] }));
    setWorkSheet(load(LS.workSheet, "") || DEFAULT_WORK_SHEET);
    setMemSheet(load(LS.memSheet, "") || DEFAULT_MEM_SHEET);
    setRunTab(load(LS.runTab, ""));
    setNewTabName(load(LS.newTab, ""));
    setOrgSheet(load(LS.orgSheet, "") || DEFAULT_ORG_SHEET);
    setOrgTab(load(LS.orgTab, "Collection & Product organization"));
    fetch("/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "info" }),
    })
      .then((r) => r.json())
      .then((d) => setSaEmail(d.serviceAccountEmail))
      .catch(() => {});
  }, []);

  function pushLog(line) {
    setLogs((l) => [...l, line]);
  }

  // ---------- Competitor stores ----------
  function addStores(raw) {
    const items = String(raw || "")
      .split(/[\n,]+/)
      .map((s) =>
        s
          .trim()
          .replace(/^https?:\/\//i, "")
          .replace(/\/.*$/, "")
          .replace(/^www\./i, "")
      )
      .filter(Boolean);
    if (!items.length) return;
    const next = [...new Set([...storeList, ...items])];
    setStoreList(next);
    save(LS.stores, next);
    setStoreInput("");
  }

  function removeStoreItem(dom) {
    const next = storeList.filter((s) => s !== dom);
    setStoreList(next);
    save(LS.stores, next);
  }

  function clearAllStores() {
    setStoreList([]);
    save(LS.stores, []);
    pushLog({ muted: true, text: "Alle competitor stores gewist." });
  }

  function clearAllKeywords() {
    const empty = { vrouw: [{ k: "", n: 10 }], man: [{ k: "", n: 10 }] };
    setKw(empty);
    save(LS.keywords, empty);
    setOrgInfo(null);
    pushLog({ muted: true, text: "Alle keywords gewist." });
  }

  // ---------- Keywords ----------
  function setGroup(group, rows) {
    const next = { ...kw, [group]: rows };
    setKw(next);
    save(LS.keywords, next);
  }

  function updateKwRow(group, idx, field, value) {
    const rows = kw[group].map((r, i) => (i === idx ? { ...r, [field]: value } : r));
    setGroup(group, rows);
  }

  function handleKwPaste(group, idx, e) {
    const text = e.clipboardData?.getData("text") || "";
    if (!text.includes("\n") && !text.includes("\t")) return;
    e.preventDefault();
    const parsed = parseKwPaste(text);
    if (!parsed.length) return;
    const rows = [...kw[group]];
    rows.splice(idx, 1, ...parsed);
    setGroup(group, rows);
  }

  // Bulk-plakveld: hele lijst (ook 100+) in één keer, lege rijen verdwijnen
  function handleBulkPaste(group, e) {
    const text = e.clipboardData?.getData("text") || "";
    if (!text.trim()) return;
    e.preventDefault();
    const parsed = parseKwPaste(text);
    if (!parsed.length) return;
    const existing = kw[group].filter((r) => r.k.trim());
    setGroup(group, [...existing, ...parsed]);
    pushLog({ ok: true, text: `${parsed.length} keywords geplakt bij ${group === "vrouw" ? "Vrouw" : "Man"}.` });
    window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "ok" }));
  }

  function saveSheets(w, m) {
    setWorkSheet(w);
    setMemSheet(m);
    save(LS.workSheet, w);
    save(LS.memSheet, m);
  }

  // ---------- Verdeling inladen (Collection & Product organization) ----------
  async function loadVerdeling() {
    if (orgBusy || running) return;
    const sheet = orgSheet.trim();
    const tab = orgTab.trim();
    if (!sheet) return alert2("Plak eerst de link van de organization-sheet.");
    if (!tab) return alert2("Vul de exacte bladnaam in.");
    setOrgBusy(true);
    setOrgInfo(null);
    try {
      save(LS.orgSheet, sheet);
      save(LS.orgTab, tab);
      pushLog({ strong: true, text: `— Verdeling inladen uit "${tab}"` });
      const data = await sheetsCall({ action: "read", sheetId: sheet, range: `'${tab}'!A1:I` });
      const values = data.values || [];
      if (!values.length) throw new Error(`Tabblad "${tab}" is leeg of bestaat niet`);

      // Header exact herkennen zoals de Keywords-tool hem wegschrijft:
      // A Rank · B Keyword · C Collectie · D Groep · … · H Aantal producten
      const h = (values[0] || []).map((x) => String(x || "").toLowerCase());
      if (!String(h[1] || "").startsWith("keyword") || !String(h[3] || "").startsWith("groep") || !String(h[7] || "").startsWith("aantal")) {
        throw new Error(
          `Dit blad heeft niet het verdeling-formaat (verwacht: Rank · Keyword · Collectie · Groep · … · Aantal producten). Controleer de bladnaam.`
        );
      }

      const parsed = [];
      for (const r of values.slice(1)) {
        const k = String(r[1] || "").trim();
        if (!k) continue;
        const n = Math.max(1, Number(r[7]) || 0);
        const g = String(r[3] || "").trim().toUpperCase() === "M" ? "man" : "vrouw";
        const col = String(r[2] || "").trim(); // C = Collectie — reist mee naar de importlijst
        const type = String(r[8] || "").trim() || "Direct"; // I = Type (Direct/Attribuut/Gelegenheid)
        parsed.push({ k, n, g, col, type });
      }
      if (!parsed.length) throw new Error("Geen keywords gevonden in dit blad");

      const vrouw = parsed.filter((p) => p.g === "vrouw").map(({ k, n, col, type }) => ({ k, n, col, type }));
      const man = parsed.filter((p) => p.g === "man").map(({ k, n, col, type }) => ({ k, n, col, type }));
      const lastig = parsed.filter((p) => p.type === "Gelegenheid").length;
      if (lastig) {
        pushLog({
          muted: true,
          text: `${lastig} gelegenheids-keywords gevonden (bv. "christmas party dress") — die worden anders gescrapet: zoeken op fysieke proxies + foto-controle.`,
        });
      }
      const next = {
        vrouw: vrouw.length ? vrouw : [{ k: "", n: 10 }],
        man: man.length ? man : [{ k: "", n: 10 }],
      };
      setKw(next);
      save(LS.keywords, next);

      const sum = (rows) => rows.reduce((s, r) => s + (Number(r.n) || 0), 0);
      setOrgInfo({ vrouwKw: vrouw.length, vrouwN: sum(vrouw), manKw: man.length, manN: sum(man) });
      pushLog({
        ok: true,
        text: `Verdeling geladen — Vrouw: ${vrouw.length} keywords (${sum(vrouw)} producten) · Man: ${man.length} keywords (${sum(man)} producten). De lijst staat nu in het Keywords-blok.`,
      });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: "Verdeling laden mislukt: " + e.message });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setOrgBusy(false);
    }
  }

  // ---------- Scrape-run ----------
  async function sheetsCall(body) {
    const res = await fetch("/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  }

  async function start() {
    if (running) return;
    const stores = storeList;
    const groups = [
      ["Vrouw", kw.vrouw.filter((r) => r.k.trim())],
      ["Man", kw.man.filter((r) => r.k.trim())],
    ];
    const totalKw = groups.reduce((a, [, rows]) => a + rows.length, 0);
    if (!stores.length) return alert2("Voeg eerst competitor stores toe.");
    if (!totalKw) return alert2("Voeg minstens één keyword toe.");
    if (!workSheet.trim()) return alert2("Vul de werk-sheet in.");

    setRunning(true);
    setLogs([]);
    controlRef.current = "run";
    setPaused(false);
    // Voortgangsbalk meteen tonen — mét de besturingsknoppen erin
    const totalTarget = groups.reduce((a, [, rows2]) => a + rows2.reduce((s, r) => s + (Number(r.n) || 10), 0), 0);
    const kwTotal = groups.reduce((a, [, rows2]) => a + rows2.length, 0);
    let kwDone = 0;
    setProg({ target: totalTarget, found: 0, kwDone: 0, kwTotal, currentKw: "", currentGender: "", kwTarget: 0, kwFound: 0 });
    // Voor Stop & verwijderen: wat er deze run is aangemaakt/toegevoegd
    let runTabId = null;
    let runTabTitle = "";
    let memAdded = 0;

    // Pauze = wachten tot Hervat; Stop = netjes uit alle loops breken
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const checkControl = async () => {
      while (controlRef.current === "pause") await sleep(400);
      if (controlRef.current === "stop-save") throw { stop: "save" };
      if (controlRef.current === "stop-delete") throw { stop: "delete" };
    };

    try {
      // Elke run een eigen, schoon tabblad in het werkboek.
      // Eigen bladnaam ingevuld? Die gebruiken — anders automatisch "Run d-m uu:mm".
      const d = new Date();
      const autoTitle = `Run ${d.getDate()}-${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const runTitle = newTabName.trim() || autoTitle;
      const tabRes = await sheetsCall({
        action: "createTab",
        sheetId: workSheet,
        title: runTitle,
        header: HEADER_ROW,
      });
      setRunTab(tabRes.title);
      save(LS.runTab, tabRes.title);
      runTabId = tabRes.tabId;
      runTabTitle = tabRes.title;
      pushLog({ ok: true, text: `Tabblad "${tabRes.title}" aangemaakt`, href: tabRes.url });
      if (!tabRes.existed) {
        try {
          await sheetsCall({ action: "formatRun", sheetId: workSheet, tabId: tabRes.tabId });
          pushLog({ muted: true, text: "Import-lijst netjes opgemaakt — kleurcodes, filter en banding staan aan." });
        } catch {
          /* opmaak is nice-to-have */
        }
      }

      // Exclusie: het permanente geheugen (dé bron tegen dubbel scrapen)
      const exclude = new Set();
      if (memSheet.trim()) {
        const mem = await sheetsCall({ action: "read", sheetId: memSheet, range: "A:A" });
        for (const r of mem.values || [])
          if (r[0] && r[0].startsWith("http")) exclude.add(r[0].toLowerCase().replace(/\/$/, ""));
      }
      pushLog({ muted: true, text: `${exclude.size} bekende links worden overgeslagen (geheugen).` });

      /* Spreiding over concurrenten + ontdubbeling op producttitel.
         Bij dropshipping verkopen tien winkels exact hetzelfde artikel; de
         link is dan uniek maar het product niet. Vorige run stonden er twee
         identieke producten in de lijst en kwam de helft van één winkel. */
      const perStore = new Map(); // domein → aantal in deze run
      const seenTitles = new Set(); // genormaliseerde titel → al opgenomen
      const normTitle = (t) =>
        String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      let storeCapHits = 0;
      let titleDupHits = 0;

      /* ---- Slim zoeken voorbereiden: AI-alternatieven voor ALLE keywords
              in één batch, vóór de run — geen wachttijd meer onderweg ---- */
      const altCache = load(LS_ALTS, {});
      const altHits = load(LS_ALT_HITS, {});
      const allKwItems = [];
      for (const [g2, rows2] of groups) for (const { k } of rows2) allKwItems.push({ kw: k.toLowerCase(), gender: g2 });

      /* ---- Product-briefings: eerst WETEN wat elk keyword werkelijk is,
              daarna pas zoeken. De briefing (definitie, harde eisen,
              disqualifiers, klassieke verwarringen) stuurt straks de
              foto-controle van elk gevonden product. ---- */
      const briefCache = load(LS_BRIEFS, {});
      const missingBriefs = allKwItems.filter((x) => !briefCache[x.kw]);
      if (missingBriefs.length) {
        try {
          pushLog({ muted: true, text: `Productkennis opbouwen — AI bepaalt voor ${missingBriefs.length} keywords wat het product precies is…` });
          const res = await fetch("/api/keyword-brief", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keywords: missingBriefs }),
          });
          const data = await res.json();
          if (res.ok && data.map) {
            Object.assign(briefCache, data.map);
            save(LS_BRIEFS, briefCache);
            pushLog({ ok: true, text: `Productkennis klaar — elk gevonden product wordt tegen zijn eigen definitie gecontroleerd.` });
          }
        } catch (e) {
          pushLog({ warn: true, text: `Productkennis laden mislukt (${e.message}) — de foto-controle draait dan op algemene kennis.` });
        }
      }
      const missingAlts = allKwItems.filter((x) => !altCache[x.kw]);
      if (missingAlts.length) {
        try {
          pushLog({ muted: true, text: `Slim zoeken voorbereiden — AI bedenkt alternatieven voor ${missingAlts.length} keywords…` });
          const res = await fetch("/api/keyword-fallback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keywords: missingAlts }),
          });
          const data = await res.json();
          if (res.ok && data.map) {
            Object.assign(altCache, data.map);
            save(LS_ALTS, altCache);
            pushLog({ ok: true, text: `Alternatieven klaar — slim zoeken start al na ${ALTS_AT} lege stores, zonder wachttijd.` });
          }
        } catch (e) {
          pushLog({ warn: true, text: `Alternatieven vooraf laden mislukt (${e.message}) — geen probleem, de run draait gewoon.` });
        }
      }

      let grandTotal = 0;
      const hardKeywords = []; // bleef op 0 ondanks alles
      for (const [gender, rows] of groups) {
        for (const { k, n, col, type } of rows) {
          let needed = Number(n) || 10;
          const target = needed;
          const kwBrief = briefCache[k.toLowerCase()] || null;
          // Type uit de organization-sheet, of anders uit de AI-briefing
          const kwType =
            type ||
            (kwBrief && kwBrief.kwType === "occasion"
              ? "Gelegenheid"
              : kwBrief && kwBrief.kwType === "attribute"
              ? "Attribuut"
              : "Direct");
          const isOccasion = kwType === "Gelegenheid" || (kwBrief && kwBrief.kwType === "occasion");
          pushLog({ strong: true, text: `— ${gender} · "${k}" · ${target} producten · ${kwType}` });
          if (kwBrief && kwBrief.definition) {
            pushLog({ muted: true, text: `Wat is een "${k}"? ${kwBrief.definition}` });
            if (kwBrief.not && kwBrief.not.length) {
              pushLog({ muted: true, text: `Afgekeurd wordt: ${kwBrief.not.slice(0, 3).join(" · ")}` });
            }
          }
          setProg((p) => ({ ...p, currentKw: k, currentGender: gender, kwTarget: target, kwFound: 0 }));

          // Per keyword: schone staat + de zoek-ladder
          stallDecision.current = null;
          setStall(null);
          const kwLower = k.toLowerCase();
          const alts = altCache[kwLower] || [];
          const provenHit = altHits[kwLower]; // alternatief dat vorige keer scoorde
          let terms = provenHit && provenHit !== kwLower ? [k, provenHit] : [k];
          // GELEGENHEIDS-KEYWORDS: geen enkele shop titelt een product
          // "christmas party dress". Wachten tot de letterlijke zoekterm
          // faalt is zonde van de tijd — de fysieke proxies uit de briefing
          // (sequin dress, velvet dress, sparkly midi…) gaan meteen mee, en
          // de foto-controle bewaakt daarna of het écht past.
          if (isOccasion && kwBrief && kwBrief.searchTerms && kwBrief.searchTerms.length) {
            const safe = kwBrief.searchTerms.filter((t) => alternativeIsSafe(k, t));
            if (safe.length) {
              terms = [...new Set([...terms, ...safe])];
              pushLog({
                muted: true,
                text: `Lastig keyword — zoekt meteen ook op: ${safe.join(" · ")}`,
              });
            }
          }
          let altsFull = false;
          let broadActive = false;
          let storesTried = 0;

          const expandAlts = (reason) => {
            if (altsFull) return;
            altsFull = true;
            // Een alternatief mag het producttype verbreden, maar nooit een
            // kleur, materiaal of patroon laten vallen: "camouflage pants" →
            // "cargo pants" en "gold heels" → "heels" leverden vorige run
            // producten op die het keyword totaal niet waren.
            const safeAlts = alts.filter((a) => alternativeIsSafe(k, a));
            const dropped = alts.filter((a) => !safeAlts.includes(a));
            if (dropped.length) {
              pushLog({ muted: true, text: `Alternatieven geweigerd (verliezen "${hardAttributes(k).join(", ")}"): ${dropped.join(" · ")}` });
            }
            const merged = [...new Set([...terms, ...safeAlts])];
            if (merged.length > terms.length) {
              terms = merged;
              pushLog({ ok: true, text: `${reason} — zoekt nu ook op: ${safeAlts.join(" · ")} (telt mee voor "${k}").` });
            }
          };
          const expandBroad = () => {
            if (broadActive) return;
            broadActive = true;
            // Bij een keyword met een harde eigenschap bestaat er geen breed
            // vangnet: "boots" is geen vervanging voor "waterproof boots".
            if (hardAttributes(k).length) {
              pushLog({ muted: true, text: `Geen breed vangnet voor "${k}" — de eigenschap "${hardAttributes(k).join(", ")}" mag niet wegvallen.` });
              return;
            }
            const b = broadTermFor(k, alts);
            if (b && !terms.some((t) => t.toLowerCase() === b)) {
              terms = [...terms, b];
              pushLog({ ok: true, text: `Breed vangnet actief — ook op "${b}" (strenge match + geslacht blijven gelden).` });
            }
          };

          // Eén ronde langs alle stores met de huidige zoektermen
          const scanStores = async (withStallLogic) => {
            for (const store of stores) {
              await checkControl();
              if (needed <= 0) return;
              if (stallDecision.current === "skip" || stallDecision.current === "skip-auto") return;
              if (stallDecision.current === "ai") {
                setStall(null);
                stallDecision.current = "continue";
                expandAlts("Op jouw verzoek");
                expandBroad();
              }
              let foundThisStore = 0;
              let scanned = 0;
              let bestSelling = false;
              const skips = { soldOut: 0, tooFewImages: 0, gender: 0, foreign: 0 };
              for (const term of terms) {
                if (needed <= 0) break;
                try {
                  const res = await fetch("/api/scraper-search", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      store,
                      keyword: term,
                      gender,
                      need: needed,
                      excludeLinks: [...exclude],
                      // Nooit het hele quotum uit één winkel: pak van elke
                      // winkel de bovenkant in plaats van de staart van één.
                      maxPerStore: Math.max(2, Math.ceil(target / 3)),
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || res.status);
                  let found = data.matches || [];
                  scanned = Math.max(scanned, data.total || 0);
                  bestSelling = bestSelling || !!data.usedBestSelling;
                  if (data.skipped) for (const key of Object.keys(skips)) skips[key] += data.skipped[key] || 0;

                  // FOTO-CONTROLE OP ELK PRODUCT — niet alleen bij
                  // via-alternatieven. De tekstmatcher kan een keyword te ruim
                  // uitleggen ("cocktail dress" matchte op elke party/evening
                  // dress); Claude kijkt daarom naar de FOTO en toetst tegen de
                  // product-briefing van dit keyword. Alleen bij een kaal
                  // producttype zonder eisen (bv. "boots") slaan we het over,
                  // want daar valt weinig te verwarren.
                  const needsCheck =
                    !!kwBrief || term !== k || k.trim().split(/\s+/).length > 1;
                  if (found.length && needsCheck) {
                    try {
                      const vres = await fetch("/api/verify-products", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          keyword: k,
                          gender,
                          brief: kwBrief,
                          items: found.map((m, fi) => ({
                            index: fi,
                            title: m.title,
                            image: m.image || null,
                            images: m.images || null,
                            needsPhotoProof: !!m.needsPhotoProof,
                          })),
                        }),
                      });
                      const vdata = await vres.json();
                      if (vres.ok && Array.isArray(vdata.reject) && vdata.reject.length) {
                        const bad = new Set(vdata.reject.map((r) => r.index));
                        const reasons = [
                          ...new Set(vdata.reject.map((r) => String(r.reason || "").trim()).filter(Boolean)),
                        ].slice(0, 2);
                        const kept = found.filter((_, fi) => !bad.has(fi));
                        pushLog({
                          muted: true,
                          text:
                            `Foto-controle: ${found.length - kept.length} van ${found.length} afgekeurd voor "${k}"` +
                            (reasons.length ? ` — ${reasons.join(" · ")}` : ""),
                        });
                        found = kept;
                      }
                    } catch {
                      /* vision-check niet beschikbaar → producten gewoon meenemen */
                    }
                  }

                  /* Spreiding: nooit meer dan MAX_STORE_SHARE van de hele
                     lijst uit één winkel, en nooit twee keer hetzelfde
                     product (zelfde titel bij een andere dropship-winkel). */
                  if (found.length) {
                    const dom = storeOf(found[0].link) || store;
                    const capTotal = Math.max(20, Number(totalTarget) || 0);
                    const cap = Math.ceil(capTotal * MAX_STORE_SHARE);
                    const already = perStore.get(dom) || 0;
                    const room = Math.max(0, cap - already);
                    if (found.length > room) {
                      storeCapHits += found.length - room;
                      found = found.slice(0, room);
                    }
                    const fresh = [];
                    for (const m of found) {
                      const nt = normTitle(m.title);
                      if (nt && seenTitles.has(nt)) {
                        titleDupHits++;
                        continue;
                      }
                      if (nt) seenTitles.add(nt);
                      fresh.push(m);
                    }
                    found = fresh;
                    if (found.length) perStore.set(dom, already + found.length);
                  }

                  if (found.length) {
                    // Origineel keyword in de sheet; via-term zichtbaar in Matchbron.
                    // Matchtype is bij via-vondsten NOOIT "Literal" — dat zou over
                    // het hulp-woord gaan, niet over jouw echte keyword.
                    const via = term === k ? "" : ` · via "${term}"`;
                    const newRows = found.map((m) => [
                      m.link,
                      m.title,
                      k,
                      m.source + via,
                      term === k ? m.literal : "Ruim",
                      gender === "Man" ? "Man" : gender === "Vrouw" ? "Vrouw" : "",
                      "",
                      "",
                      col || "",
                      kwType,
                      (kwBrief && kwBrief.titleForm) || "",
                    ]);
                    await sheetsCall({ action: "append", sheetId: workSheet, range: `'${runTitle}'!A:K`, rows: newRows });
                    if (memSheet.trim()) {
                      await sheetsCall({
                        action: "append",
                        sheetId: memSheet,
                        rows: found.map((m) => [m.link, k, new Date().toISOString().slice(0, 10)]),
                      });
                      memAdded += found.length;
                    }
                    for (const m of found) exclude.add(m.link.toLowerCase().replace(/\/$/, ""));
                    needed -= found.length;
                    grandTotal += found.length;
                    foundThisStore += found.length;
                    setProg((p) => ({ ...p, found: grandTotal, kwFound: target - needed }));
                    // Leren: dit alternatief werkt voor dit keyword → volgende run meteen eerst
                    if (term.toLowerCase() !== kwLower) {
                      altHits[kwLower] = term.toLowerCase();
                      save(LS_ALT_HITS, altHits);
                    }
                  }
                } catch (e) {
                  pushLog({ err: true, text: `${store}: ${e.message}` });
                  break;
                }
              }
              pushLog({
                ok: true,
                text:
                  `${store}: ${foundThisStore} gevonden (${scanned} producten gescand${bestSelling ? ", best-selling volgorde" : ""}) — nog ${Math.max(needed, 0)} nodig` +
                  (skips.soldOut || skips.tooFewImages || skips.gender || skips.foreign
                    ? ` · overgeslagen: ${[
                        skips.soldOut ? `${skips.soldOut} uitverkocht` : "",
                        skips.tooFewImages ? `${skips.tooFewImages} te weinig foto's` : "",
                        skips.gender ? `${skips.gender} verkeerd geslacht` : "",
                        skips.foreign ? `${skips.foreign} anderstalig zonder titelbewijs` : "",
                      ].filter(Boolean).join(" · ")}`
                    : ""),
              });
              storesTried++;

              // Vastloop-ladder: alleen zolang er nog NIETS gevonden is
              if (withStallLogic && needed === target) {
                if (storesTried >= ALTS_AT && alts.length) expandAlts(`Na ${storesTried} stores nog 0`);
                if (storesTried >= BROAD_AT) expandBroad();
                if (storesTried === STALL_PROMPT_AT && !stallDecision.current) {
                  setStall({ kw: k, gender });
                  pushLog({
                    warn: true,
                    text: `"${k}" na ${STALL_PROMPT_AT} stores nog 0 — slim zoeken is al actief; na ${STALL_AUTO_AT} stores ga ik automatisch door naar het volgende keyword.`,
                  });
                }
                if (storesTried >= STALL_AUTO_AT && stallDecision.current !== "continue") {
                  setStall(null);
                  stallDecision.current = "skip-auto";
                  pushLog({
                    warn: true,
                    text: `"${k}" na ${STALL_AUTO_AT} stores nog 0 (ook met AI + breed vangnet) — automatisch door naar het volgende keyword.`,
                  });
                  return;
                }
              }
            }
          };

          await scanStores(true);

          // Bij weinig stores kan de ladder nooit geactiveerd zijn — dan alsnog
          // één slimme ronde (tenzij het keyword is overgeslagen).
          const skipped = stallDecision.current === "skip" || stallDecision.current === "skip-auto";
          if (needed === target && !skipped && !altsFull && alts.length) {
            expandAlts("Laatste poging");
            expandBroad();
            await scanStores(false);
          }
          setStall(null);

          if (stallDecision.current === "skip") {
            pushLog({ warn: true, text: `"${k}" overgeslagen op jouw verzoek.` });
            hardKeywords.push(k);
          } else if (stallDecision.current === "skip-auto") {
            hardKeywords.push(k);
          } else if (needed === target) {
            pushLog({ warn: true, text: `"${k}": 0/${target} — ook met slim zoeken niets gevonden.` });
            hardKeywords.push(k);
          } else if (needed > 0) {
            pushLog({ warn: true, text: `"${k}": ${target - needed}/${target} gevonden — stores zijn op.` });
          } else {
            pushLog({ ok: true, text: `"${k}": ${target}/${target} compleet.` });
          }
          kwDone++;
          setProg((p) => ({ ...p, kwDone, found: grandTotal }));
        }
      }
      pushLog({ strong: true, text: `Klaar — ${grandTotal} producten in tabblad "${runTitle}".`, href: tabRes.url });
      if (hardKeywords.length) {
        pushLog({ warn: true, text: `Moeilijke keywords (0 resultaat of overgeslagen): ${hardKeywords.join(", ")}` });
      }
      if (storeCapHits || titleDupHits) {
        pushLog({
          muted: true,
          text:
            `Spreiding: ${storeCapHits} producten geweigerd omdat een winkel al op ${Math.round(MAX_STORE_SHARE * 100)}% zat` +
            `, ${titleDupHits} geweigerd omdat hetzelfde product al in de lijst stond.`,
        });
      }
      {
        const spread = [...perStore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        if (spread.length) {
          pushLog({
            muted: true,
            text: `Grootste leveranciers: ${spread.map(([d, n]) => `${d} ${Math.round((100 * n) / Math.max(1, grandTotal))}%`).join(" · ")}`,
          });
        }
      }

      /* De drie controles stonden als losse knoppen en werden daardoor
         vergeten — kolom F, G en H bleven leeg terwijl er wél mannenproducten
         en dubbele foto's in de lijst zaten. Ze draaien nu automatisch. */
      pushLog({ strong: true, text: "— Eindcontroles starten automatisch" });
      try {
        await runGenderCheck(runTabTitle);
      } catch {}
      try {
        await runDuplicateCheck(runTabTitle);
      } catch {}
      try {
        await runLiteralCheck(runTabTitle);
      } catch {}
      pushLog({ ok: true, text: "Eindcontroles klaar — kolom F (geslacht), G (dubbele foto) en H (literal-twijfel) zijn gevuld." });
    } catch (e) {
      if (e && e.stop === "save") {
        pushLog({
          strong: true,
          text: `Gestopt — alles wat gescrapet is staat veilig in tabblad "${runTabTitle}".`,
        });
      } else if (e && e.stop === "delete") {
        pushLog({ muted: true, text: "Gestopt — alles van deze run wordt verwijderd…" });
        try {
          if (runTabId !== null) {
            await sheetsCall({ action: "deleteTab", sheetId: workSheet, tabId: runTabId });
            setRunTab("");
            save(LS.runTab, "");
          }
          if (memSheet.trim() && memAdded > 0) {
            await sheetsCall({ action: "deleteTailRows", sheetId: memSheet, count: memAdded });
          }
          pushLog({ ok: true, text: `Verwijderd: tabblad "${runTabTitle}" + ${memAdded} geheugen-regels. Alsof de run nooit gebeurd is.` });
        } catch (e2) {
          pushLog({ err: true, text: "Opruimen deels mislukt: " + e2.message });
        }
      } else {
        pushLog({ err: true, text: "Fout: " + e.message });
      }
    } finally {
      setStall(null);
      setPaused(false);
      controlRef.current = "run";
      setRunning(false);
    }
  }

  // ---------- Run-besturing ----------
  function pauseRun() {
    controlRef.current = "pause";
    setPaused(true);
    pushLog({ muted: true, text: "Gepauzeerd — klik Hervat om verder te gaan." });
  }
  function resumeRun() {
    controlRef.current = "run";
    setPaused(false);
    pushLog({ muted: true, text: "Hervat." });
  }
  function stopSave() {
    controlRef.current = "stop-save";
    setPaused(false);
  }
  function stopDelete() {
    if (!window.confirm("Stop & verwijderen? Het run-tabblad en de geheugen-regels van deze run worden gewist.")) return;
    controlRef.current = "stop-delete";
    setPaused(false);
  }

  function alert2(msg) {
    pushLog({ err: true, text: msg });
    return null;
  }

  // ---------- Checks ----------
  async function runGenderCheck(forceTab) {
    if (!workSheet.trim() || checkBusy) return;
    setCheckBusy("gender");
    pushLog({ strong: true, text: "— Geslacht-check gestart (kolom F)" });
    try {
      let cursor = 2;
      let total = 0;
      for (let guard = 0; guard < 200; guard++) {
        const res = await fetch("/api/checks/gender", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetId: workSheet, tab: (forceTab || runTab).trim() || undefined, cursor }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);
        total += data.labeled || 0;
        if (data.processed) pushLog({ muted: true, text: `Rij ${cursor}–${cursor + data.processed - 1}: ${data.labeled} gelabeld` });
        if (data.done) break;
        cursor = data.nextCursor;
      }
      pushLog({ ok: true, text: `Geslacht-check klaar — ${total} rijen gelabeld (Man/Vrouw, geen twijfelgevallen).` });
    } catch (e) {
      pushLog({ err: true, text: "Geslacht-check fout: " + e.message });
    } finally {
      setCheckBusy("");
    }
  }

  async function runDuplicateCheck(forceTab) {
    if (!workSheet.trim() || checkBusy) return;
    setCheckBusy("dup");
    pushLog({ strong: true, text: "— Dubbele-foto-check gestart (kolom G)" });
    try {
      let cursor = 2;
      const items = [];
      for (let guard = 0; guard < 400; guard++) {
        const res = await fetch("/api/checks/duplicates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetId: workSheet, tab: (forceTab || runTab).trim() || undefined, action: "scan", cursor }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);
        items.push(...(data.items || []));
        pushLog({ muted: true, text: `Foto's opgehaald t/m rij ${cursor + (data.items?.length || 0) - 1}…` });
        if (data.done) break;
        cursor = data.nextCursor;
      }
      // Groeperen op foto-signature
      const bySig = new Map();
      for (const it of items) {
        for (const sig of it.sigs || []) {
          if (!bySig.has(sig)) bySig.set(sig, []);
          bySig.get(sig).push(it);
        }
      }
      const dupRows = new Map(); // row → label
      for (const [sig, list] of bySig) {
        const uniq = [...new Map(list.map((x) => [x.row, x])).values()];
        if (uniq.length < 2) continue;
        // zelfde foto op meerdere unieke links → alles behalve de eerste taggen
        uniq.sort((a, b) => a.row - b.row);
        for (let i = 1; i < uniq.length; i++) {
          const other = storeOf(uniq[0].link);
          dupRows.set(uniq[i].row, `Dubbel van rij ${uniq[0].row}${other ? ` (${other})` : ""}`);
        }
      }
      const tags = [...dupRows].map(([row, label]) => ({ row, label }));
      if (tags.length) {
        const res = await fetch("/api/checks/duplicates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetId: workSheet, tab: (forceTab || runTab).trim() || undefined, action: "tag", tags }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);
      }
      pushLog({ ok: true, text: `Dubbele-foto-check klaar — ${tags.length} dubbele producten getagd in kolom G.` });
    } catch (e) {
      pushLog({ err: true, text: "Dubbele-foto-check fout: " + e.message });
    } finally {
      setCheckBusy("");
    }
  }

  async function runLiteralCheck(forceTab) {
    if (!workSheet.trim() || checkBusy) return;
    setCheckBusy("literal");
    pushLog({ strong: true, text: "— Literal-check gestart (kolom H)" });
    try {
      let cursor = 2;
      let total = 0;
      for (let guard = 0; guard < 200; guard++) {
        const res = await fetch("/api/checks/literal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetId: workSheet, tab: (forceTab || runTab).trim() || undefined, cursor }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);
        total += data.tagged || 0;
        if (data.done) break;
        cursor = data.nextCursor;
      }
      pushLog({ ok: true, text: `Literal-check klaar — ${total} twijfelgevallen getagd in kolom H.` });
    } catch (e) {
      pushLog({ err: true, text: "Literal-check fout: " + e.message });
    } finally {
      setCheckBusy("");
    }
  }

  const busy = running || checkBusy;

  return (
    <>
      <Header
        icon="A"
        title="Attoh Tools"
        subtitle="Competitor → Google Sheet"
      />
      <div className="page">
        <div className="layout-scraper">
          {/* -------- Linker kolom -------- */}
          <div>
            <div className="card">
              <h2>Competitor stores</h2>
              <div className="kw-row" style={{ gridTemplateColumns: "1fr 36px", marginTop: 0 }}>
                <input
                  type="text"
                  placeholder="nieuwestore.com"
                  value={storeInput}
                  onChange={(e) => setStoreInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addStores(storeInput)}
                  onPaste={(e) => {
                    const t = e.clipboardData?.getData("text") || "";
                    if (t.includes("\n") || t.includes(",")) {
                      e.preventDefault();
                      addStores(t);
                    }
                  }}
                />
                <button className="btn-ghost btn-small" onClick={() => addStores(storeInput)}>
                  +
                </button>
              </div>
              <div className="hint">
                Deze lijst blijft bewaard tussen sessies — plak ook meerdere stores tegelijk (één per regel of
                komma-gescheiden)
              </div>
              {storeList.map((s) => (
                <div className="kw-row" key={s} style={{ gridTemplateColumns: "1fr 24px" }}>
                  <span className="small" style={{ wordBreak: "break-all" }}>
                    {s}
                  </span>
                  <button className="kw-x" onClick={() => removeStoreItem(s)}>
                    ×
                  </button>
                </div>
              ))}
              {storeList.length > 0 && (
                <>
                  <div className="hint">{storeList.length} stores — volgorde = zoekvolgorde (beste eerst)</div>
                  <div style={{ marginTop: 10 }}>
                    <button className="btn-ghost btn-small" onClick={clearAllStores}>
                      ✕ Alles wissen
                    </button>
                  </div>
                  <div className="hint">
                    Stores verdwijnen ook vanzelf na {STORE_TTL_DAYS} dagen zonder gebruik van de tool.
                  </div>
                </>
              )}
            </div>

            <div className="card">
              <h2>
                Verdeling inladen <span className="opt">(Collection & Product organization)</span>
              </h2>
              <div className="field-label">Organization-sheet link</div>
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={orgSheet}
                onChange={(e) => setOrgSheet(e.target.value)}
              />
              <div className="field-label">Exacte bladnaam</div>
              <input
                type="text"
                placeholder="Collection & Product organization"
                value={orgTab}
                onChange={(e) => setOrgTab(e.target.value)}
              />
              <div className="hint">
                Leest het blad uit de Keywords-tool en vult hieronder automatisch alle keywords, aantallen en
                groepen (man/vrouw) in — niets meer zelf overtypen.
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn-ghost"
                  onClick={loadVerdeling}
                  disabled={orgBusy || running || !orgSheet.trim() || !orgTab.trim()}
                >
                  {orgBusy ? "Laden…" : "⇣ Laad verdeling"}
                </button>
              </div>
              {orgInfo && (
                <div className="hint" style={{ color: "var(--ink-2)" }}>
                  Geladen: Vrouw {orgInfo.vrouwKw} keywords · {orgInfo.vrouwN} producten — Man {orgInfo.manKw}{" "}
                  keywords · {orgInfo.manN} producten
                </div>
              )}
            </div>

            <div className="card">
              <h2>Keywords</h2>
              {["vrouw", "man"].map((group) => {
                const rows = kw[group].map((row, idx) => (
                  <div className="kw-row" key={idx}>
                    <input
                      type="text"
                      placeholder="Occasion Dress"
                      value={row.k}
                      onChange={(e) => updateKwRow(group, idx, "k", e.target.value)}
                      onPaste={(e) => handleKwPaste(group, idx, e)}
                    />
                    <input
                      type="number"
                      min="1"
                      value={row.n}
                      onChange={(e) => updateKwRow(group, idx, "n", e.target.value)}
                    />
                    <button
                      className="kw-x"
                      onClick={() => setGroup(group, kw[group].filter((_, i) => i !== idx))}
                    >
                      ×
                    </button>
                  </div>
                ));
                return (
                  <div key={group}>
                    <div className="group-label">
                      {group === "vrouw" ? "Vrouw" : "Man"}
                      {kw[group].filter((r) => r.k.trim()).length > 0 && (
                        <span className="opt" style={{ marginLeft: 8 }}>
                          {kw[group].filter((r) => r.k.trim()).length} keywords ·{" "}
                          {kw[group].reduce((s, r) => s + (r.k.trim() ? Number(r.n) || 0 : 0), 0)} producten
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      className="kw-bulk"
                      placeholder="⧉ Plak hier je hele lijst in één keer (ook 100+)"
                      value=""
                      onChange={() => {}}
                      onPaste={(e) => handleBulkPaste(group, e)}
                    />
                    {kw[group].length > 8 ? <div className="kw-scroll">{rows}</div> : rows}
                    <button className="add-kw" onClick={() => setGroup(group, [...kw[group], { k: "", n: 10 }])}>
                      + Keyword toevoegen
                    </button>
                  </div>
                );
              })}
              <div className="hint">
                Keyword · Aantal producten — plak ook meerdere keywords tegelijk (één per regel, of keyword+aantal als
                twee kolommen uit een sheet)
              </div>
              {(kw.vrouw.some((r) => r.k.trim()) || kw.man.some((r) => r.k.trim())) && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn-ghost btn-small" onClick={clearAllKeywords}>
                    ✕ Verwijder alle keywords
                  </button>
                </div>
              )}
            </div>

            <div className="card">
              <h2>Google Sheet</h2>
              <div className="field-label" style={{ marginTop: 0 }}>
                Import-lijst sheet
              </div>
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={workSheet}
                onChange={(e) => saveSheets(e.target.value, memSheet)}
              />
              <div className="hint">
                <strong>Deel hier de link naar de import-lijst sheet</strong> — hier komen alle gescrapete
                producten in. Deel de sheet met het service account
                {saEmail ? (
                  <>
                    {": "}
                    <strong style={{ wordBreak: "break-all" }}>{saEmail}</strong>
                  </>
                ) : (
                  <span style={{ color: "var(--warn)" }}> (nog niet ingesteld in env vars)</span>
                )}
              </div>
              <div className="field-label" style={{ fontWeight: 400, fontSize: 13 }}>
                Naam nieuw blad <span className="opt">(voor deze run)</span>
              </div>
              <input
                type="text"
                placeholder="bv. Clara James aug-nov — leeg = automatisch Run-naam"
                value={newTabName}
                onChange={(e) => {
                  setNewTabName(e.target.value);
                  save(LS.newTab, e.target.value);
                }}
              />
              <div className="hint">
                De scraper maakt in de import-lijst een nieuw blad met deze naam. Laat je dit leeg, dan wordt het
                automatisch "Run dag-maand uu:mm".
              </div>
              <div className="field-label" style={{ fontWeight: 400, fontSize: 13 }}>
                Geheugen-sheet (permanent, nooit leegmaken)
              </div>
              <input
                type="text"
                placeholder="Sheet ID of volledige URL"
                value={memSheet}
                onChange={(e) => saveSheets(workSheet, e.target.value)}
              />
              <div className="hint">
                Staat altijd automatisch goed ingevuld — ook na Reset session of een nieuwe login. Voorkomt dat
                dezelfde producten terugkomen. Alleen aanpassen als je bewust een andere geheugen-sheet wilt.
              </div>
              <div className="field-label" style={{ fontWeight: 400, fontSize: 13 }}>
                Run-tabblad voor de checks <span className="opt">(optioneel)</span>
              </div>
              <input
                type="text"
                placeholder="wordt automatisch gevuld — alleen invullen om een ouder blad te checken"
                value={runTab}
                onChange={(e) => {
                  setRunTab(e.target.value);
                  save(LS.runTab, e.target.value);
                }}
              />
              <div className="hint">
                Wordt na elke run automatisch gevuld met het bladenaam van die run; de drie checks werken hierop.
                Alleen zelf aanpassen als je een ouder blad wilt nachecken.
              </div>
            </div>

            <div className="card">
              <h2>Geslacht-check</h2>
              <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Loopt alle rijen na en zet in kolom F een label: Man of Vrouw — geen twijfelgevallen.
              </div>
              <button className="btn-ghost" onClick={runGenderCheck} disabled={!workSheet.trim() || !!busy}>
                {checkBusy === "gender" ? "Bezig…" : "Geslacht-check"}
              </button>
            </div>

            <div className="card">
              <h2>Dubbele-foto-check</h2>
              <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Vergelijkt elke productfoto en tagt rijen met dezelfde foto (andere store, unieke link) in kolom G.
              </div>
              <button className="btn-ghost" onClick={runDuplicateCheck} disabled={!workSheet.trim() || !!busy}>
                {checkBusy === "dup" ? "Bezig…" : "Dubbele-foto-check"}
              </button>
            </div>

            <div className="card">
              <h2>Literal-check</h2>
              <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Controleert achteraf of elke "Literal"-match het keyword ook echt letterlijk bevat en tagt
                twijfelgevallen in kolom H.
              </div>
              <button className="btn-ghost" onClick={runLiteralCheck} disabled={!workSheet.trim() || !!busy}>
                {checkBusy === "literal" ? "Bezig…" : "Literal-check"}
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={start} disabled={!!busy}>
                {running ? "Bezig met scrapen…" : "⌕ Starten"}
              </button>
            </div>
          </div>

          {/* -------- Rechter kolom: voortgang -------- */}
          <div>
            {stall && (
              <div className="card stall-card">
                <h2>⚠ "{stall.kw}" loopt vast</h2>
                <div className="hint" style={{ marginTop: 4 }}>
                  Na {STALL_PROMPT_AT} stores nog niets gevonden — slim zoeken (AI-alternatieven + breed
                  vangnet) is al actief en het scrapen loopt gewoon door. Geen antwoord? Na {STALL_AUTO_AT}{" "}
                  stores ga ik automatisch door naar het volgende keyword.
                </div>
                <div className="stall-btns">
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      stallDecision.current = "ai";
                      setStall(null);
                    }}
                  >
                    🧠 AI-aanpak nu
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      stallDecision.current = "continue";
                      setStall(null);
                    }}
                  >
                    ▶ Gewoon doorgaan
                  </button>
                  <button
                    className="btn-ghost stall-skip"
                    onClick={() => {
                      stallDecision.current = "skip";
                      setStall(null);
                    }}
                  >
                    ⏭ Keyword overslaan
                  </button>
                </div>
              </div>
            )}
            {prog && (
              <div className="card prog-card">
                <div className="prog-top">
                  <span className="prog-title">
                    {running ? (paused ? "Gepauzeerd" : "Bezig met scrapen") : "Run-overzicht"}
                  </span>
                  <span className="prog-count">
                    {prog.found} <span className="prog-sep">/</span> {prog.target} producten
                  </span>
                </div>
                <div className="pbar">
                  <div
                    className={"pbar-fill" + (running && !paused ? " live" : "")}
                    style={{ width: `${Math.min(100, Math.round((prog.found / Math.max(prog.target, 1)) * 100))}%` }}
                  />
                </div>
                <div className="prog-meta">
                  {running && prog.currentKw ? (
                    <>
                      <span className="prog-kwname">
                        {prog.currentGender} · "{prog.currentKw}" — {prog.kwFound}/{prog.kwTarget}
                      </span>
                      <span>keyword {Math.min(prog.kwDone + 1, prog.kwTotal)} van {prog.kwTotal}</span>
                    </>
                  ) : (
                    <span>{prog.kwDone} van {prog.kwTotal} keywords afgerond</span>
                  )}
                </div>
                {running && (
                  <div className="runctl" style={{ marginTop: 13 }}>
                    {paused ? (
                      <button className="btn-ghost" onClick={resumeRun}>▶ Hervat</button>
                    ) : (
                      <button className="btn-ghost" onClick={pauseRun}>⏸ Pauzeer</button>
                    )}
                    <button className="btn-ghost" onClick={stopSave}>⏹ Stop & opslaan</button>
                    <button className="btn-ghost runctl-del" onClick={stopDelete}>🗑 Stop & verwijderen</button>
                  </div>
                )}
              </div>
            )}
            <div className="card logpanel">
              {logs.length > 0 && <div className="logpanel-head">Live log · nieuwste bovenaan</div>}
              {logs.length === 0 ? (
                <div className="center-note">Vul links de gegevens in en klik op Starten</div>
              ) : (
                [...logs].reverse().map((l, i) => (
                  <div className="log" key={i}>
                    {l.err ? (
                      <span className="err">✗ {l.text}</span>
                    ) : l.warn ? (
                      <span className="warn">⚠ {l.text}</span>
                    ) : l.ok ? (
                      <span className="ok">
                        ✓ {l.text}
                        {l.href ? (
                          <a className="linklike" style={{ marginLeft: 8 }} href={l.href} target="_blank" rel="noreferrer noopener">
                            openen ↗
                          </a>
                        ) : null}
                      </span>
                    ) : l.strong ? (
                      <strong>
                        {l.text}
                        {l.href ? (
                          <a className="linklike" style={{ marginLeft: 8 }} href={l.href} target="_blank" rel="noreferrer noopener">
                            openen ↗
                          </a>
                        ) : null}
                      </strong>
                    ) : (
                      <span className="muted">{l.text}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
