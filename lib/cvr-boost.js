// CONVERSION BOOSTER — vóór het draften eerst een kans geven (23-10-2026,
// projectdoc 64). Hoort bij Pythago (lib/pythago.js).
//
// Wat het doet, in drie stappen:
//  1. analyse  — uit een Pythago-run de kandidaten kiezen (aangevinkte
//                advies-categorieën, genoeg klikken om te oordelen, niet al
//                geboost), de listing uit Shopify erbij halen (titel,
//                omschrijving, foto 1, prijs, varianten/voorraad, size guide)
//                en de AI per product een kritisch oordeel laten geven:
//                Boost · Draft nu · Laten lopen, met oorzaak, verslag en acties.
//                Schrijft niets.
//  2. write    — de aangevinkte producten als blad "CVR BOOST dd-mm" in de sheet
//                van de store + regels in "CVR Log"; de run gaat in het geheugen
//                (Redis, per organisatie) zodat Pythago die producten niet
//                draft zolang de boost loopt.
//  3. done     — Justin meldt de boost klaar (Claude heeft de fixes gedaan):
//                blad verbergen, boost-venster (14 d) start. Na het venster
//                vergelijkt Pythago de 14 dagen vóór de boost met de 14 dagen
//                erna: "Boost werkt" of "geen effect → Draften".
//
// Regels (instelbaar per store, standaard tussen haakjes):
//  - categorieën die mee mogen (Draften + Onder break-even)
//  - min. klikken in 30 d om over conversie te oordelen (20) — minder = Afwachten
//  - max producten per run (25), hoogste spend eerst
//  - boost-venster (14 dagen) · opnieuw boosten na "geen effect" (uit)

import { listProductsByIds, getProductMetafieldValues, cleanDomain } from "./shopify";
import { getRedis } from "./kw-memory";
import { rkey } from "./org-server";
import { keywordFromTitle, canonOf } from "./geheugen";
import { cvrBoostNotes, cvrBoostSummary, emptyAiUsage } from "./ai";
import {
  updateValues, batchUpdate, clearValues, addTab, getTabIdByTitle, resizeTabGrid,
  spreadsheetBatchUpdate, parseSheetId, a1Tab, appendRows, readRange,
} from "./sheets";
import { dayNum } from "./pythago-csv";
import { buildClaudeText } from "./cvr-text";

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const sheetUrl = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid != null ? `#gid=${gid}` : ""}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const ddmm = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}` : "";
};

export const CVR_CATEGORIES = ["Draften", "Onder break-even", "Verkoopt", "Winstgevend", "Te weinig spend"];
export const CVR_DEFAULTS = {
  categories: ["Draften", "Onder break-even"],
  minClicks: 20,
  maxPerRun: 25,
  windowDays: 14,
  allowRepeat: false,
};
export const CVR_LOG_TAB = "CVR Log";
const MAX_PER_RUN_HARD = 40;
const AI_BATCH = 5; // producten per AI-call (elk met foto 1)
const AI_PARALLEL = 4;

function normSettings(settings) {
  const s = { ...CVR_DEFAULTS, ...(settings || {}) };
  s.categories = (Array.isArray(s.categories) ? s.categories : CVR_DEFAULTS.categories).filter((c) => CVR_CATEGORIES.includes(c));
  s.minClicks = Math.max(0, Math.round(Number(s.minClicks) || 0));
  s.maxPerRun = Math.min(MAX_PER_RUN_HARD, Math.max(1, Math.round(Number(s.maxPerRun) || CVR_DEFAULTS.maxPerRun)));
  s.windowDays = Math.min(60, Math.max(3, Math.round(Number(s.windowDays) || CVR_DEFAULTS.windowDays)));
  s.allowRepeat = !!s.allowRepeat;
  return s;
}

/* ======================================================================
   1. PRODUCTTYPE uit de titel (grof: Jeans, Shoes, Dresses …) — om te zien
      of een heel type niet verkoopt in deze store
   ====================================================================== */

const HEAD = {
  jean: "Jeans", shoe: "Shoes", boot: "Boots", dress: "Dresses", gown: "Dresses", top: "Tops", tank: "Tops", singlet: "Tops",
  shirt: "Shirts", blouse: "Blouses", tee: "T-shirts", polo: "Polos", sweater: "Sweaters", jumper: "Sweaters", knit: "Sweaters",
  cardigan: "Cardigans", hoodie: "Hoodies", sweatshirt: "Sweatshirts", jacket: "Jackets", coat: "Coats", parka: "Coats",
  blazer: "Blazers", vest: "Vests", pant: "Pants", trouser: "Pants", chino: "Pants", legging: "Leggings", short: "Shorts",
  skirt: "Skirts", loafer: "Loafers", sandal: "Sandals", heel: "Heels", pump: "Heels", sneaker: "Sneakers", trainer: "Sneakers",
  flat: "Flats", slide: "Slides", slipper: "Slippers", mule: "Mules", bag: "Bags", tote: "Bags", backpack: "Bags", wallet: "Wallets",
  hat: "Hats", cap: "Hats", beanie: "Hats", belt: "Belts", scarf: "Scarves", glove: "Gloves", sock: "Socks", jumpsuit: "Jumpsuits",
  romper: "Jumpsuits", playsuit: "Jumpsuits", set: "Sets", suit: "Suits", swimsuit: "Swimwear", bikini: "Swimwear", swim: "Swimwear",
  trunk: "Swimwear", pajama: "Sleepwear", pyjama: "Sleepwear", robe: "Sleepwear", bra: "Lingerie", lingerie: "Lingerie", sunglass: "Sunglasses",
  watch: "Watches", jewelry: "Jewelry", necklace: "Jewelry", earring: "Jewelry", bracelet: "Jewelry", ring: "Jewelry",
};

export function typeOf(row) {
  const canon = canonOf(keywordFromTitle(row.title || ""));
  const toks = canon.split(/\s+/).filter(Boolean);
  if (toks.includes("t") && toks.includes("shirt")) return "T-shirts";
  for (const t of toks) if (HEAD[t]) return HEAD[t];
  const pt = String(row.type || "").trim();
  if (pt) return pt;
  return toks[0] ? toks[0][0].toUpperCase() + toks[0].slice(1) : "Overig";
}

function typeStats(rows, threshold) {
  const by = new Map();
  for (const r of rows) {
    if (!r.productId || !r.per || r.per[30].spend < threshold) continue;
    const T = typeOf(r);
    let s = by.get(T);
    if (!s) {
      s = { n: 0, withOrders: 0, spend: 0, rev: 0 };
      by.set(T, s);
    }
    s.n++;
    if (r.per[30].orders > 0) s.withOrders++;
    s.spend += r.per[30].spend;
    s.rev += r.per[30].rev;
  }
  const out = {};
  for (const [T, s] of by) out[T] = { ...s, roas: s.spend > 0 ? round2(s.rev / s.spend) : null };
  return out;
}

/* ======================================================================
   2. KANDIDATEN (regels, geen AI)
   ====================================================================== */

export function selectCandidates(result, settings) {
  const S = normSettings(settings);
  const eligible = [];
  const waiting = [];
  const boosted = [];
  for (const r of result.rows || []) {
    if (!r.productId || r.status !== "active" || r.drafted) continue;
    if (!S.categories.includes(r.advies)) continue;
    if (r.boost && r.boost.active) {
      boosted.push({ productId: r.productId, title: r.title, reason: `in lopende boost (${r.boost.tab})` });
      continue;
    }
    if (r.boost && !S.allowRepeat) {
      boosted.push({ productId: r.productId, title: r.title, reason: `al geboost (${r.boost.tab}${r.boost.effect ? ` · ${r.boost.effect}` : ""})` });
      continue;
    }
    if ((r.per[30].clicks || 0) < S.minClicks) {
      waiting.push({ productId: r.productId, title: r.title, clicks: r.per[30].clicks, spend: r.per[30].spend, advies: r.advies });
      continue;
    }
    eligible.push(r);
  }
  eligible.sort((a, b) => b.per[30].spend - a.per[30].spend || b.per[30].clicks - a.per[30].clicks);
  const take = eligible.slice(0, S.maxPerRun);
  const overflow = eligible.slice(S.maxPerRun).map((r) => ({ productId: r.productId, title: r.title, spend: r.per[30].spend, advies: r.advies }));
  return { settings: S, take, waiting, boosted, overflow, candidates: eligible.length + waiting.length };
}

/* ======================================================================
   3. LISTING uit Shopify (alleen voor de kandidaten)
   ====================================================================== */

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, " · ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/(\s·\s)+/g, " · ")
    .trim();
}

export async function gatherListing(store, ids, endIso) {
  const out = {};
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!list.length) return out;
  const fields = "id,title,handle,body_html,images,variants,options,created_at,published_at,product_type,tags,status";
  for (let i = 0; i < list.length; i += 40) {
    const r = await listProductsByIds(store, list.slice(i, i + 40), fields);
    if (!r.ok) throw httpErr(422, `Listing ophalen mislukt: ${r.error}`);
    for (const p of r.products || []) {
      const vs = p.variants || [];
      const prices = vs.map((v) => Number(v.price)).filter((x) => Number.isFinite(x) && x > 0);
      const compares = vs.map((v) => Number(v.compare_at_price)).filter((x) => Number.isFinite(x) && x > 0);
      const price = prices.length ? Math.min(...prices) : null;
      const compareAt = compares.length ? Math.max(...compares) : null;
      const sold = vs.filter((v) => v.inventory_management && Number(v.inventory_quantity) <= 0 && v.inventory_policy !== "continue");
      const startedAt = p.published_at || p.created_at;
      const age = startedAt && endIso ? dayNum(endIso) - dayNum(String(startedAt).slice(0, 10)) : null;
      out[String(p.id)] = {
        title: p.title,
        handle: p.handle,
        desc: stripHtml(p.body_html).slice(0, 500),
        images: (p.images || []).length,
        imageUrl: p.images && p.images[0] ? p.images[0].src : "",
        imageUrl2: p.images && p.images[1] ? p.images[1].src : "",
        price,
        compareAt,
        discountPct: price && compareAt && compareAt > price ? Math.round((1 - price / compareAt) * 100) : 0,
        variants: vs.length,
        soldOut: sold.length,
        soldOutNames: sold.map((v) => String(v.title || "").trim()).filter(Boolean).slice(0, 6),
        options: (p.options || []).map((o) => o.name).filter(Boolean),
        age,
        type: String(p.product_type || "").trim(),
        tags: String(p.tags || "").slice(0, 120),
        status: p.status,
      };
    }
  }
  try {
    const mf = await getProductMetafieldValues(store, list, { namespace: "custom", key: "size_guide" });
    if (mf.ok) for (const id of list) if (out[id]) out[id].sizeGuide = !!mf.values[id];
  } catch {}
  return out;
}

/* ======================================================================
   4. ANALYSE: kandidaten + listing + AI-oordeel (schrijft niets)
   ====================================================================== */

const n2 = (x) => (x == null ? "—" : Number(x).toFixed(2));
const pct1 = (x) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(1)}%`);

function metricsOf(r) {
  const p30 = r.per[30];
  const p14 = r.per[14];
  const p7 = r.per[7];
  return {
    spend30: p30.spend, clicks30: p30.clicks, impr30: p30.impr,
    ctr: p30.impr > 0 ? p30.clicks / p30.impr : null,
    cpc: p30.clicks > 0 ? round2(p30.spend / p30.clicks) : null,
    orders30: p30.orders, rev30: p30.rev, roas30: p30.roas, gconv30: p30.conv, gRoas30: p30.gRoas,
    cpo: p30.orders > 0 ? Math.round(p30.clicks / p30.orders) : null,
    spend14: p14.spend, clicks14: p14.clicks, orders14: p14.orders, roas14: p14.roas,
    spend7: p7.spend, orders7: p7.orders, roas7: p7.roas,
  };
}

function describeForAi(it, ctx) {
  const m = it.m;
  const L = it.listing || {};
  const cur = ctx.cur;
  const sc = ctx.shopCur;
  const lines = [
    `Titel: ${it.title}`,
    `Pythago-categorie: ${it.advies} · break-even ROAS ${n2(ctx.be)} · spend in ${cur}, prijzen in ${sc}`,
    `30 d: spend ${cur} ${n2(m.spend30)} · ${m.clicks30} klikken · ${m.impr30} vertoningen · CTR ${pct1(m.ctr)} · CPC ${cur} ${n2(m.cpc)} · ${m.orders30} orders · omzet ${cur} ${n2(m.rev30)} · ROAS ${n2(m.roas30)} · Google-conversies ${n2(m.gconv30)}${m.cpo != null ? ` · ${m.cpo} klikken per order` : ""}`,
    `14 d: spend ${cur} ${n2(m.spend14)} · ${m.orders14} orders · ROAS ${n2(m.roas14)} | 7 d: spend ${cur} ${n2(m.spend7)} · ${m.orders7} orders · ROAS ${n2(m.roas7)}`,
    `Listing: prijs ${sc} ${n2(L.price)}${L.compareAt ? ` (compare-at ${sc} ${n2(L.compareAt)}, −${L.discountPct}%)` : " (geen compare-at)"} · ${L.images ?? "?"} foto's · ${L.variants ?? "?"} varianten (${(L.options || []).join(" / ") || "geen opties"}), ${L.soldOut ? `${L.soldOut} uitverkocht: ${(L.soldOutNames || []).join(", ")}` : "niets uitverkocht"} · ${L.age ?? "?"} dagen live · size guide ${L.sizeGuide ? "ja" : "nee"}${L.type ? ` · producttype ${L.type}` : ""}`,
    `Zelfde type in deze run: ${it.typeStat || "onbekend"}`,
    `Feed-problemen: ${it.issues || "geen"}`,
    `Omschrijving (begin): ${L.desc || "(leeg)"}`,
  ];
  return lines.join("\n");
}

export async function cvrBoostAnalyse({ store, result, settings }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  if (!result || !Array.isArray(result.rows)) throw httpErr(400, "Draai eerst de Pythago-analyse");
  const sel = selectCandidates(result, settings);
  const S = sel.settings;
  if (!S.categories.length) throw httpErr(400, "Vink minstens één categorie aan");
  const domain = cleanDomain(store.domain);
  const cur = result.adsCurrency || "GBP";
  const shopCur = result.shopCurrency || cur;
  const be = result.settings && result.settings.breakEvenRoas;
  const endIso = result.period && result.period.to;
  const ai = emptyAiUsage();

  const stats = typeStats(result.rows, (result.settings && result.settings.threshold) || 0);
  const listing = sel.take.length ? await gatherListing(store, sel.take.map((r) => r.productId), endIso) : {};

  const items = sel.take.map((r, i) => {
    const L = listing[r.productId] || {};
    const T = typeOf(r);
    const st = stats[T];
    const typeStat = st ? `${T}: ${st.n} product${st.n === 1 ? "" : "en"} met spend, ${st.withOrders} met orders${st.roas != null ? ` (ROAS ${n2(st.roas)})` : ""}` : `${T}: alleen dit product`;
    return {
      index: i,
      productId: r.productId,
      title: r.title,
      handle: L.handle || r.handle || "",
      image: r.image || (L.imageUrl ? `${L.imageUrl}${L.imageUrl.includes("?") ? "&" : "?"}width=200` : ""),
      adminUrl: `https://${domain}/admin/products/${r.productId}`,
      storeUrl: L.handle || r.handle ? `https://${domain}/products/${L.handle || r.handle}` : "",
      advies: r.advies,
      type: T,
      typeStat,
      issues: r.issues || "",
      m: metricsOf(r),
      listing: {
        price: L.price ?? r.price ?? null,
        compareAt: L.compareAt ?? r.compareAt ?? null,
        discountPct: L.discountPct || 0,
        images: L.images ?? null,
        variants: L.variants ?? r.vcount ?? null,
        soldOut: L.soldOut ?? r.soldOut ?? 0,
        soldOutNames: L.soldOutNames || [],
        options: L.options || [],
        age: L.age ?? r.age ?? null,
        sizeGuide: !!L.sizeGuide,
        type: L.type || "",
        issues: r.issues || "",
        desc: L.desc || "",
      },
      imageUrl: L.imageUrl || "",
      ai: null,
    };
  });

  // AI in groepjes van AI_BATCH, AI_PARALLEL tegelijk
  const ctx = { cur, shopCur, be };
  const batches = [];
  for (let i = 0; i < items.length; i += AI_BATCH) batches.push(items.slice(i, i + AI_BATCH));
  const errors = [];
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        const r = await cvrBoostNotes(batch.map((it) => ({ index: it.index, text: describeForAi(it, ctx), imageUrl: it.imageUrl })));
        for (const it of batch) if (r.notes[it.index]) it.ai = r.notes[it.index];
        for (const k of Object.keys(ai)) ai[k] += r.ai[k] || 0;
      } catch (e) {
        errors.push(String((e && e.message) || e).slice(0, 160));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AI_PARALLEL, batches.length) }, worker));
  for (const it of items) {
    if (!it.ai) it.ai = { verdict: "Laten lopen", prio: 3, cause: "Geen", report: "AI gaf geen oordeel — beoordeel dit product zelf.", actions: [], missing: true };
    it.pick = it.ai.verdict === "Boost";
  }
  const PRIO = { Boost: 0, "Draft nu": 1, "Laten lopen": 2 };
  items.sort((a, b) => (PRIO[a.ai.verdict] - PRIO[b.ai.verdict]) || (a.ai.prio - b.ai.prio) || b.m.spend30 - a.m.spend30);
  items.forEach((it, i) => (it.index = i));

  const counts = {};
  const causes = {};
  for (const it of items) {
    counts[it.ai.verdict] = (counts[it.ai.verdict] || 0) + 1;
    if (it.ai.verdict === "Boost") causes[it.ai.cause] = (causes[it.ai.cause] || 0) + 1;
  }
  const boostSpend = round2(items.filter((it) => it.pick).reduce((a, it) => a + it.m.spend30, 0));

  let summary = "";
  if (items.length) {
    try {
      const r = await cvrBoostSummary({
        store: store.name || domain,
        cur,
        counts,
        causes,
        lines: items.map((it, i) => `${i + 1}. ${it.title} — ${it.advies} → ${it.ai.verdict} · ${it.ai.cause} · prio ${it.ai.prio} · ${cur} ${n2(it.m.spend30)} spend · ${it.m.orders30} orders · ROAS ${n2(it.m.roas30)}${it.ai.report ? ` · ${it.ai.report}` : ""}`),
      });
      summary = r.summary;
      for (const k of Object.keys(ai)) ai[k] += r.ai[k] || 0;
    } catch (e) {
      errors.push(`samenvatting: ${String((e && e.message) || e).slice(0, 120)}`);
    }
  }
  const stat = `${sel.candidates} kandidaten (${S.categories.join(", ")}) · ${items.length} beoordeeld · Boost ${counts.Boost || 0} · Draft nu ${counts["Draft nu"] || 0} · Laten lopen ${counts["Laten lopen"] || 0} · Afwachten ${sel.waiting.length}${sel.boosted.length ? ` · al geboost ${sel.boosted.length}` : ""}${sel.overflow.length ? ` · niet meegenomen ${sel.overflow.length} (max ${S.maxPerRun})` : ""}${Object.keys(causes).length ? ` · oorzaken: ${Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""} · ${cur} ${n2(boostSpend)} spend in de boost-lijst (30 d)`;

  return {
    ok: true,
    run: {
      storeName: store.name || "",
      domain,
      date: endIso || todayIso(),
      tabSuggestion: `CVR BOOST ${ddmm(endIso || todayIso())}`,
      period: result.period,
      cur,
      shopCur,
      be,
      settings: S,
      candidates: sel.candidates,
      items,
      waiting: sel.waiting,
      boosted: sel.boosted,
      overflow: sel.overflow,
      counts,
      causes,
      boostSpend,
      summary,
      stat,
      ai: { ...ai, usd: round2(ai.usd * 100) / 100 },
      errors,
    },
  };
}

/* ======================================================================
   5. GEHEUGEN (Redis, per organisatie): welke producten zitten in een boost
   ====================================================================== */

const stateKey = (domain) => rkey(`cvr:${cleanDomain(domain)}`);

export async function loadState(domain) {
  const r = await getRedis();
  const raw = await r.get(stateKey(domain));
  if (!raw) return { runs: [] };
  try {
    const s = JSON.parse(raw);
    return s && Array.isArray(s.runs) ? s : { runs: [] };
  } catch {
    return { runs: [] };
  }
}
export async function saveState(domain, state) {
  const r = await getRedis();
  await r.set(stateKey(domain), JSON.stringify(state));
}

const snap = (row) => ({
  spend14: row.per[14].spend, clicks14: row.per[14].clicks, orders14: row.per[14].orders, roas14: row.per[14].roas,
  spend30: row.per[30].spend, orders30: row.per[30].orders, roas30: row.per[30].roas,
});
function judge(before, after, be) {
  const b = before || {};
  const a = after || {};
  if ((b.orders14 || 0) === 0) return (a.orders14 || 0) > 0 ? "werkt" : "geen effect";
  if (a.roas14 != null && be && a.roas14 >= be && (b.roas14 == null || a.roas14 > b.roas14)) return "werkt";
  if ((a.orders14 || 0) > (b.orders14 || 0) || (a.roas14 || 0) > (b.roas14 || 0) * 1.2) return "beter";
  return "geen effect";
}
function effectText(pr) {
  const b = pr.before || {};
  const a = pr.after || {};
  const roas = (x) => (x == null ? "—" : Number(x).toFixed(2));
  return `${b.orders14 || 0} → ${a.orders14 || 0} orders, ROAS ${roas(b.roas14)} → ${roas(a.roas14)} (14 d)`;
}
function runSummary(run, endIso) {
  const endN = dayNum(endIso || todayIso());
  const W = run.windowDays || 14;
  const since = run.doneAt ? endN - dayNum(String(run.doneAt).slice(0, 10)) : null;
  const status = !run.doneAt ? "open" : since < W ? "venster" : "klaar";
  const prods = run.products || [];
  const eff = {};
  for (const p of prods) if (p.effect) eff[p.effect] = (eff[p.effect] || 0) + 1;
  return {
    tab: run.tab, date: run.date, createdAt: run.createdAt, doneAt: run.doneAt || null, hidden: !!run.hidden, url: run.url || "",
    sheetId: run.sheetId, tabId: run.tabId, windowDays: W, status, day: since == null ? null : Math.min(W, since + 1), products: prods.length, effects: eff,
  };
}

/**
 * Pythago-rijen voorzien van de boost-status (en na het venster: het effect).
 * Muteert result; geeft het terug. Geen Redis → ongewijzigd.
 */
export async function applyBoostState(result, domain) {
  let state;
  try {
    state = await loadState(domain);
  } catch {
    return result;
  }
  const endIso = (result.period && result.period.to) || todayIso();
  result.boosts = [];
  result.boostRuns = [];
  if (!state.runs.length) return result;
  const endN = dayNum(endIso);
  const be = result.settings && result.settings.breakEvenRoas;
  const byProduct = new Map();
  for (const run of state.runs) for (const pr of run.products || []) byProduct.set(String(pr.id), { run, pr });
  let changed = false;
  for (const row of result.rows || []) {
    const hit = row.productId && byProduct.get(String(row.productId));
    if (!hit) continue;
    const { run, pr } = hit;
    const W = run.windowDays || 14;
    const base = { tab: run.tab, date: run.date, windowDays: W, cause: pr.cause || "", verdict: pr.verdict || "" };
    if (!run.doneAt) {
      row.boost = { ...base, status: "open", active: true, day: Math.max(0, endN - dayNum(String(run.createdAt || run.date).slice(0, 10))) };
      continue;
    }
    const since = endN - dayNum(String(run.doneAt).slice(0, 10));
    if (since < W) {
      row.boost = { ...base, status: "venster", active: true, day: Math.max(1, since + 1), doneAt: run.doneAt };
      continue;
    }
    if (!pr.effect) {
      pr.after = snap(row);
      pr.effect = judge(pr.before, pr.after, be);
      pr.effectAt = endIso;
      changed = true;
    }
    row.boost = { ...base, status: "klaar", active: false, doneAt: run.doneAt, effect: pr.effect, effectText: effectText(pr) };
  }
  if (changed) await saveState(domain, state).catch(() => {});
  const all = state.runs.map((r) => runSummary(r, endIso)).reverse();
  result.boostRuns = all.slice(0, 30);
  result.boosts = all.filter((r) => r.status !== "klaar");
  return result;
}

/* ======================================================================
   6. NAAR DE SHEET: blad "CVR BOOST dd-mm" + "CVR Log"
   ====================================================================== */

const NAVY = { red: 0x1e / 255, green: 0x3a / 255, blue: 0x5f / 255 };
const WHITE = { red: 1, green: 1, blue: 1 };
const TAB_COLOR = { red: 0.1, green: 0.6, blue: 0.55 };
const VERDICT_COLORS = {
  Boost: { red: 0.85, green: 0.93, blue: 1 },
  "Draft nu": { red: 1, green: 0.86, blue: 0.86 },
  "Laten lopen": { red: 0.94, green: 0.94, blue: 0.94 },
};
const LOG_HEADER = [
  "Run", "Blad", "Product", "Product-ID", "Verdict", "Oorzaak", "Prio",
  "Spend 14d voor", "Klikken 14d voor", "Orders 14d voor", "ROAS 14d voor",
  "Spend 14d na", "Orders 14d na", "ROAS 14d na", "Resultaat", "Klaar op",
];
const LOG_WIDTHS = [90, 150, 320, 120, 90, 120, 50, 100, 100, 100, 95, 95, 95, 95, 110, 90];
const STATUS_COL = 29; // 0-based: "Status" in het CVR BOOST-blad
const colLetter = (i) => {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

async function ensureLogTab(id) {
  let tabId = await getTabIdByTitle(id, CVR_LOG_TAB);
  if (tabId !== null) return tabId;
  const made = await addTab(id, CVR_LOG_TAB, { rows: 2, cols: LOG_HEADER.length });
  if (!made.ok) {
    tabId = await getTabIdByTitle(id, CVR_LOG_TAB);
    if (tabId === null) throw httpErr(422, made.error);
    return tabId;
  }
  await updateValues(id, `${a1Tab(CVR_LOG_TAB)}!A1`, [LOG_HEADER]);
  const reqs = [
    { updateSheetProperties: { properties: { sheetId: made.tabId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { repeatCell: { range: { sheetId: made.tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: LOG_HEADER.length }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontFamily: "Arial", fontSize: 10 } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
  ];
  LOG_WIDTHS.forEach((px, i) => reqs.push({ updateDimensionProperties: { range: { sheetId: made.tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } }));
  await spreadsheetBatchUpdate(id, reqs).catch(() => {});
  return made.tabId;
}

/* Effecten die Pythago inmiddels bepaald heeft in de Log-regels zetten (kolommen L–P). Best effort. */
async function syncEffectsToLog(id, state, domain) {
  const pending = [];
  for (const run of state.runs) for (const pr of run.products || []) if (pr.effect && !pr.logged && run.sheetId === id) pending.push({ run, pr });
  if (!pending.length) return 0;
  const rows = await readRange(id, `${a1Tab(CVR_LOG_TAB)}!A1:P`).catch(() => []);
  const updates = [];
  for (const { run, pr } of pending) {
    const idx = rows.findIndex((r, i) => i > 0 && String(r[1] || "") === run.tab && String(r[3] || "") === String(pr.id));
    if (idx < 0) continue;
    const a = pr.after || {};
    updates.push({ range: `${a1Tab(CVR_LOG_TAB)}!L${idx + 1}:P${idx + 1}`, values: [[a.spend14 ?? "", a.orders14 ?? "", a.roas14 ?? "", pr.effect, run.doneAt ? String(run.doneAt).slice(0, 10) : ""]] });
    pr.logged = true;
  }
  if (updates.length) {
    await batchUpdate(id, updates);
    await saveState(domain, state).catch(() => {});
  }
  return updates.length;
}

export async function cvrBoostWrite({ store, sheet, tab, run }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const id = parseSheetId(sheet);
  const title = String(tab || "").trim();
  if (!id || !title) throw httpErr(400, "Sheet of bladnaam ontbreekt");
  if (new RegExp(`^${CVR_LOG_TAB}$`, "i").test(title)) throw httpErr(400, `"${CVR_LOG_TAB}" is het logblad — kies een andere naam`);
  const items = (run && Array.isArray(run.items) ? run.items : []).filter((it) => it && it.productId);
  if (!items.length) throw httpErr(400, "Geen producten aangevinkt");
  const domain = cleanDomain(store.domain);
  const cur = run.cur || "GBP";
  const sc = run.shopCur || cur;
  const header = [
    "Foto", "Prio", "Verdict", "Product", "Product-ID", "Categorie (Pythago)", "Oorzaak", "Verslag (AI)", "Acties (AI)",
    `Spend 30d (${cur})`, "Klikken 30d", "CTR", "Orders 30d", `Omzet 30d (${cur})`, "ROAS 30d", "G-conv 30d",
    `Spend 14d (${cur})`, "Orders 14d", "ROAS 14d", `Prijs (${sc})`, `Compare-at (${sc})`, "Foto's", "Varianten", "Uitverkocht",
    "Dagen live", "Size guide", "Feed-problemen", "Admin-link", "Storelink", "Status", "Klaar op",
  ];
  const rows = items.map((it) => {
    const m = it.m || {};
    const L = it.listing || {};
    const a = it.ai || {};
    return [
      "", a.prio ?? "", a.verdict || "", it.title, it.productId, it.advies || "", a.cause || "", a.report || "", (a.actions || []).map((x, i) => `${i + 1}) ${x}`).join("\n"),
      m.spend30 ?? "", m.clicks30 ?? "", m.ctr == null ? "" : Math.round(m.ctr * 1000) / 10, m.orders30 ?? "", m.rev30 ?? "", m.roas30 ?? "", m.gconv30 ?? "",
      m.spend14 ?? "", m.orders14 ?? "", m.roas14 ?? "", L.price ?? "", L.compareAt ?? "", L.images ?? "", L.variants ?? "", L.soldOut ? `${L.soldOut}${L.soldOutNames && L.soldOutNames.length ? ` (${L.soldOutNames.join(", ")})` : ""}` : 0,
      L.age ?? "", L.sizeGuide ? "ja" : "nee", L.issues || "", it.adminUrl || "", it.storeUrl || "", "open", "",
    ];
  });
  const S = run.settings || {};
  const foot = [
    [],
    [`Opdracht voor Claude: per product de listing verbeteren zodat de spend beter converteert — titel, omschrijving, foto's, prijs (binnen het rooster, geen schommeling), maten/voorraad, size guide. Wijzigingen direct in Shopify doorvoeren en per product melden wat er is veranderd. Niet draften.`],
    ...(run.summary ? String(run.summary).split(/\n+/).filter(Boolean).map((l) => [`Samenvatting: ${l}`]) : []),
    [run.stat || ""],
    [`Ads-data ${run.period && run.period.from ? `${run.period.from} t/m ` : "t/m "}${(run.period && run.period.to) || "?"} · break-even ROAS ${run.be ?? "?"} · categorieën ${(S.categories || []).join(", ")} · min. ${S.minClicks ?? "?"} klikken · max ${S.maxPerRun ?? "?"} per run · boost-venster ${S.windowDays ?? 14} dagen`],
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
  const pics = items.map((it) => [it.image ? `=IMAGE("${String(it.image).replace(/"/g, "%22")}")` : ""]);
  if (pics.some((r) => r[0])) await batchUpdate(id, [{ range: `${a1Tab(title)}!A2:A${rows.length + 1}`, values: pics }]).catch(() => {});

  const reqs = [
    { updateSheetProperties: { properties: { sheetId: tabId, tabColor: TAB_COLOR, hidden: false, gridProperties: { frozenRowCount: 1, frozenColumnCount: 4 } }, fields: "tabColor,hidden,gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontFamily: "Arial", fontSize: 10 }, wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { textFormat: { fontFamily: "Arial", fontSize: 10 }, verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,verticalAlignment)" } },
    // verslag + acties: tekst laten omlopen
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 7, endColumnIndex: 9 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment)" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 9, endColumnIndex: 10 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 13, endColumnIndex: 15 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 16, endColumnIndex: 17 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 18, endColumnIndex: 21 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } }, fields: "userEnteredFormat.numberFormat" } },
    { setBasicFilter: { filter: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: nCols } } } },
  ];
  const widths = [70, 45, 95, 300, 120, 130, 120, 420, 380, 85, 75, 55, 65, 85, 65, 70, 85, 65, 65, 80, 90, 55, 70, 160, 70, 70, 220, 260, 260, 70, 90];
  widths.forEach((px, i) => reqs.push({ updateDimensionProperties: { range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } }));
  if (rows.length) reqs.push({ updateDimensionProperties: { range: { sheetId: tabId, dimension: "ROWS", startIndex: 1, endIndex: rows.length + 1 }, properties: { pixelSize: 96 }, fields: "pixelSize" } });
  rows.forEach((r, i) => {
    const c = VERDICT_COLORS[r[2]];
    if (c) reqs.push({ repeatCell: { range: { sheetId: tabId, startRowIndex: i + 1, endRowIndex: i + 2, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { backgroundColor: c } }, fields: "userEnteredFormat.backgroundColor" } });
  });
  await spreadsheetBatchUpdate(id, reqs).catch(async () => {
    await spreadsheetBatchUpdate(id, reqs.filter((r) => !r.setBasicFilter)).catch(() => {});
  });

  /* ---- CVR Log + geheugen ---- */
  const runDate = todayIso();
  let logged = 0;
  let logErr = "";
  try {
    await ensureLogTab(id);
    const logRows = items.map((it) => {
      const m = it.m || {};
      const a = it.ai || {};
      return [runDate, title, it.title, it.productId, a.verdict || "", a.cause || "", a.prio ?? "", m.spend14 ?? "", m.clicks14 ?? "", m.orders14 ?? "", m.roas14 ?? "", "", "", "", "", ""];
    });
    await appendRows(id, `${a1Tab(CVR_LOG_TAB)}!A:P`, logRows, "RAW");
    logged = logRows.length;
  } catch (e) {
    logErr = String((e && e.message) || e).slice(0, 160);
  }

  let state = { runs: [] };
  let stateErr = "";
  try {
    state = await loadState(domain);
    state.runs = state.runs.filter((r) => !(r.tab === title && r.sheetId === id));
    state.runs.push({
      tab: title,
      sheetId: id,
      tabId,
      url: sheetUrl(id, tabId),
      date: run.date || (run.period && run.period.to) || runDate,
      createdAt: new Date().toISOString(),
      doneAt: null,
      hidden: false,
      windowDays: S.windowDays || 14,
      products: items.map((it) => ({
        id: String(it.productId), title: it.title, verdict: (it.ai && it.ai.verdict) || "", cause: (it.ai && it.ai.cause) || "", prio: (it.ai && it.ai.prio) || null,
        before: { spend14: it.m.spend14, clicks14: it.m.clicks14, orders14: it.m.orders14, roas14: it.m.roas14, spend30: it.m.spend30, orders30: it.m.orders30, roas30: it.m.roas30 },
        after: null, effect: null,
      })),
    });
    if (state.runs.length > 60) state.runs = state.runs.slice(-60);
    await saveState(domain, state);
    try {
      await syncEffectsToLog(id, state, domain);
    } catch {}
  } catch (e) {
    stateErr = String((e && e.message) || e).slice(0, 160);
  }

  const text = buildClaudeText({ ...run, tab: title, items });
  return { ok: true, tab: title, tabId, replaced, rows: rows.length, url: sheetUrl(id, tabId), logged, logErr, stateErr, text };
}

/* ======================================================================
   7. KLAAR / TONEN / HEROPENEN / LIJST
   ====================================================================== */

async function setHidden(run, hidden) {
  const id = run.sheetId;
  let tabId = run.tabId;
  const req = (tid) => spreadsheetBatchUpdate(id, [{ updateSheetProperties: { properties: { sheetId: Number(tid), hidden: !!hidden }, fields: "hidden" } }]);
  try {
    await req(tabId);
  } catch (e) {
    // blad verwijderd/hernoemd? op naam opnieuw proberen
    const byTitle = await getTabIdByTitle(id, run.tab).catch(() => null);
    if (byTitle === null) throw httpErr(422, `Blad "${run.tab}" niet gevonden in de sheet (${String((e && e.message) || e).slice(0, 100)})`);
    tabId = byTitle;
    run.tabId = byTitle;
    await req(tabId);
  }
}

async function setStatusCells(run, status, dateIso) {
  try {
    const n = (run.products || []).length;
    if (!n) return;
    const L = colLetter(STATUS_COL);
    const R = colLetter(STATUS_COL + 1);
    await updateValues(run.sheetId, `${a1Tab(run.tab)}!${L}2:${R}${n + 1}`, Array.from({ length: n }, () => [status, dateIso || ""]));
  } catch {}
}

function findRun(state, tab) {
  const t = String(tab || "").trim();
  for (let i = state.runs.length - 1; i >= 0; i--) if (state.runs[i].tab === t) return state.runs[i];
  return null;
}

export async function cvrBoostDone({ store, tab }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const domain = cleanDomain(store.domain);
  const state = await loadState(domain);
  const run = findRun(state, tab);
  if (!run) throw httpErr(404, `Boost "${tab}" niet gevonden in het geheugen`);
  await setHidden(run, true);
  run.doneAt = run.doneAt || new Date().toISOString();
  run.hidden = true;
  await saveState(domain, state);
  await setStatusCells(run, "klaar", String(run.doneAt).slice(0, 10));
  return { ok: true, run: runSummary(run) };
}

export async function cvrBoostShow({ store, tab, hidden }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const domain = cleanDomain(store.domain);
  const state = await loadState(domain);
  const run = findRun(state, tab);
  if (!run) throw httpErr(404, `Boost "${tab}" niet gevonden in het geheugen`);
  await setHidden(run, !!hidden);
  run.hidden = !!hidden;
  await saveState(domain, state);
  return { ok: true, run: runSummary(run) };
}

export async function cvrBoostReopen({ store, tab }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const domain = cleanDomain(store.domain);
  const state = await loadState(domain);
  const run = findRun(state, tab);
  if (!run) throw httpErr(404, `Boost "${tab}" niet gevonden in het geheugen`);
  await setHidden(run, false);
  run.hidden = false;
  run.doneAt = null;
  for (const pr of run.products || []) {
    pr.after = null;
    pr.effect = null;
    pr.effectAt = null;
    pr.logged = false;
  }
  await saveState(domain, state);
  await setStatusCells(run, "open", "");
  return { ok: true, run: runSummary(run) };
}

export async function cvrBoostList({ store }) {
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const state = await loadState(cleanDomain(store.domain));
  return { ok: true, runs: state.runs.map((r) => runSummary(r)).reverse().slice(0, 30) };
}
