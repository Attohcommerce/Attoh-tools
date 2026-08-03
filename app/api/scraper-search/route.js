import { NextResponse } from "next/server";
import { fetchCatalog, matchKeyword, guessGender } from "@/lib/scrape";

export const maxDuration = 60;

// Doorzoekt ÉÉN store voor ÉÉN keyword. De client loopt zelf over stores/keywords
// zodat elke serverless-call kort blijft.
export async function POST(req) {
  const { store, keyword, gender, need, excludeLinks } = await req.json().catch(() => ({}));
  if (!store || !keyword) {
    return NextResponse.json({ error: "store en keyword zijn verplicht" }, { status: 400 });
  }

  const exclude = new Set((excludeLinks || []).map((l) => String(l).toLowerCase().replace(/\/$/, "")));
  const catalog = await fetchCatalog(store);
  if (catalog.products.length === 0) {
    return NextResponse.json({
      ok: true,
      store: catalog.domain,
      usedBestSelling: catalog.usedBestSelling,
      total: 0,
      matches: [],
    });
  }

  const matches = [];
  for (const p of catalog.products) {
    if (matches.length >= (Number(need) || 10)) break;
    const link = p.url.toLowerCase().replace(/\/$/, "");
    if (exclude.has(link)) continue;
    const m = matchKeyword(p, keyword);
    if (!m) continue;
    const g = guessGender(p);
    // Snelle geslachts-voorfilter: expliciet verkeerd geslacht overslaan
    if (gender === "Vrouw" && g === "Man") continue;
    if (gender === "Man" && g === "Vrouw") continue;
    matches.push({
      link: p.url,
      title: p.title,
      source: m.source, // Titel | Omschrijving | Foto's
      literal: m.literal ? "Literal" : "Ruim",
    });
  }

  return NextResponse.json({
    ok: true,
    store: catalog.domain,
    usedBestSelling: catalog.usedBestSelling,
    total: catalog.products.length,
    matches,
  });
}
