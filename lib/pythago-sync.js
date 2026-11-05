// PYTHAGO-DASHBOARD — automatische sync (03-11-2026, projectdoc 103).
//
// Justin wil Pythago (app.pythago.io) volledig in Attoh Tools: geen CSV-exports
// meer slepen, maar een dashboard dat zichzelf vult. Bronnen:
//   1. Google Ads per product: het script scripts/google-ads-products.js schrijft
//      per dag en per Shopping-item naar tab Prod_<KEY> in de sheet "Attoh Ads
//      Live" (zelfde sheet als het omzet-dashboard). Tab Ads_<KEY> (hele account)
//      geeft de totale spend voor de uitsplitsing "product-spend vs totaal".
//   2. Shopify: producten (Importer-koppeling) en orders + refunds (Orders-app).
// De sync rekent per product 7 / 14 / 30 dagen uit (zelfde rijvorm als
// lib/pythago.js, zodat de Conversion Booster en "Schrijf naar sheet" gewoon
// blijven werken) en bewaart het resultaat in Redis. Het dashboard leest alleen
// Redis → direct open. Taken ("Background tasks") staan in Redis per store.
import { storeRequest, listProducts, updateProduct, cleanDomain } from "./shopify";
import { readRange, a1Tab } from "./sheets";
import { getRedis } from "./kw-memory";
import { nsKey, normOrg } from "./org";
import { dayNum, isoOf } from "./pythago-csv";
import { DEFAULT_SETTINGS, thumbUrl } from "./pythago";
import { applyBoostState } from "./cvr-boost";
import { londonDay } from "./dashboard";
import { saveUptrend } from "./pythago-uptrend";

const WINDOWS = [7, 14, 30];
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const STALE_MS = 6 * 3600 * 1000; // ouder dan 6 uur = opnieuw syncen bij openen

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ---------- Redis-sleutels (per organisatie) ---------- */
const K = {
  data: (org, d) => nsKey(org, `pythago:data:${cleanDomain(d)}`),
  vars: (org, d) => nsKey(org, `pythago:var:${cleanDomain(d)}`), // hash: productId → json
  tasks: (org, d) => nsKey(org, `pythago:tasks:${cleanDomain(d)}`),
  lock: (org, d) => nsKey(org, `pythago:lock:${cleanDomain(d)}`),
  auto: (org) => nsKey(org, "pythago:auto"), // hash: domein → json (koppeling + instellingen)
  presets: (org, d) => nsKey(org, `pythago:presets:${d ? cleanDomain(d) : "__all__"}`),
  notes: (org, d) => nsKey(org, `pythago:notes:${cleanDomain(d)}`),
};

async function getJson(key, fallback) {
  try {
    const r = await getRedis();
    const v = await r.get(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
async function setJson(key, val) {
  const r = await getRedis();
  await r.set(key, JSON.stringify(val));
}

/* ======================================================================
   TAKEN — "Background tasks" zoals in Pythago (lopend + geschiedenis)
   ====================================================================== */
const MAX_TASKS = 40;
export async function listTasks(org, domain) {
  const list = await getJson(K.tasks(org, domain), []);
  // een taak die > 10 min op "running" staat is gecrasht (functie-timeout)
  const cut = Date.now() - 10 * 60 * 1000;
  let changed = false;
  for (const t of list) {
    if (t.status === "running" && Date.parse(t.startedAt) < cut) {
      t.status = "failed";
      t.finishedAt = new Date().toISOString();
      t.msg = (t.msg ? t.msg + " · " : "") + "afgebroken (tijdslimiet)";
      changed = true;
    }
  }
  if (changed) await setJson(K.tasks(org, domain), list).catch(() => {});
  return list;
}
async function taskStart(org, domain, name, source) {
  const list = await getJson(K.tasks(org, domain), []);
  const t = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, source, status: "running", startedAt: new Date().toISOString(), msg: "gestart" };
  list.unshift(t);
  await setJson(K.tasks(org, domain), list.slice(0, MAX_TASKS));
  return t.id;
}
async function taskUpdate(org, domain, id, patch) {
  const list = await getJson(K.tasks(org, domain), []);
  const t = list.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  await setJson(K.tasks(org, domain), list);
}

/* ======================================================================
   AUTOMATISCH SYNCEN — koppeling per store bewaren voor de cron
   ====================================================================== */
export async function autoGet(org, domain) {
  const r = await getRedis();
  const v = await r.hGet(K.auto(org), cleanDomain(domain));
  return v ? JSON.parse(v) : null;
}
export async function autoSet(org, domain, cfg) {
  const r = await getRedis();
  if (!cfg) {
    await r.hDel(K.auto(org), cleanDomain(domain));
    return;
  }
  await r.hSet(K.auto(org), cleanDomain(domain), JSON.stringify({ ...cfg, org, savedAt: new Date().toISOString() }));
}
export async function autoList(org) {
  const r = await getRedis();
  const all = await r.hGetAll(K.auto(org));
  return Object.values(all || {}).map((v) => {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/* ======================================================================
   OPGESLAGEN DATA
   ====================================================================== */
export async function loadData(org, domain) {
  return getJson(K.data(org, domain), null);
}
export function isStale(data) {
  return !data || !data.syncedAt || Date.now() - Date.parse(data.syncedAt) > STALE_MS;
}
export async function loadVariants(org, domain, productId) {
  const r = await getRedis();
  const v = await r.hGet(K.vars(org, domain), String(productId));
  return v ? JSON.parse(v) : [];
}

/* ======================================================================
   OPGESLAGEN FILTERS + NOTITIES
   ====================================================================== */
export async function presetsList(org, domain) {
  const [own, all] = await Promise.all([getJson(K.presets(org, domain), []), getJson(K.presets(org, ""), [])]);
  return [...own.map((p) => ({ ...p, scope: "store" })), ...all.map((p) => ({ ...p, scope: "all" }))];
}
export async function presetSave(org, domain, preset) {
  const scope = preset.scope === "all" ? "" : domain;
  const list = await getJson(K.presets(org, scope), []);
  const p = { ...preset, id: preset.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, updatedAt: new Date().toISOString() };
  delete p.scope;
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) list[i] = p;
  else list.push(p);
  await setJson(K.presets(org, scope), list);
  // zelfde id uit de andere scope halen (verplaatst)
  const other = await getJson(K.presets(org, scope ? "" : domain), []);
  if (other.some((x) => x.id === p.id)) await setJson(K.presets(org, scope ? "" : domain), other.filter((x) => x.id !== p.id));
  return p;
}
export async function presetDelete(org, domain, id) {
  for (const scope of [domain, ""]) {
    const list = await getJson(K.presets(org, scope), []);
    if (list.some((x) => x.id === id)) await setJson(K.presets(org, scope), list.filter((x) => x.id !== id));
  }
}
export async function notesGet(org, domain) {
  return getJson(K.notes(org, domain), {});
}
export async function noteSet(org, domain, productId, text) {
  const all = await getJson(K.notes(org, domain), {});
  const id = String(productId);
  if (String(text || "").trim()) all[id] = { text: String(text).trim().slice(0, 2000), updatedAt: new Date().toISOString() };
  else delete all[id];
  await setJson(K.notes(org, domain), all);
  return all;
}

/* ======================================================================
   STATUS ZETTEN (draft / active / archived) — nooit vanzelf
   ====================================================================== */
export async function setStatus({ store, productIds, status }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const st = String(status || "").toLowerCase();
  if (!["active", "draft", "archived"].includes(st)) throw httpErr(400, "Onbekende status");
  const ids = [...new Set((productIds || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean))];
  if (!ids.length) throw httpErr(400, "Geen producten aangevinkt");
  if (ids.length > 250) throw httpErr(400, "Maximaal 250 producten per keer");
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const r = await updateProduct(store, id, { status: st });
      results.push({ productId: id, ok: !!r.ok, error: r.ok ? "" : String(r.error || "mislukt") });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { ok: true, status: st, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), results };
}

/** Na een status-wijziging de opgeslagen rijen direct bijwerken (geen hele sync nodig). */
export async function patchStatus(org, domain, productIds, status) {
  const data = await loadData(org, domain);
  if (!data) return;
  const set = new Set(productIds.map(String));
  for (const row of data.rows || []) {
    if (!set.has(String(row.productId))) continue;
    row.status = status;
    if (status !== "active") row.advies = "Al draft";
    else if (row.advies === "Al draft") row.advies = "Verkoopt";
  }
  await setJson(K.data(org, domain), data);
}

/* ======================================================================
   BRONNEN
   ====================================================================== */

/** Tab Prod_<KEY> → per item per dag. */
async function readProductAds(sheetId, key) {
  let values;
  for (let poging = 0; ; poging++) {
    try {
      values = await readRange(sheetId, `${a1Tab("Prod_" + key)}!A1:I250000`);
      break;
    } catch (e) {
      const m = String(e.message || e);
      // het Ads-script wisselt de tab om (Prod_X_tmp → Prod_X); heel even bestaat hij niet
      if (poging < 2 && /Unable to parse range|not found/i.test(m)) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (/Unable to parse range/i.test(m)) {
        throw httpErr(422, `Tab Prod_${key} bestaat nog niet in de Ads-sheet — zet het script google-ads-products.js in het Google Ads-account van deze store (STORE = ${key}).`);
      }
      throw httpErr(502, `Ads-sheet: ${m.slice(0, 200)}`);
    }
  }
  const head = (values[0] || []).map((h) => String(h).trim().toLowerCase());
  const col = (n) => head.indexOf(n);
  const c = { date: col("date"), item: col("item_id"), title: col("title"), impr: col("impressions"), clicks: col("clicks"), cost: col("cost"), conv: col("conversions"), cv: col("conv_value"), upd: col("updated_at") };
  if (c.date < 0 || c.item < 0 || c.cost < 0) throw httpErr(422, `Tab Prod_${key} heeft niet de verwachte kolommen (date, item_id, cost, …)`);
  const num = (v) => {
    const n = Number(String(v == null ? "" : v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const rows = [];
  let updated = "";
  for (const r of values.slice(1)) {
    const day = String(r[c.date] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    rows.push({ day, item: String(r[c.item] || "").trim(), title: c.title >= 0 ? String(r[c.title] || "") : "", impr: num(r[c.impr]), clicks: num(r[c.clicks]), cost: num(r[c.cost]), conv: num(r[c.conv]), cv: num(r[c.cv]) });
    if (c.upd >= 0 && r[c.upd] && String(r[c.upd]) > updated) updated = String(r[c.upd]);
  }
  return { rows, updated };
}

/** Tab Ads_<KEY> (hele account) → { day: cost } */
async function readAccountAds(sheetId, key) {
  try {
    const values = await readRange(sheetId, `${a1Tab("Ads_" + key)}!A1:C400`);
    const head = (values[0] || []).map((h) => String(h).trim().toLowerCase());
    const di = head.indexOf("date");
    const ci = head.indexOf("cost");
    if (di < 0 || ci < 0) return {};
    const out = {};
    for (const r of values.slice(1)) {
      const day = String(r[di] || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) out[day] = Number(String(r[ci]).replace(",", ".")) || 0;
    }
    return out;
  } catch {
    return {};
  }
}

async function fetchOrders(store, fromIso) {
  const fields = "id,created_at,cancelled_at,financial_status,test,currency,line_items,refunds";
  const orders = [];
  let sinceId = 0;
  for (let page = 0; page < 120; page++) {
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

/* item_id "shopify_US_123_456" → { productId, variantId } */
function parseItem(item) {
  const m = String(item || "").match(/^shopify_[a-z]{2,3}_(\d+)_(\d+)$/i);
  if (m) return { productId: m[1], variantId: m[2] };
  const n = String(item || "").match(/^(\d{8,})$/);
  if (n) return { productId: null, variantId: n[1] };
  return { productId: null, variantId: null };
}

/* ======================================================================
   DE SYNC
   ====================================================================== */
const emptyW = () => ({ cost: 0, clicks: 0, impr: 0, conv: 0, cv: 0 });
const emptyS = () => ({ orders: new Set(), units: 0, rev: 0, refunds: 0, refundUnits: 0 });

/**
 * org         = "attoh" | "sacollective" (Redis-prefix)
 * store       = Importer-koppeling (producten lezen, status zetten)
 * ordersStore = Orders-app (read_orders) — leeg: de Importer-koppeling
 * adsSheetId  = sheet "Attoh Ads Live" · key = SSB/LGB/EMC/SW (tab Prod_<key>)
 * settings    = { cogsPct, feePct, threshold, ruleWindow, minAge, adsCurrency }
 */
export async function syncStore({ org: orgIn, store, ordersStore, adsSheetId, key, settings = {}, source = "handmatig" }) {
  const org = normOrg(orgIn);
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  if (!adsSheetId) throw httpErr(400, "Geen Ads-sheet ingesteld");
  if (!key) throw httpErr(400, "Geen store-sleutel (SSB/LGB/EMC/SW) voor de Ads-tabs");
  const domain = cleanDomain(store.domain);
  const redis = await getRedis();
  const got = await redis.set(K.lock(org, domain), "1", { NX: true, EX: 170 });
  if (!got) throw httpErr(409, "Er loopt al een sync voor deze store — even wachten.");

  const S = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v !== "" && v != null && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) };
  if (![7, 14, 30].includes(S.ruleWindow)) S.ruleWindow = 30;
  const taskId = await taskStart(org, domain, `Sync ${store.name || domain}`, source);
  const t0 = Date.now();
  const step = (msg) => taskUpdate(org, domain, taskId, { msg }).catch(() => {});

  try {
    await step("Google Ads-cijfers per product lezen…");
    const [ads, account] = await Promise.all([readProductAds(adsSheetId, key), readAccountAds(adsSheetId, key)]);
    if (!ads.rows.length) throw httpErr(422, `Tab Prod_${key} is leeg — het Google Ads-script heeft nog niets geschreven.`);

    // venster: t/m gisteren (vandaag is nog niet compleet), zoals Pythago
    const yesterday = isoOf(dayNum(londonDay()) - 1);
    const maxDay = ads.rows.reduce((m, r) => (r.day > m ? r.day : m), "");
    const end = maxDay && maxDay < yesterday ? maxDay : yesterday;
    const endN = dayNum(end);
    const start = isoOf(endN - 29);
    const ranges = Object.fromEntries(WINDOWS.map((w) => [w, { start: isoOf(endN - (w - 1)), end }]));

    // Ads per item (variant) en per product, per venster
    const items = new Map(); // item → { productId, variantId, title, w:{7,14,30}, days:Set }
    const todayCost = { 7: 0, 14: 0, 30: 0 };
    for (const r of ads.rows) {
      const ago = endN - dayNum(r.day);
      if (ago < 0 || ago > 29) continue;
      let it = items.get(r.item);
      if (!it) {
        it = { ...parseItem(r.item), item: r.item, title: r.title, w: { 7: emptyW(), 14: emptyW(), 30: emptyW() }, days: new Set() };
        items.set(r.item, it);
      }
      if (!it.title && r.title) it.title = r.title;
      if (r.cost > 0) it.days.add(r.day);
      for (const w of WINDOWS) {
        if (ago < w) {
          it.w[w].cost += r.cost;
          it.w[w].clicks += r.clicks;
          it.w[w].impr += r.impr;
          it.w[w].conv += r.conv;
          it.w[w].cv += r.cv;
          todayCost[w] += r.cost;
        }
      }
    }
    const accountSpend = Object.fromEntries(WINDOWS.map((w) => [w, round2(Object.entries(account).filter(([d]) => d >= ranges[w].start && d <= end).reduce((a, [, c]) => a + c, 0))]));

    await step(`Shopify: producten + orders ophalen (${items.size} Ads-items)…`);
    const fromIso = `${isoOf(endN - 31)}T00:00:00Z`;
    const oStore = ordersStore && (ordersStore.token || (ordersStore.clientId && ordersStore.clientSecret)) ? { ...ordersStore, domain: store.domain } : store;
    const [prodRes, orders] = await Promise.all([
      listProducts(store, 6000, { fields: "id,title,handle,status,created_at,published_at,variants,image,product_type,vendor,tags" }),
      fetchOrders(oStore, fromIso),
    ]);
    if (!prodRes.ok) throw httpErr(422, `Producten ophalen mislukt: ${prodRes.error}`);
    const products = prodRes.products || [];
    const byId = new Map(products.map((p) => [String(p.id), p]));
    const byVariant = new Map();
    for (const p of products) for (const v of p.variants || []) byVariant.set(String(v.id), String(p.id));
    const byTitle = new Map(products.map((p) => [String(p.title || "").toLowerCase().trim(), String(p.id)]));

    // orders → per product en per variant, per venster (+ refunds op refund-datum)
    await step(`${orders.length} orders verwerken…`);
    const sales = new Map(); // productId → {7,14,30}
    const vsales = new Map(); // variantId → {7,14,30}
    let shopCur = "";
    let ordersCounted = 0;
    const bump = (map, id, fn) => {
      let s = map.get(id);
      if (!s) {
        s = { 7: emptyS(), 14: emptyS(), 30: emptyS() };
        map.set(id, s);
      }
      for (const w of WINDOWS) fn(s[w], w);
    };
    for (const o of orders) {
      if (o.cancelled_at || o.test) continue;
      const day = String(o.created_at || "").slice(0, 10);
      const ago = endN - dayNum(day);
      if (!shopCur && o.currency) shopCur = o.currency;
      const lineById = new Map((o.line_items || []).map((li) => [String(li.id), li]));
      if (ago >= 0 && ago <= 29) {
        ordersCounted++;
        for (const li of o.line_items || []) {
          const pid = li.product_id ? String(li.product_id) : li.variant_id && byVariant.get(String(li.variant_id));
          if (!pid) continue;
          const qty = Number(li.quantity) || 0;
          const disc = Array.isArray(li.discount_allocations) && li.discount_allocations.length
            ? li.discount_allocations.reduce((a, d) => a + (Number(d.amount) || 0), 0)
            : Number(li.total_discount) || 0;
          const rev = (Number(li.price) || 0) * qty - disc;
          const add = (s, w) => {
            if (ago < w) {
              s.orders.add(o.id);
              s.units += qty;
              s.rev += rev;
            }
          };
          bump(sales, pid, add);
          if (li.variant_id) bump(vsales, String(li.variant_id), add);
        }
      }
      for (const rf of o.refunds || []) {
        const rday = String(rf.created_at || rf.processed_at || "").slice(0, 10);
        const rago = endN - dayNum(rday);
        if (rago < 0 || rago > 29) continue;
        for (const rli of rf.refund_line_items || []) {
          const li = rli.line_item || lineById.get(String(rli.line_item_id));
          if (!li) continue;
          const pid = li.product_id ? String(li.product_id) : li.variant_id && byVariant.get(String(li.variant_id));
          if (!pid) continue;
          const amt = Number(rli.subtotal) || (Number(li.price) || 0) * (Number(rli.quantity) || 0);
          const units = Number(rli.quantity) || 0;
          const add = (s, w) => {
            if (rago < w) {
              s.refunds += amt;
              s.refundUnits += units;
            }
          };
          bump(sales, pid, add);
          if (li.variant_id) bump(vsales, String(li.variant_id), add);
        }
      }
    }
    shopCur = (shopCur || String(store.currency || "")).toUpperCase();
    const adsCur = String(settings.adsCurrency || (S.adsCurrency ? S.adsCurrency : "") || "GBP").toUpperCase();
    const fx = Number(settings.fxOverride) > 0 ? { rate: Number(settings.fxOverride), source: "handmatig" } : await fxToAds(shopCur || adsCur, adsCur);
    const warnings = [];
    if (!fx.rate) {
      warnings.push(`Wisselkoers ${shopCur} → ${adsCur} niet opgehaald — ROAS staat op 1:1.`);
      fx.rate = 1;
    }
    const toAds = (x) => round2(x * fx.rate);

    await step("Per product uitrekenen…");
    // Ads-items → product
    const byProduct = new Map(); // key → { productId, onStore, title, w, days, variantsWithSpend, variantItems }
    const unmatched = [];
    for (const it of items.values()) {
      let pid = it.productId && byId.has(it.productId) ? it.productId : null;
      if (!pid && it.variantId && byVariant.has(it.variantId)) pid = byVariant.get(it.variantId);
      if (!pid && it.title) {
        const t = it.title.toLowerCase().trim();
        pid = byTitle.get(t) || byTitle.get(t.replace(/\s*[-–|]\s*[^-–|]*$/, "").trim()) || null;
      }
      const k = pid ? `p:${pid}` : `x:${it.productId || it.item}`;
      let row = byProduct.get(k);
      if (!row) {
        row = { key: k, productId: pid || it.productId || null, onStore: !!pid, title: "", w: { 7: emptyW(), 14: emptyW(), 30: emptyW() }, days: new Set(), variantsWithSpend: 0, variantItems: new Map() };
        byProduct.set(k, row);
      }
      if (!row.title) row.title = it.title;
      if (it.w[30].cost > 0) row.variantsWithSpend += 1;
      for (const d of it.days) row.days.add(d);
      for (const w of WINDOWS) for (const f of Object.keys(row.w[w])) row.w[w][f] += it.w[w][f];
      if (it.variantId) {
        const prev = row.variantItems.get(it.variantId);
        if (prev) for (const w of WINDOWS) for (const f of Object.keys(prev.w[w])) prev.w[w][f] += it.w[w][f];
        else row.variantItems.set(it.variantId, { w: it.w, item: it.item });
      }
      if (!pid) unmatched.push(it.item);
    }
    // alle producten van de store tonen (ook zonder spend en zonder verkoop) — zoals Pythago
    for (const p of products) {
      if (!byProduct.has(`p:${p.id}`)) byProduct.set(`p:${p.id}`, { key: `p:${p.id}`, productId: String(p.id), onStore: true, title: "", w: { 7: emptyW(), 14: emptyW(), 30: emptyW() }, days: new Set(), variantsWithSpend: 0, variantItems: new Map() });
    }

    const cogs = S.cogsPct / 100;
    const fee = S.feePct / 100;
    const be = 1 / Math.max(0.05, 1 - cogs - fee);
    const RW = S.ruleWindow;
    const calc = (adsW, sW, price) => {
      const spend = round2(adsW.cost);
      const revShop = sW ? sW.rev : 0;
      const refundsShop = sW ? sW.refunds : 0;
      const rev = toAds(revShop);
      const refunds = toAds(refundsShop);
      const net = round2(rev - refunds);
      const orders = sW ? sW.orders.size : 0;
      const units = sW ? sW.units : 0;
      const clicks = Math.round(adsW.clicks);
      const impr = Math.round(adsW.impr);
      const cog = round2(net * cogs);
      const fees = round2(net * fee);
      const contrib = round2(net - cog - fees);
      return {
        spend, clicks, impr,
        conv: round2(adsW.conv), convValue: round2(adsW.cv),
        orders, units, revShop: round2(revShop), rev,
        refunds, refundsShop: round2(refundsShop), refundUnits: sW ? sW.refundUnits : 0,
        net, netShop: round2(revShop - refundsShop),
        roas: spend > 0 ? round2(net / spend) : null,
        gRoas: spend > 0 ? round2(adsW.cv / spend) : null,
        ctr: impr > 0 ? round2((clicks / impr) * 100) : null,
        cpc: clicks > 0 ? round2(spend / clicks) : null,
        cpa: units > 0 && spend > 0 ? round2(spend / units) : null,
        cog, fees, profit: round2(contrib - spend),
        poas: spend > 0 ? round2(contrib / spend) : null,
        margin: net > 0 ? round2((contrib / net) * 100) : null,
        aov: units > 0 ? round2(net / units) : null,
      };
    };

    const out = [];
    const varHash = {};
    for (const row of byProduct.values()) {
      const p = row.productId ? byId.get(String(row.productId)) : null;
      const s = (row.productId && sales.get(String(row.productId))) || null;
      const title = (p && p.title) || row.title || `(product ${row.productId || "?"})`;
      const startedAt = p && (p.published_at || p.created_at);
      const age = startedAt ? endN - dayNum(String(startedAt).slice(0, 10)) : null;
      const vs = (p && p.variants) || [];
      const prices = vs.map((v) => Number(v.price)).filter((x) => Number.isFinite(x) && x > 0);
      const compares = vs.map((v) => Number(v.compare_at_price)).filter((x) => Number.isFinite(x) && x > 0);
      const soldOut = vs.filter((v) => v.inventory_management && Number(v.inventory_quantity) <= 0 && v.inventory_policy !== "continue").length;
      const per = {};
      for (const w of WINDOWS) per[w] = calc(row.w[w], s ? s[w] : null);
      const r = per[RW];
      let advies;
      if (!p) advies = "Niet op store";
      else if (p.status && p.status !== "active") advies = "Al draft";
      else if (age != null && age < S.minAge) advies = "Nieuw";
      else if (r.spend >= S.threshold && r.orders === 0 && r.conv < 0.5) advies = "Draften";
      else if (r.spend >= S.threshold && r.roas != null && r.roas < be) advies = "Onder break-even";
      else if (r.spend >= S.threshold) advies = "Winstgevend";
      else if (r.orders > 0) advies = "Verkoopt";
      else advies = "Te weinig spend";
      const pid = row.productId ? String(row.productId) : "";
      out.push({
        productId: pid,
        key: row.key,
        title,
        handle: p ? p.handle : "",
        image: p && p.image && p.image.src ? thumbUrl(p.image.src, 120) : "",
        status: p ? p.status : "",
        age,
        publishedAt: p && p.published_at ? String(p.published_at).slice(0, 10) : "",
        createdAt: p && p.created_at ? String(p.created_at).slice(0, 10) : "",
        type: p ? String(p.product_type || "").trim() : "",
        vendor: p ? String(p.vendor || "").trim() : "",
        tags: p ? String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean) : [],
        price: prices.length ? Math.min(...prices) : null,
        priceMax: prices.length ? Math.max(...prices) : null,
        compareAt: compares.length ? Math.max(...compares) : null,
        vcount: vs.length,
        soldOut,
        variants: row.variantsWithSpend,
        adDays: row.days.size,
        issues: "",
        per,
        profit30: per[30].profit,
        advies,
        onStore: !!p,
      });
      // variant-uitsplitsing (hash per product)
      if (p) {
        const vrows = vs.map((v) => {
          const ai = row.variantItems.get(String(v.id));
          const vsw = vsales.get(String(v.id)) || null;
          const vper = {};
          for (const w of WINDOWS) vper[w] = calc(ai ? ai.w[w] : emptyW(), vsw ? vsw[w] : null);
          return { id: String(v.id), title: v.title, sku: v.sku || "", price: Number(v.price) || 0, compareAt: Number(v.compare_at_price) || null, item: ai ? ai.item : "", soldOut: !!(v.inventory_management && Number(v.inventory_quantity) <= 0 && v.inventory_policy !== "continue"), per: vper };
        });
        // Ads-items zonder bestaande variant (verwijderde varianten) als één regel
        const gone = [...row.variantItems.entries()].filter(([vid]) => !vs.some((v) => String(v.id) === vid));
        if (gone.length) {
          const gw = { 7: emptyW(), 14: emptyW(), 30: emptyW() };
          for (const [, g] of gone) for (const w of WINDOWS) for (const f of Object.keys(gw[w])) gw[w][f] += g.w[w][f];
          const gper = {};
          for (const w of WINDOWS) gper[w] = calc(gw[w], null);
          vrows.push({ id: "deleted", title: `Verwijderde varianten (${gone.length})`, sku: "", price: 0, compareAt: null, item: "", soldOut: false, per: gper });
        }
        if (vrows.length) varHash[pid] = JSON.stringify(vrows);
      }
    }
    const ORDER = { Draften: 0, "Onder break-even": 1, Winstgevend: 2, Verkoopt: 3, Nieuw: 4, "Te weinig spend": 5, "Niet op store": 6, "Al draft": 7 };
    out.sort((a, b) => (ORDER[a.advies] - ORDER[b.advies]) || b.per[RW].spend - a.per[RW].spend || b.per[30].net - a.per[30].net);

    const totals = {};
    for (const w of WINDOWS) {
      const sum = (f) => round2(out.reduce((a, x) => a + (x.per[w][f] || 0), 0));
      const spend = sum("spend");
      const net = sum("net");
      totals[w] = {
        spend, accountSpend: accountSpend[w], rev: sum("rev"), refunds: sum("refunds"), net, netShop: sum("netShop"), units: sum("units"), orders: sum("orders"),
        clicks: sum("clicks"), impr: sum("impr"), conv: sum("conv"), convValue: sum("convValue"),
        roas: spend > 0 ? round2(net / spend) : null, products: out.length,
      };
    }
    const counts = {};
    for (const x of out) counts[x.advies] = (counts[x.advies] || 0) + 1;
    const draftSpend = round2(out.filter((x) => x.advies === "Draften").reduce((a, x) => a + x.per[RW].spend, 0));
    if (unmatched.length) warnings.push(`${unmatched.length} Ads-item(s) niet gevonden in Shopify (verwijderd of oude ID's) — staan als "Niet op store".`);
    const types = [...new Set(out.map((x) => x.type).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const tagCount = {};
    for (const x of out) for (const t of x.tags) tagCount[t] = (tagCount[t] || 0) + 1;
    const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) => ({ tag: t, n }));

    const result = {
      store: { name: store.name || "", domain, key },
      period: { from: start, to: end },
      ranges,
      windowDays: { 7: 7, 14: 14, 30: 30 },
      adsCurrency: adsCur,
      shopCurrency: shopCur,
      fx: { rate: Math.round(fx.rate * 10000) / 10000, source: fx.source },
      settings: { ...S, breakEvenRoas: round2(be) },
      totals,
      counts,
      draftSpend,
      ordersCounted,
      adsItems: items.size,
      adsUpdated: ads.updated,
      types,
      tags,
      rows: out,
      warnings,
      syncedAt: new Date().toISOString(),
      syncMs: 0,
    };
    try {
      await applyBoostState(result, domain);
    } catch (e) {
      result.warnings.push(`Boost-status niet geladen: ${String((e && e.message) || e).slice(0, 120)}`);
    }
    result.syncMs = Date.now() - t0;

    await step("Opslaan…");
    // geheugen voor TPK: producten met extreem goede ROAS én uptrend (7 d t.o.v.
    // dag 8–30) — vóór het opslaan, zodat een gat in de Ads-data als
    // waarschuwing in het dashboard staat
    try {
      const up = await saveUptrend(org, domain, result);
      result.uptrendCount = up.products.length;
      for (const w of up.warnings || []) result.warnings.push(w);
    } catch (e) {
      result.warnings.push(`Uptrend voor TPK niet opgeslagen: ${String((e && e.message) || e).slice(0, 100)}`);
    }
    await setJson(K.data(org, domain), result);
    try {
      await redis.del(K.vars(org, domain));
      const entries = Object.entries(varHash);
      for (let i = 0; i < entries.length; i += 500) {
        await redis.hSet(K.vars(org, domain), Object.fromEntries(entries.slice(i, i + 500)));
      }
    } catch (e) {
      result.warnings.push(`Variant-uitsplitsing niet opgeslagen: ${String((e && e.message) || e).slice(0, 100)}`);
    }
    await taskUpdate(org, domain, taskId, { status: "done", finishedAt: new Date().toISOString(), msg: `${out.length} producten · ${items.size} Ads-items · ${ordersCounted} orders · ${Math.round(result.syncMs / 1000)} s` });
    return result;
  } catch (e) {
    await taskUpdate(org, domain, taskId, { status: "failed", finishedAt: new Date().toISOString(), msg: String((e && e.message) || e).slice(0, 300) });
    throw e;
  } finally {
    await redis.del(K.lock(org, domain)).catch(() => {});
  }
}

/** Voor de cron: alle stores met automatisch syncen aan, oudste eerst. */
export async function dueStores(org, maxAgeMs = STALE_MS) {
  const list = await autoList(org);
  const out = [];
  for (const cfg of list) {
    if (!cfg || !cfg.store || !cfg.store.domain || cfg.enabled === false) continue;
    const data = await loadData(org, cfg.store.domain);
    const age = data && data.syncedAt ? Date.now() - Date.parse(data.syncedAt) : Infinity;
    if (age >= maxAgeMs) out.push({ cfg, age });
  }
  return out.sort((a, b) => b.age - a.age);
}
