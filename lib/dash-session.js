// Sessie voor Dashboard Mobiel (/m) — eigen cookie, los van de Attoh Tools-login.
// Wie via de telefoonlink inlogt krijgt dus nooit sa_tools_session en kan alleen
// bij /m en /api/m (alleen kijken: omzet, ads, cashflow). Zie lib/dash-ext.js.
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export const dashSessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "dev-only-secret-change-me-in-vercel-env-1234567890",
  cookieName: "attoh_dash_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90, // 90 dagen ingelogd blijven
  },
};

export async function getDashSession() {
  return getIronSession(cookies(), dashSessionOptions);
}
