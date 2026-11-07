// POKÉMON TOOL — één concurrent scrapen.
// Shopify/WooCommerce: in één aanroep klaar. Overige: sitemap → porties
// productpagina's; de pagina roept opnieuw aan zolang done=false.
import { NextResponse } from "next/server";
import { getComps, upsertComp, writeCatalog, readCatalog, getGenState, setGenState, clearGenState, pkRedisAvailable } from "@/lib/pokemon/store";
import { detectPlatform, scrapeApi, sitemapProductUrls, scrapeGenericChunk, filterAndClassify, cleanDomain } from "@/lib/pokemon/scrape";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const POKE_URL_RE = /pokemon|pok%c3%a9mon|ptcg/i;

export async function POST(req) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const d = cleanDomain(body.domain);
  if (!d) return NextResponse.json({ error: "Geen domein" }, { status: 400 });
  if (!pkRedisAvailable()) return NextResponse.json({ error: "Redis is niet ingesteld" }, { status: 500 });
  const all = !!body.all; // ook niet-Pokémon meenemen
  try {
    const comps = await getComps();
    let comp = comps.find((c) => c.domain === d);
    let platform = comp && comp.platform;
    if (!platform) {
      platform = await detectPlatform(d);
      comp = await upsertComp({ domain: d, platform });
    }

    if (platform === "shopify" || platform === "woocommerce") {
      const r = await scrapeApi(d, platform, { budgetMs: 45000 });
      const list = filterAndClassify(r.products, { all });
      const kb = await writeCatalog(d, list);
      const saved = await upsertComp({
        domain: d,
        platform,
        count: list.length,
        seen: r.products.length,
        currency: r.currency || (list[0] && list[0].currency) || "",
        partial: !!r.partial,
        lastScraped: Date.now(),
        kb,
      });
      return NextResponse.json({ done: true, comp: saved, count: list.length, seen: r.products.length, partial: r.partial, ms: Date.now() - t0 });
    }

    // Overige platforms: sitemap + JSON-LD in porties
    let st = body.restart ? null : await getGenState(d);
    if (!st) {
      let urls = await sitemapProductUrls(d);
      const poke = urls.filter((u) => POKE_URL_RE.test(u));
      if (!all && poke.length >= 10) urls = poke;
      st = { urls, pos: 0, startedAt: Date.now() };
      await setGenState(d, st);
      await writeCatalog(d, []);
      if (!urls.length) {
        await clearGenState(d);
        const saved = await upsertComp({ domain: d, platform, count: 0, seen: 0, lastScraped: Date.now(), note: "Geen sitemap of product-URL's gevonden" });
        return NextResponse.json({ done: true, comp: saved, count: 0, note: "Geen sitemap gevonden — deze winkel kan de tool niet lezen." });
      }
      if (Date.now() - t0 > 20000) return NextResponse.json({ done: false, pos: 0, total: urls.length, count: 0 });
    }
    const deadline = t0 + 46000;
    const chunk = st.urls.slice(st.pos, st.pos + 160);
    const r = await scrapeGenericChunk(d, chunk, deadline);
    const fresh = filterAndClassify(r.products, { all });
    const cur = await readCatalog(d);
    const byId = new Map(cur.map((p) => [p.id, p]));
    for (const p of fresh) byId.set(p.id, p);
    const list = [...byId.values()];
    const kb = await writeCatalog(d, list);
    st.pos += r.done.length;
    const done = st.pos >= st.urls.length;
    if (done) await clearGenState(d);
    else await setGenState(d, st);
    const saved = await upsertComp({
      domain: d,
      platform,
      count: list.length,
      seen: st.pos,
      currency: (list[0] && list[0].currency) || "",
      partial: !done,
      lastScraped: Date.now(),
      kb,
    });
    return NextResponse.json({ done, comp: saved, pos: st.pos, total: st.urls.length, count: list.length, ms: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
