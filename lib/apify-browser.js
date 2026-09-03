// ALIEXPRESS VIA ECHTE BROWSER (Apify playwright-scraper + residential proxy).
//
// Waarom: AliExpress stuurt server-side requests (Node fetch, óók via de
// residential proxy) naar een login-pagina — het herkent de TLS/HTTP-
// vingerafdruk, niet alleen het IP. Een echte Chromium in Apify's cloud
// mét residential proxy is een gewone bezoeker. Eén actor-run doet in één
// keer: (1) affiliate/versleutelde link volgen tot het product-ID en
// (2) de maattabel-pagina laden. Kost ±$0,005–0,01 per product (2 GB × ~30 s).
//
// Env: APIFY_TOKEN (verplicht), APIFY_BROWSER_ACTOR (default apify~playwright-scraper;
//      alternatief bij blokkades: apify~camoufox-scraper — zelfde input, stealth-browser),
//      APIFY_PROXY_GROUPS (default RESIDENTIAL), APIFY_PROXY_COUNTRY (default US),
//      SIZEGUIDE_BROWSER=off om deze route uit te zetten.
import { apifyRunSync, apifyConfigured } from "./apify.js";

const DEFAULT_ACTOR = "apify~playwright-scraper";

export function browserFetchConfigured() {
  return apifyConfigured() && String(process.env.SIZEGUIDE_BROWSER || "").toLowerCase() !== "off";
}

export function sizeChartUrlFor(pid) {
  return `https://www.aliexpress.com/p/secondaryPage/size-chart-v2.html?_pid=${encodeURIComponent(String(pid))}&_locale=en_US`;
}

// Draait IN de actor (Playwright `page`). Geen closures — wordt als string verstuurd.
const PAGE_FUNCTION = `async function pageFunction(context) {
  const { page, request } = context;
  const out = { startUrl: request.url, finalUrl: page.url(), pid: null, chartUrl: null, chartFinalUrl: null, html: "", note: "" };
  const idFrom = (s) => {
    const str = String(s || "");
    const m = str.match(/\\/(?:item|i)\\/(\\d{8,20})/) || str.match(/[?&](?:_pid|productId|product_id|itemId)=(\\d{8,20})/i);
    return m ? m[1] : null;
  };
  out.pid = idFrom(out.finalUrl);
  // Redirect-pagina's (imagesearchaliexpress / s.click) doen JS- of meta-redirects: even meelopen
  for (let i = 0; i < 8 && !out.pid; i++) {
    await page.waitForTimeout(1500);
    out.finalUrl = page.url();
    out.pid = idFrom(out.finalUrl);
  }
  if (!out.pid) {
    const body = await page.content();
    const b = body.match(/aliexpress\\.[a-z.]+\\/(?:item|i)\\/(\\d{8,20})/) || body.match(/(?:productId|product_id|itemId|_pid)["'=:\\s]+(\\d{8,20})/);
    if (b) out.pid = b[1];
    out.note = "pid uit body: " + (b ? "ja" : "nee") + " (" + body.length + " tekens, url " + out.finalUrl.slice(0, 80) + ")";
  }
  if (out.pid) {
    out.chartUrl = "https://www.aliexpress.com/p/secondaryPage/size-chart-v2.html?_pid=" + out.pid + "&_locale=en_US";
    if (!/size-chart-v2/.test(page.url())) {
      await page.goto(out.chartUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    await page.waitForTimeout(2000);
    out.chartFinalUrl = page.url();
    out.html = await page.content();
  }
  return out;
}`;

/**
 * aliViaBrowser({ pid | link, timeoutMs }) →
 *   { ok:true, pid, html, finalUrl, chartFinalUrl, via:"apify-browser" }
 *   | { ok:false, error, fatal?, pid?, finalUrl?, note? }
 */
export async function aliViaBrowser({ pid = null, link = null, timeoutMs = 45000 } = {}) {
  if (!browserFetchConfigured()) return { ok: false, error: "browser-route uit (APIFY_TOKEN ontbreekt of SIZEGUIDE_BROWSER=off)" };
  const startUrl = pid ? sizeChartUrlFor(pid) : link;
  if (!startUrl) return { ok: false, error: "geen product-ID en geen link" };
  const actor = process.env.APIFY_BROWSER_ACTOR || DEFAULT_ACTOR;
  const groups = String(process.env.APIFY_PROXY_GROUPS || "RESIDENTIAL")
    .split(/[,+ ]+/)
    .filter(Boolean);
  const country = process.env.APIFY_PROXY_COUNTRY || "US";
  const input = {
    startUrls: [{ url: startUrl }],
    pageFunction: PAGE_FUNCTION,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: groups, apifyProxyCountry: country },
    maxPagesPerCrawl: 1,
    maxRequestRetries: 1,
    pageLoadTimeoutSecs: 40,
    pageFunctionTimeoutSecs: 60,
    waitUntil: "domcontentloaded", // string-select in het schema (networkidle|load|domcontentloaded)
    maxScrollHeightPixels: 0, // niet auto-scrollen: tijd
    downloadMedia: false, // foto's/css blokkeren: sneller, goedkoper via de proxy
    downloadCss: false,
  };
  const secs = Math.max(20, Math.min(120, Math.round(timeoutMs / 1000)));
  const r = await apifyRunSync(actor, input, { timeoutSecs: secs + 10, memory: 2048, abortMs: timeoutMs, limit: 1 });
  if (!r.ok) return { ok: false, error: r.error, fatal: !!r.fatal };
  const item = (r.items || []).find((x) => x && typeof x === "object") || null;
  if (!item) return { ok: false, error: "browser gaf geen resultaat (leeg dataset-item)" };
  if (!item.pid) return { ok: false, error: `geen product-ID gevonden — ${item.note || "redirect kwam niet op een productpagina uit"}`, finalUrl: item.finalUrl || null };
  if (!item.html) return { ok: false, error: "maattabel-pagina niet geladen", pid: item.pid, finalUrl: item.finalUrl || null };
  return { ok: true, pid: item.pid, html: item.html, finalUrl: item.finalUrl || null, chartFinalUrl: item.chartFinalUrl || null, via: "apify-browser" };
}
