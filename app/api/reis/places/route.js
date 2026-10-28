import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { placeLabels } from "@/lib/reis/places";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { points } = await req.json().catch(() => ({}));
  return NextResponse.json({ places: await placeLabels(points) });
}
