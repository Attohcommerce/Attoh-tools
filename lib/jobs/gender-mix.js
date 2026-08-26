import { shopifyProducts } from "./_helpers";

// Man/vrouw-verdeling uit de eerste 250 producten (title + product_type + tags).
// Woordgrens-matching: \bmen\b matcht bewust NIET in "women".
// "dress" telt alleen als vrouwelijk signaal zonder heren-signaal en niet in
// dress shirt / dress pants / dress shoes.

const WOMEN_RE = /\b(women|womens|women's|woman|womenswear|female|ladies|lady|femme|dames|damen)\b/i;
const MEN_RE = /\b(men|mens|men's|man|menswear|male|guys?|gentlemen|homme|heren|herren)\b/i;
const FEMALE_TYPE_RE =
  /\b(dress(?!\s+(shirt|pant|shoe|sock))(es)?|gowns?|skirts?|blouses?|bras?|bikinis?|leggings|heels|stilettos?|camisoles?)\b/i;

const job = {
  id: "gender-mix",
  naam: "Man/vrouw-mix",
  uitleg: "Telt per store hoeveel producten dames, heren of beide zijn en geeft een verdict.",
  inputLabel: "Domeinen (één per regel — Excel-kolom plakken mag)",
  placeholder: "juliaraven.com\nhttps://www.voorbeeld.com/\n…",
  kolommen: ["Domein", "Producten", "Dames", "Heren", "Beide", "Onbekend", "% heren", "Verdict"],
  concurrency: 8,

  async run(domain) {
    const p = await shopifyProducts(domain, 250);
    if (!p.ok) {
      const why =
        p.status === 404
          ? "Geen Shopify"
          : p.status === "onbereikbaar"
            ? "Offline / onbereikbaar"
            : "Onbereikbaar (" + p.status + ")";
      return {
        Domein: domain,
        Producten: "",
        Dames: "",
        Heren: "",
        Beide: "",
        Onbekend: "",
        "% heren": "",
        Verdict: why,
      };
    }

    let W = 0,
      M = 0,
      B = 0,
      U = 0;
    for (const prod of p.products) {
      const tags = Array.isArray(prod.tags) ? prod.tags.join(" ") : String(prod.tags || "");
      const text = `${prod.title || ""} ${prod.product_type || ""} ${tags}`;
      const m = MEN_RE.test(text);
      const w = WOMEN_RE.test(text) || (!m && FEMALE_TYPE_RE.test(text));
      if (w && m) B++;
      else if (w) W++;
      else if (m) M++;
      else U++;
    }

    const total = p.products.length;
    const classified = W + M + B;
    const mPct = classified ? Math.round((M / classified) * 100) : 0;

    let verdict;
    if (!total) verdict = "Leeg (0 producten)";
    else if (classified < Math.max(5, total * 0.3)) verdict = "Onduidelijk — weinig gender-signaal";
    else if (M === 0 || M / classified <= 0.03) verdict = "Alleen dames";
    else if (W === 0 || W / classified <= 0.03) verdict = "Alleen heren";
    else verdict = M >= W ? "Gemengd — meer heren" : "Gemengd — meer dames";
    if (/^Alleen/.test(verdict) && classified && B / classified > 0.15) verdict += " (+unisex)";

    return {
      Domein: domain,
      Producten: total >= 250 ? "250+" : total,
      Dames: W,
      Heren: M,
      Beide: B,
      Onbekend: U,
      "% heren": classified ? mPct : "",
      Verdict: verdict,
    };
  },
};

export default job;
