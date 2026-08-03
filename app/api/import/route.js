import { NextResponse } from "next/server";
import { createProduct } from "@/lib/shopify";

export const maxDuration = 60;

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { store, product, listing, settings, fx } = body;
  // store: {domain, token}  product: gescrapete bron  listing: {title, descriptionHtml}
  // settings: {discountPct, status, tags, colorLabel, sizeLabel, themeTemplate, manualRate}
  // fx: {rate} — bron-valuta → store-valuta (1 als gelijk/onbekend)

  if (!store || !store.domain || !store.token) {
    return NextResponse.json({ error: "Geen store geselecteerd" }, { status: 400 });
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
    const base = round2(Number(v.price || 0) * rate);
    let compareAt = null;
    if (discountPct > 0 && base > 0) {
      compareAt = round2(base / (1 - discountPct / 100));
    }
    return {
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      price: base.toFixed(2),
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

  const payload = {
    title: listing.title,
    body_html: listing.descriptionHtml,
    vendor: s.vendor || "",
    product_type: product.productType || "",
    status: s.status === "active" ? "active" : "draft",
    tags: s.tags || "",
    options: options.length ? options : undefined,
    variants: variants.length ? variants : undefined,
    images: images.length ? images : undefined,
    template_suffix: s.themeTemplate === "men" ? "men" : null,
  };

  const r = await createProduct(store.domain, store.token, payload);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
  return NextResponse.json({ ok: true, product: r.product });
}
