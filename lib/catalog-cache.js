// PERMANENTE CATALOGUS-CACHE + PERMANENTE COMPETITOR-LIJST
// (zelfde REDIS_URL als To Do-board / Size Guide).
//
// Catalogi: één keer ophalen, daarna blijven ze staan tot je zelf ververst
// ("Alle catalogi verversen") of de winkel uit de lijst haalt. Geen
// vervaldatum meer — Chaim's scraper werkt ook zo.
// Opslag: gzip als binaire waarde onder cat:v3:<domein> + een kleine
// meta-key catmeta:v3:<domein> (aantal, tijdstip, taal, best-selling).
//
// Competitor-lijst: comp:list:v1 (JSON-array, volgorde = zoekvolgorde).
// Staat op de server, dus niet meer alleen in de browser: geen verlies bij
// een andere browser, gewiste cache of 14 dagen niet gebruiken.
import { createClient, commandOptions } from "redis";
import { gzipSync, gunzipSync } from "zlib";

let clientPromise = null;
function getClient() {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => console.error("Redis error:", err));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

const dataKey = (dom) => `cat:v3:${String(dom || "").toLowerCase()}`;
const metaKey = (dom) => `catmeta:v3:${String(dom || "").toLowerCase()}`;
const LIST_KEY = "comp:list:v1";

export function cleanStoreDomain(v) {
  return String(v || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

/* ---------- Catalogi ---------- */

export async function readCatalog(dom) {
  try {
    const c = await getClient();
    if (!c) return null;
    const raw = await c.get(commandOptions({ returnBuffers: true }), dataKey(dom));
    if (!raw) return null;
    return JSON.parse(gunzipSync(raw).toString("utf8"));
  } catch {
    return null;
  }
}

// Geeft { ok, error } terug, zodat de UI kan melden als de cache vol zit.
export async function writeCatalog(dom, data) {
  try {
    const c = await getClient();
    if (!c) return { ok: false, error: "geen REDIS_URL" };
    const packed = gzipSync(Buffer.from(JSON.stringify(data), "utf8"), { level: 9 });
    const meta = {
      domain: dom,
      count: (data.products || []).length,
      at: data.fetchedAt || Date.now(),
      lang: data.lang || "en",
      bestSelling: data.bestSellingStatus || "onbekend",
      partial: !!data.partial,
      kb: Math.round(packed.length / 1024),
    };
    // Geen EX: blijft staan tot verversen of verwijderen
    await c.set(dataKey(dom), packed);
    await c.set(metaKey(dom), JSON.stringify(meta));
    return { ok: true, meta };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export async function deleteCatalog(dom) {
  try {
    const c = await getClient();
    if (!c) return;
    await c.del([dataKey(dom), metaKey(dom)]);
  } catch {}
}

export async function readCatalogMeta(domains) {
  const out = {};
  try {
    const c = await getClient();
    if (!c || !domains.length) return out;
    for (let i = 0; i < domains.length; i += 200) {
      const part = domains.slice(i, i + 200);
      const vals = await c.mGet(part.map(metaKey));
      part.forEach((d, j) => {
        if (vals[j]) {
          try {
            out[d] = JSON.parse(vals[j]);
          } catch {}
        }
      });
    }
  } catch {}
  return out;
}

// Geheugengebruik van Redis, voor de melding "cache vol" in de UI
export async function cacheStats() {
  try {
    const c = await getClient();
    if (!c) return null;
    const info = await c.info("memory");
    const used = Number((info.match(/used_memory:(\d+)/) || [])[1] || 0);
    const max = Number((info.match(/maxmemory:(\d+)/) || [])[1] || 0);
    return { usedMb: Math.round(used / 1048576), maxMb: max ? Math.round(max / 1048576) : null };
  } catch {
    return null;
  }
}

export function catalogCacheAvailable() {
  return !!process.env.REDIS_URL;
}

/* ---------- Competitor-lijst ---------- */

export async function getStoreList() {
  try {
    const c = await getClient();
    if (!c) return null;
    const raw = await c.get(LIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return null;
  }
}

async function saveStoreList(list) {
  const c = await getClient();
  if (!c) return false;
  await c.set(LIST_KEY, JSON.stringify(list));
  return true;
}

// Toevoegen achteraan, dubbele (ook www./https://-varianten) genegeerd
export async function addToStoreList(items) {
  const cur = (await getStoreList()) || [];
  const seen = new Set(cur);
  const added = [];
  let dupes = 0;
  for (const it of items || []) {
    const d = cleanStoreDomain(it);
    if (!d || !d.includes(".")) continue;
    if (seen.has(d)) {
      dupes++;
      continue;
    }
    seen.add(d);
    added.push(d);
  }
  const next = [...cur, ...added];
  if (added.length) await saveStoreList(next);
  return { list: next, added, dupes };
}

// Nieuwe volgorde (bv. na "Stores checken & sorteren"). Winkels die niet in
// de nieuwe volgorde staan blijven gewoon achteraan staan — er valt nooit
// een winkel weg door sorteren of een AI-selectie.
export async function reorderStoreList(order) {
  const cur = (await getStoreList()) || [];
  const seen = new Set();
  const next = [];
  for (const d of [...(order || []).map(cleanStoreDomain), ...cur]) {
    if (!d || seen.has(d)) continue;
    seen.add(d);
    next.push(d);
  }
  await saveStoreList(next);
  return next;
}

export async function removeFromStoreList(domains) {
  const rm = new Set((domains || []).map(cleanStoreDomain));
  const cur = (await getStoreList()) || [];
  const next = cur.filter((d) => !rm.has(d));
  await saveStoreList(next);
  for (const d of rm) await deleteCatalog(d);
  return next;
}

export async function clearStoreList() {
  const cur = (await getStoreList()) || [];
  await saveStoreList([]);
  for (const d of cur) await deleteCatalog(d);
  return [];
}

/* ---------- Competitor-meta (bezoek/maand, land, producten, opmerking) ----------
   comp:meta:v1 = { domein: { market, visits, products, note, name } }.
   Komt uit de competitor-sheet of uit een screenshot daarvan; bewaard op de
   server zodat de maandelijkse bezoekers nooit meer verdwijnen. */
const META_KEY = "comp:meta:v1";

export async function getStoreMeta() {
  try {
    const c = await getClient();
    if (!c) return {};
    const raw = await c.get(META_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

// Samenvoegen: lege waarden overschrijven nooit iets wat er al stond
export async function mergeStoreMeta(patch) {
  const c = await getClient();
  if (!c) return {};
  const cur = await getStoreMeta();
  for (const [dRaw, m] of Object.entries(patch || {})) {
    const d = cleanStoreDomain(dRaw);
    if (!d) continue;
    const prev = cur[d] || {};
    const next = { ...prev };
    for (const [k, v] of Object.entries(m || {})) {
      if (v === null || v === undefined || v === "" || (typeof v === "number" && !isFinite(v))) continue;
      next[k] = v;
    }
    cur[d] = next;
  }
  await c.set(META_KEY, JSON.stringify(cur));
  return cur;
}
