import { NextResponse } from "next/server";
import { analysePythago, writePythagoTab, draftProducts } from "@/lib/pythago";
import { applyBoostState } from "@/lib/cvr-boost";
import {
  syncStore, loadData, isStale, listTasks, autoGet, autoSet, loadVariants,
  presetsList, presetSave, presetDelete, notesGet, noteSet, setStatus, patchStatus,
} from "@/lib/pythago-sync";
import { getOrg } from "@/lib/org-server";

/* PYTHAGO (03-11-2026: volledig dashboard, zie lib/pythago-sync.js)
   load:     opgeslagen dashboard-data + taken + auto-sync-stand + presets + notities
   sync:     nu syncen (Ads-sheet + Shopify → Redis); schrijft een taak
   tasks:    lopende/afgeronde taken
   auto:     automatisch syncen aan/uit (koppeling bewaren voor de cron)
   status:   aangevinkte producten op active / draft / archived (nooit vanzelf)
   variants: variant-uitsplitsing van één product
   presets:  opgeslagen filters (list / save / delete)
   notes:    notities per product (get / set)
   — klassiek (CSV-flow + Conversion Booster, /pythago/booster):
   analyse / write / draft */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const org = getOrg();
  try {
    if (action === "load") {
      const domain = String(body.domain || "");
      if (!domain) return NextResponse.json({ error: "Geen store" }, { status: 400 });
      const [data, tasks, auto, presets, notes] = await Promise.all([
        loadData(org, domain), listTasks(org, domain), autoGet(org, domain), presetsList(org, domain), notesGet(org, domain),
      ]);
      return NextResponse.json({ ok: true, data, stale: isStale(data), tasks, auto: auto ? { enabled: auto.enabled !== false, savedAt: auto.savedAt } : null, presets, notes });
    }
    if (action === "sync") {
      const { store, ordersStore, adsSheetId, key, settings } = body;
      const result = await syncStore({ org, store, ordersStore, adsSheetId, key, settings, source: body.source || "handmatig" });
      const tasks = await listTasks(org, store.domain);
      return NextResponse.json({ ok: true, data: result, tasks });
    }
    if (action === "tasks") {
      return NextResponse.json({ ok: true, tasks: await listTasks(org, String(body.domain || "")) });
    }
    if (action === "auto") {
      const { store, ordersStore, adsSheetId, key, settings, enabled } = body;
      if (!store || !store.domain) return NextResponse.json({ error: "Geen store" }, { status: 400 });
      if (enabled) await autoSet(org, store.domain, { store, ordersStore: ordersStore || null, adsSheetId, key, settings: settings || {}, enabled: true });
      else await autoSet(org, store.domain, null);
      return NextResponse.json({ ok: true, enabled: !!enabled });
    }
    if (action === "status") {
      const { store, productIds, status } = body;
      const r = await setStatus({ store, productIds, status });
      const okIds = r.results.filter((x) => x.ok).map((x) => x.productId);
      if (okIds.length) await patchStatus(org, store.domain, okIds, status).catch(() => {});
      return NextResponse.json(r);
    }
    if (action === "variants") {
      return NextResponse.json({ ok: true, variants: await loadVariants(org, String(body.domain || ""), body.productId) });
    }
    if (action === "presets") {
      const domain = String(body.domain || "");
      if (body.op === "save") {
        const p = await presetSave(org, domain, body.preset || {});
        return NextResponse.json({ ok: true, preset: p, presets: await presetsList(org, domain) });
      }
      if (body.op === "delete") {
        await presetDelete(org, domain, String(body.id || ""));
      }
      return NextResponse.json({ ok: true, presets: await presetsList(org, domain) });
    }
    if (action === "notes") {
      const domain = String(body.domain || "");
      if (body.op === "set") return NextResponse.json({ ok: true, notes: await noteSet(org, domain, body.productId, body.text) });
      return NextResponse.json({ ok: true, notes: await notesGet(org, domain) });
    }

    /* ---------- klassiek ---------- */
    if (action === "analyse") {
      const { store, ordersStore, ads, exports, settings, adsCurrency, fxOverride } = body;
      const result = await analysePythago({ store, ordersStore, ads, exports, settings, adsCurrency, fxOverride });
      try {
        await applyBoostState(result, store.domain);
      } catch (e) {
        result.warnings = [...(result.warnings || []), `Boost-status niet geladen: ${String((e && e.message) || e).slice(0, 120)}`];
      }
      return NextResponse.json({ ok: true, result });
    }
    if (action === "write") {
      const { sheet, tab, result } = body;
      return NextResponse.json(await writePythagoTab({ sheet, tab, result }));
    }
    if (action === "draft") {
      const { store, productIds } = body;
      return NextResponse.json(await draftProducts({ store, productIds }));
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[pythago]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
