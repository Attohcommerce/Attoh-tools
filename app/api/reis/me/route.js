import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { hasTravelpayouts, hasDuffel } from "@/lib/reis/flights";
import { hasLiteApi } from "@/lib/reis/hotels";
import { hasVision } from "@/lib/reis/vision";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  return NextResponse.json({
    user,
    live: { flights: hasTravelpayouts(), duffel: hasDuffel(), hotels: hasLiteApi(), vision: hasVision() },
  });
}
