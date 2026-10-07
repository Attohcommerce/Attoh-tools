// MARKT IS HEILIG — controle op een keyword-batch vóórdat hij in het geheugen
// komt (Aanvulstrategie 7-10-2026, sectie 2a).
//
// Twee checks, allebei puur (geen server-afhankelijkheden), zodat de
// Keywords-pagina ze in de browser op de CSV's kan draaien en de server op een
// gekoppeld tabblad:
//   1. SEIZOEN  — piekt de zomerkleding (swim, sandalen, linnen) en de
//      winterkleding (jassen, truien) in de maanden die bij het halfrond van de
//      markt horen? AUS/NZ: swim piekt dec–jan, jassen mei–jul. Klopt dat niet,
//      dan is het een batch van de verkeerde markt.
//   2. GESLACHT — staat er in een "MAN"-batch vooral dameskleding (of
//      andersom)? Dan zit de batch in het verkeerde vak.

export const HEMISPHERE = { USA: "N", UK: "N", CAN: "N", AUS: "S" };

const MONTH_IDX = {
  jan: 0, feb: 1, mar: 2, mrt: 2, apr: 3, may: 4, mei: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11,
};
export const MONTH_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** "Searches: Aug 2025" / "Aug 2025" / "okt 2025" → { m: 0..11, y, key: "2025-07" } of null */
export function parseMonthLabel(label) {
  const s = String(label || "").toLowerCase().replace(/^searches:\s*/, "").trim();
  const mm = s.match(/^([a-z]{3,4})\.?\s+(\d{4})$/);
  if (!mm) return null;
  const m = MONTH_IDX[mm[1].slice(0, 3)];
  if (m == null) return null;
  const y = Number(mm[2]);
  return { m, y, key: `${y}-${String(m).padStart(2, "0")}` };
}

// Warm = koopt men in de zomer; koud = in de winter. Bewust alleen duidelijke
// soorten — "boots" en "jeans" lopen te veel door het jaar heen.
const WARM_RE = /\b(swim\w*|bikini\w*|tankini\w*|bathers|boardies|board ?shorts?|sandals?|slides?|linen|sundress\w*|beach)\b/;
const COLD_RE = /\b(coats?|puffer\w*|parkas?|jumpers?|sweaters?|cardigans?|fleece\w*|thermal\w*|wool\w*|knitwear|overcoats?|trench ?coats?)\b/;

// Maanden waarin de piek hoort te liggen (0 = jan)
const PEAK_OK = {
  N: { warm: [3, 4, 5, 6, 7], cold: [8, 9, 10, 11, 0, 1] },
  S: { warm: [9, 10, 11, 0, 1, 2], cold: [3, 4, 5, 6, 7] },
};

/**
 * rows: [{ kw, months: [getallen, zelfde volgorde als monthLabels] }]
 * monthLabels: ["Sep 2025", …]
 * → { ok, inconclusive, text, warm: {n, peak}, cold: {n, peak} }
 */
export function seasonCheck(rows, monthLabels, market) {
  const hemi = HEMISPHERE[String(market || "").toUpperCase()];
  if (!hemi) return { ok: true, inconclusive: true, text: "Onbekende markt — seizoenscheck overgeslagen" };
  const idx = (monthLabels || []).map((l) => {
    const p = parseMonthLabel(l);
    return p ? p.m : -1;
  });
  if (idx.filter((i) => i >= 0).length < 10) {
    return { ok: true, inconclusive: true, text: `Maar ${idx.filter((i) => i >= 0).length} maandkolommen — seizoenscheck heeft er minstens 10 nodig` };
  }
  const warm = new Array(12).fill(0);
  const cold = new Array(12).fill(0);
  let nWarm = 0;
  let nCold = 0;
  for (const r of rows || []) {
    const kw = String(r.kw || "").toLowerCase();
    const isWarm = WARM_RE.test(kw);
    const isCold = COLD_RE.test(kw);
    if (isWarm === isCold) continue; // geen van beide, of twijfel
    const target = isWarm ? warm : cold;
    if (isWarm) nWarm++;
    else nCold++;
    (r.months || []).forEach((v, i) => {
      const m = idx[i];
      if (m >= 0) target[m] += Number(v) || 0;
    });
  }
  const peakOf = (arr) => {
    let best = -1;
    let bestV = 0;
    arr.forEach((v, i) => {
      if (v > bestV) { bestV = v; best = i; }
    });
    return { m: best, vol: arr.reduce((s, v) => s + v, 0) };
  };
  const pw = peakOf(warm);
  const pc = peakOf(cold);
  const enough = (n, p) => n >= 15 && p.vol >= 5000 && p.m >= 0;
  const okWarm = enough(nWarm, pw) ? PEAK_OK[hemi].warm.includes(pw.m) : null;
  const okCold = enough(nCold, pc) ? PEAK_OK[hemi].cold.includes(pc.m) : null;
  const lbl = (m) => (m >= 0 ? MONTH_SHORT[m] : "-");
  const parts = [];
  if (okWarm !== null) parts.push(`zomerkleding piekt in ${lbl(pw.m)} (${nWarm} keywords)`);
  if (okCold !== null) parts.push(`winterkleding piekt in ${lbl(pc.m)} (${nCold} keywords)`);
  const out = { warm: { n: nWarm, peak: lbl(pw.m) }, cold: { n: nCold, peak: lbl(pc.m) } };
  if (okWarm === null && okCold === null) {
    return { ...out, ok: true, inconclusive: true, text: "Te weinig zomer- of winterkleding in deze batch om het seizoen te controleren" };
  }
  const ok = okWarm !== false && okCold !== false;
  const expect = hemi === "S"
    ? "zuidelijk halfrond: zomerkleding hoort te pieken in okt–mrt, winterkleding in apr–aug"
    : "noordelijk halfrond: zomerkleding hoort te pieken in apr–aug, winterkleding in sep–feb";
  return {
    ...out,
    ok,
    inconclusive: false,
    text: ok
      ? `Seizoen klopt met ${market}: ${parts.join(" · ")}`
      : `Seizoen klopt NIET met ${market} (${expect}): ${parts.join(" · ")}. Dit lijkt een batch van een andere markt.`,
  };
}

const WOMEN_RE = /\b(women\w*|womens|woman|ladies|lady|female|girls?|dress\w*|skirts?|blouses?|bikini\w*|tankini\w*|bras?|heels|maxi|midi)\b/;
const MEN_RE = /\b(men|mens|man|male|guys?|gents?|boardies)\b/;

/**
 * gender: "V" | "M". Kijkt alleen naar keywords mét een duidelijk signaal.
 * → { ok, text, women, men }
 */
export function genderCheck(rows, gender) {
  let women = 0;
  let men = 0;
  for (const r of rows || []) {
    const kw = String(r.kw || "").toLowerCase();
    const w = WOMEN_RE.test(kw);
    const m = MEN_RE.test(kw) && !/\bwomen/.test(kw);
    if (w && !m) women++;
    else if (m && !w) men++;
  }
  const total = women + men;
  if (total < 30) return { ok: true, inconclusive: true, women, men, text: "Te weinig geslachtswoorden om het geslacht te controleren" };
  const share = gender === "M" ? men / total : women / total;
  const label = gender === "M" ? "MAN" : "VROUW";
  if (share < 0.35) {
    return {
      ok: false,
      women,
      men,
      text: `Geslacht klopt niet: dit is het ${label}-vak, maar ${Math.round((1 - share) * 100)}% van de keywords met een geslachtswoord is ${gender === "M" ? "dames" : "heren"} (${women} dames · ${men} heren). Zit de batch in het juiste vak?`,
    };
  }
  return { ok: true, women, men, text: `Geslacht klopt: ${women} dames- en ${men} herenwoorden in het ${label}-vak` };
}
