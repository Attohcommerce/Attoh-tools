// Shopify Admin API helpers.
//
// Twee manieren om te authenticeren, beide ondersteund:
//  1. Vaste Admin API access token (shpat_…) — oude custom apps, gemaakt vóór 1-1-2026.
//  2. Client ID + client secret — apps uit het Dev Dashboard. Shopify geeft dan een
//     token dat na 24 uur verloopt, dus we halen er zelf steeds een verse op en
//     cachen die server-side.
//
// Credentials komen per request mee vanuit de client (stores staan in de browser);
// ze gaan alleen via onze eigen server naar Shopify, nooit rechtstreeks.

const API_VERSION = "2024-07";

export function cleanDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export function adminBase(domain) {
  return `https://${cleanDomain(domain)}/admin/api/${API_VERSION}`;
}

/* ---------- Token cache (client credentials grant) ---------- */

const tokenCache = new Map(); // key: domain|clientId  →  { token, expiresAt }

export async function mintToken(domain, clientId, clientSecret) {
  const d = cleanDomain(domain);
  const key = `${d}|${clientId}`;
  const hit = tokenCache.get(key);
  // 5 minuten marge zodat we nooit met een net-verlopen token aankloppen
  if (hit && hit.expiresAt - 5 * 60 * 1000 > Date.now()) {
    return { ok: true, token: hit.token };
  }

  let res;
  try {
    res = await fetch(`https://${d}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (e) {
    return { ok: false, error: `Kan ${d} niet bereiken: ${e.message}` };
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok || !data || !data.access_token) {
    const detail =
      (data && (data.error_description || data.error)) || `HTTP ${res.status}`;
    return {
      ok: false,
      error: `Token ophalen mislukt (${detail}). Controleer domein, client ID en client secret, en of de app op deze store geïnstalleerd is.`,
    };
  }

  const ttl = Number(data.expires_in || 86399) * 1000;
  tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + ttl });
  return { ok: true, token: data.access_token, scope: data.scope };
}

/**
 * Geeft een bruikbaar access token terug voor een store-object uit de app.
 * store = { domain, token? , clientId?, clientSecret? }
 */
export async function resolveToken(store) {
  if (!store || !store.domain) {
    return { ok: false, error: "Geen store opgegeven" };
  }
  if (store.token) return { ok: true, token: store.token };
  if (store.clientId && store.clientSecret) {
    return mintToken(store.domain, store.clientId, store.clientSecret);
  }
  return {
    ok: false,
    error:
      "Deze store heeft geen geldige koppeling — vul een Admin API token in, of client ID + client secret.",
  };
}

/* ---------- Requests ---------- */

export async function shopifyRequest(domain, token, path, method = "GET", body) {
  /* RETRY OP 429/5xx: bij bulk-runs (100-300 producten) deelt Shopify rate
     limits uit; zonder retry vielen juist de NABEWERKINGS-stappen (variant-
     foto's koppelen) stilletjes weg — dé oorzaak van varianten zonder foto
     die later in GMC worden afgekeurd. Max 3 pogingen, wachttijd uit de
     Retry-After-header (of oplopend 1s/2s). */
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${adminBase(domain)}${path}`, {
        method,
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      return { ok: false, status: 0, error: `Netwerkfout: ${e.message}` };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const ra = Number(res.headers.get("retry-after")) || 0;
      const waitMs = ra > 0 ? ra * 1000 : 1000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 8000)));
      continue;
    }
    break;
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    let msg;
    if (data && (data.errors || data.error)) {
      msg =
        typeof (data.errors || data.error) === "string"
          ? data.errors || data.error
          : JSON.stringify(data.errors || data.error);
    } else {
      msg = `HTTP ${res.status}`;
    }
    if (res.status === 401 || res.status === 403) {
      msg += " — token ongeldig of scopes ontbreken (write_products nodig).";
    }
    return { ok: false, status: res.status, error: msg };
  }
  return { ok: true, data };
}

/** Zelfde als shopifyRequest, maar regelt zelf het token voor een store-object. */
export async function storeRequest(store, path, method = "GET", body) {
  const t = await resolveToken(store);
  if (!t.ok) return { ok: false, status: 401, error: t.error };
  return shopifyRequest(store.domain, t.token, path, method, body);
}

/* ---------- GraphQL (voor functies die REST niet heeft) ---------- */

export async function storeGraphql(store, query, variables) {
  const t = await resolveToken(store);
  if (!t.ok) return { ok: false, error: t.error };
  try {
    const res = await fetch(`${adminBase(store.domain)}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": t.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.errors) {
      return { ok: false, error: data && data.errors ? JSON.stringify(data.errors).slice(0, 300) : `HTTP ${res.status}` };
    }
    return { ok: true, data: data.data };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/* PRODUCTCATEGORIE (Shopify's Standard Product Taxonomy). De "Suggested"-
   knop in de admin is een handmatige actie — wij zetten de categorie
   DIRECT, op basis van onze eigen product-kennis (het keyword-type). De
   taxonomie-node wordt per zoekterm één keer opgezocht en gecachet. */
const taxonomyCache = new Map(); // zoekterm → { id, fullName } | null

export async function findTaxonomyCategory(store, searchTerm) {
  const key = searchTerm.toLowerCase();
  if (taxonomyCache.has(key)) return taxonomyCache.get(key);
  const q = `query($s: String!) {
    taxonomy { categories(first: 10, search: $s) { nodes { id fullName isLeaf } } }
  }`;
  const r = await storeGraphql(store, q, { s: searchTerm });
  let best = null;
  if (r.ok && r.data && r.data.taxonomy && r.data.taxonomy.categories) {
    const nodes = r.data.taxonomy.categories.nodes || [];
    /* Keuzeregels, geleerd van een misser: "Sweaters" matchte óók
       "Sweaters in Baby & Children's Tops" en die won. Dus:
       1. NOOIT baby/kinder-takken — dit zijn volwassen-stores.
       2. Alleen Apparel & Accessories.
       3. Laatste pad-segment moet exact de zoekterm zijn ("... > Sweaters").
       4. Bij meerdere kandidaten wint het kortste pad (de hoofdtak). */
    const KIDS_RE = /baby|toddler|children|kids|infant|boys'|girls'|nursing/i;
    const cand = nodes.filter(
      (n) =>
        /^Apparel & Accessories/.test(n.fullName || "") &&
        !KIDS_RE.test(n.fullName || "")
    );
    const exact = cand.filter((n) => {
      const parts = String(n.fullName || "").split(" > ");
      return parts[parts.length - 1].toLowerCase() === searchTerm.toLowerCase();
    });
    /* LIEVER LEEG DAN FOUT: alleen een kandidaat waarvan het laatste
       pad-segment exact de zoekterm is komt in aanmerking. Geen exacte
       match = geen categorie + een melding, nooit een "beste gok" — een
       lege categorie is herstelbaar, een foute is onzichtbaar. */
    const pool = exact.filter((n) => n.isLeaf !== false);
    pool.sort((a, b) => String(a.fullName).length - String(b.fullName).length);
    best = pool[0] || exact[0] || null;
    if (best) best = { id: best.id, fullName: best.fullName };
  }
  taxonomyCache.set(key, best);
  return best;
}

const CATEGORY_KIDS_RE = /baby|toddler|children|kids|infant|boys'|girls'|nursing/i;

export async function setProductCategory(store, productId, categoryId, expectTerm) {
  const m = `mutation($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id category { id fullName } }
      userErrors { field message }
    }
  }`;
  const gid = `gid://shopify/Product/${productId}`;
  const r = await storeGraphql(store, m, { input: { id: gid, category: categoryId } });
  if (!r.ok) return { ok: false, error: r.error };
  const errs = r.data && r.data.productUpdate && r.data.productUpdate.userErrors;
  if (errs && errs.length) return { ok: false, error: errs.map((e) => e.message).join("; ") };
  const cat = r.data && r.data.productUpdate && r.data.productUpdate.product && r.data.productUpdate.product.category;
  const fullName = cat ? cat.fullName : "";

  /* VERIFICATIE NA SCHRIJVEN: wat er nu op het product staat moet (a) geen
     kinder-tak zijn en (b) eindigen op het verwachte type. Klopt dat niet,
     dan wordt de categorie direct teruggedraaid — een product zonder
     categorie is een taakje, een product in de baby-tak is een tijdbom. */
  const wrongBranch = CATEGORY_KIDS_RE.test(fullName);
  const wrongType =
    expectTerm && fullName &&
    fullName.split(" > ").pop().toLowerCase() !== String(expectTerm).toLowerCase();
  if (wrongBranch || wrongType) {
    await storeGraphql(store, m, { input: { id: gid, category: null } }).catch(() => {});
    return {
      ok: false,
      error: `verificatie na schrijven faalde ("${fullName}") — categorie teruggedraaid`,
    };
  }
  return { ok: true, fullName };
}

/* ---------- Endpoints ---------- */

export async function getShopInfo(store) {
  const r = await storeRequest(store, "/shop.json");
  if (!r.ok) return r;
  const shop = r.data && r.data.shop;
  if (!shop) return { ok: false, error: "Onverwacht antwoord van Shopify" };
  return {
    ok: true,
    shop: {
      name: shop.name,
      currency: shop.currency,
      domain: shop.domain,
      myshopifyDomain: shop.myshopify_domain,
    },
  };
}

export async function createProduct(store, productPayload) {
  const r = await storeRequest(store, "/products.json", "POST", {
    product: productPayload,
  });
  if (!r.ok) return r;
  const p = r.data.product;
  const d = cleanDomain(store.domain);
  return {
    ok: true,
    product: {
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      adminUrl: `https://${d}/admin/products/${p.id}`,
      // Volledige data voor nabewerking (variant-foto's koppelen, body bijwerken)
      variants: (p.variants || []).map((v) => ({
        id: v.id,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
      })),
      images: (p.images || []).map((im) => ({
        id: im.id,
        src: im.src,
        position: im.position,
      })),
    },
  };
}

/** Preview-link van een product (werkt óók voor drafts) via de GraphQL-API. */
export async function getPreviewUrl(store, productId) {
  const r = await storeRequest(store, "/graphql.json", "POST", {
    query: `{ product(id: "gid://shopify/Product/${productId}") { onlineStorePreviewUrl } }`,
  });
  if (!r.ok) return null;
  try {
    return r.data.data.product.onlineStorePreviewUrl || null;
  } catch {
    return null;
  }
}

/** Koppel een productafbeelding aan variant-IDs (kleurfoto's). */
export async function setImageVariants(store, productId, imageId, variantIds) {
  return storeRequest(store, `/products/${productId}/images/${imageId}.json`, "PUT", {
    image: { id: imageId, variant_ids: variantIds },
  });
}

/** Eén product vers ophalen (voor verify-passes en fixes). */
export async function getProductRaw(store, productId, fields) {
  const f = fields ? `?fields=${encodeURIComponent(fields)}` : "";
  const r = await storeRequest(store, `/products/${productId}.json${f}`);
  if (!r.ok) return r;
  return { ok: true, product: r.data.product };
}

/** Meerdere producten in één call ophalen op ID (max ±50 per keer). */
export async function listProductsByIds(store, ids, fields) {
  const idPart = (ids || []).map((i) => String(i)).join(",");
  if (!idPart) return { ok: true, products: [] };
  const f = fields ? `&fields=${encodeURIComponent(fields)}` : "";
  const r = await storeRequest(store, `/products.json?ids=${idPart}&limit=250${f}`);
  if (!r.ok) return r;
  return { ok: true, products: r.data.products || [] };
}

/** Verwijder één variant van een product. */
export async function deleteVariant(store, productId, variantId) {
  return storeRequest(store, `/products/${productId}/variants/${variantId}.json`, "DELETE");
}

/** Verwijder één productafbeelding. */
export async function deleteProductImage(store, productId, imageId) {
  return storeRequest(store, `/products/${productId}/images/${imageId}.json`, "DELETE");
}

/** Verwijder een heel product (alleen via de Store Doctor, na bevestiging). */
export async function deleteProductById(store, productId) {
  return storeRequest(store, `/products/${productId}.json`, "DELETE");
}

/** Werk velden van een bestaand product bij (bijv. body_html). */
export async function updateProduct(store, productId, fields) {
  return storeRequest(store, `/products/${productId}.json`, "PUT", {
    product: { id: productId, ...fields },
  });
}

/**
 * Alle producten van een store ophalen (gepagineerd via Link-header).
 * max = veiligheidsgrens zodat we nooit eindeloos doorlopen.
 */
export async function listProducts(store, max = 1000, opts = {}) {
  const t = await resolveToken(store);
  if (!t.ok) return { ok: false, error: t.error };
  const out = [];
  const fields =
    opts.fields ||
    "id,title,handle,body_html,tags,status,template_suffix,product_type,vendor,images,variants,options,published_at,created_at";
  // createdAtMin: alleen producten van ná dit tijdstip (voor "controleer
  // alleen deze import-run" in de Store Doctor).
  const since = opts.createdAtMin
    ? `&created_at_min=${encodeURIComponent(opts.createdAtMin)}`
    : "";
  let url = `${adminBase(store.domain)}/products.json?limit=250&fields=${encodeURIComponent(fields)}${since}`;
  for (let page = 0; page < 20 && url && out.length < max; page++) {
    let res;
    try {
      res = await fetch(url, { headers: { "X-Shopify-Access-Token": t.token } });
    } catch (e) {
      return { ok: false, error: `Netwerkfout: ${e.message}` };
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} bij het ophalen van producten` };
    }
    const data = await res.json().catch(() => ({}));
    out.push(...(data.products || []));
    // volgende pagina uit de Link-header
    const link = res.headers.get("link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return { ok: true, products: out.slice(0, max) };
}

/* ---------- Smart collections (tag-gestuurd) ---------- */

// Cache zodat een batch van 50 producten niet 50× dezelfde lookup doet.
const collectionCache = new Map(); // domain|title(lowercase) → id

/**
 * Zorgt dat er een smart collection bestaat met deze titel, met als regel
 * "product tag is gelijk aan <titel>". Elke geïmporteerde tag = collectie:
 * producten met de tag vallen er automatisch in. Geeft {id, existed} terug.
 */
export async function ensureSmartCollection(store, title) {
  const clean = String(title || "").trim();
  if (!clean) return { ok: false, error: "Geen collectie-titel" };
  const key = `${cleanDomain(store.domain)}|${clean.toLowerCase()}`;
  const hit = collectionCache.get(key);
  if (hit) return { ok: true, id: hit, existed: true };

  // Bestaat hij al?
  const q = await storeRequest(
    store,
    `/smart_collections.json?title=${encodeURIComponent(clean)}&limit=250`
  );
  if (q.ok) {
    const found = (q.data.smart_collections || []).find(
      (c) => String(c.title).toLowerCase() === clean.toLowerCase()
    );
    if (found) {
      collectionCache.set(key, found.id);
      return { ok: true, id: found.id, existed: true };
    }
  }

  // Nieuw aanmaken: tag-regel, gepubliceerd
  const r = await storeRequest(store, "/smart_collections.json", "POST", {
    smart_collection: {
      title: clean,
      rules: [{ column: "tag", relation: "equals", condition: clean }],
      disjunctive: false,
      published: true,
    },
  });
  if (!r.ok) return r;
  const id = r.data.smart_collection.id;
  collectionCache.set(key, id);
  return { ok: true, id, existed: false };
}
