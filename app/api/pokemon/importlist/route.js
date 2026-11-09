// POKÉMON TOOL — importlijst: tonen, opslaan, matchen met de scraper en
// importeren (max 3 regels per aanroep; de pagina loopt de lijst af).
import { NextResponse } from "next/server";
import { getComps, readCatalog, getImported, markImported, getList, saveList, clearList, pkRedisAvailable } from "@/lib/pokemon/store";
import { groupProducts, stripHtml } from "@/lib/pokemon/catalog";
import { PRESET_2026, matchRows, lightMatch, parseCsv, toCsv } from "@/lib/pokemon/importlist";
import { writeListings } from "@/lib/pokemon/ai";
import { importListItem, DEFAULT_SETTINGS } from "@/lib/pokemon/importer";
import { bodyImages, contentsHint, BRAIN_VERSION } from "@/lib/pokemon/brain";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const storeFrom = (b) => {
  const s = b.store || {};
  return { domain: s.domain, token: s.token, clientId: s.clientId, clientSecret: s.clientSecret };
};

async function loadGroups() {
  const comps = await getComps();
  const lists = await Promise.all(comps.map((c) => readCatalog(c.domain)));
  return groupProducts(lists.flat());
}

async function rowsNow(body) {
  if (Array.isArray(body.rows) && body.rows.length) return body.rows;
  return (await getList()) || PRESET_2026;
}

const listKey = (id) => `list:${id}`;

/** Bron-object voor de AI: hoofdbron + andere bronnen + aanwijzingen per regel. */
function aiSource(row, m, rowsById) {
  const best = m.match.best || {};
  const others = (m.match.fullSources || []).filter((x) => x && x.url !== best.url).map((x) => ({ domain: x.domain, text: stripHtml(x.body) })).filter((x) => x.text.length > 80);
  const withImgs = [best, ...(m.match.fullSources || [])].find((x) => x && bodyImages(x.body).length >= 1);
  const hints = [];
  if (row.type === "Case") {
    const b = rowsById.get(row.caseOf);
    hints.push(
      `This is a sealed CASE of ${m.qty} × "Pokémon TCG: ${b ? b.title : row.caseOf}". In "What's inside": first "${m.qty} × sealed ${b ? b.title : "product"}", then a nested list with the contents of ONE ${b ? b.type : "box"}, then the totals (e.g. total booster packs = ${m.qty} × packs per box). Product type in the details: "${b ? b.type : ""} Case". Mention it ships as the original sealed case from the distributor where possible; if not, as ${m.qty} sealed units.`,
      b ? contentsHint(b.type, row.lang) : ""
    );
  }
  if (m.variants && m.variants.length > 1) hints.push(`Sold with a choice of ${row.option || "Design"}: ${m.variants.map((v) => v.name).join(", ")}. Explain per option what differs (promo card / featured Pokémon). Title stays without a variant.`);
  if (row.note) hints.push(`Note from the shop owner: ${row.note}`);
  return {
    ...best,
    fixedTitle: `Pokémon TCG: ${row.title}`,
    type: row.type === "Case" ? "Case" : row.type,
    set: row.set || best.set,
    lang: row.lang,
    hint: hints.filter(Boolean).join(" "),
    extraSources: others,
    imageLayout: withImgs ? { body: withImgs.body } : null,
  };
}

export async function GET() {
  if (!pkRedisAvailable()) return NextResponse.json({ rows: PRESET_2026, preset: true, redis: false, brain: BRAIN_VERSION });
  const saved = await getList();
  return NextResponse.json({ rows: saved || PRESET_2026, preset: !saved, redis: true, brain: BRAIN_VERSION, csv: toCsv(saved || PRESET_2026) });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!pkRedisAvailable()) return NextResponse.json({ error: "Redis is niet ingesteld" }, { status: 500 });
  const settings = { ...DEFAULT_SETTINGS, ...(body.settings || {}), collections: { ...DEFAULT_SETTINGS.collections, ...((body.settings || {}).collections || {}) } };

  try {
    if (body.action === "save") {
      const rows = body.csv ? parseCsv(body.csv) : body.rows;
      if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "Lege lijst (check de kolom Title)" }, { status: 400 });
      await saveList(rows);
      return NextResponse.json({ ok: true, rows, count: rows.length });
    }
    if (body.action === "reset") {
      await clearList();
      return NextResponse.json({ ok: true, rows: PRESET_2026 });
    }

    const rows = await rowsNow(body);
    const groups = await loadGroups();
    const matches = matchRows(rows, groups, settings);
    const store = storeFrom(body);
    const imported = store.domain ? await getImported(store.domain) : {};

    if (body.action === "match") {
      const imp = {};
      for (const r of rows) if (imported[listKey(r.id)]) imp[r.id] = { id: imported[listKey(r.id)].id, handle: imported[listKey(r.id)].handle };
      return NextResponse.json({ matches: matches.map(lightMatch), imported: imp, groups: groups.length });
    }

    if (body.action === "import") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, 3);
      if (!body.dryRun && !store.domain) return NextResponse.json({ error: "Kies eerst een store" }, { status: 400 });
      const rowsById = new Map(rows.map((r) => [r.id, r]));
      const picked = matches.filter((m) => ids.includes(m.id));
      const results = [];
      const todo = [];
      for (const m of picked) {
        if (!m.ok || !m.match) results.push({ id: m.id, ok: false, error: m.why || "niet gevonden" });
        else if (!body.dryRun && !body.force && imported[listKey(m.id)]) results.push({ id: m.id, ok: true, skipped: true, reason: "al geïmporteerd" });
        else todo.push(m);
      }
      const srcs = todo.map((m) => aiSource(m.row, m, rowsById));
      const w = srcs.length ? await writeListings(srcs, { lang: settings.lang, brand: settings.brand }) : { items: [], usage: null };
      w.items.forEach((it, i) => {
        if (srcs[i].imageLayout) it.bodyImages = bodyImages(srcs[i].imageLayout.body);
      });
      if (body.dryRun) {
        return NextResponse.json({
          previews: todo.map((m, i) => ({ id: m.id, row: m.row, price: m.price, strategy: srcs[i].imageLayout ? 1 : 2, sources: m.match.sources, listing: w.items[i] })),
          results,
          usage: w.usage,
        });
      }
      const log = {};
      for (let i = 0; i < todo.length; i++) {
        const m = todo[i];
        const spec = {
          row: m.row,
          best: m.match.best,
          sources: m.match.sources,
          price: m.price,
          variants: (m.variants || []).filter((v) => v.ok).map((v) => ({ name: v.name, price: v.price, best: v.match && v.match.best })),
          listing: w.items[i],
        };
        const r = await importListItem(store, spec, settings);
        results.push({ id: m.id, title: w.items[i].title, ...r, copy: w.items[i].copy, ai: w.items[i].ai, note: w.items[i].note, strategy: srcs[i].imageLayout ? 1 : 2 });
        if (r.ok && !r.skipped) log[listKey(m.id)] = { id: r.id, handle: r.handle, title: w.items[i].title, at: Date.now(), src: (m.match.best || {}).url, srcText: stripHtml((m.match.best || {}).body).slice(0, 1500) };
      }
      if (Object.keys(log).length) await markImported(store.domain, log);
      return NextResponse.json({ results, usage: w.usage });
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
