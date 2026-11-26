import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { dashList, dashCreate, dashReset, dashDelete, connSave } from "@/lib/dash-ext";

// Telefoonlink voor het dashboard beheren (alleen met de gewone Attoh Tools-login)
// + de store-koppelingen van deze browser op de server bewaren, zodat /m ze kent.
export const dynamic = "force-dynamic";

const pub = (u, origin) => ({ id: u.id, email: u.email, link: `${origin}/m/${u.token}`, createdAt: u.createdAt, lastSeen: u.lastSeen || "" });

export async function POST(req) {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const origin = new URL(req.url).origin;
  try {
    if (body.action === "sync") {
      const n = await connSave({ stores: body.stores, cfStores: body.cfStores, adsSheetId: body.adsSheetId });
      return NextResponse.json({ ok: true, saved: n });
    }
    if (body.action === "create") await dashCreate(body.email, session.user.email);
    else if (body.action === "reset") await dashReset(body.id);
    else if (body.action === "delete") await dashDelete(body.id);
    else if (body.action !== "list") return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
    return NextResponse.json({ ok: true, links: (await dashList()).map((u) => pub(u, origin)) });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
