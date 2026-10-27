// "Alle opties" voor één bestemming: vluchten (alle data) of hotels (gekozen data).
import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { exploreFlights, exploreHotels } from "@/lib/reis/explore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { search, destId, what, checkin, checkout } = await req.json().catch(() => ({}));
  try {
    if (what === "hotels") {
      if (!checkin || !checkout) return NextResponse.json({ error: "Kies eerst een vlucht" }, { status: 400 });
      return NextResponse.json(await exploreHotels(search || {}, destId, checkin, checkout));
    }
    return NextResponse.json(await exploreFlights(search || {}, destId));
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
