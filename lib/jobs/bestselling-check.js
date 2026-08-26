import { fetchWithRetry, shopifyProducts, extractHandles } from "./_helpers";

// Detectie: /collections/all in twee sorteringen ophalen en de productvolgorde vergelijken.
// Verschilt de volgorde -> de store respecteert sort_by=best-selling echt.
// Identiek -> het thema negeert de sortering. (products.json negeert sort_by altijd, vandaar HTML.)

const job = {
  id: "bestselling-check",
  naam: "Best-selling sortering",
  uitleg: "Houdt alleen stores over waar sort_by=best-selling echt werkt op /collections/all.",
  inputLabel: "Domeinen (één per regel — Excel-kolom plakken mag)",
  placeholder: "juliaraven.com\nhttps://www.voorbeeld.com/\n…",
  kolommen: ["Domein", "Shopify", "Producten", "Best-selling", "Notitie"],
  keepLabel: "Kopieer domeinen met best-selling = Ja",
  concurrency: 6,

  async run(domain) {
    const notes = [];
    let shopify = "Nee";
    let count = "";

    try {
      const p = await shopifyProducts(domain, 250);
      if (p.ok) {
        shopify = "Ja";
        count = p.products.length >= 250 ? "250+" : String(p.products.length);
      } else if (p.status === 401 || p.status === 403 || p.status === 430) {
        shopify = "Ja";
        notes.push("products.json afgeschermd");
      } else if (p.status === "onbereikbaar") {
        return {
          Domein: domain,
          Shopify: "",
          Producten: "",
          "Best-selling": "Offline / onbereikbaar",
          Notitie: p.detail || "",
          _keep: false,
        };
      } else {
        notes.push("products.json: " + p.status);
      }
    } catch (e) {
      notes.push("products.json: " + String((e && e.message) || e));
    }

    let verdict = "";
    let keep = false;
    try {
      const [a, b] = await Promise.all([
        fetchWithRetry(`https://${domain}/collections/all?sort_by=best-selling`),
        fetchWithRetry(`https://${domain}/collections/all?sort_by=title-ascending`),
      ]);
      if (!a.ok || !b.ok) {
        verdict = "Nee — /collections/all ontbreekt";
        notes.push(`HTTP ${a.status}/${b.status}`);
      } else {
        const ha = extractHandles(await a.text());
        const hb = extractHandles(await b.text());
        if (ha.length < 3) {
          verdict =
            shopify === "Ja"
              ? "Onbekend — thema rendert producten via JS"
              : "Geen Shopify";
        } else {
          const n = Math.min(ha.length, hb.length, 20);
          const same = ha.slice(0, n).join("|") === hb.slice(0, n).join("|");
          if (!same) {
            verdict = "Ja";
            keep = true;
          } else if (n <= 6) {
            verdict = "Twijfel — weinig producten, volgorde identiek";
          } else {
            verdict = "Nee — sortering wordt genegeerd";
          }
        }
      }
    } catch (e) {
      verdict = "Offline / onbereikbaar";
      notes.push(String((e && e.message) || e));
    }

    return {
      Domein: domain,
      Shopify: shopify,
      Producten: count,
      "Best-selling": verdict,
      Notitie: notes.join(" · "),
      _keep: keep,
    };
  },
};

export default job;
