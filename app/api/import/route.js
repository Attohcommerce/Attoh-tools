import { NextResponse } from "next/server";
import {
  createProduct,
  setImageVariants,
  updateProduct,
  getPreviewUrl,
  ensureSmartCollection,
} from "@/lib/shopify";
import { collectionFor } from "@/lib/verdeling";

export const maxDuration = 60;

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Psychologische prijs: altijd NAAR BENEDEN afronden op .95.
 * 40.75 → 39.95 · 41.00 → 40.95 · 39.95 → 39.95 · 40.94 → 39.95
 */
function roundTo95(n) {
  if (!(n > 0)) return 0.95;
  const f = Math.floor(n);
  let out = n >= f + 0.95 ? f + 0.95 : f - 0.05;
  if (out < 0.95) out = 0.95;
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
  const discountPct = Number(s.discountPct || 0);

  // Opties hernoemen: Color/Colour + eigen Size-label
  const options = (product.options || []).map((o) => {
    let name = o.name;
    if (/^colou?r$/i.test(name)) name = s.colorLabel || "Color";
    if (/^size$/i.test(name)) name = s.sizeLabel || "Size";
    return { name };
  });

  const variants = (product.variants || []).map((v) => {
    // 1. Omrekenen naar store-valuta  2. ALTIJD afronden op .95 (naar beneden)
    const price = roundTo95(Number(v.price || 0) * rate);
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

  const images = (product.images || []).map((im, i) => ({
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

  const tagList = String(s.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (
    collectionTitle &&
    !tagList.some((t) => t.toLowerCase() === collectionTitle.toLowerCase())
  ) {
    tagList.push(collectionTitle);
  }

  let collectionInfo = null;
  if (collectionTitle) {
    try {
      const c = await ensureSmartCollection(store, collectionTitle);
      if (c.ok) {
        collectionInfo = { title: collectionTitle, created: !c.existed };
      }
    } catch {
      /* collectie is nice-to-have; de tag staat er sowieso op */
    }
  }

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
    template_suffix: s.themeTemplate === "men" ? "men" : null,
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
    const srcImages = product.images || [];
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
  let previewUrl = null;
  try {
    previewUrl = await getPreviewUrl(store, created.id);
  } catch {}

  return NextResponse.json({
    ok: true,
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
  });
}
