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

// 2 gebruikers via env vars — geen database nodig.
export function getUsers() {
  const users = [];
  if (process.env.USER1_EMAIL && process.env.USER1_PASSWORD) {
    users.push({
      email: process.env.USER1_EMAIL.toLowerCase().trim(),
      password: process.env.USER1_PASSWORD,
    });
  }
  if (process.env.USER2_EMAIL && process.env.USER2_PASSWORD) {
    users.push({
      email: process.env.USER2_EMAIL.toLowerCase().trim(),
      password: process.env.USER2_PASSWORD,
    });
  }
  // Lokale dev-fallback zolang er nog geen env vars zijn ingesteld
  if (users.length === 0 && process.env.NODE_ENV !== "production") {
    users.push({ email: "dev@local", password: "dev" });
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
