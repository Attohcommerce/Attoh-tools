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
