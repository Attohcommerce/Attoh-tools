// POKÉMON TOOL — opslag in Redis (zelfde database als de rest van Attoh
// Tools, via lib/finder-redis.js). Alles onder het voorvoegsel "pk:".
//
//   pk:comps              → lijst concurrenten [{domain, platform, count, …}]
//   pk:cat:<domein>       → gescrapete Pokémon-producten (gzip, base64)
//   pk:gen:<domein>       → voortgang van een sitemap-scrape (overige platforms)
//   pk:imp:<store>        → wat er al in onze store staat {key → {id, handle, …}}
//   pk:settings           → laatste instellingen van de importer
import { gzipSync, gunzipSync } from "zlib";
import { redis, getJSON, setJSON, delKey, finderRedisAvailable } from "../finder-redis.js";
import { cleanDomain } from "./scrape";

export const pkRedisAvailable = finderRedisAvailable;

export async function getComps() {
  return (await getJSON("pk:comps", [])) || [];
}

export async function saveComps(list) {
  await setJSON("pk:comps", list);
  return list;
}

export async function upsertComp(patch) {
  const d = cleanDomain(patch.domain);
  const list = await getComps();
  const i = list.findIndex((c) => c.domain === d);
  const next = { ...(i >= 0 ? list[i] : { addedAt: Date.now() }), ...patch, domain: d };
  if (i >= 0) list[i] = next;
  else list.push(next);
  await saveComps(list);
  return next;
}

export async function removeComp(domain) {
  const d = cleanDomain(domain);
  await saveComps((await getComps()).filter((c) => c.domain !== d));
  await delKey(`pk:cat:${d}`);
  await delKey(`pk:gen:${d}`);
}

export async function writeCatalog(domain, products) {
  const c = await redis();
  if (!c) throw new Error("Redis niet ingesteld");
  const buf = gzipSync(Buffer.from(JSON.stringify(products)));
  await c.set(`pk:cat:${cleanDomain(domain)}`, buf.toString("base64"));
  return Math.round(buf.length / 1024);
}

export async function readCatalog(domain) {
  try {
    const c = await redis();
    if (!c) return [];
    const raw = await c.get(`pk:cat:${cleanDomain(domain)}`);
    if (!raw) return [];
    return JSON.parse(gunzipSync(Buffer.from(raw, "base64")).toString("utf8"));
  } catch {
    return [];
  }
}

export async function getGenState(domain) {
  return getJSON(`pk:gen:${cleanDomain(domain)}`, null);
}
export async function setGenState(domain, state) {
  // 3 dagen bewaren — daarna opnieuw de sitemap lezen
  return setJSON(`pk:gen:${cleanDomain(domain)}`, state, 3 * 86400);
}
export async function clearGenState(domain) {
  return delKey(`pk:gen:${cleanDomain(domain)}`);
}

/* ---------- Importlog per store ---------- */

const impKey = (store) => `pk:imp:${cleanDomain(store)}`;

export async function getImported(store) {
  return (await getJSON(impKey(store), {})) || {};
}

export async function markImported(store, entries) {
  // entries: { key: {id, handle, title, at, src, srcText} }
  const cur = await getImported(store);
  Object.assign(cur, entries);
  await setJSON(impKey(store), cur);
  return cur;
}

/** Importlog helemaal leeg (Opnieuw beginnen). */
export async function clearImported(store) {
  await setJSON(impKey(store), {});
}

export async function unmarkImported(store, keys) {
  const cur = await getImported(store);
  for (const k of keys) delete cur[k];
  await setJSON(impKey(store), cur);
  return cur;
}

export async function getSettings() {
  return (await getJSON("pk:settings", null)) || null;
}
export async function saveSettings(s) {
  return setJSON("pk:settings", s);
}

/* ---------- Importlijst (09-11-2026) ---------- */

export async function getList() {
  return getJSON("pk:list", null);
}
export async function saveList(rows) {
  return setJSON("pk:list", rows);
}
export async function clearList() {
  return delKey("pk:list");
}
