// STORE QA — kijkt naar de hele store in samenhang i.p.v. product voor
// product, en zoekt naar SYSTEMATISCHE fouten: dingen die bij tientallen
// producten tegelijk misgaan en je GMC-goedkeuring of je marge kosten.
//
// Alles hier is deterministisch (geen AI): snel, gratis en altijd hetzelfde
// antwoord. De AI-laag draait er in de route overheen voor de dingen die
// alleen een mens/model ziet.

function txt(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Woorden die Google Merchant Center in titels/omschrijvingen afkeurt of
// die een misrepresentation-review uitlokken.
const GMC_RISK = [
  "free shipping", "best price", "cheapest", "lowest price", "sale!!", "buy now",
  "limited stock", "only today", "hurry", "act now", "100% guaranteed",
  "money back guarantee", "satisfaction guaranteed", "as seen on", "bestseller",
  "best seller", "clearance", "discount code", "coupon",
];

const PLACEHOLDER = ["{{image_1}}", "{{image_2}}", "lorem ipsum", "undefined", "null"];

/**
 * products: Shopify-producten (Admin API)
 * opts: { menTemplate: "men" }
 * → { findings: [{id, level, title, count, why, examples[]}], stats }
 */
export function runStoreQa(products, opts = {}) {
  const menTemplate = opts.menTemplate || "men";
  const findings = [];
  const add = (id, level, title, why, examples) => {
    if (!examples.length) return;
    findings.push({ id, level, title, why, count: examples.length, examples: examples.slice(0, 8) });
  };
  const label = (p) => ({ id: p.id, title: p.title, handle: p.handle });

  /* ---------- 1. Dubbele titels (GMC ziet dit als duplicate content) ---------- */
  const byTitle = new Map();
  for (const p of products) {
    const k = norm(p.title);
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(p);
  }
  const dupTitles = [...byTitle.values()].filter((g) => g.length > 1);
  add(
    "dup-title",
    "error",
    "Identieke producttitels",
    "Twee of meer producten met exact dezelfde titel. Google ziet dit als duplicaat en kan ze samenvoegen of afkeuren.",
    dupTitles.map((g) => ({ ...label(g[0]), extra: `${g.length}× dezelfde titel` }))
  );

  /* ---------- 2. Dezelfde hoofdfoto bij meerdere producten ---------- */
  const byImage = new Map();
  for (const p of products) {
    const first = (p.images || [])[0];
    if (!first || !first.src) continue;
    // CDN-varianten (?v=, size-suffix) wegstrippen
    const k = String(first.src).split("?")[0].replace(/_\d+x\d*(?=\.\w+$)/, "");
    if (!byImage.has(k)) byImage.set(k, []);
    byImage.get(k).push(p);
  }
  add(
    "dup-image",
    "error",
    "Zelfde hoofdfoto bij meerdere producten",
    "Dezelfde afbeelding als eerste foto bij meer dan één product — duidt op dubbel geïmporteerde producten.",
    [...byImage.values()].filter((g) => g.length > 1).map((g) => ({ ...label(g[0]), extra: `${g.length} producten` }))
  );

  /* ---------- 3. Geen of te weinig foto's ---------- */
  add(
    "no-image",
    "error",
    "Product zonder afbeelding",
    "Zonder afbeelding wordt een product altijd afgekeurd in Merchant Center.",
    products.filter((p) => !(p.images || []).length).map(label)
  );
  add(
    "few-images",
    "warn",
    "Maar één afbeelding",
    "Producten met één foto converteren aantoonbaar slechter; twee of meer is het minimum voor een geloofwaardige listing.",
    products.filter((p) => (p.images || []).length === 1).map(label)
  );

  /* ---------- 4. Prijs & compare-at ---------- */
  const priceIssues = [];
  const compareIssues = [];
  const notRounded = [];
  for (const p of products) {
    for (const v of p.variants || []) {
      const price = Number(v.price);
      const cmp = v.compare_at_price ? Number(v.compare_at_price) : null;
      if (!(price > 0)) {
        priceIssues.push({ ...label(p), extra: `prijs ${v.price}` });
        break;
      }
      if (cmp !== null && cmp <= price) {
        compareIssues.push({ ...label(p), extra: `${cmp} ≤ ${price}` });
        break;
      }
      if (!String(v.price).endsWith(".95")) {
        notRounded.push({ ...label(p), extra: `${v.price}` });
        break;
      }
    }
  }
  add("price-zero", "error", "Prijs ontbreekt of is 0", "Een product zonder geldige prijs wordt geweigerd.", priceIssues);
  add(
    "compare-lower",
    "error",
    "Doorgestreepte prijs lager dan verkoopprijs",
    "De compare-at prijs moet hoger zijn dan de verkoopprijs, anders is het een misleidende korting (GMC-overtreding).",
    compareIssues
  );
  add(
    "price-rounding",
    "warn",
    "Prijs niet afgerond op .95",
    "Afwijking van je eigen prijsregel — controleer of de wisselkoers-omrekening goed ging.",
    notRounded
  );

  /* ---------- 5. Tags & collecties ---------- */
  const tagsOf = (p) => String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  add(
    "no-tags",
    "error",
    "Product zonder tags",
    "Zonder tag valt het product in geen enkele smart collection — het is onvindbaar in je navigatie.",
    products.filter((p) => !tagsOf(p).length).map(label)
  );
  add(
    "no-gender-tag",
    "warn",
    "Geen Men/Women-tag",
    "Zonder geslachts-tag mist het product de Men- of Women-collectie en (bij heren) het juiste template.",
    products
      .filter((p) => !tagsOf(p).some((t) => /^(men|women)$/i.test(t)))
      .map(label)
  );

  /* ---------- 6. Heren-template ---------- */
  add(
    "men-template",
    "warn",
    "Herenproduct zonder men-template",
    `Product is als heren getagd maar heeft niet het "${menTemplate}"-template — het toont dan de damesindeling.`,
    products
      .filter(
        (p) =>
          tagsOf(p).some((t) => /^men$/i.test(t)) &&
          String(p.template_suffix || "") !== menTemplate
      )
      .map((p) => ({ ...label(p), extra: p.template_suffix || "standaard" }))
  );
  add(
    "women-men-template",
    "error",
    "Damesproduct met heren-template",
    "Verkeerd template gekoppeld — dit product toont de herenindeling.",
    products
      .filter(
        (p) =>
          String(p.template_suffix || "") === menTemplate &&
          !tagsOf(p).some((t) => /^men$/i.test(t))
      )
      .map(label)
  );

  /* ---------- 7. Titel tegen geslacht ---------- */
  add(
    "gender-mismatch",
    "error",
    "Titel en tag spreken elkaar tegen",
    'De titel zegt "Women\'s"/"For Women" maar het product is als heren getagd (of andersom).',
    products
      .filter((p) => {
        const t = norm(p.title);
        const isMenTag = tagsOf(p).some((x) => /^men$/i.test(x));
        const saysWomen = /\bwomen'?s\b|\bfor women\b/.test(t);
        const saysMen = /\bmen'?s\b|\bfor men\b/.test(t) && !/\bwomen/.test(t);
        return (isMenTag && saysWomen) || (!isMenTag && saysMen);
      })
      .map(label)
  );

  /* ---------- 8. Omschrijving ---------- */
  add(
    "empty-desc",
    "error",
    "Lege of te korte omschrijving",
    "Minder dan 120 tekens tekst — te weinig context voor Google Shopping én voor de klant.",
    products.filter((p) => txt(p.body_html).length < 120).map(label)
  );
  add(
    "placeholder",
    "error",
    "Placeholder in de omschrijving",
    "Er staat nog een {{IMAGE_x}}-plaatshouder of testtekst in de omschrijving.",
    products
      .filter((p) => {
        const b = norm(p.body_html);
        return PLACEHOLDER.some((x) => b.includes(x));
      })
      .map(label)
  );
  add(
    "gmc-words",
    "error",
    "Risicowoorden voor Merchant Center",
    "Promotionele of niet-verifieerbare claims in titel of omschrijving — klassieke reden voor afkeuring.",
    products
      .filter((p) => {
        const s = norm(p.title) + " " + norm(txt(p.body_html));
        return GMC_RISK.some((w) => s.includes(w));
      })
      .map((p) => {
        const s = norm(p.title) + " " + norm(txt(p.body_html));
        return { ...label(p), extra: GMC_RISK.filter((w) => s.includes(w)).slice(0, 3).join(", ") };
      })
  );

  /* ---------- 9. Titelvorm (jouw eigen formule) ---------- */
  add(
    "title-format",
    "warn",
    "Titel wijkt af van de formule",
    "Geen pipe-scheiding of te kort/lang — deze titels benutten de Google-ruimte niet optimaal.",
    products
      .filter((p) => {
        const t = String(p.title || "");
        const pipes = (t.match(/\|/g) || []).length;
        return pipes !== 1 || t.length < 30 || t.length > 90;
      })
      .map((p) => ({ ...label(p), extra: `${p.title.length} tekens` }))
  );

  /* ---------- 10. Varianten zonder maat/kleur ---------- */
  add(
    "single-variant",
    "warn",
    "Maar één variant",
    "Geen maten of kleuren — controleer of de import de varianten wel heeft meegenomen.",
    products.filter((p) => (p.variants || []).length === 1).map(label)
  );

  const order = { error: 0, warn: 1 };
  findings.sort((a, b) => order[a.level] - order[b.level] || b.count - a.count);

  const errors = findings.filter((f) => f.level === "error").reduce((s, f) => s + f.count, 0);
  const warns = findings.filter((f) => f.level === "warn").reduce((s, f) => s + f.count, 0);
  // Score: fouten wegen 3× zo zwaar als waarschuwingen, afgezet tegen het
  // aantal producten. 10 = schoon.
  const penalty = products.length ? (errors * 3 + warns) / products.length : 0;
  const score = Math.max(1, Math.round((10 - penalty * 4) * 10) / 10);

  return {
    findings,
    stats: { products: products.length, errors, warns, score },
  };
}
