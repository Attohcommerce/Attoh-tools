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
import { getJSON, setJSON, delKey, acquire, release, finderRedisAvailable } from "./finder-redis.js";
import { startSearchRun, planSearchRuns, parseSearchItems, startAdsRun, parseAdsItems, APIFY_MEM_BUDGET_MB, startVisitsRun, parseVisitsItems, applyVisitsData, apifyRunInfo, apifyDatasetItems, getMarketQueries, knownDomains, isExcludedDomain, getSeen, markSeen, getConfig, apifyConfigured, ownStoreSet } from "./competitor-finder.js";
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
const AUDIT_PAR = 16; // winkels tegelijk checken (schuivend: zodra er één klaar is, start de volgende)
const AUDIT_MAX_MS = 20000; // max per winkel
const MAX_CANDIDATES = 4000; // 24 markten × ±100 nieuwe winkels past hierin

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
    const kind = r.kind === "search" && r.src === "ads" ? "ads" : r.kind;
    const k = `${kind}|${r.market}`;
    const a = (by[k] = by[k] || { market: r.market, kind, total: 0, done: 0, failed: 0, count: 0, startedAt: r.startedAt, error: "" });
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
  const { results, hits, candidates, queries, names, nameQueries, knownMap, runs, queue, ...rest } = job;
  const list = Object.values(results || {}).sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    ...rest,
    runs: summarizeRuns(runs),
    queue: (queue || []).map((q) => ({ src: q.src, market: q.market, count: (q.queries || []).length })),
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
    phase: "search", // search | resolve | audit | visits | done
    error: null,
    stopRequested: false,
    markets: markets.map((m) => m.key),
    pages: Math.max(1, Math.min(3, Number(opts.pages) || cfg.pages || 1)),
    aliCheck: opts.aliCheck !== undefined ? !!opts.aliCheck : !!cfg.aliCheck,
    ads: opts.ads !== undefined ? !!opts.ads : cfg.adsSource !== false,
    adsQueries: Math.max(5, Math.min(300, Number(cfg.adsQueries) || 40)),
    adsPerQuery: Math.max(1, Math.min(40, Number(cfg.adsPerQuery) || 10)),
    adsDevice: cfg.adsDevice || "desktop",
    minVisits: cfg.minVisits,
    sheet,
    baseUrl: String(opts.baseUrl || "").replace(/\/$/, ""),
    label: opts.label || "Scan",
    ownStores: [...ownStoreSet(cfg)],
    queries,
    qCursor: 0,
    runs: [], // Apify-runs: [{ kind: search|resolve|visits, src: google|ads, market, runId, datasetId, count, memory, queries?, status, startedAt, done, error }]
    queue: [], // nog te starten runs (geheugenbudget van het Apify-plan): [{ src: google|ads, market, queries, memory, tries }]
    names: {}, // markt → { merchantnaam: aantal } (gesponsorde producten zonder bruikbare link)
    nameQueries: [], // [{market, name}] — fase "resolve"
    nCursor: 0,
    hits: {}, // domein → { markets: [], via: [{market, query, source}], merchant }
    candidates: [],
    aCursor: 0,
    results: {}, // domein → resultaat (UI)
    knownCount: known.size,
    knownMap: Object.fromEntries([...known].filter(([, src]) => src === "sheet" || src === "lijst")),
    prog: { queries: 0, pages: 0, ads: 0, found: 0, excluded: 0, own: 0, known: 0, earlier: 0, candidates: 0, audited: 0, dropship: 0, twijfel: 0, merk: 0, nonShopify: 0, unresolved: 0, resolved: 0, learned: 0, apifyErrors: 0 },
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
  pushLog(job, `Klaar: ${p.found} domeinen gezien${p.ads ? ` (${p.ads} gesponsorde producten)` : ""} · ${p.excluded} merken/marketplaces · ${p.own} eigen stores · ${p.known} al bekend · ${p.candidates} nieuw gecheckt → ${p.dropship} dropship · ${p.twijfel} twijfel · ${p.merk} merk/retailer · ${p.nonShopify} geen Shopify${p.earlier ? ` · ${p.earlier} eerder gevonden` : ""}${p.resolved ? ` · ${p.resolved} merchantnamen opgelost` : ""}${p.learned ? ` · ${p.learned} titels geleerd voor volgende scans` : ""}${p.visitsAbove != null ? ` · maandbezoek: ${p.visitsAbove} boven de grens, ${p.visitsBelow || 0} eronder` : ""}`, "ok");
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

/** Zoekopdrachten per markt in de wachtrij zetten (Google-runs + ads-runs) en starten wat in het geheugenbudget past. → fatale fout of "" */
async function startSearchRuns(job, perMarket) {
  job.queue = Array.isArray(job.queue) ? job.queue : [];
  for (const p of planSearchRuns(perMarket)) job.queue.push({ src: "google", market: p.market, queries: p.queries, memory: p.memory, tries: 0 });
  if (job.ads) {
    for (const [market, qs] of Object.entries(perMarket)) {
      if (!qs || !qs.length) continue;
      job.queue.push({ src: "ads", market, queries: qs.slice(0, job.adsQueries || 40), memory: 1024, tries: 0 });
    }
  }
  return startQueued(job);
}

/** Zoveel mogelijk runs uit de wachtrij starten binnen APIFY_MEM_BUDGET_MB (lopende runs tellen mee). → fatale fout of "" */
async function startQueued(job) {
  if (!Array.isArray(job.queue) || !job.queue.length) return "";
  let inUse = 0;
  for (const r of job.runs) if (!r.done) inUse += Number(r.memory) || 1024;
  const budget = Number(job.memBudget) || APIFY_MEM_BUDGET_MB; // memBudget = gemeten plan-limiet na een geheugenfout
  let fatal = "";
  const started = {};
  const keep = [];
  let limitHit = false;
  // eerst bepalen wat er in het budget past, dan alles tegelijk starten
  const batch = [];
  for (const item of job.queue) {
    if (inUse + item.memory > budget) {
      keep.push(item);
      continue;
    }
    inUse += item.memory;
    batch.push(item);
  }
  const results = await Promise.all(
    batch.map((item) =>
      (item.src === "ads"
        ? startAdsRun(item.market, item.queries, { maxAdsPerQuery: job.adsPerQuery, device: job.adsDevice })
        : startSearchRun(item.market, item.queries, { pages: job.pages, memory: item.memory })
      ).catch((e) => ({ ok: false, error: String(e.message || e) }))
    )
  );
  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    const r = results[i];
    const m = marketByKey(item.market);
    const label = m ? m.label : item.market;
    if (!r.ok) {
      inUse -= item.memory;
      if (r.fatal) {
        fatal = r.error;
        keep.push(item);
        continue;
      }
      if (/memory|limit|concurren|exceed/i.test(String(r.error || "")) && item.tries < 30) {
        // plan-limiet (geheugen/aantal runs): budget verlagen tot wat nu echt draait, later opnieuw proberen
        item.tries++;
        limitHit = true;
        if (item.tries === 1 && !job._limitLogged) {
          job._limitLogged = true;
          pushLog(job, `Apify-limiet bereikt (${String(r.error).slice(0, 90)}) — resterende runs starten zodra er ruimte is`, "warn");
        }
        keep.push(item);
        continue;
      }
      job.prog.apifyErrors++;
      if (item.src === "google") job.qCursor += item.queries.length;
      pushLog(job, `${label}: ${item.src === "ads" ? "ads-run" : "Apify-run"} starten mislukt — ${r.error}`, "err");
      continue;
    }
    job.runs.push({ kind: "search", src: item.src, market: item.market, runId: r.runId, datasetId: r.datasetId || null, count: r.count, memory: r.memory || item.memory, status: "gestart", startedAt: Date.now(), done: false, error: "" });
    const st = (started[item.market] = started[item.market] || { label, google: 0, gq: 0, ads: 0, aq: 0, memory: 0 });
    if (item.src === "ads") {
      st.ads++;
      st.aq += r.count;
    } else {
      st.google++;
      st.gq += r.count;
      st.memory = r.memory || item.memory;
    }
  }
  job.queue = keep;
  if (limitHit) {
    let running = 0;
    for (const r of job.runs) if (!r.done) running += Number(r.memory) || 1024;
    job.memBudget = Math.max(1024, running);
  }
  for (const st of Object.values(started)) {
    const parts = [];
    if (st.google) parts.push(`${st.google} Google-run${st.google > 1 ? "s" : ""} · ${st.gq} zoekopdrachten · ${Math.round(st.memory / 1024)} GB`);
    if (st.ads) parts.push(`gesponsorde producten · ${st.aq} zoekopdrachten`);
    pushLog(job, `${st.label}: gestart — ${parts.join(" · ")}`, "muted");
  }
  if (job.queue.length && batch.length) pushLog(job, `${job.queue.length} run(s) wachten op ruimte in het Apify-plan`, "muted");
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
      if (kind === "visits") {
        await applyVisits(job, run, ds.items);
        continue;
      }
      const parsed = run.src === "ads" ? parseAdsItems(ds.items) : parseSearchItems(ds.items);
      if (kind === "search" && run.src === "ads") {
        const r = processSearchHits(job, m, parsed);
        job.prog.ads += parsed.ads || 0;
        pushLog(job, `${m.label}: gesponsorde producten klaar — ${parsed.ads || 0} advertenties → ${parsed.hits.length} met domein · ${r.fresh} nieuwe winkels${r.earlier ? ` · ${r.earlier} eerder gevonden` : ""}${parsed.unresolved ? ` · ${parsed.unresolved} alleen merchantnaam (worden opgezocht)` : ""} · ${Math.round((Date.now() - run.startedAt) / 1000)} s`, r.fresh ? "ok" : "muted");
      } else if (kind === "search") {
        const r = processSearchHits(job, m, parsed);
        job.qCursor += run.count;
        job.prog.queries += run.count;
        pushLog(job, `${m.label}: Google klaar — ${run.count} zoekopdrachten → ${parsed.hits.length} resultaten (${r.prodHits} gesponsorde producten) · ${r.fresh} nieuwe winkels${r.earlier ? ` · ${r.earlier} eerder gevonden` : ""}${parsed.unresolved ? ` · ${parsed.unresolved} zonder domein` : ""} · ${Math.round((Date.now() - run.startedAt) / 1000)} s`, r.fresh ? "ok" : "muted");
      } else {
        const resolved = processResolveHits(job, m, run, parsed);
        job.nCursor += run.count;
        pushLog(job, `${m.label}: ${run.count} merchantnamen opgezocht → ${resolved} nieuwe winkels`, resolved ? "" : "muted");
      }
    } else if (["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT", "ABORTING"].includes(info.status)) {
      run.done = true;
      run.error = `${info.status}${info.statusMessage ? ` — ${info.statusMessage}` : ""}`;
      job.prog.apifyErrors++;
      if (kind === "search" && run.src !== "ads") job.qCursor += run.count;
      else if (kind === "resolve") job.nCursor += run.count;
      pushLog(job, `${m ? m.label : "Maandbezoek"}: Apify-run ${info.status.toLowerCase()} — ${info.statusMessage || "geen details"} (run ${run.runId})`, "err");
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
  const tickDeadline = started + TICK_BUDGET_MS - 1500;
  const stopNewAt = tickDeadline - 11000; // geen nieuwe winkel meer starten als er < 11 s over is
  const seenPatch = {};
  const learnQueue = [];
  const line = [];
  const end = job.candidates.length;
  let next = job.aCursor;
  const handle = (d, r) => {
    const rec = job.hits[d] || { markets: [], via: [], merchant: "" };
    job.prog.audited++;
    if (r.status !== "fulfilled") {
      job.prog.nonShopify++;
      seenPatch[d] = { verdict: "fout", note: String((r.reason && r.reason.message) || r.reason || "fout").slice(0, 120) };
      line.push(`${d} ✗`);
      return;
    }
    const a = r.value;
    if (!a.ok || !a.shopify) {
      job.prog.nonShopify++;
      seenPatch[d] = { verdict: "geen-shopify", note: a.note };
      line.push(`${d} ✗`);
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
    line.push(`${d} ${a.score}`);
  };
  const worker = async () => {
    while (next < end && Date.now() < stopNewAt && !job.stopRequested) {
      const d = job.candidates[next++];
      const deadline = Math.min(tickDeadline, Date.now() + AUDIT_MAX_MS);
      let r;
      try {
        r = { status: "fulfilled", value: await auditDropship(d, { aliCheck: job.aliCheck, deadline }) };
      } catch (e) {
        r = { status: "rejected", reason: e };
      }
      handle(d, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(AUDIT_PAR, end - next)) }, worker));
  job.aCursor = next;
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
  if (line.length) pushLog(job, `Check: ${line.join(" · ")}`, "muted");
}

/* Fase "visits": maandbezoek (SimilarWeb via Apify) voor alle dropship- en
   twijfelwinkels zonder cijfer — één run, daarna klaar. */
async function startVisitsPhase(job) {
  const need = Object.values(job.results).filter((r) => (r.verdict === "dropship" || r.verdict === "twijfel") && (r.visits == null || r.visits === "")).map((r) => r.domain);
  if (!need.length) return false;
  const runs = [];
  for (let i = 0; i < need.length; i += 150) runs.push(need.slice(i, i + 150));
  let started = 0;
  for (const domains of runs) {
    const r = await startVisitsRun(domains);
    if (!r.ok) {
      job.prog.apifyErrors++;
      pushLog(job, `Maandbezoek ophalen mislukt — ${r.error}`, "warn");
      continue;
    }
    started++;
    job.runs.push({ kind: "visits", market: "alle", runId: r.runId, datasetId: r.datasetId || null, count: r.count, domains: r.domains, status: "gestart", startedAt: Date.now(), done: false, error: "" });
  }
  if (!started) return false;
  job.phase = "visits";
  pushLog(job, `Maandbezoek ophalen voor ${need.length} winkels (SimilarWeb via Apify)…`, "strong");
  return true;
}

/** Klare visits-run verwerken: cijfers in de resultaten + "al gezien" bijwerken. */
async function applyVisits(job, run, items) {
  const parsed = parseVisitsItems(items);
  const min = Number(job.minVisits) || 8000;
  const { patch, above, below, noData } = applyVisitsData(run.domains || [], parsed, { results: job.results, seen: job._seen || {}, min });
  try {
    await markSeen(patch);
  } catch {}
  job.prog.visitsAbove = (job.prog.visitsAbove || 0) + above;
  job.prog.visitsBelow = (job.prog.visitsBelow || 0) + below + noData;
  pushLog(job, `Maandbezoek: ${above} winkel${above === 1 ? "" : "s"} ≥ ${min.toLocaleString("nl-NL")} · ${below} eronder · ${noData} zonder SimilarWeb-data (= klein)`, above ? "ok" : "muted");
}

/* ---------- Los maandbezoek ophalen voor bestaande resultaten (knop in de UI) ---------- */
const VISITS_RUN_KEY = "cf:visitsrun:v1";

/** Start een SimilarWeb-run voor alle dropship/twijfel-resultaten (lopende job + laatste scan) zonder cijfer. */
export async function startVisitsFetch(opts = {}) {
  const existing = await getJSON(VISITS_RUN_KEY);
  if (existing && Date.now() - existing.at < 15 * 60000) return { ok: true, runId: existing.runId, count: existing.domains.length, already: true };
  const set = new Set();
  const want = (r) => r && (r.verdict === "dropship" || r.verdict === "twijfel") && !r.added && !r.ignored && (opts.force || r.visits == null || r.visits === "");
  const job = await getJob();
  if (job && job.results) for (const r of Object.values(job.results)) if (want(r)) set.add(r.domain);
  const last = await getJSON(LAST_KEY);
  if (last && Array.isArray(last.results)) for (const r of last.results) if (want(r)) set.add(r.domain);
  for (const d of opts.domains || []) if (d) set.add(d);
  const domains = [...set];
  if (!domains.length) return { ok: false, error: "Geen winkels zonder bezoekcijfer" };
  const r = await startVisitsRun(domains);
  if (!r.ok) return r;
  await setJSON(VISITS_RUN_KEY, { runId: r.runId, datasetId: r.datasetId || null, domains: r.domains, at: Date.now() }, 3600);
  return { ok: true, runId: r.runId, count: r.domains.length };
}

/** Status van de losse visits-run; bij klaar: cijfers toepassen op job + laatste scan + "al gezien". */
export async function visitsFetchStatus() {
  const cur = await getJSON(VISITS_RUN_KEY);
  if (!cur) return { ok: true, idle: true };
  const info = await apifyRunInfo(cur.runId);
  if (!info.ok) return { ok: true, running: true, elapsed: Date.now() - cur.at, note: info.error || "" };
  if (info.status === "SUCCEEDED") {
    const ds = await apifyDatasetItems(info.datasetId || cur.datasetId, { limit: 2000 });
    if (!ds.ok) return { ok: true, running: true, elapsed: Date.now() - cur.at, note: ds.error || "" };
    const parsed = parseVisitsItems(ds.items);
    const cfg = await getConfig();
    const min = Number(cfg.minVisits) || 8000;
    const seen = await getSeen();
    let counts = null;
    await patchResults((res) => {
      const c = applyVisitsData(cur.domains, parsed, { results: res, seen, min });
      if (!counts) counts = c;
    });
    if (!counts) counts = applyVisitsData(cur.domains, parsed, { results: {}, seen, min });
    try {
      await markSeen(counts.patch);
    } catch {}
    await delKey(VISITS_RUN_KEY);
    return { ok: true, done: true, count: cur.domains.length, above: counts.above, below: counts.below, noData: counts.noData, elapsed: Date.now() - cur.at };
  }
  if (["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT", "ABORTING"].includes(info.status)) {
    await delKey(VISITS_RUN_KEY);
    return { ok: false, error: `SimilarWeb-run ${info.status.toLowerCase()}${info.statusMessage ? ` — ${info.statusMessage}` : ""}` };
  }
  return { ok: true, running: true, elapsed: Date.now() - cur.at, status: info.status };
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
    job.queue = Array.isArray(job.queue) ? job.queue : [];
    if (job.prog.ads == null) job.prog.ads = 0;
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
        let pending = await pollRuns(job, "search");
        if (Array.isArray(job.queue) && job.queue.length) {
          const fatal = await startQueued(job);
          if (fatal) {
            job.status = "error";
            job.error = fatal;
            await saveJob(job);
            break;
          }
          pending += job.runs.filter((r) => r.kind === "search" && !r.done && r.startedAt > Date.now() - 2000).length; // net gestart
          if (job.queue.length) pending++;
        }
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
          const startedVisits = await startVisitsPhase(job);
          if (!startedVisits) {
            await finish(job);
            await saveJob(job);
            break;
          }
          await saveJob(job);
          continue;
        }
        await auditStep(job, started);
        await saveJob(job);
        continue;
      }
      if (job.phase === "visits") {
        const pending = await pollRuns(job, "visits");
        await saveJob(job);
        if (!pending) {
          await finish(job);
          await saveJob(job);
          break;
        }
        if (Date.now() - started > TICK_BUDGET_MS - ROUND_MIN_MS - POLL_WAIT_MS) break;
        await sleep(POLL_WAIT_MS);
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
