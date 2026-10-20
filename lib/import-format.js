// IMPORT-LIJST-FORMAAT (20-10-2026) — één plek voor de kopregel van de
// import-lijst die de scraper schrijft en de importer leest, plus het lezen
// van Chaims scraper-output (Sa Collective).
//
//  Attoh-formaat (scraper → import-lijst, importer "Sheet plakken"):
//    A LINK · B TITEL · C KEYWORD · D GEVONDEN VIA · E MATCH · F GESLACHT
//    (Man/Vrouw) · G DUBBELE FOTO · H LITERAL-TWIJFEL · I COLLECTIE · J TYPE ·
//    K TITELVORM · L VRAAG · M VRAAG-SCORE · N SIGNALEN
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
  "VRAAG", "VRAAG-SCORE", "SIGNALEN",
];

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
