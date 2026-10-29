// Eerste foto van een hotel (voor oudere bewaarde reizen zonder foto)
import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { hotelDetails, hasLiteApi } from "@/lib/reis/hotels";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !hasLiteApi()) return NextResponse.json({ photo: "" });
  try {
    const d = await hotelDetails(id);
    return NextResponse.json({ photo: (d && d.images && d.images[0]) || "" });
  } catch {
    return NextResponse.json({ photo: "" });
  }
}
