// PYTHAGO-UPTREND → TPK (05-11-2026).
//
// Justin: de Pythago-sync draait elke dag per store en ziet per product de
// ROAS over 30 / 14 / 7 dagen. Een product dat op 30 dagen nog rood is maar
// op 14 en 7 dagen steeds groener wordt, heeft een uptrend (van rechts naar
// links in het dashboard). Die producten zijn het waard om meer van te
// hebben, ook als ze in de orders van 30 dagen nog niet hoog scoren.
//
// Dit bestand is het "geheugen" tussen de Pythago-sync en de TPK-tool:
//  - bij elke sync bewaart lib/pythago-sync.js de uptrend-producten in de
//    data (result.uptrend) en onder pythago:uptrend:<domein>
//  - TPK (Keywords → TPK, bron "Pythago uptrend") leest de laatste sync,
//    maakt van die producten keywords en zet ze in het weekblad erbij
//
// Regels (puur data):
//  - product staat actief op de store
//  - 7 dagen: spend > 0 en minstens 1 order
//  - extreem goede ROAS: ROAS 7d ≥ 1,5 × break-even ROAS (instellingen van
//    de store in het Pythago-dashboard; minimaal 2,0)
//  - uptrend: ROAS 7d > ROAS 14d ≥ ROAS 30d, en 7d minstens 25% boven 30d
//    (geen spend in een venster = ROAS 0)
//  - score = ROAS 7d, bij gelijk de netto-omzet van 7 dagen

import { getRedis } from "./kw-memory";
import { nsKey } from "./org";
import { cleanDomain } from "./shopify";

export const UPTREND_RULES = {
  roasFactor: 1.5, // × break-even
  minRoas: 2, // ondergrens voor "extreem goed"
  minRise: 1.25, // 7d ≥ 1,25 × 30d
  minOrders7: 1,
};

const KEY = (org, d) => nsKey(org, `pythago:uptrend:${cleanDomain(d)}`);
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const roasOf = (w) => (w && w.spend > 0 && w.roas != null ? Number(w.roas) : 0);

/**
 * Uptrend-producten uit een Pythago-sync (loadData-resultaat).
 * Geeft [{ productId, title, image, roas7, roas14, roas30, spend7, orders7,
 * units7, net7, orders30, net30, trend }] gesorteerd op score.
 */
export function computeUptrend(data, rules = UPTREND_RULES) {
  if (!data || !Array.isArray(data.rows)) return [];
  const be = Number(data.settings && data.settings.breakEvenRoas) || 0;
  const minRoas = Math.max(rules.minRoas, be * rules.roasFactor);
  const out = [];
  for (const r of data.rows) {
    if (!r || !r.onStore || r.status !== "active" || !r.per) continue;
    const w7 = r.per[7] || r.per["7"];
    const w14 = r.per[14] || r.per["14"];
    const w30 = r.per[30] || r.per["30"];
    if (!w7 || !(w7.spend > 0) || (Number(w7.orders) || 0) < rules.minOrders7) continue;
    const r7 = roasOf(w7);
    const r14 = roasOf(w14);
    const r30 = roasOf(w30);
    if (r7 < minRoas) continue;
    if (!(r7 > r14 && r14 >= r30)) continue;
    if (r30 > 0 && r7 < r30 * rules.minRise) continue;
    out.push({
      productId: String(r.productId || ""),
      title: String(r.title || ""),
      image: r.image || "",
      roas7: round2(r7),
      roas14: round2(r14),
      roas30: round2(r30),
      spend7: round2(w7.spend),
      orders7: Number(w7.orders) || 0,
      units7: Number(w7.units) || 0,
      net7: round2(w7.net),
      orders30: Number((w30 && w30.orders) || 0),
      net30: round2(w30 && w30.net),
      trend: `${round2(r30)} → ${round2(r14)} → ${round2(r7)}`,
    });
  }
  out.sort((a, b) => b.roas7 - a.roas7 || b.net7 - a.net7 || a.title.localeCompare(b.title));
  return out;
}

/** Bij elke sync: uptrend-lijst bewaren (geheugen tussen Pythago en TPK). */
export async function saveUptrend(org, domain, data) {
  const list = computeUptrend(data);
  const snap = {
    syncedAt: data && data.syncedAt ? data.syncedAt : new Date().toISOString(),
    period: (data && data.period) || null,
    currency: (data && data.adsCurrency) || "",
    breakEvenRoas: Number(data && data.settings && data.settings.breakEvenRoas) || null,
    rules: UPTREND_RULES,
    products: list,
  };
  try {
    const r = await getRedis();
    await r.set(KEY(org, domain), JSON.stringify(snap));
  } catch {}
  return snap;
}

/** Laatste uptrend-snapshot; valt terug op de opgeslagen Pythago-data. */
export async function loadUptrend(org, domain, loadData) {
  let snap = null;
  try {
    const r = await getRedis();
    const v = await r.get(KEY(org, domain));
    snap = v ? JSON.parse(v) : null;
  } catch {}
  if (typeof loadData === "function") {
    const data = await loadData(org, domain).catch(() => null);
    // nieuwere sync dan het snapshot (of geen snapshot): opnieuw uitrekenen
    if (data && data.syncedAt && (!snap || Date.parse(data.syncedAt) > Date.parse(snap.syncedAt || 0))) {
      snap = await saveUptrend(org, domain, data);
    }
  }
  return snap;
}
