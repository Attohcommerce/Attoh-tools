// CLAUDE-KOPPELING (13-11-2026): één koppeling voor Claude naar ALLE stores.
// De store-koppelingen staan normaal alleen in de browser (sa_stores). Via de
// pagina /claude zet Justin ze één keer klaar in Redis; daarna kan Claude via
// /api/mcp (eigen connector in claude.ai) in elke store werken zonder
// steeds de Shopify-koppeling te wisselen. Beveiligd met een geheime sleutel.
import crypto from "crypto";
import { getRedis } from "./kw-memory";
import { cleanDomain } from "./shopify";

const K = {
  stores: "claude:stores", // hash: domein → store-koppeling (alleen server)
  key: "claude:mcpkey",
};

export async function mcpKey({ rotate = false } = {}) {
  const r = await getRedis();
  let k = rotate ? null : await r.get(K.key);
  if (!k) {
    k = "mcp_" + crypto.randomBytes(24).toString("hex");
    await r.set(K.key, k);
  }
  return k;
}

export async function checkMcpKey(given) {
  const r = await getRedis();
  const k = await r.get(K.key);
  if (!k || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(k);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function saveStores(list) {
  const r = await getRedis();
  const clean = (Array.isArray(list) ? list : []).filter((s) => s && s.domain && (s.token || (s.clientId && s.clientSecret)));
  await r.del(K.stores);
  for (const s of clean) {
    await r.hSet(K.stores, cleanDomain(s.domain), JSON.stringify({ name: s.name || "", domain: s.domain, currency: s.currency || "", token: s.token || "", clientId: s.clientId || "", clientSecret: s.clientSecret || "" }));
  }
  return clean.length;
}

export async function getStores() {
  const r = await getRedis();
  const h = (await r.hGetAll(K.stores)) || {};
  return Object.values(h).map((v) => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
}

// Store zoeken op naam, afkorting of domein ("LGB", "lady glam", "ladyglamboutique.com", "xxx.myshopify.com")
const ALIAS = { ssb: "soul society", lgb: "lady glam", emc: "everman", sw: "shapes wardrobe", cc: "clove", cac: "clove", pull: "pull society", sbk: "styled by karen", ccout: "consistent couture" };
export function findStore(stores, q) {
  const s = String(q || "").toLowerCase().trim();
  if (!s) return null;
  const want = ALIAS[s] || s;
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    stores.find((x) => cleanDomain(x.domain) === cleanDomain(s)) ||
    stores.find((x) => norm(x.name) === norm(want)) ||
    stores.find((x) => norm(x.name).includes(norm(want)) || norm(x.domain).includes(norm(want))) ||
    null
  );
}
