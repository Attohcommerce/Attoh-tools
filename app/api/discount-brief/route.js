import { NextResponse } from "next/server";
import { parseDiscountBrief } from "@/lib/ai";
import { describeDiscountPlan } from "@/lib/discount-brief";

export const maxDuration = 30;

/* Zet de vrije korting-briefing uit de importer één keer om in een regelset.
   Wordt aangeroepen vóór de batch start, niet per product: de regelset wordt
   daarna deterministisch toegepast zodat dezelfde batch altijd dezelfde
   prijzen oplevert (GMC eist prijsstabiliteit). */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const brief = String(body.brief || "").trim();
  if (!brief) return NextResponse.json({ error: "Geen korting-briefing meegegeven" }, { status: 400 });

  try {
    const plan = await parseDiscountBrief(brief, {
      storeUrl: body.storeUrl,
      market: body.market,
      currency: body.currency,
      collections: body.collections,
    });
    return NextResponse.json({ ok: true, plan, lines: describeDiscountPlan(plan) });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
