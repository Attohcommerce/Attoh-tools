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
