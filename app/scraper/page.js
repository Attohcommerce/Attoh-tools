"use client";

import { useEffect, useRef, useState } from "react";
import Header from "../components/Header";
import { analyzeKeyword, alternativeIsSafe, hardAttributes } from "@/lib/fashion";
import { orgLS } from "@/lib/org-client";
import { IMPORT_HEADER, detectImportFormat } from "@/lib/import-format";
import { parseVerdelingSheet, parseWeekplanSheet } from "@/lib/weekplan";
import { useOrgDef } from "../components/OrgProvider";

// Aantal winkels dat tegelijk wordt doorzocht (snelheid). 6 = ±6× sneller
// dan één voor één; de catalogi komen uit de cache, dus dat kan veilig.
const WAVE = 6;

const LS = {
  stores: "sa_competitor_stores",
  keywords: "sa_scraper_keywords",
  workSheet: "sa_sheet_work",
  memSheet: "sa_sheet_memory",
  runTab: "sa_run_tab",
  newTab: "sa_new_tab",
  orgSheet: "sa_org_sheet",
  orgTab: "sa_org_tab",
  orgStore: "sa_org_store", // store uit het geheugen (domein) die de organization-sheet levert
  orgTabByStore: "sa_org_tab_by_store", // laatst gebruikte bladnaam per store ("domein" = organization, "domein|tpk" = TPK-sheet)
  orgSource: "sa_org_source", // "org" = organization/aanvul-sheet, "tpk" = TPK-sheet (top performing keywords)
  importTabByStore: "sa_import_tab_by_store", // laatst gebruikte import-lijst-blad per store (scraper + importer)
};

/* Weeknummer uit een bladnaam: "Scraper W3" / "Week 3 (26 Oct-1 Nov)" / "W3" → 3. */
function weekNumberOf(title) {
  const m = String(title || "").match(/\bw(?:eek)?\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}



function load(key, fallback) {
  try {
    const v = JSON.parse(orgLS.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, val) {
  try {
    orgLS.setItem(key, JSON.stringify(val));
  } catch {}
}

// Kopregel van de import-lijst — één bron: lib/import-format.js (importer leest
// dezelfde kolommen; Chaim-formaat wordt daar ook herkend/omgezet).
const HEADER_ROW = IMPORT_HEADER;

/* Vraag-bewijs per product (lib/demand.js). "bewezen" = alleen producten
   met score ≥ 50 (gevalideerde bestseller-top, reviews, uitverkochte
   varianten); "kansrijk" = score ≥ 25; "alles" = geen filter (oud gedrag).
   Producten waarvan de winkel géén enkel signaal geeft blijven altijd staan
   en heten "Onbekend" in kolom L. */
const LS_PROOF = "sa_proof_mode_v2"; // v2: standaard "alles" (zoals Chaim)

/* Spreiding: "vol" = een concurrent mag het hele quotum van een keyword
   leveren (Chaim-route — een winkel met 10 goede jassen levert 10 jassen);
   "gespreid" = oude gedrag (max ⅓ per winkel per keyword, max 25% van de run).
   Snelmodus: geen reviews ophalen per product (scheelt tot 8 fetches per
   winkel×keyword); bestseller-positie telt nog steeds mee in de volgorde. */
const LS_SPREAD = "sa_spread_mode";
const LS_FAST = "sa_fast_mode";


/* Slim zoeken — de trap-ladder per keyword:
     store 1     → alleen het originele keyword (+ eerder bewezen winnaar)
     store 2+    → ook de AI-alternatieven, en de ladder begint OPNIEUW BIJ
                   STORE 1 met die nieuwe termen
     store 4+    → ook het brede vangnet, opnieuw vanaf store 1
     store 6     → instructie-paneel — loopt gewoon door, wachten hoeft niet
     store 20    → nog steeds 0? automatisch door naar het volgende keyword

   Waarom opnieuw vanaf store 1: de winkels staan op volgorde van kwaliteit
   (beste eerst). Als de AI-aanpak pas bij winkel 4 aanslaat, komt je hele
   quotum uit de mindere winkels terwijl de beste er nooit mee doorzocht is.
   Herhalingen kosten niets: elke winkel×zoekterm-combinatie draait maar één
   keer (triedPairs), dus winkel 1 wordt alleen opnieuw bezocht mét de
   nieuwe termen. */
const ALTS_AT = 2;
const BROAD_AT = 4;
const STALL_PROMPT_AT = 6;
const STALL_AUTO_AT = 20;
const MAX_LADDER_ROUNDS = 4; // vangnet tegen eindeloos herstarten

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

/* Competitor-sheet: het dashboard met alle concurrenten per markt
   (naam, land, domein, productaantal, maandbezoek, opmerkingen). De tool
   leest hem in, ontdubbelt, en laat AI de beste selectie kiezen voor de
   doelmarkt — hoogste maandbezoek eerst, aangevuld met buitenland-stores
   die met vertaalde keywords uniek aanbod leveren. */
const DEFAULT_COMP_SHEET =
  "https://docs.google.com/spreadsheets/d/1oZ_F0JktM0uuICiZIAO_ZaVCbentEvUpiDjEtivsKe4/edit";
const LS_COMP_SHEET = "sa_comp_sheet";
const LS_COMP_TAB = "sa_comp_tab";
const LS_COMP_META = "sa_comp_meta_v1"; // domein → {market, visits, lang, reason}
const LS_TRANS = "sa_kw_trans_v1"; // taal → {keyword: [zoektermen]}

// Vaste geheugen-sheet — staat altijd automatisch ingevuld, ook na Reset
// session, nieuwe logins of een andere browser. Per ORGANISATIE (lib/org.js,
// 20-10): Attoh = "Attoh — Geheugen", Sa Collective = Chaims "Producten
// scraper · geheugen" (zelfde sheet als zijn tool). Zie useOrgDef() hieronder.

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

/* Organization-sheet lezen (verdeling-formaat of weekplanning in Chaim-
   opmaak): parsers staan in lib/weekplan.js — dezelfde code gebruikt de
   server voor "Scraper W-tabs aanmaken". */

function storeOf(link) {
  try {
    return new URL(link).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function ScraperPage() {
  // Organisatie (lib/org.js): bepaalt o.a. de vaste geheugen-sheet
  const orgDef = useOrgDef();
  const DEFAULT_MEM_SHEET = orgDef.memorySheet.url;
  const [storeInput, setStoreInput] = useState("");
  const [storeList, setStoreList] = useState([]);
  // Competitor-sheet (slimme selectie)
  const [compSheet, setCompSheet] = useState(DEFAULT_COMP_SHEET);
  const [compTab, setCompTab] = useState("");
  const [compStores, setCompStores] = useState([]); // geparste sheet-rijen
  const [compMeta, setCompMeta] = useState({}); // domein → meta (ook tijdens de run)
  const [compMarket, setCompMarket] = useState("USA");
  const [compMax, setCompMax] = useState("25");
  const [compBusy, setCompBusy] = useState("");
  const [proofMode, setProofMode] = useState("alles"); // bewezen | kansrijk | alles
  const [spreadMode, setSpreadMode] = useState("vol"); // vol | gespreid
  const [fastMode, setFastMode] = useState(true);
  const [catInfo, setCatInfo] = useState({}); // domein → {count, at, lang}
  const [catBusy, setCatBusy] = useState("");
  const [shotBusy, setShotBusy] = useState("");
  const [cacheStats, setCacheStats] = useState(null); // {usedMb, maxMb}
  const autoLoaded = useRef(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [kw, setKw] = useState({ vrouw: [{ k: "", n: 10 }], man: [{ k: "", n: 10 }] });
  const [workSheet, setWorkSheet] = useState("");
  const [memSheet, setMemSheet] = useState("");
  const [runTab, setRunTab] = useState("");
  const [newTabName, setNewTabName] = useState("");
  const [saEmail, setSaEmail] = useState(null);
  // Verdeling (Collection & Product organization) inladen
  const [orgSheet, setOrgSheet] = useState("");
  const [orgTab, setOrgTab] = useState("Collection & Product organization");
  // Welke keywords uit het blad meegenomen worden: alles, alleen de normale
  // verdeling, of alleen de underdog-rijen (Type = "Underdog" in kolom I).
  const [orgFilter, setOrgFilter] = useState("alles"); // "alles" | "normaal" | "underdog"
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgInfo, setOrgInfo] = useState(null);
  const [tabsBuildBusy, setTabsBuildBusy] = useState(false); // Scraper W-tabs aanmaken (zoals SSB)
  /* Store-geheugen (Keywords → Geheugen → 2 · Store-geheugen): per store staat
     daar de organization/aanvul-sheet. Store kiezen = sheet + tabbladen
     automatisch ingevuld; alleen bij LGB stond de sheet tot nu toe vast. */
  const [memStores, setMemStores] = useState([]); // [{name, domain, market, genders, aanvulSheetId, orgSheetId, orgTab, tpkSheetId, importSheetId}]
  const [memStore, setMemStore] = useState(""); // gekozen domein ("" = handmatige link)
  const [orgTabs, setOrgTabs] = useState([]); // tabbladen van de gekozen sheet
  const [orgTabsBusy, setOrgTabsBusy] = useState(false);
  /* Bron per store: de organization/aanvul-sheet (weekplanning, 50/week) of de
     TPK-sheet (top performing keywords, ±10/week). Allebei uit het geheugen;
     per store 2x scrapen naar dezelfde import-lijst (15-10-2026). */
  const [orgSource, setOrgSource] = useState("org"); // "org" | "tpk"

  const [running, setRunning] = useState(false);
  const [checkBusy, setCheckBusy] = useState("");
  const [logs, setLogs] = useState([]);
  // Instructie-paneel voor vastgelopen keywords
  const [stall, setStall] = useState(null); // {kw, gender} zolang het paneel zichtbaar is
  const stallDecision = useRef(null); // "skip" | "ai" | "continue"
  // Pauzeren / stoppen tijdens de run
  const [paused, setPaused] = useState(false);
  const controlRef = useRef("run"); // "run" | "pause" | "stop-save" | "stop-delete"
  /* Handmatig overslaan: altijd beschikbaar tijdens de run, niet alleen als
     de tool zelf vastloopt. Zet de naam van het keyword dat weg moet; de
     loop pikt dat op en gaat direct door naar het volgende. */
  const skipRef = useRef(null);
  const [skipHint, setSkipHint] = useState("");
  // Voortgangsbalk
  const [prog, setProg] = useState(null); // {target, found, kwDone, kwTotal, currentKw, currentGender, kwTarget, kwFound}
  /* Compacte weergave (15-10, puur uiterlijk): kaarten klappen in tot één
     kopregel met samenvatting; de stappenstrook bovenaan springt naar de
     kaart. Open/dicht wordt per kaart onthouden (sa_scraper_open). */
  const [secOpen, setSecOpen] = useState({});
  useEffect(() => {
    setSecOpen(load("sa_scraper_open", {}));
  }, []);
  const isOpen = (id, dflt) => (secOpen[id] === undefined ? !!dflt : !!secOpen[id]);
  const secCls = (id, dflt) => "card sec" + (isOpen(id, dflt) ? " open" : "");
  function toggleSec(id, dflt) {
    setSecOpen((o) => {
      const cur = o[id] === undefined ? !!dflt : !!o[id];
      const n = { ...o, [id]: !cur };
      save("sa_scraper_open", n);
      return n;
    });
  }
  function jumpTo(id) {
    setSecOpen((o) => {
      const n = { ...o, [id]: true };
      save("sa_scraper_open", n);
      return n;
    });
    setTimeout(() => {
      const el = document.getElementById("sec-" + id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }
  const memStoreName = (memStores.find((x) => x.domain === memStore) || {}).name || memStore || "";
  const cachedCount = Object.keys(catInfo).filter((d) => storeList.includes(d)).length;
  const kwCount = (g) => kw[g].filter((r) => r.k.trim()).length;
  const kwProducts = (g) => kw[g].filter((r) => r.k.trim()).reduce((t, r) => t + (Number(r.n) || 0), 0);
  const SecHead = ({ id, dflt, children, sum }) => (
    <h2 className="sec-h2" onClick={() => toggleSec(id, dflt)} title={isOpen(id, dflt) ? "Inklappen" : "Openklappen"}>
      {children}
      <span className="sec-sum">{sum}</span>
      <span className="sec-chev">{isOpen(id, dflt) ? "▾" : "▸"}</span>
    </h2>
  );

  useEffect(() => {
    /* Competitor-lijst: de SERVER is de bron (Redis, permanent). Eerst de
       lokale kopie tonen, daarna samenvoegen met de server-lijst — winkels
       die alleen nog in deze browser stonden gaan er ook bij. Er verloopt
       niets meer na 14 dagen. */
    const localList = load(LS.stores, []);
    setStoreList(localList);
    fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listGet" }),
    })
      .then((r) => r.json())
      .then(async (d) => {
        if (!d || !d.ok || !d.server) return; // geen Redis → alleen lokaal
        let list = d.list || [];
        const missing = localList.filter((x) => !list.includes(x));
        if (missing.length) {
          const r2 = await fetch("/api/competitors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "listAdd", domains: missing, meta: load(LS_COMP_META, {}) }),
          }).then((x) => x.json());
          if (r2 && r2.list) list = r2.list;
        }
        setStoreList(list);
        save(LS.stores, list);
        if (d.meta && Object.keys(d.meta).length) {
          setCompMeta((prev) => {
            const next = { ...prev };
            for (const [dom, m] of Object.entries(d.meta)) next[dom] = { ...(next[dom] || {}), ...m };
            save(LS_COMP_META, next);
            return next;
          });
        }
      })
      .catch(() => {});
    setKw(load(LS.keywords, { vrouw: [{ k: "", n: 10 }], man: [{ k: "", n: 10 }] }));
    setWorkSheet(load(LS.workSheet, "") || DEFAULT_WORK_SHEET);
    // 20-10 (Justin): de geheugen-sheet is ALTIJD die van de organisatie
    // (Attoh — Geheugen, of Chaims geheugen in Sa Collective) — een oude
    // waarde uit de browser wint niet meer
    setMemSheet(DEFAULT_MEM_SHEET);
    save(LS.memSheet, DEFAULT_MEM_SHEET);
    setRunTab(load(LS.runTab, ""));
    setNewTabName(load(LS.newTab, ""));
    setOrgSheet(load(LS.orgSheet, "") || DEFAULT_ORG_SHEET);
    setCompSheet(load(LS_COMP_SHEET, "") || DEFAULT_COMP_SHEET);
    setCompTab(load(LS_COMP_TAB, ""));
    setCompMeta(load(LS_COMP_META, {}));
    setProofMode(load(LS_PROOF, "alles"));
    setSpreadMode(load(LS_SPREAD, "vol"));
    setFastMode(load(LS_FAST, true));
    setOrgTab(load(LS.orgTab, "Collection & Product organization"));
    const src = load(LS.orgSource, "org") === "tpk" ? "tpk" : "org";
    setOrgSource(src);
    // Store-geheugen ophalen; de laatst gekozen store (+ bron) meteen weer toepassen
    fetch("/api/geheugen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" }),
    })
      .then((r) => r.json())
      .then((d) => {
        const list = (d.stores || []).filter((x) => x && (x.orgSheetId || x.aanvulSheetId || x.tpkSheetId));
        setMemStores(list);
        const last = load(LS.orgStore, "");
        const hit = last && list.find((x) => x.domain === last);
        if (hit) pickMemStore(hit, list, true, src);
      })
      .catch(() => {});
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
    const lower = items.map((x) => x.toLowerCase());
    const have = new Set(storeList);
    const fresh = [...new Set(lower)].filter((x) => !have.has(x));
    const dupes = lower.length - fresh.length;
    const next = [...storeList, ...fresh];
    setStoreList(next);
    save(LS.stores, next);
    setStoreInput("");
    if (fresh.length || dupes) {
      pushLog({ ok: true, text: `${fresh.length} winkel(s) toegevoegd${dupes ? ` · ${dupes} dubbel genegeerd` : ""}.` });
    }
    if (!fresh.length) return;
    fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listAdd", domains: fresh }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d && d.list) {
          setStoreList(d.list);
          save(LS.stores, d.list);
        }
      })
      .catch(() => {})
      .finally(() => loadCatalogs(false, fresh)); // nieuwe winkels meteen in de cache
  }

  /* Screenshot van de competitor-sheet → winkels + maandbezoek. Afbeelding
     wordt eerst verkleind (Vercel-limiet ±4,5 MB per request). */
  async function shrinkImage(file) {
    const url = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const maxW = 1800;
    const scale = Math.min(1, maxW / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  }

  async function importScreenshots(files) {
    const list = [...(files || [])].filter((f) => f && /^image\//.test(f.type));
    if (!list.length) return;
    setShotBusy(`0/${list.length}`);
    let added = 0;
    let dupes = 0;
    let withVisits = 0;
    const newOnes = [];
    for (let i = 0; i < list.length; i++) {
      try {
        const dataUrl = await shrinkImage(list[i]);
        const res = await fetch("/api/competitors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "readScreenshot", dataUrl }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || res.status);
        if (d.warn) pushLog({ warn: true, text: `Screenshot ${i + 1}: ${d.warn}` });
        added += (d.added || []).length;
        dupes += d.dupes || 0;
        newOnes.push(...(d.added || []));
        withVisits += (d.rows || []).filter((r) => r.visits).length;
        if (d.list) {
          setStoreList(d.list);
          save(LS.stores, d.list);
        }
        if (d.meta) {
          setCompMeta((prev) => {
            const next = { ...prev };
            for (const [dom, m] of Object.entries(d.meta)) next[dom] = { ...(next[dom] || {}), ...m };
            save(LS_COMP_META, next);
            return next;
          });
        }
      } catch (e) {
        pushLog({ err: true, text: `Screenshot ${i + 1}: ${e.message}` });
      }
      setShotBusy(`${i + 1}/${list.length}`);
    }
    setShotBusy("");
    pushLog({
      ok: true,
      text: `📷 Screenshot gelezen: ${withVisits} winkels met maandbezoek bijgewerkt · ${added} nieuw toegevoegd · ${dupes} stonden er al (genegeerd).`,
    });
    if (newOnes.length) loadCatalogs(false, newOnes);
  }

  /* Catalogi laden/verversen — één winkel per call (blijft onder de
     serverless-limiet). Daarna staat elke catalogus permanent klaar in de
     cache (binnen het Redis-geheugenbudget) en is de scraper per winkel
     direct klaar. */
  async function loadCatalogs(refresh, only) {
    const list = only && only.length ? [...only] : [...storeList];
    if (!list.length) return;
    let cacheFail = 0;
    let cacheFailMsg = "";
    let partial = 0;
    let done = 0;
    let total = 0;
    const evicted = new Set();
    const truncated = [];
    setCatBusy(`0/${list.length}`);
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const d = queue.shift();
        try {
          const r = await fetch("/api/competitors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "catalog", domain: d, refresh: !!refresh }),
          }).then((x) => x.json());
          if (r && r.meta) {
            total += r.meta.count || 0;
            if (r.meta.count && r.meta.cacheWrite && r.meta.cacheWrite !== "ok") {
              cacheFail++;
              cacheFailMsg = r.meta.cacheWrite;
            }
            if (r.meta.partial) partial++;
            if (r.meta.truncated) truncated.push(`${d} (${Number(r.meta.count).toLocaleString("nl-NL")} van ${Number(r.meta.total).toLocaleString("nl-NL")})`);
            for (const x of r.meta.evicted || []) evicted.add(x);
            setCatInfo((prev) => ({ ...prev, [d]: r.meta }));
            if (r.meta.lang) {
              setCompMeta((prev) => {
                const next = { ...prev, [d]: { ...(prev[d] || {}), lang: r.meta.lang } };
                save(LS_COMP_META, next);
                return next;
              });
            }
          }
        } catch {}
        done++;
        setCatBusy(`${done}/${list.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
    setCatBusy("");
    pushLog({ ok: true, text: `📦 ${list.length} catalogi ${refresh ? "ververst" : "geladen"} — ${total.toLocaleString("nl-NL")} producten staan klaar.` });
    if (partial) pushLog({ warn: true, text: `${partial} winkel(s) zo groot dat niet alles binnen 1 minuut binnenkwam — klik nog eens op "Alle catalogi verversen" voor die winkels.` });
    if (truncated.length) pushLog({ muted: true, text: `Ingekort tot de best verkopende producten (te groot voor de cache): ${truncated.join(", ")}.` });
    if (evicted.size) {
      // Alleen melden wat écht uit de lijst verdween; winkels die later in
      // dezelfde ronde opnieuw geladen zijn staan gewoon weer in de cache.
      setCatInfo((prev) => {
        const next = { ...prev };
        for (const x of evicted) if (!list.includes(x)) delete next[x];
        return next;
      });
      pushLog({ warn: true, text: `Cache vol: de oudste catalogi zijn weggehaald om ruimte te maken (${[...evicted].slice(0, 8).join(", ")}${evicted.size > 8 ? ` +${evicted.size - 8}` : ""}). Wil je álle ${storeList.length} winkels permanent bewaren, dan is het Redis-plan te klein.` });
    }
    if (cacheFail) pushLog({ err: true, text: `${cacheFail} catalogi konden NIET in de cache worden opgeslagen: ${cacheFailMsg}` });
    refreshCacheStats();
  }

  // Geheugenregel onder de lijst bijwerken (na laden, verversen of wissen)
  function refreshCacheStats() {
    fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "catalogInfo", domains: [] }),
    })
      .then((r) => r.json())
      .then((d) => d && d.stats && setCacheStats(d.stats))
      .catch(() => {});
  }

  // Noodknop: alle catalogi uit Redis, de lijst en de maandbezoekers blijven.
  // Werkt ook als Redis vol zit (wissen mag altijd, opslaan niet).
  async function clearCatalogCache() {
    if (!window.confirm("Alle catalogi uit de cache wissen? De winkellijst en de maandbezoekers blijven staan; de catalogi worden daarna opnieuw opgehaald zodra je ze laadt.")) return;
    try {
      const r = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cacheClear", confirm: "WISSEN" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.status);
      setCatInfo({});
      if (d.stats) setCacheStats(d.stats);
      pushLog({ ok: true, text: `🧹 Cache gewist: ${d.stores} catalogi weg, ${d.freedMb} MB vrijgemaakt — Redis staat nu op ${d.stats ? d.stats.usedMb : "?"} MB. Klik op "📦 Catalogi laden" om ze opnieuw op te halen.` });
    } catch (e) {
      pushLog({ err: true, text: `Cache wissen mislukt: ${e.message}` });
    }
  }

  // Bron-indexen van de Size Guide uit Redis (herbouwbaar) — als die het geheugen opeten
  async function clearSourceIndexCache() {
    if (!window.confirm("De bron-indexen van de Size Guide uit Redis wissen? Ze worden bij de volgende size-guide-run opnieuw opgebouwd; het matchgeheugen (product → AliExpress) blijft staan.")) return;
    try {
      const r = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cacheClearIdx", confirm: "WISSEN" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.status);
      if (d.stats) setCacheStats(d.stats);
      pushLog({ ok: true, text: `🧹 Bron-indexen gewist: ${d.keys} stuks, ${d.freedMb} MB vrijgemaakt — Redis staat nu op ${d.stats ? d.stats.usedMb : "?"} MB.` });
    } catch (e) {
      pushLog({ err: true, text: `Bron-indexen wissen mislukt: ${e.message}` });
    }
  }

  // Oude Redis → nieuwe (na een nieuwe database via de Vercel Marketplace):
  // competitor-lijst, maandbezoekers, store-geheugen, To Do, matches én catalogi.
  async function migrateOldRedis() {
    const fromUrl = window.prompt(
      "Oude Redis overzetten naar de nieuwe (STORAGE2_REDIS_URL). Laat LEEG als de oude link nog als REDIS_URL in Vercel staat — dan pakt de server hem zelf. Anders: plak hier de oude link (redis://… of rediss://…). Alles wordt gekopieerd; bestaande keys in de nieuwe database worden overschreven.",
      ""
    );
    if (fromUrl === null) return;
    if (String(fromUrl).trim() && !/^rediss?:\/\//i.test(String(fromUrl).trim())) {
      pushLog({ err: true, text: "Dat is geen Redis-link (hij begint met redis:// of rediss://)." });
      return;
    }
    pushLog({ strong: true, text: "— Oude Redis overzetten…" });
    try {
      const r = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redisMigrate", confirm: "OVERZETTEN", fromUrl: String(fromUrl).trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.status);
      if (d.stats) setCacheStats(d.stats);
      const per = Object.entries(d.perKind || {})
        .map(([k, v]) => `${k} ${v.copied}${v.skipped ? ` (+${v.skipped} overgeslagen)` : ""}${v.failed ? ` (${v.failed} mislukt)` : ""}`)
        .join(" · ");
      pushLog({ ok: true, text: `⇄ Overgezet: ${d.copied} van ${d.total} keys (${d.mb} MB) in ${Math.round((d.ms || 0) / 1000)} s — ${per}. Nieuwe Redis staat nu op ${d.stats ? d.stats.usedMb : "?"} MB.` });
      if (d.failed) pushLog({ warn: true, text: `${d.failed} keys mislukt: ${(d.errors || []).join(" · ")}` });
      pushLog({ muted: true, text: "Pagina wordt ververst zodat de lijst en het geheugen uit de nieuwe database komen…" });
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      pushLog({ err: true, text: `Overzetten mislukt: ${e.message}` });
    }
  }

  // Cache-overzicht ophalen zodra de lijst bekend is
  useEffect(() => {
    if (!storeList.length) return;
    fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "catalogInfo", domains: storeList }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d) return;
        if (d.meta) setCatInfo((prev) => ({ ...prev, ...d.meta }));
        if (d.stats) setCacheStats(d.stats);
        // Winkels zonder catalogus in de cache automatisch laden (één keer
        // per sessie), zodat de hele lijst altijd klaarstaat.
        if (d.cache && !autoLoaded.current && !running) {
          const missing = storeList.filter((x) => !(d.meta || {})[x]);
          if (missing.length) {
            autoLoaded.current = true;
            pushLog({ muted: true, text: `📦 ${missing.length} winkel(s) nog niet in de cache — worden nu automatisch geladen.` });
            loadCatalogs(false, missing);
          }
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeList.length]);

  function removeStoreItem(dom) {
    const next = storeList.filter((s) => s !== dom);
    setStoreList(next);
    save(LS.stores, next);
    fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listRemove", domains: [dom] }),
    }).catch(() => {});
  }

  function clearAllStores() {
    // Alles wissen = ook uit de permanente lijst en de cache; dus eerst vragen
    if (!window.confirm(`Alle ${storeList.length} competitor stores en hun catalogi definitief wissen?`)) return;
    setStoreList([]);
    save(LS.stores, []);
    fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listClear", confirm: "WISSEN" }),
    }).catch(() => {});
    pushLog({ muted: true, text: "Alle competitor stores gewist." });
  }

  // Volgorde opslaan op de server; winkels die niet in `order` staan blijven achteraan
  async function saveOrder(order, meta) {
    const have = new Set(order);
    const merged = [...order, ...storeList.filter((x) => !have.has(x))];
    setStoreList(merged);
    save(LS.stores, merged);
    try {
      const r = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listReorder", order: merged, meta: meta || undefined }),
      }).then((x) => x.json());
      if (r && r.list) {
        setStoreList(r.list);
        save(LS.stores, r.list);
      }
    } catch {}
    return merged;
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
    // geheugen-sheet nooit leeg: leegmaken = terug naar "Attoh — Geheugen"
    const mm = String(m || "").trim() ? m : DEFAULT_MEM_SHEET;
    setWorkSheet(w);
    setMemSheet(mm);
    save(LS.workSheet, w);
    save(LS.memSheet, mm);
  }

  // ---------- Store uit het geheugen → organization- of TPK-sheet + tabbladen ----------
  const memSheetUrl = (e, source) =>
    `https://docs.google.com/spreadsheets/d/${source === "tpk" ? e.tpkSheetId : e.orgSheetId || e.aanvulSheetId}/edit`;
  const tabKey = (domain, source) => (source === "tpk" ? `${domain}|tpk` : domain);
  const memEntry = memStores.find((x) => x.domain === memStore) || null;

  /* Standaard-tabblad.
     Organization: laatst gebruikt voor deze store, anders het eerste
     Scraper-tabblad vanaf week 2 (Scraper W2, W3 …), anders de eerste weektab
     vanaf week 2, anders het eerste tabblad. Week 1 = het origineel (wat al op
     de store staat) en is niet om te scrapen.
     TPK-sheet: laatst gebruikt (de TPK-tool zet het zojuist geschreven blad
     klaar), anders het nieuwste weekblad (hoogste W-nummer); Overzicht en Log
     zijn geen scrape-bladen. */
  function defaultOrgTab(titles, domain, entry, source) {
    const byStore = load(LS.orgTabByStore, {});
    const remembered = domain ? byStore[tabKey(domain, source)] : "";
    if (remembered && titles.includes(remembered)) return remembered;
    const num = (t, re) => {
      const m = String(t).match(re);
      return m ? Number(m[1]) : null;
    };
    if (source === "tpk") {
      const weeks = titles
        .filter((t) => !/^(overzicht|log)$/i.test(t))
        .map((t) => [t, num(t, /^w(?:eek)?\s*(\d+)/i)])
        .filter(([, n]) => n !== null)
        .sort((a, b) => b[1] - a[1]);
      if (weeks.length) return weeks[0][0];
      return titles.find((t) => !/^(overzicht|log)$/i.test(t)) || "";
    }
    if (entry && entry.orgTab && titles.includes(entry.orgTab)) return entry.orgTab;
    const pick = (re) => {
      const hits = titles.map((t) => [t, num(t, re)]).filter(([, n]) => n !== null && n >= 2).sort((a, b) => a[1] - b[1]);
      return hits.length ? hits[0][0] : "";
    };
    return pick(/^scraper w(\d+)/i) || pick(/^week (\d+)/i) || titles[0] || "";
  }

  /* Import-lijst van de store: bladnaam voorstellen. Laatst gebruikt voor deze
     store (W3 blijft W3 voor de aanvul- én de TPK-scrape, zodat beide in
     hetzelfde blad landen); anders het weeknummer van het gekozen bronblad
     ("Scraper W3" → "W3", of "<store> W3" als de store geen eigen import-lijst
     heeft); anders leeg (= automatisch "Run d-m uu:mm"). */
  function suggestImportTab(entry, sourceTab) {
    if (!entry) return "";
    const byStore = load(LS.importTabByStore, {});
    const wk = weekNumberOf(sourceTab);
    const remembered = byStore[entry.domain] || "";
    if (remembered) {
      const rw = weekNumberOf(remembered);
      // onthouden blad is van een andere week → meeschuiven naar de nieuwe week
      if (wk !== null && rw !== null && rw !== wk) return remembered.replace(/\bw(?:eek)?\s*\d{1,2}\b/i, `W${wk}`);
      return remembered;
    }
    if (wk === null) return "";
    return entry.importSheetId ? `W${wk}` : `${entry.name || entry.domain} W${wk}`;
  }

  function applyImportSuggestion(entry, sourceTab) {
    if (!entry) return;
    if (entry.importSheetId) {
      const url = `https://docs.google.com/spreadsheets/d/${entry.importSheetId}/edit`;
      if (url !== workSheet) saveSheets(url, memSheet);
    }
    const tabName = suggestImportTab(entry, sourceTab);
    if (tabName) {
      setNewTabName(tabName);
      save(LS.newTab, tabName);
    }
  }

  async function loadOrgTabs(sheet, domain, entry, source) {
    setOrgTabsBusy(true);
    try {
      const d = await sheetsCall({ action: "tabs", sheetId: sheet });
      const titles = (d.tabs || []).map((t) => t.title).filter(Boolean);
      setOrgTabs(titles);
      const tab = defaultOrgTab(titles, domain, entry, source);
      if (tab) {
        setOrgTab(tab);
        save(LS.orgTab, tab);
        applyImportSuggestion(entry, tab);
      }
      return titles;
    } catch (e) {
      setOrgTabs([]);
      pushLog({ err: true, text: `Tabbladen van de ${source === "tpk" ? "TPK" : "organization"}-sheet niet kunnen lezen: ${e.message}` });
      return [];
    } finally {
      setOrgTabsBusy(false);
    }
  }

  async function pickMemStore(entryOrDomain, list, quiet, sourceOverride) {
    const all = list || memStores;
    const entry = typeof entryOrDomain === "string" ? all.find((x) => x.domain === entryOrDomain) : entryOrDomain;
    if (!entry) {
      setMemStore("");
      save(LS.orgStore, "");
      setOrgTabs([]);
      return;
    }
    let source = sourceOverride || orgSource;
    // Bron die deze store niet heeft → terugvallen op wat er wél is
    if (source === "tpk" && !entry.tpkSheetId) source = "org";
    if (source === "org" && !(entry.orgSheetId || entry.aanvulSheetId) && entry.tpkSheetId) source = "tpk";
    if (source !== orgSource) {
      setOrgSource(source);
      save(LS.orgSource, source);
    }
    const url = memSheetUrl(entry, source);
    setMemStore(entry.domain);
    save(LS.orgStore, entry.domain);
    setOrgSheet(url);
    save(LS.orgSheet, url);
    // Import-lijst van deze store (uit het geheugen) → Google Sheet-blok; de
    // bladnaam volgt zodra het bronblad bekend is (applyImportSuggestion)
    if (entry.importSheetId) {
      const iurl = `https://docs.google.com/spreadsheets/d/${entry.importSheetId}/edit`;
      setWorkSheet(iurl);
      save(LS.workSheet, iurl);
    }
    const titles = await loadOrgTabs(url, entry.domain, entry, source);
    if (!quiet) {
      pushLog({
        ok: true,
        text: `Store-geheugen: ${entry.name || entry.domain} (${entry.market || "?"} · ${entry.genders || "MV"}) → ${source === "tpk" ? "TPK-sheet" : "organization-sheet"} geladen, ${titles.length} tabbladen${entry.importSheetId ? " · import-lijst van de store ingevuld" : ""}.`,
        href: url,
      });
    }
  }

  function chooseSource(src) {
    if (src === orgSource) return;
    setOrgSource(src);
    save(LS.orgSource, src);
    if (memStore) pickMemStore(memStore, undefined, false, src);
  }

  function chooseOrgTab(tab) {
    setOrgTab(tab);
    save(LS.orgTab, tab);
    if (memStore) {
      const byStore = load(LS.orgTabByStore, {});
      byStore[tabKey(memStore, orgSource)] = tab;
      save(LS.orgTabByStore, byStore);
      applyImportSuggestion(memEntry, tab);
    }
  }

  /* ---------- Scraper W-tabs aanmaken (zoals SSB) ----------
     Leest de planning van de gekozen organization-sheet (tab Keywordplan/Plan
     of de weektabs "Week 2" …) en schrijft per week een tab "Scraper W<n>" in
     het verdeling-formaat van de SSB Final Organization (A Rank · B Keyword ·
     C Collectie · D Groep · E/F volume · G piek · H Aantal · I Type · J Uitleg
     + collectie-overzicht K–N). Zelfde sheet. Bestaande Scraper-tabs blijven
     staan, tenzij je kiest voor overschrijven. */
  async function buildScraperTabs() {
    if (tabsBuildBusy || running) return;
    const sheet = orgSheet.trim();
    if (!sheet) return alert2("Kies eerst een store (of plak de link van de organization-sheet).");
    const existing = orgTabs.filter((t) => /^scraper w\d+/i.test(t));
    let overwrite = false;
    if (existing.length) {
      overwrite = window.confirm(`Er staan al ${existing.length} Scraper-tabs in deze sheet (${existing.slice(0, 4).join(", ")}${existing.length > 4 ? ", …" : ""}). OK = opnieuw schrijven (overschrijven), Annuleren = alleen ontbrekende weken toevoegen.`);
    } else if (!window.confirm("Scraper W-tabs aanmaken uit de planning van deze sheet (zoals bij SSB)? Per week één tab \"Scraper W<n>\".")) {
      return;
    }
    setTabsBuildBusy(true);
    try {
      pushLog({ strong: true, text: `— Scraper W-tabs aanmaken${memStoreName ? ` voor ${memStoreName}` : ""} (zoals SSB)` });
      const r = await sheetsCall({
        action: "buildScraperTabs",
        sheetId: sheet,
        store: memEntry ? { domain: memEntry.domain, publicDomain: memEntry.publicDomain || "" } : null,
        overwrite,
      });
      pushLog({ muted: true, text: `Planning gelezen uit ${r.bron} · weken ${r.weeks.join(", ")}${r.market ? ` · volumes uit het All-keywords-geheugen ${r.market} (${r.volumesFound} keywords gevonden)` : " · geen markt bekend → geen volumes"}` });
      for (const w of r.written) {
        pushLog({ ok: true, text: `${w.tab}${w.replaced ? " (overschreven)" : ""}: ${w.keywords} keywords · ${w.products} producten${w.men ? ` · ${w.men} heren` : ""}`, href: w.url });
      }
      if (r.skipped.length) pushLog({ muted: true, text: `Bestond al, overgeslagen: ${r.skipped.join(", ")}` });
      if (!r.written.length && !r.skipped.length) pushLog({ err: true, text: "Geen weken om te schrijven (week 1 = origineel wordt overgeslagen)." });
      // tabbladen verversen en de eerste nieuwe Scraper-tab kiezen
      const titles = await loadOrgTabs(sheet, memStore, memEntry, "org");
      const first = (r.written[0] && r.written[0].tab) || titles.find((t) => /^scraper w2$/i.test(t));
      if (first) {
        setOrgTab(first);
        save(LS.orgTab, first);
      }
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: `Scraper-tabs aanmaken mislukt: ${e.message}` });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setTabsBuildBusy(false);
    }
  }

  // ---------- Verdeling inladen (Collection & Product organization) ----------
  async function loadVerdeling() {
    if (orgBusy || running) return;
    const sheet = orgSheet.trim();
    const tab = orgTab.trim();
    if (!sheet) return alert2(orgSource === "tpk" ? "Kies een store met een TPK-sheet in het geheugen." : "Plak eerst de link van de organization-sheet.");
    if (!tab) return alert2("Vul de exacte bladnaam in.");
    if (orgSource === "tpk" && /^(overzicht|log)$/i.test(tab)) {
      return alert2(`"${tab}" is een vaste tab van de TPK-sheet — kies een weekblad (bv. W2).`);
    }
    setOrgBusy(true);
    setOrgInfo(null);
    try {
      save(LS.orgSheet, sheet);
      save(LS.orgTab, tab);
      pushLog({ strong: true, text: `— Verdeling inladen uit "${tab}"${orgSource === "tpk" ? " (TPK-sheet)" : ""}` });
      // t/m kolom J: underdog-rijen hebben daar hun uitleg (wat is het item +
      // hoe herken je het op de foto) — die reist mee voor de foto-controle.
      const data = await sheetsCall({ action: "read", sheetId: sheet, range: `'${tab}'!A1:J` });
      const values = data.values || [];
      if (!values.length) throw new Error(`Tabblad "${tab}" is leeg of bestaat niet`);

      // Formaat herkennen: verdeling (Keywords-tool) of weekplanning (Chaim-opmaak)
      const read = parseVerdelingSheet(values) || parseWeekplanSheet(values);
      if (!read) {
        const kop = values.slice(0, 8).flat().map(low).join(" ");
        if (/op store/.test(kop) && /nog te scrapen|gepland/.test(kop)) {
          throw new Error(
            `"${tab}" is het origineel (wat al op de store staat), niet om te scrapen. Kies "Scraper W1" (alleen wat nog ontbreekt) of een weektab vanaf Week 2.`
          );
        }
        throw new Error(
          `Dit blad heeft geen bekend formaat. Verwacht: verdeling (Rank · Keyword · Collectie · Groep · … · Aantal producten) of weekplanning (Categorie (Bet) · Keyword · Aantal · The Play). Controleer de bladnaam.`
        );
      }
      const { parsed, storeG } = read;
      if (read.formaat === "weekplanning") {
        const zonderCol = parsed.filter((p) => !p.col).length;
        pushLog({
          muted: true,
          text: `Weekplanning herkend${read.week ? ` (${read.week})` : ""}: ${parsed.length} keywords uit de categorieblokken, collectie per rij uit kolom A/H of de categorieregel${zonderCol ? ` — ${zonderCol} zonder collectie` : ""}.`,
        });
      }
      if (!parsed.length) throw new Error("Geen keywords gevonden in dit blad");

      // Filter uit de schakelaar hierboven toepassen
      const totalUd = parsed.filter((p) => p.type === "Underdog").length;
      let kept = parsed;
      if (orgFilter === "underdog") kept = parsed.filter((p) => p.type === "Underdog");
      if (orgFilter === "normaal") kept = parsed.filter((p) => p.type !== "Underdog");
      if (!kept.length) {
        throw new Error(
          orgFilter === "underdog"
            ? `Geen underdog-keywords in dit blad (Type "Underdog" in kolom I ontbreekt) — draai eerst de Underdog-run in de Keywords-tool.`
            : "Geen keywords over na dit filter"
        );
      }
      if (totalUd && orgFilter === "alles") {
        pushLog({ muted: true, text: `${totalUd} underdog-keywords zitten in deze lading — zet de schakelaar op "Alleen underdogs" om ze apart te scrapen.` });
      }
      const parsedFiltered = kept;

      const vrouw = parsedFiltered.filter((p) => p.g === "vrouw").map(({ k, n, col, type, uitleg }) => ({ k, n, col, type, uitleg }));
      const man = parsedFiltered.filter((p) => p.g === "man").map(({ k, n, col, type, uitleg }) => ({ k, n, col, type, uitleg }));
      const lastig = parsedFiltered.filter((p) => p.type === "Gelegenheid").length;
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

      if (storeG) {
        pushLog({
          strong: true,
          text: `Dit blad is gemarkeerd als ${storeG === "man" ? "HERENSTORE" : "DAMESZAAK"} (${read.bron}). Alle ${parsedFiltered.length} keywords worden als ${storeG === "man" ? "Man" : "Vrouw"} gescrapet — ook de keywords zonder geslachtswoord.`,
        });
      } else {
        pushLog({
          muted: true,
          text: read.formaat === "weekplanning" ? "Geen storegeslacht in de notitie — per rij: categorie \"Men's …\" of zoekterm \"mens …\" (kolom F) = Man, de rest Vrouw." : "Geen storegeslacht in de kop van kolom D — per rij wordt Groep M/V aangehouden. Draai stap 1 opnieuw als dit een heren- of dameszaak is.",
        });
      }

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
    // Is er op "Sla dit keyword over" geklikt voor het keyword dat nu draait?
    const skipRequested = (kwNow) =>
      skipRef.current != null && String(skipRef.current).toLowerCase() === String(kwNow).toLowerCase();

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
      // Per store onthouden: de tweede scrape (TPK na aanvul, of andersom) en
      // de importer kiezen dan automatisch ditzelfde blad.
      if (memStore) {
        const byStore = load(LS.importTabByStore, {});
        byStore[memStore] = tabRes.title;
        save(LS.importTabByStore, byStore);
      }
      /* Bestaand blad in een ander formaat (Chaim-scraper: Keyword · Competitor
         · … · URL in E) — daar niet onder schrijven, dan staan twee formaten
         door elkaar. Eerst omzetten in de Importer (Sheet plakken → "Zet dit
         blad om naar Attoh-formaat") of een nieuwe bladnaam kiezen. */
      if (tabRes.existed) {
        const head = await sheetsCall({ action: "read", sheetId: workSheet, range: `'${tabRes.title}'!A1:I6` }).catch(() => null);
        const fmt = head && head.values ? detectImportFormat(head.values).format : "attoh";
        if (fmt !== "attoh") {
          throw new Error(
            fmt === "chaim"
              ? `Blad "${tabRes.title}" staat in het Chaim-formaat. Zet het eerst om (Importer → Sheet plakken → "Zet dit blad om naar Attoh-formaat") of kies een nieuwe bladnaam.`
              : `Blad "${tabRes.title}" is geen import-lijst (kolom A is geen LINK). Kies een nieuwe bladnaam.`
          );
        }
      }
      pushLog({ ok: true, text: tabRes.existed ? `Tabblad "${tabRes.title}" bestaat al — producten komen eronder (vult aan)` : `Tabblad "${tabRes.title}" aangemaakt`, href: tabRes.url });
      if (!tabRes.existed) {
        try {
          await sheetsCall({ action: "formatRun", sheetId: workSheet, tabId: tabRes.tabId });
          pushLog({ muted: true, text: "Import-lijst netjes opgemaakt — kleurcodes, filter en banding staan aan." });
        } catch {
          /* opmaak is nice-to-have */
        }
      }

      /* Exclusie: het permanente geheugen (dé bron tegen dubbel scrapen).
         Twee formaten (20-10): Attoh = link in A; Chaim = Keyword · Competitor ·
         Match · Productnaam · URL (E) · Geslacht — in Sa Collective is dit
         Chaims eigen geheugen-sheet, dus zijn scraper en de onze slaan
         elkaars producten over. Per rij telt de eerste http-cel. */
      const exclude = new Set();
      let memFormat = orgDef.memorySheet.format; // "attoh" | "chaim" — leeg blad = standaard van de organisatie
      if (memSheet.trim()) {
        const mem = await sheetsCall({ action: "read", sheetId: memSheet, range: "A:F" });
        let inA = 0;
        let inE = 0;
        for (const r of mem.values || []) {
          const cell = (r || []).find((c) => typeof c === "string" && c.startsWith("http"));
          if (!cell) continue;
          if (r[0] === cell) inA++;
          else if (r[4] === cell) inE++;
          exclude.add(cell.toLowerCase().replace(/\/$/, ""));
        }
        if (inA || inE) memFormat = inE > inA ? "chaim" : "attoh";
      }
      const memRow = (m, kwNow, g) =>
        memFormat === "chaim"
          ? [kwNow, storeOf(m.link) || m._store || "", m.literal || "Literal", m.title || "", m.link, g === "Man" ? "Man" : g === "Vrouw" ? "Vrouw" : ""]
          : [m.link, kwNow, new Date().toISOString().slice(0, 10)];
      pushLog({ muted: true, text: `${exclude.size} bekende links worden overgeslagen (geheugen${memFormat === "chaim" ? ", Chaim-formaat" : ""}).` });

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

      /* ---- UNDERDOG-VOORBEREIDING ----
         Underdog-keywords staan per definitie niet letterlijk in de titels
         van concurrenten. Voor die keywords bouwen we vooraf een profiel uit
         de uitleg-zin in kolom J: woorden die winkels WÉL gebruiken, harde
         eisen en breekpunten. Dat profiel stuurt straks zowel het zoeken als
         de fotocontrole. Gewone keywords raken hier niets van. */
      const underdogRows = [];
      for (const [, rows2] of groups) {
        for (const r of rows2) if (r.type === "Underdog") underdogRows.push(r);
      }
      const udProfiles = {};
      if (underdogRows.length) {
        pushLog({
          strong: true,
          text: `${underdogRows.length} underdog-keywords — die krijgen de slimme route: zoeken op het brede producttype binnen de BESTSELLERS van elke winkel, daarna fotocontrole tegen de uitleg uit kolom J.`,
        });
        const zonderUitleg = underdogRows.filter((r) => !r.uitleg).length;
        if (zonderUitleg) {
          pushLog({
            err: true,
            text: `${zonderUitleg} underdog-keywords hebben geen uitleg in kolom J — die vallen terug op het brede producttype en worden veel minder precies. Draai de underdog-run in de Keywords-tool opnieuw als dat er veel zijn.`,
          });
        }
        const CH = 12;
        for (let i = 0; i < underdogRows.length; i += CH) {
          const part = underdogRows.slice(i, i + CH);
          pushLog({ key: "ud-prof", muted: true, text: `Underdog-profielen bouwen ${Math.min(i + CH, underdogRows.length)}/${underdogRows.length}…` });
          try {
            const res = await fetch("/api/underdog-profile", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                items: part.map((r) => ({ kw: r.k.toLowerCase(), uitleg: r.uitleg || "", col: r.col || "" })),
                market: "AUS",
              }),
            });
            const data = await res.json();
            if (res.ok && data.map) Object.assign(udProfiles, data.map);
          } catch {
            /* profiel mislukt → die keywords vallen terug op het brede type */
          }
        }
        pushLog({ key: "ud-prof", ok: true, text: `Underdog-profielen klaar voor ${Object.keys(udProfiles).length}/${underdogRows.length} keywords.` });
        /* De vertaalslag zichtbaar maken: dit is waar de vondsten vandaan
           komen. "pregnancy swimsuit" bestaat niet in titels, "maternity
           swimsuit" wel — en dat is exact hetzelfde product. */
        const vertaald = Object.entries(udProfiles)
          .filter(([kw, pr]) => pr.mainstream && pr.mainstream.toLowerCase() !== kw)
          .slice(0, 8)
          .map(([kw, pr]) => `${kw} → "${pr.mainstream}"`);
        if (vertaald.length) {
          pushLog({ text: `Zoekt op de vakterm i.p.v. het niche-woord: ${vertaald.join(" · ")}${Object.keys(udProfiles).length > 8 ? " …" : ""}` });
        }
      }

      /* ---- Product-briefings: eerst WETEN wat elk keyword werkelijk is,
              daarna pas zoeken. De briefing (definitie, harde eisen,
              disqualifiers, klassieke verwarringen) stuurt straks de
              foto-controle van elk gevonden product. ---- */
      const briefCache = load(LS_BRIEFS, {});
      const missingBriefs = allKwItems.filter((x) => !briefCache[x.kw]);
      if (missingBriefs.length) {
        try {
          pushLog({ muted: true, text: `Productkennis opbouwen — AI bepaalt voor ${missingBriefs.length} keywords wat het product precies is…` });
          /* Max 16 keywords per aanroep: één aanroep met 41 keywords liep
             tegen de Vercel-tijdslimiet en gaf een HTML-foutpagina terug
             (geen JSON) → alle productkennis weg. Nu per 16, mislukt er één
             dan missen alleen die keywords hun titelvorm. */
          const SLICE = 16;
          const data = { map: {}, failed: [] };
          for (let i = 0; i < missingBriefs.length; i += SLICE) {
            const part = missingBriefs.slice(i, i + SLICE);
            try {
              const res = await fetch("/api/keyword-brief", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keywords: part }),
              });
              const txt = await res.text();
              let d = null;
              try {
                d = JSON.parse(txt);
              } catch {
                throw new Error(`server gaf geen JSON terug (${res.status}: ${txt.slice(0, 60)}…) — waarschijnlijk tijdslimiet`);
              }
              if (!res.ok || !d.map) throw new Error(d.error || res.status);
              Object.assign(data.map, d.map);
              if (Array.isArray(d.failed)) data.failed.push(...d.failed);
            } catch (e) {
              data.failed.push(...part.map((x) => x.kw));
              pushLog({ warn: true, text: `Productkennis deel ${Math.floor(i / SLICE) + 1} mislukt (${e.message}) — die ${part.length} keywords krijgen geen titelvorm.` });
            }
          }
          if (Object.keys(data.map).length) {
            Object.assign(briefCache, data.map);
            save(LS_BRIEFS, briefCache);
            const got = Object.keys(data.map).length;
            pushLog({ ok: true, text: `Productkennis klaar voor ${got} keywords — elk gevonden product wordt tegen zijn eigen definitie gecontroleerd.` });
            if (data.failed.length) {
              pushLog({ err: true, text: `LET OP: briefing mislukt voor ${data.failed.length} keywords (${data.failed.slice(0, 5).join(", ")}…) — bij die keywords blijft TITELVORM (kolom K) leeg en is de foto-controle minder streng.` });
            }
          } else {
            throw new Error("geen enkele briefing gelukt");
          }
        } catch (e) {
          pushLog({ err: true, text: `LET OP: productkennis laden mislukt (${e.message}) — TITELVORM (kolom K) blijft dan LEEG en de foto-controle draait op algemene kennis. Run gaat door, maar de gelegenheids-titels missen hun titelvorm.` });
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

      /* ---- Buitenlandse competitors: keywords vooraf vertalen ----
         De AI-selectie kan NL/FR/PL-stores bevatten; die winkels titelen in
         hun eigen taal. Per taal één batch-vertaling (gecachet), zodat de
         run zelf nergens hoeft te wachten. */
      const transCache = load(LS_TRANS, {});
      /* Taal per winkel: eerst uit de permanente catalogus-cache (taal
         herkend aan de eigen titels), anders uit de competitor-sheet. */
      const metaNow = {};
      for (const d of stores) metaNow[d] = { ...(compMeta[d] || {}) };
      try {
        const ci = await fetch("/api/competitors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "catalogInfo", domains: stores }),
        }).then((r) => r.json());
        if (ci && ci.meta) {
          setCatInfo((prev) => ({ ...prev, ...ci.meta }));
          let cached = 0;
          for (const [d, m] of Object.entries(ci.meta)) {
            cached++;
            if (m.lang) metaNow[d] = { ...(metaNow[d] || {}), lang: m.lang, langDetected: true };
          }
          pushLog({ muted: true, text: `📦 Catalogus-cache: ${cached}/${stores.length} winkels staan al klaar — die worden direct doorzocht.` });
        }
      } catch {
        /* geen cache-info → gewoon live laden */
      }
      const LANG_MARKET_ALL = { nl: "NL/BE", fr: "FR", pl: "PL", de: "DE", es: "ES", it: "IT" };
      const allKwList = allKwItems.map((x) => x.kw);
      // Vertalingen voor één taal, in één batch, gecachet in de browser
      const ensureTranslations = async (lang) => {
        if (!lang || lang === "en") return;
        const missing = allKwList.filter((k2) => !(transCache[lang] || {})[k2]);
        if (!missing.length) return;
        try {
          const res = await fetch("/api/competitors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "translate", keywords: missing, market: LANG_MARKET_ALL[lang] || lang }),
          });
          const data = await res.json();
          if (res.ok && data.map) {
            transCache[lang] = { ...(transCache[lang] || {}), ...data.map };
            save(LS_TRANS, transCache);
            pushLog({ ok: true, text: `Vertalingen klaar (${lang.toUpperCase()}) — bv. ${Object.entries(data.map).slice(0, 2).map(([k3, v]) => `"${k3}" → "${v[0]}"`).join(" · ")}` });
          }
        } catch (e) {
          pushLog({ warn: true, text: `Vertalen naar ${lang} mislukt (${e.message}) — die winkel wordt met de Engelse term doorzocht.` });
        }
      };
      // Winkel nog niet in de cache? Eén keer laden: dan is de taal bekend
      // (en staat de catalogus klaar voor alle volgende keywords).
      const langChecked = new Set();
      const ensureStoreLang = async (store) => {
        if (langChecked.has(store)) return;
        langChecked.add(store);
        if (!(metaNow[store] && metaNow[store].langDetected)) {
          try {
            const r = await fetch("/api/competitors", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "catalog", domain: store }),
            }).then((x) => x.json());
            if (r && r.meta) {
              metaNow[store] = { ...(metaNow[store] || {}), lang: r.meta.lang, langDetected: true };
              setCatInfo((prev) => ({ ...prev, [store]: r.meta }));
              if (r.meta.lang && r.meta.lang !== "en") {
                pushLog({ muted: true, text: `${store}: winkel is ${r.meta.lang.toUpperCase()}-talig — zoekt ook op de vertaling.` });
              }
            }
          } catch {}
        }
        await ensureTranslations((metaNow[store] && metaNow[store].lang) || "en");
      };
      const foreignLangs = [
        ...new Set(
          stores
            .map((d) => (metaNow[d] && metaNow[d].lang) || "en")
            .filter((l) => l && l !== "en")
        ),
      ];
      const LANG_MARKET = { nl: "NL/BE", fr: "FR", pl: "PL", de: "DE" };
      for (const lang of foreignLangs) {
        const missing = allKwItems.map((x) => x.kw).filter((k) => !(transCache[lang] || {})[k]);
        if (!missing.length) continue;
        try {
          pushLog({ muted: true, text: `Keywords vertalen naar ${lang.toUpperCase()} voor buitenlandse stores…` });
          const res = await fetch("/api/competitors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "translate", keywords: missing, market: LANG_MARKET[lang] || lang }),
          });
          const data = await res.json();
          if (res.ok && data.map) {
            transCache[lang] = { ...(transCache[lang] || {}), ...data.map };
            save(LS_TRANS, transCache);
            pushLog({ ok: true, text: `Vertalingen klaar (${lang.toUpperCase()}) — bv. ${Object.entries(data.map).slice(0, 2).map(([k, v]) => `"${k}" → "${v[0]}"`).join(" · ")}` });
          }
        } catch (e) {
          pushLog({ warn: true, text: `Vertalen naar ${lang} mislukt (${e.message}) — die stores zoeken dan met de Engelse term.` });
        }
      }

      let grandTotal = 0;
      const hardKeywords = []; // bleef op 0 ondanks alles
      for (const [gender, rows] of groups) {
        for (const { k, n, col, type } of rows) {
          let needed = Number(n) || 10;
          const target = needed;
          const udProfile = type === "Underdog" ? udProfiles[k.toLowerCase()] || null : null;
          /* Bij een underdog vervangt het profiel de gewone briefing: de
             titelvorm (kolom K) en de fotocontrole komen dan uit de uitleg
             in kolom J in plaats van uit een algemene productdefinitie. */
          const kwBrief = udProfile
            ? { ...(briefCache[k.toLowerCase()] || {}), titleForm: udProfile.titleForm, definition: udProfile.uitleg }
            : briefCache[k.toLowerCase()] || null;
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
          skipRef.current = null;
          setSkipHint("");
          const kwLower = k.toLowerCase();
          const alts = altCache[kwLower] || [];
          const provenHit = altHits[kwLower]; // alternatief dat vorige keer scoorde
          let terms = provenHit && provenHit !== kwLower ? [k, provenHit] : [k];

          /* DE VAKTERM — geldt voor ELK keyword, niet alleen underdogs.
             Shoppers en winkels gebruiken andere woorden voor exact hetzelfde
             product: niemand titelt "pregnancy swimsuit", iedereen titelt
             "maternity swimsuit". Zoeken op het woord van de winkel levert de
             treffer; in de sheet blijft gewoon JOUW keyword staan, zodat het
             product straks ook op jouw zoekterm wordt geïmporteerd.
             Daarom gaat de vakterm meteen mee — niet pas als vangnet. */
          const mainstream = (kwBrief && kwBrief.mainstream) || "";
          if (mainstream && mainstream !== kwLower && alternativeIsSafe(k, mainstream)) {
            if (!terms.some((t) => t.toLowerCase() === mainstream)) {
              terms = [...terms, mainstream];
              pushLog({
                ok: true,
                text: `Vakterm: winkels noemen "${k}" een "${mainstream}" — daar wordt meteen ook op gezocht, het product krijgt in de sheet gewoon "${k}".`,
              });
            }
          }

          /* Underdogs kennen hun eigen zoekwoorden al: die zitten in het
             profiel en worden server-side gebruikt (vakterm → zoektermen →
             breed type). Eén term per winkel dus, anders scannen we dezelfde
             catalogus meerdere keren voor niets. */
          if (udProfile) terms = [k];
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
          // Elke store×term-combinatie maar één keer zoeken. De ladder
          // draaide bij moeilijke keywords dezelfde combinaties opnieuw
          // (ronde 2 herhaalde álle termen van ronde 1) — puur wachttijd.
          const triedPairs = new Set();

          /* Geven true terug als er écht nieuwe zoektermen bij zijn gekomen.
             Dat is het sein om de ladder opnieuw vanaf winkel 1 te starten. */
          const expandAlts = (reason) => {
            if (altsFull) return false;
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
              pushLog({ ok: true, text: `${reason} — zoekt nu ook op: ${safeAlts.join(" · ")}, opnieuw vanaf de beste winkel.` });
              return true;
            }
            return false;
          };
          const expandBroad = () => {
            if (broadActive) return false;
            broadActive = true;
            // Bij een keyword met een harde eigenschap bestaat er geen breed
            // vangnet: "boots" is geen vervanging voor "waterproof boots".
            if (hardAttributes(k).length) {
              pushLog({ muted: true, text: `Geen breed vangnet voor "${k}" — de eigenschap "${hardAttributes(k).join(", ")}" mag niet wegvallen.` });
              return false;
            }
            const b = broadTermFor(k, alts);
            if (b && !terms.some((t) => t.toLowerCase() === b)) {
              terms = [...terms, b];
              pushLog({ ok: true, text: `Breed vangnet actief — ook op "${b}", opnieuw vanaf de beste winkel (strenge match + geslacht blijven gelden).` });
              return true;
            }
            return false;
          };

          /* Underdogs hebben hun eigen verbreding: de bestseller-eis. Vinden
             we niets binnen de bovenste 45% van een winkel, dan gaan we in de
             volgende ronde door de hele catalogus — opnieuw vanaf winkel 1,
             zodat de béste winkel als eerste die ruimere kans krijgt. */
          let udRelax = false;
          const relaxUnderdog = () => {
            if (!udProfile || udRelax) return false;
            udRelax = true;
            pushLog({
              ok: true,
              text: `Geen bewezen bestseller gevonden voor "${k}" — tweede ronde zonder bestseller-grens, opnieuw vanaf de beste winkel.`,
            });
            return true;
          };

          // Eén ronde langs alle stores met de huidige zoektermen
          /* SNELLER (13-10): winkels in GOLVEN van WAVE tegelijk doorzoeken
             i.p.v. één voor één, en de kandidaten van de hele golf samen
             rangschikken: titel-match vóór omschrijving, daarna BEWEZEN
             (best-selling-positie in de winkel, deels uitverkocht, vraag-
             score) — pas daarna de winkelvolgorde. Zo pakt de tool de
             bestsellers van de golf, niet blind alles van de eerste winkel.
             Sheet-schrijven gebeurt één keer per golf. */
          const scanStores = async (withStallLogic) => {
            for (let w = 0; w < stores.length; w += WAVE) {
              await checkControl();
              if (needed <= 0) return;
              if (skipRequested(k)) {
                stallDecision.current = "skip";
                return;
              }
              if (stallDecision.current === "skip" || stallDecision.current === "skip-auto") return;
              if (stallDecision.current === "ai") {
                setStall(null);
                stallDecision.current = "continue";
                const a = expandAlts("Op jouw verzoek");
                const b = expandBroad();
                const c = relaxUnderdog();
                if (a || b || c) return "restart";
              }
              const wave = stores.slice(w, w + WAVE);
              await Promise.all(wave.map((st) => ensureStoreLang(st)));
              const needAtStart = needed;

              const results = await Promise.all(
                wave.map(async (store, wi) => {
                  const out = { store, wi, items: [], scanned: 0, bsStatus: "", bsTotal: 0, skips: { gender: 0, foreign: 0, vraag: 0, kids: 0, set: 0 } };
                  const storeLang = (metaNow[store] && metaNow[store].lang) || "en";
                  const storeTerms =
                    storeLang !== "en"
                      ? [...new Set([...((transCache[storeLang] || {})[kwLower] || []), ...terms])]
                      : terms;
                  for (const term of storeTerms) {
                    const pairKey = `${store}|${term.toLowerCase()}`;
                    if (triedPairs.has(pairKey)) continue;
                    triedPairs.add(pairKey);
                    try {
                      const res = await fetch(udProfile ? "/api/underdog-search" : "/api/scraper-search", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          store,
                          keyword: udProfile ? k : term,
                          profile: udProfile || undefined,
                          relaxBestseller: udRelax || undefined,
                          gender,
                          need: needAtStart,
                          excludeLinks: [...exclude],
                          maxPerStore: spreadMode === "vol" ? needAtStart : Math.max(2, Math.ceil(target / 3)),
                          proof: proofMode,
                          fast: fastMode,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || res.status);
                      let found = data.matches || [];
                      if (udProfile && data.stats && !found.length) {
                        const st = data.stats;
                        pushLog({
                          muted: true,
                          text:
                            `${store}: ${data.candidates || 0} kandidaten` +
                            (st.grensLos ? " (bestseller-grens losgelaten — te weinig in de top)" : "") +
                            ` · afgevallen: ${st.typeMis || 0} verkeerd producttype, ${st.breekpunt || 0} breekpunt in titel, ${st.geslacht || 0} verkeerd geslacht` +
                            (st.naarAi ? ` · ${st.naarAi} naar de fotocontrole` : " · niets voor de fotocontrole"),
                        });
                      }
                      out.scanned = Math.max(out.scanned, data.total || 0);
                      if (data.bestSellingStatus) out.bsStatus = data.bestSellingStatus;
                      if (data.rankTotal) out.bsTotal = data.rankTotal;
                      if (data.skipped) for (const key of Object.keys(out.skips)) out.skips[key] = Math.max(out.skips[key], data.skipped[key] || 0);

                      // Foto-AI alleen bij zwak bewijs of een hulp-zoekterm
                      const toVerify = udProfile ? [] : term !== k || isOccasion ? found : found.filter((m) => m.needsPhotoProof);
                      if (toVerify.length) {
                        try {
                          const vres = await fetch("/api/verify-products", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              keyword: k,
                              gender,
                              brief: kwBrief,
                              items: toVerify.map((m) => ({
                                index: found.indexOf(m),
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
                            const kept = found.filter((_, fi) => !bad.has(fi));
                            pushLog({ muted: true, text: `Foto-controle ${store}: ${found.length - kept.length} van ${found.length} afgekeurd voor "${k}"` });
                            found = kept;
                          }
                        } catch {
                          /* vision niet beschikbaar → gewoon meenemen */
                        }
                      }
                      for (const m of found) out.items.push({ ...m, _term: term, _store: store, _wi: wi });
                    } catch (e) {
                      pushLog({ err: true, text: `${store}: ${e.message}` });
                      break;
                    }
                  }
                  return out;
                })
              );

              /* Rangschikken over de hele golf: bewezen eerst */
              const proofScore = (m) => {
                let sc = 0;
                if (m.bsPct !== null && m.bsPct !== undefined) sc += Math.max(0, 100 - Number(m.bsPct)) * 0.6; // top van de winkel
                if (typeof m.demand === "number") sc += m.demand * 0.4;
                if (m.soldOutRatio > 0 && m.soldOutRatio < 1) sc += 8; // deels uitverkocht = verkoopt
                return sc;
              };
              const tierOf = (m) => (String(m.source || "").startsWith("Titel") ? 0 : String(m.source || "").startsWith("Omschrijving") ? 1 : 2);
              const all = results.flatMap((r) => r.items);
              all.sort(
                (a, b) =>
                  tierOf(a) - tierOf(b) ||
                  (a._term === k ? 0 : 1) - (b._term === k ? 0 : 1) ||
                  proofScore(b) - proofScore(a) ||
                  a._wi - b._wi
              );

              const take = [];
              const seenLinks = new Set();
              for (const m of all) {
                if (take.length >= needed) break;
                const lk = m.link.toLowerCase().replace(/\/$/, "");
                if (seenLinks.has(lk) || exclude.has(lk)) continue;
                seenLinks.add(lk);
                const nt = normTitle(m.title);
                if (nt && seenTitles.has(nt)) {
                  titleDupHits++;
                  continue;
                }
                const dom = storeOf(m.link) || m._store;
                if (spreadMode !== "vol") {
                  const cap = Math.ceil(Math.max(20, Number(totalTarget) || 0) * MAX_STORE_SHARE);
                  if ((perStore.get(dom) || 0) >= cap) {
                    storeCapHits++;
                    continue;
                  }
                }
                if (nt) seenTitles.add(nt);
                perStore.set(dom, (perStore.get(dom) || 0) + 1);
                take.push(m);
              }

              if (take.length) {
                const newRows = take.map((m) => [
                  m.link,
                  m.title,
                  k,
                  m.source + (m._term === k ? "" : ` · via "${m._term}"`),
                  m._term === k ? m.literal : "Ruim",
                  gender === "Man" ? "Man" : gender === "Vrouw" ? "Vrouw" : "",
                  "",
                  "",
                  col || "",
                  kwType,
                  (kwBrief && kwBrief.titleForm) || "",
                  m.demandLabel || "",
                  m.demand === null || m.demand === undefined ? "" : m.demand,
                  m.signals || "",
                ]);
                await Promise.all([
                  sheetsCall({ action: "append", sheetId: workSheet, range: `'${runTitle}'!A:N`, rows: newRows }),
                  memSheet.trim()
                    ? sheetsCall({ action: "append", sheetId: memSheet, rows: take.map((m) => memRow(m, k, gender)) })
                    : Promise.resolve(),
                ]);
                if (memSheet.trim()) memAdded += take.length;
                for (const m of take) exclude.add(m.link.toLowerCase().replace(/\/$/, ""));
                needed -= take.length;
                grandTotal += take.length;
                setProg((p) => ({ ...p, found: grandTotal, kwFound: target - needed }));
                const altTerm = take.find((m) => m._term.toLowerCase() !== kwLower);
                if (altTerm) {
                  altHits[kwLower] = altTerm._term.toLowerCase();
                  save(LS_ALT_HITS, altHits);
                }
              }

              // Eén logregel per winkel in de golf
              for (const r of results) {
                const got = take.filter((m) => m._store === r.store).length;
                const sk = r.skips;
                pushLog({
                  ok: true,
                  text:
                    `${r.store}: ${got} genomen van ${r.items.length} gevonden (${r.scanned} gescand${r.bsStatus === "geldig" ? `, best-selling ✓ ${r.bsTotal}` : r.bsStatus === "genegeerd" ? ", best-selling ✗" : ""})` +
                    (sk.gender || sk.foreign || sk.kids || sk.set
                      ? ` · overgeslagen: ${[
                          sk.gender ? `${sk.gender} geslacht` : "",
                          sk.kids ? `${sk.kids} baby/kids` : "",
                          sk.set ? `${sk.set} set` : "",
                          sk.foreign ? `${sk.foreign} anderstalig` : "",
                        ].filter(Boolean).join(" · ")}`
                      : ""),
                });
              }
              pushLog({ muted: true, text: `"${k}": nog ${Math.max(needed, 0)} nodig.` });
              storesTried += wave.length;

              if (withStallLogic && needed === target) {
                if (udProfile) {
                  if (storesTried >= ALTS_AT && relaxUnderdog()) return "restart";
                } else {
                  if (storesTried >= ALTS_AT && alts.length && expandAlts(`Na ${storesTried} winkel(s) nog 0`)) return "restart";
                  if (storesTried >= BROAD_AT && expandBroad()) return "restart";
                }
                if (storesTried >= STALL_PROMPT_AT && storesTried - wave.length < STALL_PROMPT_AT && !stallDecision.current) {
                  setStall({ kw: k, gender });
                  pushLog({
                    warn: true,
                    text: `"${k}" na ${storesTried} stores nog 0 — slim zoeken is al actief; na ${STALL_AUTO_AT} stores ga ik automatisch door naar het volgende keyword.`,
                  });
                }
                if (storesTried >= STALL_AUTO_AT && stallDecision.current !== "continue") {
                  setStall(null);
                  stallDecision.current = "skip-auto";
                  pushLog({ warn: true, text: `"${k}" na ${storesTried} stores nog 0 — automatisch door naar het volgende keyword.` });
                  return;
                }
              }
            }
          };

          /* De ladder draait in rondes: elke keer dat de aanpak verbreedt
             (AI-alternatieven, breed vangnet, of bij underdogs de
             bestseller-grens los) begint hij opnieuw bij winkel 1. Zo krijgt
             de beste winkel élke aanpak als eerste te zien, in plaats van
             alleen de eerste en slechtste variant ervan. */
          for (let ronde = 0; ronde < MAX_LADDER_ROUNDS; ronde++) {
            const res = await scanStores(true);
            if (res !== "restart") break;
            if (needed <= 0) break;
            storesTried = 0; // nieuwe aanpak = de ladder opnieuw
          }

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
  /* Keyword overslaan — altijd beschikbaar zolang de run draait. Wat al
     gevonden is voor dit keyword blijft gewoon in de sheet staan; alleen het
     verder zoeken stopt. */
  function skipKeyword() {
    const kwNow = prog && prog.currentKw;
    if (!kwNow) return;
    skipRef.current = kwNow;
    setSkipHint(kwNow);
    pushLog({ warn: true, text: `"${kwNow}" handmatig overgeslagen — door naar het volgende keyword.` });
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

  /* ---------- Competitor-sheet: inlezen + slimme selectie ---------- */

  async function compParse() {
    if (compBusy || !compSheet.trim() || !compTab.trim()) return;
    setCompBusy("parse");
    try {
      pushLog({ strong: true, text: `— Competitor-sheet inlezen: "${compTab.trim()}"` });
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", sheetId: compSheet.trim(), tab: compTab.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      setCompStores(data.stores);
      save(LS_COMP_SHEET, compSheet.trim());
      save(LS_COMP_TAB, compTab.trim());
      const perMarket = Object.entries(data.perMarket || {})
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}: ${n}`)
        .join(" · ");
      pushLog({ ok: true, text: `${data.stores.length} unieke stores herkend (duplicaten samengevoegd) — ${perMarket}` });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: "Sheet inlezen mislukt: " + (e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setCompBusy("");
    }
  }


  /* STORE-AUDIT: echte feiten per winkel (Shopify? best-selling geldig?
     dekking van jouw producttypes? valuta? geslacht?) → score 0–100 →
     zoekvolgorde. Draait automatisch na "Beste competitors kiezen" en
     handmatig via "Stores checken" (voor stores die je zelf hebt geplakt). */
  function runTypes() {
    const all = [...kw.vrouw, ...kw.man].map((r) => String(r.k || "").trim()).filter(Boolean);
    return [...new Set(all.map((k) => k.toLowerCase().split(/\s+/).pop()).filter((w) => w && w.length > 2))];
  }
  function runGenders() {
    const g = [];
    if (kw.vrouw.some((r) => String(r.k || "").trim())) g.push("Vrouw");
    if (kw.man.some((r) => String(r.k || "").trim())) g.push("Man");
    return g;
  }
  async function auditStores(domains, metaIn) {
    const list = (domains || []).filter(Boolean);
    if (!list.length) return null;
    setAuditBusy(true);
    try {
      pushLog({ strong: true, text: `— Stores checken: Shopify · best-selling · dekking · valuta (${list.length} stores)` });
      // In porties van 25 (elke call < 60 s) — de API checkte vroeger
      // alleen de eerste 60 en de rest viel daarna uit de lijst.
      let audits = [];
      for (let i = 0; i < list.length; i += 25) {
        const part = list.slice(i, i + 25);
        pushLog({ key: "audit-prog", muted: true, text: `Checken ${Math.min(i + 25, list.length)}/${list.length}…` });
        const res = await fetch("/api/competitors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "audit",
            domains: part,
            types: runTypes(),
            targetMarket: compMarket,
            genders: runGenders(),
            meta: metaIn || compMeta,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);
        audits.push(...(data.audits || []));
      }
      audits.sort((x, y) => y.score - x.score || (y.visits || 0) - (x.visits || 0));
      const meta = { ...(metaIn || compMeta) };
      for (const a of audits) {
        meta[a.domain] = {
          ...(meta[a.domain] || {}),
          score: a.score,
          bestSelling: a.bestSelling,
          coverage: Math.round((a.coverage || 0) * 100),
          currency: a.currency || "",
          ok: !!a.ok,
        };
      }
      setCompMeta(meta);
      save(LS_COMP_META, meta);
      await saveOrder(audits.map((a) => a.domain), meta);
      const dead = audits.filter((a) => !a.ok);
      const ignored = audits.filter((a) => a.ok && a.bestSelling === "genegeerd");
      pushLog({ ok: true, text: `Zoekvolgorde op score: ${audits.slice(0, 3).map((a) => `${a.domain} (${a.score})`).join(" · ")}${audits.length > 3 ? " · …" : ""}` });
      for (const a of audits.slice(0, 10)) pushLog({ muted: true, text: `${a.score.toString().padStart(3, " ")} · ${a.domain} — ${a.why}` });
      if (audits.length > 10) pushLog({ muted: true, text: `… en ${audits.length - 10} meer (score staat achter elke store links).` });
      if (ignored.length) pushLog({ muted: true, text: `${ignored.length} winkels negeren sort_by=best-selling — daar is geen bestseller-bewijs, ze staan onderaan.` });
      if (dead.length) pushLog({ err: true, text: `${dead.length} winkels offline/geen Shopify: ${dead.map((a) => a.domain).join(", ")} — verwijder ze uit de lijst.` });
      return audits;
    } catch (e) {
      pushLog({ err: true, text: "Stores checken mislukt: " + (e.message || e) });
      return null;
    } finally {
      setAuditBusy(false);
    }
  }

  async function compSelect() {
    if (compBusy || !compStores.length) return;
    setCompBusy("select");
    try {
      const kws = [
        ...kw.vrouw.map((r) => r.k).filter(Boolean),
        ...kw.man.map((r) => r.k).filter(Boolean),
      ];
      pushLog({ strong: true, text: `— AI kiest de beste competitors voor markt ${compMarket} (max ${compMax})` });
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "select",
          stores: compStores,
          targetMarket: compMarket,
          keywords: kws,
          maxStores: Number(compMax) || 25,
          totalProducts: kw.vrouw.concat(kw.man).reduce((a, r) => a + (Number(r.n) || 0), 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      const picks = data.picks || [];
      if (!picks.length) throw new Error("AI koos geen enkele store");

      // Zoekvolgorde = deze volgorde (beste eerst); meta bewaren voor de run
      const meta = {};
      for (const p of picks) meta[p.domain] = { market: p.market, visits: p.visits, lang: p.lang || "en", reason: p.reason || "" };
      setCompMeta(meta);
      save(LS_COMP_META, meta);
      // De AI-keuze komt bovenaan; je bestaande winkels blijven eronder staan
      await saveOrder(picks.map((p) => p.domain), meta);

      pushLog({ ok: true, text: `${picks.length} stores gekozen${data.ai ? " (AI)" : " (ranking op bezoek — AI onbereikbaar)"}. Zoekvolgorde = beste eerst.` });
      const foreign = picks.filter((p) => p.lang && p.lang !== "en");
      for (const p of picks.slice(0, 8)) {
        pushLog({ muted: true, text: `${p.domain} — ${p.market} · ${p.visits ? p.visits.toLocaleString("nl-NL") + "/mnd" : "?"}${p.reason ? ` · ${p.reason}` : ""}` });
      }
      if (picks.length > 8) pushLog({ muted: true, text: `… en ${picks.length - 8} meer (zie de lijst links).` });
      if (foreign.length) {
        pushLog({ muted: true, text: `${foreign.length} buitenlandse stores — keywords worden bij de run automatisch vertaald (${[...new Set(foreign.map((p) => p.lang))].join(", ")}).` });
      }
      // Sheet-bezoek is een gok; nu de feiten: is het Shopify, werkt
      // best-selling, past de catalogus bij deze keywords? Die score bepaalt
      // de definitieve zoekvolgorde.
      await auditStores(picks.map((p) => p.domain), meta);
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    } catch (e) {
      pushLog({ err: true, text: "Selectie mislukt: " + (e.message || e) });
      window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
    } finally {
      setCompBusy("");
    }
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
        {/* -------- Stappenstrook (zoals Keywords → Geheugen): klik = naar de kaart -------- */}
        <div className="gh-steps sc-steps">
          <div className={"gh-step" + (storeList.length ? " done" : "")} onClick={() => jumpTo("stores")} role="button" tabIndex={0}>
            <div className="gh-step-n">{storeList.length ? "✓" : "1"}</div>
            <div>
              <div className="gh-step-t">Stores</div>
              <div className="gh-step-s">{storeList.length ? `${storeList.length} stores · ${cachedCount} catalogi in cache` : "nog geen stores"}</div>
            </div>
          </div>
          <div className={"gh-step" + (orgInfo ? " done" : "")} onClick={() => jumpTo("verdeling")} role="button" tabIndex={0}>
            <div className="gh-step-n">{orgInfo ? "✓" : "2"}</div>
            <div>
              <div className="gh-step-t">Verdeling</div>
              <div className="gh-step-s">{orgInfo ? `${memStoreName || "handmatig"} · ${orgTab} · ${orgInfo.vrouwN + orgInfo.manN} producten` : "store + tabblad kiezen"}</div>
            </div>
          </div>
          <div className={"gh-step" + (workSheet.trim() ? " done" : "")} onClick={() => jumpTo("sheet")} role="button" tabIndex={0}>
            <div className="gh-step-n">{workSheet.trim() ? "✓" : "3"}</div>
            <div>
              <div className="gh-step-t">Import-lijst</div>
              <div className="gh-step-s">{workSheet.trim() ? `blad: ${newTabName.trim() || "automatisch"}` : "geen sheet"}</div>
            </div>
          </div>
          <div className={"gh-step" + (prog && !running ? " done" : "")} onClick={() => jumpTo("run")} role="button" tabIndex={0}>
            <div className="gh-step-n">{running ? "…" : prog ? "✓" : "4"}</div>
            <div>
              <div className="gh-step-t">Run</div>
              <div className="gh-step-s">{prog ? `${prog.found} / ${prog.target} producten${running ? " · bezig" : ""}` : "klaar om te starten"}</div>
            </div>
          </div>
        </div>
        <div className="layout-scraper">
          {/* -------- Linker kolom -------- */}
          <div>
            <div className={secCls("compsheet", false)} id="sec-compsheet">
              <SecHead id="compsheet" dflt={false} sum={compTab.trim() ? `tab: ${compTab}` : "AI kiest uit de sheet"}>
                Competitor-sheet <span className="opt">(slimme selectie)</span>
              </SecHead>
              <div className="field-label">Google Sheet-link</div>
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={compSheet}
                onChange={(e) => setCompSheet(e.target.value)}
              />
              <div className="field-label">Exacte bladnaam</div>
              <input
                type="text"
                placeholder="bv. Google competitors"
                value={compTab}
                onChange={(e) => setCompTab(e.target.value)}
              />
              <div style={{ marginTop: 10 }}>
                <button className="btn-ghost btn-small" onClick={compParse} disabled={!!compBusy || !compSheet.trim() || !compTab.trim()}>
                  {compBusy === "parse" ? "Inlezen…" : "⌕ Sheet inlezen"}
                </button>
                {compStores.length > 0 && (
                  <span className="muted small" style={{ marginLeft: 10 }}>
                    {compStores.length} stores herkend
                  </span>
                )}
              </div>
              {compStores.length > 0 && (
                <>
                  <div className="kw-row" style={{ gridTemplateColumns: "1fr 90px", marginTop: 12 }}>
                    <div>
                      <div className="field-label">Doelmarkt van jouw store</div>
                      <select value={compMarket} onChange={(e) => setCompMarket(e.target.value)}>
                        {["USA", "UK", "AUS", "CANADA", "NL/BE", "FR", "PL"].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="field-label">Max stores</div>
                      <input type="number" value={compMax} onChange={(e) => setCompMax(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button className="btn" onClick={compSelect} disabled={!!compBusy}>
                      {compBusy === "select" ? "AI kiest…" : "✨ Beste competitors kiezen"}
                    </button>
                  </div>
                  <div className="hint">
                    Doelmarkt = de markt van jóuw store — het is een prioriteit, geen filter. De
                    selectie is altijd een mix: ±60% eigen markt, ±25% andere Engelstalige markten en
                    ±15% vertaal-markten (NL/FR/PL — keywords worden bij de run automatisch vertaald).
                    Opmerkingen als "alleen schoentjes" wegen mee. De keuze vervangt de lijst hieronder.
                  </div>
                </>
              )}
            </div>

            <div className={secCls("stores", !storeList.length)} id="sec-stores">
              <SecHead id="stores" dflt={!storeList.length} sum={storeList.length ? `${storeList.length} stores · ${cachedCount} in cache${cacheStats ? ` · Redis ${cacheStats.usedMb}${cacheStats.maxMb ? `/${cacheStats.maxMb}` : ""} MB` : ""}` : "nog geen stores"}>
                Competitor stores
              </SecHead>
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
              <div
                style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
                onPaste={(e) => {
                  const files = [...(e.clipboardData?.files || [])];
                  if (files.length) {
                    e.preventDefault();
                    importScreenshots(files);
                  }
                }}
              >
                <label className="btn-ghost btn-small" style={{ cursor: "pointer" }}>
                  {shotBusy ? `📷 Lezen ${shotBusy}…` : "📷 Screenshot competitor-sheet"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    disabled={!!shotBusy}
                    onChange={(e) => {
                      importScreenshots(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <span className="hint" style={{ margin: 0 }}>
                  of plak een screenshot (Ctrl+V) hier — bezoek/mnd, land, producten en opmerking worden per winkel
                  ingevuld, nieuwe winkels komen erbij, dubbele worden genegeerd.
                </span>
              </div>
              <div
                style={{
                  maxHeight: 420,
                  overflowY: "auto",
                  marginTop: 10,
                  paddingRight: 4,
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 8,
                }}
              >
              {storeList.map((s) => (
                <div className="kw-row" key={s} style={{ gridTemplateColumns: "1fr 24px" }}>
                  <span className="small" style={{ wordBreak: "break-all" }}>
                    {s}
                    {compMeta[s] && (
                      <span className="muted">
                        {compMeta[s].score !== undefined ? ` · score ${compMeta[s].score}` : ""}
                        {compMeta[s].market ? ` · ${compMeta[s].market}` : ""}
                        {compMeta[s].visits
                          ? ` · ${compMeta[s].visits >= 1e6 ? `${(compMeta[s].visits / 1e6).toFixed(1).replace(".0", "")}M` : `${Math.round(compMeta[s].visits / 1000)}k`}/mnd`
                          : ""}
                        {compMeta[s].note ? ` · ${compMeta[s].note}` : ""}
                        {compMeta[s].bestSelling === "geldig" ? " · best-selling ✓" : compMeta[s].bestSelling === "genegeerd" ? " · best-selling ✗" : ""}
                        {compMeta[s].coverage !== undefined ? ` · ${compMeta[s].coverage}% dekking` : ""}
                        {compMeta[s].ok === false ? " · ⚠ offline" : ""}
                        {compMeta[s].lang && compMeta[s].lang !== "en" ? ` · ${compMeta[s].lang.toUpperCase()}` : ""}
                      </span>
                    )}
                    {catInfo[s] && (
                      <span className="muted">
                        {` · 📦 ${Number(catInfo[s].count || 0).toLocaleString("nl-NL")} producten${catInfo[s].truncated ? ` (ingekort van ${Number(catInfo[s].total || 0).toLocaleString("nl-NL")})` : ""} · ${new Date(catInfo[s].at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                        {catInfo[s].lang && catInfo[s].lang !== "en" && !(compMeta[s] && compMeta[s].lang) ? ` · ${catInfo[s].lang.toUpperCase()}` : ""}
                      </span>
                    )}
                  </span>
                  <button className="kw-x" onClick={() => removeStoreItem(s)}>
                    ×
                  </button>
                </div>
              ))}
              </div>
              {storeList.length > 0 && (
                <>
                  <div className="hint">
                    {storeList.length} stores — volgorde = zoekvolgorde (beste eerst) ·{" "}
                    {Object.keys(catInfo).filter((d) => storeList.includes(d)).length} catalogi in de cache
                    {cacheStats ? ` · Redis ${cacheStats.usedMb} MB${cacheStats.maxMb ? ` van ${cacheStats.maxMb} MB` : ""}${cacheStats.catalogMb !== undefined ? ` (catalogi ${cacheStats.catalogMb} MB${cacheStats.budgetMb ? `, budget ${cacheStats.budgetMb} MB` : ""})` : ""}` : ""}
                  </div>
                  {cacheStats && cacheStats.breakdown && (
                    <div className="hint">
                      Wat zit erin: catalogi {cacheStats.breakdown.catalogiMb} MB · bron-indexen size guide {cacheStats.breakdown.bronIndexenMb} MB · size-guide matches {cacheStats.breakdown.sizeGuideMb} MB · geheugen/keywords {cacheStats.breakdown.geheugenMb} MB · competitors {cacheStats.breakdown.competitorsMb} MB · to do {cacheStats.breakdown.todosMb} MB · overig {cacheStats.breakdown.overigMb} MB ({cacheStats.breakdown.keys} keys)
                      {cacheStats.breakdown.bronIndexenMb > (cacheStats.catalogMb || 0) ? " — de bron-indexen zijn groter dan de catalogi: wis ze met de knop hieronder, de scraper ruimt ze voortaan ook zelf op als het vol zit." : ""}
                    </div>
                  )}
                  {cacheStats && cacheStats.maxMb && cacheStats.usedMb >= cacheStats.maxMb * 0.95 && (
                    <div className="hint" style={{ color: "#b45309" }}>
                      ⚠ Redis zit (bijna) vol. Nieuwe catalogi verdringen nu de oudste; wil je er in één keer vanaf, klik dan op
                      "🧹 Catalogi-cache wissen" en daarna op "📦 Catalogi laden".
                    </div>
                  )}
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn-ghost btn-small" onClick={() => auditStores(storeList)} disabled={auditBusy || !!busy}>
                      {auditBusy ? "Checken…" : "🔎 Stores checken & sorteren"}
                    </button>
                    <button className="btn-ghost btn-small" onClick={() => loadCatalogs(false)} disabled={!!catBusy || !!busy}>
                      {catBusy ? `📦 Laden ${catBusy}…` : "📦 Catalogi laden"}
                    </button>
                    <button className="btn-ghost btn-small" onClick={() => loadCatalogs(true)} disabled={!!catBusy || !!busy}>
                      ↻ Alle catalogi verversen
                    </button>
                    <button className="btn-ghost btn-small" onClick={clearCatalogCache} disabled={!!catBusy || !!busy}>
                      🧹 Catalogi-cache wissen
                    </button>
                    <button className="btn-ghost btn-small" onClick={clearSourceIndexCache} disabled={!!catBusy || !!busy}>
                      🧹 Bron-indexen (size guide) wissen
                    </button>
                    <button className="btn-ghost btn-small" onClick={migrateOldRedis} disabled={!!busy || running} title="Na een nieuwe Redis-database: alles van de oude overzetten">
                      ⇄ Oude Redis overzetten
                    </button>
                    <button className="btn-ghost btn-small" onClick={clearAllStores}>
                      ✕ Alles wissen
                    </button>
                  </div>
                  <div className="hint">
                    Checken = per winkel: Shopify, werkt sort_by=best-selling écht, hoeveel % van de
                    catalogus gaat over jouw producttypes, valuta en geslacht. Score 0–100 bepaalt de
                    zoekvolgorde. Winkels die best-selling negeren kunnen geen "bewezen" producten leveren.
                  </div>
                  <div className="hint">
                    De lijst en de maandbezoekers staan permanent op de server. De catalogi ook, binnen het
                    Redis-geheugen (catalogi max 80%): zit dat vol, dan maakt de nieuwste catalogus plaats door de
                    oudste weg te halen — die wordt bij de volgende run gewoon opnieuw opgehaald.
                  </div>
                </>
              )}
            </div>

            <div className={secCls("verdeling", !orgInfo)} id="sec-verdeling">
              <SecHead id="verdeling" dflt={!orgInfo} sum={orgInfo ? `${memStoreName || "handmatig"} · ${orgTab} · V ${orgInfo.vrouwKw}/${orgInfo.vrouwN} · M ${orgInfo.manKw}/${orgInfo.manN}` : "nog niets geladen"}>
                Verdeling inladen <span className="opt">(organization-sheet of TPK-sheet)</span>
              </SecHead>
              <div className="field-label">Store <span className="opt">(uit het geheugen — Keywords → Geheugen → Store-geheugen)</span></div>
              <select
                value={memStore}
                onChange={(e) => pickMemStore(e.target.value)}
                disabled={orgBusy || running}
                style={{ width: "100%" }}
              >
                <option value="">— handmatig (link hieronder) —</option>
                {memStores.map((st) => (
                  <option key={st.domain} value={st.domain}>
                    {st.name || st.domain}
                    {st.market ? ` · ${st.market}` : ""}
                    {st.genders === "M" ? " · heren" : st.genders === "V" ? " · dames" : " · dames+heren"}
                    {st.tpkSheetId ? " · TPK ✓" : ""}
                  </option>
                ))}
              </select>
              {!memStores.length && (
                <div className="hint">
                  Nog geen stores in het geheugen. Zet per store de organization-sheet in Keywords → Geheugen → 2 · Store-geheugen; daarna kies je hier alleen nog de store en het weektabblad.
                </div>
              )}
              {memStore && (
                <>
                  <div className="field-label">Bron</div>
                  <div className="seg">
                    <button className={orgSource === "org" ? "on" : ""} onClick={() => chooseSource("org")} type="button" disabled={orgBusy || running || !(memEntry && (memEntry.orgSheetId || memEntry.aanvulSheetId))}>
                      Organization-sheet
                    </button>
                    <button className={orgSource === "tpk" ? "on" : ""} onClick={() => chooseSource("tpk")} type="button" disabled={orgBusy || running || !(memEntry && memEntry.tpkSheetId)}>
                      TPK-sheet
                    </button>
                  </div>
                  {memEntry && !memEntry.tpkSheetId && (
                    <div className="hint">Geen TPK-sheet voor deze store — zet hem in Keywords → Geheugen → Store-geheugen (veld "TPK-sheet"); Keywords → TPK maakt daar de weekbladen.</div>
                  )}
                </>
              )}
              <div className="field-label">{orgSource === "tpk" && memStore ? "TPK-sheet link" : "Organization-sheet link"}</div>
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={orgSheet}
                onChange={(e) => {
                  setOrgSheet(e.target.value);
                  if (memStore) {
                    setMemStore("");
                    save(LS.orgStore, "");
                    setOrgTabs([]);
                  }
                }}
              />
              <div className="field-label">
                {orgTabs.length ? "Tabblad" : "Exacte bladnaam"}
                {orgTabsBusy ? <span className="opt"> · tabbladen ophalen…</span> : null}
              </div>
              {orgTabs.length ? (
                <select value={orgTabs.includes(orgTab) ? orgTab : ""} onChange={(e) => chooseOrgTab(e.target.value)} disabled={orgBusy || running} style={{ width: "100%" }}>
                  {!orgTabs.includes(orgTab) && <option value="">— kies een tabblad —</option>}
                  {orgTabs.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Collection & Product organization"
                  value={orgTab}
                  onChange={(e) => setOrgTab(e.target.value)}
                />
              )}
              {memStore && orgTabs.length ? (
                orgSource === "tpk" ? (
                  <div className="hint">
                    Weekbladen uit Keywords → TPK (A–J is het scrape-blok; Overzicht en Log zijn geen scrape-bladen). Het nieuwste blad staat voorgeselecteerd; het gekozen blad wordt per store onthouden. De producten komen in hetzelfde import-blad als de aanvul-scrape van deze week.
                  </div>
                ) : (
                  <div className="hint">
                    Week 1 = het origineel (staat al op de store). Scrapen vanaf <b>Scraper W2</b> / <b>Week 2</b>; bij SSB staat in <b>Scraper W1</b> alleen wat nog ontbreekt. Het gekozen tabblad wordt per store onthouden.
                  </div>
                )
              ) : null}
              <div className="field-label">Welke keywords</div>
              <div className="seg">
                {[
                  ["alles", "Alles"],
                  ["normaal", "Zonder underdogs"],
                  ["underdog", "Alleen underdogs"],
                ].map(([val, label]) => (
                  <button key={val} className={orgFilter === val ? "on" : ""} onClick={() => setOrgFilter(val)} type="button">
                    {label}
                  </button>
                ))}
              </div>
              <div className="hint">
                Leest het blad uit de Keywords-tool en vult hieronder automatisch alle keywords, aantallen en
                groepen (man/vrouw) in — niets meer zelf overtypen. Underdog-rijen (Type "Underdog", onderaan
                het blad) nemen hun uitleg uit kolom J mee: die beschrijft wat het item ís, zodat de
                foto-controle kan matchen op betekenis — concurrenten zetten deze woorden zelden letterlijk
                in hun titels.
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="btn-ghost"
                  onClick={loadVerdeling}
                  disabled={orgBusy || running || !orgSheet.trim() || !orgTab.trim()}
                >
                  {orgBusy ? "Laden…" : "⇣ Laad verdeling"}
                </button>
                {orgSource !== "tpk" && (
                  <button
                    className="btn-ghost btn-small"
                    onClick={buildScraperTabs}
                    disabled={tabsBuildBusy || orgBusy || running || !orgSheet.trim()}
                    type="button"
                    title="Uit de planning (Keywordplan/Plan of de weektabs) per week een tab 'Scraper W<n>' schrijven, in de opmaak van de SSB Final Organization — zelfde sheet"
                  >
                    {tabsBuildBusy ? "Tabs maken…" : "⚙ Scraper W-tabs aanmaken (zoals SSB)"}
                  </button>
                )}
              </div>
              {orgInfo && (
                <div className="hint" style={{ color: "var(--ink-2)" }}>
                  Geladen: Vrouw {orgInfo.vrouwKw} keywords · {orgInfo.vrouwN} producten — Man {orgInfo.manKw}{" "}
                  keywords · {orgInfo.manN} producten
                </div>
              )}
            </div>

            <div className={secCls("keywords", false)} id="sec-keywords">
              <SecHead id="keywords" dflt={false} sum={`V ${kwCount("vrouw")} kw / ${kwProducts("vrouw")} · M ${kwCount("man")} kw / ${kwProducts("man")}`}>
                Keywords
              </SecHead>
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

            <div className={secCls("sheet", !workSheet.trim())} id="sec-sheet">
              <SecHead id="sheet" dflt={!workSheet.trim()} sum={workSheet.trim() ? `blad: ${newTabName.trim() || "automatisch"}${memStore ? ` · import-lijst ${memStoreName}` : ""}` : "geen sheet"}>
                Google Sheet
              </SecHead>
              <div className="field-label" style={{ marginTop: 0 }}>
                Import-lijst sheet
              </div>
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={workSheet}
                onChange={(e) => saveSheets(e.target.value, memSheet)}
              />
              {memStore && memStores.find((x) => x.domain === memStore) ? (
                <div className="hint" style={{ color: "var(--ink-2)" }}>
                  {memStores.find((x) => x.domain === memStore).importSheetId
                    ? `Import-lijst van ${memStores.find((x) => x.domain === memStore).name || memStore} uit het geheugen. De bladnaam hieronder wordt voorgesteld (laatst gebruikt voor deze store, anders het weeknummer van het gekozen bronblad) — aanvul- en TPK-scrape van één week landen zo in hetzelfde blad.`
                    : `Geen import-lijst in het geheugen van ${memStores.find((x) => x.domain === memStore).name || memStore} — zet hem in Keywords → Geheugen → Store-geheugen, dan staat hij hier voortaan klaar.`}
                </div>
              ) : null}
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
                placeholder={memStore && orgTab ? `bv. ${(memStores.find((x) => x.domain === memStore) || {}).name || memStore} - ${orgTab}` : "bv. Clara James aug-nov — leeg = automatisch Run-naam"}
                value={newTabName}
                onChange={(e) => {
                  setNewTabName(e.target.value);
                  save(LS.newTab, e.target.value);
                }}
              />
              <div className="hint">
                De scraper maakt in de import-lijst een nieuw blad met deze naam; bestaat het al, dan komen de producten
                eronder (vult aan). Staat per store automatisch ingevuld; leeg = automatisch "Run dag-maand uu:mm".
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
                Staat altijd op <b>{orgDef.memorySheet.name}</b> — ook na herladen, Reset session of een nieuwe login (leegmaken
                zet hem meteen terug). Voorkomt dat dezelfde producten terugkomen.
                {orgDef.memorySheet.format === "chaim"
                  ? " Dit is de geheugen-sheet van Chaims eigen scraper (tab Geheugen): beide tools slaan elkaars producten over; wij schrijven er in zijn formaat bij."
                  : ""}{" "}
                <a className="linklike" href={DEFAULT_MEM_SHEET} target="_blank" rel="noreferrer noopener">
                  Openen ↗
                </a>
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

            <div className={secCls("gender", false)} id="sec-gender">
              <SecHead id="gender" dflt={false} sum="achteraf · kolom F">
                Geslacht-check
              </SecHead>
              <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Loopt alle rijen na en zet in kolom F een label: Man of Vrouw — geen twijfelgevallen.
              </div>
              <button className="btn-ghost" onClick={runGenderCheck} disabled={!workSheet.trim() || !!busy}>
                {checkBusy === "gender" ? "Bezig…" : "Geslacht-check"}
              </button>
            </div>

            <div className={secCls("dupes", false)} id="sec-dupes">
              <SecHead id="dupes" dflt={false} sum="achteraf · kolom G">
                Dubbele-foto-check
              </SecHead>
              <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Vergelijkt elke productfoto en tagt rijen met dezelfde foto (andere store, unieke link) in kolom G.
              </div>
              <button className="btn-ghost" onClick={runDuplicateCheck} disabled={!workSheet.trim() || !!busy}>
                {checkBusy === "dup" ? "Bezig…" : "Dubbele-foto-check"}
              </button>
            </div>

            <div className={secCls("literal", false)} id="sec-literal">
              <SecHead id="literal" dflt={false} sum="achteraf · kolom H">
                Literal-check
              </SecHead>
              <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Controleert achteraf of elke "Literal"-match het keyword ook echt letterlijk bevat en tagt
                twijfelgevallen in kolom H.
              </div>
              <button className="btn-ghost" onClick={runLiteralCheck} disabled={!workSheet.trim() || !!busy}>
                {checkBusy === "literal" ? "Bezig…" : "Literal-check"}
              </button>
            </div>

            <div className={secCls("settings", false)} id="sec-settings">
              <SecHead id="settings" dflt={false} sum={`${proofMode === "alles" ? "alles" : proofMode === "kansrijk" ? "bewezen + kansrijk" : "alleen bewezen"} · ${spreadMode === "vol" ? "vol" : "gespreid"} · ${fastMode ? "snelmodus" : "met reviews"}`}>
                Instellingen
              </SecHead>
            <div style={{ marginTop: 14 }}>
              <div className="field-label">Vraag-bewijs per product</div>
              <select
                value={proofMode}
                onChange={(e) => {
                  setProofMode(e.target.value);
                  save(LS_PROOF, e.target.value);
                }}
                disabled={!!busy}
              >
                <option value="bewezen">Alleen bewezen verkopers (score ≥ 50)</option>
                <option value="kansrijk">Bewezen + kansrijk (score ≥ 25)</option>
                <option value="alles">Alles wat matcht (geen vraag-filter) — aanrader</option>
              </select>
              <div className="hint">
                Score = gevalideerde bestseller-positie + reviews + uitverkochte varianten + fotoset.
                Staat per product in kolom L–N van de importlijst. "Onbekend" = de winkel geeft geen
                enkel signaal; die blijven staan, zodat je ze zelf kunt beoordelen.
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="field-label">Spreiding over concurrenten</div>
              <select
                value={spreadMode}
                onChange={(e) => {
                  setSpreadMode(e.target.value);
                  save(LS_SPREAD, e.target.value);
                }}
                disabled={!!busy}
              >
                <option value="vol">Vol — een sterke concurrent mag het hele keyword leveren (aanrader)</option>
                <option value="gespreid">Gespreid — max ⅓ per winkel per keyword, max 25% van de run</option>
              </select>
              <div className="hint">
                Vol = zoals Chaim: verkoopt een concurrent 10 goede jassen, dan pak je die 10. Dubbele
                producten (zelfde titel bij een andere winkel) blijven altijd geweigerd.
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={fastMode}
                  onChange={(e) => {
                    setFastMode(e.target.checked);
                    save(LS_FAST, e.target.checked);
                  }}
                  disabled={!!busy}
                />
                Snelmodus — geen reviews ophalen per product (bestseller-volgorde telt wel mee)
              </label>
            </div>

            </div>

            <div className="sc-start" id="sec-run">
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
                    {prog && prog.currentKw && (
                      <button className="btn-ghost" onClick={skipKeyword} title={`Stop met "${prog.currentKw}" en ga door naar het volgende keyword`}>
                        ⏭ Sla "{prog.currentKw}" over
                      </button>
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
