// OMZET-DASHBOARD (29-10-2026) — alle eigen Attoh-stores op één scherm.
//
// Per store en per dag (kalenderdag in Londen, zelfde afspraak als de P&L):
//   - omzet  : som van current_total_price van alle niet-test, niet-geannuleerde
//              orders die die dag zijn aangemaakt, omgerekend naar £ met de
//              ECB-dagkoers (frankfurter). Vandaag = laatste bekende koers.
//   - orders : aantal van diezelfde orders
//   - sessies: Shopify Analytics via ShopifyQL ("FROM sessions …") — vraagt
//              read_reports op de Orders-app (API 2025-10+). Lukt dat niet,
//              dan blijft conversie leeg en geven we de reden terug.
//   - Google Ads: uit de sheet "Attoh Ads Live" (tab Ads_<KEY>), die elk uur
//              gevuld wordt door het Google Ads-script in elk account.
//              Kosten zijn al in £ (alle ad-accounts staan op GBP).
//
// Credentials komen per request mee vanuit de browser (sa_stores +
// sa_orders_app::<domein>), net als bij Bills — niets wordt server-side bewaard.

import { cleanDomain, resolveToken } from "./shopify";
import { readRange, a1Tab } from "./sheets";

export const TZ = "Europe/London";

/* Bekende stores → sleutel van het Ads-tabblad + Google Ads-account. Wordt
   gebruikt als standaard; op de pagina is de sleutel per store aan te passen. */
export const KNOWN_STORES = [
  { key: "SSB", match: /soul\s*society|0d6n10-zj/i, adsId: "480-581-8700" },
  { key: "LGB", match: /lady\s*glam|lornvale/i, adsId: "984-701-3293" },
  { key: "EMC", match: /everman/i, adsId: "101-493-0915" },
  { key: "SW", match: /shapes\s*wardrobe|shapeswardrobe|6snnji-kr/i, adsId: "306-181-2644" },
];

export function guessKey(store) {
  const hay = `${(store && store.name) || ""} ${(store && store.domain) || ""}`;
  const hit = KNOWN_STORES.find((k) => k.match.test(hay));
  return hit ? hit.key : "";
}

export function adsIdOf(key) {
  const hit = KNOWN_STORES.find((k) => k.key === String(key || "").toUpperCase());
  return hit ? hit.adsId : "";
}

/* ---------- Datums in Londen ---------- */

export function londonDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return t.toISOString().slice(0, 10);
}

/** Offset van Londen t.o.v. UTC (in minuten) op een bepaald moment. */
function londonOffsetMin(utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** 00:00 Londen-tijd van een dag → ISO in UTC. */
export function londonMidnightIso(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const off = londonOffsetMin(guess);
  return new Date(guess - off * 60000).toISOString();
}

/* ---------- Wisselkoers → £ ---------- */

const fxCache = new Map(); // "yyyy-mm-dd|USD" → rate

export async function fxToGbp(ymd, currency) {
  const cur = String(currency || "").toUpperCase();
  if (!cur || cur === "GBP") return 1;
  const today = londonDay();
  const date = ymd >= today ? "latest" : ymd;
  const key = `${date}|${cur}`;
  if (fxCache.has(key)) return fxCache.get(key);
  const urls = [
    `https://api.frankfurter.dev/v1/${date}?base=${cur}&symbols=GBP`,
    `https://api.frankfurter.app/${date}?from=${cur}&to=GBP`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const rate = data && data.rates && data.rates.GBP;
      if (rate) {
        // "latest" maar kort cachen, historische koersen blijven gelijk
        fxCache.set(key, rate);
        if (date === "latest") setTimeout(() => fxCache.delete(key), 30 * 60 * 1000);
        return rate;
      }
    } catch {}
  }
  return null;
}

/** Koersen → £ voor elke dag in [from, to]. Eén verzoek (frankfurter
 *  tijdreeks); weekend/feestdag krijgt de laatste bankdag ervoor. Vandaag =
 *  laatste bekende koers. */
export async function fxRangeToGbp(fromYmd, toYmd, currency) {
  const cur = String(currency || "").toUpperCase();
  const out = {};
  const dates = [];
  for (let d = fromYmd; d <= toYmd; d = addDays(d, 1)) dates.push(d);
  if (!cur || cur === "GBP") {
    for (const d of dates) out[d] = 1;
    return out;
  }
  let series = null;
  const start = addDays(fromYmd, -6); // ruimte om terug te vallen op een eerdere bankdag
  for (const url of [
    `https://api.frankfurter.dev/v1/${start}..${toYmd}?base=${cur}&symbols=GBP`,
    `https://api.frankfurter.app/${start}..${toYmd}?from=${cur}&to=GBP`,
  ]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.rates) { series = data.rates; break; }
    } catch {}
  }
  const known = Object.keys(series || {}).sort();
  let last = null;
  let ki = 0;
  for (const d of [...dates]) {
    while (ki < known.length && known[ki] <= d) {
      last = series[known[ki]].GBP;
      ki++;
    }
    out[d] = last;
  }
  // gaten (geen tijdreeks of vandaag) vullen met de losse dag-/laatste koers
  for (const d of dates) {
    if (out[d] == null || d === londonDay()) {
      const r = await fxToGbp(d, cur);
      if (r != null) out[d] = r;
    }
  }
  return out;
}

/* ---------- Shopify ---------- */

async function gql(store, token, version, query, variables) {
  const res = await fetch(`https://${cleanDomain(store.domain)}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return { ok: false, error: `HTTP ${res.status}` };
  if (data.errors) {
    const msg = Array.isArray(data.errors)
      ? data.errors.map((e) => e.message || JSON.stringify(e)).join("; ")
      : JSON.stringify(data.errors);
    return { ok: false, error: msg.slice(0, 300) };
  }
  return { ok: true, data: data.data };
}

const ORDERS_QUERY = `
query ($q: String!, $after: String) {
  orders(first: 250, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      createdAt
      test
      cancelledAt
      currentTotalPriceSet { shopMoney { amount currencyCode } }
    } }
  }
}`;

function londonHour(d) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d)) % 24;
}

/** Orders per Londen-dag tussen [fromYmd, toYmd] (inclusief), plus per uur
 *  (0-23, Londen-tijd) voor de dagen in hourDays. */
export async function ordersByDay(store, token, fromYmd, toYmd, hourDays = []) {
  const minIso = londonMidnightIso(fromYmd);
  const maxIso = londonMidnightIso(addDays(toYmd, 1));
  const q = `created_at:>='${minIso}' AND created_at:<'${maxIso}'`;
  const days = {};
  const hours = {};
  for (const d of hourDays) hours[d] = { revenue: new Array(24).fill(0), orders: new Array(24).fill(0) };
  let currency = null;
  let after = null;
  for (let page = 0; page < 40; page++) {
    const r = await gql(store, token, "2024-07", ORDERS_QUERY, { q, after });
    if (!r.ok) {
      const hint = /access|scope|approved|protected/i.test(r.error)
        ? " (Orders-app mist read_orders of protected customer data)"
        : "";
      return { ok: false, error: `Orders: ${r.error}${hint}` };
    }
    const conn = r.data.orders;
    for (const { node } of conn.edges) {
      if (node.test || node.cancelledAt) continue;
      const created = new Date(node.createdAt);
      const day = londonDay(created);
      const money = node.currentTotalPriceSet && node.currentTotalPriceSet.shopMoney;
      const amount = Number(money && money.amount) || 0;
      if (money && money.currencyCode) currency = money.currencyCode;
      if (!days[day]) days[day] = { revenue: 0, orders: 0 };
      days[day].revenue += amount;
      days[day].orders += 1;
      if (hours[day]) {
        const h = londonHour(created);
        hours[day].revenue[h] += amount;
        hours[day].orders[h] += 1;
      }
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return { ok: true, days, hours, currency };
}

/** Sessies per dag via ShopifyQL (API 2025-10, scope read_reports). */
export async function sessionsByDay(store, token, fromYmd, toYmd) {
  const ql = `FROM sessions SHOW sessions TIMESERIES day SINCE ${fromYmd} UNTIL ${toYmd}`;
  const query = `query ($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name } rows } parseErrors } }`;
  const r = await gql(store, token, "2025-10", query, { q: ql });
  if (!r.ok) {
    const hint = /read_reports|access|scope/i.test(r.error)
      ? " — zet read_reports aan op de Orders-app en installeer opnieuw"
      : "";
    return { ok: false, error: `Sessies: ${r.error}${hint}` };
  }
  const res = r.data && r.data.shopifyqlQuery;
  if (!res) return { ok: false, error: "Sessies: geen antwoord van ShopifyQL" };
  if (res.parseErrors && res.parseErrors.length) {
    return { ok: false, error: `Sessies: ${JSON.stringify(res.parseErrors).slice(0, 200)}` };
  }
  const table = res.tableData || {};
  let rows = table.rows;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { rows = []; }
  }
  const cols = (table.columns || []).map((c) => c.name);
  const days = {};
  for (const row of rows || []) {
    // rijen zijn objecten ({day, sessions}) of arrays in kolomvolgorde
    const obj = Array.isArray(row) ? Object.fromEntries(cols.map((c, i) => [c, row[i]])) : row;
    const day = String(obj.day || obj.date || "").slice(0, 10);
    if (!day) continue;
    days[day] = Number(obj.sessions) || 0;
  }
  return { ok: true, days };
}

/** Sessies per uur (Londen) voor een paar dagen — zelfde ShopifyQL, TIMESERIES hour. */
export async function sessionsByHour(store, token, fromYmd, toYmd) {
  const ql = `FROM sessions SHOW sessions TIMESERIES hour SINCE ${fromYmd} UNTIL ${toYmd}`;
  const query = `query ($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name } rows } parseErrors } }`;
  const r = await gql(store, token, "2025-10", query, { q: ql });
  if (!r.ok || !r.data || !r.data.shopifyqlQuery) return null;
  const res = r.data.shopifyqlQuery;
  if (res.parseErrors && res.parseErrors.length) return null;
  const table = res.tableData || {};
  let rows = table.rows;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { rows = []; }
  }
  const cols = (table.columns || []).map((c) => c.name);
  const out = {};
  for (const row of rows || []) {
    const obj = Array.isArray(row) ? Object.fromEntries(cols.map((c, i) => [c, row[i]])) : row;
    const ts = String(obj.hour || obj.day || "");
    const t = new Date(ts);
    if (!ts || isNaN(t)) continue;
    const d = londonDay(t);
    const h = londonHour(t);
    if (!out[d]) out[d] = new Array(24).fill(0);
    out[d][h] += Number(obj.sessions) || 0;
  }
  return out;
}

/* ---------- Google Ads (sheet "Attoh Ads Live") ---------- */

const num = (v) => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[£$€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Tab Ads_<KEY> → { "yyyy-mm-dd": { cost, clicks, impressions, conversions, convValue, updated } } */
export async function adsByDay(sheetId, key) {
  if (!sheetId || !key) return { ok: false, error: "Geen Ads-sheet of store-sleutel ingesteld" };
  let values;
  try {
    values = await readRange(sheetId, `${a1Tab("Ads_" + key)}!A1:K400`);
  } catch (e) {
    const m = String(e.message || e);
    if (/Unable to parse range/i.test(m)) {
      return { ok: false, error: `Tab Ads_${key} bestaat nog niet — zet het Google Ads-script in dit account` };
    }
    return { ok: false, error: `Ads-sheet: ${m.slice(0, 200)}` };
  }
  const head = (values[0] || []).map((h) => String(h).trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const c = {
    date: col("date"), cost: col("cost"), clicks: col("clicks"), impressions: col("impressions"),
    conversions: col("conversions"), convValue: col("conv_value"), updated: col("updated_at"),
  };
  if (c.date < 0 || c.cost < 0) return { ok: false, error: `Tab Ads_${key} heeft niet de verwachte kolommen` };
  const days = {};
  for (const row of values.slice(1)) {
    const day = String(row[c.date] || "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    days[day] = {
      cost: num(row[c.cost]),
      clicks: num(row[c.clicks]),
      impressions: num(row[c.impressions]),
      conversions: num(row[c.conversions]),
      convValue: num(row[c.convValue]),
      updated: c.updated >= 0 ? String(row[c.updated] || "") : "",
    };
  }
  return { ok: true, days };
}

/** Tab Ads_<KEY>_H (per uur, gevuld door het script) →
 *  { "yyyy-mm-dd": { cost[24], clicks[24], impressions[24], convValue[24] } } */
export async function adsHourly(sheetId, key) {
  if (!sheetId || !key) return null;
  let values;
  try {
    values = await readRange(sheetId, `${a1Tab("Ads_" + key + "_H")}!A1:H3000`);
  } catch {
    return null;
  }
  const head = (values[0] || []).map((h) => String(h).trim().toLowerCase());
  const c = (n) => head.indexOf(n);
  const ci = { date: c("date"), hour: c("hour"), cost: c("cost"), clicks: c("clicks"), impressions: c("impressions"), convValue: c("conv_value") };
  if (ci.date < 0 || ci.hour < 0) return null;
  const out = {};
  for (const row of values.slice(1)) {
    const d = String(row[ci.date] || "").trim().slice(0, 10);
    const h = Number(row[ci.hour]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !(h >= 0 && h < 24)) continue;
    if (!out[d]) out[d] = { cost: new Array(24).fill(0), clicks: new Array(24).fill(0), impressions: new Array(24).fill(0), convValue: new Array(24).fill(0) };
    out[d].cost[h] += num(row[ci.cost]);
    out[d].clicks[h] += num(row[ci.clicks]);
    out[d].impressions[h] += num(row[ci.impressions]);
    out[d].convValue[h] += num(row[ci.convValue]);
  }
  return out;
}

/* ---------- Eén store, een reeks dagen ---------- */

/** Dagen [fromYmd..ymd] + per uur voor ymd en prevYmd. Alles in £. */
export async function storeRange(store, fromYmd, ymd, prevYmd, adsSheetId) {
  const out = {
    key: store.key || "", name: store.name, domain: store.domain,
    adsId: adsIdOf(store.key), errors: [], days: {}, hours: {},
  };
  const adsP = store.key ? adsByDay(adsSheetId, store.key) : Promise.resolve({ ok: false, error: "Geen Ads-sleutel" });
  const adsHP = store.key ? adsHourly(adsSheetId, store.key).catch(() => null) : Promise.resolve(null);

  let orders = null;
  let sessions = null;
  const t = await resolveToken(store);
  if (!t.ok) out.errors.push(`Token: ${t.error}`);
  else {
    let sessH;
    [orders, sessions, sessH] = await Promise.all([
      ordersByDay(store, t.token, fromYmd, ymd, [ymd, prevYmd]),
      sessionsByDay(store, t.token, fromYmd, ymd),
      sessionsByHour(store, t.token, prevYmd, ymd).catch(() => null),
    ]);
    out._sessH = sessH;
    if (!orders.ok) { out.errors.push(orders.error); orders = null; }
    if (!sessions.ok) { out.sessionsError = sessions.error; sessions = null; }
  }

  const cur = (orders && orders.currency) || store.currency || "GBP";
  out.currency = cur;
  const fx = await fxRangeToGbp(fromYmd, ymd, cur);
  const ads = await adsP;
  if (!ads.ok) out.adsError = ads.error;

  for (let d = fromYmd; d <= ymd; d = addDays(d, 1)) {
    const o = orders && orders.days[d] ? orders.days[d] : { revenue: 0, orders: 0 };
    const rate = fx[d];
    out.days[d] = {
      revenueLocal: Math.round(o.revenue * 100) / 100,
      revenue: rate == null ? null : Math.round(o.revenue * rate * 100) / 100,
      orders: orders ? o.orders : null,
      sessions: sessions ? (sessions.days[d] || 0) : null,
      fx: rate,
      ads: ads.ok ? (ads.days[d] || { cost: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0, updated: "" }) : null,
    };
  }
  const adsH = await adsHP;
  if (orders) {
    for (const d of [ymd, prevYmd]) {
      const rate = fx[d] == null ? 1 : fx[d];
      const h = orders.hours[d] || { revenue: new Array(24).fill(0), orders: new Array(24).fill(0) };
      out.hours[d] = {
        revenue: h.revenue.map((v) => Math.round(v * rate * 100) / 100),
        orders: h.orders,
        sessions: out._sessH && sessions ? (out._sessH[d] || new Array(24).fill(0)) : null,
        ads: adsH ? (adsH[d] || { cost: new Array(24).fill(0), clicks: new Array(24).fill(0), impressions: new Array(24).fill(0), convValue: new Array(24).fill(0) }) : null,
      };
    }
  }
  out.adsHourly = Boolean(adsH);
  delete out._sessH;
  if (fx[ymd] == null) out.errors.push(`Geen wisselkoers ${cur}→GBP gevonden`);
  return out;
}
