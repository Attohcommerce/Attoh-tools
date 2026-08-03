import { NextResponse } from "next/server";
import { getShopInfo } from "@/lib/shopify";

export const maxDuration = 15;

export async function POST(req) {
  const { domain, token } = await req.json().catch(() => ({}));
  if (!domain || !token) {
    return NextResponse.json({ error: "domain en token zijn verplicht" }, { status: 400 });
  }
  const r = await getShopInfo(domain, token);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
  return NextResponse.json(r);
}
