import { NextResponse } from "next/server";
import { analysePythago, writePythagoTab, draftProducts } from "@/lib/pythago";
import { applyBoostState } from "@/lib/cvr-boost";
import {
  syncStore, loadData, isStale, listTasks, autoGet, autoSet, loadVariants,
  presetsList, presetSave, presetDelete, notesGet, noteSet, setStatus, patchStatus, quarList, quarantine, quarForget,
} from "@/lib/pythago-sync";
import { getOrg } from "@/lib/org-server";
import { getSession } from "@/lib/session";
import { extList, extSave, extDelete, extResetToken, extSharesDomain, connSave, logList, knownStores } from "@/lib/pythago-ext";
import { cleanDomain } from "@/lib/shopify";

/* PYTHAGO (03-11-2026: volledig dashboard, zie lib/pythago-sync.js)
   load:     opgeslagen dashboard-data + taken + auto-sync-stand + presets + notities
   sync:     nu syncen (Ads-sheet + Shopify → Redis); schrijft een taak
   tasks:    lopende/afgeronde taken
   auto:     automatisch syncen aan/uit (koppeling bewaren voor de cron)
   status:   aangevinkte producten op active / draft / archived (nooit vanzelf)
   quarantine: zombie-producten in/uit quarantaine (feed-label + tag), zie lib/pythago-sync.js
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
      const [data, tasks, auto, presets, notes, quar] = await Promise.all([
        loadData(org, domain), listTasks(org, domain), autoGet(org, domain), presetsList(org, domain), notesGet(org, domain), quarList(org, domain),
      ]);
      return NextResponse.json({ ok: true, data, stale: isStale(data), tasks, auto: auto ? { enabled: auto.enabled !== false, savedAt: auto.savedAt } : null, presets, notes, quar });
    }
    if (action === "sync") {
      const { store, ordersStore, adsSheetId, key, settings } = body;
      const result = await syncStore({ org, store, ordersStore, adsSheetId, key, settings, source: body.source || "handmatig" });
      // gedeeld met een externe gebruiker (/px)? dan de koppeling vers houden op de server
      if (await extSharesDomain(store.domain).catch(() => false)) await connSave(org, store.domain, { store, ordersStore, adsSheetId, key, settings }).catch(() => {});
      const tasks = await listTasks(org, store.domain);
      return NextResponse.json({ ok: true, data: result, tasks });
    }
    if (action === "ext") {
      // Pythago Extern beheren (alleen Justin, via de gewone login)
      // op: list | save | delete | reset — conns = { domein: koppeling } uit Justins browser
      const op = String(body.op || "list");
      if (op === "save") {
        const me = await getSession().catch(() => null);
        const u = await extSave(body.user || {}, { org, by: (me && me.user && me.user.email) || "" });
        const conns = body.conns && typeof body.conns === "object" ? body.conns : {};
        const missing = [];
        for (const d of u.stores) {
          const c = conns[d] || Object.entries(conns).find(([k]) => cleanDomain(k) === d)?.[1];
          const ok = c ? await connSave(org, d, c).catch(() => false) : false;
          if (!ok) missing.push(d);
        }
        return NextResponse.json({ ok: true, user: u, missing, ...(await extOverview(org)) });
      }
      if (op === "delete") {
        await extDelete(String(body.id || ""));
        return NextResponse.json({ ok: true, ...(await extOverview(org)) });
      }
      if (op === "reset") {
        await extResetToken(String(body.id || ""));
        return NextResponse.json({ ok: true, ...(await extOverview(org)) });
      }
      return NextResponse.json({ ok: true, ...(await extOverview(org)) });
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
      if (okIds.length && status !== "active") r.quar = await quarForget(org, store.domain, okIds).catch(() => undefined);
      return NextResponse.json(r);
    }
    if (action === "quarantine") {
      // { store, productIds, on, label, rows } — feed-label + tag "quarantine" zetten of weghalen
      const r = await quarantine({ org, store: body.store, productIds: body.productIds, on: body.on !== false, label: body.label, rows: body.rows || [] });
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

// Externe gebruikers + hun laatste activiteit (per gedeelde store)
async function extOverview(org) {
  const users = (await extList()).filter((u) => u.org === org);
  const domains = [...new Set(users.flatMap((u) => u.stores || []))];
  const logs = {};
  for (const d of domains) logs[d] = await logList(org, d, 150).catch(() => []);
  return { users, logs, known: await knownStores() };
}
