// APIFY — gedeelde helper voor synchrone actor-runs (run-sync-get-dataset-items).
// Gebruikt door de AliExpress search-by-image (lib/imagesearch.js) én de
// browser-fetch (lib/apify-browser.js). Eén plek voor: token-check, timeout,
// de échte faalreden uit de run halen en plan/quota-fouten als `fatal`
// markeren (dan stopt de batch i.p.v. 200× hetzelfde te proberen).

export function apifyConfigured() {
  return !!process.env.APIFY_TOKEN;
}

/**
 * apifyRunSync(actor, input, { timeoutSecs, memory, abortMs, limit })
 *   → { ok, items, runId } | { ok:false, error, fatal }
 */
export async function apifyRunSync(actor, input, opts = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN ontbreekt (Vercel → Environment Variables)", fatal: true };
  const timeoutSecs = Math.max(10, Number(opts.timeoutSecs) || 45);
  const qs = [`token=${encodeURIComponent(token)}`, `timeout=${timeoutSecs}`, "clean=true"];
  if (opts.memory) qs.push(`memory=${Number(opts.memory)}`);
  if (opts.limit) qs.push(`limit=${Number(opts.limit)}`);
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?${qs.join("&")}`;
  const ctrl = new AbortController();
  const abortMs = Number(opts.abortMs) || timeoutSecs * 1000 + 5000;
  const t = setTimeout(() => ctrl.abort(), abortMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input || {}),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      let msg = (data && data.error && (data.error.message || data.error.type)) || text.slice(0, 200) || `HTTP ${res.status}`;
      // "Actor run did not succeed (run ID: …, status: FAILED)" zegt niets —
      // de echte reden staat in de run zelf (bv. "Free plan: daily limit …").
      const runId = (String(msg).match(/run ID:\s*([A-Za-z0-9]+)/) || [])[1];
      if (runId) {
        try {
          const rr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
          const rj = await rr.json().catch(() => null);
          const sm = rj && rj.data && rj.data.statusMessage;
          if (sm) msg = `${sm} (run ${runId})`;
        } catch {}
      }
      const fatal =
        /daily limit|upgrade|subscription|quota|insufficient|credit|payment|rent|not enough|monthly usage|limit exceeded/i.test(String(msg)) ||
        res.status === 401 ||
        res.status === 402 ||
        res.status === 403;
      return { ok: false, error: `Apify: ${msg}`, fatal, status: res.status };
    }
    const items = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : [];
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: `Apify: ${e.name === "AbortError" ? `timeout na ${Math.round(abortMs / 1000)} s` : String(e.message || e)}` };
  } finally {
    clearTimeout(t);
  }
}

/* ---------- ASYNCHROON (04-11-2026, Competitor finder) ----------
   run-sync moest binnen één Vercel-tick (±40 s) klaar zijn, maar een Google-
   search-run heeft ±20 s alleen al nodig om op te starten → afgebroken na
   1 zoekopdracht. Daarom: run starten (antwoordt meteen), in latere ticks
   de status pollen en de dataset ophalen. Zo draaien alle markten tegelijk
   op Apify en kost het de tool geen wachttijd. */

function apifyFatal(msg, status) {
  return (
    /daily limit|upgrade|subscription|quota|insufficient|credit|payment|rent|not enough|monthly usage|limit exceeded|outstanding invoice/i.test(String(msg)) ||
    status === 401 || status === 402 || status === 403
  );
}

/** apifyStartRun(actor, input, { timeoutSecs, memory }) → { ok, runId, status, datasetId } | { ok:false, error, fatal } */
export async function apifyStartRun(actor, input, opts = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN ontbreekt (Vercel → Environment Variables)", fatal: true };
  const qs = [`token=${encodeURIComponent(token)}`, `timeout=${Math.max(60, Number(opts.timeoutSecs) || 600)}`];
  if (opts.memory) qs.push(`memory=${Number(opts.memory)}`);
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs?${qs.join("&")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input || {}),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.data) {
      const msg = (data && data.error && (data.error.message || data.error.type)) || `HTTP ${res.status}`;
      return { ok: false, error: `Apify: ${msg}`, fatal: apifyFatal(msg, res.status), status: res.status };
    }
    return { ok: true, runId: data.data.id, status: data.data.status, datasetId: data.data.defaultDatasetId };
  } catch (e) {
    return { ok: false, error: `Apify: ${String(e.message || e)}` };
  }
}

/** apifyRunInfo(runId) → { ok, status, statusMessage, datasetId, startedAt, finishedAt } */
export async function apifyRunInfo(runId) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN ontbreekt" };
  try {
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.data) return { ok: false, error: `Apify: HTTP ${res.status}` };
    const d = data.data;
    return { ok: true, status: d.status, statusMessage: d.statusMessage || "", datasetId: d.defaultDatasetId, startedAt: d.startedAt, finishedAt: d.finishedAt };
  } catch (e) {
    return { ok: false, error: `Apify: ${String(e.message || e)}` };
  }
}

/** apifyDatasetItems(datasetId, { limit }) → { ok, items } */
export async function apifyDatasetItems(datasetId, opts = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { ok: false, error: "APIFY_TOKEN ontbreekt" };
  try {
    const res = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(token)}&clean=true&limit=${Number(opts.limit) || 1000}`, { signal: AbortSignal.timeout(25000) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) return { ok: false, error: `Apify: HTTP ${res.status}` };
    return { ok: true, items: data };
  } catch (e) {
    return { ok: false, error: `Apify: ${String(e.message || e)}` };
  }
}
