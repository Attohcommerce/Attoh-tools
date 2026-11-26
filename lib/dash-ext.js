// DASHBOARD MOBIEL (26-11-2026): het omzet-dashboard op de telefoon via een
// eigen link, zonder de gewone login en zonder sleutels in te vullen.
//   - Justin maakt in het dashboard (⚙ → Telefoonlink) een link voor een
//     e-mailadres. Inloggen = link openen + dat e-mailadres invullen, geen
//     wachtwoord. Sessie in een EIGEN cookie (attoh_dash_session).
//   - De store-koppelingen staan op de server: 1) wat Justins browser bewaart
//     zodra hij het dashboard op de pc opent (zelfde stores, sleutels en
//     Ads-sheet), 2) aangevuld met de Claude-koppeling (alle stores).
//   - Alleen kijken: /api/m kan geen enkele store wijzigen.
import crypto from "crypto";
import { getRedis } from "./kw-memory";
import { cleanDomain } from "./shopify";
import { getStores } from "./claude-link";
import { guessKey as baseGuess } from "./dashboard";
import { visibleStores } from "./store-scope";

export const DASH_DEFAULT_ADS_SHEET = "1xac7M4--kCb2DKShQy7s2A13sgfl4NxW8CXbLGW4H8o"; // Attoh Ads Live
const EXTRA_KEYS = [
  { key: "LGB", match: /season\s*of\s*style|hu9f6r-ee/i },
  { key: "EMC", match: /va3wjr-27/i },
  { key: "CAC", match: /clove/i },
  { key: "CCOU", match: /consistent\s*couture/i },
  { key: "COC", match: /code\s*of\s*clothes/i },
  { key: "PTL", match: /pierre/i },
  { key: "SBK", match: /styled?\s*by\s*karen/i },
];
function guessKey(s) {
  const k = baseGuess(s);
  if (k) return k;
  const hay = `${(s && s.name) || ""} ${(s && s.domain) || ""}`;
  const hit = EXTRA_KEYS.find((x) => x.match.test(hay));
  return hit ? hit.key : "";
}

const K = {
  users: "dash:ext:users", // hash: id → json
  conn: "dash:ext:conn", // json: { stores, adsSheetId, savedAt }
  fail: (t) => `dash:ext:fail:${String(t).slice(0, 64)}`,
};

const normEmail = (e) => String(e || "").trim().toLowerCase();
const newToken = () => crypto.randomBytes(18).toString("base64url");
const newId = () => `dm${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
function sameToken(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
const hasCreds = (s) => !!(s && (s.token || (s.clientId && s.clientSecret)));

/** Vingerafdruk van de link in de sessie: nieuwe link → oude sessies vervallen. */
export const tokenMark = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex").slice(0, 16);

/* ---------- links ---------- */
export async function dashList() {
  const r = await getRedis();
  const all = (await r.hGetAll(K.users)) || {};
  return Object.values(all)
    .map((v) => { try { return JSON.parse(v); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}
export async function dashGet(id) {
  if (!id) return null;
  const r = await getRedis();
  const v = await r.hGet(K.users, String(id));
  return v ? JSON.parse(v) : null;
}
export async function dashByToken(token) {
  if (!token || String(token).length < 16) return null;
  return (await dashList()).find((u) => sameToken(u.token, token)) || null;
}
async function put(u) {
  const r = await getRedis();
  await r.hSet(K.users, u.id, JSON.stringify(u));
  return u;
}
/** Nieuwe link voor een e-mailadres (bestaat het al, dan krijg je dezelfde link terug). */
export async function dashCreate(emailIn, by) {
  const email = normEmail(emailIn);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error("Vul een geldig e-mailadres in"), { status: 400 });
  const old = (await dashList()).find((u) => u.email === email);
  if (old) return old;
  return put({ id: newId(), email, token: newToken(), createdAt: new Date().toISOString(), createdBy: by || "" });
}
export async function dashReset(id) {
  const u = await dashGet(id);
  if (!u) throw Object.assign(new Error("Link niet gevonden"), { status: 404 });
  return put({ ...u, token: newToken(), updatedAt: new Date().toISOString() });
}
export async function dashDelete(id) {
  const r = await getRedis();
  await r.hDel(K.users, String(id));
}
export async function dashTouch(u, ip) {
  if (!u) return;
  const last = Date.parse(u.lastSeen || 0) || 0;
  if (Date.now() - last < 5 * 60 * 1000) return;
  await put({ ...u, lastSeen: new Date().toISOString(), lastIp: ip || u.lastIp || "" }).catch(() => {});
}

/* ---------- mislukte logins (tegen raden) ---------- */
export async function dashFailCount(token) {
  const r = await getRedis();
  return Number(await r.get(K.fail(token))) || 0;
}
export async function dashFail(token) {
  const r = await getRedis();
  const n = await r.incr(K.fail(token));
  if (n === 1) await r.expire(K.fail(token), 15 * 60);
  return n;
}
export async function dashFailReset(token) {
  const r = await getRedis();
  await r.del(K.fail(token));
}

/* ---------- store-koppelingen op de server ---------- */
/** Vanuit Justins browser: de stores die op het dashboard aan staan, met hun koppeling. */
export async function connSave({ stores, cfStores, adsSheetId }) {
  const cf = new Map((Array.isArray(cfStores) ? cfStores : []).map((s) => [cleanDomain(s.domain), s]));
  const clean = (Array.isArray(stores) ? stores : [])
    .filter((s) => s && s.domain && hasCreds(s))
    .map((s) => {
      const c = cf.get(cleanDomain(s.domain));
      return {
        key: String(s.key || "").toUpperCase(), name: s.name || "", domain: s.domain, currency: s.currency || "",
        token: s.token || "", clientId: s.clientId || "", clientSecret: s.clientSecret || "",
        cf: hasCreds(c) ? { token: c.token || "", clientId: c.clientId || "", clientSecret: c.clientSecret || "" } : null,
      };
    });
  if (!clean.length) return 0;
  const r = await getRedis();
  await r.set(K.conn, JSON.stringify({ stores: clean, adsSheetId: adsSheetId || DASH_DEFAULT_ADS_SHEET, savedAt: new Date().toISOString() }));
  return clean.length;
}
async function connGet() {
  const r = await getRedis();
  const v = await r.get(K.conn);
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}

/**
 * Alle stores voor het telefoon-dashboard, MET sleutels (alleen op de server).
 * Eerst wat de pc bewaarde (die staan standaard aan), daarna de overige stores
 * uit de Claude-koppeling (aan als we de Ads-sleutel kennen).
 */
export async function serverStores() {
  const conn = await connGet().catch(() => null);
  const out = [];
  const seen = new Set();
  for (const s of (conn && conn.stores) || []) {
    const d = cleanDomain(s.domain);
    if (seen.has(d)) continue;
    seen.add(d);
    out.push({ ...s, on: true, from: "pc" });
  }
  const reg = visibleStores(await getStores().catch(() => []), "fashion");
  for (const s of reg) {
    const d = cleanDomain(s.domain);
    if (!d || seen.has(d) || !hasCreds(s)) continue;
    seen.add(d);
    const key = guessKey(s);
    out.push({ key, name: s.name || d, domain: s.domain, currency: s.currency || "", token: s.token || "", clientId: s.clientId || "", clientSecret: s.clientSecret || "", cf: null, on: Boolean(key), from: "claude" });
  }
  return { stores: out, adsSheetId: (conn && conn.adsSheetId) || DASH_DEFAULT_ADS_SHEET, savedAt: (conn && conn.savedAt) || "" };
}

/** Wat de telefoon van een store mag weten (geen sleutels). */
export const publicStore = (s) => ({ key: s.key || "", name: s.name || s.domain, domain: s.domain, currency: s.currency || "", on: !!s.on });

/** Kies de gevraagde stores (op domein) en geef ze terug in de vorm die storeRange / storePayouts verwacht. */
export function pick(all, domains, kind) {
  const want = new Set((Array.isArray(domains) ? domains : []).map((d) => cleanDomain(d)));
  return all
    .filter((s) => want.has(cleanDomain(s.domain)))
    .map((s) => {
      const c = kind === "cashflow" && s.cf ? s.cf : s;
      return { key: s.key, name: s.name, domain: s.domain, currency: s.currency, token: c.token || undefined, clientId: c.token ? undefined : c.clientId, clientSecret: c.token ? undefined : c.clientSecret };
    });
}
