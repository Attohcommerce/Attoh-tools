// COMPETITOR FINDER — cloud-run (03-11-2026). Zelfde opzet als de Size
// Guide-job: toestand in Redis (cf:job:v1, één scan tegelijk), elke tick
// ±44 s werk, daarna state opslaan en zichzelf opnieuw aanroepen via
// /api/competitor-finder/tick (met geheim). Valt de keten stil (deploy,
// crash), dan pakt de status-poll van de UI 'm weer op.
//
// Fases (v4, 04-11: Apify ASYNCHROON — run-sync brak af na 1 zoekopdracht
// omdat Apify ±20 s nodig heeft om op te starten):
//   search  — bij de start één Apify-run per markt met álle zoekopdrachten,
//             alle markten tegelijk; elke tick pollt de runs en verwerkt de
//             klare datasets (domeinen eruit, bekend/uitgesloten overslaan,
//             nieuw → kandidaten); zolang runs draaien worden intussen de al
//             gevonden kandidaten gecheckt
//   resolve — merchantnamen zonder link: één run per markt ("<naam> webshop")
//   audit   — resterende kandidaten 8 tegelijk door de dropship-score
//   done
import { getJSON, setJSON, acquire, release, finderRedisAvailable } from "./finder-redis.js";
import { startSearchRun, planSearchRuns, parseSearchItems, apifyRunInfo, apifyDatasetItems, getMarketQueries, knownDomains, isExcludedDomain, getSeen, markSeen, getConfig, apifyConfigured, ownStoreSet } from "./competitor-finder.js";
import { readSheetStores, ensurePool, takeQueries, seedQueries, getLearned, addLearned, combinedTitles } from "./finder-pool.js";
import { auditDropship } from "./dropship-score.js";
import { marketByKey } from "./finder-markets.js";

const JOB_KEY = "cf:job:v1";
const LOCK_KEY = "cf:job:lock";
const LAST_KEY = "cf:last:v1"; // laatste resultaten, blijft staan na afloop
const HIST_KEY = "cf:hist:v1"; // laatste 30 scans (datum, markten, tellers)
const JOB_TTL = 60 * 60 * 24 * 3;
const LAST_TTL = 60 * 60 * 24 * 60;
const LOCK_TTL = 75;
const TICK_BUDGET_MS = 44000;
const ROUND_MIN_MS = 14000;
const STALE_MS = 150000;
const POLL_WAIT_MS = 7000; // wachten tussen twee status-checks als er niets anders te doen is
const AUDIT_PAR = 8;
const MAX_CANDIDATES = 1500;

export function jobSecret() {
  return process.env.CF_JOB_SECRET || process.env.SG_JOB_SECRET || process.env.SESSION_SECRET || "dev-only-secret-change-me-in-vercel-env-1234567890";
}
export function jobAvailable() {
  return finderRedisAvailable();
}

export async function getJob() {
  return getJSON(JOB_KEY);
}
async function saveJob(job) {
  job.updatedAt = Date.now();
  await setJSON(JOB_KEY, job, JOB_TTL);
}
function pushLog(job, text, cls) {
  job.log.push({ t: Date.now(), text: String(text).slice(0, 400), cls: cls || "" });
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
}

/** Runs per markt+soort samenvatten voor de UI: { market, kind, status, total, done, failed, count, startedAt, error } */
function summarizeRuns(runs) {
  const by = {};
  for (const r of runs || []) {
    const k = `${r.kind}|${r.market}`;
    const a = (by[k] = by[k] || { market: r.market, kind: r.kind, total: 0, done: 0, failed: 0, count: 0, startedAt: r.startedAt, error: "" });
    a.total++;
    a.count += r.count || 0;
    if (r.done) a.done++;
    if (r.done && r.error) {
      a.failed++;
      a.error = r.error;
    }
    if (r.startedAt && r.startedAt < a.startedAt) a.startedAt = r.startedAt;
  }
  return Object.values(by).map((a) => ({ ...a, status: a.done < a.total ? "bezig" : a.failed === a.total ? "fout" : "klaar" }));
}

export function publicJob(job) {
  if (!job) return null;
  const { results, hits, candidates, queries, names, nameQueries, knownMap, runs, ...rest } = job;
  const list = Object.values(results || {}).sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    ...rest,
    runs: summarizeRuns(runs),
    totalQueries: (queries || []).length,
    totalNames: (nameQueries || []).length,
    totalCandidates: (candidates || []).length,
    results: list,
    stale: job.status === "running" && Date.now() - (job.lastTickAt || job.startedAt) > STALE_MS,
  };
}

export async function getLastResults() {
  return (await getJSON(LAST_KEY)) || null;
}

/** Resultaten in de lopende job én in "laatste scan" bijwerken (toegevoegd /
 *  genegeerd / bezoek ingevuld) zonder de rest van de job aan te raken. */
export async function patchResults(fn) {
  const job = await getJob();
  if (job && job.results) {
    fn(job.results);
    await saveJob(job);
  }
  const last = await getJSON(LAST_KEY);
  if (last && Array.isArray(last.results)) {
    const map = Object.fromEntries(last.results.map((r) => [r.domain, r]));
    fn(map);
    last.results = Object.values(map);
    await setJSON(LAST_KEY, last, LAST_TTL);
  }
}

/**
 * startJob({ markets, pages, aliCheck, sheet:{sheetId, tab}, baseUrl })
 */
export async function startJob(opts) {
  if (!apifyConfigured()) return { ok: false, error: "APIFY_TOKEN ontbreekt (Vercel → Environment Variables)" };
  const existing = await getJob();
  if (existing && existing.status === "running" && Date.now() - (existing.lastTickAt || existing.startedAt) < STALE_MS) {
    return { ok: false, error: "Er draait al een scan — stop die eerst of wacht tot hij klaar is." };
  }
  const cfg = await getConfig();
  const markets = (opts.markets || []).map((k) => marketByKey(k)).filter(Boolean);
  if (!markets.length) return { ok: false, error: "Geen markt gekozen" };
  const sheet = { sheetId: (opts.sheet && opts.sheet.sheetId) || cfg.sheetId, tab: (opts.sheet && opts.sheet.tab) || cfg.sheetTab };

  // Zoekopdrachten per markt: handmatige set als die er is, anders de pool
  // (titels van de beste sheet-stores + startset). De pool wordt hier
  // gebouwd/ververst als hij ontbreekt of ouder is dan 7 dagen — alle
  // markten tegelijk, met korte timeouts, zodat de start binnen de tijd blijft.
  const perMarket = Math.max(5, Math.min(300, Number(opts.queriesPerMarket) || cfg.queriesPerMarket || 60));
  let sheetStores = [];
  try {
    sheetStores = await readSheetStores(sheet.sheetId);
  } catch (e) {
    sheetStores = [];
  }
  const poolInfo = {};
  const picked = await Promise.all(
    markets.map(async (m) => {
      const manual = await getMarketQueries(m.key);
      if (manual.override) {
        poolInfo[m.key] = { source: "handmatig", count: manual.queries.length };
        return { m, list: await takeQueries(m.key, { titles: manual.queries }, perMarket) };
      }
      let pool = null;
      try {
        pool = await ensurePool(m.key, { sheetStores });
      } catch (e) {
        pool = null;
      }
      if (!pool || !pool.titles || !pool.titles.length) {
        const seed = seedQueries(m.key);
        poolInfo[m.key] = { source: "startset", count: seed.length };
        return { m, list: await takeQueries(m.key, { titles: seed }, perMarket) };
      }
      const learned = await getLearned(m.key);
      const all = combinedTitles(pool, learned);
      poolInfo[m.key] = { source: pool.source, count: all.length, learned: learned.titles.length, stores: (pool.stores || []).map((s) => s.domain), fresh: !!pool.fresh };
      return { m, list: await takeQueries(m.key, { titles: all }, perMarket) };
    })
  );
  const queries = [];
  for (const { m, list } of picked) for (const term of list) queries.push({ market: m.key, q: term });
  if (!queries.length) return { ok: false, error: "Geen zoekopdrachten gevonden — staat je competitor-sheet goed ingesteld?" };

  // wat we al kennen (sheet + lijst + al gezien) — één keer bij de start
  let known;
  try {
    known = await knownDomains(sheet.sheetId, sheet.tab);
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }

  const job = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    status: "running", // running | done | stopped | error
    phase: "search", // search | audit | done
    error: null,
    stopRequested: false,
    markets: markets.map((m) => m.key),
    pages: Math.max(1, Math.min(3, Number(opts.pages) || cfg.pages || 1)),
    aliCheck: opts.aliCheck !== undefined ? !!opts.aliCheck : !!cfg.aliCheck,
    minVisits: cfg.minVisits,
    sheet,
    baseUrl: String(opts.baseUrl || "").replace(/\/$/, ""),
    label: opts.label || "Scan",
    ownStores: [...ownStoreSet(cfg)],
    queries,
    qCursor: 0,
    runs: [], // Apify-runs: [{ kind: search|resolve, market, runId, datasetId, count, queries?, status, startedAt, done, error }]
    names: {}, // markt → { merchantnaam: aantal } (gesponsorde producten zonder bruikbare link)
    nameQueries: [], // [{market, name}] — fase "resolve"
    nCursor: 0,
    hits: {}, // domein → { markets: [], via: [{market, query, source}], merchant }
    candidates: [],
    aCursor: 0,
    results: {}, // domein → resultaat (UI)
    knownCount: known.size,
    knownMap: Object.fromEntries([...known].filter(([, src]) => src === "sheet" || src === "lijst")),
    prog: { queries: 0, pages: 0, found: 0, excluded: 0, own: 0, known: 0, earlier: 0, candidates: 0, audited: 0, dropship: 0, twijfel: 0, merk: 0, nonShopify: 0, unresolved: 0, resolved: 0, learned: 0, apifyErrors: 0 },
    log: [],
    startedAt: Date.now(),
    lastTickAt: 0,
    finishedAt: 0,
    ticks: 0,
  };
  job.poolInfo = poolInfo;
  pushLog(job, `${job.label}: ${markets.map((m) => m.label).join(", ")} · ${queries.length} zoekopdrachten (${perMarket} per markt, roterend) · ${job.pages} pagina('s) per zoekopdracht · AliExpress-check ${job.aliCheck ? "aan" : "uit"} · ${known.size} bekende winkels overgeslagen`, "muted");
  for (const m of markets) {
    const pi = poolInfo[m.key] || {};
    pushLog(job, `${m.label}: ${pi.count || 0} zoekopdrachten in de pool (${pi.source}${pi.stores && pi.stores.length ? ` · uit ${pi.stores.join(", ")}` : ""}${pi.learned ? ` · ${pi.learned} geleerd van gevonden stores` : ""}${pi.fresh ? " · zojuist ververst" : ""})`, "muted");
  }
  // Meerdere Apify-runs per markt, allemaal tegelijk gestart (antwoordt meteen)
  const byMarket = {};
  for (const q of queries) (byMarket[q.market] = byMarket[q.market] || []).push(q.q);
  const fatal = await startSearchRuns(job, byMarket);
  if (fatal) {
    job.status = "error";
    job.error = fatal;
  }
  await saveJob(job);
  if (job.status === "error") return { ok: false, error: fatal };
  return { ok: true, job: publicJob(job) };
}

export async function stopJob() {
  const job = await getJob();
  if (!job) return { ok: false, error: "geen scan gevonden" };
  if (job.status === "running") {
    job.stopRequested = true;
    pushLog(job, "Stop gevraagd — stopt na de huidige ronde.", "warn");
    await saveJob(job);
  }
  return { ok: true, job: publicJob(job) };
}

export async function resumeJob() {
  const job = await getJob();
  if (!job) return { ok: false, error: "geen scan gevonden" };
  if (job.status === "done") return { ok: false, error: "deze scan is al klaar" };
  job.status = "running";
  job.stopRequested = false;
  job.error = null;
  pushLog(job, "Hervat.", "muted");
  await saveJob(job);
  return { ok: true, job: publicJob(job) };
}

/** Volgende tick starten (fire-and-forget). */
export async function kickTick(job) {
  if (!job || !job.baseUrl) return false;
  try {
    const res = await fetch(`${job.baseUrl}/api/competitor-finder/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cf-job-secret": jobSecret() },
      body: JSON.stringify({ id: job.id }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (e) {
    console.error("kickTick (finder):", e.message);
    return false;
  }
}

export async function jobStatus({ autoResume = true } = {}) {
  const job = await getJob();
  if (!job) return { ok: true, job: null, last: await getLastResults() };
  let kicked = false;
  if (autoResume && job.status === "running" && Date.now() - (job.lastTickAt || job.startedAt) > STALE_MS) {
    kicked = await kickTick(job);
  }
  return { ok: true, job: publicJob(job), kicked };
}

/* ---------------- de tick ---------------- */

async function finish(job) {
  job.status = "done";
  job.phase = "done";
  job.finishedAt = Date.now();
  const p = job.prog;
  pushLog(job, `Klaar: ${p.found} domeinen gezien · ${p.excluded} merken/marketplaces · ${p.own} eigen stores · ${p.known} al bekend · ${p.candidates} nieuw gecheckt → ${p.dropship} dropship · ${p.twijfel} twijfel · ${p.merk} merk/retailer · ${p.nonShopify} geen Shopify${p.earlier ? ` · ${p.earlier} eerder gevonden` : ""}${p.resolved ? ` · ${p.resolved} merchantnamen opgelost` : ""}${p.learned ? ` · ${p.learned} titels geleerd voor volgende scans` : ""}`, "ok");
  await setJSON(LAST_KEY, { at: Date.now(), markets: job.markets, prog: job.prog, results: Object.values(job.results) }, LAST_TTL);
  try {
    const hist = (await getJSON(HIST_KEY)) || [];
    hist.unshift({ at: Date.now(), label: job.label, markets: job.markets, prog: job.prog, minutes: Math.round((Date.now() - job.startedAt) / 60000) });
    await setJSON(HIST_KEY, hist.slice(0, 30));
  } catch {}
}

export async function getHistory() {
  return (await getJSON(HIST_KEY)) || [];
}

/** Hits van één markt verwerken (dedupe, uitsluiten, bekend, kandidaten). */
function processSearchHits(job, m, r) {
  const seen = job._seen || {};
  let fresh = 0;
  let earlier = 0;
  for (const h of r.hits) {
    const d = h.domain;
    if (!d) continue;
    if (job.hits[d]) {
      const rec = job.hits[d];
      if (!rec.markets.includes(m.key)) rec.markets.push(m.key);
      if (rec.via.length < 6 && !rec.via.some((v) => v.query === h.query && v.market === m.key)) rec.via.push({ market: m.key, query: h.query, source: h.source });
      if (job.results[d]) {
        job.results[d].markets = rec.markets;
        job.results[d].via = rec.via;
      }
      continue;
    }
    job.prog.found++;
    if ((job.ownStores || []).includes(d)) {
      job.prog.own++;
      job.hits[d] = { markets: [m.key], via: [], merchant: h.merchant, skip: "eigen store" };
      continue;
    }
    if (isExcludedDomain(d)) {
      job.prog.excluded++;
      job.hits[d] = { markets: [m.key], via: [], merchant: h.merchant, skip: "uitgesloten" };
      continue;
    }
    const k = job.knownMap && job.knownMap[d];
    const s = seen[d];
    if (k === "sheet" || k === "lijst" || (s && s.ignored) || (s && s.added)) {
      job.prog.known++;
      job.hits[d] = { markets: [m.key], via: [], merchant: h.merchant, skip: k || "genegeerd" };
      continue;
    }
    const rec = { markets: [m.key], via: [{ market: m.key, query: h.query, source: h.source }], merchant: h.merchant };
    job.hits[d] = rec;
    if (s && (s.verdict === "dropship" || s.verdict === "twijfel") && s.audit) {
      earlier++;
      job.prog.earlier++;
      job.results[d] = { ...s.audit, domain: d, markets: rec.markets, via: rec.via, merchant: rec.merchant, earlier: true, visits: s.visits || null };
      continue;
    }
    if (s && !s.audit) {
      job.prog.known++;
      rec.skip = "eerder: " + (s.verdict || "geen Shopify");
      continue;
    }
    if (job.candidates.length < MAX_CANDIDATES) {
      job.candidates.push(d);
      job.prog.candidates++;
      fresh++;
    }
  }
  if (Array.isArray(r.unresolvedNames) && r.unresolvedNames.length) {
    job.names[m.key] = job.names[m.key] || {};
    for (const [name, n] of r.unresolvedNames) job.names[m.key][name] = (job.names[m.key][name] || 0) + n;
  }
  job.prog.pages += r.pages || 0;
  job.prog.unresolved += r.unresolved || 0;
  const prodHits = r.hits.filter((x) => x.source === "product").length;
  return { fresh, earlier, prodHits };
}

/** Zoekopdrachten per markt verdelen over parallelle Apify-runs en die allemaal tegelijk starten. → fatale fout of "" */
async function startSearchRuns(job, perMarket) {
  const plan = planSearchRuns(perMarket);
  const starts = await Promise.all(plan.map(async (p) => ({ p, r: await startSearchRun(p.market, p.queries, { pages: job.pages, memory: p.memory }) })));
  let fatal = "";
  const perMarketLog = {};
  for (const { p, r } of starts) {
    const m = marketByKey(p.market);
    const lg = (perMarketLog[p.market] = perMarketLog[p.market] || { label: m ? m.label : p.market, ok: 0, queries: 0, failed: 0, memory: 0, err: "" });
    if (!r.ok) {
      job.prog.apifyErrors++;
      job.qCursor += p.queries.length;
      lg.failed++;
      lg.err = r.error;
      if (r.fatal) fatal = r.error;
      job.runs.push({ kind: "search", market: p.market, runId: null, count: p.queries.length, status: "fout", startedAt: Date.now(), done: true, error: r.error });
      continue;
    }
    lg.ok++;
    lg.queries += r.count;
    lg.memory = r.memory || p.memory;
    job.runs.push({ kind: "search", market: p.market, runId: r.runId, datasetId: r.datasetId || null, count: r.count, status: "gestart", startedAt: Date.now(), done: false, error: "" });
  }
  for (const lg of Object.values(perMarketLog)) {
    if (lg.ok) pushLog(job, `${lg.label}: ${lg.ok} Apify-run${lg.ok > 1 ? "s" : ""} gestart met ${lg.queries} zoekopdrachten (${Math.round(lg.memory / 1024)} GB, 20 parallel per run)`, "muted");
    if (lg.failed) pushLog(job, `${lg.label}: ${lg.failed} Apify-run${lg.failed > 1 ? "s" : ""} starten mislukt — ${lg.err}`, "err");
  }
  return fatal;
}

/** Status van alle lopende Apify-runs checken; klare datasets verwerken. → aantal nog lopend */
async function pollRuns(job, kind) {
  let pending = 0;
  job._seen = await getSeen();
  const open = job.runs.filter((r) => r.kind === kind && !r.done && r.runId);
  const infos = await Promise.all(open.map((r) => apifyRunInfo(r.runId).catch((e) => ({ ok: false, error: String(e) }))));
  for (let i = 0; i < open.length; i++) {
    const run = open[i];
    const m = marketByKey(run.market);
    const info = infos[i];
    if (!info.ok) {
      pending++;
      continue; // tijdelijke API-hik: volgende tick opnieuw
    }
    run.status = info.status;
    if (info.status === "SUCCEEDED") {
      const ds = await apifyDatasetItems(info.datasetId || run.datasetId, { limit: 2000 });
      if (!ds.ok) {
        pending++;
        continue;
      }
      run.done = true;
      const parsed = parseSearchItems(ds.items);
      if (kind === "search") {
        const r = processSearchHits(job, m, parsed);
        job.qCursor += run.count;
        job.prog.queries += run.count;
        pushLog(job, `${m.label}: klaar — ${run.count} zoekopdrachten → ${parsed.hits.length} resultaten (${r.prodHits} gesponsorde producten) · ${r.fresh} nieuwe winkels${r.earlier ? ` · ${r.earlier} eerder gevonden` : ""}${parsed.unresolved ? ` · ${parsed.unresolved} zonder domein` : ""} · ${Math.round((Date.now() - run.startedAt) / 1000)} s`, r.fresh ? "ok" : "muted");
      } else {
        const resolved = processResolveHits(job, m, run, parsed);
        job.nCursor += run.count;
        pushLog(job, `${m.label}: ${run.count} merchantnamen opgezocht → ${resolved} nieuwe winkels`, resolved ? "" : "muted");
      }
    } else if (["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT", "ABORTING"].includes(info.status)) {
      run.done = true;
      run.error = `${info.status}${info.statusMessage ? ` — ${info.statusMessage}` : ""}`;
      job.prog.apifyErrors++;
      if (kind === "search") job.qCursor += run.count;
      else job.nCursor += run.count;
      pushLog(job, `${m.label}: Apify-run ${info.status.toLowerCase()} — ${info.statusMessage || "geen details"} (run ${run.runId})`, "err");
    } else {
      pending++; // READY / RUNNING
    }
  }
  delete job._seen;
  return pending;
}

/** Hits van een resolve-run: per merchantnaam het eerste organische domein dat niet uitgesloten/bekend is. */
function processResolveHits(job, m, run, parsed) {
  const byQuery = new Map();
  for (const h of parsed.hits) {
    if (h.source !== "organic") continue;
    if (!byQuery.has(h.query)) byQuery.set(h.query, []);
    byQuery.get(h.query).push(h);
  }
  let resolved = 0;
  for (const name of run.queries || []) {
    const q = `${name} webshop`;
    const cands = byQuery.get(q) || [];
    const hit = cands.find((h) => !isExcludedDomain(h.domain) && !(job.ownStores || []).includes(h.domain));
    if (!hit) continue;
    const d = hit.domain;
    if (job.hits[d] || (job.knownMap && job.knownMap[d])) continue;
    job.hits[d] = { markets: [m.key], via: [{ market: m.key, query: name, source: "merchant" }], merchant: name };
    if (job.candidates.length < MAX_CANDIDATES) {
      job.candidates.push(d);
      job.prog.candidates++;
      resolved++;
    }
  }
  job.prog.resolved += resolved;
  return resolved;
}

async function startResolveRuns(job) {
  const perMarket = {};
  for (const nq of job.nameQueries) (perMarket[nq.market] = perMarket[nq.market] || []).push(nq.name);
  for (const [mk, names] of Object.entries(perMarket)) {
    const m = marketByKey(mk);
    const r = await startSearchRun(mk, names.map((n) => `${n} webshop`), { pages: 1 });
    if (!r.ok) {
      job.prog.apifyErrors++;
      job.nCursor += names.length;
      pushLog(job, `${m.label}: merchantnamen-run starten mislukt — ${r.error}`, "warn");
      continue;
    }
    job.runs.push({ kind: "resolve", market: mk, runId: r.runId, datasetId: r.datasetId || null, count: names.length, queries: names, status: "gestart", startedAt: Date.now(), done: false, error: "" });
  }
}

/* Fase "resolve": merchantnamen uit de gesponsorde producten waarvan Google
   alleen een redirect gaf → één zoekopdracht per naam ("Fresh Label Amsterdam
   webshop") → eerste organische domein dat geen merk/marketplace is. */
function buildNameQueries(job) {
  const out = [];
  for (const [mk, names] of Object.entries(job.names || {})) {
    const sorted = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 40);
    for (const [name] of sorted) out.push({ market: mk, name });
  }
  return out;
}

async function auditStep(job, started) {
  const slice = job.candidates.slice(job.aCursor, job.aCursor + AUDIT_PAR);
  const deadline = Math.min(started + TICK_BUDGET_MS, Date.now() + 34000);
  const settled = await Promise.allSettled(slice.map((d) => auditDropship(d, { aliCheck: job.aliCheck, deadline })));
  const seenPatch = {};
  const learnQueue = [];
  slice.forEach((d, i) => {
    const r = settled[i];
    const rec = job.hits[d] || { markets: [], via: [], merchant: "" };
    job.prog.audited++;
    if (r.status !== "fulfilled") {
      job.prog.nonShopify++;
      seenPatch[d] = { verdict: "fout", note: String((r.reason && r.reason.message) || r.reason || "fout").slice(0, 120) };
      return;
    }
    const a = r.value;
    if (!a.ok || !a.shopify) {
      job.prog.nonShopify++;
      seenPatch[d] = { verdict: "geen-shopify", note: a.note };
      return;
    }
    const res = {
      domain: d, markets: rec.markets, via: rec.via, merchant: rec.merchant,
      score: a.score, verdict: a.verdict, products: a.products, productsPlus: a.productsPlus,
      signals: a.signals, negatives: a.negatives, theme: a.theme, ageMonths: a.ageMonths, vendorTop: a.vendorTop, vendors: a.vendors,
      images: a.images, ali: a.ali, note: a.note, visits: null,
    };
    job.results[d] = res;
    if (a.verdict === "dropship") {
      job.prog.dropship++;
      learnQueue.push({ markets: rec.markets, domain: d, titles: a.titles || [] });
    } else if (a.verdict === "twijfel") job.prog.twijfel++;
    else job.prog.merk++;
    // merk/retailer: onthouden zodat hij volgende week niet opnieuw gecheckt wordt;
    // dropship/twijfel: audit bewaren zodat hij volgende week meteen getoond wordt
    seenPatch[d] = a.verdict === "merk" ? { verdict: "merk", score: a.score } : { verdict: a.verdict, score: a.score, audit: res };
  });
  job.aCursor += slice.length;
  try {
    await markSeen(seenPatch);
  } catch (e) {
    pushLog(job, `"Al gezien" bijwerken mislukt: ${String(e.message || e).slice(0, 120)}`, "warn");
  }
  // zelflerend: titels van gevonden dropship-stores → zoekgeheugen van die markt(en)
  for (const l of learnQueue) {
    for (const mk of l.markets || []) {
      try {
        job.prog.learned += await addLearned(mk, l.domain, l.titles);
      } catch {}
    }
  }
  const line = slice.map((d) => {
    const x = job.results[d];
    return x ? `${d} ${x.score}` : `${d} ✗`;
  });
  pushLog(job, `Check: ${line.join(" · ")}`, "muted");
}

/**
 * tickJob(id) → { ok, job, chained }
 */
export async function tickJob(id) {
  const started = Date.now();
  const tickId = `${started.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  if (!(await acquire(LOCK_KEY, tickId, LOCK_TTL))) return { ok: true, busy: true };
  let job = null;
  let chained = false;
  try {
    job = await getJob();
    if (!job || job.status !== "running") return { ok: true, idle: true };
    if (id && job.id !== id) return { ok: true, idle: true };
    job.ticks++;
    job.lastTickAt = started;
    await saveJob(job);

    // Oude scan (van vóór v4, zonder Apify-runs) of ontbrekende velden na een
    // deploy: velden aanvullen en voor de resterende zoekopdrachten alsnog
    // per markt een run starten — zo werkt "Hervat" ook op een oude scan.
    for (const k of ["own", "resolved", "learned", "unresolved", "earlier", "apifyErrors"]) if (job.prog[k] == null) job.prog[k] = 0;
    job.names = job.names || {};
    job.nameQueries = Array.isArray(job.nameQueries) ? job.nameQueries : [];
    job.nCursor = job.nCursor || 0;
    job.ownStores = Array.isArray(job.ownStores) ? job.ownStores : [];
    if (!Array.isArray(job.runs)) {
      job.runs = [];
      if (job.phase === "search") {
        const remaining = (job.queries || []).slice(job.qCursor || 0);
        const perMarket = {};
        for (const q of remaining) (perMarket[q.market] = perMarket[q.market] || []).push(q.q);
        pushLog(job, `Oude scan voortgezet met de nieuwe methode (${remaining.length} resterende zoekopdrachten)`, "muted");
        const fatal = await startSearchRuns(job, perMarket);
        if (fatal) {
          job.status = "error";
          job.error = fatal;
        }
      }
      await saveJob(job);
      if (job.status !== "running") return { ok: true, job: publicJob(job) };
    }

    // bekende winkels (sheet + lijst) per tick opnieuw ophalen is te duur →
    // één keer per job in Redis naast de job bewaren
    if (!job.knownMap) {
      try {
        const known = await knownDomains(job.sheet.sheetId, job.sheet.tab);
        job.knownMap = {};
        for (const [d, src] of known) if (src === "sheet" || src === "lijst") job.knownMap[d] = src;
      } catch (e) {
        pushLog(job, `Sheet lezen mislukt (${String(e.message || e).slice(0, 120)}) — dedupe alleen op Redis-lijst`, "warn");
        job.knownMap = {};
      }
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    while (!job.stopRequested && job.status === "running") {
      if (Date.now() - started > TICK_BUDGET_MS - ROUND_MIN_MS) break;
      if (job.phase === "search") {
        const pending = await pollRuns(job, "search");
        await saveJob(job);
        if (!pending) {
          job.nameQueries = buildNameQueries(job);
          job.nCursor = 0;
          if (job.nameQueries.length) {
            job.phase = "resolve";
            pushLog(job, `Zoeken klaar: ${job.candidates.length} nieuwe winkels · ${job.nameQueries.length} merchantnamen zonder link alsnog opzoeken`, "strong");
            await startResolveRuns(job);
          } else {
            job.phase = "audit";
            pushLog(job, `Zoeken klaar: ${job.candidates.length} nieuwe winkels checken`, "strong");
          }
          await saveJob(job);
          continue;
        }
        // intussen nuttig werk: al gevonden winkels checken
        if (job.aCursor < job.candidates.length) {
          await auditStep(job, started);
          await saveJob(job);
          continue;
        }
        if (Date.now() - started > TICK_BUDGET_MS - ROUND_MIN_MS - POLL_WAIT_MS) break;
        await sleep(POLL_WAIT_MS);
        continue;
      }
      if (job.phase === "resolve") {
        const pending = await pollRuns(job, "resolve");
        await saveJob(job);
        if (!pending) {
          job.phase = "audit";
          pushLog(job, `${job.candidates.length - job.aCursor} winkels nog te checken`, "strong");
          await saveJob(job);
          continue;
        }
        if (job.aCursor < job.candidates.length) {
          await auditStep(job, started);
          await saveJob(job);
          continue;
        }
        if (Date.now() - started > TICK_BUDGET_MS - ROUND_MIN_MS - POLL_WAIT_MS) break;
        await sleep(POLL_WAIT_MS);
        continue;
      }
      if (job.phase === "audit") {
        if (job.aCursor >= job.candidates.length) {
          await finish(job);
          await saveJob(job);
          break;
        }
        await auditStep(job, started);
        await saveJob(job);
        continue;
      }
      break;
    }

    if (job.stopRequested && job.status === "running") {
      job.status = "stopped";
      pushLog(job, "Gestopt.", "warn");
      await setJSON(LAST_KEY, { at: Date.now(), markets: job.markets, prog: job.prog, results: Object.values(job.results), partial: true }, LAST_TTL);
    }
    await saveJob(job);
    if (job.status === "running") chained = await kickTick(job);
    return { ok: true, job: publicJob(job), chained };
  } catch (e) {
    if (job) {
      job.status = "error";
      job.error = String(e.message || e).slice(0, 300);
      pushLog(job, `Fout: ${job.error}`, "err");
      await saveJob(job);
    }
    return { ok: false, error: String(e.message || e) };
  } finally {
    await release(LOCK_KEY, tickId);
  }
}
