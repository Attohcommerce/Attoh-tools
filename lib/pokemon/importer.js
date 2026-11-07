// POKÉMON TOOL — importer (07-11-2026).
//
// Zet een (ontdubbeld) product in onze Shopify-store:
//  - eigen titel + omschrijving (lib/pokemon/ai.js), SEO-titel/-omschrijving
//  - foto's van de beste bron (Shopify downloadt ze zelf naar onze CDN)
//  - prijs volgens de instelling (laagste/mediaan concurrent × factor, nette eindes)
//  - VOORRAAD 0, voorraad bijhouden AAN, doorverkopen UIT → toont "Sold out".
//    Komt de voorraad binnen: Store Doctor → Voorraad.
//  - tags = collecties: type (Elite Trainer Boxes), set (Surging Sparks),
//    era (Scarlet & Violet), taal (Japanese Pokémon Cards), Sealed Products
//  - metafields pokemon.source_url / set / language (intern; niet zichtbaar)
//  - dubbelcheck: bestaat de handle al in de store → overslaan
import { storeRequest, ensureSmartCollection, cleanDomain } from "../shopify";
import { slugify, targetPrice, TYPE_COLLECTION, SEALED_TYPES, ERA_OF, stripHtml } from "./catalog";

export const DEFAULT_SETTINGS = {
  lang: "en", // taal van de teksten: en | nl | de | fr
  brand: "", // winkelnaam (voor de AI-toon)
  vendor: "Pokémon",
  status: "active", // active = zichtbaar als "Sold out"; draft = verborgen
  priceMode: "min", // min | median | max
  factor: 1,
  ending: ".95", // .95 | .99 | 4.95/9.95 | none
  maxImages: 8,
  collections: { type: true, set: true, era: true, lang: true, sealed: true, featured: false },
};

export function langTag(lang) {
  return `${lang || "English"} Pokémon Cards`;
}

export function tagsFor({ type, set, lang, featured }, col = DEFAULT_SETTINGS.collections) {
  const tags = [];
  const all = { type: [], set: [], era: [], lang: [], sealed: [], featured: [] };
  if (type) all.type.push(TYPE_COLLECTION[type] || type);
  if (set) all.set.push(set);
  if (set && ERA_OF[set] && ERA_OF[set] !== "Japanese") all.era.push(`${ERA_OF[set]} Era`);
  if (lang) all.lang.push(langTag(lang));
  if (SEALED_TYPES.has(type)) all.sealed.push("Sealed Products");
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

  const payload = {
    title,
    handle,
    body_html: listing.descriptionHtml,
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
