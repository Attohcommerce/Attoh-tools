import { NextResponse } from "next/server";
import { listPlans, getPlan, deletePlan, applyPlan } from "@/lib/import-plans";

export const maxDuration = 120;

/* IMPORTPLANNEN — API voor de pagina /importplannen (28-11-2026).
   action: list · get · apply · delete */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    const a = body.action || "list";
    if (a === "list") return NextResponse.json({ plans: await listPlans() });
    if (a === "get") return NextResponse.json({ plan: await getPlan(body.id) });
    if (a === "apply") return NextResponse.json(await applyPlan({ id: body.id, stores: body.stores }));
    if (a === "delete") return NextResponse.json(await deletePlan(body.id));
    return NextResponse.json({ error: `onbekende actie ${a}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
