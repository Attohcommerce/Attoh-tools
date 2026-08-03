import { NextResponse } from "next/server";
import { getShopInfo } from "@/lib/shopify";

export const maxDuration = 20;

export async function POST(req) {
  const { domain, token, clientId, clientSecret } = await req
    .json()
    .catch(() => ({}));

  if (!domain) {
    return NextResponse.json({ error: "Domein is verplicht" }, { status: 400 });
  }
  if (!token && !(clientId && clientSecret)) {
    return NextResponse.json(
      { error: "Vul een Admin API token in, of client ID én client secret" },
      { status: 400 }
    );
  }

  const r = await getShopInfo({ domain, token, clientId, clientSecret });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
  return NextResponse.json(r);
}
