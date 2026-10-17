// PYTHAGO — spend per product (Google Ads) naast de echte verkopen (Shopify),
// 7 / 14 / 30 dagen, met vaste formules (17-10-2026, projectdoc 56).
//
// Waarom: Pythago (Shopify-app) laat per product zien wat het aan Google Ads
// kost en wat het oplevert; op 12-10 bouwde Claude dat met de hand na voor
// LGB (doc scans/2026-10-12-lgb-product-spend). Deze module doet hetzelfde in
// seconden, elke keer met dezelfde regels, zodat Justin direct ziet wat er
// gedraft moet worden.
//
// Bronnen:
//  - Google Ads → Producten → export (CSV). Eén bestand "afgelopen 30 dagen"
//    met segment Dag is genoeg (de tool rekent 7/14/30 zelf uit); drie losse
//    exports (30 / 14 / 7 dagen) zonder segment mogen ook. Item ID's van de
//    Google & YouTube-app ("shopify_AU_<product>_<variant>") koppelen aan het
//    Shopify-product; zonder Item ID wordt op titel gekoppeld.
//  - Shopify: orders (Orders-app-sleutels, zelfde als Bills/TPK) en producten
//    (koppeling uit de Importer, die mag ook draften).
//
// Vaste regels (instelbaar in de tool, standaard tussen haakjes):
//  - break-even ROAS = 1 / (1 − COGS% − fees%)               (35% + 4,4%)
//  - ROAS = Shopify-omzet (omgerekend naar de Ads-valuta) / spend
//  - advies per product, in het regelvenster (30 d):
//      Nieuw            jonger dan de minimale leeftijd (14 d) — nooit draften
//      Draften          spend ≥ drempel (£5) en 0 verkopen én 0 Google-conversies
//      Onder break-even spend ≥ drempel, wel verkoop, ROAS < break-even
//      Winstgevend      spend ≥ drempel en ROAS ≥ break-even
//      Verkoopt         verkoop, spend onder de drempel
//      Te weinig spend  spend onder de drempel, geen verkoop
//      Niet op store    staat in Google Ads maar niet (meer) in Shopify
//      Al draft         product staat in Shopify al op draft/archived

import { storeRequest, listProducts, updateProduct, cleanDomain } from "./shopify";
import { parseAdsExport, combineExports, dayNum, isoOf } from "./pythago-csv";
import {
  updateValues, clearValues, addTab, getTabIdByTitle, resizeTabGrid,
  spreadsheetBatchUpdate, parseSheetId, a1Tab,
} from "./sheets";

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const WINDOWS = [7, 14, 30];

export const DEFAULT_SETTINGS = {
  cogsPct: 35,
  feePct: 4.4,
  threshold: 5, // spend in Ads-valuta
  ruleWindow: 30, // 30 of 14
  minAge: 14, // dagen live voordat er gedraft mag worden
};

/* ======================================================================
   1. GOOGLE ADS-EXPORT LEZEN
   ====================================================================== */

/* ======================================================================
   2. SHOPIFY: orders per product per venster + producten
   ====================================================================== */

async function fetchOrdersSince(store, fromIso) {
  const fields = "id,created_at,cancelled_at,financial_status,test,currency,line_items";
  const orders = [];
  let sinceId = 0;
  for (let page = 0; page < 80; page++) {
    const r = await storeRequest(store, `/orders.json?status=any&created_at_min=${encodeURIComponent(fromIso)}&limit=250&since_id=${sinceId}&fields=${fields}`);
    if (!r.ok) {
      const msg = String(r.error || "");
      let hint = "";
      if (/merchant approval|scope|403/i.test(msg) || r.status === 403) hint = " → deze koppeling mist read_orders: vul de Orders-app (Client ID + secret) in op de Bills-pagina.";
      else if (/not approved to access|protected customer/i.test(msg)) hint = " → Protected customer data access aanzetten in het Dev Dashboard.";
      throw httpErr(422, `Shopify weigert de orders (HTTP ${r.status}): ${msg.replace(/\s*—\s*token ongeldig.*$/i, "")}${hint}`);
    }
    const list = (r.data && r.data.orders) || [];
    orders.push(...list);
    if (list.length < 250) break;
    sinceId = list[list.length - 1].id;
  }
  return orders;
}

async function fxToAds(shopCur, adsCur) {
  if (!shopCur || !adsCur || shopCur === adsCur) return { rate: 1, source: "zelfde valuta" };
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    const a = data && data.rates && data.rates[adsCur];
    const s = data && data.rates && data.rates[shopCur];
    if (a && s) return { rate: a / s, source: `open.er-api.com ${String(data.time_last_update_utc || "").slice(5, 16)}` };
  } catch {}
  return { rate: null, source: "niet beschikbaar" };
}

/* ======================================================================
   3. ANALYSE
   ====================================================================== */

/**
 * store       = koppeling uit de Importer (producten lezen + draften)
 * ordersStore = Orders-app (read_orders); leeg → de Importer-koppeling
 * ads         = al gelezen + opgetelde export(s) uit de browser (pythago-csv.js:
 *               combineExports → slimAds), of
 * exports     = [{ name, text }] (ruwe CSV-tekst, server leest zelf)
 */
export async function analysePythago({ store, ordersStore, ads: adsIn, exports, settings = {}, adsCurrency, fxOverride }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const S = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v !== "" && v != null && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) };
  if (![14, 30].includes(S.ruleWindow)) S.ruleWindow = 30;

  let ads;
  let parsed = [];
  if (adsIn && Array.isArray(adsIn.items)) {
    ads = { warnings: [], have: { 7: true, 14: true, 30: true }, ...adsIn };
    parsed = Array.isArray(adsIn.files) ? adsIn.files : [];
  } else {
    if (!Array.isArray(exports) || !exports.length) throw httpErr(400, "Sleep eerst de Google Ads-export (CSV) erin");
    parsed = exports.map((e) => parseAdsExport(e.text, e.name || "export"));
    ads = combineExports(parsed);
  }
  if (!ads.end) throw httpErr(422, "Geen datums gevonden in de export — exporteer met segment Dag of laat de periode-regel bovenaan staan.");
  const adsCur = String(adsCurrency || ads.currency || parsed.find((p) => p.currency)?.currency || "GBP").toUpperCase();
  const endN = dayNum(ads.end);

  // Shopify: producten (Importer-koppeling) + orders (Orders-app) parallel
  const fromIso = `${isoOf(endN - 29)}T00:00:00Z`;
  const [prodRes, orders] = await Promise.all([
    listProducts(store, 5000, { fields: "id,title,handle,status,created_at,published_at,variants" }),
    fetchOrdersSince(ordersStore && (ordersStore.token || (ordersStore.clientId && ordersStore.clientSecret)) ? { ...ordersStore, domain: store.domain } : store, new Date(Date.parse(fromIso) - 2 * 86400000).toISOString()),
  ]);
  if (!prodRes.ok) throw httpErr(422, `Producten ophalen mislukt: ${prodRes.error}`);
  const products = prodRes.products || [];
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const byVariant = new Map();
  for (const p of products) for (const v of p.variants || []) byVariant.set(String(v.id), String(p.id));
  const byTitle = new Map(products.map((p) => [String(p.title || "").toLowerCase().trim(), String(p.id)]));

  // orders → per product per venster (lokale orderdatum = eerste 10 tekens van created_at)
  const sales = new Map(); // productId → { 7:{orders:Set,units,rev}, ... }
  let shopCur = "";
  let ordersCounted = 0;
  for (const o of orders) {
    if (o.cancelled_at || o.test || ["voided", "refunded"].includes(o.financial_status)) continue;
    const day = String(o.created_at || "").slice(0, 10);
    if (!day) continue;
    const ago = endN - dayNum(day);
    if (ago < 0 || ago > 29) continue; // na de laatste Ads-dag of te oud
    if (!shopCur && o.currency) shopCur = o.currency;
    ordersCounted++;
    for (const li of o.line_items || []) {
      const pid = li.product_id ? String(li.product_id) : li.variant_id && byVariant.get(String(li.variant_id));
      if (!pid) continue;
      let s = sales.get(pid);
      if (!s) {
        s = Object.fromEntries(WINDOWS.map((w) => [w, { orders: new Set(), units: 0, rev: 0 }]));
        sales.set(pid, s);
      }
      const qty = Number(li.quantity) || 0;
      const disc = Array.isArray(li.discount_allocations) && li.discount_allocations.length
        ? li.discount_allocations.reduce((a, d) => a + (Number(d.amount) || 0), 0)
        : Number(li.total_discount) || 0;
      const rev = (Number(li.price) || 0) * qty - disc;
      for (const w of WINDOWS) {
        if (ago < w) {
          s[w].orders.add(o.id);
          s[w].units += qty;
          s[w].rev += rev;
        }
      }
    }
  }
  shopCur = shopCur || String(store.currency || "").toUpperCase() || adsCur;
  const fx = Number(fxOverride) > 0 ? { rate: Number(fxOverride), source: "handmatig" } : await fxToAds(shopCur, adsCur);
  const warnings = [...ads.warnings];
  if (!fx.rate) {
    warnings.push(`Wisselkoers ${shopCur} → ${adsCur} niet opgehaald — vul hem handmatig in, ROAS staat nu op 1:1.`);
    fx.rate = 1;
  }

  // Ads-items → product
  const rowsByProduct = new Map();
  const unmatched = [];
  const emptyW = () => ({ cost: 0, clicks: 0, impr: 0, conv: 0, convValue: 0 });
  for (const it of ads.items) {
    let pid = it.productId && byId.has(it.productId) ? it.productId : null;
    if (!pid && it.variantId && byVariant.has(it.variantId)) pid = byVariant.get(it.variantId);
    if (!pid && it.title) pid = byTitle.get(it.title.toLowerCase().trim()) || null;
    const key = pid ? `p:${pid}` : `x:${it.productId || it.itemId || it.title}`;
    let row = rowsByProduct.get(key);
    if (!row) {
      row = { key, productId: pid || it.productId || null, onStore: !!pid, title: "", variants: 0, w: { 7: emptyW(), 14: emptyW(), 30: emptyW() } };
      rowsByProduct.set(key, row);
    }
    if (!row.title) row.title = it.title;
    if (it.w[30].cost > 0 || it.w[14].cost > 0 || it.w[7].cost > 0) row.variants += 1;
    for (const w of WINDOWS) for (const k of Object.keys(row.w[w])) row.w[w][k] += it.w[w][k];
    if (!pid) unmatched.push(it.itemId || it.title);
  }
  // producten met verkoop maar zonder spend ook tonen
  for (const pid of sales.keys()) {
    if (!rowsByProduct.has(`p:${pid}`)) rowsByProduct.set(`p:${pid}`, { key: `p:${pid}`, productId: pid, onStore: byId.has(pid), title: "", variants: 0, w: { 7: emptyW(), 14: emptyW(), 30: emptyW() } });
  }

  const be = 1 / Math.max(0.05, 1 - S.cogsPct / 100 - S.feePct / 100);
  const RW = S.ruleWindow;
  const out = [];
  for (const row of rowsByProduct.values()) {
    const p = row.productId ? byId.get(String(row.productId)) : null;
    const s = (row.productId && sales.get(String(row.productId))) || null;
    const title = (p && p.title) || row.title || `(product ${row.productId || "?"})`;
    const startedAt = p && (p.published_at || p.created_at);
    const age = startedAt ? endN - dayNum(String(startedAt).slice(0, 10)) : null;
    const per = {};
    for (const w of WINDOWS) {
      const spend = round2(row.w[w].cost);
      const revShop = s ? s[w].rev : 0;
      const rev = round2(revShop * fx.rate);
      per[w] = {
        spend,
        clicks: Math.round(row.w[w].clicks),
        impr: Math.round(row.w[w].impr),
        conv: round2(row.w[w].conv),
        convValue: round2(row.w[w].convValue),
        orders: s ? s[w].orders.size : 0,
        units: s ? s[w].units : 0,
        revShop: round2(revShop),
        rev,
        roas: spend > 0 ? round2(rev / spend) : null,
        gRoas: spend > 0 ? round2(row.w[w].convValue / spend) : null,
      };
    }
    const r = per[RW];
    const profit30 = round2(per[30].rev * (1 - S.cogsPct / 100 - S.feePct / 100) - per[30].spend);
    let advies;
    if (!p) advies = "Niet op store";
    else if (p.status && p.status !== "active") advies = "Al draft";
    else if (age != null && age < S.minAge) advies = "Nieuw";
    else if (r.spend >= S.threshold && r.orders === 0 && r.conv < 0.5) advies = "Draften";
    else if (r.spend >= S.threshold && r.roas != null && r.roas < be) advies = "Onder break-even";
    else if (r.spend >= S.threshold) advies = "Winstgevend";
    else if (r.orders > 0) advies = "Verkoopt";
    else advies = "Te weinig spend";
    out.push({
      productId: row.productId ? String(row.productId) : "",
      title,
      handle: p ? p.handle : "",
      status: p ? p.status : "",
      age,
      variants: row.variants,
      per,
      profit30,
      advies,
    });
  }
  const ORDER = { Draften: 0, "Onder break-even": 1, Winstgevend: 2, Verkoopt: 3, Nieuw: 4, "Te weinig spend": 5, "Niet op store": 6, "Al draft": 7 };
  out.sort((a, b) => (ORDER[a.advies] - ORDER[b.advies]) || b.per[RW].spend - a.per[RW].spend || b.per[30].rev - a.per[30].rev);

  const tot = Object.fromEntries(WINDOWS.map((w) => {
    const spend = round2(out.reduce((a, x) => a + x.per[w].spend, 0));
    const rev = round2(out.reduce((a, x) => a + x.per[w].rev, 0));
    return [w, { spend, rev, roas: spend > 0 ? round2(rev / spend) : null, conv: round2(out.reduce((a, x) => a + x.per[w].conv, 0)) }];
  }));
  const counts = {};
  for (const x of out) counts[x.advies] = (counts[x.advies] || 0) + 1;
  const draftSpend = round2(out.filter((x) => x.advies === "Draften").reduce((a, x) => a + x.per[RW].spend, 0));
  if (unmatched.length) warnings.push(`${unmatched.length} Ads-item(s) niet gevonden in Shopify (verwijderd of oude ID's) — staan als "Niet op store".`);
  if (!ads.have[7] || !ads.have[14]) warnings.push("De export dekt niet alle vensters (7/14/30) — exporteer \"Afgelopen 30 dagen\" met segment Dag.");

  return {
    store: { name: store.name || "", domain: cleanDomain(store.domain) },
    period: { from: ads.start, to: ads.end },
    adsCurrency: adsCur,
    shopCurrency: shopCur,
    fx: { rate: round2(fx.rate * 10000) / 10000, source: fx.source },
    settings: { ...S, breakEvenRoas: round2(be) },
    totals: tot,
    counts,
    draftSpend,
    ordersCounted,
    rows: out,
    warnings,
    files: parsed.map((p) => ({ name: p.name, rows: Array.isArray(p.rows) ? p.rows.length : p.rows, hasDay: p.hasDay, period: p.period, nl: p.nl })),
  };
}

/* ======================================================================
   4. NAAR DE SHEET
   ====================================================================== */

const COLORS = {
  Draften: { red: 1, green: 0.84, blue: 0.84 },
  "Onder break-even": { red: 1, green: 0.92, blue: 0.8 },
  Winstgevend: { red: 0.83, green: 0.94, blue: 0.85 },
  Verkoopt: { red: 0.87, green: 0.93, blue: 1 },
  Nieuw: { red: 0.9, green: 0.9, blue: 1 },
};
const NAVY = { red: 0x1e / 255, green: 0x3a / 255, blue: 0x5f / 255 };
const WHITE = { red: 1, green: 1, blue: 1 };

export async function writePythagoTab({ sheet, tab, result }) {
  const id = parseSheetId(sheet);
  const title = String(tab || "").trim();
  if (!id || !title) throw httpErr(400, "Sheet of bladnaam ontbreekt");
  if (!result || !Array.isArray(result.rows)) throw httpErr(400, "Analyse ontbreekt — druk eerst op 1 · Analyseren");
  const cur = result.adsCurrency === "GBP" ? "£" : result.adsCurrency === "EUR" ? "€" : result.adsCurrency === "USD" ? "$" : result.adsCurrency;
  const header = [
    "Advies", "Product", "Product-ID", "Shopify-status", "Leeftijd (d)", "Varianten met spend",
    `Spend 7d (${cur})`, `Spend 14d (${cur})`, `Spend 30d (${cur})`, "Klikken 30d", "Google conv 30d",
    "Orders 7d", "Orders 14d", "Orders 30d", `Omzet 7d (${cur})`, `Omzet 14d (${cur})`, `Omzet 30d (${cur})`,
    "ROAS 7d", "ROAS 14d", "ROAS 30d", "Google ROAS 30d", `Winst 30d (${cur})`, "Admin-link",
  ];
  const domain = result.store && result.store.domain;
  const rows = result.rows.map((x) => [
    x.advies, x.title, x.productId, x.status || "", x.age ?? "", x.variants,
    x.per[7].spend, x.per[14].spend, x.per[30].spend, x.per[30].clicks, x.per[30].conv,
    x.per[7].orders, x.per[14].orders, x.per[30].orders, x.per[7].rev, x.per[14].rev, x.per[30].rev,
    x.per[7].roas ?? "", x.per[14].roas ?? "", x.per[30].roas ?? "", x.per[30].gRoas ?? "", x.profit30,
    x.productId && domain ? `https://${domain}/admin/products/${x.productId}` : "",
  ]);
  const S = result.settings || {};
  const T = result.totals || {};
  const foot = [
    [],
    ["Totaal", "", "", "", "", "", T[7]?.spend ?? "", T[14]?.spend ?? "", T[30]?.spend ?? "", "", T[30]?.conv ?? "", "", "", "", T[7]?.rev ?? "", T[14]?.rev ?? "", T[30]?.rev ?? "", T[7]?.roas ?? "", T[14]?.roas ?? "", T[30]?.roas ?? ""],
    [],
    [`Ads-data ${result.period?.from || "?"} t/m ${result.period?.to || "?"} · Shopify-orders zelfde dagen (${result.ordersCounted} orders) · koers 1 ${result.shopCurrency} = ${result.fx?.rate} ${result.adsCurrency} (${result.fx?.source})`],
    [`Regels: COGS ${S.cogsPct}% + fees ${S.feePct}% → break-even ROAS ${S.breakEvenRoas} · Draften = ≥ ${cur}${S.threshold} spend in ${S.ruleWindow} d zonder verkoop en zonder Google-conversie, product ≥ ${S.minAge} d live · ROAS = Shopify-omzet / spend`],
  ];
  const values = [header, ...rows, ...foot];
  const nRows = values.length + 2;
  const nCols = header.length;

  let tabId = await getTabIdByTitle(id, title);
  let replaced = false;
  if (tabId === null) {
    const made = await addTab(id, title, { rows: nRows, cols: nCols });
    if (!made.ok) throw httpErr(422, made.error);
    tabId = made.tabId;
  } else {
    replaced = true;
    await clearValues(id, a1Tab(title));
    await resizeTabGrid(id, tabId, nRows, nCols).catch(() => {});
  }
  await updateValues(id, `${a1Tab(title)}!A1`, values);

  const reqs = [
    { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } }, fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontFamily: "Arial", fontSize: 10 }, wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { textFormat: { fontFamily: "Arial", fontSize: 10 } } }, fields: "userEnteredFormat.textFormat" } },
    // bedragen 0,00 · ROAS 0,00
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rows.length + 2, startColumnIndex: 6, endColumnIndex: 9 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rows.length + 2, startColumnIndex: 14, endColumnIndex: 22 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: rows.length + 2, endRowIndex: rows.length + 3, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { textFormat: { bold: true, fontFamily: "Arial", fontSize: 10 } } }, fields: "userEnteredFormat.textFormat" } },
    { setBasicFilter: { filter: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: nCols } } } },
  ];
  const widths = [130, 320, 120, 95, 80, 80, 80, 85, 85, 75, 80, 70, 70, 70, 85, 90, 90, 65, 65, 65, 80, 90, 260];
  widths.forEach((px, i) => reqs.push({ updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } }));
  // advies-kleur per rij (blokken met dezelfde kleur samen)
  let i = 0;
  while (i < rows.length) {
    const a = rows[i][0];
    let j = i;
    while (j + 1 < rows.length && rows[j + 1][0] === a) j++;
    if (COLORS[a]) {
      reqs.push({ repeatCell: { range: { sheetId: tabId, startRowIndex: i + 1, endRowIndex: j + 2, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { backgroundColor: COLORS[a] } }, fields: "userEnteredFormat.backgroundColor" } });
    }
    i = j + 1;
  }
  await spreadsheetBatchUpdate(id, reqs).catch(async () => {
    // filter bestaat al bij overschrijven → zonder filter opnieuw
    await spreadsheetBatchUpdate(id, reqs.filter((r) => !r.setBasicFilter)).catch(() => {});
  });
  return { ok: true, tab: title, tabId, replaced, rows: rows.length, url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${tabId}` };
}

/* ======================================================================
   5. DRAFTEN (alleen de ID's die Justin aanvinkt)
   ====================================================================== */

export async function draftProducts({ store, productIds }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const ids = [...new Set((productIds || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean))];
  if (!ids.length) throw httpErr(400, "Geen producten aangevinkt");
  if (ids.length > 250) throw httpErr(400, "Maximaal 250 producten per keer");
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const r = await updateProduct(store, id, { status: "draft" });
      results.push({ productId: id, ok: !!r.ok, error: r.ok ? "" : String(r.error || "mislukt") });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { ok: true, drafted: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), results };
}
