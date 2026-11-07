import { NextResponse } from "next/server";
import { getSettings, saveSettings, pkRedisAvailable } from "@/lib/pokemon/store";
import { DEFAULT_SETTINGS } from "@/lib/pokemon/importer";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = pkRedisAvailable() ? await getSettings() : null;
  return NextResponse.json({ settings: { ...DEFAULT_SETTINGS, ...(s || {}), collections: { ...DEFAULT_SETTINGS.collections, ...((s && s.collections) || {}) } } });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (pkRedisAvailable()) await saveSettings(body.settings || {});
  return NextResponse.json({ ok: true });
}
