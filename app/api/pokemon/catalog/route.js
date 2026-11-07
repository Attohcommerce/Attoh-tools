// POKÉMON TOOL — alle gescrapete producten samen, ontdubbeld (één rij per
// product, met de prijzen van elke concurrent) + wat er al in onze store staat.
import { NextResponse } from "next/server";
import { getComps, readCatalog, getImported, unmarkImported, pkRedisAvailable } from "@/lib/pokemon/store";
import { groupProducts, stripHtml } from "@/lib/pokemon/catalog";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function loadGroups(domains) {
  const comps = await getComps();
  const use = comps.filter((c) => !domains || domains.includes(c.domain));
  const lists = await Promise.all(use.map((c) => readCatalog(c.domain)));
  return groupProducts(lists.flat());
}

export async function GET(req) {
  if (!pkRedisAvailable()) return NextResponse.json({ groups: [], imported: {}, redis: false });
  const { searchParams } = new URL(req.url);
  const store = searchParams.get("store") || "";
  const groups = await loadGroups(null);
  const imported = store ? await getImported(store) : {};
  // licht maken voor de browser: geen volledige omschrijvingen
  const light = groups.map((g) => ({
    key: g.key,
    title: g.title,
    type: g.type,
    set: g.set,
    era: g.era,
    lang: g.lang,
    image: g.image,
    images: (g.best.images || []).slice(0, 6),
    imageCount: g.imageCount,
    bodyLen: stripHtml(g.best.body).length,
    snippet: stripHtml(g.best.body).slice(0, 260),
    sources: g.sources,
    minPrice: g.minPrice,
    medianPrice: g.medianPrice,
    maxPrice: g.maxPrice,
    anyAvailable: g.anyAvailable,
    currency: (g.sources[0] && g.sources[0].currency) || "",
  }));
  const imp = {};
  for (const [k, v] of Object.entries(imported)) imp[k] = { id: v.id, handle: v.handle, title: v.title, at: v.at };
  return NextResponse.json({ groups: light, imported: imp, redis: true });
}

// "Vergeet" = uit het importlog halen (bv. product in Shopify verwijderd)
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "forget" && body.store && Array.isArray(body.keys)) {
    await unmarkImported(body.store, body.keys);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
}
