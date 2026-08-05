import { NextResponse } from "next/server";
import { getSession, getUsers } from "@/lib/session";

export async function POST(req) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "Vul e-mail en wachtwoord in" }, { status: 400 });
  }
  const users = getUsers();
  if (users.length === 0) {
    return NextResponse.json(
      { error: "Geen gebruikers ingesteld — zet USER1_EMAIL / USER1_PASSWORD in de env vars" },
      { status: 500 }
    );
  }
  const match = users.find(
    (u) => u.email === String(email).toLowerCase().trim() && u.password === password
  );
  if (!match) {
    return NextResponse.json({ error: "Onjuiste inloggegevens" }, { status: 401 });
  }
  const session = await getSession();
  session.user = { email: match.email, name: match.name || "", company: match.company || "" };
  await session.save();
  return NextResponse.json({ ok: true });
}
