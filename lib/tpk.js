// TPK — Top Performing Keywords (projectdoc 50/51, 15-10-2026).
//
// Elke week per store: welke keywords VERKOPEN (orders laatste 30 dagen) →
// ±10 extra producten bovenop de aanvul-planning. Eén Google Sheet per store
// (TPK-sheet in het store-geheugen), één blad per week (bv. "W2").
//
// Het weektab is direct scrape-ready: kolommen A–J staan exact in het
// verdeling-formaat dat de scraper leest (parseVerdelingSheet: kop B begint
// met "Keyword", D met "Groep", H met "Aantal"). Vanaf kolom L staat de
// analyse van ALLE keywords met verkoop — die leest de scraper niet (A1:J).
//
// Regels (puur data, geen smaak):
//  - keyword = titel vóór "|", geslachtswoord eruit, canon zoals het
//    store-geheugen (keywordFromTitle / canonOf in lib/geheugen.js)
//  - meetlat = orders in de periode (stuks als een CSV geen orders-kolom heeft)
//  - verdict: ≥ 10 winnaar · 5–9 sterk · 3–4 goed · 1–2 verkocht
//  - verdeling van N producten: alleen keywords met ≥ 3 orders, op volgorde
//    van orders; elk krijgt round(N × aandeel binnen de winnaars), minimaal 1,
//    maximaal 3, tot N vol is
//  - koptermen (jeans, shoe, top …) krijgen een verfijnde zoekterm op het
//    best verkopende product (jeans → wide leg jeans) — enige AI-stapje,
//    met een deterministische terugval
//  - heren-zoekterm = "mens " + keyword (zoals in de Scraper-tabs)
//  - collectie / tag / geslacht komen uit ORG VROUW / ORG MAN van het
//    store-geheugen (TPK-keywords staan per definitie al op de store)

import {
  readRange, updateValues, clearValues, appendRows, addTab, getTabIdByTitle,
  getSheetSizes, resizeTabGrid, spreadsheetBatchUpdate, parseSheetId, a1Tab,
} from "./sheets";
import { storeRequest } from "./shopify";
import { genderInfo } from "./verdeling";
import { getStoreMemory, keywordFromTitle, canonOf } from "./geheugen";
import { refineHeadTerms } from "./ai";

export const TPK_OVERZICHT = "Overzicht";
export const TPK_LOG = "Log";
export const OVERZICHT_HEADER = [
  "Week (blad)", "Periode rapport", "Orders 30 d", "Omzet 30 d", "Keywords met verkoop",
  "Winnaars (>= 10)", "Producten gepland", "Keywords gevoed", "Gescraped", "Geimporteerd",
];
export const LOG_HEADER = [
  "Week (blad)", "Run", "Keyword", "Zoekterm", "Groep", "Collectie", "Orders 30 d", "Stuks",
  "Omzet 30 d", "Aandeel", "Verdict", "Aantal gepland", "TPK t/m nu",
];
// A–J = scrape-blok (verdeling-formaat), K leeg, L–V = analyse
export const SCRAPE_HEADER = ["Rank", "Keyword (zoekterm)", "Collectie", "Groep", "Orders 30 d", "Omzet 30 d", "Aandeel", "Aantal producten", "Type", "Uitleg"];
export const ANA_HEADER = ["Keyword", "Groep", "Orders 30 d", "Stuks", "Omzet 30 d", "Aandeel", "Verdict", "Trend vs vorige run", "Op store (prod.)", "Topproduct", "TPK t/m nu"];

const DEFAULT_N = 10;
const MIN_ORDERS = 3; // pas vanaf 3 orders doet een keyword mee
const CAP_PER_KW = 3; // plafond per keyword per week

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const sheetUrl = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid != null ? `#gid=${gid}` : ""}`;
const round2 = (x) => Math.round(Number(x || 0) * 100) / 100;

const OCCASION_RE =
  /\b(christmas|xmas|race day|races|nye|new years?|wedding|bridesmaid|mother of the (bride|groom)|formal|cocktail|evening|party|going out|graduation|engagement|semi formal|ball|dinner|occasion|prom|gala)\b/i;

// Koptermen: één generiek producttype — te breed om op te scrapen, dus
// verfijnen op het best verkopende product.
const HEAD_TERMS = new Set([
  "jeans", "shoe", "shoes", "top", "tops", "shirt", "shirts", "boots", "boot", "dress", "dresses",
  "sweater", "sweaters", "pants", "trousers", "skirt", "skirts", "jacket", "jackets", "coat", "coats",
  "bag", "bags", "heels", "sandals", "sandal", "blouse", "blouses", "hoodie", "hoodies", "sneakers",
  "sneaker", "cardigan", "cardigans", "jumpsuit", "jumpsuits", "blazer", "blazers", "shorts", "set",
  "sets", "loafers", "loafer", "flats", "slides", "swimsuit", "bikini", "t shirt", "polo",
]);
const COLOR_WORDS = new Set([
  "black", "white", "red", "blue", "green", "brown", "grey", "gray", "navy", "beige", "pink", "purple",
  "yellow", "orange", "cream", "ivory", "tan", "khaki", "burgundy", "gold", "silver", "nude", "camel",
  "olive", "teal", "coral", "rust", "mustard", "lilac", "sage", "taupe", "charcoal", "wine", "emerald",
]);
const MEN_RE = /\b(men's|mens|men|man's|male|gents|guys)\b/i;
const WOMEN_RE = /\b(women's|womens|women|woman's|ladies|lady's|female)\b/i;

/* ======================================================================
   1. BRON: orders uit Shopify (Orders-app) of de Shopify-CSV
   ====================================================================== */

/**
 * Orders van de laatste `days` dagen via de Orders-app van de store
 * (zelfde sleutels als de Bills-tool: clientId + clientSecret, of token).
 * Geeft per product: titel, product_id, orders (uniek), stuks, netto-omzet.
 */
export async function fetchOrderProducts(ordersStore, days = 30) {
  if (!ordersStore || !ordersStore.domain) throw httpErr(400, "Geen store opgegeven");
  if (!ordersStore.token && !(ordersStore.clientId && ordersStore.clientSecret)) {
    throw httpErr(400, "Deze store heeft geen Orders-app-sleutels — vul Client ID en Client secret in op de Bills-pagina, of plak de CSV.");
  }
  const d = Math.max(7, Math.min(120, Number(days) || 30));
  const from = new Date(Date.now() - d * 86400000);
  const fromIso = from.toISOString();
  const fields = "id,name,created_at,cancelled_at,financial_status,test,currency,line_items";
  const orders = [];
  let sinceId = 0;
  for (let page = 0; page < 60; page++) {
    const r = await storeRequest(
      ordersStore,
      `/orders.json?status=any&created_at_min=${encodeURIComponent(fromIso)}&limit=250&since_id=${sinceId}&fields=${fields}`
    );
    if (!r.ok) {
      const msg = String(r.error || "");
      let hint = "";
      if (/merchant approval|scope/i.test(msg)) hint = " → app op deze store opnieuw installeren/goedkeuren met read_orders.";
      else if (/not approved to access|protected customer/i.test(msg)) hint = " → Protected customer data access aanzetten in het Dev Dashboard.";
      else if (r.status === 401) hint = " → Client ID/secret kloppen niet met een app die op deze store geïnstalleerd is.";
      throw httpErr(422, `Shopify weigert de orders (HTTP ${r.status}): ${msg.replace(/\s*—\s*token ongeldig.*$/i, "")}${hint}`);
    }
    const list = (r.data && r.data.orders) || [];
    orders.push(...list);
    if (list.length < 250) break;
    sinceId = list[list.length - 1].id;
  }
  const valid = orders.filter((o) => !o.cancelled_at && !o.test && o.financial_status !== "voided");
  const byProduct = new Map();
  let currency = "";
  for (const o of valid) {
    if (!currency && o.currency) currency = o.currency;
    for (const li of o.line_items || []) {
      const title = String(li.title || "").trim();
      if (!title) continue;
      const key = li.product_id ? `id:${li.product_id}` : `t:${title.toLowerCase()}`;
      let row = byProduct.get(key);
      if (!row) {
        row = { title, productId: li.product_id || null, orderIds: new Set(), units: 0, net: 0 };
        byProduct.set(key, row);
      }
      row.orderIds.add(o.id);
      const qty = Number(li.quantity) || 0;
      row.units += qty;
      row.net += (Number(li.price) || 0) * qty - (Number(li.total_discount) || 0);
    }
  }
  const products = [...byProduct.values()].map((r) => ({
    title: r.title,
    productId: r.productId,
    orders: r.orderIds.size,
    units: r.units,
    net: round2(r.net),
  }));
  return {
    products,
    measure: "orders",
    currency,
    period: { from: fromIso.slice(0, 10), to: new Date().toISOString().slice(0, 10), days: d },
    totals: { orders: valid.length, cancelled: orders.length - valid.length },
    source: "shopify",
  };
}

/* Eenvoudige RFC4180-parser (komma, puntkomma of tab; quotes met "" erin). */
function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/)[0] || "";
  const delim = (firstLine.match(/\t/g) || []).length >= 2 ? "\t" : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => String(x).trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => String(x).trim() !== "")) rows.push(row);
  return rows;
}

function numOf(v) {
  let s = String(v ?? "").trim();
  if (!s) return 0;
  s = s.replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  else s = s.replace(/,/g, ""); // 1,234.56
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Shopify → Analytics → Rapporten → "Verkopen per product" (Total sales by
 * product), geëxporteerd als CSV. Kolomnamen zijn Engels of Nederlands.
 */
export function parseSalesCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw httpErr(422, "De CSV is leeg of heeft geen kopregel");
  const head = rows[0].map((h) => String(h || "").trim().toLowerCase());
  const find = (...res) => {
    for (const re of res) {
      const i = head.findIndex((h) => re.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iTitle = find(/^product title$/, /producttitel/, /^product_title$/, /^product$/, /^titel$/, /^title$/, /product/);
  const iOrders = find(/^orders$/, /^bestellingen$/, /aantal bestellingen/, /orders/);
  const iUnits = find(/net items sold/, /netto verkochte/, /net quantity/, /items sold/, /verkochte artikelen/, /quantity/, /aantal/);
  const iNet = find(/^net sales$/, /nettoverkopen/, /netto-?verkoop/, /net sales/);
  const iTotal = find(/^total sales$/, /totale verkoop/, /total sales/);
  if (iTitle < 0) throw httpErr(422, `Geen kolom met de producttitel gevonden (kopregel: ${rows[0].slice(0, 8).join(" · ")}). Exporteer "Verkopen per product" als CSV.`);
  if (iOrders < 0 && iUnits < 0) throw httpErr(422, 'Geen kolom "Orders" of "Net items sold" in de CSV — is dit het rapport "Verkopen per product"?');
  const products = [];
  for (const r of rows.slice(1)) {
    const title = String(r[iTitle] || "").trim();
    if (!title || /^(total|totaal|summary)$/i.test(title)) continue;
    const orders = iOrders >= 0 ? Math.round(numOf(r[iOrders])) : 0;
    const units = iUnits >= 0 ? Math.round(numOf(r[iUnits])) : orders;
    const net = iNet >= 0 ? numOf(r[iNet]) : iTotal >= 0 ? numOf(r[iTotal]) : 0;
    if (!orders && !units) continue;
    products.push({ title, productId: null, orders, units, net: round2(net) });
  }
  if (!products.length) throw httpErr(422, "Geen productregels met verkoop in de CSV");
  return {
    products,
    measure: iOrders >= 0 ? "orders" : "stuks",
    currency: "",
    period: { from: "", to: new Date().toISOString().slice(0, 10), days: null },
    totals: { orders: iOrders >= 0 ? products.reduce((s, p) => s + p.orders, 0) : null },
    source: "csv",
  };
}

/* ======================================================================
   2. CONTEXT: store-geheugen (ORG-tabs) en de TPK-Log (geschiedenis)
   ====================================================================== */

/** canon → { g, coll, tag, onStore } uit ORG VROUW / ORG MAN van de aanvul-sheet. */
export async function loadOrgMap(entry) {
  const map = new Map();
  if (!entry || !entry.aanvulSheetId) return map;
  for (const [tab, g] of [["ORG VROUW", "V"], ["ORG MAN", "M"]]) {
    let rows = [];
    try {
      rows = await readRange(entry.aanvulSheetId, `${a1Tab(tab)}!A1:G`);
    } catch {
      continue; // tab bestaat (nog) niet
    }
    if (!rows.length) continue;
    const head = rows[0].map((h) => String(h || "").toLowerCase());
    const iKw = head.findIndex((h) => h.startsWith("keyword"));
    const iOn = head.findIndex((h) => h.startsWith("op store"));
    const iColl = head.findIndex((h) => h.startsWith("collectie"));
    const iTag = head.findIndex((h) => h === "tag" || h.startsWith("tag"));
    const iCanon = head.findIndex((h) => h === "canon");
    for (const r of rows.slice(1)) {
      const kw = String(r[iKw] || "").trim();
      if (!kw) continue;
      const canon = iCanon >= 0 && r[iCanon] ? String(r[iCanon]).trim() : canonOf(kw);
      const onStore = iOn >= 0 ? Number(r[iOn]) || 0 : 0;
      const prev = map.get(`${g}|${canon}`);
      if (prev && prev.onStore >= onStore) continue;
      map.set(`${g}|${canon}`, {
        g,
        coll: iColl >= 0 ? String(r[iColl] || "").replace(/^\(geen collectie\)$/i, "").trim() : "",
        tag: iTag >= 0 ? String(r[iTag] || "").trim() : "",
        onStore,
      });
    }
  }
  return map;
}

/** Geschiedenis uit de Log-tab: per keyword wat er al gevoed is + de vorige meting. */
export async function loadLogInfo(tpkSheetId) {
  const info = { byKey: new Map(), weeks: [], rows: [] };
  let rows = [];
  try {
    rows = await readRange(tpkSheetId, `${a1Tab(TPK_LOG)}!A1:M`);
  } catch {
    return info;
  }
  if (rows.length < 2) return info;
  const weeks = [];
  for (const r of rows.slice(1)) {
    const week = String(r[0] || "").trim();
    const keyword = String(r[2] || "").trim();
    if (!week || !keyword) continue;
    const g = String(r[4] || "").trim().toUpperCase() === "M" ? "M" : "V";
    const key = `${g}|${canonOf(keyword)}`;
    const planned = Number(r[11]) || 0;
    const orders = Number(r[6]) || 0;
    if (!weeks.includes(week)) weeks.push(week);
    const prev = info.byKey.get(key) || { cum: 0, lastOrders: null, lastWeek: "", weeksFed: 0 };
    prev.cum += planned;
    prev.lastOrders = orders;
    prev.lastWeek = week;
    if (planned > 0) prev.weeksFed += 1;
    info.byKey.set(key, prev);
    info.rows.push(r);
  }
  info.weeks = weeks;
  return info;
}

/* ======================================================================
   3. ANALYSE: producten → keywords → verdict → verdeling → zoektermen
   ====================================================================== */

function productGenderFromTitle(title, storeGenders, orgHit) {
  if (storeGenders === "M" || storeGenders === "V") return storeGenders;
  const left = String(title || "").split("|")[0];
  if (MEN_RE.test(left)) return "M";
  if (WOMEN_RE.test(left)) return "V";
  if (orgHit) return orgHit.g;
  return genderInfo(keywordFromTitle(title), "MV").g === "M" ? "M" : "V";
}

function verdictOf(m) {
  if (m >= 10) return "winnaar";
  if (m >= 5) return "sterk";
  if (m >= 3) return "goed";
  if (m >= 1) return "verkocht";
  return "geen verkoop";
}

/* Productnaam voor de uitleg: de titel is "keyword | naam" (SSB: "Flannel
   Shirt | Plaid Oversized Button-Down"); het deel rechts van de pipe is dan
   het onderscheidende stuk — tenzij daar alleen de storenaam staat. */
const STOP_WORDS = new Set(["the", "and", "with", "for", "new", "set", "pack", "piece", "pcs"]);
function cleanWords(s) {
  return String(s || "").toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' \-]+/g, " ").replace(/-/g, " ").split(/\s+/)
    .filter(Boolean).filter((w) => !MEN_RE.test(w) && !WOMEN_RE.test(w));
}
function isStoreName(part, storeName) {
  const words = cleanWords(part);
  if (!words.length) return true;
  const sn = new Set(cleanWords(storeName));
  return words.every((w) => sn.has(w) || w === "boutique" || w === "store" || w === "official");
}
export function productLabel(title, storeName) {
  const parts = String(title || "").split("|").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2 && !isStoreName(parts[1], storeName)) return parts.slice(1).join(" | ");
  return parts[0] || String(title || "").trim();
}

/* Terugval voor koptermen zonder AI: de stijlwoorden vlak vóór de kopterm in
   het linkerdeel ("High-Rise Wide Leg Jeans" → "wide leg jeans"), anders de
   laatste stijlwoorden van de productnaam rechts van de pipe
   ("Jeans | High-Rise Wide Leg" → "wide leg jeans"). */
function refineByRule(keyword, topTitle, storeName) {
  const [leftRaw, ...rest] = String(topTitle || "").split("|");
  const right = rest.join(" ");
  const kwWords = keyword.split(/\s+/);
  const last = kwWords[kwWords.length - 1];
  const pick = (ws) => ws.filter((w) => !COLOR_WORDS.has(w) && !/^\d/.test(w) && w.length > 2 && !STOP_WORDS.has(w) && w !== last);
  const L = cleanWords(leftRaw);
  let idx = L.lastIndexOf(last);
  if (idx < 0) idx = L.findIndex((w) => w.startsWith(last.replace(/s$/, "")));
  if (idx > 0) {
    const pre = pick(L.slice(Math.max(0, idx - 2), idx));
    if (pre.length) return `${pre.join(" ")} ${last}`.trim();
  }
  if (right.trim() && !isStoreName(right, storeName)) {
    const R = pick(cleanWords(right));
    if (R.length && R.length <= 6) return `${R.slice(-2).join(" ")} ${last}`.trim();
  }
  return keyword;
}

/**
 * De kern. products = [{title, orders, units, net}], entry = store-geheugen,
 * measure = "orders" | "stuks", n = aantal producten deze week.
 */
export async function analyseTpk({ products, entry, measure = "orders", n = DEFAULT_N, orgMap, logInfo, currency, period, useAi = true }) {
  const N = Math.max(1, Math.min(60, Math.round(Number(n) || DEFAULT_N)));
  const storeGenders = (entry && entry.genders) || "MV";
  const warnings = [];
  const agg = new Map(); // key g|canon → row

  for (const p of products) {
    const name = keywordFromTitle(p.title);
    if (!name) continue;
    const canon = canonOf(name);
    if (!canon) continue;
    const m = measure === "orders" ? Number(p.orders) || 0 : Number(p.units) || 0;
    if (!m) continue;
    // geslacht: store → titel → ORG-tab → woordenboek
    const gTitle = productGenderFromTitle(p.title, storeGenders, null);
    let hit = orgMap && (orgMap.get(`${gTitle}|${canon}`) || null);
    let g = gTitle;
    if (!hit && orgMap && storeGenders === "MV") {
      const other = gTitle === "M" ? "V" : "M";
      const alt = orgMap.get(`${other}|${canon}`);
      const left = String(p.title).split("|")[0];
      if (alt && !MEN_RE.test(left) && !WOMEN_RE.test(left)) {
        hit = alt;
        g = other;
      }
    }
    const key = `${g}|${canon}`;
    let row = agg.get(key);
    if (!row) {
      row = { key, g, canon, names: new Map(), m: 0, orders: 0, units: 0, net: 0, products: [], coll: hit ? hit.coll : "", tag: hit ? hit.tag : "", onStore: hit ? hit.onStore : null };
      agg.set(key, row);
    }
    row.names.set(name, (row.names.get(name) || 0) + m);
    row.m += m;
    row.orders += Number(p.orders) || 0;
    row.units += Number(p.units) || 0;
    row.net += Number(p.net) || 0;
    row.products.push({ title: productLabel(p.title, entry && entry.name), full: String(p.title || ""), m, net: Number(p.net) || 0 });
  }

  const rows = [...agg.values()];
  if (!rows.length) throw httpErr(422, "Geen keywords met verkoop gevonden in deze data");
  const totalM = rows.reduce((s, r) => s + r.m, 0);
  for (const r of rows) {
    r.name = [...r.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    r.products.sort((a, b) => b.m - a.m || b.net - a.net);
    r.top = r.products[0];
    r.share = totalM ? r.m / totalM : 0;
    r.verdict = verdictOf(r.m);
    const hist = logInfo && logInfo.byKey.get(r.key);
    r.cum = hist ? hist.cum : 0;
    r.lastM = hist && hist.lastOrders != null ? hist.lastOrders : null;
    r.weeksFed = hist ? hist.weeksFed : 0;
    r.trend = r.lastM == null ? "nieuw" : `${r.lastM} → ${r.m}${r.m > r.lastM ? " ▲" : r.m < r.lastM ? " ▼" : " ="}`;
  }
  rows.sort((a, b) => b.m - a.m || b.net - a.net || a.name.localeCompare(b.name));

  /* ---- verdeling van N ---- */
  const eligible = rows.filter((r) => r.m >= MIN_ORDERS);
  const sumE = eligible.reduce((s, r) => s + r.m, 0);
  for (const r of rows) r.n = 0;
  let left = N;
  let cap = CAP_PER_KW;
  for (const r of eligible) {
    if (left <= 0) break;
    let a = Math.round((N * r.m) / sumE);
    a = Math.max(1, Math.min(cap, a));
    a = Math.min(a, left);
    r.n = a;
    left -= a;
  }
  // te weinig winnaars om N te vullen → bijplussen van boven (binnen het plafond,
  // daarna plafond +1)
  let guard = 0;
  while (left > 0 && eligible.length && guard++ < 200) {
    let gave = false;
    for (const r of eligible) {
      if (left <= 0) break;
      if (r.n < cap) {
        r.n += 1;
        left -= 1;
        gave = true;
      }
    }
    if (!gave) cap += 1;
  }
  if (!eligible.length) warnings.push(`Geen enkel keyword heeft ≥ ${MIN_ORDERS} ${measure} in deze periode — er is niets om op aan te vullen.`);
  else if (left > 0) warnings.push(`Maar ${N - left} van de ${N} producten verdeeld.`);
  if (measure === "stuks") warnings.push("De CSV heeft geen orders-kolom — stuks gebruikt als meetlat.");

  /* ---- zoektermen (koptermen verfijnen) ---- */
  const chosen = rows.filter((r) => r.n > 0);
  const heads = chosen.filter((r) => HEAD_TERMS.has(r.name) || HEAD_TERMS.has(r.canon));
  const refined = new Map();
  if (heads.length && useAi) {
    try {
      const ai = await refineHeadTerms(
        heads.map((r, i) => ({ index: i, keyword: r.name, gender: r.g === "M" ? "men" : "women", titles: r.products.slice(0, 5).map((p) => `${p.full} (${p.m})`) }))
      );
      heads.forEach((r, i) => {
        const z = ai && ai[i] ? String(ai[i]).toLowerCase().trim() : "";
        if (z && z.length >= 4 && z.length <= 40) refined.set(r.key, { term: z, via: "ai" });
      });
    } catch (e) {
      warnings.push(`AI-verfijning van koptermen mislukt (${String(e.message || e).slice(0, 80)}) — regel gebruikt.`);
    }
  }
  for (const r of heads) {
    if (!refined.has(r.key)) refined.set(r.key, { term: refineByRule(r.name, r.top ? r.top.full : "", entry && entry.name), via: "regel" });
  }
  const withMens = (t, g) => (g === "M" && !MEN_RE.test(t) ? `mens ${t}` : t);

  const fmtMoney = (v) => (v ? `${currency ? currency + " " : ""}${Math.round(v).toLocaleString("en-US")}` : "");
  const pct = (x) => `${Math.round(x * 100)}%`;
  const scrape = chosen.map((r, i) => {
    const ref = refined.get(r.key);
    const base = ref && ref.term && ref.term !== r.name ? ref.term : r.name;
    const zoekterm = withMens(base, r.g);
    const type = OCCASION_RE.test(zoekterm) ? "Gelegenheid" : "Direct";
    const bits = [
      `${r.verdict[0].toUpperCase()}${r.verdict.slice(1)} · ${r.m} ${measure} (${pct(r.share)})`,
      r.top ? `topproduct: ${r.top.title} (${r.top.m})` : "",
      r.cum ? `TPK t/m nu: ${r.cum} (${r.weeksFed} ${r.weeksFed === 1 ? "week" : "weken"})` : "1e TPK-week",
      r.lastM != null ? `trend ${r.trend}` : "",
      ref && base !== r.name ? `kopterm "${r.name}" → ${base} (${ref.via})` : "",
    ].filter(Boolean);
    return {
      rank: i + 1,
      key: r.key,
      keyword: r.name,
      zoekterm,
      coll: r.coll || "",
      tag: r.tag || r.coll || "",
      g: r.g,
      m: r.m,
      net: round2(r.net),
      netLabel: fmtMoney(r.net),
      share: r.share,
      n: r.n,
      type,
      uitleg: bits.join(" · "),
    };
  });
  const ana = rows.map((r) => ({
    key: r.key,
    keyword: r.name,
    g: r.g,
    orders: r.orders,
    units: r.units,
    net: round2(r.net),
    netLabel: fmtMoney(r.net),
    share: r.share,
    verdict: r.verdict,
    trend: r.trend,
    onStore: r.onStore,
    top: r.top ? `${r.top.title} (${r.top.m})` : "",
    cum: r.cum + r.n,
    n: r.n,
    coll: r.coll || "",
  }));

  const totals = {
    measure,
    products: products.length,
    orders: rows.reduce((s, r) => s + r.orders, 0),
    units: rows.reduce((s, r) => s + r.units, 0),
    net: round2(rows.reduce((s, r) => s + r.net, 0)),
    netLabel: fmtMoney(rows.reduce((s, r) => s + r.net, 0)),
    keywords: rows.length,
    winners: rows.filter((r) => r.m >= 10).length,
    eligible: eligible.length,
    planned: N - left,
    fed: chosen.length,
    n: N,
  };
  const orgMissing = !orgMap || !orgMap.size;
  if (orgMissing) warnings.push("Geen ORG VROUW/ORG MAN in het store-geheugen — collectie per keyword blijft leeg (Keywords → Geheugen → Store-geheugen bijwerken).");
  const noColl = scrape.filter((s) => !s.coll).length;
  if (!orgMissing && noColl) warnings.push(`${noColl} gekozen keyword(s) zonder collectie in het store-geheugen — vul kolom C in het blad aan of werk het store-geheugen bij.`);

  return { scrape, ana, totals, warnings, period: period || null, currency: currency || "", storeGenders };
}

/* ======================================================================
   4. SCHRIJVEN: weektab + Log + Overzicht in de TPK-sheet
   ====================================================================== */

const NAVY = { red: 0x1e / 255, green: 0x3a / 255, blue: 0x5f / 255 };
const DARK = { red: 0x0d / 255, green: 0x1f / 255, blue: 0x33 / 255 };
const WHITE = { red: 1, green: 1, blue: 1 };
const BAND = { red: 0xf2 / 255, green: 0xf2 / 255, blue: 0xf2 / 255 };

async function ensureTab(sheetId, title, header, widths) {
  let tabId = await getTabIdByTitle(sheetId, title);
  if (tabId !== null) return { tabId, created: false };
  const made = await addTab(sheetId, title, { rows: 2, cols: header.length });
  if (!made.ok) {
    tabId = await getTabIdByTitle(sheetId, title);
    if (tabId === null) throw httpErr(422, made.error);
    return { tabId, created: false };
  }
  await updateValues(sheetId, `${a1Tab(title)}!A1`, [header]);
  const reqs = [
    { updateSheetProperties: { properties: { sheetId: made.tabId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    {
      repeatCell: {
        range: { sheetId: made.tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: header.length },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontFamily: "Arial", fontSize: 10 } } },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    },
  ];
  (widths || []).forEach((px, i) => {
    if (px) reqs.push({ updateDimensionProperties: { range: { sheetId: made.tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } });
  });
  await spreadsheetBatchUpdate(sheetId, reqs).catch(() => {});
  return { tabId: made.tabId, created: true };
}

const WEEK_COLS = 22; // A–J scrape, K leeg, L–V analyse
const WEEK_WIDTHS = [50, 190, 190, 55, 85, 90, 70, 90, 95, 420, 20, 180, 55, 85, 60, 90, 70, 85, 130, 110, 240, 80];

/**
 * Schrijft (of overschrijft) het weektab en werkt Log + Overzicht bij.
 * analysis = resultaat van analyseTpk; tab = bladnaam (bv. "W2").
 */
export async function writeTpkWeek({ tpkSheetId, tab, analysis, runLabel }) {
  const id = parseSheetId(tpkSheetId);
  const title = String(tab || "").trim();
  if (!id || !title) throw httpErr(400, "TPK-sheet of bladnaam ontbreekt");
  if (/^(overzicht|log)$/i.test(title)) throw httpErr(400, `"${title}" is een vaste tab — kies een weeknaam zoals W2`);
  const { scrape, ana, totals, period } = analysis;
  if (!scrape || !scrape.length) throw httpErr(422, "Niets om te schrijven: geen keywords met genoeg verkoop");

  await ensureTab(id, TPK_OVERZICHT, OVERZICHT_HEADER, [150, 140, 90, 100, 140, 110, 130, 120, 100, 110]);
  await ensureTab(id, TPK_LOG, LOG_HEADER, [130, 95, 180, 200, 55, 200, 85, 60, 90, 70, 90, 110, 90]);

  /* ---- weektab ---- */
  const nRows = Math.max(scrape.length, ana.length) + 1;
  let tabId = await getTabIdByTitle(id, title);
  let replaced = false;
  if (tabId === null) {
    const made = await addTab(id, title, { rows: nRows + 2, cols: WEEK_COLS });
    if (!made.ok) throw httpErr(422, made.error);
    tabId = made.tabId;
  } else {
    replaced = true;
    await clearValues(id, a1Tab(title));
    await resizeTabGrid(id, tabId, nRows + 2, WEEK_COLS).catch(() => {});
  }
  const pct = (x) => `${Math.round(x * 100)}%`;
  const values = [[...SCRAPE_HEADER, "", ...ANA_HEADER]];
  for (let i = 0; i < nRows - 1; i++) {
    const s = scrape[i];
    const a = ana[i];
    const left = s
      ? [s.rank, s.zoekterm, s.coll, s.g, s.m, s.net || "", pct(s.share), s.n, s.type, s.uitleg]
      : ["", "", "", "", "", "", "", "", "", ""];
    const right = a
      ? [a.keyword, a.g, a.orders, a.units, a.net || "", pct(a.share), a.verdict, a.trend, a.onStore == null ? "" : a.onStore, a.top, a.cum]
      : ["", "", "", "", "", "", "", "", "", "", ""];
    values.push([...left, "", ...right]);
  }
  await updateValues(id, `${a1Tab(title)}!A1`, values);
  const reqs = [
    { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontFamily: "Arial", fontSize: 10 }, wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 11, endColumnIndex: WEEK_COLS },
        cell: { userEnteredFormat: { backgroundColor: DARK, textFormat: { bold: true, foregroundColor: WHITE, fontFamily: "Arial", fontSize: 10 }, wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: nRows, startColumnIndex: 0, endColumnIndex: WEEK_COLS },
        cell: { userEnteredFormat: { textFormat: { fontFamily: "Arial", fontSize: 10 }, wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
        fields: "userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)",
      },
    },
    // aantal producten (H) vet, zodat je in één oogopslag de verdeling ziet
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: scrape.length + 1, startColumnIndex: 7, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontFamily: "Arial", fontSize: 10 } } },
        fields: "userEnteredFormat.textFormat",
      },
    },
  ];
  WEEK_WIDTHS.forEach((px, i) => {
    reqs.push({ updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } });
  });
  for (let r = 2; r < nRows && r < 2000; r += 2) {
    reqs.push({
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: WEEK_COLS },
        cell: { userEnteredFormat: { backgroundColor: BAND } },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  }
  await spreadsheetBatchUpdate(id, reqs).catch(() => {});

  /* ---- Log: oude rijen van dit blad eruit (overschrijven), nieuwe erbij ---- */
  const run = runLabel || new Date().toISOString().slice(0, 10);
  const byKeyN = new Map(scrape.map((s) => [s.key, s]));
  const logRows = ana.map((a) => {
    const s = byKeyN.get(a.key);
    return [title, run, a.keyword, s ? s.zoekterm : "", a.g, a.coll || (s ? s.coll : ""), a.orders, a.units, a.net || "", pct(a.share), a.verdict, a.n, a.cum];
  });
  if (replaced) {
    const old = await readRange(id, `${a1Tab(TPK_LOG)}!A1:M`).catch(() => []);
    const keep = old.slice(1).filter((r) => String(r[0] || "").trim() !== title);
    await clearValues(id, a1Tab(TPK_LOG));
    await updateValues(id, `${a1Tab(TPK_LOG)}!A1`, [LOG_HEADER, ...keep]);
  }
  await appendRows(id, `${a1Tab(TPK_LOG)}!A:M`, logRows, "RAW");

  /* ---- Overzicht: rij van dit blad bijwerken of toevoegen ---- */
  const periodLabel = period && period.from ? `${period.from} – ${period.to}` : period && period.to ? `t/m ${period.to}` : "";
  const ovRow = [title, periodLabel, totals.orders, totals.net || "", totals.keywords, totals.winners, totals.planned, totals.fed, "", ""];
  const ov = await readRange(id, `${a1Tab(TPK_OVERZICHT)}!A1:J`).catch(() => []);
  const idx = ov.findIndex((r, i) => i > 0 && String(r[0] || "").trim() === title);
  if (idx > 0) {
    await updateValues(id, `${a1Tab(TPK_OVERZICHT)}!A${idx + 1}`, [ovRow]);
  } else {
    await appendRows(id, `${a1Tab(TPK_OVERZICHT)}!A:J`, [ovRow], "RAW");
  }

  return { ok: true, url: sheetUrl(id, tabId), tab: title, tabId, replaced, keywords: scrape.length, products: totals.planned };
}

/* ======================================================================
   5. Samengestelde stappen voor de route
   ====================================================================== */

export async function tpkAnalyseForStore({ store, ordersStore, csvText, days, n, useAi }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const entry = await getStoreMemory(store.domain);
  if (!entry || !entry.tpkSheetId) {
    throw httpErr(422, "Deze store heeft nog geen TPK-sheet in het geheugen — Keywords → Geheugen → Store-geheugen → veld \"TPK-sheet\" invullen en opslaan.");
  }
  let data;
  if (csvText && String(csvText).trim()) data = parseSalesCsv(csvText);
  else data = await fetchOrderProducts(ordersStore, days);
  const [orgMap, logInfo] = await Promise.all([loadOrgMap(entry), loadLogInfo(entry.tpkSheetId)]);
  const analysis = await analyseTpk({
    products: data.products,
    entry,
    measure: data.measure,
    n,
    orgMap,
    logInfo,
    currency: data.currency || entry.currency || "",
    period: data.period,
    useAi: useAi !== false,
  });
  return {
    ok: true,
    analysis,
    source: data.source,
    sourceTotals: data.totals,
    weeks: logInfo.weeks,
    entry: { name: entry.name, domain: entry.domain, genders: entry.genders, tpkUrl: entry.tpkUrl || sheetUrl(entry.tpkSheetId), tpkSheetId: entry.tpkSheetId, importUrl: entry.importUrl || "" },
  };
}

export async function tpkWriteForStore({ store, tab, analysis }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const entry = await getStoreMemory(store.domain);
  if (!entry || !entry.tpkSheetId) throw httpErr(422, "Deze store heeft geen TPK-sheet in het geheugen");
  if (!analysis || !Array.isArray(analysis.scrape)) throw httpErr(400, "Analyse ontbreekt — draai eerst stap 1");
  return writeTpkWeek({ tpkSheetId: entry.tpkSheetId, tab, analysis });
}
