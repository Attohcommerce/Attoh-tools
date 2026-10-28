import { NextResponse } from "next/server";
import { requireReisUser } from "@/lib/reis/session";
import { listTrips, saveTrip, updateTrip, deleteTrip, learn } from "@/lib/reis/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  return NextResponse.json({ trips: await listTrips() });
}

// Bewaren — bij Justin of bij Quinty (owner), gedeeld zichtbaar voor beide.
export async function POST(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { owner, result, search } = await req.json().catch(() => ({}));
  if (!result || !result.destId) return NextResponse.json({ error: "Geen reis meegegeven" }, { status: 400 });
  const who = owner === "quinty" || owner === "justin" ? owner : user.id;
  const trip = await saveTrip(who, user.id, result, search);
  await learn(user.id, result.destId, result.tags, 2);
  return NextResponse.json({ trip });
}

export async function PATCH(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { id, ...patch } = await req.json().catch(() => ({}));
  // stemmen gaat altijd op naam van wie ingelogd is
  if (patch.vote !== undefined) patch.vote = { user: user.id, value: Boolean(patch.vote) };
  try {
    return NextResponse.json({ trip: await updateTrip(id, patch) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
}

export async function DELETE(req) {
  const user = await requireReisUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  await deleteTrip(id);
  return NextResponse.json({ ok: true });
}
