// SIZE GUIDE — cloud-run: de hele batch draait server-side in Vercel, zodat
// de pc uit mag. Toestand in Redis (sg:job:<domein>), elke "tick" verwerkt
// ±45 s aan producten (3 parallel, zelfde buildForProduct als de gewone
// knop), schrijft tussentijds weg (per 20, zelfde regels als /api/size-guide/
// write: eerst log-sheet, dan metafields) en start daarna zelf de volgende
// tick (fetch naar /api/size-guide/job/tick met geheim). Valt een keten stil
// (deploy, crash), dan pakt de status-poll van de UI of de knop "Hervat" 'm
// weer op — alles is hervatbaar via de cursor.
import { createClient } from "redis";
import { buildForProduct } from "./sizeguide-run.js";
import { setProductMetafields, ensureProductMetafieldDefinitions } from "./shopify.js";
import { addTab, appendRows } from "./sheets.js";
import { SG_NS, SG_KEY, SG_STATUS_KEY } from "./sizeguide.js";

const CHUNK = 3; // producten parallel per ronde (zelfde als build-route)
const TICK_BUDGET_MS = 44000; // werk per tick; daarna state opslaan + volgende tick
const ROUND_MIN_MS = 14000; // minimale resttijd om nog een ronde te beginnen
const WRITE_EVERY = 20;
const LOCK_TTL = 75; // s — iets langer dan een tick
const JOB_TTL = 60 * 60 * 24 * 3;
const STALE_MS = 150000; // geen tick meer sinds 2,5 min → keten is gebroken → hervatten

const DEFS = [
  { namespace: SG_NS, key: SG_KEY, name: "Size guide", type: "json", description: "Maattabel (Attoh Tools Size Guide)" },
  { namespace: SG_NS, key: SG_STATUS_KEY, name: "Size guide status", type: "single_line_text_field", description: "aliexpress | standard | manual" },
];

let clientPromise = null;
function redis() {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    const c = createClient({ url: process.env.REDIS_URL });
    c.on("error", (err) => console.error("Redis error:", err));
    clientPromise = c.connect().then(() => c);
  }
  return clientPromise;
}

export function jobSecret() {
  return process.env.SG_JOB_SECRET || process.env.SESSION_SECRET || "dev-only-secret-change-me-in-vercel-env-1234567890";
}
export function jobAvailable() {
  return !!process.env.REDIS_URL;
}

const jobKey = (domain) => `sg:job:${String(domain || "").toLowerCase()}`;
const lockKey = (domain) => `sg:job:lock:${String(domain || "").toLowerCase()}`;

export async function getJob(domain) {
  const c = await redis();
  if (!c) return null;
  const raw = await c.get(jobKey(domain));
  return raw ? JSON.parse(raw) : null;
}
async function saveJob(job) {
  const c = await redis();
  if (!c) return;
  job.updatedAt = Date.now();
  await c.set(jobKey(job.domain), JSON.stringify(job), { EX: JOB_TTL });
}
async function acquireLock(domain, id) {
  const c = await redis();
  if (!c) return false;
  const r = await c.set(lockKey(domain), id, { NX: true, EX: LOCK_TTL });
  return r === "OK";
}
async function releaseLock(domain, id) {
  try {
    const c = await redis();
    if (!c) return;
    const cur = await c.get(lockKey(domain));
    if (cur === id) await c.del(lockKey(domain));
  } catch {}
}

function pushLog(job, text, cls) {
  job.log.push({ t: Date.now(), text: String(text).slice(0, 400), cls: cls || "" });
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
}

/** Publieke samenvatting voor de UI (zonder credentials en zonder de itemlijst). */
export function publicJob(job) {
  if (!job) return null;
  const { store, items, pending, ...rest } = job;
  return {
    ...rest,
    total: items.length,
    pendingWrites: (pending || []).length,
    stale: job.status === "running" && Date.now() - (job.lastTickAt || job.startedAt) > STALE_MS,
  };
}

/**
 * startJob({store, market, items, useSearch, sourceDomains, fallbackStandard, autoWrite, backup, baseUrl, label})
 */
export async function startJob(opts) {
  const { store, market, items, baseUrl } = opts;
  const existing = await getJob(store.domain);
  if (existing && existing.status === "running" && Date.now() - (existing.lastTickAt || existing.startedAt) < STALE_MS) {
    return { ok: false, error: "Er draait al een cloud-run voor deze store — stop die eerst of wacht tot hij klaar is." };
  }
  const job = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    domain: store.domain,
    storeName: store.name || store.domain,
    store: { domain: store.domain, token: store.token, clientId: store.clientId, clientSecret: store.clientSecret, name: store.name },
    market: market || "USA",
    items: items.map((it) => ({ ...it, guide: undefined })), // guide-JSON niet meenemen (groot, niet nodig)
    cursor: 0,
    useSearch: opts.useSearch !== false,
    useSource: true,
    sourceDomains: Array.isArray(opts.sourceDomains) ? opts.sourceDomains.slice(0, 200) : [],
    fallbackStandard: opts.fallbackStandard !== false,
    autoWrite: opts.autoWrite !== false,
    backup: opts.backup && opts.backup.sheetId && opts.backup.tab ? { sheetId: opts.backup.sheetId, tab: opts.backup.tab } : null,
    baseUrl: String(baseUrl || "").replace(/\/$/, ""),
    label: opts.label || "Cloud-run",
    status: "running", // running | done | stopped | error
    error: null,
    prog: { done: 0, green: 0, amber: 0, standard: 0, red: 0, none: 0, usd: 0, written: 0, writeFailed: 0 },
    results: {}, // id → {ok, verdict, score, reason, source}
    pending: [], // build-resultaten die nog geschreven moeten worden
    defsDone: false,
    tabDone: false,
    log: [],
    startedAt: Date.now(),
    lastTickAt: 0,
    finishedAt: 0,
    ticks: 0,
  };
  pushLog(job, `${job.label}: ${items.length} producten · markt ${job.market} · bron-stores ${job.sourceDomains.length} · image-search ${job.useSearch ? "aan" : "uit"} · vangnet ${job.fallbackStandard ? "aan" : "uit"} · ${job.backup ? `log: ${job.backup.tab}` : "zonder log"}`, "muted");
  await saveJob(job);
  return { ok: true, job: publicJob(job) };
}

export async function stopJob(domain) {
  const job = await getJob(domain);
  if (!job) return { ok: false, error: "geen cloud-run gevonden" };
  if (job.status === "running") {
    job.stopRequested = true;
    pushLog(job, "Stop gevraagd — stopt na de huidige ronde en schrijft wat klaar is.", "warn");
    await saveJob(job);
  }
  return { ok: true, job: publicJob(job) };
}

export async function resumeJob(domain) {
  const job = await getJob(domain);
  if (!job) return { ok: false, error: "geen cloud-run gevonden" };
  if (job.status === "done") return { ok: false, error: "deze run is al klaar" };
  job.status = "running";
  job.stopRequested = false;
  job.error = null;
  pushLog(job, "Hervat.", "muted");
  await saveJob(job);
  return { ok: true, job: publicJob(job) };
}

/** Volgende tick starten (fire-and-forget; de tick-route antwoordt meteen). */
export async function kickTick(job) {
  if (!job || !job.baseUrl) return false;
  try {
    const res = await fetch(`${job.baseUrl}/api/size-guide/job/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sg-job-secret": jobSecret() },
      body: JSON.stringify({ domain: job.domain }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (e) {
    console.error("kickTick:", e.message);
    return false;
  }
}

/* ---------------- schrijven (zelfde regels als /api/size-guide/write) ---------------- */
async function writePending(job, force) {
  if (!job.autoWrite) {
    job.pending = [];
    return;
  }
  if (!job.pending.length) return;
  if (!force && job.pending.length < WRITE_EVERY) return;
  const list = job.pending.splice(0, job.pending.length);
  try {
    if (!job.defsDone) {
      const d = await ensureProductMetafieldDefinitions(job.store, DEFS);
      if (!d.ok) throw new Error(`Metafield-definities: ${d.errors.join(" · ")}`);
      job.defsDone = true;
    }
    if (job.backup && !job.tabDone) {
      const t = await addTab(job.backup.sheetId, job.backup.tab, { rows: job.items.length + 10, cols: 9 });
      if (t.ok) {
        await appendRows(job.backup.sheetId, `'${job.backup.tab}'!A:I`, [["Datum", "Product ID", "Titel", "Status", "Bron", "AliExpress ID", "Confidence", "Cijfer", "Guide (JSON)"]], "RAW");
      } else if (!/bestaat al/i.test(String(t.error || ""))) {
        throw new Error(t.error || "logtabblad aanmaken mislukt");
      }
      job.tabDone = true;
    }
    if (job.backup) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const rows = list.map((it) => [
        stamp,
        String(it.id),
        String(it.title || "").slice(0, 120),
        String(it.guide && it.guide.status) || "",
        String(it.source || ""),
        it.match && it.match.pid ? String(it.match.pid) : "",
        it.match && it.match.confidence != null ? String(it.match.confidence) : "",
        it.score != null ? String(it.score) : "",
        JSON.stringify(it.guide || {}).slice(0, 45000),
      ]);
      await appendRows(job.backup.sheetId, `'${job.backup.tab}'!A:I`, rows, "RAW");
    }
    const entries = [];
    for (const it of list) {
      if (!it.guide) continue;
      entries.push({ productId: it.id, namespace: SG_NS, key: SG_KEY, type: "json", value: JSON.stringify(it.guide) });
      entries.push({ productId: it.id, namespace: SG_NS, key: SG_STATUS_KEY, type: "single_line_text_field", value: it.guide.status || "standard" });
    }
    // metafieldsSet: 25 per call → 12 producten per call
    let written = 0;
    const errors = [];
    for (let i = 0; i < entries.length; i += 24) {
      const w = await setProductMetafields(job.store, entries.slice(i, i + 24));
      written += Math.floor((w.written || 0) / 2);
      errors.push(...(w.errors || []));
    }
    job.prog.written += written;
    job.prog.writeFailed += errors.length;
    for (const r of list) {
      if (job.results[r.id]) job.results[r.id].written = true;
    }
    pushLog(job, `Geschreven: ${written} maattabel(len) naar Shopify${errors.length ? ` · ${errors.length} mislukt: ${errors.slice(0, 3).join(" · ")}` : ""}`, errors.length ? "warn" : "ok");
  } catch (e) {
    // niets geschreven → terug in de wachtrij, volgende keer opnieuw
    job.pending.unshift(...list);
    pushLog(job, `Schrijven mislukt (${String(e.message || e).slice(0, 160)}) — wordt opnieuw geprobeerd.`, "err");
    job.writeFailures = (job.writeFailures || 0) + 1;
    if (job.writeFailures >= 5) {
      job.status = "error";
      job.error = `Schrijven blijft mislukken: ${String(e.message || e).slice(0, 200)}`;
    }
  }
}

const VERDICT_LABEL = { green: "GROEN", amber: "AMBER", standard: "STANDAARD", red: "ROOD", none: "geen maten" };
function describeSource(r) {
  if (r.source === "standard") {
    const why = (r.tried && r.tried.length ? r.tried : [r.fallbackReason]).filter(Boolean).join(" · ");
    return why ? ` (standaard — ${String(why).slice(0, 160)})` : " (standaard)";
  }
  const m = r.match || {};
  const bits = [r.source, m.via, m.confidence != null ? `conf ${m.confidence}` : ""].filter(Boolean);
  return bits.length ? ` (${bits.join(" · ")})` : "";
}

/**
 * tickJob(domain) → { ok, job, chained }
 * Eén tick: lock pakken, ±44 s producten bouwen, wegschrijven, state opslaan,
 * volgende tick starten als er nog werk is.
 */
export async function tickJob(domain) {
  const started = Date.now();
  const tickId = `${started.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  if (!(await acquireLock(domain, tickId))) return { ok: true, busy: true };
  let job = null;
  let chained = false;
  try {
    job = await getJob(domain);
    if (!job || job.status !== "running") return { ok: true, idle: true };
    job.ticks++;
    job.lastTickAt = started;
    await saveJob(job);

    while (job.cursor < job.items.length && !job.stopRequested && job.status === "running") {
      // Geen nieuwe ronde meer starten als er minder dan ~14 s over is —
      // wat dan niet past valt op het vangnet terug (zelfde als de build-route).
      if (Date.now() - started > TICK_BUDGET_MS - ROUND_MIN_MS) break;
      const slice = job.items.slice(job.cursor, job.cursor + CHUNK);
      const deadline = started + TICK_BUDGET_MS;
      const settled = await Promise.allSettled(
        slice.map((item) =>
          buildForProduct({
            domain: job.domain,
            item,
            market: job.market,
            useSearch: job.useSearch,
            useSource: job.useSource,
            sourceDomains: job.sourceDomains,
            fallbackStandard: job.fallbackStandard,
            deadline,
          })
        )
      );
      let fatal = null;
      let handled = 0;
      settled.forEach((s, i) => {
        const item = slice[i];
        let r;
        if (s.status === "fulfilled") {
          r = s.value;
          if (r.fatal) {
            if (!fatal) fatal = r.reason;
            return;
          }
        } else {
          r = { id: item.id, title: item.title, ok: false, verdict: "red", reason: `fout: ${String((s.reason && s.reason.message) || s.reason).slice(0, 160)}` };
        }
        handled++;
        job.prog.done++;
        job.prog.usd += (r.ai && r.ai.usd) || 0;
        const v = r.ok ? r.verdict : r.verdict === "none" ? "none" : "red";
        if (job.prog[v] != null) job.prog[v]++;
        job.results[r.id] = { ok: !!r.ok, verdict: v, score: r.score, reason: r.reason, source: r.source, title: r.title };
        const t = String(r.title || r.id).slice(0, 48);
        if (r.ok) {
          pushLog(job, `${t}: ${VERDICT_LABEL[r.verdict] || r.verdict} ${r.score}/10${describeSource(r)}`, r.verdict === "green" ? "ok" : "warn");
          if (r.guide && (r.verdict === "green" || r.verdict === "amber" || r.verdict === "standard")) job.pending.push(r);
        } else {
          pushLog(job, `${t}: ${v === "none" ? "geen maten" : "ROOD"} — ${r.reason}`, v === "none" ? "muted" : "err");
        }
      });
      job.cursor += fatal ? handled : slice.length;
      if (fatal) {
        job.status = "error";
        job.error = `Zoeken op foto kan niet: ${fatal}. Los dit op (Apify-plan/token) en klik op Hervat — de resterende ${job.items.length - job.cursor} producten zijn niet aangeraakt.`;
        pushLog(job, `GESTOPT — ${job.error}`, "err");
      }
      await writePending(job, false);
      await saveJob(job);
      if (Date.now() - started > TICK_BUDGET_MS) break;
    }

    const finished = job.cursor >= job.items.length;
    if (finished || job.stopRequested || job.status !== "running") {
      await writePending(job, true);
      if (job.status === "running") {
        job.status = job.stopRequested ? "stopped" : "done";
      }
      job.finishedAt = Date.now();
      const p = job.prog;
      pushLog(job, `${job.status === "done" ? "Klaar" : "Gestopt"}: ${p.done}/${job.items.length} · groen ${p.green} · amber ${p.amber} · standaard ${p.standard} · rood ${p.red} · geschreven ${p.written} · AI-kosten ±$${p.usd.toFixed(2)}`, job.status === "done" ? "ok" : "warn");
      await saveJob(job);
    } else {
      await saveJob(job);
      await releaseLock(domain, tickId);
      chained = await kickTick(job);
      if (!chained) {
        pushLog(job, "Volgende tick kon niet gestart worden — de status-poll of 'Hervat' pakt 'm op.", "warn");
        await saveJob(job);
      }
      return { ok: true, job: publicJob(job), chained };
    }
    return { ok: true, job: publicJob(job), chained: false };
  } catch (e) {
    if (job) {
      pushLog(job, `Tick-fout: ${String(e.message || e).slice(0, 200)}`, "err");
      job.tickErrors = (job.tickErrors || 0) + 1;
      if (job.tickErrors >= 5) {
        job.status = "error";
        job.error = String(e.message || e).slice(0, 200);
      }
      await saveJob(job).catch(() => {});
      if (job.status === "running") {
        await releaseLock(domain, tickId);
        chained = await kickTick(job);
      }
    }
    return { ok: false, error: String(e.message || e), chained };
  } finally {
    await releaseLock(domain, tickId);
  }
}

/** Status voor de UI; start zelf een tick als de keten stil ligt. */
export async function jobStatus(domain, { autoResume = true } = {}) {
  const job = await getJob(domain);
  if (!job) return { ok: true, job: null };
  const pub = publicJob(job);
  if (autoResume && pub.stale) {
    kickTick(job).catch(() => {});
    pub.kicked = true;
  }
  return { ok: true, job: pub };
}
