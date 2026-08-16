// Underdog-engine — vindt keywords die hard kunnen gaan maar waar niemand op
// zit, en waar de bestaande organization nog niks mee doet.
//
// De gedachte: de gewone verdeling koopt in op BEWEZEN vraag (veel volume =
// veel producten). Daar vecht iedereen om dezelfde veilingen. Een underdog is
// het omgekeerde profiel: échte, liefst stijgende vraag — maar laag in
// concurrentie, lang in staart, en afwezig in de voor de hand liggende
// keyword-lijstjes. Precies daarvoor zijn de extra Planner-kolommen
// (concurrentie-index, biedingen, YoY, 3-maands trend) die stap 1 nu bewaart:
// zonder die data is "underdog" een gok, met die data is het een berekening.
//
// score = tractie × momentum × schaarste
//   tractie   — venstervolume, gedempt (wortel), zodat klein-maar-echt kan
//               winnen van groot-en-voordehandliggend
//   momentum  — groeit de vraag binnen het venster + YoY + 3-maands trend
//   schaarste — lage concurrentie-index, long-tail, bescheiden avg-volume;
//               een kaal head-keyword kan per definitie geen underdog zijn

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Concurrentie: index 0-100 uit de Planner (of Low/Medium/High als tekst).
   Laag = precies wat we zoeken. Onbekend = neutraal, geen straf — oude
   stats-tabbladen zonder deze kolom blijven bruikbaar. */
export function competitionFactor(compIdx, compText) {
  let idx = Number(compIdx);
  if (!Number.isFinite(idx) || compIdx === "" || compIdx == null) {
    const t = String(compText || "").toLowerCase();
    if (t.startsWith("low")) idx = 15;
    else if (t.startsWith("med")) idx = 50;
    else if (t.startsWith("high")) idx = 85;
    else return 1;
  }
  idx = clamp(idx, 0, 100);
  return 1.35 - 0.007 * idx; // 0 → 1.35 · 50 → 1.0 · 100 → 0.65
}

/* Biedingen: als adverteerders op een term bieden, is er bewezen commerciële
   intentie — dat wil je zien. Helemaal geen biedingen bij behoorlijk volume
   is juist verdacht (informatie-zoekvraag, geen koopvraag). */
export function bidFactor(bidLow, bidHigh, avg) {
  const hi = Number(bidHigh);
  const lo = Number(bidLow);
  const hasBid = (Number.isFinite(hi) && hi > 0) || (Number.isFinite(lo) && lo > 0);
  if (hasBid) return 1.08;
  if ((Number(avg) || 0) >= 5000) return 0.85; // veel gezocht, niemand biedt → weinig koopintentie
  return 1; // klein keyword zonder bid-data: geen oordeel
}

/* Trend: YoY en 3-maands verandering in % (∞/nieuw = 9999 → behandelen als
   sterke stijger, maar niet oneindig belonen). */
export function trendFactor(yoy, chg3) {
  let f = 1;
  const y = Number(yoy);
  if (Number.isFinite(y) && yoy !== "" && yoy != null) {
    if (y >= 900) f *= 1.2;
    else if (y >= 50) f *= 1.2;
    else if (y >= 15) f *= 1.1;
    else if (y <= -30) f *= 0.7;
  }
  const c = Number(chg3);
  if (Number.isFinite(c) && chg3 !== "" && chg3 != null) {
    if (c >= 900) f *= 1.1;
    else if (c >= 30) f *= 1.1;
    else if (c <= -30) f *= 0.8;
  }
  return f;
}

/* Long-tail: het hart van de underdog. Eén stem is een head-term (het
   tegenovergestelde van een underdog), twee-vier stems is de sweet spot,
   daarboven wordt het te specifiek om producten voor in te kopen. */
export function tailFactor(stemCount) {
  if (stemCount <= 1) return 0.3;
  if (stemCount === 2) return 1.0;
  if (stemCount === 3) return 1.18;
  if (stemCount === 4) return 1.12;
  if (stemCount === 5) return 0.95;
  return 0.8;
}

/* Volume-band op het jaargemiddelde: een underdog is groot genoeg om te
   bestaan en klein genoeg om over het hoofd gezien te worden. */
export function obscurityFactor(avg) {
  const a = Number(avg) || 0;
  if (a < 200) return 0.6;
  if (a <= 40000) return 1.0;
  if (a <= 90000) return 0.75;
  return 0.5;
}

/* Groei binnen het venster zelf (zelfde signaal als de verdeling gebruikt,
   maar hier als factor i.p.v. alleen momentum-boost). */
export function growthFactor(months, next) {
  if (!months || months.length < 2) return 1;
  const early = (months[0] || 0) + (months[1] || 0);
  const lastM = months[months.length - 1] || 0;
  const n = Number(next);
  const late = Number.isFinite(n) && next != null && next !== ""
    ? lastM + n
    : (months[months.length - 2] || 0) + lastM;
  if (early <= 0) return late > 0 ? 1.15 : 1;
  return Math.pow(clamp(late / early, 0.4, 3), 0.6);
}

/**
 * Totaalscore van één kandidaat.
 * c: { windowVol, months, next, avg, compIdx, comp, bidLow, bidHigh, yoy,
 *      chg3, stemCount, seasonF, eventF, dying }
 */
export function underdogScore(c) {
  const traction = Math.sqrt(Math.max(0, c.windowVol));
  return (
    traction *
    growthFactor(c.months, c.next) *
    trendFactor(c.yoy, c.chg3) *
    competitionFactor(c.compIdx, c.comp) *
    bidFactor(c.bidLow, c.bidHigh, c.avg) *
    tailFactor(c.stemCount) *
    obscurityFactor(c.avg) *
    (c.seasonF || 1) *
    (c.eventF || 1) *
    (c.dying ? 0.5 : 1)
  );
}

/* Familie-check tegen de bestaande organization. Een underdog moet een
   NIEUWE zoekvraag zijn, geen variant van iets dat er al staat:
   - zelfde canon → zelfde intent → weg
   - canon is deelverzameling van een bestaand canon (of andersom) met maar
     één stem verschil → kleur-/vorm-variant van hetzelfde ("black denim
     skirt" naast bestaand "denim skirt") → weg */
export function isFamilyOfExisting(canon, existingCanons) {
  if (!canon) return true;
  if (existingCanons.has(canon)) return true;
  const mine = canon.split(" ");
  const mySet = new Set(mine);
  for (const ex of existingCanons) {
    const theirs = ex.split(" ");
    if (Math.abs(theirs.length - mine.length) > 1) continue;
    const theirSet = new Set(theirs);
    const small = mine.length <= theirs.length ? mySet : theirSet;
    const big = mine.length <= theirs.length ? theirSet : mySet;
    let sub = true;
    for (const s of small) {
      if (!big.has(s)) {
        sub = false;
        break;
      }
    }
    if (sub) return true;
  }
  return false;
}

/* Productaantallen: underdogs zijn gerichte weddenschappen, geen volume-
   inkoop. Vloer 2, plafond 6, verdeeld naar score. */
export function allocateUnderdogs(items) {
  if (!items.length) return [];
  const max = Math.max(...items.map((i) => i.score));
  return items.map((i) => ({
    ...i,
    n: clamp(2 + Math.round(4 * (max > 0 ? i.score / max : 0)), 2, 6),
  }));
}
