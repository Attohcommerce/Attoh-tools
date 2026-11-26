/* INFOGRAPHIC-BREIN v2 (25-11-2026, projectdoc 211/212) — luxe "infographic" per product.
   Eén 4:5-beeld: nieuw model + het exacte product, twee detailfoto's, korte verkooptekst op het beeld.
   De prompt is woord voor woord een van Justins twee eigen prompts (zie onderaan):
   schoenen/sandalen = zijn schoenen-prompt, al het andere = zijn lifestyle-prompt.
   Per product wisselt alleen: merk, productnaam + kleur, productwoord, behoud-regels, detailfoto's, man/vrouw. */

export const INFOGRAPHIC_SETTINGS = { model: "gpt_image_2", quality: "medium", resolution: "1k", aspect_ratio: "4:5" };

const strip = (html) =>
  String(html || "")
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ");

/** vaste, herhaalbare keuze per product (zelfde product = zelfde stijl bij opnieuw maken) */
function hashOf(s) {
  let h = 2166136261;
  for (const c of String(s || "")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const pickN = (list, seed, n = 1) => {
  const a = [...list];
  const out = [];
  let h = seed || 1;
  while (a.length && out.length < n) {
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
    out.push(a.splice(h % a.length, 1)[0]);
  }
  return out;
};

/* ---------- 1. familie ---------- */
const FAMILY_RULES = [
  ["bag", /\b(bag|tote|handbag|crossbody|backpack|wallet|purse|clutch|duffle|satchel)\b/i],
  ["hat", /\b(hat|cap|beanie|visor|fedora)\b/i],
  ["sandal", /\b(sandals?|slides?|flip[- ]?flops?|thongs?|mules?|espadrilles?|clogs?)\b/i],
  ["shoe", /\b(shoes?|loafers?|sneakers?|boots?|heels?|flats?|oxfords?|derby|moccasins?|trainers?|pumps?)\b/i],
  ["swim_w", /\b(swimsuit|swimwear|bikini|tankini|one[- ]piece|bathing suit)\b/i],
  ["swim_m", /\b(swim (shorts?|trunks?)|board ?shorts?|swim trunk)\b/i],
  ["dress", /\b(dress|gown|kaftan)\b/i],
  ["set", /\b(jumpsuit|romper|playsuit|co-?ord|two[- ]piece|matching set|set)\b/i],
  ["outer", /\b(jacket|coat|blazer|parka|trench|bomber|gilet|puffer|windbreaker|overcoat)\b/i],
  ["knit", /\b(sweater|jumper|cardigan|knitwear|hoodie|sweatshirt|pullover|turtleneck|quarter[- ]zip)\b/i],
  ["skirt", /\b(skirt|skort)\b/i],
  ["shorts", /\b(shorts?)\b/i],
  ["pants", /\b(pants?|trousers?|jeans|chinos?|joggers?|leggings|cargo|capris?|slacks)\b/i],
  ["top", /\b(shirt|henley|polo|tee|t[- ]?shirt|blouse|top|tank|singlet|cami|tunic|corset|bodysuit)\b/i],
];
/** familie uit het linkerdeel van de titel + producttype. "Dress Shirt" is een top, "Short Sleeve" geen short. */
export function familyOf(p) {
  const head = `${String(p.title || "").split("|")[0]} ${p.type || p.product_type || ""}`
    .replace(/\bdress[\s-]+(shirts?|pants?|trousers?|shoes?)\b/gi, "$1")
    .replace(/\bshort[\s-]?sleeves?d?\b/gi, " ")
    .replace(/\bswim(ming)? (shorts?|trunks?)\b/gi, "swim trunk");
  if (/\bswim trunk|board ?shorts?\b/i.test(head)) return "swim_m";
  if (/\bswimwear\b/i.test(head) && /\bmen'?s\b|\bmens\b/i.test(head) && !/\bwomen/i.test(head)) return "swim_m";
  for (const [fam, re] of FAMILY_RULES) if (re.test(head)) return fam;
  return "top";
}
export const FAMILY_LABEL = { bag: "tas", hat: "hoed", sandal: "sandaal", shoe: "schoen", swim_w: "badmode dames", swim_m: "zwemshort", dress: "jurk", set: "set/jumpsuit", outer: "jas", knit: "trui", skirt: "rok", shorts: "short", pants: "broek", top: "top/shirt" };

/* ---------- 3. uit het product zelf ---------- */
/** "Women's Maxi Dress | Square Neckline ..." → "maxi dress" */
function nounOf(p) {
  const left = String(p.title || "").split("|")[0].replace(/\b(wo)?men'?s\b|\bfor (wo)?men\b|\bladies\b|\bunisex\b/gi, " ").replace(/\s+/g, " ").trim();
  return (left || "garment").toLowerCase();
}
/** kenmerken: de "Label: tekst"-regels uit de omschrijving (WHY CHOOSE ...), Occasion apart */
export function featuresOf(bodyHtml) {
  const txt = strip(bodyHtml);
  const feats = [];
  let occasion = "";
  for (const line of txt.split("\n")) {
    const m = line.trim().match(/^([A-Z][A-Za-z /&-]{2,26}):\s*(.{4,180})$/);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim().replace(/\s+/g, " ");
    if (/^why (choose|you)/i.test(label)) continue;
    if (/^occasions?$/i.test(label)) occasion = value;
    else feats.push({ label, value });
  }
  return { features: feats.slice(0, 6), occasion, text: txt.replace(/\s+/g, " ").slice(0, 1600) };
}

/* ---------- DE PROMPT ----------
   25-11, derde ronde. Justin: "Gebruik gewoon exact dezelfde prompt."
   De prompt IS nu zijn eigen tekst, woord voor woord. Er zijn precies twee prompts:
     A = zijn schoenen-prompt (dark brown cross-strap sandals)  → sandalen en schoenen
     B = zijn lifestyle-prompt (khaki linen Henley shirt)       → alle kleding, tassen en hoeden
   Wat per product wordt gewisseld, en verder niets:
     - merknaam, productnaam + kleur, het woord voor het product ("sandals", "shirt")
     - de regels onder "preserving" (wat er van dít product behouden moet blijven)
     - de twee kleine foto's (welk detail)
     - man/vrouw
     - een regel tekst op het beeld alleen als die voor dit product niet klopt
       (bv. "Slip on. Step out." bij een veterschoen, "Lightweight" bij een jas)
   Enige toevoeging: één regel over een echte persoon in B (Justin: "alleen de persoon ziet er nep uit"),
   en bij broeken/jurken/shorts één regel dat het hele product in beeld moet. */

const lc = (s) => String(s || "").trim().toLowerCase();
const has = (item, re) => re.test(`${item.title || ""} ${item.featureText || ""}`);

/* A — per schoensoort: de preserving-regels, de twee macrofoto's, en wat niet verzonnen mag worden */
const A = {
  sandal: {
    piece: "sandals",
    keep: ["Authentic material and grain appearance.", "Exact strap construction.", "Original silhouette.", "Original stitching and edge finishing.", "Original footbed.", "Original outsole.", "Original sole thickness and proportions."],
    never: "additional straps, logos, buckles or fictional comfort technologies",
    m1: "The straps and visible stitching.",
    m2: "The footbed and original outsole construction.",
    feet: "Feet must look exceptionally realistic, with accurate anatomy, exactly five naturally proportioned toes per foot, believable toenails, subtle veins, natural skin folds, fine body hair, visible skin texture and realistic pressure against the footbed.",
    touch: "The sandals must interact physically and naturally with the feet. Show believable contact shadows, strap tension and weight distribution.",
    avoid: "Avoid overly smooth skin, unnatural toes, duplicated limbs, artificial anatomy or CGI-looking footwear.",
  },
  shoe: {
    piece: "shoes",
    keep: ["Authentic material and grain appearance.", "Exact upper construction.", "Original toe shape and silhouette.", "Original stitching and edge finishing.", "Original outsole.", "Original sole thickness and proportions."],
    never: "additional logos, tassels, buckles, stitching or fictional comfort technologies",
    m1: "The upper material and visible stitching.",
    m2: "The toe shape and original outsole construction.",
    feet: "Ankles and lower legs must look exceptionally realistic, with accurate anatomy, subtle veins, natural skin folds, fine body hair and visible skin texture.",
    touch: "The shoes must interact physically and naturally with the feet. Show believable contact shadows, natural creasing and weight distribution.",
    avoid: "Avoid overly smooth skin, duplicated limbs, artificial anatomy or CGI-looking footwear.",
  },
};

/* B — per kledingsoort: woord voor het product, wat behouden blijft, welk detail de close-up toont.
   verb = "wearing" tenzij anders · frame = alleen waar het product anders buiten beeld valt · cool = geen zomerdecor */
const B = {
  top: { piece: "shirt", keep: "neckline, sleeves, buttons and fit", detail: "neckline" },
  knit: { piece: "knit", keep: "knit structure, collar, cuffs and fit", detail: "collar", cool: true },
  outer: { piece: "jacket", keep: "collar, closure, pockets and fit", detail: "collar", cool: true },
  dress: { piece: "dress", keep: "neckline, sleeves, length and fit", detail: "neckline", frame: "The model is shown full length so the whole dress is visible." },
  set: { piece: "outfit", keep: "neckline, waist, length and fit", detail: "neckline", frame: "The model is shown full length so the whole outfit is visible." },
  skirt: { piece: "skirt", keep: "waistband, length and fit", detail: "waistband", frame: "The model is shown full length so the whole skirt is visible." },
  pants: { piece: "trousers", keep: "waistband, pockets, leg shape and fit", detail: "waistband", frame: "The model is shown full length so the trousers are visible from waist to hem." },
  shorts: { piece: "shorts", keep: "waistband, pockets, length and fit", detail: "waistband", frame: "The model is shown from head to just below the knees so the shorts are fully visible." },
  swim_w: { piece: "swimsuit", keep: "neckline, straps, cut and fit", detail: "neckline", frame: "The model is shown from mid-thigh up in an elegant, tasteful resort pose." },
  swim_m: { piece: "swim shorts", keep: "waistband, drawstring, length and fit", detail: "waistband", frame: "The model is shown from mid-thigh up so the swim shorts are fully visible." },
  bag: { piece: "bag", keep: "shape, handles, closure and hardware", detail: "closure", verb: "carrying", material: "material", frame: "The bag is clearly visible and remains the primary product focus." },
  hat: { piece: "hat", keep: "shape, brim, band and weave", detail: "brim", material: "material", frame: "The model's eyes remain visible under the brim." },
};

/** De tekst op het beeld: altijd Justins eigen regels, tenzij een regel voor dit product niet klopt. */
export function copyFor(item) {
  const fam = item.family || familyOf(item);
  if (fam === "sandal" || fam === "shoe") {
    const laced = has(item, /lace[- ]?up|laces|buckle|zip/i);
    const open = fam === "sandal";
    return {
      intro: "THE EVERYDAY ESSENTIAL", h1: "Step into comfort.", h2: "Without compromising style.",
      points: [
        ["COMFORT IN EVERY STEP", "Cushioned for everyday ease."],
        ["EFFORTLESS BY DESIGN", laced ? "Easy on. Easy all day." : "Slip on. Step out."],
        ["REFINED, NOT RESTRICTIVE", open ? "An open design with timeless appeal." : "A clean design with timeless appeal."],
      ],
    };
  }
  const warm = fam === "knit" || fam === "outer" || /^\s*AW\b/i.test(String(item.type || ""));
  return {
    h1: "Good style.", h2: "Comes naturally.", support: "For wherever the day takes you.",
    points: [
      ["FEEL GOOD.", warm ? "Soft everyday comfort." : fam === "bag" || fam === "hat" ? "Easy everyday style." : "Lightweight everyday comfort."],
      ["LOOK PUT TOGETHER.", "Without trying too hard."],
      ["GO ANYWHERE.", "From slow mornings to evenings out."],
    ],
    closing: "Your everyday escape.",
  };
}

/** Volledige prompt voor één infographic-opdracht.
    item: { title, type, color, gender, storeName, productId, features[], occasion, featureText, family } */
export function buildInfographicPrompt(item) {
  const fam = item.family || familyOf(item);
  const man = item.gender === "man";
  const who = man ? "male" : "female";
  const brand = String(item.brand || item.storeName || "").replace(/\s+/g, " ").trim().toUpperCase() || "OUR STORE";
  const colour = lc(item.color);
  const name = `${colour ? colour + " " : ""}${nounOf(item)}`;
  const copy = copyFor({ ...item, family: fam });

  if (A[fam]) {
    const X = A[fam];
    return [
      `Create ONE exceptionally refined, ultra-photorealistic, conversion-focused luxury footwear infographic for ${brand}.`,
      "PRODUCT REFERENCE — STRICT ACCURACY",
      "Use the attached reference image exclusively as a footwear reference.",
      `Faithfully reproduce the exact ${name}, preserving:`,
      `Original ${colour ? colour + " " : ""}colour.`,
      ...X.keep,
      `Do not redesign, upgrade or modify the product. Do not introduce ${X.never}.`,
      "HUMAN REALISM — CRITICAL PRIORITY",
      `Generate a completely new adult ${who} model. Do not recreate the person, legs, feet, clothing or pose from the reference photograph.`,
      `Photograph a naturally proportioned ${who} model aged 30–45, wearing sophisticated, slightly cropped ivory or charcoal tailored trousers.`,
      X.feet,
      X.touch,
      X.avoid,
      "ART DIRECTION",
      "Futuristic 2028 luxury footwear campaign. Apple-level product precision combined with Bottega Veneta editorial sophistication.",
      "Warm ivory, espresso brown, limestone and subtle charcoal tones.",
      "Photographed in a premium architectural studio using soft directional daylight, realistic lens characteristics and beautiful material detail.",
      "COMPOSITION",
      "Create a visually striking, asymmetrical editorial layout.",
      `The primary photograph shows the model from approximately knee height downward, wearing the exact ${X.piece} in a natural standing position.`,
      "The footwear occupies the dominant visual area.",
      "Integrate two smaller, exceptionally sharp macro photographs:",
      X.m1,
      X.m2,
      "Connect selected details using exceptionally fine editorial callout lines.",
      "Use a precise invisible Swiss grid, sophisticated typography, controlled negative space and minimal graphic interference.",
      "The composition should feel like an expensive designer footwear campaign, not a technical instruction sheet.",
      "EXACT ON-IMAGE TEXT",
      "Small introductory text:",
      copy.intro,
      "Large editorial headline:",
      copy.h1,
      copy.h2,
      "Three sophisticated benefit callouts:",
      ...copy.points.flat(),
      "Minimal brand signature:",
      brand,
      "CONVERSION OBJECTIVE",
      `Make the customer immediately imagine how easy, comfortable and stylish these ${X.piece} would be to wear.`,
      "Communicate premium aesthetics, everyday practicality and relaxed sophistication through the photography itself.",
      "STRICTLY AVOID",
      "Circular icons, conventional Amazon infographics, oversized badges, rounded information cards, fake medical claims, exaggerated cushioning effects, artificial 3D renders, incorrect foot anatomy, generic stock photography and excessive text.",
      "The final composition must feel contemporary, expensive and exceptionally clean.",
      "OUTPUT SETTINGS",
      "One image only.",
      "Portrait 4:5.",
      "1K resolution.",
      "Medium generation quality.",
      "Mobile-first Shopify product page.",
      "Prioritise photographic realism and accurate typography.",
    ].join("\n");
  }

  const X = B[fam] || B.top;
  const verb = X.verb || "wearing";
  const cool = !!X.cool || /^\s*AW\b/i.test(String(item.type || ""));
  const plural = /s$/.test(X.piece) && X.piece !== "dress";
  const possessive = plural ? `${X.piece}'` : `${X.piece}'s`;
  return [
    `Create ONE ultra-photorealistic, high-converting luxury fashion lifestyle infographic for ${brand}.`,
    `Use the attached product photograph as the exact ${fam === "bag" || fam === "hat" ? "product" : "garment"} reference. The same ${name} must appear throughout the composition, preserving its original ${X.material || "fabric"}, colour, ${X.keep}.`,
    "ART DIRECTION",
    `2028 luxury lifestyle editorial. Inspired by Massimo Dutti, Saint Laurent ${cool ? "autumn" : "summer"} campaigns and contemporary luxury travel magazines.`,
    `Capture the feeling of an effortless, sophisticated ${cool ? "city" : "coastal"} lifestyle.`,
    `A charismatic, naturally ${man ? "masculine male" : "elegant female"} model aged 30–40 ${verb} the exact ${X.piece} at a premium modern ${cool ? "city residence" : "coastal villa"}.`,
    `${cool ? "Soft" : "Warm"} natural daylight, beautiful architectural surroundings, authentic skin texture, natural body language and cinematic photographic realism.`,
    // enige toevoeging aan Justins tekst: de persoon moet echt ogen
    `The model must look like a real person photographed on a real campaign shoot, never a rendered face: subtle facial asymmetry, visible pores, fine lines around the eyes, real hair texture${man ? ", natural stubble" : ""} and naturally proportioned hands. No airbrushed or waxy skin.`,
    "INNOVATIVE EDITORIAL COMPOSITION",
    "Create a highly sophisticated visual narrative within a single portrait image.",
    `One dominant lifestyle photograph occupies approximately 70% of the composition.${X.frame ? " " + X.frame : ""}`,
    "Integrate two smaller editorial photographs seamlessly into the layout:",
    `A candid ${cool ? "city" : "coastal"} lifestyle moment featuring the same model and ${X.piece}.`,
    `An intimate close-up showing the ${possessive} natural ${X.material || "fabric"} and ${X.detail}.`,
    "Use asymmetrical alignment, subtle image overlaps, refined typography and beautiful negative space.",
    "The composition must feel intentionally art-directed rather than like a conventional photo collage.",
    "EXACT ON-IMAGE COPY",
    "Main headline:",
    copy.h1,
    copy.h2,
    "Small supporting statement:",
    copy.support,
    "Three aspirational benefit statements, integrated into the photographic composition:",
    ...copy.points.flat(),
    "Minimal footer:",
    copy.closing,
    brand,
    "CONVERSION OBJECTIVE",
    `Sell the lifestyle associated with ${verb} ${plural ? "these" : "this"} ${X.piece}: confidence, freedom, comfort, attractive personal style and versatility.`,
    `Make the customer imagine ${verb} ${plural ? "them" : "it"} on weekends, holidays, relaxed evenings and ${cool ? "city" : "coastal"} outings.`,
    "The image should create an emotional desire to own the product rather than simply repeating its description.",
    "STRICTLY AVOID",
    "Generic stock photography, artificial expressions, visible information boxes, oversized icons, fake customer testimonials, excessive copy, dated collages, unrealistic fabric and generic e-commerce infographic designs.",
    "Every photograph and typographic detail must feel like part of one cohesive luxury fashion campaign.",
    "OUTPUT: One image only, portrait 4:5, 1K resolution, medium generation quality, optimised for mobile Shopify product pages.",
  ].join("\n");
}
