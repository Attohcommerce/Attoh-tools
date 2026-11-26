import { NextResponse } from "next/server";
import { getPxSession } from "@/lib/px-session";
import { extByToken, extFail, extFailCount, extFailReset, extTouch, logAdd } from "@/lib/pythago-ext";

// Pythago Extern — inloggen met de persoonlijke link (token) + eigen e-mailadres.
// Geen wachtwoord: de link is het geheim, het e-mailadres de controle.
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { token, email } = await req.json().catch(() => ({}));
  const t = String(token || "").trim();
  const e = String(email || "").trim().toLowerCase();
  if (!t) return NextResponse.json({ error: "Open je persoonlijke Pythago-link opnieuw." }, { status: 400 });
  if (!e) return NextResponse.json({ error: "Vul je e-mailadres in." }, { status: 400 });
  if ((await extFailCount(t)) >= 8) return NextResponse.json({ error: "Te veel pogingen. Probeer het over 15 minuten opnieuw." }, { status: 429 });

  const u = await extByToken(t);
  if (!u || u.disabled || u.email !== e) {
    await extFail(t);
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: u && u.disabled ? "Deze toegang staat uit." : "Dit e-mailadres hoort niet bij deze link." }, { status: 401 });
  }
  await extFailReset(t);
  const session = await getPxSession();
  session.user = { id: u.id, email: u.email, name: u.name };
  await session.save();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  await extTouch({ ...u, lastSeen: "" }, ip);
  for (const d of u.stores || []) await logAdd(u.org, d, { email: u.email, name: u.name, action: "login", detail: "ingelogd" });
  return NextResponse.json({ ok: true, name: u.name });
}
