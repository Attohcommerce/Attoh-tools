import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { liveInfo } from "@/lib/reis/liveinfo";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const u = new URL(req.url);
  try {
    return NextResponse.json(await liveInfo(u.searchParams.get("dest"), u.searchParams.get("depart"), u.searchParams.get("ret")));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
