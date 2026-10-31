import { NextResponse } from "next/server";
import { listProducts, listProductMetafieldValues, listProductCategories } from "@/lib/shopify";
import { runDoctor, scanThemeSizeGuide } from "@/lib/doctor";
import { resolveCategory, listCategoryAttrKeys } from "@/lib/category-attrs";
import { SG_NS, SG_KEY } from "@/lib/sizeguide";
import { storeGendersOf, storeShoeLabelsOf } from "@/lib/store-gender";
import { latestProductIds, productsByIdsFull, doctorExtrasByIds, LATEST_MAX } from "@/lib/doctor-latest";
import { isShapesWardrobe } from "@/lib/sw-product-types";

export const maxDuration = 120;

// STORE DOCTOR — scan. Haalt de producten op (heel de store, alleen alles
// van ná `sinceISO` = de lopende import-run, of — 19-10 — de `latest`
// nieuwste producten, actief + draft, max 1000) en draait alle gratis
// deterministische checks. AI-checks lopen apart via /api/doctor-ai.
export async function POST(req) {
  const { store, max, sinceISO, latest, vendorName, market, bareSystem, sizeGuides } = await req.json().catch(() => ({}));
  // Sa Collective (lib/org.js, 20-10): maattabellen helemaal buiten de Doctor —
  // metafield niet ophalen, checks "Geen maattabel"/"past niet" niet draaien.
  const skipGuides = sizeGuides === false;
  if (!store || !store.domain) {
    return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  }
  try {
    const latestN = !sinceISO && Number(latest) > 0 ? Math.min(LATEST_MAX, Math.round(Number(latest))) : 0;
    let products;
    let scope = { mode: sinceISO ? "run" : "all" };
    let guides = null;
    let categories = null;
    let byIdExtras = null;
    if (latestN) {
      const li = await latestProductIds(store, latestN);
      if (!li.ok) return NextResponse.json({ error: li.error }, { status: 422 });
      if (!li.ids.length) return NextResponse.json({ error: "Geen actieve of draft-producten gevonden" }, { status: 422 });
      const pr = await productsByIdsFull(store, li.ids);
      if (!pr.ok) return NextResponse.json({ error: pr.error }, { status: 422 });
      products = pr.products;
      scope = { mode: "latest", requested: latestN, found: products.length, refetched: pr.refetched, notFound: pr.notFound };
      // maattabel / categorie / category-metafields precies voor deze ID's
      byIdExtras = await doctorExtrasByIds(store, products.map((p) => String(p.id)), { namespace: SG_NS, key: SG_KEY, skipGuides });
      guides = skipGuides ? null : byIdExtras.guides;
      categories = byIdExtras.categories;
    } else {
      const r = await listProducts(store, Number(max) || 1000, {
        createdAtMin: sinceISO || null,
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      products = r.products || [];
    }
    if (!products.length) {
      return NextResponse.json(
        { error: sinceISO ? "Geen producten gevonden binnen deze run (created_at-filter)" : "Deze store heeft (nog) geen producten" },
        { status: 422 }
      );
    }

    if (!byIdExtras) {
      // Maattabellen (metafield custom.size_guide) — één GraphQL-loop, 250 per pagina
      if (skipGuides) {
        guides = null;
      } else {
        try {
          const mf = await listProductMetafieldValues(store, { namespace: SG_NS, key: SG_KEY });
          guides = mf.ok ? mf.values : {};
        } catch {
          guides = {};
        }
      }

      // Productcategorie (taxonomie) — niet in de REST-data; mislukt = check overslaan
      try {
        const c = await listProductCategories(store, { max: Number(max) || 1000 });
        categories = c.ok ? c.values : null;
      } catch {
        categories = null;
      }
    }

    /* 16-10: fijnste categorie per product (Shorts → Denim Shorts) +
       welke category-metafields er al staan. Eén taxonomie-call per
       hoofdcategorie (gecachet), metafields 100 producten per call. */
    let refinedCategories = null;
    let attrKeys = null;
    if (categories) {
      try {
        refinedCategories = {};
        for (const p of products) {
          const rc = await resolveCategory(store, p);
          if (rc) refinedCategories[String(p.id)] = rc;
        }
      } catch {
        refinedCategories = null;
      }
      if (byIdExtras) {
        attrKeys = byIdExtras.attrKeys;
      } else {
        try {
          const ak = await listCategoryAttrKeys(store, { max: Number(max) || 1000 });
          attrKeys = ak.ok ? ak.values : null;
        } catch {
          attrKeys = null;
        }
      }
    }

    const storeGenders = await storeGendersOf(store);
    const shoeLabels = await storeShoeLabelsOf(store); // SSB: "us-eu"
    const result = runDoctor(products, {
      vendorName: vendorName || store.name || "",
      menTemplate: "men",
      market: market || "",
      bareSystem: bareSystem || "",
      guides,
      categories,
      refinedCategories,
      attrKeys,
      storeGenders,
      shoeLabels,
      // Shapes Wardrobe: producttype moet uit de lijst van Cas komen (23-10)
      swTypes: isShapesWardrobe(store),
    });

    /* 31-10: maattabel-snippet in het live thema — rondt die nog af op 1 decimaal?
       (thema-breed, dus één finding; mislukt/geen scope = check overgeslagen) */
    if (!skipGuides) {
      const withGuide = products.find((p) => guides && guides[String(p.id)]) || products[0];
      const tf = await scanThemeSizeGuide(store, withGuide && withGuide.id).catch(() => null);
      if (tf) {
        result.findings.push(tf);
        const order = { error: 0, warn: 1 };
        result.findings.sort((a, b) => order[a.level] - order[b.level] || b.count - a.count);
      }
    }

    return NextResponse.json({
      ok: true,
      ...result,
      scanned: products.length,
      scope,
      sizeGuides: !skipGuides,
      statusCount: {
        active: products.filter((p) => p.status === "active").length,
        draft: products.filter((p) => p.status === "draft").length,
      },
      // alle gescande ids — de AI-checks lopen hier client-side in stukken doorheen
      productIds: products.map((p) => p.id),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
