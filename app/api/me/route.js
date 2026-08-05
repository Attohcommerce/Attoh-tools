import { NextResponse } from "next/server";
import { getSession, getUsers } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const user = session.user;
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // Naam/bedrijf kunnen ná het inloggen zijn ingesteld via env vars — dan
  // pakken we die alsnog uit de actuele gebruikerslijst.
  let name = user.name;
  let company = user.company;
  if (!name || !company) {
    const match = getUsers().find((u) => u.email === user.email);
    if (!name) name = (match && match.name) || "";
    if (!company) company = (match && match.company) || "";
  }

  return NextResponse.json({ email: user.email, name, company });
}
