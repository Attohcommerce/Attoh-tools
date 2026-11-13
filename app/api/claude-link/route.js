import { NextResponse } from "next/server";
import { saveStores, getStores, mcpKey } from "@/lib/claude-link";

/* Claude-koppeling (13-11-2026): stores klaarzetten + connector-link ophalen.
   Alleen voor ingelogde gebruikers (middleware). */
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "save") {
      const n = await saveStores(body.stores);
      return NextResponse.json({ ok: true, saved: n });
    }
    if (body.action === "rotate") {
      await mcpKey({ rotate: true });
    }
    const origin = new URL(req.url).origin;
    const key = await mcpKey();
    const stores = (await getStores()).map((s) => ({ name: s.name, domain: s.domain, currency: s.currency }));
    return NextResponse.json({ ok: true, url: `${origin}/api/mcp?key=${key}`, stores });
  } catch (e) {
    return NextResponse.json({ error: String((e && e.message) || e) }, { status: 500 });
  }
}
