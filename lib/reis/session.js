// Reisplanner-login — staat volledig los van de store-tools (eigen cookie,
// eigen gebruikers). Quinty kan dus nooit bij de stores, en Justin's
// store-login geeft geen toegang tot de reisplanner (en andersom).
//
// Wachtwoorden ALLEEN via Vercel env vars, nooit in de code:
//   REIS_JUSTIN_PASSWORD, REIS_QUINTY_PASSWORD
// E-mail kan overschreven worden met REIS_JUSTIN_EMAIL / REIS_QUINTY_EMAIL.
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export const reisSessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "dev-only-secret-change-me-in-vercel-env-1234567890",
  cookieName: "attoh_reis_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90, // 90 dagen ingelogd blijven (telefoon)
  },
};

export function getReisUsers() {
  const defs = [
    {
      id: "justin",
      name: "Justin",
      theme: "wit",
      email: process.env.REIS_JUSTIN_EMAIL || "justinattoh.veerman@gmail.com",
      password: process.env.REIS_JUSTIN_PASSWORD || "",
    },
    {
      id: "quinty",
      name: "Quinty",
      theme: "roze",
      email: process.env.REIS_QUINTY_EMAIL || "quintygbr@gmail.com",
      password: process.env.REIS_QUINTY_PASSWORD || "",
    },
  ];
  const users = defs
    .map((u) => ({ ...u, email: u.email.toLowerCase().trim() }))
    .filter((u) => u.password);
  // Lokale dev: zonder env vars inloggen met wachtwoord "dev"
  if (users.length === 0 && process.env.NODE_ENV !== "production") {
    return defs.map((u) => ({ ...u, email: u.email.toLowerCase(), password: "dev" }));
  }
  return users;
}

export function publicUser(u) {
  return u ? { id: u.id, name: u.name, theme: u.theme, email: u.email } : null;
}

export const REIS_PEOPLE = [
  { id: "justin", name: "Justin" },
  { id: "quinty", name: "Quinty" },
];

export async function getReisSession() {
  return getIronSession(cookies(), reisSessionOptions);
}

export async function requireReisUser() {
  const s = await getReisSession();
  return s.user || null;
}
