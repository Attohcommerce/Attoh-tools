// Google Sheets via service account (GOOGLE_SERVICE_ACCOUNT_JSON env var).
import { JWT } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let cachedClient = null;

export function getServiceAccountEmail() {
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
    return creds.client_email || null;
  } catch {
    return null;
  }
}

function getClient() {
  if (cachedClient) return cachedClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var ontbreekt");
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is geen geldige JSON");
  }
  cachedClient = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
  return cachedClient;
}

/** Tabbladnaam veilig in A1-notatie. Een apostrof in de naam ("Men's USA")
 *  brak anders élke range: Google antwoordt dan "Unable to parse range". */
export function a1Tab(name) {
  return `'${String(name || "").replace(/'/g, "''")}'`;
}

export function parseSheetId(input) {
  const s = String(input || "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/);
  if (m) return m[1];
  return s;
}

async function sheetsFetch(path, method = "GET", body) {
  const client = getClient();
  const { token } = await client.getAccessToken();

  /* Google's Sheets-API geeft op grote tabbladen af en toe een tijdelijke
     500/503 terug — letterlijk "Internal error encountered." Dat is geen
     fout in onze data of code: het is hun kant die even omvalt, en een
     seconde later werkt exact hetzelfde verzoek wel. Drie pogingen met
     oplopende wachttijd vangen dat af; pas daarna geven we op, mét een
     leesbare uitleg i.p.v. Google's kale zin. */
  const RETRIES = 3;
  let lastMsg = "";
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 800 * attempt));
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    lastMsg = data && data.error ? data.error.message : `HTTP ${res.status}`;
    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable) throw new Error(lastMsg);
  }
  throw new Error(
    `Google Sheets antwoordde ${RETRIES}x met een fout: "${lastMsg}". Dit ligt aan Google, niet aan je gegevens — probeer het over een halve minuut opnieuw.`
  );
}

export async function readRange(sheetId, range) {
  const id = parseSheetId(sheetId);
  const data = await sheetsFetch(`${id}/values/${encodeURIComponent(range)}`);
  return data.values || [];
}

function colLetterOf(i) {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** Meerdere kolommen van één tabblad lezen — per kolom een eigen verzoek,
 *  PARALLEL. Eén values:batchGet met 12 kolommen × 182k rijen leek slimmer,
 *  maar Google's API klapt op zo'n reus-antwoord met letterlijk "Internal
 *  error encountered." — per kolom is op deze schaal bewezen stabiel.
 *  majorDimension=COLUMNS geeft de kolom als één platte array terug (geen
 *  182k rij-arraytjes uitpakken). Geeft { kolomIndex: [waarden vanaf rij 2] }. */
export async function readColumnsBatch(sheetId, tab, colIndices) {
  const id = parseSheetId(sheetId);
  const uniq = [...new Set(colIndices.filter((i) => i >= 0))];
  if (!uniq.length) return {};
  const results = await Promise.all(
    uniq.map(async (i) => {
      const L = colLetterOf(i);
      const data = await sheetsFetch(
        `${id}/values/${encodeURIComponent(`${a1Tab(tab)}!${L}2:${L}`)}?majorDimension=COLUMNS`
      );
      return [i, data.values && data.values[0] ? data.values[0] : []];
    })
  );
  return Object.fromEntries(results);
}

export async function appendRows(sheetId, range, rows, valueInputOption = "USER_ENTERED") {
  const id = parseSheetId(sheetId);
  await sheetsFetch(
    `${id}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
    "POST",
    { values: rows }
  );
  return { ok: true, appended: rows.length };
}

// updates: [{range: "H5", values: [["Twijfel"]]}, ...]
export async function batchUpdate(sheetId, updates) {
  const id = parseSheetId(sheetId);
  await sheetsFetch(`${id}/values:batchUpdate`, "POST", {
    valueInputOption: "USER_ENTERED",
    data: updates.map((u) => ({ range: u.range, values: u.values })),
  });
  return { ok: true, updated: updates.length };
}

// Spreadsheet-niveau wijzigingen (tabbladen, opmaak, filters)
export async function spreadsheetBatchUpdate(sheetId, requests) {
  const id = parseSheetId(sheetId);
  return sheetsFetch(`${id}:batchUpdate`, "POST", { requests });
}

/** Tab-id van het eerste blad in een spreadsheet. */
export async function getFirstTabId(sheetId) {
  const id = parseSheetId(sheetId);
  const data = await sheetsFetch(`${id}?fields=sheets.properties`);
  const first = (data.sheets || [])[0];
  return first && first.properties ? first.properties.sheetId : null;
}

/** Heel tabblad verwijderen. */
export async function deleteTab(sheetId, tabId) {
  await spreadsheetBatchUpdate(sheetId, [{ deleteSheet: { sheetId: Number(tabId) } }]);
  return { ok: true };
}

/** Numeriek tab-id opzoeken op tabbladnaam. */
export async function getTabIdByTitle(sheetId, title) {
  const id = parseSheetId(sheetId);
  const data = await sheetsFetch(`${id}?fields=sheets.properties`);
  const hit = (data.sheets || []).find(
    (s) => s.properties && s.properties.title === title
  );
  return hit ? hit.properties.sheetId : null;
}

/** Rijen verwijderen op 0-based rij-indexen (header = 0). */
export async function deleteRows(sheetId, tabId, rowIndexes) {
  if (!rowIndexes.length) return { ok: true, deleted: 0 };
  // Aflopend sorteren en aaneengesloten blokken samenvoegen zodat
  // eerdere verwijderingen de indexen van latere niet verschuiven.
  const sorted = [...new Set(rowIndexes)].sort((a, b) => b - a);
  const ranges = [];
  for (const i of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.start === i + 1) last.start = i;
    else ranges.push({ start: i, end: i + 1 });
  }
  const requests = ranges.map((r) => ({
    deleteDimension: {
      range: { sheetId: tabId, dimension: "ROWS", startIndex: r.start, endIndex: r.end },
    },
  }));
  await spreadsheetBatchUpdate(sheetId, requests);
  return { ok: true, deleted: sorted.length };
}

/** Tabblad hernoemen. */
export async function renameTab(sheetId, tabId, newName) {
  await spreadsheetBatchUpdate(sheetId, [
    {
      updateSheetProperties: {
        properties: { sheetId: tabId, title: newName },
        fields: "title",
      },
    },
  ]);
  return { ok: true };
}

/** Datarijen sorteren op één kolom (0-based), aflopend of oplopend. */
export async function sortTabByColumn(sheetId, tabId, colIndex, rowCount, colCount, descending = true) {
  await spreadsheetBatchUpdate(sheetId, [
    {
      sortRange: {
        range: {
          sheetId: tabId,
          startRowIndex: 1,
          endRowIndex: rowCount,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        sortSpecs: [
          { dimensionIndex: colIndex, sortOrder: descending ? "DESCENDING" : "ASCENDING" },
        ],
      },
    },
  ]);
  return { ok: true };
}

/** Cellen-inventaris van een workbook: elk tabblad met rijen × kolommen.
 *  Google rekent de limiet van 10 MILJOEN CELLEN over het hele bestand —
 *  ook lege cellen in een te breed aangemaakt raster tellen mee. */
export const SHEETS_CELL_LIMIT = 10000000;

export async function getSheetSizes(sheetId) {
  const id = parseSheetId(sheetId);
  const data = await sheetsFetch(`${id}?fields=sheets.properties`);
  return (data.sheets || []).map((s) => {
    const p = s.properties || {};
    const g = p.gridProperties || {};
    const rows = Number(g.rowCount) || 0;
    const cols = Number(g.columnCount) || 0;
    return { tabId: p.sheetId, title: p.title || "", rows, cols, cells: rows * cols };
  });
}

/** Nieuw tabblad aanmaken; geeft het numerieke tab-id terug.
 *  Met grid {rows, cols} krijgt het tabblad een EXACT raster. Zonder grid
 *  maakt Google 1000×26 aan, en bij het appenden groeien alleen de rijen
 *  mee — de 26 kolommen blijven. Een 182k-keywords-tabblad kostte zo 4,7M
 *  cellen terwijl de data er 3,6M nodig had; dat verschil duwde het
 *  workbook over de limiet. */
export async function addTab(sheetId, title, grid) {
  try {
    const properties = { title };
    if (grid && Number(grid.rows) > 0 && Number(grid.cols) > 0) {
      properties.gridProperties = {
        rowCount: Math.max(2, Math.ceil(Number(grid.rows))),
        columnCount: Math.max(1, Math.ceil(Number(grid.cols))),
      };
    }
    const data = await spreadsheetBatchUpdate(sheetId, [{ addSheet: { properties } }]);
    const props = data.replies && data.replies[0] && data.replies[0].addSheet.properties;
    return { ok: true, tabId: props.sheetId, title: props.title };
  } catch (e) {
    if (String(e.message).toLowerCase().includes("already exists")) {
      return { ok: false, error: `Tabblad "${title}" bestaat al — kies een andere naam` };
    }
    throw e;
  }
}

/**
 * Fancy opmaak voor een scraper-run-tabblad (de import-lijst):
 * goudkleurig tabblad, donkere header met goudkleurige tekst, banding,
 * nette kolombreedtes, filter en kleurcodering op Match/Dubbel/Twijfel.
 */
export async function formatRunTab(sheetId, tabId) {
  const DARK = { red: 0.11, green: 0.1, blue: 0.09 };
  const GOLD = { red: 0.9, green: 0.76, blue: 0.31 };
  const GOLD_TAB = { red: 0.79, green: 0.64, blue: 0.15 };
  const BAND_A = { red: 1, green: 1, blue: 1 };
  const BAND_B = { red: 0.972, green: 0.965, blue: 0.949 };
  const GREEN = { red: 0.13, green: 0.55, blue: 0.28 };
  const AMBER = { red: 0.72, green: 0.5, blue: 0.05 };
  const RED_BG = { red: 1, green: 0.9, blue: 0.9 };
  const ORANGE_BG = { red: 1, green: 0.95, blue: 0.85 };

  const COLS = [180, 330, 165, 165, 95, 95, 150, 130, 170, 110, 190]; // A t/m K
  const widthReqs = COLS.map((px, i) => ({
    updateDimensionProperties: {
      range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: "pixelSize",
    },
  }));

  const condRule = (col, rule, format) => ({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId: tabId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: col, endColumnIndex: col + 1 }],
        booleanRule: { condition: rule, format },
      },
    },
  });

  await spreadsheetBatchUpdate(sheetId, [
    // Goudkleurig tabblad + rij 1 bevroren
    {
      updateSheetProperties: {
        properties: { sheetId: tabId, tabColor: GOLD_TAB, gridProperties: { frozenRowCount: 1 } },
        fields: "tabColor,gridProperties.frozenRowCount",
      },
    },
    // Header: donker met goudkleurige caps, hoger, gecentreerd verticaal
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: DARK,
            textFormat: { bold: true, foregroundColor: GOLD, fontSize: 10 },
            verticalAlignment: "MIDDLE",
            numberFormat: { type: "TEXT" },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,numberFormat)",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 34 },
        fields: "pixelSize",
      },
    },
    // Notitie op A1 zodat meteen duidelijk is wat dit blad is
    {
      updateCells: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
        rows: [{ values: [{ note: "IMPORT-LIJST — output van de Attoh Tools Product Scraper. Elke rij is een gevonden product; de checks vullen Geslacht, Dubbele foto en Literal-twijfel." }] }],
        fields: "note",
      },
    },
    // Data: één regel per rij (clip), verticaal gecentreerd
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 11 },
        cell: { userEnteredFormat: { wrapStrategy: "CLIP", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
      },
    },
    ...widthReqs,
    // Zebra-banding voor rustig lezen
    {
      addBanding: {
        bandedRange: {
          range: { sheetId: tabId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 11 },
          rowProperties: { firstBandColor: BAND_A, secondBandColor: BAND_B },
        },
      },
    },
    // Filterknoppen
    {
      setBasicFilter: {
        filter: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 11 } },
      },
    },
    // Kleurcodering: Literal groen · Ruim amber · Dubbel rood · Twijfel oranje
    condRule(4, { type: "TEXT_EQ", values: [{ userEnteredValue: "Literal" }] }, { textFormat: { foregroundColor: GREEN, bold: true } }),
    condRule(4, { type: "TEXT_EQ", values: [{ userEnteredValue: "Ruim" }] }, { textFormat: { foregroundColor: AMBER } }),
    condRule(6, { type: "NOT_BLANK" }, { backgroundColor: RED_BG }),
    condRule(7, { type: "NOT_BLANK" }, { backgroundColor: ORANGE_BG }),
  ]);
  return { ok: true };
}

/**
 * Opmaak voor het verdelings-tabblad (Collection & Product organization):
 * rij 1 vast + geel + vet, filter op de keyword-tabel (A-H), alle kolommen
 * automatisch op breedte, getallen expliciet als getal.
 */
export async function formatVerdelingTab(sheetId, tabId, rowCount, tableCols = 8, totalCols = 13) {
  const YELLOW = { red: 1, green: 0.95, blue: 0.8 };
  await spreadsheetBatchUpdate(sheetId, [
    {
      updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols },
        cell: {
          userEnteredFormat: { backgroundColor: YELLOW, textFormat: { bold: true }, numberFormat: { type: "TEXT" } },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat.bold,numberFormat)",
      },
    },
    // getalkolommen in de tabel (E t/m H) expliciet als getal
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 4, endColumnIndex: 6 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    {
      setBasicFilter: {
        filter: {
          range: { sheetId: tabId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: tableCols },
        },
      },
    },
    {
      autoResizeDimensions: {
        dimensions: { sheetId: tabId, dimension: "COLUMNS", startIndex: 0, endIndex: totalCols },
      },
    },
  ]);
  return { ok: true };
}

/**
 * Opmaak voor een keyword-tabblad, exact zoals de handmatige versie:
 * rij 1 vast + geel + vet + filters, kolom A grijs, kolom A breed.
 */
export async function formatKeywordTab(sheetId, tabId, rowCount, colCount) {
  const YELLOW = { red: 1, green: 0.95, blue: 0.8 };
  const GREY = { red: 0.937, green: 0.937, blue: 0.937 };

  await spreadsheetBatchUpdate(sheetId, [
    // rij 1 bevriezen
    {
      updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    // header: geel + vet
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: YELLOW,
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat.bold)",
      },
    },
    // kolom A (onder de header): grijs
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { backgroundColor: GREY } },
        fields: "userEnteredFormat.backgroundColor",
      },
    },
    // kolom A breder
    {
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 230 },
        fields: "pixelSize",
      },
    },
    // alle getalkolommen expliciet als getal — nooit als datum interpreteren
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 1, endColumnIndex: colCount },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // kopcellen als tekst-opmaak zodat "jul 2025" gewoon tekst blijft
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
        cell: { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // filterknoppen over de hele tabel
    {
      setBasicFilter: {
        filter: {
          range: { sheetId: tabId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: colCount },
        },
      },
    },
  ]);
  return { ok: true };
}

/**
 * Opmaak voor het underdog-blok dat ONDER de bestaande verdeling wordt
 * geplakt. Drie problemen die de eerste versie had:
 *  1. de lange uitleg in kolom J liep visueel over het overzicht in K-N heen
 *  2. het blok had geen eigen koprij, dus het las niet als een tabel
 *  3. de filterbalk van de hoofdtabel dekte het blok niet, waardoor je niet
 *     op Type = "Underdog" kon filteren
 * Deze functie zet dat recht: eigen koprij, sectiebanner, nette breedtes,
 * afgekapte (niet doorlopende) uitleg-kolom, en één filter over ALLES.
 *
 * Rij-indexen zijn 0-based en absoluut binnen het tabblad.
 */
export async function formatUnderdogBlock(sheetId, tabId, opts) {
  const {
    bannerRow, // rij met "UNDERDOG KEYWORDS — …"
    headerRow, // rij met de kolomkoppen van het underdog-blok
    firstDataRow,
    lastDataRow, // exclusief
    summaryHeaderRow,
    summaryLastRow, // exclusief
    infoFirstRow,
    infoLastRow, // exclusief
  } = opts;

  const PLUM = { red: 0.357, green: 0.224, blue: 0.278 };
  const PLUM_SOFT = { red: 0.949, green: 0.925, blue: 0.933 };
  const IVORY = { red: 0.976, green: 0.961, blue: 0.941 };
  const WHITE = { red: 1, green: 1, blue: 1 };
  const HAIRLINE = { red: 0.906, green: 0.863, blue: 0.831 };

  const COL_W = [55, 210, 215, 55, 95, 120, 90, 75, 85, 430, 20, 235, 105, 110, 330];
  const widthReqs = COL_W.map((px, i) => ({
    updateDimensionProperties: {
      range: { sheetId: tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: "pixelSize",
    },
  }));

  const reqs = [
    ...widthReqs,

    // Sectiebanner over A:J — één doorlopende balk i.p.v. tekst die
    // toevallig in kolom B staat.
    {
      mergeCells: {
        range: { sheetId: tabId, startRowIndex: bannerRow, endRowIndex: bannerRow + 1, startColumnIndex: 0, endColumnIndex: 10 },
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: bannerRow, endRowIndex: bannerRow + 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            backgroundColor: PLUM,
            textFormat: { bold: true, foregroundColor: WHITE, fontSize: 11 },
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            padding: { left: 8 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: "ROWS", startIndex: bannerRow, endIndex: bannerRow + 1 },
        properties: { pixelSize: 30 },
        fields: "pixelSize",
      },
    },

    // Koprij van het underdog-blok
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            backgroundColor: PLUM_SOFT,
            textFormat: { bold: true },
            wrapStrategy: "CLIP",
            borders: { bottom: { style: "SOLID", color: PLUM } },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy,borders)",
      },
    },

    // Databereik: ivoor met dunne lijntjes, en kolom J AFGEKAPT zodat de
    // uitleg niet over het overzicht heen valt.
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            backgroundColor: IVORY,
            wrapStrategy: "CLIP",
            borders: { bottom: { style: "SOLID", color: HAIRLINE } },
          },
        },
        fields: "userEnteredFormat(backgroundColor,wrapStrategy,borders)",
      },
    },
    // getalkolommen E-H expliciet als getal
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 4, endColumnIndex: 8 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    // Type-kolom (I) opvallend: dit onderscheidt underdogs van de rest
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, foregroundColor: PLUM },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    },
    // Uitleg-kolom (J) in cursief grijs — leesbaar als toelichting
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: firstDataRow, endRowIndex: lastDataRow, startColumnIndex: 9, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            textFormat: { italic: true, foregroundColor: { red: 0.35, green: 0.31, blue: 0.33 } },
            wrapStrategy: "CLIP",
          },
        },
        fields: "userEnteredFormat(textFormat,wrapStrategy)",
      },
    },
  ];

  // Overzicht rechts (L-O): koprij + wrap, zodat niets over de rand valt
  if (summaryHeaderRow != null) {
    reqs.push(
      {
        repeatCell: {
          range: { sheetId: tabId, startRowIndex: summaryHeaderRow, endRowIndex: summaryHeaderRow + 1, startColumnIndex: 11, endColumnIndex: 15 },
          cell: {
            userEnteredFormat: {
              backgroundColor: PLUM_SOFT,
              textFormat: { bold: true },
              borders: { bottom: { style: "SOLID", color: PLUM } },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,borders)",
        },
      },
      {
        repeatCell: {
          range: { sheetId: tabId, startRowIndex: summaryHeaderRow + 1, endRowIndex: summaryLastRow, startColumnIndex: 11, endColumnIndex: 15 },
          cell: { userEnteredFormat: { backgroundColor: IVORY, wrapStrategy: "CLIP" } },
          fields: "userEnteredFormat(backgroundColor,wrapStrategy)",
        },
      }
    );
  }

  // Uitleg-blok onder het overzicht: samengevoegd over L:O met WRAP, anders
  // lopen die lange zinnen eindeloos naar rechts door.
  if (infoFirstRow != null) {
    for (let r = infoFirstRow; r < infoLastRow; r++) {
      reqs.push({
        mergeCells: {
          range: { sheetId: tabId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 11, endColumnIndex: 15 },
          mergeType: "MERGE_ALL",
        },
      });
    }
    reqs.push({
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: infoFirstRow, endRowIndex: infoLastRow, startColumnIndex: 11, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            wrapStrategy: "WRAP",
            verticalAlignment: "TOP",
            backgroundColor: WHITE,
            textFormat: { fontSize: 10 },
          },
        },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment,backgroundColor,textFormat)",
      },
    });
  }

  /* Eén filter over ALLES (A1 t/m de laatste underdog-rij). Rij 1 blijft de
     koprij, dus je kunt nu in één klik op Type = "Underdog" filteren en het
     hele blok apart bekijken. Google staat maar één basisfilter per tabblad
     toe — daarom uitbreiden i.p.v. een tweede toevoegen. */
  reqs.push({
    setBasicFilter: {
      filter: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: lastDataRow, startColumnIndex: 0, endColumnIndex: 10 },
      },
    },
  });

  await spreadsheetBatchUpdate(sheetId, reqs);
  return { ok: true };
}
