import { NextResponse } from "next/server";
import { runDashboard } from "@/lib/dashboard-run";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// OMZET-DASHBOARD — de kern staat in lib/dashboard-run.js (ook gebruikt door /api/m).
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const out = await runDashboard(body);
  return NextResponse.json(out.json, { status: out.status });
}
