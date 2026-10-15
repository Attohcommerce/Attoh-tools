// Alles van de oude Redis naar de nieuwe overzetten (15-10-2026).
// Justin kocht een nieuwe Redis-database via de Vercel Marketplace; de oude
// (redis-coral-notebook, 30 MB) houdt de competitor-lijst + maandbezoekers,
// het store-geheugen, de All-keywords-koppeling, het To Do-board en de
// size-guide-matches. Dit kopieert elke key met DUMP/RESTORE (type én
// vervaldatum blijven), in batches, naar de database van REDIS_URL.
//
// Bron = env var REDIS_URL_OLD, of (eenmalig) de link die in de scraper
// wordt geplakt. Catalogi gaan standaard mee; staan ze
// er niet in, dan haalt "📦 Catalogi laden" ze gewoon opnieuw op.
import { createClient, commandOptions } from "redis";

const KIND_OF = (k) =>
  k.startsWith("cat:") || k.startsWith("catmeta:") ? "catalogi"
  : k.startsWith("sg:srcidx:") ? "bronIndexen"
  : k.startsWith("sg:") ? "sizeGuide"
  : k.startsWith("geh:") || k.startsWith("kw:") ? "geheugen"
  : k.startsWith("comp:") ? "competitors"
  : k.startsWith("todo") ? "todos"
  : "overig";

const mb = (b) => Math.round((Number(b) || 0) / 1048576 * 10) / 10;

async function usedMemory(c) {
  const info = await c.info("memory").catch(() => "");
  return {
    used: Number((info.match(/used_memory:(\d+)/) || [])[1] || 0),
    max: Number((info.match(/maxmemory:(\d+)/) || [])[1] || 0),
  };
}

function sameDb(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.host === ub.host && (ua.pathname || "/") === (ub.pathname || "/");
  } catch {
    return a === b;
  }
}

/**
 * @param {object} o
 * @param {string} o.fromUrl   oude Redis (redis:// of rediss://)
 * @param {boolean} [o.skipCatalogs]  catalogi (cat:… en catmeta:…) overslaan
 * @param {boolean} [o.skipSourceIndexes]  sg:srcidx:* overslaan (herbouwbaar, groot)
 */
export async function migrateRedis({ fromUrl, skipCatalogs = false, skipSourceIndexes = true }) {
  const toUrl = process.env.REDIS_URL;
  if (!toUrl) throw new Error("REDIS_URL (nieuwe database) ontbreekt in de env vars");
  if (!fromUrl) throw new Error("Oude Redis-link ontbreekt (REDIS_URL_OLD of geplakt)");
  if (sameDb(fromUrl, toUrl)) throw new Error("Oude en nieuwe Redis zijn dezelfde database — zet REDIS_URL eerst op de nieuwe database en deploy opnieuw");

  const src = createClient({ url: fromUrl });
  const dst = createClient({ url: toUrl });
  src.on("error", () => {});
  dst.on("error", () => {});
  await src.connect();
  await dst.connect();
  const t0 = Date.now();
  const res = { copied: 0, skipped: 0, failed: 0, bytes: 0, perKind: {}, errors: [], before: await usedMemory(dst) };
  const bump = (kind, field, n = 1) => {
    const k = (res.perKind[kind] = res.perKind[kind] || { copied: 0, skipped: 0, failed: 0 });
    k[field] += n;
  };
  try {
    const keys = [];
    for await (const k of src.scanIterator({ MATCH: "*", COUNT: 500 })) keys.push(k);
    for (let i = 0; i < keys.length; i += 50) {
      const part = keys.slice(i, i + 50);
      for (const key of part) {
        const kind = KIND_OF(key);
        if ((skipCatalogs && kind === "catalogi") || (skipSourceIndexes && kind === "bronIndexen")) {
          res.skipped++;
          bump(kind, "skipped");
          continue;
        }
        try {
          const [dump, pttl] = await Promise.all([src.dump(commandOptions({ returnBuffers: true }), key), src.pTTL(key)]);
          if (!dump) {
            res.skipped++;
            bump(kind, "skipped");
            continue;
          }
          const ttl = pttl > 0 ? pttl : 0; // 0 = geen vervaldatum
          await dst.restore(key, ttl, dump, { REPLACE: true });
          res.copied++;
          res.bytes += dump.length;
          bump(kind, "copied");
        } catch (e) {
          res.failed++;
          bump(kind, "failed");
          if (res.errors.length < 10) res.errors.push(`${key}: ${String((e && e.message) || e)}`);
        }
      }
    }
    res.after = await usedMemory(dst);
    res.ms = Date.now() - t0;
    res.mb = mb(res.bytes);
    res.total = keys.length;
    return res;
  } finally {
    await Promise.allSettled([src.quit(), dst.quit()]);
  }
}
