import { NextResponse } from "next/server";
import {
  createProduct,
  setImageVariants,
  updateProduct,
  getPreviewUrl,
  findTaxonomyCategory,
  setProductCategory,
  ensureSmartCollection,
} from "@/lib/shopify";
import { collectionFor } from "@/lib/verdeling";
import { flagBrandedImages } from "@/lib/ai";
import { analyzeKeyword } from "@/lib/fashion";

export const maxDuration = 60;

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* PRIJSBANDEN per productsoort (USD, altijd op het X4,95/X9,95-rooster).
   De bron-prijs bepaalt alleen nog WAAR in de band het product landt —
   nooit meer of het bedrag redelijk is. Een jas van $250 bij de bron wordt
   $89,95; een trui van $100 wordt $59,95; een te goedkope blouse wordt
   opgetild naar de bandondergrens. */
const PRICE_BANDS = {
  tshirt: [24.95, 34.95],
  top: [29.95, 44.95],
  bodysuit: [29.95, 44.95],
  leggings: [29.95, 44.95],
  polo: [34.95, 44.95],
  shorts: [34.95, 44.95],
  bikini: [34.95, 44.95],
  shirt: [34.95, 49.95],
  blouse: [34.95, 49.95],
  swimsuit: [34.95, 49.95],
  skirt: [39.95, 54.95],
  sandals: [39.95, 54.95],
  pajamas: [39.95, 54.95],
  bag: [39.95, 59.95],
  sweater: [44.95, 59.95],
  hoodie: [44.95, 59.95],
  cardigan: [44.95, 59.95],
  kimono: [44.95, 59.95],
  pants: [44.95, 59.95],
  flats: [44.95, 59.95],
  mules: [44.95, 59.95],
  jeans: [49.95, 64.95],
  jumpsuit: [49.95, 64.95],
  heels: [49.95, 64.95],
  loafers: [49.95, 64.95],
  vest: [49.95, 64.95],
  dress: [49.95, 69.95],
  sneakers: [49.95, 69.95],
  set: [54.95, 74.95],
  blazer: [59.95, 79.95],
  boots: [59.95, 79.95],
  jacket: [69.95, 89.95],
  coat: [79.95, 99.95],
  suit: [79.95, 99.95],
  scarf: [24.95, 34.95],
  belt: [24.95, 34.95],
  hat: [24.95, 34.95],
  bra: [24.95, 39.95],
};
const DEFAULT_BAND = [44.95, 64.95];

/* Producttype → zoekterm in Shopify's Standard Product Taxonomy. De
   categorie stuurt belastingregels, filters én Google's productclassificatie
   in de feed — leeg laten kost feed-kwaliteit. */
const TYPE_TAXONOMY = {
  dress: "Dresses", tshirt: "T-Shirts", shirt: "Shirts", blouse: "Blouses",
  top: "Tops", sweater: "Sweaters", hoodie: "Hoodies", cardigan: "Cardigans",
  jacket: "Jackets", coat: "Coats", blazer: "Blazers", jeans: "Jeans",
  pants: "Pants", leggings: "Leggings", shorts: "Shorts", skirt: "Skirts",
  jumpsuit: "Jumpsuits", heels: "Heels", boots: "Boots", sneakers: "Sneakers",
  loafers: "Loafers", sandals: "Sandals", flats: "Flats", mules: "Mules",
  bag: "Handbags", scarf: "Scarves", belt: "Belts", hat: "Hats",
  swimsuit: "Swimwear", bikini: "Swimwear", vest: "Vests", polo: "Polos",
  bodysuit: "Bodysuits", kimono: "Kimonos", pajamas: "Pajamas", bra: "Bras",
  set: "Outfit Sets", suit: "Suits",
};

function bandFor(keyword) {
  try {
    const a = analyzeKeyword(String(keyword || "").toLowerCase());
    if (a && a.typeId && PRICE_BANDS[a.typeId]) return { band: PRICE_BANDS[a.typeId], type: a.typeId };
  } catch {}
  return { band: DEFAULT_BAND, type: "onbekend" };
}

/**
 * Psychologische prijs op het 5-dollar-rooster: altijd eindigen op
 * X4,95 of X9,95. 52,95 → 54,95 · 51 → 49,95 · 63 → 64,95 · 66 → 64,95.
 * Geen tussenprijzen als 52,95 of 61,95 meer — elk product landt op een
 * herkenbaar prijsanker.
 */
function roundTo95(n) {
  if (!(n > 0)) return 4.95;
  const out = Math.max(4.95, Math.round(n / 5) * 5 - 0.05);
  return round2(out);
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { store, product, listing, settings, fx } = body;
  // store: {domain, token|clientId+clientSecret}  product: gescrapete bron
  // listing: {title, descriptionHtml}  settings: {discountPct, status, tags, ...}
  // fx: {rate} — bron-valuta → store-valuta (1 als gelijk/onbekend)

  if (!store || !store.domain) {
    return NextResponse.json({ error: "Geen store geselecteerd" }, { status: 400 });
  }
  if (!store.token && !(store.clientId && store.clientSecret)) {
    return NextResponse.json(
      { error: "Store mist een geldige koppeling — voeg hem opnieuw toe" },
      { status: 400 }
    );
  }
  if (!product || !listing) {
    return NextResponse.json({ error: "product/listing ontbreekt" }, { status: 400 });
  }

  const s = settings || {};
  const rate = s.manualRate ? Number(s.manualRate) : fx && fx.rate ? Number(fx.rate) : 1;
  // Herkomst voor de import-log: bron-valuta → land van herkomst
  const CUR_LAND = { USD: "USA", EUR: "EU", GBP: "UK", AUD: "AUS", CAD: "CANADA", NZD: "NZ", PLN: "PL", SEK: "SE", DKK: "DK", CHF: "CH" };
  const srcCur = String(product.sourceCurrency || "").toUpperCase() || "?";
  const srcPrices = (product.variants || []).map((v) => Number(v.price) || 0).filter((n) => n > 0);
  const srcPrice = srcPrices.length ? Math.min(...srcPrices) : 0;
  const discountPct = Number(s.discountPct || 0);

  // Opties hernoemen: Color/Colour + eigen Size-label
  const options = (product.options || []).map((o) => {
    let name = o.name;
    if (/^colou?r$/i.test(name)) name = s.colorLabel || "Color";
    if (/^size$/i.test(name)) name = s.sizeLabel || "Size";
    return { name };
  });

  const { band, type: priceType } = bandFor(s.keyword);
  let clampedCount = 0;
  const variants = (product.variants || []).map((v) => {
    // 1. Omrekenen  2. Op het rooster  3. Binnen de band van de productsoort
    const raw = roundTo95(Number(v.price || 0) * rate);
    let price = raw;
    if (price < band[0]) price = band[0];
    if (price > band[1]) price = band[1];
    if (price !== raw) clampedCount++;
    // 3. Doorstreepprijs berekend vanaf de AFGERONDE prijs → bij 50% exact het dubbele
    let compareAt = null;
    if (discountPct > 0 && price > 0) {
      compareAt = round2(price / (1 - discountPct / 100));
    }
    return {
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      price: price.toFixed(2),
      compare_at_price: compareAt ? compareAt.toFixed(2) : null,
      sku: v.sku || "",
      grams: v.grams || 0,
      inventory_management: null, // niet voorraad-tracken bij import
      requires_shipping: true,
    };
  });

  /* ----------------------------------------------------------------
     Branding-check op ALLE foto's vóór upload (GMC-bescherming):
     foto's met concurrent-logo's, watermerken, verpakkingen of
     tekst-overlays gaan er streng uit. Zonder schone foto's wordt
     het product geweigerd. Faalt de check zelf (API-storing), dan
     gaat de import door maar met een expliciete waarschuwing.
  ---------------------------------------------------------------- */
  const allImages = product.images || [];
  let keptImages = allImages;
  let brandingRemoved = [];
  let imageCheckFailed = false;
  let brandingAi = null; // token-/kostenverbruik van de branding-check (voor de log)
  try {
    const items = allImages
      .map((im, i) => ({ index: i, url: im && im.src }))
      .filter((x) => typeof x.url === "string" && /^https?:\/\//.test(x.url))
      .slice(0, 20);
    if (items.length) {
      const check = await flagBrandedImages(items);
      brandingAi = check.ai;
      const flags = check.remove;
      if (flags.length) {
        const bad = new Set(flags.map((f) => f.index));
        const kept = allImages.filter((_, i) => !bad.has(i));
        brandingRemoved = flags.map((f) => f.reason || "branding");
        if (!kept.length) {
          return NextResponse.json(
            {
              error:
                "Alle foto's van dit product bevatten concurrent-branding (logo's/watermerk/verpakking) — niet geïmporteerd, GMC-risico.",
            },
            { status: 422 }
          );
        }
        keptImages = kept;
      }
    }
  } catch {
    imageCheckFailed = true;
  }

  const images = keptImages.map((im, i) => ({
    src: im.src,
    alt: im.alt || listing.title,
    position: i + 1,
  }));

  /* ----------------------------------------------------------------
     Collectie bepalen: expliciet meegegeven (s.collection) of afgeleid
     uit het keyword via dezelfde blauwdruk als de verdeel-engine.
     De collectie-titel wordt als tag toegevoegd; ensureSmartCollection
     maakt (eenmalig) de smart collection met tag-regel aan, waardoor
     het product er automatisch in valt.
  ---------------------------------------------------------------- */
  let collectionTitle = String(s.collection || "").trim();
  if (!collectionTitle && s.keyword) {
    const kw = String(s.keyword).toLowerCase().trim();
    const probe = s.forceMens ? `mens ${kw}` : kw;
    const hit = collectionFor(probe);
    if (hit && hit.col) collectionTitle = hit.col;
  }

  /* Geslacht bepalen: sheet-kolom → collectienaam → AI-detectie → forceMens.
     Levert zowel een tweede collectie-tag (Men/Women) als het juiste
     thema-template op. */
  const genderRaw = String(s.gender || "").toLowerCase();
  const isMen =
    Boolean(s.forceMens) ||
    genderRaw === "man" ||
    genderRaw === "men" ||
    /^men'?s\b/i.test(collectionTitle) ||
    (!genderRaw && String(s.detectedGender || "").toLowerCase() === "men");
  const genderTag = isMen ? "Men" : "Women";

  const tagList = String(s.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const addTag = (t) => {
    if (t && !tagList.some((x) => x.toLowerCase() === t.toLowerCase())) tagList.push(t);
  };
  // Elke tag = één smart collection. Een product mag in meerdere collecties:
  // de keyword-collectie (Boots) én de geslachts-collectie (Men/Women).
  addTag(collectionTitle);
  if (s.genderCollections !== false) addTag(genderTag);

  const collectionInfos = [];
  const wanted = [collectionTitle, s.genderCollections !== false ? genderTag : ""].filter(Boolean);
  for (const title of wanted) {
    try {
      const c = await ensureSmartCollection(store, title);
      if (c.ok) collectionInfos.push({ title, created: !c.existed });
    } catch {
      /* collectie is nice-to-have; de tag staat er sowieso op */
    }
  }
  const collectionInfo = collectionInfos[0] || null;

  const payload = {
    title: listing.title,
    body_html: listing.descriptionHtml,
    vendor: s.vendor || "",
    product_type: product.productType || "",
    status: s.status === "active" ? "active" : "draft",
    tags: tagList.join(", "),
    options: options.length ? options : undefined,
    variants: variants.length ? variants : undefined,
    images: images.length ? images : undefined,
    // Shopify koppelt templates NIET automatisch op tag — dat moet per
    // product. Herenproducten krijgen hier dus zelf het men-template.
    template_suffix:
      s.themeTemplate === "men" ? "men" : isMen ? s.menTemplate || "men" : null,
  };

  const r = await createProduct(store, payload);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
  const created = r.product;

  /* ----------------------------------------------------------------
     Variant-foto's koppelen (kleur → juiste afbeelding).
     Bron: variant.imageId verwijst naar image.id in de bron-store.
     Wij stuurden de afbeeldingen in dezelfde volgorde door, dus
     bron-afbeelding[i] === aangemaakte afbeelding[i].
  ---------------------------------------------------------------- */
  let linkedImages = 0;
  try {
    // Let op: koppeling loopt over de GEHOUDEN foto's — created.images[i]
    // correspondeert met keptImages[i] (zelfde volgorde doorgestuurd).
    const srcImages = keptImages;
    const srcVariants = product.variants || [];

    // bron image-id → index in de lijst
    const srcImgIndex = new Map();
    srcImages.forEach((im, i) => {
      if (im.id != null) srcImgIndex.set(String(im.id), i);
    });

    // aangemaakte variant terugvinden op optie-combinatie
    const keyOf = (v) => [v.option1, v.option2, v.option3].map((x) => x ?? "").join("|||");
    const createdByKey = new Map();
    for (const cv of created.variants || []) createdByKey.set(keyOf(cv), cv.id);

    // per bron-afbeelding: welke aangemaakte variant-IDs horen erbij
    const wanted = new Map(); // created image id → [created variant ids]
    for (const sv of srcVariants) {
      if (sv.imageId == null) continue;
      const imgIdx = srcImgIndex.get(String(sv.imageId));
      if (imgIdx == null) continue;
      const createdImg = (created.images || [])[imgIdx];
      const createdVarId = createdByKey.get(keyOf(sv));
      if (!createdImg || !createdVarId) continue;
      if (!wanted.has(createdImg.id)) wanted.set(createdImg.id, []);
      wanted.get(createdImg.id).push(createdVarId);
    }

    const jobs = [];
    for (const [imgId, varIds] of wanted) {
      jobs.push(
        setImageVariants(store, created.id, imgId, varIds).then((res) => {
          if (res.ok) linkedImages++;
        })
      );
    }
    await Promise.all(jobs);
  } catch {
    /* koppeling is nice-to-have; import zelf is al gelukt */
  }

  /* ----------------------------------------------------------------
     Afbeeldings-placeholders in de omschrijving vervangen door
     onze EIGEN Shopify-CDN-URLs (nooit hotlinken naar de bron).
  ---------------------------------------------------------------- */
  try {
    const html = String(listing.descriptionHtml || "");
    if (html.includes("{{IMAGE_")) {
      const imgs = created.images || [];
      const pick = (n) => imgs[n] || imgs[imgs.length - 1] || null;
      const tag = (im) =>
        im
          ? `<img src="${im.src}" alt="" width="350" style="max-width:100%;height:auto;">`
          : "";
      const newHtml = html
        .replace(/\{\{IMAGE_1\}\}/g, tag(pick(1) || pick(0)))
        .replace(/\{\{IMAGE_2\}\}/g, tag(pick(2) || pick(0)))
        // overgebleven placeholders (geen foto's) netjes weghalen
        .replace(/<p[^>]*>\s*\{\{IMAGE_\d\}\}\s*<\/p>/g, "")
        .replace(/\{\{IMAGE_\d\}\}/g, "");
      if (newHtml !== html) {
        await updateProduct(store, created.id, { body_html: newHtml });
      }
    }
  } catch {
    /* idem — geen showstopper */
  }

  // Preview-link (werkt ook voor drafts) — handig voor de import-log & QA
  /* Productcategorie automatisch zetten — geen "Suggested"-klikwerk meer.
     Best effort: een mislukte categorie houdt de import nooit tegen. */
  let categorySet = "";
  let categoryWarn = "";
  try {
    const taxTerm = TYPE_TAXONOMY[priceType];
    if (taxTerm) {
      const node = await findTaxonomyCategory(store, taxTerm);
      if (node) {
        const setRes = await setProductCategory(store, created.id, node.id, taxTerm);
        if (setRes.ok) categorySet = setRes.fullName || node.fullName;
        else categoryWarn = setRes.error || "zetten mislukt";
      } else {
        categoryWarn = `geen exacte taxonomie-match voor "${taxTerm}" — categorie leeg gelaten (handmatig zetten)`;
      }
    } else {
      categoryWarn = `onbekend producttype "${priceType}" — categorie leeg gelaten`;
    }
  } catch (e) {
    categoryWarn = String(e.message || e);
  }

  let previewUrl = null;
  try {
    previewUrl = await getPreviewUrl(store, created.id);
  } catch {}

  return NextResponse.json({
    ok: true,
    category: categorySet,
    categoryWarn,
    pricing: {
      originCountry: CUR_LAND[srcCur] || srcCur,
      originCurrency: srcCur,
      sourcePrice: srcPrice ? srcPrice.toFixed(2) : "",
      rate: rate ? Number(rate).toFixed(4) : "1",
      finalPrice: variants.length ? variants[0].price : "",
      band: `${priceType} $${band[0]}–$${band[1]}`,
      clamped: clampedCount,
    },
    product: {
      id: created.id,
      title: created.title,
      handle: created.handle,
      status: created.status,
      adminUrl: created.adminUrl,
      previewUrl,
    },
    linkedImages,
    collection: collectionInfo ? collectionInfo.title : null,
    collectionCreated: collectionInfo ? collectionInfo.created : false,
    collections: collectionInfos,
    tags: tagList,
    gender: genderTag,
    templateSuffix: payload.template_suffix || null,
    brandingRemoved: brandingRemoved.length,
    brandingReasons: [...new Set(brandingRemoved)],
    brandingAi,
    imageCheckFailed,
  });
}
