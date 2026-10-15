// Welke Redis gebruikt de tool? (15-10-2026)
// Nieuwe database via de Vercel Marketplace (redis-aureolin-jacket, 250 MB)
// kreeg env var STORAGE2_REDIS_URL; de oude (redis-coral-notebook, 30 MB)
// staat als REDIS_URL. Staat STORAGE2_REDIS_URL er, dan is dát de database;
// REDIS_URL is dan automatisch de OUDE (bron voor "⇄ Oude Redis overzetten").
// Geen STORAGE2 → gewoon REDIS_URL, zoals altijd.
export function redisUrl() {
  return String(process.env.STORAGE2_REDIS_URL || process.env.REDIS_URL || "").trim();
}
export function oldRedisUrl() {
  const old = process.env.REDIS_URL_OLD || (process.env.STORAGE2_REDIS_URL ? process.env.REDIS_URL : "");
  const o = String(old || "").trim();
  return o && o !== redisUrl() ? o : "";
}
