import { NextResponse } from "next/server";
import { listProductsByIds, storeRequest } from "@/lib/shopify";
import { storeGendersOf } from "@/lib/store-gender";
import { GARMENTS, auditVerdict } from "@/lib/photo-audit";
import {
  auditPhotosBatch,
  classifyGenderDeep,
  checkColorPhotoBatch,
  findForeignTextBatch,
  flagBrandedImages,
  reviewStoreSample,
} from "@/lib/ai";

export const maxDuration = 60;

/* STORE DOCTOR — AI-checks. De client stuurt per call een KLEIN plukje ids
   (gender 40, language 25, color-photo 8, watermark 4) en herhaalt tot de
   lijst op is; elke response telt z'n eigen AI-kosten mee (aiUsd).
   Alles draait op het goedkope model — zie lib/ai.js. */

function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function POST(req) {
  const { store, check, ids } = await req.json().catch(() => ({}));
  if (!store || !store.domain) {
    return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  }
  if (!check || !Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: "check/ids ontbreekt" }, { status: 400 });
  }

  try {
    let aiUsd = 0;
    const results = [];

    if (check === "photo-audit") {
      /* FOTO-AUDIT: de foto is de baas. Man op de foto bij een "Women's"-product
         (of andersom) = misgenderd; jas in "Tank Tops" = verkeerde collectie. */
      const r = await listProductsByIds(store, ids, "id,title,tags,images,status");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      const products = (r.products || []).filter((p) => p.status !== "archived");
      const storeGenders = await storeGendersOf(store).catch(() => null);
      // Collectienamen = tag-conventie van de store ("Blouses", "Men's Shirts" …)
      const knownTags = new Set();
      for (const kind of ["smart_collections", "custom_collections"]) {
        const c = await storeRequest(store, `/${kind}.json?fields=title&limit=250`);
        if (c.ok) for (const x of (c.data && c.data[kind]) || []) if (x.title) knownTags.add(String(x.title).trim());
      }
      const items = products.map((p, i) => ({
        index: i,
        urls: (p.images || []).slice(0, 2).map((im) => im.src).filter((u) => typeof u === "string" && /^https?:\/\//.test(u)),
      }));
      const out = await auditPhotosBatch(items.filter((x) => x.urls.length), GARMENTS);
      aiUsd += (out.ai && out.ai.usd) || 0;
      for (const a of out.results) {
        const p = products[a.index];
        if (!p) continue;
        const v = auditVerdict(p, a, { storeGenders, knownTags });
        if (v.gender) {
          results.push({
            id: p.id, title: p.title, kind: "gender",
            current: v.gender.current, suggested: v.gender.photo, singleGenderStore: v.gender.singleGenderStore,
            why: `foto toont een ${a.person === "man" ? "man" : "vrouw"} (${Math.round((a.sure || 0) * 100)}%), product staat als ${v.gender.current}`,
          });
        }
        if (v.fit) {
          results.push({
            id: p.id, title: p.title, kind: "fit",
            drop: v.fit.drop, add: v.fit.add, garment: v.fit.garment,
            why: `foto = ${v.fit.garment}, hangt in ${v.fit.drop.join(", ")}${v.fit.add ? ` → ${v.fit.add}` : ""}`,
          });
        }
      }
    } else if (check === "gender") {
      // GRONDIGE MODUS: titel + omschrijving + eerste productfoto tegelijk.
      // Vangt ook producten die in BEIDE collecties hangen (Men+Women-tags).
      const r = await listProductsByIds(store, ids, "id,title,body_html,tags,images");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      const products = r.products || [];
      const items = products.map((p, i) => ({
        index: i,
        title: p.title,
        desc: stripHtml(p.body_html).slice(0, 300),
        tags: p.tags || "",
        url: (p.images && p.images[0] && typeof p.images[0].src === "string" && /^https?:\/\//.test(p.images[0].src)) ? p.images[0].src : null,
      }));
      const out = await classifyGenderDeep(items);
      aiUsd += (out.ai && out.ai.usd) || 0;
      for (const l of out.labels) {
        const p = products[l.index];
        if (!p) continue;
        const suggested = l.label; // "Men" | "Women" (al gevalideerd)
        const tags = String(p.tags || "").split(",").map((t) => t.trim());
        const hasMen = tags.some((t) => /^men$/i.test(t));
        const hasWomen = tags.some((t) => /^women$/i.test(t));
        const current = hasMen && hasWomen ? "Men+Women" : hasMen ? "Men" : hasWomen ? "Women" : "—";
        if (current !== suggested) {
          results.push({ id: p.id, title: p.title, current, suggested });
        }
      }
    } else if (check === "language") {
      const r = await listProductsByIds(store, ids, "id,title,body_html");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      const products = r.products || [];
      const items = products.map((p, i) => ({ index: i, title: p.title, desc: stripHtml(p.body_html).slice(0, 500) }));
      const out = await findForeignTextBatch(items);
      aiUsd += (out.ai && out.ai.usd) || 0;
      for (const f of out.found) {
        const p = products[f.index];
        if (p) results.push({ id: p.id, title: p.title, lang: f.lang || "?", sample: f.sample || "" });
      }
    } else if (check === "color-photo") {
      const r = await listProductsByIds(store, ids, "id,title,images,variants,options");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      const products = r.products || [];
      // per KLEURGROEP één foto beoordelen — niet per maat-variant
      const groups = [];
      for (const p of products) {
        const ci = (p.options || []).findIndex((o) => /colou?r/i.test(String(o.name || "")));
        if (ci < 0) continue;
        const key = `option${ci + 1}`;
        const seen = new Set();
        for (const v of p.variants || []) {
          const c = v[key];
          if (!c || seen.has(c) || !v.image_id) continue;
          seen.add(c);
          const im = (p.images || []).find((x) => x.id === v.image_id);
          if (!im || !im.src) continue;
          groups.push({ index: groups.length, color: c, url: im.src, pid: p.id, title: p.title, imgId: im.id });
        }
      }
      for (let i = 0; i < groups.length; i += 12) {
        const part = groups.slice(i, i + 12);
        const out = await checkColorPhotoBatch(part.map((g) => ({ index: g.index, color: g.color, url: g.url })));
        aiUsd += (out.ai && out.ai.usd) || 0;
        for (const m of out.mismatch) {
          const g = groups[m.index];
          if (g) results.push({ id: g.pid, title: g.title, color: g.color, why: m.why || "" });
        }
      }
    } else if (check === "watermark") {
      const r = await listProductsByIds(store, ids, "id,title,images");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      const products = r.products || [];
      for (const p of products) {
        const imgs = (p.images || [])
          .slice(0, 8)
          .map((im, i) => ({ index: i, url: im.src }))
          .filter((x) => typeof x.url === "string" && /^https?:\/\//.test(x.url));
        if (!imgs.length) continue;
        try {
          const out = await flagBrandedImages(imgs);
          aiUsd += (out.ai && out.ai.usd) || 0;
          for (const f of out.remove) {
            const im = (p.images || [])[f.index];
            if (im) results.push({ id: p.id, title: p.title, imageId: im.id, src: im.src, reason: f.reason || "branding" });
          }
        } catch {
          results.push({ id: p.id, title: p.title, imageId: null, src: "", reason: "check faalde — handmatig bekijken" });
        }
      }
    } else if (check === "sample") {
      // De oude Store QA-steekproef: 12 producten in samenhang, zoekt
      // patronen die zich over veel producten herhalen (groot model).
      const r = await listProductsByIds(store, ids.slice(0, 12), "id,title,body_html,tags");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      const sample = (r.products || []).map((p) => ({
        title: p.title,
        desc: stripHtml(p.body_html).slice(0, 600),
        tags: p.tags,
      }));
      const issues = await reviewStoreSample(sample);
      for (const a of issues) {
        results.push({ id: null, title: a.title, why: a.why, affected: a.affected, example: a.example });
      }
    } else {
      return NextResponse.json({ error: `Onbekende check "${check}"` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, results, aiUsd, processed: ids.length });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
