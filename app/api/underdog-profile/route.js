import { NextResponse } from "next/server";
import { buildUnderdogProfiles } from "@/lib/ai";

export const maxDuration = 60;

/* Zet underdog-keywords + hun uitleg (kolom J) om in een zoek-en-controleer
   profiel: woorden die winkels WÉL in hun titels gebruiken, harde eisen en
   breekpunten. Wordt één keer per run aangeroepen, in stukken vanaf de
   client, zodat elke call kort blijft. */
export async function POST(req) {
  const { items, market } = await req.json().catch(() => ({}));
  if (!Array.isArray(items) || !items.length) {
    return NextResponse.json({ error: "items ontbreekt" }, { status: 400 });
  }
  try {
    const map = await buildUnderdogProfiles(items.slice(0, 12), { market });
    return NextResponse.json({ ok: true, map });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
