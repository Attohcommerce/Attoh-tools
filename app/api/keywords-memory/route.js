import { NextResponse } from "next/server";
import {
  getConfig, setConfigLink, mergeIntoMemory, makeAllBatchTab,
  registerTabMarket, getTabMarket, getTopKeywords, memoryStatus, resolveMarket,
} from "@/lib/kw-memory";
import { allTopKeywords, getStoreMemory } from "@/lib/geheugen";

// De merge leest en herschrijft tot ~180k rijen — ruim de tijd geven.
export const maxDuration = 300;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "status") {
      return NextResponse.json({ ok: true, markets: await memoryStatus() });
    }
    if (action === "configSet") {
      const saved = await setConfigLink(body.market, body.link);
      return NextResponse.json({ ok: true, saved });
    }
    if (action === "config") {
      return NextResponse.json({ ok: true, cfg: await getConfig() });
    }
    if (action === "register") {
      // Tabblad → markt vastleggen (de verdeling handhaaft dit later hard).
      if (!body.sheetId || !body.tab) return NextResponse.json({ error: "sheetId/tab ontbreekt" }, { status: 400 });
      await registerTabMarket(body.sheetId, body.tab, body.market);
      return NextResponse.json({ ok: true });
    }
    if (action === "tabmarket") {
      const market = await getTabMarket(body.sheetId, body.tab);
      return NextResponse.json({ ok: true, market });
    }
    if (action === "merge") {
      const r = await mergeIntoMemory({
        market: body.market, srcSheetId: body.srcSheetId, srcTab: body.srcTab, label: body.label,
      });
      return NextResponse.json(r);
    }
    if (action === "make") {
      const r = await makeAllBatchTab(body.market);
      return NextResponse.json(r);
    }
    if (action === "top") {
      /* Trend-keywords voor de importer (16-10-2026): eerst het markt-geheugen
         (Keywords → Geheugen → ALL <markt> VROUW/MAN), alleen als dat er niet
         is het oude batch-geheugen (tab "TOP <markt>"). Een dames- of
         herenstore (store-geheugen) krijgt alleen de rijen van dat geslacht. */
      const q = { market: body.market, domain: body.domain, altDomain: body.altDomain, currency: body.currency };
      const res = resolveMarket(q);
      let v2Error = "";
      if (res.market) {
        try {
          const v2 = await allTopKeywords(res.market);
          if (v2 && v2.rows.length) {
            let storeG = "MV";
            for (const d of [body.altDomain, body.domain]) {
              if (!d) continue;
              const s = await getStoreMemory(d);
              if (s && s.genders) {
                storeG = s.genders;
                break;
              }
            }
            const rows = storeG === "V" || storeG === "M" ? v2.rows.filter((r) => r.g === storeG) : v2.rows;
            return NextResponse.json({
              ok: true, market: res.market, via: res.via, window: v2.window, rows, storeGenders: storeG,
              source: `markt-geheugen (${v2.sources.map((s) => s.tab).join(" + ")})`,
            });
          }
          if (v2) v2Error = `ALL-tabs van ${res.market} gaven geen keywords voor het venster`;
        } catch (e) {
          v2Error = `markt-geheugen ${res.market} niet leesbaar (${String((e && e.message) || e).slice(0, 120)})`;
        }
      }
      const r = await getTopKeywords(q);
      return NextResponse.json({ ok: true, ...r, source: r.rows && r.rows.length ? `oud batch-geheugen (TOP ${r.market})` : "", v2Error });
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[keywords-memory]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
