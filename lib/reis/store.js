// Opslag Reisplanner — dezelfde Redis als de rest van Attoh Tools.
// Keys (allemaal met prefix "reis:"):
//   reis:trips            → JSON-lijst van opgeslagen reizen (gedeeld, met eigenaar)
//   reis:prefs            → { justin: {tags, dests}, quinty: {...} } smaakprofiel
//   reis:cache:<hash>     → API-antwoorden (vluchten/hotels), met TTL
//   reis:vision:<hotelId> → AI-fotoscore per hotel (30 dagen)
import { createClient } from "redis";
import { redisUrl } from "../redis-url.js";

let clientPromise = null;
function getClient() {
  if (!redisUrl()) return null;
  if (!clientPromise) {
    const client = createClient({ url: redisUrl() });
    client.on("error", (err) => console.error("Redis (reis) error:", err));
    clientPromise = client.connect().then(() => client).catch((e) => {
      clientPromise = null;
      throw e;
    });
  }
  return clientPromise;
}

// Zonder Redis (lokaal) gewoon in het geheugen van het proces.
const mem = new Map();

export async function kvGet(key) {
  try {
    const p = getClient();
    if (!p) {
      const v = mem.get(key);
      if (!v) return null;
      if (v.exp && v.exp < Date.now()) { mem.delete(key); return null; }
      return v.val;
    }
    const c = await p;
    const raw = await c.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("kvGet", key, e.message);
    return null;
  }
}

export async function kvSet(key, val, ttlSec) {
  try {
    const p = getClient();
    if (!p) {
      mem.set(key, { val, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
      return;
    }
    const c = await p;
    if (ttlSec) await c.set(key, JSON.stringify(val), { EX: ttlSec });
    else await c.set(key, JSON.stringify(val));
  } catch (e) {
    console.error("kvSet", key, e.message);
  }
}

// Cache-helper: haalt uit cache of draait fn() en bewaart het resultaat.
export async function cached(key, ttlSec, fn) {
  const hit = await kvGet("reis:cache:" + key);
  if (hit !== null && hit !== undefined) return hit;
  const val = await fn();
  if (val !== null && val !== undefined) await kvSet("reis:cache:" + key, val, ttlSec);
  return val;
}

// ── Opgeslagen reizen ────────────────────────────────────────────────
function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listTrips() {
  const list = (await kvGet("reis:trips")) || [];
  return Array.isArray(list) ? list : [];
}

export async function saveTrip(owner, savedBy, result, search) {
  const list = await listTrips();
  // Zelfde reis nog eens bewaren = geen dubbele, alleen stem erbij
  const same = result && result.id ? list.find((x) => x.result && x.result.id === result.id) : null;
  if (same) {
    same.votes = { ...(same.votes || {}), [savedBy]: true };
    if (owner) same.owner = owner; // "bewaar bij Quinty" verplaatst hem naar Quinty
    await kvSet("reis:trips", list);
    return same;
  }
  const trip = {
    id: newId(),
    owner, // "justin" | "quinty" — bij wie hij is opgeslagen
    savedBy,
    createdAt: new Date().toISOString(),
    alert: true,
    status: "idee",
    votes: { [savedBy]: true },
    packing: null,
    booking: null,
    result,
    search: search || null,
    priceHistory: [{ at: new Date().toISOString(), total: result && result.total }],
    note: "",
  };
  list.unshift(trip);
  await kvSet("reis:trips", list.slice(0, 300));
  return trip;
}

const STATUSES = ["idee", "favoriet", "geboekt"];

// patch kan bevatten: owner, alert, note (string), status, vote {user, value},
// packing (hele lijst), booking {flightRef, hotelRef, extra}, pricePoint.
export async function updateTrip(id, patch) {
  const list = await listTrips();
  const t = list.find((x) => x.id === id);
  if (!t) throw new Error("Reis niet gevonden");
  for (const k of ["owner", "alert"]) if (patch[k] !== undefined) t[k] = patch[k];
  if (patch.note !== undefined) t.note = String(patch.note || "").slice(0, 4000);
  if (patch.status !== undefined && STATUSES.includes(patch.status)) {
    t.status = patch.status;
    if (patch.status === "geboekt") t.bookedAt = t.bookedAt || new Date().toISOString();
  }
  if (patch.vote && patch.vote.user) {
    t.votes = { ...(t.votes || {}), [patch.vote.user]: Boolean(patch.vote.value) };
  }
  if (Array.isArray(patch.packing)) {
    t.packing = patch.packing
      .filter((x) => x && x.text)
      .slice(0, 200)
      .map((x) => ({ id: String(x.id || Math.random().toString(36).slice(2, 9)), text: String(x.text).slice(0, 80), done: Boolean(x.done), cat: String(x.cat || "Overig").slice(0, 30), by: x.by || "" }));
  }
  if (patch.booking) {
    const b = patch.booking;
    t.booking = {
      flightRef: String(b.flightRef || "").slice(0, 60),
      hotelRef: String(b.hotelRef || "").slice(0, 60),
      extra: String(b.extra || "").slice(0, 500),
    };
  }
  if (patch.pricePoint) {
    t.priceHistory = [...(t.priceHistory || []), patch.pricePoint].slice(-60);
  }
  await kvSet("reis:trips", list);
  return t;
}

export async function deleteTrip(id) {
  const list = await listTrips();
  await kvSet("reis:trips", list.filter((x) => x.id !== id));
}

// ── Smaakprofiel ("het algoritme leert") ─────────────────────────────
// Elke bewaarde reis / hartje = +, duimpje omlaag = −. Per persoon en
// samen. Engine gebruikt het als kleine boost op de match-score.
export async function getPrefs() {
  return (await kvGet("reis:prefs")) || { justin: { tags: {}, dests: {} }, quinty: { tags: {}, dests: {} } };
}

export async function learn(userId, destId, tags, weight) {
  const prefs = await getPrefs();
  const p = prefs[userId] || (prefs[userId] = { tags: {}, dests: {} });
  p.dests[destId] = Math.max(-5, Math.min(10, (p.dests[destId] || 0) + weight));
  for (const t of tags || []) p.tags[t] = Math.max(-5, Math.min(15, (p.tags[t] || 0) + weight * 0.5));
  await kvSet("reis:prefs", prefs);
  return prefs;
}
