// COMPETITOR FINDER — cloud-run (03-11-2026). Zelfde opzet als de Size
// Guide-job: toestand in Redis (cf:job:v1, één scan tegelijk), elke tick
// ±44 s werk, daarna state opslaan en zichzelf opnieuw aanroepen via
// /api/competitor-finder/tick (met geheim). Valt de keten stil (deploy,
// crash), dan pakt de status-poll van de UI 'm weer op.
//
// Fases:
//   search  — per tick één markt-batch van ±6 zoekopdrachten naar Apify
//             (Google in dat land); alle domeinen eruit; bekend/uitgesloten
//             overslaan; nieuwe domeinen → kandidaten
//   audit   — kandidaten 4 tegelijk door de dropship-score
//   done
import { getJSON, setJSON, acquire, release, finderRedisAvailable } from "./finder-redis.js";
import { searchGoogle, getMarketQueries, knownDomains, isExcludedDomain, getSeen, markSeen, getConfig, apifyConfigured } from "./competitor-finder.js";
import { auditDropship } from "./dropship-score.js";
import { marketByKey } from "./finder-markets.js";

const JOB_KEY = "cf:job:v1";
const LOCK_KEY = "cf:job:lock";
const LAST_KEY = "cf:last:v1"; // laatste resultaten, blijft staan na afloop
const JOB_TTL = 60 * 60 * 24 * 3;
const LAST_TTL = 60 * 60 * 24 * 60;
const LOCK_TTL = 75;
const TICK_BUDGET_MS = 44000;
const ROUND_MIN_MS = 14000;
const STALE_MS = 150000;
const QUERIES_PER_CALL = 6; // ±6 zoekopdrachten per Apify-run past ruim in één tick
const AUDIT_PAR = 4;
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

export function publicJob(job) {
  if (!job) return null;
  const { results, hits, candidates, queries, ...rest } = job;
  const list = Object.values(results || {}).sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    ...rest,
    totalQueries: (queries || []).length,
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

  // zoekopdrachten per markt (Engels = standaard, anders de opgeslagen/AI-set)
  const queries = [];
  const missing = [];
  for (const m of markets) {
    const q = await getMarketQueries(m.key);
    if (!q.queries.length) {
      missing.push(m.label);
      continue;
    }
    const limit = Math.max(4, Math.min(200, Number(opts.queriesPerMarket) || q.queries.length));
    for (const term of q.queries.slice(0, limit)) queries.push({ market: m.key, q: term });
  }
  if (missing.length) return { ok: false, error: `Geen zoekopdrachten voor: ${missing.join(", ")} — klik eerst "AI lokaliseren" bij die markt(en).` };
  if (!queries.length) return { ok: false, error: "Geen zoekopdrachten" };

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
    queries,
    qCursor: 0,
    hits: {}, // domein → { markets: [], via: [{market, query, source}], merchant }
    candidates: [],
    aCursor: 0,
    results: {}, // domein → resultaat (UI)
    knownCount: known.size,
    knownMap: Object.fromEntries([...known].filter(([, src]) => src === "sheet" || src === "lijst")),
    prog: { queries: 0, pages: 0, found: 0, excluded: 0, known: 0, earlier: 0, candidates: 0, audited: 0, dropship: 0, twijfel: 0, merk: 0, nonShopify: 0, unresolved: 0, apifyErrors: 0 },
    log: [],
    startedAt: Date.now(),
    lastTickAt: 0,
    finishedAt: 0,
    ticks: 0,
  };
  pushLog(job, `${job.label}: ${markets.map((m) => m.label).join(", ")} · ${queries.length} zoekopdrachten · ${job.pages} pagina('s) per zoekopdracht · AliExpress-check ${job.aliCheck ? "aan" : "uit"} · ${known.size} bekende winkels overgeslagen`, "muted");
  await saveJob(job);
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
  pushLog(job, `Klaar: ${p.found} domeinen gezien · ${p.excluded} merken/marketplaces · ${p.known} al bekend · ${p.candidates} nieuw gecheckt → ${p.dropship} dropship · ${p.twijfel} twijfel · ${p.merk} merk/retailer · ${p.nonShopify} geen Shopify${p.earlier ? ` · ${p.earlier} eerder gevonden (niet opnieuw gecheckt)` : ""}`, "ok");
  await setJSON(LAST_KEY, { at: Date.now(), markets: job.markets, prog: job.prog, results: Object.values(job.results) }, LAST_TTL);
}

async function searchStep(job, started) {
  // volgende batch: zoekopdrachten van DEZELFDE markt, max QUERIES_PER_CALL
  const first = job.queries[job.qCursor];
  const batch = [];
  for (let i = job.qCursor; i < job.queries.length && batch.length < QUERIES_PER_CALL; i++) {
    if (job.queries[i].market !== first.market) break;
    batch.push(job.queries[i]);
  }
  const m = marketByKey(first.market);
  const r = await searchGoogle(m, batch.map((b) => b.q), { pages: job.pages, timeoutSecs: 36 });
  job.qCursor += batch.length;
  job.prog.queries += batch.length;
  if (!r.ok) {
    job.prog.apifyErrors++;
    pushLog(job, `${m.label}: Apify-fout — ${r.error}`, "err");
    if (r.fatal || job.prog.apifyErrors >= 6) {
      job.status = "error";
      job.error = `Apify: ${r.error}`;
    }
    return;
  }
  job.prog.pages += r.pages || 0;
  job.prog.unresolved += r.unresolved || 0;

  const seen = await getSeen();
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
      // eerder al gecheckt en nog niet toegevoegd/genegeerd → meteen tonen, niet opnieuw checken
      earlier++;
      job.prog.earlier++;
      job.results[d] = { ...s.audit, domain: d, markets: rec.markets, via: rec.via, merchant: rec.merchant, earlier: true, visits: s.visits || null };
      continue;
    }
    if (s && !s.audit) {
      // eerder gezien als merk/geen Shopify → overslaan
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
  const prodHits = r.hits.filter((x) => x.source === "product").length;
  pushLog(job, `${m.label}: ${batch.length} zoekopdrachten → ${r.hits.length} resultaten (${prodHits} gesponsorde producten) · ${fresh} nieuwe winkels${earlier ? ` · ${earlier} eerder gevonden` : ""}${r.unresolved ? ` · ${r.unresolved} zonder domein` : ""}`, fresh ? "" : "muted");
}

async function auditStep(job, started) {
  const slice = job.candidates.slice(job.aCursor, job.aCursor + AUDIT_PAR);
  const deadline = Math.min(started + TICK_BUDGET_MS, Date.now() + 34000);
  const settled = await Promise.allSettled(slice.map((d) => auditDropship(d, { aliCheck: job.aliCheck, deadline })));
  const seenPatch = {};
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
    if (a.verdict === "dropship") job.prog.dropship++;
    else if (a.verdict === "twijfel") job.prog.twijfel++;
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

    while (!job.stopRequested && job.status === "running") {
      if (Date.now() - started > TICK_BUDGET_MS - ROUND_MIN_MS) break;
      if (job.phase === "search") {
        if (job.qCursor >= job.queries.length) {
          job.phase = "audit";
          pushLog(job, `Zoeken klaar: ${job.candidates.length} nieuwe winkels checken`, "strong");
          await saveJob(job);
          continue;
        }
        await searchStep(job, started);
        await saveJob(job);
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
