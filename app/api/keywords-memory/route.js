import { NextResponse } from "next/server";
import {
  getConfig, setConfigLink, mergeIntoMemory, makeAllBatchTab,
  registerTabMarket, getTabMarket, getTopKeywords, memoryStatus,
} from "@/lib/kw-memory";

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
      const r = await getTopKeywords({ market: body.market, domain: body.domain });
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[keywords-memory]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
