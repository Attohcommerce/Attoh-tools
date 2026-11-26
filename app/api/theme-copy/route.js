import { NextResponse } from "next/server";
import { getStores } from "@/lib/claude-link";
import { copyThemeFiles } from "@/lib/theme-copy";

// Themabestanden tussen stores kopiëren (zelfde als MCP-tool theme_copy_files), achter de gewone login.
// POST { from_store, from_theme, to_store, to_theme, files: [pad | {from,to}], replace?: [{find,replace}] }
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const r = await copyThemeFiles(body || {}, await getStores());
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
