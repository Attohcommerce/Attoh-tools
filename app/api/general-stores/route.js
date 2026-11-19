import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readState, writeState } from "@/lib/general-stores";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  try {
    return NextResponse.json({ state: await readState() });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ state: await writeState(body && body.state) });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
