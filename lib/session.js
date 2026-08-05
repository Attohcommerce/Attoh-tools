import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export const sessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "dev-only-secret-change-me-in-vercel-env-1234567890",
  cookieName: "sa_tools_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 dagen
  },
};

export async function getSession() {
  return getIronSession(cookies(), sessionOptions);
}

// Valt terug op het deel vóór de @ als er geen naam is ingesteld.
function nameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "";
  const first = local.split(/[.\-_+0-9]/).filter(Boolean)[0] || local;
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// 2 gebruikers via env vars — geen database nodig.
// USER1_NAME / USER2_NAME zijn optioneel en bepalen de naam in de begroeting.
// USER1_COMPANY / USER2_COMPANY zijn optioneel; zonder env var gelden de
// standaard-bedrijven hieronder. De hele interface (begroeting, Operator-blok)
// past zich aan op de ingelogde gebruiker.
export function getUsers() {
  const users = [];
  if (process.env.USER1_EMAIL && process.env.USER1_PASSWORD) {
    const email = process.env.USER1_EMAIL.toLowerCase().trim();
    users.push({
      email,
      password: process.env.USER1_PASSWORD,
      name: (process.env.USER1_NAME || "").trim() || nameFromEmail(email),
      company: (process.env.USER1_COMPANY || "").trim() || "Sa Collective LLC",
    });
  }
  if (process.env.USER2_EMAIL && process.env.USER2_PASSWORD) {
    const email = process.env.USER2_EMAIL.toLowerCase().trim();
    users.push({
      email,
      password: process.env.USER2_PASSWORD,
      name: (process.env.USER2_NAME || "").trim() || nameFromEmail(email),
      company: (process.env.USER2_COMPANY || "").trim() || "Tasdelen Holdings LLC",
    });
  }
  // Lokale dev-fallback zolang er nog geen env vars zijn ingesteld
  if (users.length === 0 && process.env.NODE_ENV !== "production") {
    users.push({ email: "dev@local", password: "dev", name: "Justin", company: "Sa Collective LLC" });
  }
  return users;
}

export async function requireSession() {
  const session = await getSession();
  if (!session.user) {
    return null;
  }
  return session;
}
