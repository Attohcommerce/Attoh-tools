import { NextResponse } from "next/server";
import { runPlanStoreOps } from "@/lib/plan-store-ops";

/* WIJZIGINGSPLAN · STORE-STAPPEN (09-11-2026)
   Collecties aanmaken/hernoemen/regels aanpassen + menu-items toevoegen uit
   een wijzigingsplan (zie lib/change-plan.js en lib/plan-store-ops.js).
   body: { store, ops: { collections: [...], menus: [...] }, dryRun, revert }
   De knoppen in components/DoctorPanel.js roepen dit aan vóór de producten. */
export const maxDuration = 60;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { store, ops, dryRun, revert } = body;
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  const n = ((ops && ops.collections) || []).length + ((ops && ops.menus) || []).length;
  if (!n) return NextResponse.json({ ok: true, done: 0, skipped: 0, failed: 0, lines: [] });
  if (n > 200) return NextResponse.json({ error: "Te veel store-stappen in één keer (max 200)" }, { status: 400 });
  try {
    return NextResponse.json(await runPlanStoreOps(store, ops, { dryRun: !!dryRun, revert: !!revert }));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
