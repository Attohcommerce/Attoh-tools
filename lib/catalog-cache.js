// PERMANENTE CATALOGUS-CACHE + PERMANENTE COMPETITOR-LIJST
// (zelfde REDIS_URL als To Do-board / Size Guide).
//
// Catalogi: één keer ophalen, daarna blijven ze staan tot je zelf ververst
// ("Alle catalogi verversen"), de winkel uit de lijst haalt of de cache
// wist. Opslag: gzip als binaire waarde onder cat:v3:<domein> + een kleine
// meta-key catmeta:v3:<domein> (aantal, tijdstip, taal, best-selling, kb).
//
// GEHEUGENBUDGET (les van 13-10): het gratis Redis-plan is 30 MB. Met
// volledige catalogi zonder vervaldatum liep hij in één dag vol (30,1 MB)
// en daarna faalde ÉLKE schrijfactie — ook de competitor-lijst en het
// screenshot-lezen — met "OOM command not allowed". Daarom nu:
//   1. catalogi mogen samen max 80% van het Redis-geheugen innemen; de rest
//      is voor lijst, meta, To Do-board, keyword-geheugen en size-guides
//   2. past een nieuwe catalogus niet, dan gaan eerst wezen weg (catalogi
//      van winkels die niet meer in de lijst staan) en daarna de oudste
//   3. één catalogus is ingepakt nooit groter dan MAX_STORE_BYTES: anders
//      wordt de staart van het assortiment (laagste best-selling) afgeknipt
//   4. elke SET die tóch op "OOM" stuit maakt eerst ruimte en probeert het
//      nog één keer — een volle cache blokkeert dus nooit meer de rest
//   5. clearAllCatalogs() voor de knop "Catalogi-cache wissen" (DEL werkt
//      ook als Redis vol zit)
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

const MB = 1048576;
const CATALOG_SHARE = 0.8; // deel van maxmemory dat catalogi samen mogen innemen
const MAX_STORE_BYTES = 4 * MB; // één catalogus, ingepakt (±12.000+ producten)
const MIN_STORE_PRODUCTS = 200; // nooit verder afknippen dan dit

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

/* ---------- Geheugen ---------- */

const isOom = (e) => /OOM|maxmemory/i.test(String((e && e.message) || e || ""));
const mb = (b) => Math.round((Number(b) || 0) / MB * 10) / 10;

async function memory(c) {
  const info = await c.info("memory");
  const used = Number((info.match(/used_memory:(\d+)/) || [])[1] || 0);
  const max = Number((info.match(/maxmemory:(\d+)/) || [])[1] || 0); // 0 = geen limiet bekend
  return { used, max, budget: max ? Math.floor(max * CATALOG_SHARE) : Infinity };
}

async function scanKeys(c, pattern) {
  const keys = [];
  for await (const k of c.scanIterator({ MATCH: pattern, COUNT: 200 })) keys.push(k);
  return keys;
}

async function delKeys(c, keys) {
  let n = 0;
  for (let i = 0; i < keys.length; i += 100) n += await c.del(keys.slice(i, i + 100));
  return n;
}

// Alle catalogi in Redis (ook oudere key-versies) met tijdstip en grootte
async function listCatalogs(c) {
  const metas = await scanKeys(c, "catmeta:*");
  const out = [];
  for (let i = 0; i < metas.length; i += 200) {
    const part = metas.slice(i, i + 200);
    const vals = await c.mGet(part);
    part.forEach((mk, j) => {
      let m = {};
      try {
        m = JSON.parse(vals[j] || "{}") || {};
      } catch {}
      const rest = mk.slice("catmeta:".length); // v3:<domein>
      const ver = rest.split(":")[0];
      const dom = rest.slice(ver.length + 1);
      out.push({ dom, key: `cat:${ver}:${dom}`, metaKey: mk, at: Number(m.at) || 0, bytes: (Number(m.kb) || 0) * 1024 });
    });
  }
  return out;
}

/* Wat zit er in Redis? Per soort key opgeteld (MEMORY USAGE), zodat de UI
   laat zien wie het geheugen opeet. Les van 15-10: Redis zat vol terwijl de
   catalogi maar een paar MB waren — de bron-indexen van de Size Guide
   (sg:srcidx:<domein>: alle handles + fotohashes van een bronstore, ongepakt)
   namen de rest. Die zijn herbouwbaar, dus die mogen ook weg. */
const KIND_OF = (k) =>
  k.startsWith("cat:") || k.startsWith("catmeta:") ? "catalogi"
  : k.startsWith("sg:srcidx:") ? "bronIndexen"
  : k.startsWith("sg:") ? "sizeGuide"
  : k.startsWith("geh:") || k.startsWith("kw:") ? "geheugen"
  : k.startsWith("comp:") ? "competitors"
  : k.startsWith("todo") ? "todos"
  : "overig";
async function memoryBreakdown(c, limit = 20000) {
  const out = { catalogi: 0, bronIndexen: 0, sizeGuide: 0, geheugen: 0, competitors: 0, todos: 0, overig: 0, keys: 0 };
  const keys = [];
  for await (const k of c.scanIterator({ MATCH: "*", COUNT: 500 })) {
    keys.push(k);
    if (keys.length >= limit) break;
  }
  out.keys = keys.length;
  for (let i = 0; i < keys.length; i += 100) {
    const part = keys.slice(i, i + 100);
    const sizes = await Promise.all(part.map((k) => c.memoryUsage(k).catch(() => 0)));
    part.forEach((k, j) => (out[KIND_OF(k)] += Number(sizes[j]) || 0));
  }
  return out;
}

// Bron-indexen van de Size Guide (sg:srcidx:*), oudste eerst — herbouwbaar
async function listSourceIndexes(c) {
  const keys = await scanKeys(c, "sg:srcidx:*");
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    const part = keys.slice(i, i + 100);
    const sizes = await Promise.all(part.map((k) => c.memoryUsage(k).catch(() => 0)));
    const vals = await c.mGet(part);
    part.forEach((k, j) => {
      let at = 0;
      try {
        at = Number((JSON.parse(vals[j] || "{}") || {}).at) || 0;
      } catch {}
      out.push({ key: k, bytes: Number(sizes[j]) || 0, at });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

export async function clearSourceIndexes() {
  const c = await getClient();
  if (!c) return { ok: false, error: "Geen Redis (REDIS_URL ontbreekt)" };
  const before = await memory(c);
  const keys = await scanKeys(c, "sg:srcidx:*");
  const n = keys.length ? await delKeys(c, keys) : 0;
  const after = await memory(c);
  return { ok: true, keys: n, freedMb: mb(Math.max(0, before.used - after.used)), stats: await cacheStats() };
}

function fullMessage(m) {
  const where = m.max ? `${mb(m.used)} van ${mb(m.max)} MB` : `${mb(m.used)} MB`;
  return `Redis zit vol (${where}) en er is geen catalogus meer om te wissen — vergroot het Redis-plan of haal winkels uit de lijst.`;
}

/* Ruimte maken voor `needBytes`. Eerst wezen (niet meer in de lijst), dan de
   oudste catalogus eerst; `keep` (de winkel die nu geschreven wordt) blijft
   staan — zijn oude versie telt niet mee, want SET vervangt die.
   Twee checks: na de SET onder het budget (80%), én tijdens de SET onder
   maxmemory — Redis telt het binnenkomende commando (de hele waarde nog
   een keer) mee, dus een grote catalogus heeft tijdelijk 2× zijn grootte
   aan vrije ruimte nodig (test 13-10: 2 MB catalogus faalde op "OOM" terwijl
   er volgens het budget plek was). */
async function makeRoom(c, needBytes, keep) {
  const evicted = [];
  let m = await memory(c);
  const cats = await listCatalogs(c);
  const self = keep ? cats.find((x) => x.dom === keep) : null;
  const selfBytes = self ? self.bytes : 0;
  const fits = () =>
    m.used - selfBytes + needBytes <= m.budget && (!m.max || m.used + 2 * needBytes <= m.max);
  if (fits()) return { ok: true, evicted, ...m };

  const list = (await getStoreList()) || [];
  const inList = new Set(list);
  const victims = cats
    .filter((x) => x.dom !== keep)
    .sort((a, b) => Number(inList.has(a.dom)) - Number(inList.has(b.dom)) || a.at - b.at);
  for (const x of victims) {
    await c.del([x.key, x.metaKey]);
    evicted.push(x.dom);
    m = await memory(c);
    if (fits()) break;
  }
  /* Catalogi op en nog geen plek → de bron-indexen van de Size Guide zijn de
     volgende die mogen (herbouwbaar; het matchgeheugen sg:match:* blijft). */
  if (!fits()) {
    for (const x of await listSourceIndexes(c)) {
      await c.del(x.key);
      evicted.push(`bronindex:${x.key.slice("sg:srcidx:".length)}`);
      m = await memory(c);
      if (fits()) break;
    }
  }
  return { ok: fits(), evicted, ...m };
}

// SET die bij "OOM" (Redis vol) ruimte maakt en het nog één keer probeert.
async function setSafe(c, key, value, keep, opts) {
  try {
    return await c.set(key, value, opts);
  } catch (e) {
    if (!isOom(e)) throw e;
    const size = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value));
    const room = await makeRoom(c, Math.ceil(size * 1.1) + 4096, keep);
    if (!room.ok && !room.evicted.length) throw new Error(fullMessage(room));
    return await c.set(key, value, opts);
  }
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

const pack = (obj) => gzipSync(Buffer.from(JSON.stringify(obj), "utf8"), { level: 9 });

// Geeft { ok, error, meta, evicted } terug, zodat de UI kan melden wat er
// met de cache gebeurd is (vol, ingekort, oudere catalogi weggehaald).
export async function writeCatalog(dom, data) {
  try {
    const c = await getClient();
    if (!c) return { ok: false, error: "geen REDIS_URL" };
    const total = (data.products || []).length;
    let products = data.products || [];
    let packed = pack({ ...data, products });
    // Te groot voor één winkel: staart afknippen (volgorde = best-selling
    // eerst, dus wat wegvalt zijn de slechtst verkopende producten).
    while (packed.length > MAX_STORE_BYTES && products.length > MIN_STORE_PRODUCTS) {
      products = products.slice(0, Math.max(MIN_STORE_PRODUCTS, Math.floor(products.length * 0.75)));
      packed = pack({ ...data, products, truncated: true, total });
    }
    const room = await makeRoom(c, Math.ceil(packed.length * 1.1) + 4096, dom);
    if (!room.ok) return { ok: false, error: fullMessage(room), evicted: room.evicted };
    const meta = {
      domain: dom,
      count: products.length,
      total,
      truncated: products.length < total,
      at: data.fetchedAt || Date.now(),
      lang: data.lang || "en",
      bestSelling: data.bestSellingStatus || "onbekend",
      partial: !!data.partial,
      kb: Math.round(packed.length / 1024),
    };
    // Geen EX: blijft staan tot verversen, verwijderen of wissen
    await setSafe(c, dataKey(dom), packed, dom);
    await setSafe(c, metaKey(dom), JSON.stringify(meta), dom);
    return { ok: true, meta, evicted: room.evicted };
  } catch (e) {
    return { ok: false, error: String(e.message || e), evicted: [] };
  }
}

export async function deleteCatalog(dom) {
  try {
    const c = await getClient();
    if (!c) return;
    await c.del([dataKey(dom), metaKey(dom)]);
  } catch {}
}

// Alle catalogi weg (alle key-versies), lijst en meta blijven staan.
// DEL mag ook als Redis vol zit — dit is de noodknop.
export async function clearAllCatalogs() {
  const c = await getClient();
  if (!c) return { ok: false, error: "geen REDIS_URL" };
  const before = await memory(c);
  const keys = [...(await scanKeys(c, "cat:*")), ...(await scanKeys(c, "catmeta:*"))];
  const stores = keys.filter((k) => k.startsWith("catmeta:")).length;
  const deleted = await delKeys(c, keys);
  const after = await memory(c);
  return {
    ok: true,
    stores,
    keys: deleted,
    freedMb: mb(Math.max(0, before.used - after.used)),
    stats: { usedMb: mb(after.used), maxMb: after.max ? mb(after.max) : null, catalogs: 0, catalogMb: 0 },
  };
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

// Geheugengebruik van Redis + aandeel van de catalogi, voor de UI
export async function cacheStats() {
  try {
    const c = await getClient();
    if (!c) return null;
    const m = await memory(c);
    const cats = await listCatalogs(c);
    const catBytes = cats.reduce((s, x) => s + (x.bytes || 0), 0);
    let breakdown = null;
    try {
      const b = await memoryBreakdown(c);
      breakdown = { catalogiMb: mb(b.catalogi), bronIndexenMb: mb(b.bronIndexen), sizeGuideMb: mb(b.sizeGuide), geheugenMb: mb(b.geheugen), competitorsMb: mb(b.competitors), todosMb: mb(b.todos), overigMb: mb(b.overig), keys: b.keys };
    } catch {}
    return {
      usedMb: mb(m.used),
      maxMb: m.max ? mb(m.max) : null,
      budgetMb: m.max ? mb(m.budget) : null,
      catalogs: cats.length,
      catalogMb: mb(catBytes),
      breakdown,
    };
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
  await setSafe(c, LIST_KEY, JSON.stringify(list), null);
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
  await setSafe(c, META_KEY, JSON.stringify(cur), null);
  return cur;
}
