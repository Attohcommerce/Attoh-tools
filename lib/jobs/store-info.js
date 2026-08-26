import { fetchWithRetry, shopifyProducts } from "./_helpers";

// Snelle domein-scan: leeft de store, is het Shopify, hoeveel producten/collecties, welke valuta.

const job = {
  id: "store-info",
  naam: "Store-info scan",
  uitleg: "Per domein: online, Shopify ja/nee, aantal producten en collecties, valuta.",
  inputLabel: "Domeinen (één per regel — Excel-kolom plakken mag)",
  placeholder: "juliaraven.com\nhttps://www.voorbeeld.com/\n…",
  kolommen: ["Domein", "Status", "Shopify", "Producten", "Collecties", "Valuta", "Notitie"],
  concurrency: 6,

  async run(domain) {
    const notes = [];
    let status = "Online";
    let shopify = "Nee";
    let count = "";
    let collecties = "";
    let valuta = "";

    const p = await shopifyProducts(domain, 250);
    if (p.ok) {
      shopify = "Ja";
      count = p.products.length >= 250 ? "250+" : String(p.products.length);
    } else if (p.status === 401 || p.status === 403 || p.status === 430) {
      shopify = "Ja";
      notes.push("products.json afgeschermd");
    } else if (p.status !== "onbereikbaar") {
      notes.push("products.json: " + p.status);
    }

    try {
      const res = await fetchWithRetry(`https://${domain}/`);
      if (!res.ok) {
        status = "Probleem (HTTP " + res.status + ")";
      } else {
        const html = await res.text();
        const m =
          html.match(/Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/) ||
          html.match(/"currency":\s*"([A-Z]{3})"/) ||
          html.match(/cart_currency['"]?\s*[:=]\s*['"]([A-Z]{3})/);
        if (m) valuta = m[1];
        if (shopify === "Nee" && /cdn\.shopify|myshopify\.com/i.test(html)) {
          shopify = "Ja";
          notes.push("herkend via HTML");
        }
      }
    } catch (e) {
      if (p.ok) {
        notes.push("homepage: " + String((e && e.message) || e));
      } else {
        return {
          Domein: domain,
          Status: "Offline",
          Shopify: "",
          Producten: "",
          Collecties: "",
          Valuta: "",
          Notitie: String((e && e.message) || e),
        };
      }
    }

    if (shopify === "Ja") {
      try {
        const c = await fetchWithRetry(`https://${domain}/collections.json?limit=250`);
        if (c.ok) {
          const d = await c.json();
          if (Array.isArray(d && d.collections)) {
            collecties = d.collections.length >= 250 ? "250+" : String(d.collections.length);
          }
        }
      } catch {
        /* niet kritisch */
      }
    }

    return {
      Domein: domain,
      Status: status,
      Shopify: shopify,
      Producten: count,
      Collecties: collecties,
      Valuta: valuta,
      Notitie: notes.join(" · "),
    };
  },
};

export default job;
