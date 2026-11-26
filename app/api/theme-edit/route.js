import { NextResponse } from "next/server";
import { getStores } from "@/lib/claude-link";
import { themeEdit } from "@/lib/theme-edit";

// Themabestanden bekijken/aanpassen op de server (zie lib/theme-edit.js), achter de gewone login.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    const r = await themeEdit(body || {}, await getStores());
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 });
  }
}
