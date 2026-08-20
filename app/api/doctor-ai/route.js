import { NextResponse } from "next/server";
import { listProductsByIds } from "@/lib/shopify";
import {
  classifyGenderBatch,
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

    if (check === "gender") {
      const r = await listProductsByIds(store, ids, "id,title,tags");
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      const products = r.products || [];
      const rows = products.map((p, i) => ({ index: i, title: p.title, keyword: p.tags || "" }));
      const map = await classifyGenderBatch(rows);
      products.forEach((p, i) => {
        if (map[i] == null) return; // AI gaf geen oordeel → nooit gokken
        const suggested = map[i] === "Man" ? "Men" : "Women";
        const tags = String(p.tags || "").split(",").map((t) => t.trim());
        const current = tags.find((t) => /^(men|women)$/i.test(t)) || "";
        const cur = current ? current.charAt(0).toUpperCase() + current.slice(1).toLowerCase() : "";
        if (cur !== suggested) {
          results.push({ id: p.id, title: p.title, current: cur || "—", suggested });
        }
      });
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
