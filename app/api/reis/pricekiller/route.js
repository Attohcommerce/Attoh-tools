import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { listTrips } from "@/lib/reis/store";
import { priceKill } from "@/lib/reis/pricekiller";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  const trip = (await listTrips()).find((t) => t.id === id);
  if (!trip) return NextResponse.json({ error: "Reis niet gevonden" }, { status: 404 });
  try {
    return NextResponse.json(await priceKill(trip));
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 400 });
  }
}
