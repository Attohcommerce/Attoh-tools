import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { hotelReviews } from "@/lib/reis/hotels";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("hotelId");
  if (!id) return NextResponse.json({ error: "hotelId ontbreekt" }, { status: 400 });
  try {
    return NextResponse.json(await hotelReviews(id));
  } catch (e) {
    return NextResponse.json({ error: e.message, reviews: [], pros: [], cons: [] }, { status: 200 });
  }
}
