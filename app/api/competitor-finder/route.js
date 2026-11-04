import { NextResponse } from "next/server";
import { startJob, stopJob, resumeJob, jobStatus, kickTick, getJob, jobAvailable, getLastResults, patchResults, getHistory, startVisitsFetch, visitsFetchStatus } from "@/lib/finder-job";
import {
  getConfig, setConfig, getMarketQueries, setMarketQueries, clearMarketQueries, localizeQueries, writeToSheet, markSeen, getSeen, apifyConfigured, cleanDomain,
} from "@/lib/competitor-finder";
import { readSheetStores, ensurePool, bestStoresFor } from "@/lib/finder-pool";
import { MARKETS, DEFAULT_QUERIES_EN } from "@/lib/finder-markets";
import { addToStoreList, mergeStoreMeta } from "@/lib/catalog-cache";
import { auditDropship } from "@/lib/dropship-score";

export const maxDuration = 60;

/* COMPETITOR FINDER — API. action:
     info      — markten, instellingen, zoekopdrachten-status per markt, laatste scan
     config    — instellingen opslaan (minVisits, pages, aliCheck, sheetId, sheetTab)
     queries   — zoekopdrachten van één markt ophalen
     saveQueries — zoekopdrachten van één markt opslaan (handmatig)
     localize  — AI maakt de lokale set voor een markt (en slaat op)
     start     — scan starten (markets[], pages, aliCheck, queriesPerMarket)
     status    — voortgang/resultaten (start zelf een tick als de keten stil ligt)
     stop / resume
     add       — gekozen winkels naar de sheet (juiste marktblok) + Redis-lijst
     ignore    — gekozen winkels nooit meer tonen
     visits    — maandbezoek invullen voor domeinen (handmatig of door Claude)
     check     — één domein los door de dropship-score (test) */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action = "status" } = body;
  try {
    if (action === "info") {
      const cfg = await getConfig();
      const perMarket = {};
      for (const m of MARKETS) {
        const q = await getMarketQueries(m.key);
        perMarket[m.key] = { count: q.queries.length, source: q.source, at: q.at || 0, override: !!q.override, stores: (q.stores || []).map((s) => s.domain) };
      }
      const last = await getLastResults();
      const history = await getHistory();
      return NextResponse.json({ ok: true, cfg, markets: MARKETS, perMarket, last, history, apify: apifyConfigured(), redis: jobAvailable(), defaultQueries: DEFAULT_QUERIES_EN });
    }
    if (action === "config") {
      const cfg = await setConfig(body.cfg || {});
      return NextResponse.json({ ok: true, cfg });
    }
    if (action === "queries") {
      const q = await getMarketQueries(body.market);
      return NextResponse.json({ ok: true, ...q });
    }
    if (action === "saveQueries") {
      const list = await setMarketQueries(body.market, body.queries || [], "handmatig");
      return NextResponse.json({ ok: true, queries: list });
    }
    if (action === "clearQueries") {
      await clearMarketQueries(body.market);
      const q = await getMarketQueries(body.market);
      return NextResponse.json({ ok: true, ...q });
    }
    if (action === "localize") {
      const r = await localizeQueries(body.market, body.base);
      return NextResponse.json({ ok: true, ...r });
    }
    /* Pool van één markt (opnieuw) bouwen uit de beste sheet-stores + startset. */
    if (action === "poolRefresh") {
      const cfg = await getConfig();
      const sheetId = (body.sheet && body.sheet.sheetId) || cfg.sheetId;
      const stores = await readSheetStores(sheetId);
      const pool = await ensurePool(body.market, { sheetStores: stores, force: true });
      return NextResponse.json({ ok: true, count: pool.titles.length, source: pool.source, stores: pool.stores, candidates: bestStoresFor(stores, body.market) });
    }

    if (!jobAvailable()) return NextResponse.json({ error: "REDIS_URL ontbreekt — de scan heeft Redis nodig om de voortgang te bewaren." }, { status: 422 });

    if (action === "start") {
      const baseUrl = process.env.CF_JOB_BASE_URL || process.env.SG_JOB_BASE_URL || req.nextUrl.origin;
      const r = await startJob({
        markets: body.markets || [],
        pages: body.pages,
        aliCheck: body.aliCheck,
        queriesPerMarket: body.queriesPerMarket,
        sheet: body.sheet,
        baseUrl,
        label: body.label,
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
      const job = await getJob();
      const kicked = await kickTick(job);
      return NextResponse.json({ ok: true, job: r.job, kicked });
    }
    if (action === "stop") {
      const r = await stopJob();
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 404 });
    }
    if (action === "resume") {
      const r = await resumeJob();
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
      const job = await getJob();
      const kicked = await kickTick(job);
      return NextResponse.json({ ...r, kicked });
    }
    if (action === "status") {
      const r = await jobStatus();
      return NextResponse.json(r);
    }

    /* Toevoegen: rij in de sheet (marktblok) + Redis-lijst van de scraper +
       meta (land/producten/bezoek/opmerking) + "al gezien: toegevoegd". */
    if (action === "add") {
      const cfg = await getConfig();
      const sheetId = (body.sheet && body.sheet.sheetId) || cfg.sheetId;
      const tab = (body.sheet && body.sheet.tab) || cfg.sheetTab;
      const rows = (body.rows || [])
        .map((r) => ({
          domain: cleanDomain(r.domain),
          market: String(r.market || "").toUpperCase(),
          name: String(r.name || "").trim(),
          products: r.products != null && r.products !== "" ? Number(r.products) : "",
          visits: r.visits != null && r.visits !== "" ? Number(r.visits) : "",
          note: String(r.note || "").trim(),
        }))
        .filter((r) => r.domain && r.domain.includes(".") && r.market);
      if (!rows.length) return NextResponse.json({ error: "Geen rijen" }, { status: 400 });
      const w = await writeToSheet(sheetId, tab, rows);
      const meta = {};
      for (const r of rows) meta[r.domain] = { market: r.market, visits: r.visits || null, products: r.products || null, note: r.note, name: r.name };
      const added = await addToStoreList(rows.map((r) => r.domain));
      await mergeStoreMeta(meta);
      const seenPatch = {};
      for (const r of rows) seenPatch[r.domain] = { added: true, verdict: "toegevoegd" };
      await markSeen(seenPatch);
      await patchResults((res) => {
        for (const r of rows) if (res[r.domain]) res[r.domain].added = true;
      });
      return NextResponse.json({ ok: true, written: w.written, listAdded: added.added, listDupes: added.dupes });
    }
    if (action === "ignore") {
      const domains = (body.domains || []).map(cleanDomain).filter(Boolean);
      const patch = {};
      for (const d of domains) patch[d] = { ignored: true, verdict: "genegeerd" };
      await markSeen(patch);
      await patchResults((res) => {
        for (const d of domains) if (res[d]) res[d].ignored = true;
      });
      return NextResponse.json({ ok: true, ignored: domains.length });
    }
    if (action === "visitsStart") {
      // SimilarWeb-run starten voor alle dropship/twijfel-resultaten zonder cijfer (of force: alles opnieuw)
      const r = await startVisitsFetch({ force: !!body.force, domains: body.domains || [] });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    if (action === "visitsStatus") {
      const r = await visitsFetchStatus();
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    if (action === "visits") {
      // { visits: { domein: 12000, … } } — van Claude (TrendTrack) of handmatig
      const seen = await getSeen();
      const patch = {};
      for (const [d, v] of Object.entries(body.visits || {})) {
        const k = cleanDomain(d);
        const n = Number(String(v).replace(/[^\d]/g, ""));
        if (!k || !isFinite(n)) continue;
        patch[k] = { ...(seen[k] || {}), visits: n, visitsSrc: "handmatig" };
        if (seen[k] && seen[k].audit) patch[k].audit = { ...seen[k].audit, visits: n, visitsSrc: "handmatig", visitsNoData: false };
      }
      await markSeen(patch);
      await patchResults((res) => {
        for (const k of Object.keys(patch)) if (res[k]) Object.assign(res[k], { visits: patch[k].visits, visitsSrc: "handmatig", visitsNoData: false });
      });
      return NextResponse.json({ ok: true, updated: Object.keys(patch).length });
    }
    if (action === "check") {
      const d = cleanDomain(body.domain);
      if (!d) return NextResponse.json({ error: "Geen domein" }, { status: 400 });
      const a = await auditDropship(d, { aliCheck: !!body.aliCheck, deadline: Date.now() + 45000 });
      return NextResponse.json({ ok: true, audit: a });
    }
    return NextResponse.json({ error: "Onbekende action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
