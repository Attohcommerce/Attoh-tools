import { NextResponse } from "next/server";
import { getReisSession, getReisUsers, publicUser } from "@/lib/reis/session";

export async function POST(req) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "Vul e-mail en wachtwoord in" }, { status: 400 });
  const users = getReisUsers();
  if (!users.length) {
    return NextResponse.json({ error: "Nog geen wachtwoorden ingesteld — zet REIS_JUSTIN_PASSWORD / REIS_QUINTY_PASSWORD in Vercel" }, { status: 500 });
  }
  const u = users.find((x) => x.email === String(email).toLowerCase().trim() && x.password === password);
  if (!u) return NextResponse.json({ error: "Onjuiste inloggegevens" }, { status: 401 });
  const s = await getReisSession();
  s.user = publicUser(u);
  await s.save();
  return NextResponse.json({ ok: true, user: s.user });
}
