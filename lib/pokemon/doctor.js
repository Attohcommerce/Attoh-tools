// POKÉMON TOOL — Store Doctor (07-11-2026).
//
// Scan van onze Pokémon-store. Elke bevinding heeft (waar het kan) een
// ⚡ Fix die in porties draait. De belangrijkste: "Kan verkocht worden
// zonder voorraad" — zolang we niets op voorraad hebben mag NIETS
// bestelbaar zijn.
import { storeRequest, listProducts, listProductSeo, setProductSeo, ensureSmartCollection } from "../shopify";
import { classify, standardTitle, stripHtml, copyRatio, productKey, TYPE_COLLECTION, SEALED_TYPES } from "./catalog";
import { tagsFor, DEFAULT_SETTINGS } from "./importer";
import { writeListings, classifyWithAi } from "./ai";

const FIELDS = "id,title,handle,body_html,tags,status,product_type,vendor,images,variants,options,created_at";

const SHOP_TALK_RE = /\b(in stock|op voorraad|direct leverbaar|ships? (within|today|same day)|next[- ]day|vandaag besteld|levertijd|delivery time|pre-?order|limited stock|only \d+ left|nog \d+ op voorraad|free shipping|gratis verzend)/i;

function compWords(comps) {
  const out = [];
  for (const c of comps || []) {
    const d = String(c.domain || "").toLowerCase();
    if (!d) continue;
    out.push(d);
    const name = d.split(".")[0];
    if (name.length >= 5) out.push(name);
    if (c.name && String(c.name).length >= 5) out.push(String(c.name).toLowerCase());
  }
  return [...new Set(out)];
}

const tagList = (p) => String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean);

function sellableWithoutStock(p) {
  return (p.variants || []).filter((v) => !v.inventory_management || (v.inventory_policy === "continue" && Number(v.inventory_quantity || 0) <= 0));
}

export async function scanStore(store, { comps = [], imported = {} } = {}) {
  const lp = await listProducts(store, 5000, { fields: FIELDS });
  if (!lp.ok) return { ok: false, error: lp.error };
  const products = lp.products;
  const seo = await listProductSeo(store, { max: 5000 }).catch(() => ({ ok: false }));
  const srcById = {};
  for (const v of Object.values(imported || {})) if (v && v.id) srcById[String(v.id)] = v;
  const cw = compWords(comps);
  const cwRe = cw.length ? new RegExp(cw.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : null;

  const F = {};
  const add = (id, label, severity, fix, explain) => (F[id] = F[id] || { id, label, severity, fix, explain, items: [] });
  const push = (id, p, detail = "") => F[id].items.push({ id: p.id, title: p.title, handle: p.handle, detail, image: (p.images || [])[0] ? String(p.images[0].src).split("?")[0] + "?width=120" : "" });

  add("oversell", "Kan besteld worden zonder voorraad", "error", "oversell", "Voorraad niet bijgehouden, of 'doorverkopen als uitverkocht' staat aan. Zolang we geen voorraad hebben moet alles 'Sold out' tonen.");
  add("draft", "Staat op concept (niet zichtbaar)", "warn", "activate", "Concept-producten ziet niemand. Fix zet ze actief (ze blijven uitverkocht).");
  add("noimg", "Geen foto", "error", null, "Zonder foto komt het product niet in Google Shopping en verkoopt het niet. Opnieuw importeren of zelf een foto toevoegen.");
  add("oneimg", "Maar 1 foto", "info", null, "Meer foto's (voorkant, achterkant, inhoud) geven meer vertrouwen.");
  add("short", "Omschrijving te kort of leeg", "warn", "rewrite", "Minder dan ±300 tekens. Fix laat de AI een volledige omschrijving schrijven.");
  add("copy", "Omschrijving lijkt op die van de concurrent", "error", "rewrite", "Meer dan 15% letterlijk dezelfde zinsdelen als de bron. Fix herschrijft in eigen woorden.");
  add("comp", "Noemt een concurrent of belooft voorraad/levering", "error", "rewrite", "Naam/domein van een concurrent, of teksten als 'in stock', 'levertijd', 'pre-order'. Fix herschrijft zonder.");
  add("type", "Producttype ontbreekt", "warn", "classify", "Type (Elite Trainer Box, Booster Pack …) stuurt de collecties en filters.");
  add("tags", "Collectie-tags ontbreken", "warn", "classify", "Mist type-, set- of taal-tag — valt dan buiten de collecties.");
  add("title", "Titel niet in vaste vorm", "info", "title", "Vaste vorm: 'Pokémon TCG: …'. Herkenbaar en goed voor Google.");
  add("seo", "SEO-titel/omschrijving leeg", "warn", "seo", "Fix vult ze met een nette titel (max 65) en omschrijving (max 155).");
  add("alt", "Foto's zonder alt-tekst", "info", "alt", "Fix zet de producttitel als alt-tekst.");
  add("sku", "Varianten zonder SKU", "info", "sku", "Handig voor voorraad en de supplier. Fix maakt PK-SET-TYPE-nummer.");
  add("price", "Prijs is 0", "error", null, "Zet zelf een prijs (of opnieuw importeren met prijsinstelling).");
  add("dupe", "Dubbel product", "warn", null, "Zelfde set + type + taal + naam. Kijk welke weg kan.");
  add("collections", "Collectie bestaat nog niet", "warn", "collections", "Er zijn producten met deze tag, maar geen collectie. Fix maakt slimme collecties (op tag).");

  const keys = new Map();
  let soldOut = 0;
  let inStock = 0;
  const tagCount = {};

  for (const p of products) {
    const c = classify({ title: p.title, productType: p.product_type, tags: p.tags, body: p.body_html });
    const body = stripHtml(p.body_html);
    const tags = tagList(p);
    for (const t of tags) tagCount[t] = (tagCount[t] || 0) + 1;

    const sw = sellableWithoutStock(p);
    if (sw.length) push("oversell", p, `${sw.length} variant(en)`);
    const qty = (p.variants || []).reduce((s, v) => s + Math.max(0, Number(v.inventory_quantity || 0)), 0);
    if (qty > 0) inStock++;
    else soldOut++;

    if (p.status === "draft") push("draft", p);
    const imgs = p.images || [];
    if (!imgs.length) push("noimg", p);
    else if (imgs.length === 1) push("oneimg", p);
    if (imgs.some((im) => !String(im.alt || "").trim())) push("alt", p, `${imgs.filter((im) => !im.alt).length} foto's`);

    if (body.length < 300) push("short", p, `${body.length} tekens`);
    const src = srcById[String(p.id)];
    if (src && src.srcText && body.length >= 80) {
      const r = copyRatio(p.body_html, src.srcText);
      if (r > 0.15) push("copy", p, `${Math.round(r * 100)}% overlap`);
    }
    const hay = `${p.title} ${body}`;
    const m1 = cwRe && hay.match(cwRe);
    const m2 = hay.match(SHOP_TALK_RE);
    if (m1 || m2) push("comp", p, `"${(m1 || m2)[0]}"`);

    if (!String(p.product_type || "").trim()) push("type", p, `→ ${c.type}`);
    const want = tagsFor({ type: c.type !== "Other" ? c.type : p.product_type, set: c.set, lang: c.lang }).tags;
    const missing = want.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
    if (missing.length) push("tags", p, `mist: ${missing.join(", ")}`);

    if (!/^pok[eé]mon/i.test(p.title)) push("title", p, `→ ${standardTitle(c)}`);
    if (seo.ok) {
      const s = seo.values[String(p.id)];
      if (!s || !s.title || !s.description) push("seo", p);
    }
    if ((p.variants || []).some((v) => !String(v.sku || "").trim())) push("sku", p);
    if ((p.variants || []).every((v) => !(Number(v.price) > 0))) push("price", p);

    const k = productKey({ title: p.title, type: c.type, set: c.set, lang: c.lang });
    if (keys.has(k)) {
      const first = keys.get(k);
      if (!F.dupe.items.some((x) => x.id === first.id)) push("dupe", first, "origineel");
      push("dupe", p, `zelfde als "${first.title}"`);
    } else keys.set(k, p);
  }

  // Collecties: welke collectie-tags hebben nog geen collectie?
  const colTitles = new Set();
  for (const kind of ["smart_collections", "custom_collections"]) {
    const r = await storeRequest(store, `/${kind}.json?limit=250&fields=id,title`);
    if (r.ok) for (const c of r.data[kind] || []) colTitles.add(String(c.title).toLowerCase());
  }
  const colTagSet = new Set([...Object.values(TYPE_COLLECTION), "Sealed Products"]);
  for (const t of Object.keys(tagCount)) {
    const isCol = colTagSet.has(t) || / Era$/.test(t) || / Pokémon Cards$/.test(t) || classify({ title: t }).set === t;
    if (isCol && !colTitles.has(t.toLowerCase())) F.collections.items.push({ id: t, title: t, detail: `${tagCount[t]} producten` });
  }

  const findings = Object.values(F).filter((f) => f.items.length);
  const weight = { error: 3, warn: 1, info: 0.25 };
  const penalty = findings.reduce((s, f) => s + weight[f.severity] * Math.min(f.items.length, products.length || 1), 0);
  const score = products.length ? Math.max(0, Math.round(100 - (penalty / (products.length * 3)) * 100)) : 0;
  const typeCount = {};
  for (const p of products) typeCount[p.product_type || "—"] = (typeCount[p.product_type || "—"] || 0) + 1;

  return {
    ok: true,
    summary: { total: products.length, soldOut, inStock, score, seoChecked: !!seo.ok, typeCount, scannedAt: Date.now() },
    findings,
  };
}

/* ---------- Fixes (in porties) ---------- */

async function getProducts(store, ids) {
  const r = await storeRequest(store, `/products.json?ids=${ids.join(",")}&limit=250&fields=${FIELDS}`);
  if (!r.ok) throw new Error(r.error);
  return r.data.products || [];
}

export async function runFix(store, fix, ids, { imported = {}, settings = {}, usage } = {}) {
  const done = [];
  const failed = [];
  const ok = (id, note = "") => done.push({ id, note });
  const bad = (id, error) => failed.push({ id, error: String(error).slice(0, 200) });

  if (fix === "collections") {
    for (const t of ids) {
      const r = await ensureSmartCollection(store, t);
      r.ok ? ok(t, r.existed ? "bestond al" : "aangemaakt") : bad(t, r.error);
    }
    return { done, failed };
  }

  const products = await getProducts(store, ids);
  const srcById = {};
  for (const v of Object.values(imported || {})) if (v && v.id) srcById[String(v.id)] = v;

  if (fix === "rewrite") {
    const rows = products.map((p) => {
      const c = classify({ title: p.title, productType: p.product_type, tags: p.tags });
      const src = srcById[String(p.id)];
      return { ...c, title: p.title, body: (src && src.srcText) || p.body_html, type: p.product_type || c.type };
    });
    const w = await writeListings(rows, { lang: settings.lang || "en", brand: settings.brand || "", usage });
    for (let i = 0; i < products.length; i++) {
      const it = w.items[i];
      if (!it || !it.descriptionHtml) {
        bad(products[i].id, "geen tekst");
        continue;
      }
      const r = await storeRequest(store, `/products/${products[i].id}.json`, "PUT", { product: { id: products[i].id, body_html: it.descriptionHtml } });
      r.ok ? ok(products[i].id, it.ai ? `herschreven (${Math.round((it.copy || 0) * 100)}% overlap)` : "standaardtekst") : bad(products[i].id, r.error);
    }
    return { done, failed, usage: w.usage };
  }

  if (fix === "classify") {
    const cls = products.map((p) => classify({ title: p.title, productType: p.product_type, tags: p.tags }));
    const unknown = cls.map((c, i) => (c.type === "Other" || !c.set ? i : -1)).filter((i) => i >= 0);
    if (unknown.length) {
      try {
        const a = await classifyWithAi(unknown.map((i) => ({ title: products[i].title, body: products[i].body_html })), usage);
        unknown.forEach((idx, j) => {
          const g = a.items.find((x) => Number(x.i) === j);
          if (!g) return;
          if (cls[idx].type === "Other" && g.type) cls[idx].type = g.type;
          if (!cls[idx].set && g.set) cls[idx].set = g.set;
          if (g.lang) cls[idx].lang = g.lang;
        });
      } catch {}
    }
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const c = cls[i];
      const type = p.product_type || (c.type !== "Other" ? c.type : "");
      const { tags: want, collect } = tagsFor({ type: type || c.type, set: c.set, lang: c.lang }, settings.collections || DEFAULT_SETTINGS.collections);
      const cur = tagList(p);
      const next = [...new Set([...cur, ...want])];
      const r = await storeRequest(store, `/products/${p.id}.json`, "PUT", { product: { id: p.id, product_type: type, tags: next.join(", ") } });
      if (!r.ok) {
        bad(p.id, r.error);
        continue;
      }
      for (const t of collect) await ensureSmartCollection(store, t);
      ok(p.id, `${type || "?"} · ${want.join(", ")}`);
    }
    return { done, failed };
  }

  for (const p of products) {
    try {
      if (fix === "oversell") {
        for (const v of sellableWithoutStock(p)) {
          const r = await storeRequest(store, `/variants/${v.id}.json`, "PUT", { variant: { id: v.id, inventory_management: "shopify", inventory_policy: "deny" } });
          if (!r.ok) throw new Error(r.error);
        }
        ok(p.id, "voorraad bijhouden aan, doorverkopen uit");
      } else if (fix === "activate") {
        const r = await storeRequest(store, `/products/${p.id}.json`, "PUT", { product: { id: p.id, status: "active", published: true } });
        r.ok ? ok(p.id, "actief") : bad(p.id, r.error);
      } else if (fix === "title") {
        const c = classify({ title: p.title, productType: p.product_type, tags: p.tags });
        const t = standardTitle({ ...c, title: p.title });
        const r = await storeRequest(store, `/products/${p.id}.json`, "PUT", { product: { id: p.id, title: t } });
        r.ok ? ok(p.id, t) : bad(p.id, r.error);
      } else if (fix === "seo") {
        const desc = stripHtml(p.body_html);
        const s = { title: p.title.slice(0, 65), description: (desc.length > 155 ? desc.slice(0, 152).replace(/\s+\S*$/, "") + "…" : desc) || p.title };
        const r = await setProductSeo(store, p.id, s);
        r.ok ? ok(p.id, s.title) : bad(p.id, r.error);
      } else if (fix === "alt") {
        for (const im of p.images || []) {
          if (String(im.alt || "").trim()) continue;
          const r = await storeRequest(store, `/products/${p.id}/images/${im.id}.json`, "PUT", { image: { id: im.id, alt: p.title } });
          if (!r.ok) throw new Error(r.error);
        }
        ok(p.id, "alt-tekst gezet");
      } else if (fix === "sku") {
        const c = classify({ title: p.title, productType: p.product_type, tags: p.tags });
        const ab = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => (/^\d+$/.test(w) ? w : w[0])).join("").slice(0, 5);
        let n = 0;
        for (const v of p.variants || []) {
          n++;
          if (String(v.sku || "").trim()) continue;
          const sku = ["PK", ab(c.set) || "X", ab(p.product_type || c.type) || "X", String(p.id).slice(-5) + (p.variants.length > 1 ? `-${n}` : "")].join("-");
          const r = await storeRequest(store, `/variants/${v.id}.json`, "PUT", { variant: { id: v.id, sku } });
          if (!r.ok) throw new Error(r.error);
        }
        ok(p.id, "SKU gezet");
      } else bad(p.id, `onbekende fix: ${fix}`);
    } catch (e) {
      bad(p.id, e.message || e);
    }
  }
  return { done, failed };
}

/* ---------- Voorraad (als de levering binnen is) ---------- */

let locCache = null;
export async function getLocations(store) {
  const r = await storeRequest(store, "/locations.json");
  if (!r.ok) return { ok: false, error: r.error + " (scope read_locations nodig)" };
  locCache = (r.data.locations || []).filter((l) => l.active !== false);
  return { ok: true, locations: locCache.map((l) => ({ id: l.id, name: l.name })) };
}

/** items: [{variantId? , productId, qty}] → zet de beschikbare voorraad op qty (op één locatie). */
export async function setStock(store, items, locationId) {
  let loc = locationId;
  if (!loc) {
    const l = await getLocations(store);
    if (!l.ok) return { ok: false, error: l.error };
    loc = l.locations[0] && l.locations[0].id;
  }
  if (!loc) return { ok: false, error: "Geen locatie gevonden" };
  const done = [];
  const failed = [];
  const products = await getProducts(store, [...new Set(items.map((i) => i.productId))]);
  for (const it of items) {
    const p = products.find((x) => String(x.id) === String(it.productId));
    if (!p) {
      failed.push({ id: it.productId, error: "product niet gevonden" });
      continue;
    }
    const vs = it.variantId ? p.variants.filter((v) => String(v.id) === String(it.variantId)) : p.variants;
    for (const v of vs) {
      if (!v.inventory_management) await storeRequest(store, `/variants/${v.id}.json`, "PUT", { variant: { id: v.id, inventory_management: "shopify", inventory_policy: "deny" } });
      const r = await storeRequest(store, "/inventory_levels/set.json", "POST", { location_id: loc, inventory_item_id: v.inventory_item_id, available: Math.max(0, Math.round(Number(it.qty) || 0)) });
      r.ok ? done.push({ id: p.id, variant: v.id, qty: it.qty }) : failed.push({ id: p.id, error: r.error + " (scope write_inventory nodig)" });
    }
  }
  return { ok: true, done, failed, locationId: loc };
}

/** Lichte productlijst voor het voorraad-scherm. */
export async function stockList(store) {
  const lp = await listProducts(store, 5000, { fields: "id,title,handle,images,variants,status,product_type" });
  if (!lp.ok) return lp;
  return {
    ok: true,
    products: lp.products.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.product_type,
      status: p.status,
      image: (p.images || [])[0] ? String(p.images[0].src).split("?")[0] + "?width=120" : "",
      variants: (p.variants || []).map((v) => ({ id: v.id, title: v.title, qty: Number(v.inventory_quantity || 0), tracked: !!v.inventory_management, policy: v.inventory_policy, price: v.price })),
    })),
  };
}
