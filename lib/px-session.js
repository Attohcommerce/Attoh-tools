// Sessie voor Pythago Extern (/px) — eigen cookie, los van de Attoh Tools-login.
// Een externe gebruiker (bijv. Cas) krijgt dus nooit sa_tools_session en kan
// alleen bij /px en /api/px (zie middleware.js en lib/pythago-ext.js).
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export const pxSessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "dev-only-secret-change-me-in-vercel-env-1234567890",
  cookieName: "attoh_px_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 60, // 60 dagen ingelogd blijven
  },
};

export async function getPxSession() {
  return getIronSession(cookies(), pxSessionOptions);
}
