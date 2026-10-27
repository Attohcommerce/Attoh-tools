// Hartje / duim omlaag op een resultaat → smaakprofiel ("het algoritme").
import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { learn } from "@/lib/reis/store";

export async function POST(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { destId, tags, weight } = await req.json().catch(() => ({}));
  if (!destId) return NextResponse.json({ error: "destId ontbreekt" }, { status: 400 });
  const w = Math.max(-3, Math.min(3, Number(weight) || 0));
  await learn(user.id, destId, Array.isArray(tags) ? tags : [], w);
  return NextResponse.json({ ok: true });
}
