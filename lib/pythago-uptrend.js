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
//  - v4: ROAS wordt gladgestreken (empirische Bayes): (omzet + store-ROAS ×
//    10) / (spend + 10). £50 op £1 spend wordt zo geen ROAS 50 maar ~ de
//    store-ROAS; pas met echte spend telt de eigen ROAS. Drempels en
//    stijging gaan op de gladgestreken ROAS, de echte staat ernaast.
//  - v4: refund-rate 30 d > 25% → overslaan (verkoopt, maar komt terug)
//  - v4: ≥ de helft van de varianten uitverkocht → overslaan (niet op te schalen)
//  - v4: "Ads-bevestigd" = Google telt zelf ook ≥ 0,5 conversie in 7 d; zonder
//    dat komen de orders waarschijnlijk niet van de ads → lagere score
//  - bewijsscore 0–100 (v3): 35% ROAS-sterkte, 25% stijging, 40% aantal
//    orders — de verdeling in TPK gaat op deze score

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
  shrinkSpend: 10, // v4: ROAS gladstrijken met de store-ROAS alsof er 10 extra spend is
  maxRefundRate: 0.25, // v4: > 25% van de omzet (30 d) teruggestort → geen uptrend
  soldOutShare: 0.5, // v4: ≥ de helft van de varianten uitverkocht → overslaan
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
  const stats = { active: 0, withSpend7: 0, enoughData: 0, refunds: 0, soldOut: 0, strongRoas: 0, uptrend: 0, nieuw: 0, flat: 0 };
  if (!data || !Array.isArray(data.rows)) return { products: [], stats, warnings: [], minRoas: null };
  const be = Number(data.settings && data.settings.breakEvenRoas) || 0;
  const minRoas = round2(Math.max(rules.minRoas, be * rules.roasFactor));
  const check = adsWindowCheck(data);
  // store-ROAS (30 d) als "prior" voor het gladstrijken, begrensd 1–10
  const t30 = W(data.totals || {}, 30) || {};
  const storeRoas = Math.min(10, Math.max(1, Number(t30.roas) || (t30.spend > 0 ? (Number(t30.net) || 0) / t30.spend : 0) || minRoas));
  const K = rules.shrinkSpend;
  const shrink = (net, spend) => ((Number(net) || 0) + storeRoas * K) / ((Number(spend) || 0) + K);
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
    const rev30 = Number(w30 && w30.rev) || 0;
    const refundRate = rev30 > 0 ? (Number(w30.refunds) || 0) / rev30 : 0;
    if (refundRate > rules.maxRefundRate) {
      stats.refunds++;
      continue;
    }
    if (Number(r.vcount) > 0 && Number(r.soldOut) >= Number(r.vcount) * rules.soldOutShare) {
      stats.soldOut++;
      continue;
    }
    const r7raw = roasOf(w7);
    const r7 = shrink(w7.net, w7.spend); // gladgestreken
    if (r7 < minRoas) continue;
    stats.strongRoas++;
    // ouder deel (dag 8–30) los van de laatste 7 dagen
    const oldSpend = sub(w30, w7, "spend");
    const oldNet = sub(w30, w7, "net");
    const roasOld = oldSpend >= 1 ? shrink(oldNet, oldSpend) : null;
    const adsConfirmed = (Number(w7.conv) || 0) >= 0.5;
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
    /* bewijsscore 0–100: hoe sterk (ROAS t.o.v. de drempel), hoe hard het
       stijgt (7 d t.o.v. dag 8–30) en hoeveel orders het bewijs draagt.
       1 order ROAS 6 weegt zo minder dan 8 orders ROAS 4. */
    const strength = Math.min(1, r7 / (2 * minRoas)); // 2× de drempel = vol
    const rise = roasOld == null ? 0.5 : Math.min(1, (r7 / Math.max(roasOld, 0.25) - 1) / 2); // 3× = vol; nieuw = half
    // orders als bewijs; zonder Google-conversie (organisch?) telt het voor 60%
    const confidence = (1 - Math.exp(-o7 / 2.5)) * (adsConfirmed ? 1 : 0.6); // 1 → 0,33 · 2 → 0,55 · 4 → 0,80 · 8 → 0,96
    const score = Math.round(100 * (0.35 * strength + 0.25 * Math.max(0, rise) + 0.4 * confidence));
    out.push({
      score,
      productId: String(r.productId || ""),
      title: String(r.title || ""),
      image: r.image || "",
      kind,
      adsConfirmed,
      refundRate: round2(refundRate),
      roas7: round2(r7),
      roas7Raw: round2(r7raw),
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
      roasNote: Math.abs(r7raw - r7) >= 0.5 ? `echt ${round2(r7raw)}` : "",
    });
  }
  out.sort((a, b) => b.score - a.score || b.roas7 - a.roas7 || b.net7 - a.net7 || a.title.localeCompare(b.title));
  return { products: out, stats, warnings: check.warnings, minRoas, gap14: check.gap14, storeRoas: round2(storeRoas) };
}

export function computeUptrend(data, rules = UPTREND_RULES) {
  return computeUptrendDetailed(data, rules).products;
}

/** Bij elke sync: uptrend-lijst bewaren (geheugen tussen Pythago en TPK). */
export async function saveUptrend(org, domain, data) {
  const det = computeUptrendDetailed(data);
  const list = det.products;
  const snap = {
    version: 4,
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
    if (data && data.syncedAt && (!snap || snap.version !== 4 || Date.parse(data.syncedAt) > Date.parse(snap.syncedAt || 0))) {
      snap = await saveUptrend(org, domain, data);
    }
  }
  return snap;
}
