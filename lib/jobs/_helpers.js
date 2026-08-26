// Gedeelde helpers voor Taken-jobs. Draait ALLEEN server-side (Vercel mag naar elk domein).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// "https://www.juliaraven.com/collections/all" -> "juliaraven.com"
export function cleanDomain(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  s = s.split(/[\/?#\s]/)[0].toLowerCase();
  if (!s.includes(".")) return null;
  return s;
}

// fetch met timeout + retry op 429/5xx (Retry-After gerespecteerd, max ~4s wachten)
export async function fetchWithRetry(url, { timeout = 9000, tries = 2, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/json;q=0.9,*/*;q=0.8",
          ...headers,
        },
        redirect: "follow",
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error("HTTP " + res.status);
        const ra = Number(res.headers.get("retry-after")) || 0;
        await sleep(Math.min(ra * 1000 || 600 * (i + 1), 4000));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e && e.name === "AbortError" ? new Error("timeout") : e;
      if (i < tries - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastErr || new Error("fetch mislukt");
}

// Storefront products.json (max 250). ok:false bij geen Shopify / afgeschermd.
export async function shopifyProducts(domain, limit = 250) {
  let res;
  try {
    res = await fetchWithRetry(`https://${domain}/products.json?limit=${limit}`);
  } catch (e) {
    return { ok: false, status: "onbereikbaar", detail: String((e && e.message) || e) };
  }
  if (!res.ok) return { ok: false, status: res.status };
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: "geen json" };
  }
  if (!Array.isArray(data && data.products)) return { ok: false, status: "geen products-array" };
  return { ok: true, products: data.products };
}

// Product-handles in documentvolgorde uit storefront-HTML (les: products.json negeert sort_by).
export function extractHandles(html, max = 24) {
  const out = [];
  const seen = new Set();
  const re = /href="[^"]*?\/products\/([a-zA-Z0-9\-_.%]+)/g;
  let m;
  while ((m = re.exec(html)) && out.length < max) {
    const h = m[1].split("?")[0].toLowerCase();
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}
