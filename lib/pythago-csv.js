// PYTHAGO — Google Ads-productexport lezen (17-10-2026).
// Puur JavaScript zonder imports: draait in de browser (de Pythago-pagina leest
// de CSV daar en stuurt alleen de opgetelde cijfers per item naar de server —
// een export met segment Dag kan tienduizenden regels hebben) én op de server.

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const WINDOWS = [7, 14, 30];

/* CSV (komma, puntkomma of tab; quotes met "" erin). */
function parseCsv(text) {
  const src = String(text || "").replace(/^\uFEFF/, "").replace(/\u0000/g, "");
  const lines = src.split(/\r?\n/).slice(0, 8).join("\n");
  const tabs = (lines.match(/\t/g) || []).length;
  const semis = (lines.match(/;/g) || []).length;
  const commas = (lines.match(/,/g) || []).length;
  const delim = tabs >= Math.max(semis, commas) && tabs > 0 ? "\t" : semis > commas ? ";" : ",";
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
      continue;
    }
    if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => String(c).trim()));
}

const norm = (h) => String(h || "").toLowerCase().replace(/[\u00a0\s]+/g, " ").replace(/[()]/g, "").trim();

// Kolomnamen (EN + NL). Exacte match na normaliseren — "alle conv." en
// "kosten/conv." mogen NIET als conversies/kosten gelezen worden.
const COLS = {
  day: ["day", "dag", "date", "datum"],
  itemId: ["item id", "item-id", "itemid", "offer id", "product id", "product-id", "id"],
  title: ["title", "titel", "product title", "producttitel", "product", "item"],
  cost: ["cost", "kosten"],
  clicks: ["clicks", "klikken"],
  impr: ["impr.", "impressions", "vertoningen", "vert."],
  conv: ["conversions", "conversies", "conv."],
  convValue: ["conv. value", "conversion value", "conv.waarde", "conv. waarde", "conversiewaarde", "conv.-waarde", "total conv. value"],
  currency: ["currency code", "valutacode", "currency", "valuta"],
  // feed-problemen per item (Conversion Booster laat ze aan de AI zien)
  issues: ["issues", "problemen", "problems", "issue"],
};
const NL_HINTS = ["dag", "kosten", "klikken", "vertoningen", "conversies", "conv.waarde", "titel", "valutacode", "item-id"];

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map(norm);
    const has = (k) => h.some((x) => COLS[k].includes(x));
    if (has("cost") && (has("itemId") || has("title"))) return i;
  }
  return -1;
}

function colIndex(header, key) {
  const h = header.map(norm);
  for (const name of COLS[key]) {
    const i = h.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

/* Getal uit een cel: "£ 1.234,56" (NL), "1,234.56" (EN), "--" = 0. */
function numOf(v, nl) {
  let s = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!s || s === "-" || s === "--") return 0;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) && !nl ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot && nl && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const MONTHS = {
  jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2, mar: 3, march: 3, mrt: 3, maart: 3,
  apr: 4, april: 4, may: 5, mei: 5, jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7,
  aug: 8, august: 8, augustus: 8, sep: 9, sept: 9, september: 9, oct: 10, okt: 10, october: 10, oktober: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/* "2026-10-15", "15 okt 2026", "Oct 15, 2026", "15-10-2026", "do 15 okt. 2026" → "2026-10-15" */
export function parseDay(v, nl = true) {
  const s = String(v || "").toLowerCase().replace(/\./g, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (m && MONTHS[m[2]]) return iso(+m[3], MONTHS[m[2]], +m[1]);
  m = s.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m && MONTHS[m[1]]) return iso(+m[3], MONTHS[m[1]], +m[2]);
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return nl ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  return null;
}

export const dayNum = (isoDay) => Math.round(Date.parse(`${isoDay}T00:00:00Z`) / 86400000);
export const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

/* Item ID van de Google & YouTube-app: shopify_AU_<productId>_<variantId> */
function idsOf(itemId) {
  const m = String(itemId || "").match(/shopify_[a-z]{2}_(\d+)_(\d+)/i);
  if (m) return { productId: m[1], variantId: m[2] };
  const m2 = String(itemId || "").match(/^(\d{6,})$/);
  return m2 ? { productId: null, variantId: m2[1] } : { productId: null, variantId: null };
}

/**
 * Eén export lezen. Geeft { name, rows, hasDay, period, nl, currency, cols, warnings }.
 * rows = [{ day|null, itemId, productId, variantId, title, cost, clicks, impr, conv, convValue }]
 */
export function parseAdsExport(text, name = "export") {
  const rows = parseCsv(text);
  const hi = findHeader(rows);
  if (hi < 0) throw httpErr(422, `"${name}": geen productrapport herkend — er moet een kolom Kosten/Cost en Item ID of Titel in staan.`);
  const header = rows[hi];
  const hNorm = header.map(norm);
  const nl = hNorm.some((h) => NL_HINTS.includes(h));
  const idx = {};
  for (const k of Object.keys(COLS)) idx[k] = colIndex(header, k);
  const warnings = [];
  if (idx.itemId < 0) warnings.push(`"${name}": geen kolom Item ID — producten worden op titel gekoppeld (voeg de kolom Item ID toe voor 100% zekerheid).`);
  if (idx.conv < 0) warnings.push(`"${name}": geen kolom Conversies — alleen Shopify-verkopen tellen.`);

  // periode uit de regels boven de kop ("1 okt 2026 - 16 okt 2026")
  let period = null;
  for (const r of rows.slice(0, hi)) {
    const line = r.join(" ");
    const parts = line.split(/\s[-–]\s/);
    if (parts.length === 2) {
      const a = parseDay(parts[0], nl);
      const b = parseDay(parts[1], nl);
      if (a && b) {
        period = { from: a, to: b };
        break;
      }
    }
  }

  let currency = "";
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    if (!r.some((c) => c)) continue;
    const first = String(r[0] || "").toLowerCase();
    if (/^(total|totaal)/.test(first) || /^(total|totaal)/.test(String(r[idx.title] || "").toLowerCase())) continue;
    const itemId = idx.itemId >= 0 ? r[idx.itemId] : "";
    const title = idx.title >= 0 ? r[idx.title] : "";
    if (!itemId && !title) continue;
    if (/^(total|totaal)/i.test(itemId)) continue;
    const day = idx.day >= 0 ? parseDay(r[idx.day], nl) : null;
    if (idx.day >= 0 && !day) continue;
    if (!currency && idx.currency >= 0 && /^[A-Z]{3}$/.test(r[idx.currency])) currency = r[idx.currency];
    const ids = idsOf(itemId);
    out.push({
      day,
      itemId: String(itemId || "").trim(),
      productId: ids.productId,
      variantId: ids.variantId,
      title: String(title || "").trim(),
      cost: numOf(r[idx.cost], nl),
      clicks: idx.clicks >= 0 ? numOf(r[idx.clicks], nl) : 0,
      impr: idx.impr >= 0 ? numOf(r[idx.impr], nl) : 0,
      conv: idx.conv >= 0 ? numOf(r[idx.conv], nl) : 0,
      convValue: idx.convValue >= 0 ? numOf(r[idx.convValue], nl) : 0,
      issues: idx.issues >= 0 ? String(r[idx.issues] || "").replace(/\s+/g, " ").trim().slice(0, 160) : "",
    });
  }
  const hasDay = idx.day >= 0;
  if (hasDay && out.length) {
    const days = out.map((x) => x.day).sort();
    period = { from: days[0], to: days[days.length - 1] };
  }
  if (!out.length) throw httpErr(422, `"${name}": geen productregels gevonden.`);
  return { name, rows: out, hasDay, period, nl, currency, warnings };
}

/**
 * Exports samenvoegen tot spend per item per venster.
 * Met segment Dag: vensters t/m de laatste dag in de data. Zonder: elke export
 * is één venster (lengte uit de periode → 7, 14 of 30).
 */
export function combineExports(exports) {
  const warnings = exports.flatMap((e) => e.warnings);
  const daily = exports.filter((e) => e.hasDay);
  const flat = exports.filter((e) => !e.hasDay);
  const items = new Map(); // itemKey → { itemId, productId, variantId, title, w: {7:{…},14:{…},30:{…}} }
  const empty = () => ({ cost: 0, clicks: 0, impr: 0, conv: 0, convValue: 0 });
  const get = (r) => {
    const key = r.itemId ? `i:${r.itemId.toLowerCase()}` : `t:${r.title.toLowerCase()}`;
    let it = items.get(key);
    if (!it) {
      it = { itemId: r.itemId, productId: r.productId, variantId: r.variantId, title: r.title, issues: "", w: { 7: empty(), 14: empty(), 30: empty() } };
      items.set(key, it);
    }
    if (!it.title && r.title) it.title = r.title;
    if (!it.issues && r.issues) it.issues = r.issues;
    return it;
  };
  const add = (acc, r) => {
    acc.cost += r.cost;
    acc.clicks += r.clicks;
    acc.impr += r.impr;
    acc.conv += r.conv;
    acc.convValue += r.convValue;
  };

  let end = null;
  let start = null;
  const have = { 7: false, 14: false, 30: false };
  // werkelijk aantal dagen per venster (een losse export van 19 dagen telt als
  // het 30-dagenvenster, maar orders/omzet moeten dan ook over 19 dagen)
  const days = { 7: 7, 14: 14, 30: 30 };
  if (daily.length) {
    const all = daily.flatMap((e) => e.rows);
    end = all.reduce((m, r) => (r.day > m ? r.day : m), "0000-00-00");
    start = all.reduce((m, r) => (r.day < m ? r.day : m), "9999-99-99");
    const endN = dayNum(end);
    const spanDays = endN - dayNum(start) + 1;
    for (const r of all) {
      const ago = endN - dayNum(r.day); // 0 = laatste dag
      const it = get(r);
      for (const w of WINDOWS) if (ago < w) add(it.w[w], r);
    }
    for (const w of WINDOWS) have[w] = spanDays >= w - 1; // 1 dag speling (export "afgelopen 30 dagen" kan 29–30 dagen zijn)
    if (spanDays < 29) {
      days[30] = spanDays;
      have[30] = true;
      warnings.push(`De Ads-export beslaat ${spanDays} dagen (${start} t/m ${end}) — de 30-dagenkolom (en het advies) rekent met ${spanDays} dagen spend én ${spanDays} dagen Shopify-verkoop.`);
    }
  }
  for (const e of flat) {
    if (!e.period) {
      warnings.push(`"${e.name}": periode niet gevonden boven de kop — geteld als 30 dagen. Exporteer liefst met segment Dag.`);
    }
    const len = e.period ? dayNum(e.period.to) - dayNum(e.period.from) + 1 : 30;
    // 1–8 d → 7, 9–15 d → 14, langer → 30. Een export van bv. 2–20 okt (19 d)
    // telde eerst als 14 dagen: de 30-dagenkolom bleef £0 en elk product kreeg
    // "Te weinig spend". Nu: 30-dagenvenster met de echte lengte.
    const w = len <= 8 ? 7 : len <= 15 ? 14 : 30;
    if (len !== w && Math.abs(len - w) > 1) {
      warnings.push(`"${e.name}" beslaat ${len} dagen (${e.period.from} t/m ${e.period.to}) — telt als het ${w}-dagenvenster, met ${len} dagen spend én ${len} dagen Shopify-verkoop.`);
    }
    days[w] = len;
    if (daily.length) {
      warnings.push(`"${e.name}" (zonder dag-segment) genegeerd: er is al een export met segment Dag.`);
      continue;
    }
    if (have[w]) warnings.push(`Twee exports voor ${w} dagen — de laatste telt.`);
    for (const it of items.values()) it.w[w] = empty();
    for (const r of e.rows) add(get(r).w[w], r);
    have[w] = true;
    if (e.period && (!end || e.period.to > end)) end = e.period.to;
    if (e.period && (!start || e.period.from < start)) start = e.period.from;
  }
  // ontbrekende vensters: 30 zonder 14/7 → alleen 30 tonen
  const currency = exports.map((e) => e.currency).find(Boolean) || "";
  const files = exports.map((e) => ({ name: e.name, rows: e.rows.length, hasDay: e.hasDay, period: e.period, nl: e.nl }));
  return { items: [...items.values()], have, days, end, start, warnings, currency, files };
}


/** Alleen items met spend of conversies — de rest doet niet mee en maakt de request groot. */
export function slimAds(ads) {
  const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const items = ads.items
    .filter((it) => [7, 14, 30].some((w) => it.w[w].cost > 0 || it.w[w].conv > 0))
    .map((it) => ({
      itemId: it.itemId,
      productId: it.productId,
      variantId: it.variantId,
      title: it.title,
      issues: it.issues || "",
      w: Object.fromEntries([7, 14, 30].map((w) => [w, { cost: r2(it.w[w].cost), clicks: Math.round(it.w[w].clicks), impr: Math.round(it.w[w].impr), conv: r2(it.w[w].conv), convValue: r2(it.w[w].convValue) }])),
    }));
  return { ...ads, items, droppedItems: ads.items.length - items.length };
}
