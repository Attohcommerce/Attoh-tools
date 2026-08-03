import { NextResponse } from "next/server";
import { getSession, getUsers } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const user = session.user;
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // Naam kan ná het inloggen zijn ingesteld via env vars — dan pakken we die alsnog.
  let name = user.name;
  if (!name) {
    const match = getUsers().find((u) => u.email === user.email);
    name = (match && match.name) || "";
  }

  return NextResponse.json({ email: user.email, name });
}
