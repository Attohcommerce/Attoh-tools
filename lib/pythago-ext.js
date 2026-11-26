// PYTHAGO EXTERN (26-11-2026): Pythago delen met externe mensen (bijv. Cas,
// media buyer van Shapes Wardrobe) zonder dat ze in de rest van Attoh Tools
// kunnen. Zo werkt het:
//   - Justin maakt in Pythago (knop "Extern") een externe gebruiker aan: naam,
//     e-mail en welke store(s) hij mag zien. Die krijgt een eigen link
//     /px/<token>. Inloggen = link openen + eigen e-mailadres invullen, geen
//     wachtwoord. Sessie in een EIGEN cookie (attoh_px_session), dus de
//     gewone Attoh Tools-login (sa_tools_session) krijgt hij nooit.
//   - De store-koppeling staat op de server (pythago:ext:conn, bijgewerkt
//     vanuit Justins browser bij opslaan en bij elke sync), dus de externe
//     gebruiker hoeft niets te koppelen.
//   - Alles wat hij doet (sync, status, notities, filters, inloggen) komt in
//     een logboek per store; zijn opgeslagen filters staan bij Justin onder
//     "Opgeslagen filters" met "van <naam>".
import crypto from "crypto";
import { getRedis } from "./kw-memory";
import { cleanDomain } from "./shopify";
import { nsKey, normOrg } from "./org";
import { autoGet, loadData } from "./pythago-sync";
import { getStores, findStore } from "./claude-link";

export const PX_DEFAULT_ADS_SHEET = "1xac7M4--kCb2DKShQy7s2A13sgfl4NxW8CXbLGW4H8o";
const KNOWN = [
  { key: "SSB", match: /soul\s*society|0d6n10-zj/i },
  { key: "LGB", match: /lady\s*glam|lornvale|hu9f6r-ee/i },
  { key: "EMC", match: /everman|va3wjr-27/i },
  { key: "SW", match: /shapes\s*wardrobe|shapeswardrobe|6snnji-kr/i },
  { key: "CC", match: /clove|dyjxwd-p0/i },
];
const guessKey = (s) => {
  const hay = `${(s && s.name) || ""} ${(s && s.domain) || ""}`;
  const hit = KNOWN.find((k) => k.match.test(hay));
  return hit ? hit.key : "";
};

const K = {
  users: "pythago:ext:users", // hash: id → json
  conn: (org, d) => nsKey(org, `pythago:ext:conn:${cleanDomain(d)}`),
  log: (org, d) => nsKey(org, `pythago:ext:log:${cleanDomain(d)}`),
  fail: (t) => `pythago:ext:fail:${String(t).slice(0, 64)}`,
};
const MAX_LOG = 400;

const normEmail = (e) => String(e || "").trim().toLowerCase();
const newToken = () => crypto.randomBytes(18).toString("base64url");
const newId = () => `px${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;

function sameToken(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- gebruikers ---------- */
export async function extList() {
  const r = await getRedis();
  const all = (await r.hGetAll(K.users)) || {};
  return Object.values(all)
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}
export async function extGet(id) {
  if (!id) return null;
  const r = await getRedis();
  const v = await r.hGet(K.users, String(id));
  return v ? JSON.parse(v) : null;
}
export async function extByToken(token) {
  if (!token || String(token).length < 16) return null;
  const list = await extList();
  return list.find((u) => sameToken(u.token, token)) || null;
}
async function put(u) {
  const r = await getRedis();
  await r.hSet(K.users, u.id, JSON.stringify(u));
  return u;
}

/** Nieuw of bijwerken. stores = lijst domeinen. */
export async function extSave(input, { org, by } = {}) {
  const name = String(input.name || "").trim().slice(0, 60);
  const email = normEmail(input.email);
  if (!name) throw Object.assign(new Error("Vul een naam in"), { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error("Vul een geldig e-mailadres in"), { status: 400 });
  const stores = [...new Set((Array.isArray(input.stores) ? input.stores : []).map((d) => cleanDomain(d)).filter(Boolean))];
  if (!stores.length) throw Object.assign(new Error("Kies minstens één store"), { status: 400 });
  const list = await extList();
  if (list.some((u) => u.email === email && u.id !== input.id)) throw Object.assign(new Error("Dit e-mailadres heeft al toegang"), { status: 400 });
  const old = input.id ? list.find((u) => u.id === input.id) : null;
  const u = {
    ...(old || {}),
    id: old ? old.id : newId(),
    name,
    email,
    stores,
    org: normOrg((old && old.org) || org),
    canEdit: input.canEdit !== false,
    disabled: !!input.disabled,
    token: (old && old.token) || newToken(),
    createdAt: (old && old.createdAt) || new Date().toISOString(),
    createdBy: (old && old.createdBy) || by || "",
    updatedAt: new Date().toISOString(),
  };
  return put(u);
}
export async function extDelete(id) {
  const r = await getRedis();
  await r.hDel(K.users, String(id));
}
export async function extResetToken(id) {
  const u = await extGet(id);
  if (!u) throw Object.assign(new Error("Gebruiker niet gevonden"), { status: 404 });
  u.token = newToken();
  u.updatedAt = new Date().toISOString();
  return put(u);
}
export async function extTouch(u, ip) {
  if (!u) return;
  const last = Date.parse(u.lastSeen || 0) || 0;
  if (Date.now() - last < 5 * 60 * 1000) return;
  await put({ ...u, lastSeen: new Date().toISOString(), lastIp: ip || u.lastIp || "" }).catch(() => {});
}
/** Zijn er externe gebruikers voor deze store? (dan bewaren we de koppeling bij elke sync) */
export async function extSharesDomain(domain) {
  const d = cleanDomain(domain);
  return (await extList()).some((u) => (u.stores || []).includes(d));
}

/* ---------- mislukte logins (tegen raden) ---------- */
export async function extFailCount(token) {
  const r = await getRedis();
  return Number(await r.get(K.fail(token))) || 0;
}
export async function extFail(token) {
  const r = await getRedis();
  const n = await r.incr(K.fail(token));
  if (n === 1) await r.expire(K.fail(token), 15 * 60);
  return n;
}
export async function extFailReset(token) {
  const r = await getRedis();
  await r.del(K.fail(token));
}

/* ---------- store-koppeling op de server ---------- */
export async function connSave(org, domain, cfg) {
  if (!cfg || !cfg.store || !(cfg.store.token || (cfg.store.clientId && cfg.store.clientSecret))) return false;
  const r = await getRedis();
  const clean = {
    store: { name: cfg.store.name || "", domain: cfg.store.domain || domain, currency: cfg.store.currency || "", token: cfg.store.token || "", clientId: cfg.store.clientId || "", clientSecret: cfg.store.clientSecret || "", publicDomain: cfg.store.publicDomain || "" },
    ordersStore: cfg.ordersStore && (cfg.ordersStore.token || (cfg.ordersStore.clientId && cfg.ordersStore.clientSecret)) ? cfg.ordersStore : null,
    adsSheetId: cfg.adsSheetId || PX_DEFAULT_ADS_SHEET,
    key: String(cfg.key || "").toUpperCase(),
    settings: cfg.settings && typeof cfg.settings === "object" ? cfg.settings : {},
    savedAt: new Date().toISOString(),
  };
  await r.set(K.conn(org, domain), JSON.stringify(clean));
  return true;
}
async function connGet(org, domain) {
  const r = await getRedis();
  const v = await r.get(K.conn(org, domain));
  return v ? JSON.parse(v) : null;
}

/**
 * Volledige koppeling voor een gedeelde store, alleen op de server:
 * 1) wat Justins browser bewaarde, 2) de auto-sync-koppeling, 3) de
 * Claude-koppeling (alle stores) met standaardinstellingen.
 */
export async function extCfg(org, domain) {
  const d = cleanDomain(domain);
  const conn = await connGet(org, d).catch(() => null);
  if (conn && conn.store) return { ...conn, from: "pythago" };
  // instellingen + sleutel van Justins laatste sync (staan in de opgeslagen data)
  const last = await loadData(org, d).catch(() => null);
  const lastSettings = last && last.settings ? Object.fromEntries(Object.entries(last.settings).filter(([k]) => k !== "breakEvenRoas")) : {};
  const lastKey = (last && last.store && last.store.key) || "";
  const auto = await autoGet(org, d).catch(() => null);
  if (auto && auto.store) return { store: auto.store, ordersStore: auto.ordersStore || null, adsSheetId: auto.adsSheetId || PX_DEFAULT_ADS_SHEET, key: auto.key || lastKey || guessKey(auto.store), settings: auto.settings && Object.keys(auto.settings).length ? auto.settings : lastSettings, from: "auto" };
  const reg = await getStores().catch(() => []);
  const s = reg.find((x) => cleanDomain(x.domain) === d) || findStore(reg, d);
  if (s) return { store: s, ordersStore: null, adsSheetId: PX_DEFAULT_ADS_SHEET, key: lastKey || guessKey(s), settings: lastSettings, from: "claude" };
  return null;
}

/** Wat de externe gebruiker van een store mag weten (geen sleutels). */
export function publicStore(cfg, domain) {
  const s = (cfg && cfg.store) || {};
  return {
    name: s.name || domain,
    domain: cleanDomain(s.domain || domain),
    currency: s.currency || "",
    publicDomain: s.publicDomain || "",
    key: (cfg && cfg.key) || "",
    settings: (cfg && cfg.settings) || {},
    ready: !!(cfg && cfg.store && cfg.key),
  };
}

/* ---------- logboek ---------- */
export async function logAdd(org, domain, entry) {
  try {
    const r = await getRedis();
    const k = K.log(org, domain);
    await r.lPush(k, JSON.stringify({ at: new Date().toISOString(), ...entry }));
    await r.lTrim(k, 0, MAX_LOG - 1);
  } catch {}
}
export async function logList(org, domain, n = 100) {
  const r = await getRedis();
  const list = (await r.lRange(K.log(org, domain), 0, Math.max(0, n - 1))) || [];
  return list
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Stores die de server kent (Claude-koppeling) — alleen naam + domein, voor de keuzelijst bij "Extern". */
export async function knownStores() {
  const reg = await getStores().catch(() => []);
  return reg.map((x) => ({ name: x.name || x.domain, domain: cleanDomain(x.domain) })).filter((x) => x.domain);
}
