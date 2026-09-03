// Match-cache voor de Size Guide: Shopify-product → gevonden AliExpress-ID.
// In Redis (zelfde REDIS_URL als het To Do-board), key sg:match:<domein>:<productId>,
// 120 dagen. Zonder REDIS_URL werkt alles gewoon — dan zonder cache (elke
// herhaalde run zoekt opnieuw en kost dus weer een image-search).
import { createClient } from "redis";

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

const TTL = 60 * 60 * 24 * 120;
const key = (domain, productId) => `sg:match:${String(domain || "").toLowerCase()}:${String(productId)}`;

export async function getCachedMatch(domain, productId) {
  try {
    const c = await getClient();
    if (!c) return null;
    const raw = await c.get(key(domain, productId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setCachedMatch(domain, productId, value) {
  try {
    const c = await getClient();
    if (!c) return;
    await c.set(key(domain, productId), JSON.stringify(value), { EX: TTL });
  } catch {}
}

export async function clearCachedMatch(domain, productId) {
  try {
    const c = await getClient();
    if (!c) return;
    await c.del(key(domain, productId));
  } catch {}
}

/* Generieke JSON-cache (bron-store-indexen, domeinlijst) — zelfde Redis. */
export async function cacheGetJson(k) {
  try {
    const c = await getClient();
    if (!c) return null;
    const raw = await c.get(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function cacheSetJson(k, value, ttlSec) {
  try {
    const c = await getClient();
    if (!c) return false;
    await c.set(k, JSON.stringify(value), { EX: Math.max(60, Number(ttlSec) || 3600) });
    return true;
  } catch {
    return false;
  }
}

export function cacheAvailable() {
  return !!process.env.REDIS_URL;
}
