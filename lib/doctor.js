// STORE DOCTOR — de check- en fix-engine. Eén motor voor twee plekken:
// de /qa-pagina (hele store, elke store) en de Controles-sectie in de
// importer (alleen de zojuist geïmporteerde producten).
//
// Opzet in drie lagen:
//  1. runDoctor(products)      — deterministische checks, gratis, geen AI
//  2. applyDoctorFix(...)      — chirurgische 1-tik-fixes per categorie,
//                                altijd met backup-rijen voor de fix-route
//  3. repairVariantImagesOn()  — de foto-reparateur, óók gebruikt door de
//                                importer direct na elke upload (bron-fix)
//
// AI-checks (geslacht, kleur↔foto, watermerk, taal-restlaag) leven in
// lib/ai.js en worden via /api/doctor-ai aangeroepen — bewust gescheiden:
// alles hier is gratis en altijd veilig om te draaien.

import {
  setImageVariants,
  updateProduct,
  deleteVariant,
  deleteProductImage,
  deleteProductById,
  getProductRaw,
} from "@/lib/shopify";
import { canonOptionName, translateValue, foreignTextHits } from "@/lib/lang";
import { familyOf, analyzeSizes, convertSizeValue } from "@/lib/sizes";
import { analyzeKeyword } from "@/lib/fashion";

/* ================================================================
   Gedeelde helpers
================================================================ */

function txt(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function tagsOf(p) {
  return String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
}
function colorOptionIndex(p) {
  return (p.options || []).findIndex((o) => /colou?r|kleur|farbe|couleur|coloris|colore/i.test(String(o.name || "")));
}
function sizeOptionIndex(p) {
  return (p.options || []).findIndex((o) => /size|taille|größe|grösse|maat|talla|taglia/i.test(String(o.name || "")));
}
function optValue(v, idx) {
  return idx >= 0 ? v[`option${idx + 1}`] : null;
}

// Deterministische hash op product-id → stabiel kortingspercentage
function hashPct(productId, pcts) {
  const s = String(productId);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return pcts[h % pcts.length];
}

const round2 = (n) => Math.round(n * 100) / 100;

// Promotie-woorden die uit TITELS geknipt mogen worden (word-boundary,
// alleen ondubbelzinnige rommel — "wholesale" blijft heel).
const TITLE_JUNK_RE = /\b(free shipping|best ?seller|hot sale|big sale|mega sale|flash sale|on sale|sale now|clearance|limited stock|limited time|new arrivals?|buy now|discount|% ?off|cheap(est)?)\b/gi;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
// aparte test-versie zonder /g — een globale regex onthoudt z'n lastIndex
// tussen .test()-aanroepen en slaat dan producten over
const EMOJI_TEST = new RegExp(EMOJI_RE.source, "u");

// GMC-risicowoorden voor de check (breder dan wat we durven wég te knippen)
const GMC_RISK = [
  "free shipping", "best price", "cheapest", "lowest price", "sale!!", "buy now",
  "limited stock", "only today", "hurry", "act now", "100% guaranteed",
  "money back guarantee", "satisfaction guaranteed", "as seen on", "bestseller",
  "best seller", "clearance", "discount code", "coupon",
];

const PLACEHOLDER = ["{{image_1}}", "{{image_2}}", "lorem ipsum", "undefined", "null"];

// producttype → nette product_type-tekst (zelfde termen als de taxonomie-map
// in de import-route; wijzig je daar iets, trek dit gelijk)
const TYPE_LABELS = {
  dress: "Dresses", tshirt: "T-Shirts", shirt: "Shirts", blouse: "Blouses",
  top: "Tops", sweater: "Sweaters", hoodie: "Hoodies", cardigan: "Cardigans",
  jacket: "Jackets", coat: "Coats", blazer: "Blazers", jeans: "Jeans",
  pants: "Pants", leggings: "Leggings", shorts: "Shorts", skirt: "Skirts",
  jumpsuit: "Jumpsuits", heels: "Heels", boots: "Boots", sneakers: "Sneakers",
  loafers: "Loafers", sandals: "Sandals", flats: "Flats", mules: "Mules",
  bag: "Handbags", scarf: "Scarves", belt: "Belts", hat: "Hats",
  swimsuit: "Swimwear", bikini: "Swimwear", vest: "Vests", polo: "Polos",
  bodysuit: "Bodysuits", kimono: "Kimonos", pajamas: "Pajamas", bra: "Bras",
  set: "Outfit Sets", suit: "Suits",
};

const SIZE_ORDER = {
  xxs: 0, xs: 1, s: 2, m: 3, l: 4, xl: 5, xxl: 6, "2xl": 6,
  xxxl: 7, "3xl": 7, xxxxl: 8, "4xl": 8, "5xl": 9, "6xl": 10,
};
function sizeRank(v) {
  const s = norm(v).replace(/\s+/g, "");
  if (s in SIZE_ORDER) return SIZE_ORDER[s];
  const n = parseFloat(s);
  if (!isNaN(n)) return 100 + n;
  return null; // onbekende maat → niet over oordelen
}

/* ================================================================
   1. DE CHECKS — runDoctor(products, opts)
   opts: { vendorName, menTemplate, market }
================================================================ */

export function runDoctor(products, opts = {}) {
  const menTemplate = opts.menTemplate || "men";
  const findings = [];
  const add = (id, level, title, why, hits, fixes) => {
    if (!hits.length) return;
    findings.push({
      id, level, title, why,
      count: hits.length,
      examples: hits.slice(0, 10),
      ids: [...new Set(hits.map((h) => h.id))],
      fixes: fixes || [],
    });
  };
  const label = (p, extra) => ({ id: p.id, title: p.title, handle: p.handle, extra: extra || "" });

  /* ---------- FOTO'S ---------- */

  // 1. Varianten zonder foto — dé GMC-afkeurder waar dit allemaal om begon
  const orphanHits = [];
  for (const p of products) {
    if (!(p.images || []).length) continue; // valt onder "geen foto's"
    const orphans = (p.variants || []).filter((v) => !v.image_id);
    if (orphans.length) orphanHits.push(label(p, `${orphans.length} van ${p.variants.length} varianten`));
  }
  add(
    "variant-no-photo", "error", "Varianten zonder gekoppelde foto",
    "Deze varianten gaan zonder eigen afbeelding de feed in — precies wat GMC afkeurt. Eerst gratis her-koppelen (op kleur); wat daarna overblijft kun je met één tik verwijderen.",
    orphanHits,
    [
      { id: "relink-photos", label: "Her-koppel foto's (gratis)", bulk: true },
      { id: "delete-orphan-variants", label: "Verwijder varianten zonder foto", danger: true },
    ]
  );

  add(
    "no-image", "error", "Product zonder één enkele foto",
    "Zonder afbeelding wordt een product altijd afgekeurd in Merchant Center.",
    products.filter((p) => !(p.images || []).length).map((p) => label(p)),
    [{ id: "delete-no-image-products", label: "Verwijder deze producten", danger: true }]
  );

  add(
    "few-images", "warn", "Twee of minder foto's",
    "Dunne fotosets converteren slechter; drie of meer is de norm van je eigen audits.",
    products.filter((p) => { const n = (p.images || []).length; return n > 0 && n <= 2; }).map((p) => label(p, `${(p.images || []).length} foto('s)`))
  );

  add(
    "small-images", "warn", "Foto kleiner dan 500×500",
    "GMC eist voor kleding minimaal 500×500 pixels — kleinere afbeeldingen worden afgekeurd.",
    products.filter((p) => (p.images || []).some((im) => (im.width && im.width < 500) || (im.height && im.height < 500))).map((p) => label(p))
  );

  add(
    "missing-alt", "warn", "Foto's zonder alt-tekst",
    "Alt-teksten helpen SEO én maken foto-herkoppeling op kleur betrouwbaarder.",
    products.filter((p) => (p.images || []).some((im) => !String(im.alt || "").trim())).map((p) => label(p)),
    [{ id: "fill-alt", label: "Vul alt-teksten (titel + kleur)", bulk: true }]
  );

  // Zelfde hoofdfoto bij meerdere producten
  const byImage = new Map();
  for (const p of products) {
    const first = (p.images || [])[0];
    if (!first || !first.src) continue;
    const k = String(first.src).split("?")[0].replace(/_\d+x\d*(?=\.\w+$)/, "");
    if (!byImage.has(k)) byImage.set(k, []);
    byImage.get(k).push(p);
  }
  add(
    "dup-image", "error", "Zelfde hoofdfoto bij meerdere producten",
    "Dezelfde eerste foto bij meer dan één product — duidt op dubbel geïmporteerde producten.",
    [...byImage.values()].filter((g) => g.length > 1).map((g) => label(g[0], `${g.length} producten`))
  );

  /* ---------- TAAL ---------- */

  const optNameHits = [];
  const optValueHits = [];
  const sizeHits = [];
  for (const p of products) {
    const badNames = (p.options || [])
      .map((o) => ({ raw: o.name, t: canonOptionName(o.name) }))
      .filter((x) => x.t.changed);
    if (badNames.length) {
      optNameHits.push(label(p, badNames.map((x) => `${x.raw}→${x.t.name}`).join(", ")));
    }
    let valHit = null;
    for (const v of p.variants || []) {
      for (const k of ["option1", "option2", "option3"]) {
        if (v[k] == null) continue;
        const r = translateValue(v[k]);
        if (r.changed) { valHit = `${v[k]}→${r.value}`; break; }
      }
      if (valHit) break;
    }
    if (valHit) optValueHits.push(label(p, valHit));

    /* Maten-check: klopt het MAATSYSTEEM bij de doelmarkt? Alleen
       ondubbelzinnig EU wordt geflagd (kleding 32+, schoenen 35–48,
       BH-banden 65+, expliciete "EU"-labels) — nummers 4–26 zijn in elke
       markt geldig en blijven met rust. De extra-tekst toont meteen de
       omrekening: "EU 36/38/40 → 8/10/12 (AUS+NZ)". */
    const si = sizeOptionIndex(p);
    if (si >= 0) {
      const sizes = [...new Set((p.variants || []).map((v) => optValue(v, si)).filter(Boolean))];
      if (sizes.length) {
        const fam = familyOf(p.product_type, p.title);
        const gen = tagsOf(p).some((t) => /^men$/i.test(t)) ? "men" : "women";
        const a = analyzeSizes(sizes, { family: fam, gender: gen, market: opts.market || "" });
        if (a.eu) sizeHits.push(label(p, a.extra));
      }
    }
  }
  add(
    "foreign-option-names", "error", "Optienamen in een vreemde taal",
    'Bijvoorbeeld "Taille" of "Größe" in plaats van "Size" — verkeerde taal in de size/color-attributen is een GMC-afkeuring.',
    optNameHits,
    [{ id: "translate-options", label: "Vertaal opties naar Engels", bulk: true }]
  );
  add(
    "foreign-option-values", "error", "Optie-waarden in een vreemde taal",
    'Kleuren als "Bleu" of "Schwarz" en maten als "Taille unique" horen in het Engels.',
    optValueHits,
    [{ id: "translate-options", label: "Vertaal opties naar Engels" }]
  );
  add(
    "size-system", "error", "Maten in het verkeerde systeem (EU)",
    opts.market
      ? `Deze producten dragen EU-maten en dat kent een ${opts.market}-shopper niet — verkeerde maat besteld = retour. Per product staat de omrekening al klaar (standaard-tabellen: dameskleding US=EU−32 / UK+AU=EU−28, damesschoenen US+AU=EU−31 / UK=EU−33, herenschoenen US=EU−33 / UK+AU=EU−34, herenjassen −10, herenbroeken −16, BH-banden naar inch of AU). Schoenentabellen kunnen per merk een halve maat afwijken — doe na de fix een steekproef.`
      : "Deze producten dragen EU-maten. Kies bovenaan eerst de doelmarkt, dan rekent de fix ze om via de standaard-tabellen.",
    sizeHits,
    opts.market
      ? [{ id: "convert-sizes", label: `Reken om naar ${opts.market}-maten` }]
      : []
  );

  const foreignDescHits = [];
  for (const p of products) {
    const hits = foreignTextHits(p.title + " " + txt(p.body_html).slice(0, 1500));
    if (hits.length) foreignDescHits.push(label(p, hits.slice(0, 3).join(", ")));
  }
  add(
    "foreign-text", "error", "Vreemde taal in titel of omschrijving",
    "Chinese tekens of leveranciers-taal (livraison, Größe…) in de klant-tekst — handmatig herschrijven of opnieuw importeren; de AI-taalcheck hieronder vindt óók wat dit woordenboek mist.",
    foreignDescHits
  );

  /* ---------- PRIJZEN ---------- */

  const priceIssues = [];
  const compareIssues = [];
  const notRounded = [];
  const pctCount = new Map();
  let discounted = 0;
  for (const p of products) {
    let brokeCompare = false;
    for (const v of p.variants || []) {
      const price = Number(v.price);
      const cmp = v.compare_at_price ? Number(v.compare_at_price) : null;
      if (!(price > 0)) { priceIssues.push(label(p, `prijs ${v.price}`)); break; }
      if (cmp !== null && cmp <= price && !brokeCompare) {
        compareIssues.push(label(p, `${cmp} ≤ ${price}`));
        brokeCompare = true;
      }
      if (!String(v.price).endsWith(".95") && !notRounded.some((x) => x.id === p.id)) {
        notRounded.push(label(p, String(v.price)));
      }
    }
    const v0 = (p.variants || [])[0];
    if (v0 && v0.compare_at_price && Number(v0.compare_at_price) > Number(v0.price)) {
      discounted++;
      const pct = Math.round((1 - Number(v0.price) / Number(v0.compare_at_price)) * 100);
      pctCount.set(pct, (pctCount.get(pct) || 0) + 1);
    }
  }
  add("price-zero", "error", "Prijs ontbreekt of is 0", "Een product zonder geldige prijs wordt geweigerd.", priceIssues);
  add(
    "compare-lower", "error", "Doorstreepprijs lager dan of gelijk aan verkoopprijs",
    "De compare-at moet hóger zijn dan de verkoopprijs, anders is het een misleidende korting (GMC-overtreding). De fix herrekent de doorstreepprijs met de vaste kortingsmix (30/40/50, stabiel per product).",
    compareIssues,
    [{ id: "fix-compareat", label: "Herstel doorstreepprijzen", bulk: true }]
  );
  add("price-rounding", "warn", "Prijs niet op het X4,95/X9,95-rooster", "Afwijking van je eigen prijsregel — check de wisselkoers-omrekening.", notRounded);

  if (discounted >= 30) {
    const top = [...pctCount.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / discounted >= 0.9) {
      findings.push({
        id: "uniform-discount", level: "warn",
        title: `Vrijwel alles heeft dezelfde korting (−${top[0]}%)`,
        why: "Storewide exact dezelfde doorstreepprijs oogt als permanent-sale — GMC-doorstreepprijs-risico én ongeloofwaardig (bekende audit-finding). De fix verdeelt 30/40/50 stabiel per product; verkoopprijzen blijven ongemoeid.",
        count: top[1],
        examples: [],
        ids: products.filter((p) => { const v = (p.variants || [])[0]; return v && v.compare_at_price && Number(v.compare_at_price) > Number(v.price); }).map((p) => p.id),
        fixes: [{ id: "remix-compareat", label: "Verdeel kortingen (30/40/50-mix)" }],
      });
    }
  }

  /* ---------- TITELS & TEKSTEN ---------- */

  const byTitle = new Map();
  for (const p of products) {
    const k = norm(p.title);
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(p);
  }
  add(
    "dup-title", "error", "Identieke producttitels",
    "Google ziet dit als duplicaat en kan producten samenvoegen of afkeuren.",
    [...byTitle.values()].filter((g) => g.length > 1).map((g) => label(g[0], `${g.length}× dezelfde titel`))
  );

  add(
    "gmc-words", "error", "Promo-/risicowoorden in titel of omschrijving",
    "Promotionele of niet-verifieerbare claims — klassieke afkeur-reden. De fix knipt alleen de ondubbelzinnige rommel uit TITELS; omschrijvingen blijven handwerk.",
    products
      .filter((p) => {
        const s = norm(p.title) + " " + norm(txt(p.body_html));
        return GMC_RISK.some((w) => s.includes(w)) || EMOJI_TEST.test(p.title || "");
      })
      .map((p) => {
        const s = norm(p.title) + " " + norm(txt(p.body_html));
        return label(p, GMC_RISK.filter((w) => s.includes(w)).slice(0, 3).join(", ") || "emoji in titel");
      }),
    [{ id: "clean-titles", label: "Schoon titels op" }]
  );

  add(
    "title-format", "warn", "Titel wijkt af van de formule",
    "Geen pipe-scheiding of te kort/lang — deze titels benutten de Google-ruimte niet optimaal.",
    products
      .filter((p) => {
        const t = String(p.title || "");
        return (t.match(/\|/g) || []).length !== 1 || t.length < 30 || t.length > 90;
      })
      .map((p) => label(p, `${String(p.title || "").length} tekens`))
  );

  add(
    "empty-desc", "error", "Lege of te korte omschrijving",
    "Minder dan 120 tekens tekst — te weinig voor Google Shopping én de klant.",
    products.filter((p) => txt(p.body_html).length < 120).map((p) => label(p))
  );

  add(
    "placeholder", "error", "Placeholder in de omschrijving",
    "Er staat nog een {{IMAGE_x}}-plaatshouder of testtekst in de omschrijving.",
    products.filter((p) => { const b = norm(p.body_html); return PLACEHOLDER.some((x) => b.includes(x)); }).map((p) => label(p))
  );

  /* ---------- TAGS, VENDOR, TYPE, TEMPLATES ---------- */

  add(
    "no-tags", "error", "Product zonder tags",
    "Zonder tag valt het product in geen enkele smart collection — onvindbaar in je navigatie.",
    products.filter((p) => !tagsOf(p).length).map((p) => label(p))
  );

  add(
    "no-gender-tag", "warn", "Geen Men/Women-tag",
    "Zonder geslachts-tag mist het product de Men/Women-collectie én het gender-attribuut in de feed. De AI-geslachtscheck hieronder kan ze in bulk zetten.",
    products.filter((p) => !tagsOf(p).some((t) => /^(men|women)$/i.test(t))).map((p) => label(p))
  );

  add(
    "gender-mismatch", "error", "Titel en gender-tag spreken elkaar tegen",
    'Titel zegt "Women\'s" maar de tag is Men (of andersom). De fix volgt de titel en zet meteen tag + template goed; heeft de titel geen duidelijk signaal, dan beoordeelt de AI-geslachtscheck het product op titel + omschrijving + foto.',
    products
      .filter((p) => {
        const t = norm(p.title);
        const isMenTag = tagsOf(p).some((x) => /^men$/i.test(x));
        const saysWomen = /\bwomen'?s\b|\bfor women\b/.test(t);
        const saysMen = (/\bmen'?s\b|\bfor men\b/.test(t)) && !/\bwomen/.test(t);
        return (isMenTag && saysWomen) || (!isMenTag && tagsOf(p).some((x) => /^women$/i.test(x)) && saysMen);
      })
      .map((p) => label(p)),
    [{ id: "fix-gender-from-title", label: "Zet tag + template gelijk aan de titel", bulk: true }]
  );

  add(
    "double-gender", "error", "Zowel Men- als Women-tag",
    "Product hangt in béíde gender-collecties en stuurt een dubbelzinnig gender-attribuut de feed in. De fix volgt de titel; zonder duidelijk titel-signaal beoordeelt de AI-geslachtscheck het product op titel + omschrijving + foto.",
    products
      .filter((p) => {
        const tg = tagsOf(p);
        return tg.some((x) => /^men$/i.test(x)) && tg.some((x) => /^women$/i.test(x));
      })
      .map((p) => label(p)),
    [{ id: "fix-gender-from-title", label: "Zet tag + template gelijk aan de titel", bulk: true }]
  );

  if (opts.vendorName) {
    add(
      "vendor-leak", "warn", `Vendor is niet "${opts.vendorName}"`,
      "De vendor-kolom lekt de leveranciersnaam de feed in (brand-attribuut!) — hoort de store-naam te zijn.",
      products.filter((p) => String(p.vendor || "").trim() && norm(p.vendor) !== norm(opts.vendorName)).map((p) => label(p, p.vendor)),
      [{ id: "set-vendor", label: `Zet vendor op "${opts.vendorName}"`, bulk: true }]
    );
  }

  add(
    "no-product-type", "warn", "Product zonder product type",
    "Een leeg producttype kost feed-kwaliteit (categorie-mapping). De fix leidt het type af uit de titel.",
    products.filter((p) => !String(p.product_type || "").trim()).map((p) => label(p)),
    [{ id: "set-product-type", label: "Vul product type uit titel", bulk: true }]
  );

  add(
    "barcode-junk", "warn", "Barcode ingevuld terwijl de feed zonder GTIN draait",
    "Jullie GMC-setup staat op identifier_exists=uit — meegescrapete (vaak ongeldige of dubbele) barcodes kunnen dan als foute GTIN de feed in lekken. Leegmaken is veilig.",
    products.filter((p) => (p.variants || []).some((v) => String(v.barcode || "").trim())).map((p) => label(p)),
    [{ id: "clear-barcodes", label: "Maak barcodes leeg", bulk: true }]
  );

  add(
    "men-template", "warn", "Herenproduct zonder men-template",
    `Als heren getagd maar zonder "${menTemplate}"-template — toont de damesindeling.`,
    products
      .filter((p) => tagsOf(p).some((t) => /^men$/i.test(t)) && String(p.template_suffix || "") !== menTemplate)
      .map((p) => label(p, p.template_suffix || "standaard")),
    [{ id: "fix-men-template", label: `Zet template "${menTemplate}"`, bulk: true }]
  );
  add(
    "women-men-template", "error", "Damesproduct met heren-template",
    "Verkeerd template gekoppeld — dit product toont de herenindeling.",
    products
      .filter((p) => String(p.template_suffix || "") === menTemplate && !tagsOf(p).some((t) => /^men$/i.test(t)))
      .map((p) => label(p)),
    [{ id: "fix-women-template", label: "Haal men-template weg", bulk: true }]
  );

  /* ---------- VARIANTEN ---------- */

  add(
    "default-title", "warn", 'Variant heet "Default Title"',
    "Geen maten of kleuren — check of de import de varianten heeft meegenomen.",
    products.filter((p) => (p.variants || []).length === 1 && String((p.variants || [])[0].title || "") === "Default Title").map((p) => label(p))
  );

  const orderHits = [];
  for (const p of products) {
    const si = sizeOptionIndex(p);
    if (si < 0 || (p.variants || []).length < 3) continue;
    const ranks = (p.variants || []).map((v) => sizeRank(optValue(v, si)));
    if (ranks.some((r) => r === null)) continue; // onbekende maten → niet oordelen
    const sorted = [...ranks].every((r, i) => i === 0 || ranks[i - 1] <= r);
    if (!sorted) orderHits.push(label(p, (p.variants || []).map((v) => optValue(v, si)).slice(0, 6).join("/")));
  }
  add(
    "size-order", "warn", "Maten in de verkeerde volgorde",
    "L vóór S in de keuzelijst oogt slordig. De fix sorteert varianten XS→XXL (en numeriek oplopend).",
    orderHits,
    [{ id: "fix-size-order", label: "Sorteer maten", bulk: true }]
  );

  /* ---------- STATUS & ZICHTBAARHEID ---------- */

  add(
    "unpublished", "warn", "Actief maar niet gepubliceerd op Online Store",
    "Status Active maar published_at leeg — het product is onzichtbaar in de webshop.",
    products.filter((p) => p.status === "active" && !p.published_at).map((p) => label(p)),
    [{ id: "publish-products", label: "Publiceer op Online Store", bulk: true }]
  );

  add(
    "draft", "warn", "Nog in concept (draft)",
    "Telt niet mee in de feed — bewust? Zo niet: op Active zetten in Shopify (bulk-edit).",
    products.filter((p) => p.status === "draft").map((p) => label(p))
  );

  add(
    "out-of-stock", "warn", "Voorraad-getrackt en overal 0",
    "Alle varianten tracked én 0 voorraad → out of stock in de feed. Geïmporteerde producten horen niet voorraad-getrackt te zijn.",
    products
      .filter((p) => {
        const vs = p.variants || [];
        return vs.length && vs.every((v) => v.inventory_management) && vs.reduce((s, v) => s + (Number(v.inventory_quantity) || 0), 0) <= 0;
      })
      .map((p) => label(p))
  );

  /* ---------- Sorteren + score ---------- */

  const order = { error: 0, warn: 1 };
  findings.sort((a, b) => order[a.level] - order[b.level] || b.count - a.count);
  const errors = findings.filter((f) => f.level === "error").reduce((s, f) => s + f.count, 0);
  const warns = findings.filter((f) => f.level === "warn").reduce((s, f) => s + f.count, 0);
  const penalty = products.length ? (errors * 3 + warns) / products.length : 0;
  const score = Math.max(1, Math.round((10 - penalty * 4) * 10) / 10);

  return { findings, stats: { products: products.length, errors, warns, score } };
}

/* ================================================================
   2. FOTO-REPARATEUR — her-koppelen vóór verwijderen
   Strategie per wees-variant:
     a. zelfde kleur als een variant die wél een foto heeft → die foto
     b. kleurnaam komt voor in alt-tekst of bestandsnaam → die foto
     c. anders: hoofdfoto (beter een neutrale foto in de feed dan afkeuring)
================================================================ */

export async function repairVariantImagesOn(store, p) {
  const res = { variants: (p.variants || []).length, missing: 0, relinked: 0, fallback: 0, stillMissing: 0 };
  const imgs = p.images || [];
  const vars = p.variants || [];
  if (!vars.length) return res;
  const orphans = vars.filter((v) => !v.image_id);
  res.missing = orphans.length;
  if (!orphans.length || !imgs.length) {
    res.stillMissing = imgs.length ? 0 : res.missing;
    return res;
  }

  const ci = colorOptionIndex(p);
  const colorOf = (v) => (ci >= 0 ? optValue(v, ci) : null);
  const plan = []; // {imgId, varId, via}
  for (const o of orphans) {
    let target = null;
    let via = "fallback";
    const c = colorOf(o);
    if (c != null) {
      const sib = vars.find((v) => v.image_id && colorOf(v) === c);
      if (sib) { target = sib.image_id; via = "color"; }
      if (!target) {
        const cl = norm(c).replace(/[^a-z0-9]+/g, "");
        if (cl.length >= 3) {
          const hit = imgs.find((im) =>
            (norm(im.alt) + " " + norm(im.src)).replace(/[^a-z0-9]+/g, "").includes(cl)
          );
          if (hit) { target = hit.id; via = "color"; }
        }
      }
    }
    if (!target) target = imgs[0].id;
    plan.push({ imgId: target, varId: o.id, via });
  }

  // Per afbeelding één PUT; bestaande variant_ids MEEnemen (de PUT vervangt de lijst)
  const byImg = new Map();
  for (const e of plan) {
    if (!byImg.has(e.imgId)) byImg.set(e.imgId, []);
    byImg.get(e.imgId).push(e);
  }
  for (const [imgId, entries] of byImg) {
    const img = imgs.find((im) => im.id === imgId);
    const existing = (img && img.variant_ids) || [];
    const merged = [...new Set([...existing, ...entries.map((e) => e.varId)])];
    const w = await setImageVariants(store, p.id, imgId, merged);
    for (const e of entries) {
      if (w.ok) {
        if (e.via === "color") res.relinked++;
        else res.fallback++;
      } else {
        res.stillMissing++;
      }
    }
  }
  return res;
}

/** Wrapper die het product zelf vers ophaalt (gebruikt door de importer). */
export async function repairVariantImages(store, productId) {
  const r = await getProductRaw(store, productId, "id,images,variants,options");
  if (!r.ok) return { error: r.error };
  return repairVariantImagesOn(store, r.product);
}

/* ================================================================
   3. DE FIXES — applyDoctorFix(store, fixId, product, options)
   → { changed, note, backup: [{field, old}] }
   Altijd chirurgisch: alleen het veld dat stuk is wordt aangeraakt.
================================================================ */

export async function applyDoctorFix(store, fixId, p, options = {}) {
  const backup = [];
  const out = (changed, note) => ({ changed, note: note || "", backup });

  switch (fixId) {
    case "relink-photos": {
      const r = await repairVariantImagesOn(store, p);
      if (r.error) throw new Error(r.error);
      return out(r.relinked + r.fallback > 0, `${r.relinked} op kleur, ${r.fallback} op hoofdfoto, ${r.stillMissing} niet gelukt`);
    }

    case "delete-orphan-variants": {
      const orphans = (p.variants || []).filter((v) => !v.image_id);
      if (!orphans.length) return out(false, "geen wees-varianten");
      if (orphans.length === (p.variants || []).length) {
        return out(false, "ALLE varianten zonder foto — overgeslagen (verwijder het product zelf of koppel foto's)");
      }
      backup.push({ field: "variants (verwijderd)", old: orphans });
      let done = 0;
      for (const v of orphans) {
        const r = await deleteVariant(store, p.id, v.id);
        if (r.ok) done++;
      }
      return out(done > 0, `${done}/${orphans.length} varianten verwijderd`);
    }

    case "translate-options": {
      /* LET OP (Shopify-valkuil): een product-PUT met een variants- of
         options-array VERVANGT de hele set — wat je niet meestuurt wordt
         verwijderd. Dus altijd ALLE varianten/opties meesturen; onaangepaste
         alleen als {id}. Geldt voor elke fix hieronder die arrays PUT. */
      const newOptions = (p.options || []).map((o) => {
        const t = canonOptionName(o.name);
        return { id: o.id, name: t.changed ? t.name : o.name, changed: t.changed };
      });
      let valChanges = 0;
      const newVariants = (p.variants || []).map((v) => {
        const nv = { id: v.id };
        for (const k of ["option1", "option2", "option3"]) {
          if (v[k] == null) continue;
          const r = translateValue(v[k]);
          if (r.changed) {
            nv[k] = r.value;
            valChanges++;
          }
        }
        return nv;
      });
      const nameChanges = newOptions.filter((o) => o.changed);
      if (!nameChanges.length && !valChanges) return out(false, "niets te vertalen");
      backup.push({
        field: "options/variant-waarden",
        old: {
          options: (p.options || []).map((o) => o.name),
          variants: (p.variants || []).map((v) => [v.id, v.option1, v.option2, v.option3]),
        },
      });
      const payload = { variants: newVariants };
      if (nameChanges.length) payload.options = newOptions.map((o) => ({ id: o.id, name: o.name }));
      const r = await updateProduct(store, p.id, payload);
      if (!r.ok) throw new Error(r.error);
      return out(true, `${nameChanges.length} optienamen, ${valChanges} waarden vertaald`);
    }

    case "convert-sizes": {
      const market = options.market;
      if (!market) throw new Error("geen doelmarkt gekozen — kies USA/UK/AUS+NZ/CAN bovenaan");
      const si = sizeOptionIndex(p);
      if (si < 0) return out(false, "geen size-optie");
      const fam = familyOf(p.product_type, p.title);
      const gen = tagsOf(p).some((t) => /^men$/i.test(t)) ? "men" : "women";
      const key = `option${si + 1}`;
      const seen = new Set();
      let dupSkip = false;
      let changes = 0;
      // volledige set meesturen — zie de Shopify-valkuil bij translate-options
      const newVariants = (p.variants || []).map((v) => {
        const nv = { id: v.id };
        if (v[key] != null) {
          const r = convertSizeValue(v[key], { family: fam, gender: gen, market });
          if (r.changed) {
            nv[key] = r.value;
            changes++;
          }
        }
        return nv;
      });
      if (!changes) return out(false, "geen EU-maten (meer) gevonden");
      // botsings-guard: als de conversie twee varianten dezelfde optie-combi
      // zou geven (bv. "38" én "EU 38"), weigert Shopify — dan overslaan
      for (let i = 0; i < newVariants.length; i++) {
        const v = p.variants[i];
        const comb = ["option1", "option2", "option3"]
          .map((k) => (newVariants[i][k] != null ? newVariants[i][k] : v[k]) ?? "")
          .join("|||");
        if (seen.has(comb)) { dupSkip = true; break; }
        seen.add(comb);
      }
      if (dupSkip) return out(false, "conversie zou dubbele varianten geven — handmatig (mix van EU- en lokale maten?)");
      backup.push({ field: "size-waarden", old: (p.variants || []).map((v) => [v.id, v[key]]) });
      const r = await updateProduct(store, p.id, { variants: newVariants });
      if (!r.ok) throw new Error(r.error);
      const a = analyzeSizes(
        [...new Set((p.variants || []).map((v) => v[key]).filter(Boolean))],
        { family: fam, gender: gen, market }
      );
      return out(true, a.extra || `${changes} maten omgerekend naar ${market}`);
    }

    case "clear-barcodes": {
      const withCode = (p.variants || []).filter((v) => String(v.barcode || "").trim());
      if (!withCode.length) return out(false, "geen barcodes");
      backup.push({ field: "barcodes", old: withCode.map((v) => [v.id, v.barcode]) });
      // volledige set meesturen — zie de Shopify-valkuil bij translate-options
      const r = await updateProduct(store, p.id, {
        variants: (p.variants || []).map((v) =>
          String(v.barcode || "").trim() ? { id: v.id, barcode: "" } : { id: v.id }
        ),
      });
      if (!r.ok) throw new Error(r.error);
      return out(true, `${withCode.length} barcodes leeg`);
    }

    case "set-vendor": {
      const name = String(options.vendorName || "").trim();
      if (!name) throw new Error("vendorName ontbreekt");
      if (norm(p.vendor) === norm(name)) return out(false, "stond al goed");
      backup.push({ field: "vendor", old: p.vendor || "" });
      const r = await updateProduct(store, p.id, { vendor: name });
      if (!r.ok) throw new Error(r.error);
      return out(true, `"${p.vendor || "—"}" → "${name}"`);
    }

    case "set-product-type": {
      if (String(p.product_type || "").trim()) return out(false, "type stond al ingevuld");
      const left = String(p.title || "").split("|")[0].toLowerCase();
      let typeId = null;
      try { const a = analyzeKeyword(left); typeId = a && a.typeId; } catch {}
      const typeLabel = typeId && TYPE_LABELS[typeId];
      if (!typeLabel) return out(false, "geen type herkend in de titel — handmatig");
      backup.push({ field: "product_type", old: "" });
      const r = await updateProduct(store, p.id, { product_type: typeLabel });
      if (!r.ok) throw new Error(r.error);
      return out(true, `type "${typeLabel}"`);
    }

    case "clean-titles": {
      const oldTitle = String(p.title || "");
      let t = oldTitle.replace(TITLE_JUNK_RE, " ").replace(EMOJI_RE, " ");
      t = t.replace(/!{2,}/g, "").replace(/\s*\|\s*/g, " | ").replace(/\s{2,}/g, " ").replace(/\s+([,.!])/g, "$1").trim();
      t = t.replace(/^[|\s]+|[|\s]+$/g, "").trim();
      if (t === oldTitle || t.length < 15) return out(false, t.length < 15 ? "resultaat te kort — handmatig" : "titel was al schoon");
      backup.push({ field: "title", old: oldTitle });
      const r = await updateProduct(store, p.id, { title: t });
      if (!r.ok) throw new Error(r.error);
      return out(true, `"${oldTitle.slice(0, 40)}…" → "${t.slice(0, 40)}…"`);
    }

    case "fix-compareat":
    case "remix-compareat": {
      const pcts = Array.isArray(options.pcts) && options.pcts.length ? options.pcts : [30, 40, 50];
      const pct = hashPct(p.id, pcts);
      const targets = (p.variants || []).filter((v) => {
        const price = Number(v.price);
        const cmp = v.compare_at_price ? Number(v.compare_at_price) : null;
        if (!(price > 0)) return false;
        if (fixId === "fix-compareat") return cmp !== null && cmp <= price; // alleen kapotte
        return cmp !== null && cmp > price; // remix: alle gekorte varianten
      });
      if (!targets.length) return out(false, "geen doorstreepprijzen aan te passen");
      backup.push({ field: "compare_at_price", old: targets.map((v) => [v.id, v.compare_at_price]) });
      // volledige set meesturen — zie de Shopify-valkuil bij translate-options
      const targetIds = new Set(targets.map((v) => v.id));
      const r = await updateProduct(store, p.id, {
        variants: (p.variants || []).map((v) =>
          targetIds.has(v.id)
            ? { id: v.id, compare_at_price: round2(Number(v.price) / (1 - pct / 100)).toFixed(2) }
            : { id: v.id }
        ),
      });
      if (!r.ok) throw new Error(r.error);
      return out(true, `−${pct}% → ${targets.length} varianten`);
    }

    case "fix-size-order": {
      const si = sizeOptionIndex(p);
      if (si < 0) return out(false, "geen size-optie");
      const ranked = (p.variants || []).map((v) => ({ v, rank: sizeRank(optValue(v, si)) }));
      if (ranked.some((x) => x.rank === null)) return out(false, "onbekende maat-waarden — handmatig");
      const sorted = [...ranked].sort((a, b) => a.rank - b.rank);
      const already = ranked.every((x, i) => x.v.id === sorted[i].v.id);
      if (already) return out(false, "volgorde stond al goed");
      backup.push({ field: "variant-volgorde", old: ranked.map((x) => [x.v.id, optValue(x.v, si)]) });
      const r = await updateProduct(store, p.id, {
        variants: sorted.map((x, i) => ({ id: x.v.id, position: i + 1 })),
      });
      if (!r.ok) throw new Error(r.error);
      return out(true, sorted.map((x) => optValue(x.v, si)).slice(0, 8).join("/"));
    }

    case "fill-alt": {
      const empty = (p.images || []).filter((im) => !String(im.alt || "").trim());
      if (!empty.length) return out(false, "alle alt-teksten gevuld");
      const ci = colorOptionIndex(p);
      const colorFor = (im) => {
        if (ci < 0) return "";
        const v = (p.variants || []).find((x) => x.image_id === im.id);
        const c = v && optValue(v, ci);
        return c ? ` - ${c}` : "";
      };
      backup.push({ field: "image-alt", old: empty.map((im) => [im.id, im.alt || ""]) });
      // volledige set meesturen — zie de Shopify-valkuil bij translate-options
      const emptyIds = new Set(empty.map((im) => im.id));
      const r = await updateProduct(store, p.id, {
        images: (p.images || []).map((im) =>
          emptyIds.has(im.id)
            ? { id: im.id, alt: `${String(p.title || "").split("|")[0].trim()}${colorFor(im)}` }
            : { id: im.id }
        ),
      });
      if (!r.ok) throw new Error(r.error);
      return out(true, `${empty.length} alt-teksten gevuld`);
    }

    case "fix-men-template": {
      const tpl = options.menTemplate || "men";
      if (String(p.template_suffix || "") === tpl) return out(false, "stond al goed");
      backup.push({ field: "template_suffix", old: p.template_suffix || "" });
      const r = await updateProduct(store, p.id, { template_suffix: tpl });
      if (!r.ok) throw new Error(r.error);
      return out(true, `template → "${tpl}"`);
    }

    case "fix-women-template": {
      if (!String(p.template_suffix || "")) return out(false, "stond al goed");
      backup.push({ field: "template_suffix", old: p.template_suffix });
      const r = await updateProduct(store, p.id, { template_suffix: "" });
      if (!r.ok) throw new Error(r.error);
      return out(true, "men-template weggehaald");
    }

    case "publish-products": {
      if (p.published_at) return out(false, "stond al gepubliceerd");
      backup.push({ field: "published_at", old: null });
      const r = await updateProduct(store, p.id, { published_at: new Date().toISOString() });
      if (!r.ok) throw new Error(r.error);
      return out(true, "gepubliceerd");
    }

    case "delete-no-image-products": {
      if ((p.images || []).length) return out(false, "heeft inmiddels foto's — overgeslagen");
      backup.push({ field: "product (verwijderd)", old: { id: p.id, title: p.title, handle: p.handle, status: p.status } });
      const r = await deleteProductById(store, p.id);
      if (!r.ok) throw new Error(r.error);
      return out(true, "product verwijderd");
    }

    case "fix-gender-from-title":
    case "gender-tags": {
      /* Twee routes naar dezelfde reparatie:
         - fix-gender-from-title: deterministisch, volgt een expliciet
           "Men's"/"Women's" in de titel (gratis; pakt óók dubbele tags)
         - gender-tags: past het oordeel van de AI-geslachtscheck toe
           (options.labels, beoordeeld op titel + omschrijving + foto)
         Beide zetten tag ÉN template in één PUT goed, zodat er geen
         half-gefixte producten ontstaan. */
      let want = null;
      if (fixId === "gender-tags") {
        want = options.labels && options.labels[String(p.id)];
        if (!want) return out(false, "geen AI-label voor dit product");
      } else {
        const t = norm(p.title);
        const saysWomen = /\bwomen'?s\b|\bfor women\b/.test(t);
        const saysMen = (/\bmen'?s\b|\bfor men\b/.test(t)) && !/\bwomen/.test(t);
        want = saysWomen ? "Women" : saysMen ? "Men" : null;
        if (!want) return out(false, "geen duidelijk gender-signaal in de titel — de AI-geslachtscheck beoordeelt deze");
      }
      const menTpl = options.menTemplate || "men";
      const tags = tagsOf(p);
      const cleaned = tags.filter((t) => !/^(men|women)$/i.test(t));
      cleaned.push(want);
      const changedTags = cleaned.join(",") !== tags.join(",");
      const curTpl = String(p.template_suffix || "");
      const wantTpl = want === "Men" ? menTpl : curTpl === menTpl ? "" : curTpl;
      const changedTpl = wantTpl !== curTpl;
      if (!changedTags && !changedTpl) return out(false, "tag en template stonden al goed");
      backup.push({ field: "tags/template", old: { tags: p.tags || "", template_suffix: curTpl } });
      const payload = {};
      if (changedTags) payload.tags = cleaned.join(", ");
      if (changedTpl) payload.template_suffix = wantTpl || null;
      const r = await updateProduct(store, p.id, payload);
      if (!r.ok) throw new Error(r.error);
      const parts = [];
      if (changedTags) parts.push(`tag → ${want}`);
      if (changedTpl) parts.push(`template → ${wantTpl || "standaard"}`);
      return out(true, parts.join(" · "));
    }

    case "delete-flagged-images": {
      const imgIds = (options.images && options.images[String(p.id)]) || [];
      if (!imgIds.length) return out(false, "geen foto's aangewezen");
      const victims = (p.images || []).filter((im) => imgIds.includes(im.id));
      if (!victims.length) return out(false, "foto's niet (meer) gevonden");
      if (victims.length >= (p.images || []).length) {
        return out(false, "zou ALLE foto's verwijderen — overgeslagen (product handmatig beoordelen)");
      }
      backup.push({ field: "images (verwijderd)", old: victims.map((im) => [im.id, im.src]) });
      let done = 0;
      for (const im of victims) {
        const r = await deleteProductImage(store, p.id, im.id);
        if (r.ok) done++;
      }
      // verwijderde foto's kunnen varianten wees maken → direct her-koppelen
      const rep = await repairVariantImages(store, p.id);
      const extra = rep && !rep.error && rep.missing ? ` · ${rep.relinked + rep.fallback} varianten her-gekoppeld` : "";
      return out(done > 0, `${done} foto('s) verwijderd${extra}`);
    }

    default:
      throw new Error(`Onbekende fix "${fixId}"`);
  }
}

/** Welke product-fields de fix-route moet ophalen per fix. */
export const FIX_FIELDS = "id,title,handle,tags,status,template_suffix,product_type,vendor,images,variants,options,published_at";
