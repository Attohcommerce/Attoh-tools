import { NextResponse } from "next/server";
import { fetchCatalog, guessGender, analyzeKeyword, matchProduct } from "@/lib/scrape";

export const maxDuration = 60;

// Doorzoekt ÉÉN store voor ÉÉN keyword. De client loopt zelf over
// stores/keywords zodat elke serverless-call kort blijft.
//
// Volgorde is heilig: eerst alle titel-matches (beste verkopers eerst),
// dan pas omschrijving-matches, dan pas foto-matches. We beoordelen
// daarom de HELE catalogus en sorteren daarna — de eerste N die je
// terugkrijgt zijn dus altijd de best mogelijke N.
export async function POST(req) {
  const { store, keyword, gender, need, excludeLinks } = await req.json().catch(() => ({}));
  if (!store || !keyword) {
    return NextResponse.json({ error: "store en keyword zijn verplicht" }, { status: 400 });
  }

  const analysis = analyzeKeyword(keyword);
  if (!analysis) {
    return NextResponse.json({ error: "Leeg keyword" }, { status: 400 });
  }

  const exclude = new Set(
    (excludeLinks || []).map((l) => String(l).toLowerCase().replace(/\/$/, ""))
  );

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

  const scored = [];
  for (let i = 0; i < catalog.products.length; i++) {
    const p = catalog.products[i];
    const link = p.url.toLowerCase().replace(/\/$/, "");
    if (exclude.has(link)) continue;

    const m = matchProduct(analysis, p);
    if (!m) continue;

    const g = guessGender(p);
    if (gender === "Vrouw" && g === "Man") continue;
    if (gender === "Man" && g === "Vrouw") continue;

    scored.push({
      idx: i,
      tier: m.tier,
      lit: m.literal ? 1 : 0,
      link: p.url,
      title: p.title,
      source: m.source, // Titel | Omschrijving | Foto's
      literal: m.literal ? "Literal" : "Ruim",
      image: p.images && p.images[0] ? p.images[0].src : null, // voor AI-vision dubbelcheck
    });
  }

  // Rangorde: 1) titel vóór omschrijving vóór foto's
  //           2) binnen een tier: Literal vóór Ruim
  //           3) daarbinnen: best selling eerst
  scored.sort((a, b) => a.tier - b.tier || b.lit - a.lit || a.idx - b.idx);

  const matches = scored
    .slice(0, Number(need) || 10)
    .map(({ idx, tier, lit, ...rest }) => rest);

  return NextResponse.json({
    ok: true,
    store: catalog.domain,
    usedBestSelling: catalog.usedBestSelling,
    total: catalog.products.length,
    matches,
  });
}
