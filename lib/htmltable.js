// HTML-TABELLEN — generieke parser voor maattabellen in productomschrijvingen
// (bron-stores/concurrenten). Pure functies, geen netwerk. Gebruikt door
// lib/sourcestore.js; unit-tests in scripts/test-sizeguide.mjs.

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
export const stripTags = (s) => decodeEntities(String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const SIZE_WORDS = /\b(size|sizes|bust|chest|waist|hips?|length|shoulder|sleeve|inseam|thigh|foot|insole|heel|us|eu|uk|au|cm|inch|inches|in)\b/i;
const MEASURE_WORDS = /\b(bust|chest|waist|hips?|length|shoulder|sleeve|inseam|thigh|foot|insole|heel|rise|width|height|weight|cup|band|leg|outseam|hem|cuff|neck|collar|torso)\b/i;
const SIZE_LABEL = /^(xxx?s|xs|s|m|l|x{1,6}l|\d?xl|[2-9]xl|one\s*size|free\s*size|os|\d{1,3}(\.5)?|\d{1,2}[a-z]{1,2}|\d{2}\/\d{2}|[a-z]{1,2}\/[a-z]{1,2})$/i;

const numMedian = (rows) => {
  const v = [];
  for (const r of rows) for (const c of r.slice(1)) {
    const n = parseFloat(String(c).replace(",", "."));
    if (Number.isFinite(n)) v.push(n);
  }
  v.sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const labelsOf = (rows) => rows.map((r) => String(r[0] || "").trim().toLowerCase()).join("|");

/**
 * Dubbel-eenheid-tabellen (size-chart-apps zetten cm én inch in één <table>:
 * twee <tbody>'s of de rijen twee keer onder elkaar) → één set rijen + unit.
 * Voorkeur cm (onze canonieke eenheid).
 */
function resolveDualUnit(groups) {
  const g = groups.filter((x) => x.rows.length);
  if (g.length < 2) return null;
  const a = g[0];
  const b = g[1];
  if (labelsOf(a.rows) !== labelsOf(b.rows)) return null;
  const isCm = (x) => /\bcm\b|centim/i.test(x.cls || "");
  const isIn = (x) => /\bin\b|inch/i.test(x.cls || "");
  let cm = null;
  let inch = null;
  if (isCm(a) && !isCm(b)) [cm, inch] = [a, b];
  else if (isCm(b) && !isCm(a)) [cm, inch] = [b, a];
  else if (isIn(a) && !isIn(b)) [cm, inch] = [b, a];
  else if (isIn(b) && !isIn(a)) [cm, inch] = [a, b];
  else {
    const ma = numMedian(a.rows);
    const mb = numMedian(b.rows);
    if (ma == null || mb == null) return null;
    [cm, inch] = ma >= mb ? [a, b] : [b, a];
  }
  return { rows: cm.rows, unitHint: "cm", dual: true, inchRows: inch.rows };
}

/** Alle <table>-blokken → [{ headers, rows, text, unitHint? }] (koppen uit <thead> of eerste rij) */
export function parseHtmlTables(html) {
  const h = String(html || "");
  const out = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(h))) {
    const table = m[0];
    const cellsOf = (tr) => (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(stripTags);
    const rowsOf = (frag) => {
      const rows = [];
      for (const tr of frag.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
        const cells = cellsOf(tr);
        if (!cells.length || cells.every((c) => !c)) continue;
        rows.push(cells);
      }
      return rows;
    };
    let headers = [];
    let bodyHtml = table;
    const theadM = table.match(/<thead[\s\S]*?<\/thead>/i);
    if (theadM) {
      const tr = theadM[0].match(/<tr[\s\S]*?<\/tr>/i);
      headers = tr ? cellsOf(tr[0]) : [];
      bodyHtml = table.replace(theadM[0], "");
    }
    // Meerdere <tbody>'s (cm/in-apps) apart lezen
    const tbodies = bodyHtml.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/gi) || [];
    let groups = tbodies.length >= 2 ? tbodies.map((tb) => ({ cls: (tb.match(/<tbody([^>]*)>/i) || [])[1] || "", rows: rowsOf(tb) })) : [{ cls: "", rows: rowsOf(bodyHtml) }];
    if (!headers.length && groups[0].rows.length) headers = groups[0].rows.shift(); // geen <thead>: eerste rij = koppen
    let rows = groups.flatMap((g) => g.rows);
    let unitHint = null;
    // Rijen twee keer onder elkaar (S..3XL, S..3XL) zonder aparte tbody's → splitsen
    if (groups.length === 1 && rows.length >= 4 && rows.length % 2 === 0) {
      const half = rows.length / 2;
      const g1 = rows.slice(0, half);
      const g2 = rows.slice(half);
      if (labelsOf(g1) === labelsOf(g2)) groups = [{ cls: "", rows: g1 }, { cls: "", rows: g2 }];
    }
    const dual = resolveDualUnit(groups);
    if (dual) {
      rows = dual.rows;
      unitHint = dual.unitHint;
      headers = headers.map((x) => x.replace(/\((cm|in|inch|inches)\)/gi, "").replace(/\s+/g, " ").trim());
    }
    if (headers.length && rows.length) out.push({ headers, rows, text: stripTags(table), unitHint });
  }
  return out;
}

const isSizeLabel = (s) => SIZE_LABEL.test(String(s || "").trim().replace(/\s+/g, " "));

/**
 * orientTable({headers, rows}) → {headers, rows} met maten als RIJEN.
 * Concurrenten zetten de maten vaak bovenaan (Size | S | M | L) met de
 * maatsoorten als rijen (Bust | 84 | 88 | 92) → transponeren.
 */
export function orientTable(t) {
  const headers = t.headers || [];
  const rows = t.rows || [];
  if (headers.length < 2 || !rows.length) return t;
  const topSizes = headers.slice(1).filter(isSizeLabel).length;
  const firstColMeasures = rows.filter((r) => MEASURE_WORDS.test(String(r[0] || ""))).length;
  const firstColSizes = rows.filter((r) => isSizeLabel(r[0])).length;
  const transposed = topSizes >= Math.max(2, Math.ceil((headers.length - 1) * 0.6)) && firstColMeasures >= Math.max(1, Math.ceil(rows.length * 0.5)) && firstColSizes < rows.length * 0.5;
  if (!transposed) return t;
  const newHeaders = ["Size", ...rows.map((r) => String(r[0] || ""))];
  const newRows = headers.slice(1).map((sz, j) => [sz, ...rows.map((r) => String(r[j + 1] == null ? "" : r[j + 1]))]);
  return { headers: newHeaders, rows: newRows, text: t.text, unitHint: t.unitHint || null };
}

/** Ziet dit eruit als een maattabel (koppen met maatwoorden, ≥2 rijen, ≥2 kolommen)? */
export function looksLikeSizeTable(t) {
  if (!t || !t.headers || t.headers.length < 2 || !t.rows || t.rows.length < 2) return false;
  const head = t.headers.join(" ");
  const firstCol = t.rows.map((r) => r[0]).join(" ");
  const hasWords = SIZE_WORDS.test(head) || MEASURE_WORDS.test(firstCol);
  if (!hasWords) return false;
  // minstens één numerieke cel per rij in de meeste rijen
  const numericRows = t.rows.filter((r) => r.slice(1).some((c) => /\d/.test(String(c || "")))).length;
  return numericRows >= Math.ceil(t.rows.length * 0.6);
}

/** cm/inch-hint uit de tekst rondom/in de tabel */
export function unitHintFrom(text) {
  const s = String(text || "").toLowerCase();
  const cm = (s.match(/\bcm\b|centimet/g) || []).length;
  const inch = (s.match(/\binch(es)?\b|\(in\)|["″]/g) || []).length;
  if (cm && !inch) return "cm";
  if (inch && !cm) return "in";
  if (cm && inch) return cm >= inch ? "cm" : "in";
  return null;
}

/** Alle maattabellen uit HTML, beste eerst → [{ headers, rows, unitHint }] */
export function pickSizeTables(html) {
  const tables = parseHtmlTables(html).map(orientTable).filter(looksLikeSizeTable);
  // Voorkeur: meeste maatwoorden in de koppen, dan meeste rijen
  tables.sort((a, b) => {
    const wa = a.headers.filter((h) => SIZE_WORDS.test(h) || MEASURE_WORDS.test(h)).length;
    const wb = b.headers.filter((h) => SIZE_WORDS.test(h) || MEASURE_WORDS.test(h)).length;
    return wb - wa || b.rows.length - a.rows.length;
  });
  // Dubbele tabellen (zelfde koppen + rijen) één keer
  const seen = new Set();
  return tables
    .filter((t) => {
      const k = JSON.stringify([t.headers, t.rows]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((t) => ({ headers: t.headers, rows: t.rows, unitHint: t.unitHint || unitHintFrom(t.text) }));
}

/** Beste maattabel uit HTML → { headers, rows, unitHint } | null */
export function pickSizeTable(html) {
  const all = pickSizeTables(html);
  return all.length ? all[0] : null;
}

/** <img>-bronnen uit HTML (in volgorde, uniek) */
export function imageSrcsFrom(html) {
  const out = [];
  const re = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    let src = m[1].trim();
    if (src.startsWith("//")) src = "https:" + src;
    if (/^https?:\/\//i.test(src) && !out.includes(src)) out.push(src);
  }
  return out;
}
