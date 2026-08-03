import { NextResponse } from "next/server";
import { generateListing } from "@/lib/ai";

export const maxDuration = 60;

export async function POST(req) {
  const { product, settings } = await req.json().catch(() => ({}));
  if (!product) return NextResponse.json({ error: "product ontbreekt" }, { status: 400 });
  try {
    const listing = await generateListing({ product, settings });
    return NextResponse.json({ ok: true, listing });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
