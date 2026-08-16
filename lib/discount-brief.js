// Korting-briefing — "zeg in je eigen woorden hoe je de korting wil hebben".
//
// De vaste knoppen (10/20/30/40/50%, AI kiest, Custom %) dekken één regel voor
// de hele batch. In de praktijk wil je vaak iets genuanceerders: dieper op
// jurken dan op basics, niets op nieuwe collecties, of een staffel op prijs.
// Dat typ je hier gewoon uit; de AI zet die zin één keer om in een
// REGELSET, en die regelset wordt daarna volledig deterministisch toegepast.
//
// Waarom niet per product aan de AI vragen: prijsstabiliteit is een GMC-eis.
// Eén keer interpreteren en daarna vast rekenen betekent dat dezelfde batch
// morgen exact dezelfde prijzen oplevert.

export const EMPTY_PLAN = { default: 0, min: 0, max: 80, roundTo: 1, rules: [], summary: "" };

const lc = (v) => String(v || "").toLowerCase();

function anyMatch(haystack, needles) {
  if (!needles || !needles.length) return null; // criterium niet gebruikt
  const h = lc(haystack);
  return needles.some((n) => h.includes(lc(n)));
}

/** Past één regel op dit product? Alle ingevulde criteria moeten kloppen. */
function ruleMatches(rule, ctx) {
  const w = rule.when || {};
  const checks = [
    anyMatch(ctx.collection, w.collections),
    anyMatch(ctx.keyword, w.keywords),
    anyMatch(ctx.title, w.titleContains),
  ];
  for (const c of checks) if (c === false) return false;

  const price = Number(ctx.price);
  if (Number.isFinite(price) && price > 0) {
    if (Number.isFinite(w.priceMin) && price < w.priceMin) return false;
    if (Number.isFinite(w.priceMax) && price > w.priceMax) return false;
  } else if (Number.isFinite(w.priceMin) || Number.isFinite(w.priceMax)) {
    return false; // prijsregel zonder bekende prijs = geen match
  }

  // Een regel zonder énig criterium is een vangnet, geen match op alles —
  // anders zou de eerste zulke regel de hele batch kapen.
  const used =
    checks.some((c) => c !== null) || Number.isFinite(w.priceMin) || Number.isFinite(w.priceMax);
  return used;
}

/**
 * plan: zie EMPTY_PLAN
 * ctx:  { keyword, collection, title, price }  (price in winkel-valuta)
 * → { pct, why }
 */
export function applyDiscountPlan(plan, ctx = {}) {
  const p = { ...EMPTY_PLAN, ...(plan || {}) };
  let pct = Number(p.default) || 0;
  let why = "standaard uit je briefing";

  for (const rule of p.rules || []) {
    if (!ruleMatches(rule, ctx)) continue;
    pct = Number(rule.pct) || 0;
    why = rule.note || "regel uit je briefing";
    break; // eerste passende regel wint — volgorde = prioriteit
  }

  const min = Number.isFinite(p.min) ? p.min : 0;
  const max = Number.isFinite(p.max) ? p.max : 80;
  if (pct < min) pct = min;
  if (pct > max) pct = max;

  const step = Number(p.roundTo) > 0 ? Number(p.roundTo) : 1;
  pct = Math.round(pct / step) * step;

  // Nooit boven de 80%: een doorgestreepte prijs die vijf keer de verkoopprijs
  // is, leest als misleiding en is een directe GMC-afkeuring.
  if (pct > 80) pct = 80;
  if (pct < 0) pct = 0;

  return { pct, why };
}

/** Leesbare samenvatting van de regelset, voor in het importlog. */
export function describeDiscountPlan(plan) {
  const p = { ...EMPTY_PLAN, ...(plan || {}) };
  const lines = [];
  for (const r of p.rules || []) {
    const w = r.when || {};
    const bits = [];
    if (w.collections && w.collections.length) bits.push(`collectie ${w.collections.join(" / ")}`);
    if (w.keywords && w.keywords.length) bits.push(`keyword bevat ${w.keywords.join(" / ")}`);
    if (w.titleContains && w.titleContains.length) bits.push(`titel bevat ${w.titleContains.join(" / ")}`);
    if (Number.isFinite(w.priceMin)) bits.push(`vanaf ${w.priceMin}`);
    if (Number.isFinite(w.priceMax)) bits.push(`tot ${w.priceMax}`);
    lines.push(`${bits.join(" + ") || "overig"} → ${r.pct}%`);
  }
  lines.push(`alles wat nergens onder valt → ${p.default}%`);
  return lines;
}
