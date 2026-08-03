import { NextResponse } from "next/server";
import { scrapeProduct } from "@/lib/scrape";

export const maxDuration = 30;

export async function POST(req) {
  const { url } = await req.json().catch(() => ({}));
  if (!url) return NextResponse.json({ error: "url ontbreekt" }, { status: 400 });
  const result = await scrapeProduct(url);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json(result);
}
