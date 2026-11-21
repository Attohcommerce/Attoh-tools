// CHAIM GENERAL STORES (19-11-2026) — main unit voor Chaims general store(s).
// Eén gedeelde staat in Redis (sc:cgs:state): afgevinkte stappen, status per
// markt, logboek en de stores. Zo is het overal hetzelfde (pc, laptop,
// telefoon) — niet in localStorage.
import { createClient } from "redis";
import { redisUrl } from "./redis-url.js";

const KEY = "sc:cgs:state";
const MAX_BYTES = 200_000;

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    if (!redisUrl()) throw new Error("REDIS_URL env var ontbreekt");
    const client = createClient({ url: redisUrl() });
    client.on("error", (err) => console.error("Redis error:", err));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

export const DEFAULT_STATE = {
  stores: [
    { name: "Oceisa", domain: "7g0gsy-ng.myshopify.com", market: "FR", currency: "EUR" },
  ],
  done: {},
  markets: { FR: "focus" },
  log: [],
  links: [
    { label: "Competitor sheet General stores", url: "https://docs.google.com/spreadsheets/d/1ws-MSNCrd0awV5nVMWNOQcVnFu6KFHZ-uxDvU9towFI/edit" },
    { label: "Thema-referentie: thomler.com", url: "https://thomler.com/" },
  ],
};

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/** Alleen bekende velden, met limieten — wat de client stuurt wordt nooit blind opgeslagen. */
export function cleanState(input) {
  const s = input && typeof input === "object" ? input : {};
  const stores = (Array.isArray(s.stores) ? s.stores : [])
    .map((x) => ({
      name: str(x && x.name, 60),
      domain: str(x && x.domain, 120).toLowerCase(),
      market: str(x && x.market, 8).toUpperCase(),
      currency: str(x && x.currency, 6).toUpperCase(),
    }))
    .filter((x) => x.name || x.domain)
    .slice(0, 20);
  const done = {};
  if (s.done && typeof s.done === "object") {
    for (const k of Object.keys(s.done).slice(0, 300)) if (s.done[k]) done[str(k, 60)] = true;
  }
  const markets = {};
  if (s.markets && typeof s.markets === "object") {
    for (const k of Object.keys(s.markets).slice(0, 60)) {
      const v = str(s.markets[k], 12);
      if (["focus", "research", "gepland", "live"].includes(v)) markets[str(k, 8).toUpperCase()] = v;
    }
  }
  const log = (Array.isArray(s.log) ? s.log : [])
    .map((x) => ({ id: str(x && x.id, 40), at: str(x && x.at, 40), text: str(x && x.text, 2000) }))
    .filter((x) => x.id && x.text)
    .slice(0, 300);
  const links = (Array.isArray(s.links) ? s.links : [])
    .map((x) => ({ label: str(x && x.label, 80), url: str(x && x.url, 500) }))
    .filter((x) => /^https?:\/\//i.test(x.url))
    .map((x) => ({ label: x.label || x.url, url: x.url }))
    .slice(0, 40);
  return { stores, done, markets, log, links };
}

export async function readState() {
  const client = await getClient();
  const raw = await client.get(KEY);
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw);
    const st = cleanState(parsed);
    if (!st.stores.length) st.stores = DEFAULT_STATE.stores;
    // oudere opslag zonder bronnenlijst → de standaardbronnen
    if (!parsed || !Array.isArray(parsed.links)) st.links = DEFAULT_STATE.links;
    return st;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeState(input) {
  const st = cleanState(input);
  const json = JSON.stringify(st);
  if (json.length > MAX_BYTES) throw new Error("Te veel data — maak het logboek korter");
  const client = await getClient();
  await client.set(KEY, json);
  return st;
}
