// POKÉMON TOOL — importeren (max 4 producten per aanroep; de pagina loopt
// de selectie in porties af). dryRun = alleen de teksten laten zien.
import { NextResponse } from "next/server";
import { getImported, markImported, saveSettings, getComps, readCatalog, pkRedisAvailable } from "@/lib/pokemon/store";
import { groupProducts, stripHtml } from "@/lib/pokemon/catalog";
import { writeListings } from "@/lib/pokemon/ai";
import { importGroup, DEFAULT_SETTINGS } from "@/lib/pokemon/importer";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function storeFrom(b) {
  const s = b.store || {};
  return { domain: s.domain, token: s.token, clientId: s.clientId, clientSecret: s.clientSecret };
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!pkRedisAvailable()) return NextResponse.json({ error: "Redis is niet ingesteld" }, { status: 500 });
  const keys = (Array.isArray(body.keys) ? body.keys : []).slice(0, 4);
  if (!keys.length) return NextResponse.json({ error: "Geen producten gekozen" }, { status: 400 });
  const settings = { ...DEFAULT_SETTINGS, ...(body.settings || {}), collections: { ...DEFAULT_SETTINGS.collections, ...((body.settings || {}).collections || {}) } };
  const store = storeFrom(body);
  if (!body.dryRun && !store.domain) return NextResponse.json({ error: "Kies eerst een store" }, { status: 400 });

  try {
    const comps = await getComps();
    const lists = await Promise.all(comps.map((c) => readCatalog(c.domain)));
    const groups = groupProducts(lists.flat());
    const byKey = new Map(groups.map((g) => [g.key, g]));
    const picked = keys.map((k) => byKey.get(k)).filter(Boolean);
    if (!picked.length) return NextResponse.json({ error: "Producten niet meer gevonden — scrape opnieuw" }, { status: 404 });

    const imported = store.domain ? await getImported(store.domain) : {};
    const todo = body.dryRun || body.force ? picked : picked.filter((g) => !imported[g.key]);
    const skipped = picked.filter((g) => !todo.includes(g)).map((g) => ({ key: g.key, title: g.title, skipped: true, reason: "al geïmporteerd" }));

    const w = todo.length ? await writeListings(todo.map((g) => g.best), { lang: settings.lang, brand: settings.brand }) : { items: [], usage: null };
    if (body.dryRun) {
      return NextResponse.json({ previews: todo.map((g, i) => ({ key: g.key, source: { title: g.best.title, url: g.best.url, text: stripHtml(g.best.body).slice(0, 1200) }, listing: w.items[i] })), usage: w.usage });
    }

    await saveSettings(settings).catch(() => {});
    const results = [...skipped];
    const log = {};
    for (let i = 0; i < todo.length; i++) {
      const g = todo[i];
      const listing = w.items[i];
      const r = await importGroup(store, g, listing, settings);
      results.push({ key: g.key, title: listing.title, ...r, copy: listing.copy, ai: listing.ai, note: listing.note });
      if (r.ok) log[g.key] = { id: r.id, handle: r.handle, title: listing.title, at: Date.now(), src: g.best.url, srcText: stripHtml(g.best.body).slice(0, 1500) };
    }
    if (Object.keys(log).length) await markImported(store.domain, log);
    return NextResponse.json({ results, usage: w.usage });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
