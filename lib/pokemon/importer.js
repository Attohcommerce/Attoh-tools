// POKÉMON TOOL — importer (07-11-2026).
//
// Zet een (ontdubbeld) product in onze Shopify-store:
//  - eigen titel + omschrijving (lib/pokemon/ai.js), SEO-titel/-omschrijving
//  - foto's van de beste bron (Shopify downloadt ze zelf naar onze CDN)
//  - prijs volgens de instelling (laagste/mediaan concurrent × factor, nette eindes)
//  - VOORRAAD 0, voorraad bijhouden AAN, doorverkopen UIT → toont "Sold out".
//    Komt de voorraad binnen: Store Doctor → Voorraad.
//  - tags = collecties: type (Elite Trainer Boxes), set (Surging Sparks),
//    era (Mega Evolution Era), taal (Japanse Pokémon Kaarten), Sealed Producten, Releases 2026, Cases, Binnenkort
//  - metafields pokemon.source_url / set / language (intern; niet zichtbaar)
//  - dubbelcheck: bestaat de handle al in de store → overslaan
import { storeRequest, storeGraphql, ensureSmartCollection, cleanDomain } from "../shopify";
import { slugify, targetPrice, TYPE_COLLECTION, SEALED_TYPES, ERA_OF, stripHtml, LANG_NL } from "./catalog";
import { extraCollections, fillImageMarkers, releaseDateOf, SET_CODES, MAX_QTY } from "./brain";

export const DEFAULT_SETTINGS = {
  lang: "nl", // taal van de teksten: nl (store-taal, 09-11-2026) | en | de | fr
  brand: "", // winkelnaam (voor de AI-toon)
  vendor: "Pokémon",
  status: "active", // active = zichtbaar als "Sold out"; draft = verborgen
  priceMode: "min", // min | median | max
  factor: 1,
  ending: ".95", // .95 | .99 | 4.95/9.95 | none
  maxImages: 8,
  collections: { type: true, set: true, era: true, lang: true, sealed: true, featured: false, extra: true },
  caseDiscount: 0.05, // case = losse prijs × aantal − 5%
  maxQty: MAX_QTY, // max per bestelling per type (thema toont de pil); {} = uit
};

/** Metafields die het thema leest: set_code, release_date, max_qty. */
export function themeMetafields({ set, type }, s = DEFAULT_SETTINGS) {
  const out = [];
  const code = SET_CODES[set];
  if (code) out.push({ namespace: "pokemon", key: "set_code", type: "single_line_text_field", value: code });
  const rel = releaseDateOf(set);
  if (rel) out.push({ namespace: "pokemon", key: "release_date", type: "date", value: rel });
  const mq = (s.maxQty || {})[type];
  if (mq) out.push({ namespace: "pokemon", key: "max_qty", type: "number_integer", value: String(mq) });
  return out;
}

/** Collectie per taal: "Japanse Pokémon Kaarten", "Engelse Pokémon Kaarten" (handle: japanse-pokemon-kaarten). */
export function langTag(lang) {
  const nl = LANG_NL[lang || "English"] || lang || "Engels";
  const adj = nl.endsWith("s") ? nl + "e" : nl + "e"; // Japans → Japanse, Engels → Engelse, Chinees → Chinese
  return `${adj.replace("Chineese", "Chinese").replace("Nederlandse", "Nederlandse")} Pokémon Kaarten`;
}

export function tagsFor({ type, set, lang, featured }, col = DEFAULT_SETTINGS.collections) {
  const tags = [];
  const all = { type: [], set: [], era: [], lang: [], sealed: [], featured: [], extra: extraCollections({ set, type }) };
  if (type) all.type.push(TYPE_COLLECTION[type] || type);
  if (set) all.set.push(set);
  if (set && ERA_OF[set] && ERA_OF[set] !== "Japanese") all.era.push(`${ERA_OF[set]} Era`);
  if (lang) all.lang.push(langTag(lang));
  if (SEALED_TYPES.has(type)) all.sealed.push("Sealed Producten");
  if (featured) all.featured.push(featured);
  for (const k of Object.keys(all)) tags.push(...all[k]);
  // collectie-tags (alleen voor aangevinkte groepen) apart teruggeven
  const collect = Object.keys(all).filter((k) => col[k]).flatMap((k) => all[k]);
  return { tags: [...new Set(tags)], collect: [...new Set(collect)] };
}

async function handleExists(store, handle) {
  const r = await storeRequest(store, `/products.json?handle=${encodeURIComponent(handle)}&fields=id,handle`);
  if (!r.ok) return null;
  const p = (r.data.products || [])[0];
  return p ? p.id : null;
}

function skuFor({ set, type }, n) {
  const ab = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => (/^\d+$/.test(w) ? w : w[0])).join("").slice(0, 5);
  return ["PK", ab(set) || "X", ab(type) || "X", String(n).slice(-5)].join("-");
}

/**
 * group    = een groep uit groupProducts (best + sources + prijzen)
 * listing  = uitkomst van writeListings voor group.best
 * settings = DEFAULT_SETTINGS + wat de gebruiker koos
 */
export async function importGroup(store, group, listing, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings, collections: { ...DEFAULT_SETTINGS.collections, ...(settings.collections || {}) } };
  const src = group.best;
  const title = listing.title;
  const handle = slugify(title.replace(/^Pokémon TCG:\s*/i, "pokemon "));
  const existing = await handleExists(store, handle);
  if (existing) return { ok: true, skipped: true, id: existing, handle, reason: "bestaat al in de store" };

  const price = targetPrice(group, { mode: s.priceMode, factor: s.factor, ending: s.ending });
  const { tags, collect } = tagsFor({ type: listing.type, set: listing.set, lang: listing.lang, featured: listing.featured }, s.collections);
  const n = Date.now();

  // Varianten: meestal 1. Heeft de bron echte opties (bv. "Language"), dan
  // nemen we die over met dezelfde onderlinge prijsverhouding.
  const realOptions = (src.options || []).filter((o) => o && o.name && !/^title$/i.test(o.name));
  let options;
  let variants;
  const base = { inventory_management: "shopify", inventory_policy: "deny", requires_shipping: true, taxable: true };
  if (realOptions.length && (src.variants || []).length > 1) {
    const minP = Math.min(...src.variants.map((v) => v.price || Infinity));
    options = realOptions.slice(0, 3).map((o) => ({ name: o.name }));
    variants = src.variants.slice(0, 30).map((v, i) => ({
      ...base,
      option1: v.option1 || undefined,
      option2: realOptions.length > 1 ? v.option2 || undefined : undefined,
      option3: realOptions.length > 2 ? v.option3 || undefined : undefined,
      price: (price && minP && v.price ? (price * v.price) / minP : v.price || price || 0).toFixed(2),
      sku: skuFor(listing, n + i),
    }));
  } else {
    variants = [{ ...base, price: (price || 0).toFixed(2), sku: skuFor(listing, n), barcode: src.gtin || undefined }];
  }

  let bodyHtml = listing.descriptionHtml;
  if (listing.bodyImages && listing.bodyImages.length) bodyHtml = fillImageMarkers(bodyHtml, await rehostImages(store, listing.bodyImages, title), title);
  else bodyHtml = String(bodyHtml || "").replace(/\[\[IMG\d+\]\]/g, "");

  const payload = {
    title,
    handle,
    body_html: bodyHtml,
    vendor: s.vendor || "Pokémon",
    product_type: listing.type || "",
    tags: tags.join(", "),
    status: s.status === "draft" ? "draft" : "active",
    published: s.status !== "draft",
    images: (src.images || []).slice(0, s.maxImages || 8).map((url) => ({ src: url, alt: title })),
    variants,
    ...(options ? { options } : {}),
    metafields_global_title_tag: listing.seoTitle || title.slice(0, 65),
    metafields_global_description_tag: listing.seoDescription || stripHtml(listing.descriptionHtml).slice(0, 155),
    metafields: [
      { namespace: "pokemon", key: "source_url", type: "single_line_text_field", value: src.url },
      ...(listing.set ? [{ namespace: "pokemon", key: "set", type: "single_line_text_field", value: listing.set }] : []),
      { namespace: "pokemon", key: "language", type: "single_line_text_field", value: listing.lang || "English" },
      ...themeMetafields({ set: listing.set, type: listing.type }, s),
    ],
  };

  let r = await storeRequest(store, "/products.json", "POST", { product: payload });
  // Een foto die Shopify niet kan downloaden laat de hele call falen → zonder die foto's opnieuw
  if (!r.ok && /image/i.test(String(r.error))) {
    r = await storeRequest(store, "/products.json", "POST", { product: { ...payload, images: payload.images.slice(0, 1) } });
    if (!r.ok) r = await storeRequest(store, "/products.json", "POST", { product: { ...payload, images: [] } });
  }
  if (!r.ok) return { ok: false, error: r.error };
  const p = r.data.product;

  // Collecties (smart, op tag) — fouten hier stoppen de import niet
  const colErrors = [];
  for (const t of collect) {
    const c = await ensureSmartCollection(store, t);
    if (!c.ok) colErrors.push(`${t}: ${c.error}`);
  }

  return {
    ok: true,
    id: p.id,
    handle: p.handle,
    title: p.title,
    price,
    images: (p.images || []).length,
    adminUrl: `https://${cleanDomain(store.domain)}/admin/products/${p.id}`,
    colErrors,
  };
}


/* ---------- Importlijst (09-11-2026) ---------- */

/** Foto's uit de omschrijving van de concurrent naar ONZE Shopify Files (geen hotlinks). */
export async function rehostImages(store, urls, alt) {
  if (!urls || !urls.length) return [];
  const r = await storeGraphql(
    store,
    `mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){ files{ id } userErrors{ message } } }`,
    { files: urls.slice(0, 10).map((u) => ({ originalSource: u, contentType: "IMAGE", alt: String(alt || "").slice(0, 120) })) }
  );
  const ids = r.ok ? ((r.data.fileCreate || {}).files || []).map((f) => f.id) : [];
  if (!ids.length) return urls; // lukt het niet, dan de originele links
  const out = new Array(ids.length).fill(null);
  for (let t = 0; t < 6 && out.some((x) => !x); t++) {
    await new Promise((res) => setTimeout(res, 1500));
    const q = await storeGraphql(store, `query($ids:[ID!]!){ nodes(ids:$ids){ ... on MediaImage { id fileStatus image { url } } } }`, { ids });
    if (!q.ok) break;
    (q.data.nodes || []).forEach((n, i) => {
      if (n && n.image && n.image.url) out[i] = n.image.url;
    });
  }
  return out.map((u, i) => u || urls[i]);
}

function imageList(spec, max) {
  const seen = new Set();
  const out = [];
  const push = (u) => {
    if (u && !seen.has(u) && out.length < max) {
      seen.add(u);
      out.push(u);
    }
  };
  // varianten: eerst van elke variant de hoofdfoto, dan de rest
  for (const v of spec.variants || []) push(((v.best && v.best.images) || [])[0]);
  for (const u of (spec.best && spec.best.images) || []) push(u);
  for (const v of spec.variants || []) for (const u of (v.best && v.best.images) || []) push(u);
  return out;
}

/**
 * Eén regel van de importlijst in de store zetten.
 * spec = { row, best, sources, price, variants:[{name, price, best}], listing }
 */
export async function importListItem(store, spec, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings, collections: { ...DEFAULT_SETTINGS.collections, ...(settings.collections || {}) } };
  const { row, listing } = spec;
  const title = listing.title;
  const handle = slugify(title.replace(/^Pokémon TCG:\s*/i, "pokemon "));
  const existing = await handleExists(store, handle);
  if (existing) return { ok: true, skipped: true, id: existing, handle, reason: "bestaat al in de store" };

  const type = row.type;
  const meta = { type, set: row.set || listing.set, lang: row.lang || listing.lang, featured: listing.featured };
  const { tags, collect } = tagsFor(meta, s.collections);
  tags.push(`list:${row.id}`);
  const n = Date.now();
  const base = { inventory_management: "shopify", inventory_policy: "deny", requires_shipping: true, taxable: true };
  let options;
  let variants;
  const okVariants = (spec.variants || []).filter((v) => v.price || spec.price);
  if (okVariants.length > 1) {
    options = [{ name: row.option || "Design" }];
    variants = okVariants.map((v, i) => ({ ...base, option1: v.name, price: Number(v.price || spec.price).toFixed(2), sku: skuFor(meta, n + i) }));
  } else {
    variants = [{ ...base, price: Number(spec.price || 0).toFixed(2), sku: skuFor(meta, n), barcode: (spec.best && spec.best.gtin) || undefined }];
  }

  // Strategie 1: foto's uit de omschrijving van de bron → eerst naar onze Files
  let body = listing.descriptionHtml;
  if (listing.bodyImages && listing.bodyImages.length) {
    const urls = await rehostImages(store, listing.bodyImages, title);
    body = fillImageMarkers(body, urls, title);
  } else {
    body = body.replace(/\[\[IMG\d+\]\]/g, "");
  }

  const payload = {
    title,
    handle,
    body_html: body,
    vendor: s.vendor || "Pokémon",
    product_type: TYPE_COLLECTION[type] ? type : listing.type || type,
    tags: [...new Set(tags)].join(", "),
    status: s.status === "draft" ? "draft" : "active",
    published: s.status !== "draft",
    images: imageList(spec, s.maxImages || 8).map((url) => ({ src: url, alt: title })),
    variants,
    ...(options ? { options } : {}),
    metafields_global_title_tag: listing.seoTitle || title.slice(0, 65),
    metafields_global_description_tag: listing.seoDescription || stripHtml(body).slice(0, 155),
    metafields: [
      { namespace: "pokemon", key: "source_url", type: "single_line_text_field", value: ((spec.sources || []).map((x) => x.url).join(" ") || "-").slice(0, 250) },
      ...(meta.set ? [{ namespace: "pokemon", key: "set", type: "single_line_text_field", value: meta.set }] : []),
      { namespace: "pokemon", key: "language", type: "single_line_text_field", value: meta.lang || "English" },
      { namespace: "pokemon", key: "list_id", type: "single_line_text_field", value: row.id },
      ...(row.caseQty ? [{ namespace: "pokemon", key: "case_qty", type: "number_integer", value: String(row.caseQty) }] : []),
      ...themeMetafields({ set: meta.set, type }, s),
    ],
  };

  let r = await storeRequest(store, "/products.json", "POST", { product: payload });
  if (!r.ok && /image/i.test(String(r.error))) {
    r = await storeRequest(store, "/products.json", "POST", { product: { ...payload, images: payload.images.slice(0, 1) } });
    if (!r.ok) r = await storeRequest(store, "/products.json", "POST", { product: { ...payload, images: [] } });
  }
  if (!r.ok) return { ok: false, error: r.error };
  const p = r.data.product;

  const colErrors = [];
  for (const t of collect) {
    const c = await ensureSmartCollection(store, t);
    if (!c.ok) colErrors.push(`${t}: ${c.error}`);
  }
  return { ok: true, id: p.id, handle: p.handle, title: p.title, price: Number(variants[0].price), variants: variants.length, images: (p.images || []).length, adminUrl: `https://${cleanDomain(store.domain)}/admin/products/${p.id}`, colErrors };
}
