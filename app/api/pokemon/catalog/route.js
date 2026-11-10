// POKÉMON TOOL — alle gescrapete producten samen, ontdubbeld (één rij per
// product, met de prijzen van elke concurrent) + wat er al in onze store staat.
import { NextResponse } from "next/server";
import { storeGraphql } from "@/lib/shopify";
import { getComps, readCatalog, getImported, unmarkImported, clearImported, pkRedisAvailable } from "@/lib/pokemon/store";
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
// "purge"  = OPNIEUW BEGINNEN (09-11-2026): alle door de importer gemaakte producten uit de
//            store verwijderen (herkenbaar aan metafield pokemon.source_url) + importlog leeg.
//            Max 250 per aanroep; de pagina roept hem aan tot er niets meer is.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "forget" && body.store && Array.isArray(body.keys)) {
    await unmarkImported(body.store, body.keys);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "purge" && body.store && body.store.domain) {
    const store = { domain: body.store.domain, token: body.store.token, clientId: body.store.clientId, clientSecret: body.store.clientSecret };
    const q = await storeGraphql(
      store,
      `query { products(first: 100, query: "vendor:Pokémon") { nodes { id title metafield(namespace: "pokemon", key: "source_url") { value } } pageInfo { hasNextPage } } }`
    );
    if (!q.ok) return NextResponse.json({ error: q.error }, { status: 500 });
    const nodes = ((q.data.products || {}).nodes || []).filter((n) => n.metafield && n.metafield.value);
    let deleted = 0;
    const errors = [];
    for (const n of nodes) {
      const d = await storeGraphql(store, `mutation($id: ID!) { productDelete(input: { id: $id }) { deletedProductId userErrors { message } } }`, { id: n.id });
      const ue = d.ok ? ((d.data.productDelete || {}).userErrors || []) : [{ message: d.error }];
      if (ue.length) errors.push(`${n.title}: ${ue[0].message}`);
      else deleted++;
    }
    const more = ((q.data.products || {}).pageInfo || {}).hasNextPage || nodes.length === 100;
    if (!more) await clearImported(store.domain);
    return NextResponse.json({ ok: true, deleted, more, errors });
  }
  return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
}
