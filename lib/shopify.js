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
  let res;
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

/** Koppel een productafbeelding aan variant-IDs (kleurfoto's). */
export async function setImageVariants(store, productId, imageId, variantIds) {
  return storeRequest(store, `/products/${productId}/images/${imageId}.json`, "PUT", {
    image: { id: imageId, variant_ids: variantIds },
  });
}

/** Werk velden van een bestaand product bij (bijv. body_html). */
export async function updateProduct(store, productId, fields) {
  return storeRequest(store, `/products/${productId}.json`, "PUT", {
    product: { id: productId, ...fields },
  });
}
