import { NextResponse } from "next/server";
import { scrapeProduct } from "@/lib/scrape";
import { isTrendUrl, scrapeTrendProduct } from "@/lib/trend-product";

// 60 s: een AliExpress/Temu-product gaat via een Apify-run + foto-check (27-11-2026)
export const maxDuration = 60;

export async function POST(req) {
  const { url } = await req.json().catch(() => ({}));
  if (!url) return NextResponse.json({ error: "url ontbreekt" }, { status: 400 });
  if (isTrendUrl(url)) {
    const r = await scrapeTrendProduct(url);
    if (!r.ok) return NextResponse.json({ error: r.error, photo: r.photo || null }, { status: 422 });
    return NextResponse.json(r);
  }
  const result = await scrapeProduct(url);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json(result);
}
