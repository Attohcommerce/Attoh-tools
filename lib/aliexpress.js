// ALIEXPRESS — maattabel-pagina ophalen en parsen + product-ID's herleiden.
//
// Ontdekking 02-09-2026 (live gecheckt): elk AliExpress-product met een
// seller-maattabel heeft een aparte, server-side gerenderde pagina
//   https://www.aliexpress.com/p/secondaryPage/size-chart-v2.html?_pid=<id>
// met precies één <table> (Size | EU Size | Bust | Length …) en een CM/IN-
// knop waarvan de actieve stand in de HTML staat. Geen XHR, geen login.
// Alleen `_pid` is nodig. Sellers zónder standaardtabel geven een pagina
// zonder <table> (dan: screenshot-route of standaardtabel).
//
// Server-side vanaf Vercel kan AliExpress een slider/"punish"-pagina geven.
// Daarom: (1) nette browser-headers + en_US-cookie, (2) optionele scraping-
// proxy via env SCRAPER_PROXY_URL (sjabloon met {url}, bv.
// "https://api.scraperapi.com?api_key=KEY&url={url}"), (3) blokkade wordt
// herkend en als `blocked` teruggegeven — nooit als "geen tabel".

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "aep_usuc_f=site=glo&region=US&b_locale=en_US&c_tp=USD; intl_locale=en_US; xman_us_f=x_locale=en_US&region=US",
};

export function sizeChartUrl(pid) {
  return `https://www.aliexpress.com/p/secondaryPage/size-chart-v2.html?_pid=${encodeURIComponent(String(pid))}&_locale=en_US`;
}

/** Numeriek AliExpress product-ID uit een URL of losse tekst (null als niets) */
export function parseAliProductId(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^\d{8,20}$/.test(s)) return s;
  const m =
    s.match(/\/(?:item|i)\/(\d{8,20})(?:\.html|\b)/) ||
    s.match(/[?&](?:_pid|productId|product_id|itemId)=(\d{8,20})/i) ||
    s.match(/(\d{13,20})/);
  return m ? m[1] : null;
}

async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function viaProxy(url) {
  const tpl = process.env.SCRAPER_PROXY_URL || "";
  if (!tpl || !tpl.includes("{url}")) return null;
  return tpl.replace("{url}", encodeURIComponent(url));
}

/** Pagina ophalen: direct, en bij blokkade automatisch nog eens via de proxy (als ingesteld). */
export async function fetchAliHtml(url) {
  const attempts = [{ via: "direct", target: url, headers: BASE_HEADERS }];
  const p = viaProxy(url);
  if (p) attempts.push({ via: "proxy", target: p, headers: { Accept: "text/html" } });
  let last = { ok: false, error: "geen poging gedaan" };
  for (const a of attempts) {
    try {
      const res = await fetchWithTimeout(a.target, { headers: a.headers, redirect: "follow" }, 25000);
      const html = await res.text();
      const block = detectBlock(res.status, html);
      if (!block) return { ok: true, html, via: a.via, status: res.status };
      last = { ok: false, blocked: true, error: block, via: a.via, status: res.status };
    } catch (e) {
      last = { ok: false, error: `Netwerkfout (${a.via}): ${String(e.message || e)}`, via: a.via };
    }
  }
  return last;
}

/** Herkent de AliExpress-blokkades (slider, punish, login) → reden of null */
export function detectBlock(status, html) {
  const h = String(html || "");
  if (status === 403 || status === 429) return `HTTP ${status} (geblokkeerd)`;
  if (/_____tmd_____|x5secdata|punish|nc_1_n1z|slide to verify|baxia-punish|captcha/i.test(h)) return "slider/captcha-pagina";
  if (/login\.aliexpress|passport\.aliexpress/i.test(h) && h.length < 20000) return "login-redirect";
  if (status >= 500) return `HTTP ${status}`;
  if (h.length < 1500) return `lege pagina (HTTP ${status})`;
  return null;
}

/* ---------- HTML → tabel ---------- */

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * parseSizeChartHtml(html) → { ok, headers, rows, unitHint, title }
 *   ok=false + reason "no_table" wanneer de pagina wel laadt maar geen tabel heeft
 */
export function parseSizeChartHtml(html) {
  const h = String(html || "");
  const tableM = h.match(/<table[\s\S]*?<\/table>/i);
  if (!tableM) return { ok: false, reason: "no_table" };
  const table = tableM[0];
  const cellsOf = (tr) => (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(stripTags);
  let headers = [];
  let bodyHtml = table;
  const theadM = table.match(/<thead[\s\S]*?<\/thead>/i);
  if (theadM) {
    const tr = theadM[0].match(/<tr[\s\S]*?<\/tr>/i);
    headers = tr ? cellsOf(tr[0]) : [];
    bodyHtml = table.replace(theadM[0], "");
  }
  const rows = [];
  for (const tr of bodyHtml.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = cellsOf(tr);
    if (!cells.length) continue;
    if (!headers.length) {
      headers = cells; // geen <thead>: eerste rij = koppen
      continue;
    }
    rows.push(cells);
  }
  // Actieve unit-knop: <div class="…unit…">CM</div><div class="…unit… …activated…">IN</div>
  let unitHint = null;
  const unitRe = /class="([^"]*unit[^"]*)"[^>]*>\s*(CM|IN)\s*</gi;
  let um;
  while ((um = unitRe.exec(h))) {
    if (/activ/i.test(um[1])) unitHint = um[2].toLowerCase();
  }
  const titleM = h.match(/<title>([^<]*)<\/title>/i);
  return { ok: true, headers, rows, unitHint, title: titleM ? stripTags(titleM[1]) : "" };
}

/** Compleet: pid → { ok, pid, headers, rows, unitHint, via } | { ok:false, reason|blocked, error } */
export async function fetchSizeChart(pid) {
  const url = sizeChartUrl(pid);
  const r = await fetchAliHtml(url);
  if (!r.ok) return { ok: false, pid, url, blocked: !!r.blocked, error: r.error, via: r.via };
  const t = parseSizeChartHtml(r.html);
  if (!t.ok) return { ok: false, pid, url, reason: t.reason, via: r.via, error: "geen maattabel bij dit product (seller zonder standaardtabel)" };
  return { ok: true, pid, url, headers: t.headers, rows: t.rows, unitHint: t.unitHint, via: r.via };
}

/* ---------- Versleutelde/affiliate-links → product-ID ---------- */

/**
 * resolveAliProductId(link) → { ok, pid, hops } | { ok:false, error }
 * Volgt redirects handmatig (max 6) en leest onderweg /item/<id>.html,
 * redirectUrl=…, of een meta-refresh/JS-locatie uit de body.
 */
export async function resolveAliProductId(link) {
  let url = String(link || "").trim();
  const direct = parseAliProductId(url);
  if (direct && /aliexpress\.(com|us|ru)\/(item|i)\//.test(url)) return { ok: true, pid: direct, hops: 0 };
  for (let hop = 0; hop < 6 && url; hop++) {
    // redirectUrl in de query (star.aliexpress.com/share/…)
    try {
      const u = new URL(url);
      const inner = u.searchParams.get("redirectUrl") || u.searchParams.get("redirect_url") || u.searchParams.get("url");
      if (inner) {
        const pid = parseAliProductId(inner);
        if (pid) return { ok: true, pid, hops: hop };
      }
    } catch {}
    let res;
    try {
      res = await fetchWithTimeout(url, { headers: BASE_HEADERS, redirect: "manual" }, 15000);
    } catch (e) {
      return { ok: false, error: `Netwerkfout bij herleiden: ${String(e.message || e)}` };
    }
    const loc = res.headers.get("location");
    if (loc) {
      const next = new URL(loc, url).toString();
      const pid = parseAliProductId(next);
      if (pid && /\/(item|i)\/\d/.test(next)) return { ok: true, pid, hops: hop + 1 };
      url = next;
      continue;
    }
    const body = await res.text().catch(() => "");
    const m =
      body.match(/https?:\/\/[^"'\s]*aliexpress\.[a-z]+\/(?:item|i)\/(\d{8,20})\.html/) ||
      body.match(/redirectUrl=([^"'&\s]+)/) ||
      body.match(/(?:window\.location(?:\.href)?|location\.replace)\s*[=(]\s*["']([^"']+)["']/);
    if (m) {
      const cand = decodeURIComponent(m[1]);
      const pid = parseAliProductId(cand);
      if (pid) return { ok: true, pid, hops: hop + 1 };
      url = cand.startsWith("http") ? cand : null;
      continue;
    }
    return { ok: false, error: `geen product-ID gevonden na ${hop + 1} stap(pen)` };
  }
  return { ok: false, error: "te veel redirects" };
}
