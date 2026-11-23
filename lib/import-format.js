// IMPORT-LIJST-FORMAAT (20-10-2026) — één plek voor de kopregel van de
// import-lijst die de scraper schrijft en de importer leest, plus het lezen
// van Chaims scraper-output (Sa Collective).
//
//  Attoh-formaat (scraper → import-lijst, importer "Sheet plakken"):
//    A LINK · B TITEL · C KEYWORD · D GEVONDEN VIA · E MATCH · F GESLACHT
//    (Man/Vrouw) · G DUBBELE FOTO · H LITERAL-TWIJFEL · I COLLECTIE · J TYPE ·
//    K TITELVORM · L VRAAG · M VRAAG-SCORE · N SIGNALEN · O FOTO-CIJFER (1–10,
//    hoe branded de foto's ogen) · P FOTO-OORDEEL · Q PRIJS (onze verkoopprijs)
//    · R PRIJS CONCURRENT · S KORTING % (doorstreepprijs)
//  Prijs-kolommen (23-11, Big Competitors): staat er een PRIJS, dan zet de
//  importer precies die prijs (geen prijsband). Alleen PRIJS CONCURRENT? Dan
//  rekent de importer zelf "net eronder" uit (USD/GBP/CAD: 5 eronder, op het
//  X4,95/X9,95-rooster). KORTING % leeg → 50/60/70 vast per product-URL.
//  Chaim-formaat (zijn scraper, tabs "Week 1" / "Vrouw Week 1" / "Man week 1"):
//    A Keyword · B Competitor · C Match · D Productnaam · E URL · F Geslacht
//    (Women/Men) · G Duplicaten · H Literal-check · I Store — soms zónder
//    kopregel (dan is rij 1 al data).
//
// Puur JavaScript, geen server-imports: wordt gebruikt in de importer en de
// scraper (client) én in /api/sheets (server, omzetten van een tabblad).

export const IMPORT_HEADER = [
  "LINK", "TITEL", "KEYWORD", "GEVONDEN VIA", "MATCH", "GESLACHT",
  "DUBBELE FOTO", "LITERAL-TWIJFEL", "COLLECTIE", "TYPE", "TITELVORM",
  "VRAAG", "VRAAG-SCORE", "SIGNALEN", "FOTO-CIJFER", "FOTO-OORDEEL",
  "PRIJS", "PRIJS CONCURRENT", "KORTING %",
];

/** "$59,95" / "59.95" / "€ 1.059,95" → 59.95 (of 0 als het geen getal is). */
export function parsePrice(v) {
  let t = String(v == null ? "" : v).replace(/[^0-9.,]/g, "");
  if (!t) return 0;
  if (t.includes(",") && t.includes(".")) {
    // laatste scheidingsteken = decimaal
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (t.includes(",")) {
    t = /,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
  }
  const n = Number(t);
  return n > 0 ? Math.round(n * 100) / 100 : 0;
}

/* Hoeveel we onder de concurrent gaan zitten, per store-valuta (Justin 23-11:
   USA $5, UK £5, Canada CA$5 — misschien 10). */
export const UNDERCUT = { USD: 5, GBP: 5, CAD: 5, AUD: 5, NZD: 5, EUR: 5 };

/** Naar beneden op het X4,95/X9,95-rooster: 59,95 → 59,95 · 61 → 59,95 · 58 → 54,95. */
export function floorTo95(n) {
  if (!(n > 0)) return 0;
  const out = Math.floor((n + 0.05 + 1e-9) / 5) * 5 - 0.05;
  return out > 0 ? Math.round(out * 100) / 100 : 0;
}

/** Concurrent-prijs → onze prijs: X onder hun prijs, op het rooster. 64,95 → 59,95. */
export function undercutPrice(competitorPrice, currency) {
  const c = parsePrice(competitorPrice);
  if (!c) return 0;
  const off = UNDERCUT[String(currency || "USD").toUpperCase()] || 5;
  return floorTo95(c - off);
}

/** Vaste doorstreep-korting per product (50/60/70), afgeleid van de URL —
    zelfde product = altijd dezelfde korting (prijs-stabiliteit, GMC). */
export function sheetDiscountFor(url) {
  let h = 0;
  const s = String(url || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return [50, 60, 70][h % 3];
}

// Zelfde regex als de scraper (Type "Gelegenheid")
export const OCCASION_RE =
  /\b(christmas|xmas|race day|races|nye|new years?|wedding|bridesmaid|mother of the (bride|groom)|formal|cocktail|evening|party|going out|graduation|engagement|semi formal|ball|dinner|occasion|prom|gala)\b/i;

const low = (v) => String(v || "").toLowerCase().trim();
const isUrl = (v) => /^https?:\/\//i.test(String(v || "").trim());
// Krul-apostrof (’) → ' : anders "Men's 's Chino Shorts" in titel en type
export const straightQ = (s) => String(s || "").replace(/[‘’ʼ`´]/g, "'");

export function normGender(v) {
  const g = low(v);
  if (/^(men|man|mens|men's|heren|male|m)$/.test(g)) return "Man";
  if (/^(women|woman|womens|women's|vrouw|dames|ladies|female|v|w)$/.test(g)) return "Vrouw";
  return "";
}

/**
 * Herkent het formaat van een import-tabblad.
 * → { format: "attoh" | "chaim" | "unknown", hasHeader, urlCol }
 */
export function detectImportFormat(values) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) return { format: "unknown", hasHeader: false, urlCol: -1 };
  const h = (rows[0] || []).map(low);
  // kopregel met "url"/"link" erin?
  let urlCol = h.findIndex((c) => c === "url" || c === "link" || c.startsWith("link"));
  let hasHeader = urlCol >= 0;
  if (!hasHeader) {
    // geen kopregel: de kolom waarin de eerste rijen een http-link hebben
    const sample = rows.slice(0, 6);
    const width = Math.max(...sample.map((r) => (r || []).length), 0);
    for (let c = 0; c < width && urlCol < 0; c++) {
      if (sample.some((r) => isUrl((r || [])[c]))) urlCol = c;
    }
  }
  if (urlCol === 0) return { format: "attoh", hasHeader: true, urlCol };
  if (urlCol === 4) return { format: "chaim", hasHeader, urlCol };
  return { format: "unknown", hasHeader, urlCol };
}

/**
 * Leest een import-tabblad in beide formaten naar dezelfde rijen:
 * { url, title, keyword, via, match, gender, dup, doubt, collection, kwType, titleForm }
 */
export function parseImportRows(values) {
  const det = detectImportFormat(values);
  const rows = Array.isArray(values) ? values : [];
  const out = [];
  if (det.format === "attoh") {
    // Prijs-kolommen op naam zoeken (Q/R/S), zodat oudere sheets zonder die
    // kolommen gewoon blijven werken.
    const head = (rows[0] || []).map(low);
    const ci = (re) => head.findIndex((c) => re.test(c));
    const iPrice = ci(/^(prijs|onze prijs|price|our price)$/);
    const iComp = ci(/^(prijs concurrent|concurrent prijs|competitor price|prijs competitor)$/);
    const iDisc = ci(/^(korting|korting %|korting%|discount|discount %|compare.?at %)$/);
    for (const r of rows.slice(1)) {
      const url = String((r || [])[0] || "").trim();
      if (!url || !/products\//i.test(url)) continue;
      out.push({
        url,
        title: straightQ(r[1]).trim(),
        keyword: straightQ(r[2]).trim(),
        via: String(r[3] || "").trim(),
        match: String(r[4] || "").trim(),
        gender: String(r[5] || "").trim(),
        dup: String(r[6] || "").trim(),
        doubt: String(r[7] || "").trim(),
        collection: String(r[8] || "").trim(),
        kwType: String(r[9] || "").trim(),
        titleForm: straightQ(r[10]).trim(),
        price: iPrice >= 0 ? parsePrice(r[iPrice]) : 0,
        competitorPrice: iComp >= 0 ? parsePrice(r[iComp]) : 0,
        discount: iDisc >= 0 ? parsePrice(r[iDisc]) : 0,
      });
    }
  } else if (det.format === "chaim") {
    for (const r of rows.slice(det.hasHeader ? 1 : 0)) {
      const url = String((r || [])[4] || "").trim();
      if (!url || !/products\//i.test(url)) continue;
      const keyword = straightQ(r[0]).trim();
      out.push({
        url,
        title: straightQ(r[3]).trim(),
        keyword,
        via: String(r[1] || "").trim(), // competitor-domein
        match: String(r[2] || "").trim() || "Literal",
        gender: normGender(r[5]),
        dup: String(r[6] || "").trim(), // "Duplicate 1"
        doubt: String(r[7] || "").trim(), // "Core word missing from title"
        collection: "",
        kwType: OCCASION_RE.test(keyword) ? "Gelegenheid" : "Direct",
        titleForm: "",
      });
    }
  }
  return { ...det, rows: out };
}

/** Eén geparste rij → rij in het Attoh-formaat (14 kolommen, A–N). */
export function toImportRow(p) {
  return [
    p.url, p.title, p.keyword, p.via, p.match, p.gender,
    p.dup, p.doubt, p.collection || "", p.kwType || "", p.titleForm || "",
    p.demandLabel || "", p.demand == null ? "" : p.demand, p.signals || "",
  ];
}
