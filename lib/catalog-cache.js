// PERMANENTE CATALOGUS-CACHE (zelfde REDIS_URL als To Do-board / Size Guide).
//
// Waarom: zonder deze cache haalde elke serverless-call de catalogus van een
// concurrent opnieuw op (products.json + best-selling-pagina's). Dat was de
// grootste tijdvreter van de scraper, en een instantie onthield hooguit 24
// stores 10 minuten. Chaim's scraper laadt elke catalogus één keer, bewaart
// hem en ververst pas op verzoek ("Catalogi verversen") — daardoor is hij snel.
//
// Opslag: gzip + base64 onder cat:v2:<domein> (7 dagen), plus een kleine
// meta-key catmeta:v2:<domein> (aantal, tijdstip, taal, best-selling-status)
// voor het overzicht in de UI. Zonder REDIS_URL werkt alles gewoon, dan
// zonder permanente cache.
import { createClient } from "redis";
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

export const CATALOG_TTL_SEC = 60 * 60 * 24 * 7; // 7 dagen
const dataKey = (dom) => `cat:v2:${String(dom || "").toLowerCase()}`;
const metaKey = (dom) => `catmeta:v2:${String(dom || "").toLowerCase()}`;

export async function readCatalog(dom) {
  try {
    const c = await getClient();
    if (!c) return null;
    const raw = await c.get(dataKey(dom));
    if (!raw) return null;
    return JSON.parse(gunzipSync(Buffer.from(raw, "base64")).toString("utf8"));
  } catch {
    return null;
  }
}

export async function writeCatalog(dom, data) {
  try {
    const c = await getClient();
    if (!c) return false;
    const packed = gzipSync(Buffer.from(JSON.stringify(data), "utf8")).toString("base64");
    const meta = {
      domain: dom,
      count: (data.products || []).length,
      at: data.fetchedAt || Date.now(),
      lang: data.lang || "en",
      bestSelling: data.bestSellingStatus || "onbekend",
    };
    await c.set(dataKey(dom), packed, { EX: CATALOG_TTL_SEC });
    await c.set(metaKey(dom), JSON.stringify(meta), { EX: CATALOG_TTL_SEC });
    return true;
  } catch {
    return false;
  }
}

export async function readCatalogMeta(domains) {
  const out = {};
  try {
    const c = await getClient();
    if (!c || !domains.length) return out;
    const vals = await c.mGet(domains.map(metaKey));
    domains.forEach((d, i) => {
      if (vals[i]) {
        try {
          out[d] = JSON.parse(vals[i]);
        } catch {}
      }
    });
  } catch {}
  return out;
}

export function catalogCacheAvailable() {
  return !!process.env.REDIS_URL;
}
