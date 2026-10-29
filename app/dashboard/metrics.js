// Rekenhulpjes voor het dashboard (v3): formats, afgeleide cijfers en
// "zelfde tijd"-vergelijkingen op basis van de uurdata.

export const nf2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const nf0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
export const ok = (v) => v != null && Number.isFinite(v);
export const gbp = (v) => (ok(v) ? "£" + nf2.format(v) : "—");
export const gbpAxis = (v) => (ok(v) ? "£" + (v >= 1000 ? nf1.format(v / 1000) + "k" : nf0.format(v)) : "");
export const int = (v) => (ok(v) ? nf0.format(v) : "—");
export const pct = (v) => (ok(v) ? nf2.format(v * 100) + "%" : "—");
export const ratio = (v) => (ok(v) ? nf2.format(v) + "×" : "—");
const div = (a, b) => (b ? a / b : null);

export const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00");
export const hhmm = (h, m = 59) => String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");

/* Afgeleide cijfers voor één dag (één store). */
export function metrics(d) {
  if (!d) return {};
  const ads = d.ads;
  const cost = ads ? ads.cost : null;
  return {
    revenue: d.revenue,
    orders: d.orders,
    aov: d.orders ? d.revenue / d.orders : null,
    sessions: d.sessions,
    cvr: d.sessions ? div(d.orders, d.sessions) : null,
    cost,
    roasReal: ads && cost ? div(d.revenue || 0, cost) : null,
    roasGoogle: ads && cost ? div(ads.convValue, cost) : null,
    cpc: ads && ads.clicks ? div(cost, ads.clicks) : null,
    cpm: ads && ads.impressions ? (cost / ads.impressions) * 1000 : null,
  };
}

/* Meerdere stores (of uren) optellen → cijfers. Ratio's alleen over stores met die data. */
export function sumDays(list) {
  const t = { revenue: 0, orders: 0, sessions: 0, sessOrders: 0, hasSess: false, ads: null, adsRevenue: 0, any: false };
  for (const d of list) {
    if (!d) continue;
    t.any = true;
    t.revenue += d.revenue || 0;
    t.orders += d.orders || 0;
    if (d.sessions != null) {
      t.hasSess = true;
      t.sessions += d.sessions;
      t.sessOrders += d.orders || 0;
    }
    if (d.ads) {
      if (!t.ads) t.ads = { cost: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0 };
      for (const k of Object.keys(t.ads)) t.ads[k] += d.ads[k] || 0;
      t.adsRevenue += d.revenue || 0;
    }
  }
  if (!t.any) return {};
  const m = metrics({ revenue: t.revenue, orders: t.orders, sessions: t.hasSess ? t.sessions : null, ads: t.ads });
  m.cvr = t.hasSess && t.sessions ? t.sessOrders / t.sessions : null;
  m.roasReal = t.ads && t.ads.cost ? t.adsRevenue / t.ads.cost : null;
  return m;
}

/**
 * Uren from..to optellen tot een "dag-achtig" object. Het laatste uur telt
 * voor `frac` mee (bv. 0,6 om 14:36) — zo vergelijk je eerlijk met "nu".
 * withAds=false laat Ads weg (als niet alle stores uurdata voor Ads hebben).
 */
export function sliceHours(hs, from, to, frac = 1, withAds = true) {
  if (!hs || to < 0) return hs ? { revenue: 0, orders: 0, sessions: hs.sessions ? 0 : null, ads: withAds && hs.ads ? { cost: 0, clicks: 0, impressions: 0, convValue: 0 } : null } : null;
  const take = (arr) => {
    if (!arr) return null;
    let t = 0;
    for (let i = Math.max(0, from); i <= Math.min(23, to); i++) t += (arr[i] || 0) * (i === to ? frac : 1);
    return t;
  };
  return {
    revenue: take(hs.revenue),
    orders: take(hs.orders),
    sessions: hs.sessions ? take(hs.sessions) : null,
    ads: withAds && hs.ads
      ? { cost: take(hs.ads.cost), clicks: take(hs.ads.clicks), impressions: take(hs.ads.impressions), conversions: 0, convValue: take(hs.ads.convValue) }
      : null,
  };
}
export const upTo = (hs, h, frac = 1, withAds = true) => sliceHours(hs, 0, h, frac, withAds);
export const atHour = (hs, h, withAds = true) => sliceHours(hs, h, h, 1, withAds);

/* Ratio-cijfers mogen (bij gebrek aan uurdata) met de hele vorige dag vergeleken
   worden; absolute cijfers (orders, omzet, spend) nooit — dat gaf die -63%. */
export const RATIO_IDS = new Set(["aov", "cvr", "roasReal", "roasGoogle", "cpc", "cpm"]);
export const ADS_IDS = new Set(["cost", "roasReal", "roasGoogle", "cpc", "cpm"]);

export const METRICS = [
  { id: "revenue", label: "Omzet", fmt: gbp, axis: gbpAxis },
  { id: "orders", label: "Orders", fmt: int },
  { id: "aov", label: "Gem. orderwaarde", fmt: gbp, axis: gbpAxis },
  { id: "cvr", label: "Conversie", fmt: pct },
  { id: "cost", label: "Ad spend", fmt: gbp, axis: gbpAxis, lowerIsBetter: true },
  { id: "roasReal", label: "ROAS (Shopify)", fmt: ratio, hint: "Shopify-omzet in £ / Google Ads-kosten" },
  { id: "roasGoogle", label: "ROAS (Google)", fmt: ratio, hint: "Conversiewaarde in Google Ads / kosten" },
  { id: "cpc", label: "CPC", fmt: gbp, lowerIsBetter: true, hint: "Kosten / kliks, alle campagnes samen" },
  { id: "cpm", label: "CPM", fmt: gbp, axis: gbpAxis, lowerIsBetter: true, hint: "Kosten per 1.000 vertoningen" },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.id, m]));
export const TILES = METRICS.filter((m) => m.id !== "revenue");
export const STORE_STATS = ["orders", "cvr", "cost", "roasReal", "cpc", "cpm"];
// Optelbare cijfers: per uur kun je ze cumulatief tonen; ratio's "t/m dit uur".
export const ADDITIVE = new Set(["revenue", "orders", "cost"]);

export function change(cur, prev) {
  if (!ok(cur) || !ok(prev)) return null;
  if (prev === 0) return cur === 0 ? 0 : Infinity;
  return (cur - prev) / Math.abs(prev);
}

export function Delta({ cur, prev, lowerIsBetter, big }) {
  const ch = change(cur, prev);
  const cls = "dd-delta" + (big ? " big" : "");
  if (ch == null) return <span className={cls + " flat"}>—</span>;
  if (ch === Infinity) return <span className={cls + " up"}>nieuw</span>;
  if (Math.abs(ch) < 0.0005) return <span className={cls + " flat"}>0%</span>;
  const good = lowerIsBetter ? ch < 0 : ch > 0;
  return (
    <span className={cls + " " + (good ? "up" : "down")}>
      {ch > 0 ? "↑" : "↓"} {nf0.format(Math.abs(ch) * 100)}%
    </span>
  );
}
