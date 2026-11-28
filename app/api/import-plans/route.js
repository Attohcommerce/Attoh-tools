import { NextResponse } from "next/server";
import { listPlans, getPlan, deletePlan, applyPlan, putPlan, keywordsLookup, storeMemoryOverview, weekrunInfo, getWeekrunCfg, setWeekrunCfg } from "@/lib/import-plans";

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
    // Ook vanuit de ingelogde browser (zelfde als de connector-tools): keywords lezen, stores lezen, plan opslaan
    if (a === "keywords") return NextResponse.json(await keywordsLookup(body));
    if (a === "stores") return NextResponse.json({ stores: await storeMemoryOverview() });
    if (a === "put") return NextResponse.json(await putPlan(body.plan));
    // Weekrun: één workflow voor alle stores (scraper + importer lezen dit)
    if (a === "weekrun") return NextResponse.json(await weekrunInfo(body.id));
    if (a === "cfgGet") return NextResponse.json({ cfg: await getWeekrunCfg() });
    if (a === "cfgSet") return NextResponse.json({ cfg: await setWeekrunCfg({ tpk: body.tpk, importSheet: body.importSheet }) });
    if (a === "delete") return NextResponse.json(await deletePlan(body.id));
    return NextResponse.json({ error: `onbekende actie ${a}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
