// COMPETITOR FINDER — kleine Redis-helper. Zelfde database als de rest van
// de tool: redisUrl() uit lib/redis-url.js (STORAGE2_REDIS_URL, anders
// REDIS_URL — de kale REDIS_URL is sinds 15-10 de OUDE database en hangt).
// Eén gedeelde verbinding, JSON in/uit; verbinden met een harde timeout
// zodat een hangende Redis nooit een 504 oplevert.
import { createClient } from "redis";
import { redisUrl } from "./redis-url.js";

let clientPromise = null;
let lastFail = 0; // mislukte verbinding → 30 s niet opnieuw proberen (anders 24× wachten in "info")

export function finderRedisAvailable() {
  return !!redisUrl();
}

export function redis() {
  const url = redisUrl();
  if (!url) return null;
  if (!clientPromise && Date.now() - lastFail < 30000) return Promise.reject(new Error("Redis onbereikbaar (even geleden mislukt)"));
  if (!clientPromise) {
    const c = createClient({ url, socket: { connectTimeout: 8000, reconnectStrategy: (n) => (n > 3 ? new Error("Redis onbereikbaar") : Math.min(200 * n, 1000)) } });
    c.on("error", (err) => console.error("Redis error (finder):", err));
    clientPromise = c.connect().then(() => c).catch((e) => {
      clientPromise = null; // volgende aanroep probeert opnieuw (na 30 s)
      lastFail = Date.now();
      throw e;
    });
  }
  return clientPromise;
}

export async function getJSON(key, fallback = null) {
  try {
    const c = await redis();
    if (!c) return fallback;
    const raw = await c.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function setJSON(key, value, ttlSec) {
  const c = await redis();
  if (!c) return false;
  const opts = ttlSec ? { EX: ttlSec } : undefined;
  await c.set(key, JSON.stringify(value), opts);
  return true;
}

export async function delKey(key) {
  try {
    const c = await redis();
    if (!c) return;
    await c.del(key);
  } catch {}
}

/** Atomaire lock (NX + TTL) — true als wij 'm hebben. */
export async function acquire(key, id, ttlSec) {
  const c = await redis();
  if (!c) return false;
  const r = await c.set(key, id, { NX: true, EX: ttlSec });
  return r === "OK";
}

export async function release(key, id) {
  try {
    const c = await redis();
    if (!c) return;
    const cur = await c.get(key);
    if (cur === id) await c.del(key);
  } catch {}
}
