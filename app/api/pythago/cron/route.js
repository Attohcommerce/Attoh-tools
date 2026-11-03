// PYTHAGO — dagelijkse sync via Vercel Cron (vercel.json: 05:10 UTC).
// Loopt alle stores met "automatisch syncen" af (beide organisaties), oudste
// eerst, zolang er tijd is. De pagina zelf synct óók bij openen als de data
// ouder is dan 6 uur, dus de cron is vooral voor de nacht.
import { NextResponse } from "next/server";
import { dueStores, syncStore } from "@/lib/pythago-sync";
import { ORG_LIST } from "@/lib/org";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Geen toegang" }, { status: 401 });
  }
  const t0 = Date.now();
  const budget = 100 * 1000;
  const done = [];
  const failed = [];
  let skipped = 0;
  for (const org of ORG_LIST) {
    let due = [];
    try {
      due = await dueStores(org.id, 3 * 3600 * 1000);
    } catch (e) {
      failed.push({ org: org.id, error: String(e.message || e) });
      continue;
    }
    for (const { cfg } of due) {
      if (Date.now() - t0 > budget) {
        skipped++;
        continue;
      }
      try {
        const r = await syncStore({ org: org.id, store: cfg.store, ordersStore: cfg.ordersStore, adsSheetId: cfg.adsSheetId, key: cfg.key, settings: cfg.settings, source: "cron" });
        done.push({ org: org.id, store: cfg.store.domain, products: r.rows.length, ms: r.syncMs });
      } catch (e) {
        failed.push({ org: org.id, store: cfg.store.domain, error: String(e.message || e) });
      }
    }
  }
  return NextResponse.json({ ok: true, done, failed, skipped, ms: Date.now() - t0 });
}
