import { NextResponse } from "next/server";
import { getPxSession } from "@/lib/px-session";
import {
  syncStore, loadData, isStale, listTasks, loadVariants,
  presetsList, presetSave, presetDelete, notesGet, noteSet, setStatus, patchStatus, quarForget,
} from "@/lib/pythago-sync";
import { extGet, extCfg, extTouch, publicStore, logAdd } from "@/lib/pythago-ext";
import { cleanDomain } from "@/lib/shopify";

/* PYTHAGO EXTERN (26-11-2026) — de API achter /px.
   Alleen met de eigen sessie (cookie attoh_px_session) en alleen voor de
   stores die Justin voor deze persoon heeft aangezet. De store-koppeling komt
   van de server (lib/pythago-ext.js → extCfg); wat de browser stuurt aan
   sleutels/instellingen wordt genegeerd.
   me · load · tasks · sync · status · variants · notes · presets */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const STATUSES = ["active", "draft", "archived"];

function err(status, error) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  const session = await getPxSession();
  if (!session.user || !session.user.id) return err(401, "Niet ingelogd");
  const user = await extGet(session.user.id);
  if (!user || user.disabled || user.email !== session.user.email) {
    session.destroy();
    return err(401, "Je toegang is ingetrokken of verlopen. Vraag een nieuwe link.");
  }
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  extTouch(user, ip);
  const org = user.org;
  const who = { email: user.email, name: user.name };
  const allowed = (user.stores || []).map((d) => cleanDomain(d));

  try {
    if (action === "me") {
      const stores = [];
      for (const d of allowed) {
        const cfg = await extCfg(org, d).catch(() => null);
        stores.push(publicStore(cfg, d));
      }
      return NextResponse.json({ ok: true, user: { name: user.name, email: user.email, canEdit: user.canEdit !== false }, stores });
    }

    // alles hieronder: één store, en die moet gedeeld zijn
    const domain = cleanDomain(body.domain || (body.store && body.store.domain) || "");
    if (!domain) return err(400, "Geen store");
    if (!allowed.includes(domain)) return err(403, "Deze store is niet met je gedeeld");

    if (action === "load") {
      const [data, tasks, presets, notes] = await Promise.all([loadData(org, domain), listTasks(org, domain), presetsList(org, domain), notesGet(org, domain)]);
      return NextResponse.json({ ok: true, data, stale: isStale(data), tasks, auto: null, presets: ownPresets(presets, user), notes, quar: {} });
    }
    if (action === "tasks") {
      return NextResponse.json({ ok: true, tasks: await listTasks(org, domain) });
    }
    if (action === "variants") {
      return NextResponse.json({ ok: true, variants: await loadVariants(org, domain, body.productId) });
    }
    if (action === "sync") {
      const cfg = await extCfg(org, domain);
      if (!cfg || !cfg.store) return err(409, "Deze store is nog niet gekoppeld — vraag Justin om de koppeling te vernieuwen.");
      if (!cfg.key) return err(409, "Deze store heeft nog geen Ads-koppeling — vraag Justin om dat aan te zetten.");
      const result = await syncStore({ org, store: cfg.store, ordersStore: cfg.ordersStore, adsSheetId: cfg.adsSheetId, key: cfg.key, settings: cfg.settings || {}, source: `extern · ${user.name}` });
      await logAdd(org, domain, { ...who, action: "sync", detail: `sync (${String(body.source || "handmatig").slice(0, 40)}) · ${result.rows.length} producten` });
      return NextResponse.json({ ok: true, data: result, tasks: await listTasks(org, domain) });
    }
    if (action === "status") {
      if (user.canEdit === false) return err(403, "Je mag geen productstatus wijzigen");
      const status = String(body.status || "");
      if (!STATUSES.includes(status)) return err(400, "Onbekende status");
      const ids = [...new Set((Array.isArray(body.productIds) ? body.productIds : []).map((x) => String(x)).filter((x) => /^\d{5,}$/.test(x)))].slice(0, 250);
      if (!ids.length) return err(400, "Geen producten gekozen");
      const cfg = await extCfg(org, domain);
      if (!cfg || !cfg.store) return err(409, "Deze store is nog niet gekoppeld");
      const r = await setStatus({ store: cfg.store, productIds: ids, status });
      const okIds = r.results.filter((x) => x.ok).map((x) => x.productId);
      if (okIds.length) await patchStatus(org, domain, okIds, status).catch(() => {});
      if (okIds.length && status !== "active") r.quar = await quarForget(org, domain, okIds).catch(() => undefined);
      const data = await loadData(org, domain).catch(() => null);
      const titles = okIds.slice(0, 12).map((id) => {
        const row = data && data.rows ? data.rows.find((x) => String(x.productId) === String(id)) : null;
        return row ? row.title : id;
      });
      await logAdd(org, domain, { ...who, action: "status", detail: `${okIds.length} product(en) op ${status}${r.failed && r.failed.length ? ` · ${r.failed.length} mislukt` : ""}`, ids: okIds.slice(0, 100), titles });
      delete r.quar; // hygiëne is niet voor extern
      return NextResponse.json(r);
    }
    if (action === "notes") {
      if (body.op === "set") {
        const pid = String(body.productId || "");
        if (!/^\d{5,}$/.test(pid)) return err(400, "Onbekend product");
        const text = String(body.text || "").slice(0, 2000);
        const notes = await noteSet(org, domain, pid, text, text.trim() ? who : null);
        await logAdd(org, domain, { ...who, action: "note", detail: text.trim() ? `notitie: ${text.trim().slice(0, 120)}` : "notitie verwijderd", ids: [pid] });
        return NextResponse.json({ ok: true, notes });
      }
      return NextResponse.json({ ok: true, notes: await notesGet(org, domain) });
    }
    if (action === "presets") {
      const all = await presetsList(org, domain);
      if (body.op === "save") {
        const p = body.preset || {};
        const name = String(p.name || "").trim().slice(0, 80);
        if (!name) return err(400, "Geef het filter een naam");
        if (p.id) {
          const old = all.find((x) => x.id === p.id);
          if (old && !(old.by && old.by.email === user.email)) return err(403, "Dit filter is niet van jou");
        }
        const clean = {
          id: p.id || undefined,
          name,
          color: String(p.color || "").slice(0, 20),
          filters: p.filters && typeof p.filters === "object" ? p.filters : {},
          period: [7, 14, 30].includes(Number(p.period)) ? Number(p.period) : 30,
          scope: "store",
          by: who,
        };
        const saved = await presetSave(org, domain, clean);
        await logAdd(org, domain, { ...who, action: "preset", detail: `filter opgeslagen: ${name}` });
        return NextResponse.json({ ok: true, preset: saved, presets: ownPresets(await presetsList(org, domain), user) });
      }
      if (body.op === "delete") {
        const id = String(body.id || "");
        const old = all.find((x) => x.id === id);
        if (!old || !(old.by && old.by.email === user.email)) return err(403, "Dit filter is niet van jou");
        await presetDelete(org, domain, id);
        await logAdd(org, domain, { ...who, action: "preset", detail: `filter verwijderd: ${old.name}` });
        return NextResponse.json({ ok: true, presets: ownPresets(await presetsList(org, domain), user) });
      }
      return NextResponse.json({ ok: true, presets: ownPresets(all, user) });
    }
    return err(400, "Deze actie is niet beschikbaar");
  } catch (e) {
    console.error("[px]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String((e && e.message) || e) }, { status: (e && e.status) || 500 });
  }
}

// Een externe gebruiker ziet alleen zijn eigen opgeslagen filters.
function ownPresets(list, user) {
  return (list || []).filter((p) => p.by && p.by.email === user.email);
}
