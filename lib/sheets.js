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

export function parseSheetId(input) {
  const s = String(input || "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/);
  if (m) return m[1];
  return s;
}

async function sheetsFetch(path, method = "GET", body) {
  const client = getClient();
  const { token } = await client.getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error ? data.error.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function readRange(sheetId, range) {
  const id = parseSheetId(sheetId);
  const data = await sheetsFetch(`${id}/values/${encodeURIComponent(range)}`);
  return data.values || [];
}

export async function appendRows(sheetId, range, rows) {
  const id = parseSheetId(sheetId);
  await sheetsFetch(
    `${id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
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

/** Nieuw tabblad aanmaken; geeft het numerieke tab-id terug. */
export async function addTab(sheetId, title) {
  try {
    const data = await spreadsheetBatchUpdate(sheetId, [
      { addSheet: { properties: { title } } },
    ]);
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
