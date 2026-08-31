// KUNGFUBUY BILL PARSER — leest de ITEMS-tabel van een Kungfubuy-invoice
// (PDF) uit op basis van x/y-coördinaten van de tekst, NIET op de platte
// tekststroom. Reden: in de platte tekst plakken de cellen aan elkaar
// ("1710031;1;EUR25.5525.55…") en is de grens tussen ordernummer en
// aantallen wiskundig niet meer te bepalen. De kolomkoppen (Order,
// Quantity, Currency, Cost, OrderCost, Tax, ProductName, Store) geven per
// pagina de x-ankers; elke cel wordt aan de dichtstbijzijnde kolom
// toegewezen. Schaalt daardoor net zo goed naar honderden orderregels.

/* ---------- Gedeelde constanten & datum/getal-helpers (parse + enrich + commit) ---------- */

export const LOG_TAB = "COGS Log";
export const LOG_HEADER = [
  "Datum", "Order", "Invoice", "Stuks", "Bedrag", "Valuta", "Koers", "Bedrag £", "Storecode",
];
export const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Shopify created_at (ISO) → kalenderdag in Londen als "yyyy-mm-dd" —
 *  zelfde dagvenster-afspraak als de rest van het P&L-systeem. */
export function londonDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // en-CA geeft yyyy-mm-dd
}

/** Datumcel uit de sheet ("01/09/2026", "1-9-2026" of "2026-09-01") → {d,m,y}. */
export function splitDate(s) {
  const tokens = String(s == null ? "" : s).match(/\d+/g);
  if (!tokens || tokens.length < 3) return null;
  let d, m, y;
  if (tokens[0].length === 4) {
    [y, m, d] = tokens.map(Number);
  } else {
    [d, m, y] = tokens.map(Number);
    if (y < 100) y += 2000;
  }
  if (!d || !m || !y || d > 31 || m > 12) return null;
  return { d, m, y };
}

/** "yyyy-mm-dd" → "dd/mm/yyyy" (zoals de sheet datums toont). */
export function dateNLOf(ymd) {
  const s = splitDate(ymd);
  if (!s) return String(ymd || "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(s.d)}/${pad(s.m)}/${s.y}`;
}

/** Celwaarde → getal, bestand tegen NL-notatie ("123,45", "1.234,56"). */
export function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v == null ? "" : v).replace(/[£€$\s]/g, "");
  if (!s) return null;
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Afronden op 2 decimalen zonder float-artefacten: 10.50 × 0.85 is in
 *  JavaScript 8.924999…, wat met kaal Math.round £8,92 i.p.v. £8,93 zou
 *  geven. Eerst op 4 decimalen normaliseren, dan pas naar centen. */
export function round2(x) {
  return Math.round(Number((Number(x) * 100).toFixed(4))) / 100;
}

/** Dedupe-sleutel: dezelfde order op dezelfde invoice telt nooit twee keer. */
export function dupKey(order, invoiceNo) {
  return `${String(order == null ? "" : order).trim()}|${String(invoiceNo == null ? "" : invoiceNo).trim()}`;
}

/** Aantal stuks uit de Quantity-notatie: "1;1;" = 2 stuks, "2;" = 2, "3" = 3. */
export function parseQuantity(q) {
  const parts = String(q || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!parts.length) return { stuks: 0, regels: 0 };
  return { stuks: parts.reduce((a, b) => a + b, 0), regels: parts.length };
}

function toNumber(s) {
  const m = String(s || "").replace(/[^\d.]/g, "");
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : null;
}

// Kolomvolgorde zoals op de bill; "product" negeren we inhoudelijk, maar het
// x-anker is nodig zodat omgeslagen productnamen niet in de Tax-kolom vallen.
const COL_DEFS = [
  { key: "order", match: /^Order$/ },
  { key: "qty", match: /^Quantity$/ },
  { key: "currency", match: /^Currency$/ },
  { key: "cost", match: /^Cost$/ },
  { key: "orderCost", match: /^OrderCost$/ },
  { key: "tax", match: /^Tax$/ },
  { key: "product", match: /^ProductN/ },
  { key: "store", match: /^Store$/ },
];

/**
 * Parse een Kungfubuy-invoice-PDF (Buffer/Uint8Array).
 * Geeft { invoiceNo, invoiceDate, summary, rows, warnings } terug.
 * rows: [{ order, qty, stuks, currency, cost, orderCost, tax, store }]
 */
export async function parseKungfubuyPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const warnings = [];
  const rows = [];
  let invoiceNo = "";
  let invoiceDate = "";
  let summary = null;
  let cols = null; // laatst bekende kolom-ankers (voor vervolgpagina's zonder koprij)

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .map((it) => ({
        str: String(it.str || "").trim(),
        x: it.transform[4],
        y: it.transform[5],
      }))
      .filter((it) => it.str);

    const fullText = items.map((i) => i.str).join(" ");
    if (!invoiceNo) {
      const m = fullText.match(/Invoice\s*No[:\s]*([0-9]+)/i);
      if (m) invoiceNo = m[1];
    }
    if (!invoiceDate) {
      const m = fullText.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (m) invoiceDate = m[1];
    }

    // 1. Koprij zoeken: alle kolomkoppen die op (bijna) dezelfde y staan.
    const headerHits = [];
    for (const def of COL_DEFS) {
      const hit = items.find((it) => def.match.test(it.str));
      if (hit) headerHits.push({ key: def.key, x: hit.x, y: hit.y });
    }
    let headerY = null;
    if (headerHits.length >= 6) {
      // y van de koprij = meest voorkomende y onder de hits
      const yCount = new Map();
      for (const h of headerHits) {
        const yk = Math.round(h.y);
        yCount.set(yk, (yCount.get(yk) || 0) + 1);
      }
      const bestY = [...yCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const sameLine = headerHits.filter((h) => Math.abs(h.y - bestY) < 3);
      if (sameLine.length >= 6) {
        headerY = bestY;
        cols = sameLine.sort((a, b) => a.x - b.x);
      }
    }
    if (!cols) {
      // Geen koprij op pagina 1 → dit is geen Kungfubuy-bill.
      if (p === 1) {
        warnings.push("Geen ITEMS-tabel gevonden — is dit wel een Kungfubuy-bill?");
        break;
      }
      continue;
    }

    // 2. Kolomgrenzen = middens tussen de x-ankers van de koppen. Data staat
    //    links uitgelijnd en begint iets vóór de kop (celpadding), dus we
    //    rekenen met midpoints in plaats van exacte x-posities.
    const bounds = [];
    for (let i = 0; i < cols.length; i++) {
      const left = i === 0 ? -Infinity : (cols[i - 1].x + cols[i].x) / 2 - 4;
      bounds.push({ key: cols[i].key, left });
    }
    const colOf = (x) => {
      let found = null;
      for (const b of bounds) if (x >= b.left) found = b.key;
      return found;
    };

    // 3. Tabelgebied van deze pagina afbakenen: onder de koprij (of, op
    //    vervolgpagina's zonder koprij, vanaf de bovenkant), tot aan de
    //    Summary-regel (of de ondermarge — footer "1 / 1" e.d. valt daarbuiten).
    const summaryItem = items.find((it) => it.str === "Summary");
    const topY = headerY !== null ? headerY - 4 : 1e9;
    const bottomY = summaryItem ? summaryItem.y + 4 : 26;

    if (summaryItem) {
      const sVal = items
        .filter((it) => Math.abs(it.y - summaryItem.y) < 3 && it.x > summaryItem.x)
        .map((it) => toNumber(it.str))
        .find((n) => n !== null);
      if (sVal !== null && sVal !== undefined) summary = sVal;
    }

    const cells = items.filter((it) => it.y < topY && it.y > bottomY);

    // 4. Rij-ankers: elk item in de Order-kolom dat een puur nummer is.
    const anchors = cells
      .filter((it) => colOf(it.x) === "order" && /^\d{3,}$/.test(it.str))
      .sort((a, b) => b.y - a.y); // van boven naar beneden

    for (let i = 0; i < anchors.length; i++) {
      const yTop = anchors[i].y + 3;
      const yBottom = i + 1 < anchors.length ? anchors[i + 1].y + 3 : bottomY;
      const rowCells = cells.filter((it) => it.y <= yTop && it.y > yBottom);
      const byCol = {};
      for (const c of rowCells.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const k = colOf(c.x);
        if (!k) continue;
        byCol[k] = (byCol[k] || "") + c.str;
      }
      const { stuks, regels } = parseQuantity(byCol.qty);
      rows.push({
        order: byCol.order || "",
        qty: byCol.qty || "",
        stuks,
        regels,
        currency: (byCol.currency || "").toUpperCase(),
        cost: toNumber(byCol.cost),
        orderCost: toNumber(byCol.orderCost),
        tax: toNumber(byCol.tax),
        store: byCol.store || "",
      });
    }
  }

  // 5. Controles die fouten vroeg zichtbaar maken i.p.v. stil in de sheet.
  for (const r of rows) {
    if (!r.order) warnings.push("Rij zonder ordernummer overgeslagen bij controle");
    if (r.cost === null) warnings.push(`Order ${r.order}: geen bedrag gevonden`);
    if (!r.stuks) warnings.push(`Order ${r.order}: aantal (Quantity) niet leesbaar`);
  }
  if (summary !== null && rows.length) {
    const sum = rows.reduce((a, r) => a + (r.cost || 0), 0);
    if (Math.abs(sum - summary) > 0.011) {
      warnings.push(
        `Som van de regels (${sum.toFixed(2)}) wijkt af van het Summary-bedrag op de bill (${summary.toFixed(2)}) — controleer de bill`
      );
    }
  }
  if (!rows.length) warnings.push("Geen orderregels gevonden in deze PDF");

  return { invoiceNo, invoiceDate, summary, rows, warnings };
}
