// COMPETITOR FINDER — kleine Redis-helper (zelfde REDIS_URL als de rest van
// de tool). Eén gedeelde verbinding, JSON in/uit. Zonder REDIS_URL werkt de
// finder niet (de job-voortgang en het "al gezien"-geheugen staan hierin).
import { createClient } from "redis";

let clientPromise = null;

export function finderRedisAvailable() {
  return !!process.env.REDIS_URL;
}

export function redis() {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    const c = createClient({ url: process.env.REDIS_URL });
    c.on("error", (err) => console.error("Redis error (finder):", err));
    clientPromise = c.connect().then(() => c);
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
