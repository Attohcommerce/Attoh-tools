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
// Regels (puur data, v2 05-11 na de eerste test op SSB):
//  - product staat actief op de store
//  - genoeg data in 7 dagen: spend ≥ 3 én ≥ 1 order (een order op £0,64
//    spend komt niet van Ads — ROAS 80 zegt dan niets)
//  - extreem goede ROAS: ROAS 7d ≥ 1,5 × break-even ROAS (minimaal 2,0)
//  - uptrend: de laatste 7 dagen vergeleken met de dagen daarvóór (dag 8–30,
//    niet het overlappende 30-dagen-totaal — dat verdunt de trend): ROAS 7d
//    ≥ 1,25 × ROAS dag 8–30. Is het 14-dagen-venster betrouwbaar, dan moet
//    dag 8–14 ook niet slechter zijn dan dag 15–30 (geen eenmalige piek).
//  - nieuw ↗: geen spend vóór de laatste 7 dagen (net gestart) maar ≥ 2
//    orders en extreem goede ROAS → telt ook mee, met label "nieuw"
//  - gat in de Ads-data (14 d spend = 7 d spend terwijl 30 d meer is) →
//    het 14-dagen-venster wordt genegeerd en er komt een waarschuwing
//  - score = ROAS 7d, bij gelijk de netto-omzet van 7 dagen

import { getRedis } from "./kw-memory";
import { nsKey } from "./org";
import { cleanDomain } from "./shopify";

export const UPTREND_RULES = {
  roasFactor: 1.5, // × break-even
  minRoas: 2, // ondergrens voor "extreem goed"
  minRise: 1.25, // ROAS 7d ≥ 1,25 × ROAS dag 8–30
  minSpend7: 3, // minimaal 3 spend in 7 dagen (anders komen de orders niet van Ads)
  minOrders7: 1,
  minOrdersNew: 2, // "nieuw ↗": minstens 2 orders in 7 dagen
  includeNew: true,
};

const KEY = (org, d) => nsKey(org, `pythago:uptrend:${cleanDomain(d)}`);
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const roasOf = (w) => (w && w.spend > 0 && w.roas != null ? Number(w.roas) : 0);

const W = (per, w) => (per && (per[w] || per[String(w)])) || null;
const sub = (a, b, f) => (Number(a && a[f]) || 0) - (Number(b && b[f]) || 0);

/** Is het 14-dagen-venster van de Ads-data betrouwbaar? (gat-detectie) */
export function adsWindowCheck(data) {
  const t = (data && data.totals) || {};
  const s7 = Number((W(t, 7) || {}).spend) || 0;
  const s14 = Number((W(t, 14) || {}).spend) || 0;
  const s30 = Number((W(t, 30) || {}).spend) || 0;
  const a7 = Number((W(t, 7) || {}).accountSpend) || 0;
  const a30 = Number((W(t, 30) || {}).accountSpend) || 0;
  const gap14 = s7 > 0 && s30 > s7 * 1.05 && Math.abs(s14 - s7) <= Math.max(0.5, s7 * 0.005);
  const warnings = [];
  if (gap14) warnings.push(`Gat in de Google Ads-productdata: spend 14 d (${round2(s14)}) = spend 7 d (${round2(s7)}) terwijl 30 d ${round2(s30)} is — dag 8–14 ontbreken in tab Prod_. Het Ads-script vult dat bij de volgende run aan (gat-reparatie); tot dan vergelijkt de uptrend 7 d met dag 8–30.`);
  // dekking: hoeveel van de account-spend zit in de productdata (7 vs 30 d)
  const c7 = a7 > 0 ? s7 / a7 : null;
  const c30 = a30 > 0 ? s30 / a30 : null;
  if (c7 != null && c30 != null && c7 > 0.1 && c30 < c7 * 0.6) {
    warnings.push(`De productdata van 30 dagen is onvolledig (${Math.round(c30 * 100)}% van de account-spend tegen ${Math.round(c7 * 100)}% over 7 dagen) — oudere dagen ontbreken, de uptrend is dan minder betrouwbaar.`);
  }
  return { gap14, coverage7: c7, coverage30: c30, warnings };
}

/**
 * Uptrend-producten uit een Pythago-sync (loadData-resultaat).
 * Geeft { products: [...], stats, warnings }; products gesorteerd op score:
 * { productId, title, image, roas7, roas14, roas30, roasOld, kind ("uptrend"|"nieuw"),
 *   spend7, orders7, units7, net7, orders30, net30, trend }
 */
export function computeUptrendDetailed(data, rules = UPTREND_RULES) {
  const stats = { active: 0, withSpend7: 0, enoughData: 0, strongRoas: 0, uptrend: 0, nieuw: 0, flat: 0 };
  if (!data || !Array.isArray(data.rows)) return { products: [], stats, warnings: [], minRoas: null };
  const be = Number(data.settings && data.settings.breakEvenRoas) || 0;
  const minRoas = round2(Math.max(rules.minRoas, be * rules.roasFactor));
  const check = adsWindowCheck(data);
  const out = [];
  for (const r of data.rows) {
    if (!r || !r.onStore || r.status !== "active" || !r.per) continue;
    stats.active++;
    const w7 = W(r.per, 7);
    const w14 = W(r.per, 14);
    const w30 = W(r.per, 30);
    if (!w7 || !(w7.spend > 0)) continue;
    stats.withSpend7++;
    const o7 = Number(w7.orders) || 0;
    if (o7 < rules.minOrders7 || w7.spend < rules.minSpend7) continue;
    stats.enoughData++;
    const r7 = roasOf(w7);
    if (r7 < minRoas) continue;
    stats.strongRoas++;
    // ouder deel (dag 8–30) los van de laatste 7 dagen
    const oldSpend = sub(w30, w7, "spend");
    const oldNet = sub(w30, w7, "net");
    const roasOld = oldSpend >= 1 ? oldNet / oldSpend : null;
    let kind = "";
    if (roasOld == null) {
      if (rules.includeNew && o7 >= rules.minOrdersNew) kind = "nieuw";
    } else if (r7 >= roasOld * rules.minRise) {
      kind = "uptrend";
      // 14-dagen-venster betrouwbaar → dag 8–14 niet slechter dan dag 15–30
      if (!check.gap14 && w14) {
        const midSpend = sub(w14, w7, "spend");
        const lateSpend = sub(w30, w14, "spend");
        if (midSpend >= 1 && lateSpend >= 1) {
          const rMid = sub(w14, w7, "net") / midSpend;
          const rLate = sub(w30, w14, "net") / lateSpend;
          if (rMid < rLate * 0.8) kind = ""; // eenmalige piek, geen trend
        }
      }
    }
    if (!kind) {
      stats.flat++;
      continue;
    }
    stats[kind === "nieuw" ? "nieuw" : "uptrend"]++;
    out.push({
      productId: String(r.productId || ""),
      title: String(r.title || ""),
      image: r.image || "",
      kind,
      roas7: round2(r7),
      roas14: round2(roasOf(w14)),
      roas30: round2(roasOf(w30)),
      roasOld: roasOld == null ? null : round2(roasOld),
      spend7: round2(w7.spend),
      orders7: o7,
      units7: Number(w7.units) || 0,
      net7: round2(w7.net),
      orders30: Number((w30 && w30.orders) || 0),
      net30: round2(w30 && w30.net),
      trend: kind === "nieuw" ? `nieuw → ${round2(r7)}` : `${round2(roasOld)} → ${round2(r7)}`,
    });
  }
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "uptrend" ? -1 : 1) || b.roas7 - a.roas7 || b.net7 - a.net7 || a.title.localeCompare(b.title));
  return { products: out, stats, warnings: check.warnings, minRoas, gap14: check.gap14 };
}

export function computeUptrend(data, rules = UPTREND_RULES) {
  return computeUptrendDetailed(data, rules).products;
}

/** Bij elke sync: uptrend-lijst bewaren (geheugen tussen Pythago en TPK). */
export async function saveUptrend(org, domain, data) {
  const det = computeUptrendDetailed(data);
  const list = det.products;
  const snap = {
    version: 2,
    stats: det.stats,
    warnings: det.warnings,
    minRoas: det.minRoas,
    gap14: !!det.gap14,
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
    // nieuwere sync, geen snapshot of een snapshot van oudere regels: opnieuw uitrekenen
    if (data && data.syncedAt && (!snap || snap.version !== 2 || Date.parse(data.syncedAt) > Date.parse(snap.syncedAt || 0))) {
      snap = await saveUptrend(org, domain, data);
    }
  }
  return snap;
}
