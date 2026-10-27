import { NextResponse } from "next/server";
import { getReisSession } from "@/lib/reis/session";

export async function POST() {
  const s = await getReisSession();
  s.destroy();
  return NextResponse.json({ ok: true });
}
