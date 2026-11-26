import { NextResponse } from "next/server";
import { getPxSession } from "@/lib/px-session";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getPxSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
