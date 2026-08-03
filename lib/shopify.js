// Shopify Admin API helpers — token komt per request mee vanuit de client
// (stores worden in de browser bewaard; tokens gaan alleen via onze server naar Shopify).

const API_VERSION = "2024-07";

export function adminBase(domain) {
  let d = String(domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return `https://${d}/admin/api/${API_VERSION}`;
}

export async function shopifyRequest(domain, token, path, method = "GET", body) {
  const res = await fetch(`${adminBase(domain)}${path}`, {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (data && (data.errors || data.error)) ? JSON.stringify(data.errors || data.error) : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: msg };
  }
  return { ok: true, data };
}

export async function getShopInfo(domain, token) {
  const r = await shopifyRequest(domain, token, "/shop.json");
  if (!r.ok) return r;
  return {
    ok: true,
    shop: {
      name: r.data.shop.name,
      currency: r.data.shop.currency,
      domain: r.data.shop.domain,
      myshopifyDomain: r.data.shop.myshopify_domain,
    },
  };
}

export async function createProduct(domain, token, productPayload) {
  const r = await shopifyRequest(domain, token, "/products.json", "POST", {
    product: productPayload,
  });
  if (!r.ok) return r;
  const p = r.data.product;
  return {
    ok: true,
    product: {
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      adminUrl: `https://${domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/admin/products/${p.id}`,
    },
  };
}
