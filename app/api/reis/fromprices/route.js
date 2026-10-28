// "Vanaf €X": goedkoopste retour per persoon vanaf Schiphol per bestemming
// in een maand (echte Travelpayouts-prijzen, 3 uur cache per route).
import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { DEST_BY_ID, isLongHaul } from "@/lib/reis/destinations";
import { tpRoundTrips, hasTravelpayouts } from "@/lib/reis/flights";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!hasTravelpayouts()) return NextResponse.json({ live: false, prices: {} });
  const u = new URL(req.url);
  const month = u.searchParams.get("month") || "";
  const ids = String(u.searchParams.get("ids") || "").split(",").filter((id) => DEST_BY_ID[id]).slice(0, 16);
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month ontbreekt" }, { status: 400 });
  const prices = {};
  await Promise.all(
    ids.map(async (id) => {
      const d = DEST_BY_ID[id];
      const long = isLongHaul(d);
      try {
        const rows = await tpRoundTrips("AMS", d.iata[0], month, !long);
        let best = null;
        for (const r of rows) {
          const n = Math.round((new Date(r.ret) - new Date(r.depart)) / 86400000);
          if (n < 5 || n > 21) continue;
          if (r.stopsOut > (long ? 1 : 0) || r.stopsBack > (long ? 1 : 0)) continue;
          if (!best || r.pricePP < best) best = r.pricePP;
        }
        if (best) prices[id] = Math.round(best);
      } catch {}
    })
  );
  return NextResponse.json({ live: true, prices });
}
