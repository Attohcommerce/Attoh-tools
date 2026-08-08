// AI-stap: titels + omschrijvingen in de twee bewezen stijlen.
// - "attribute"  → Julia Raven-formule (spec-first, feitelijk, geen emotie)
// - "stacking"   → Stephanie Jennings/Chaim-formule (naam™-first, wervend)
// Beide formules zijn reverse-engineered op basis van 300+ resp. 400+ echte producten.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY env var ontbreekt");
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function extractJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Geen JSON in AI-antwoord");
  return JSON.parse(m[0]);
}

/* ================================================================
   STIJL 1 — ATTRIBUTE (Julia Raven)
   Titel:  Women's Black Mini Dress | Short Sleeve Floral Embroidered
   Body:   A ... DESIGN → intro → WHY CHOOSE THIS/THESE ...: → 4 bullets
================================================================ */
const ATTRIBUTE_STYLE = `TITLE FORMULA — ATTRIBUTE STYLE. Follow this EXACTLY:

Clothing:  <Women's|Men's> [Color] <Product Type> | <Attribute> <Attribute> <Attribute> [Attribute]
Footwear:  [Color] <Shoe Type> For <Women|Men> | <Attribute> <Attribute> <Attribute> [Attribute]

RULES:
- Exactly one " | " separator (space, pipe, space). Never a second pipe, comma or dash as separator.
- Clothing ALWAYS starts "Women's"/"Men's". Footwear ALWAYS uses "... For Women"/"... For Men". Never mixed.
- Left of pipe: 2–5 words (gender + type, optionally color, optionally occasion-type like "Cocktail Dress", "Birthday Dress").
- Right of pipe: 3–5 purely FACTUAL attributes (length, neckline, sleeve, fit, closure, heel, toe, material, print). For dresses/skirts put length (Mini/Midi/Maxi) FIRST after the pipe.
- MATERIAL RULE: if a fabric/material is clearly visible in the photos or stated in the source (Knit, Denim, Linen, Satin, Leather, Suede, Wool, Tweed, Velvet, Corduroy, Mesh, Canvas), include it as one of the attributes — material is one of the strongest apparel search terms.
- FRONT-LOAD: Google shows only ±70 characters (mobile even fewer) and weighs early words heaviest — the keyword/type slot plus the 2 strongest attributes must fall within the first 70 characters.
- Title Case on EVERY word, including "Up", "On", "For", "Neck".
- Color is optional; if used, exactly once, LEFT of the pipe.
- 45–75 characters total (use the space — short vague titles waste free relevance).
- FORBIDDEN in title: any evaluative word (Elegant, Stylish, Chic, Stunning, Beautiful, Premium, Luxury, Perfect, Trendy), brand names, ™, sizes, numbers with units, commas, periods, exclamation marks, parentheses, emoji.

DESCRIPTION FORMULA — ATTRIBUTE STYLE. Output EXACTLY these 6 blocks, nothing more:

<p><strong>A {1-3 UPPERCASE DESCRIPTORS} {PRODUCT NOUN} DESIGN</strong></p>
<p>{2–3 sentences, 35–65 words. MINI-AD ZONE: the exact product keyword must appear inside the first sentence (Google weighs the first ±150 characters of a description heaviest). First sentence starts "This {keyword} features ..." or "These {keyword} feature ...". Following sentences start "It has", "It features" or "The {part}". Weave in 1–2 natural long-tail variants of the keyword (e.g. for "midi dress": "everyday midi dress", "knitted midi dress") ONLY where factually true. Describe ONLY what is visible: neckline, sleeve, closure, hem, silhouette, material, sole, heel, strap.}</p>
<p><strong>WHY CHOOSE THIS {PRODUCT NOUN}:</strong></p>
<ul>
<li><strong>{Label}:</strong> {1–8 word value, no ending period}</li>
<li><strong>{Label}:</strong> {value}</li>
<li><strong>{Label}:</strong> {value}</li>
<li><strong>{Label}:</strong> {value}</li>
</ul>
<p>{Closing sentence, 12–25 words, factual tone, third person only: the product noun once more + 2–3 occasion/pairing long-tails a shopper would search (e.g. "office wear", "weekend outfits", "evening events", "pairs with jeans or skirts"). No "you"/"your".}</p>

- Header 1: always starts with "A" (never "AN"), always ends " DESIGN", all caps, 3–6 words total.
- Header 2: "WHY CHOOSE THESE ...:" for jeans/pants/shorts and ALL footwear; "WHY CHOOSE THIS ...:" for everything else. Ends with a colon.
- EXACTLY 4 bullets. Label sets per category:
  Dresses: Neckline, Sleeve, Print, Hem, Length, Silhouette, Embellishment, Occasion
  Tops/knitwear: Neckline, Sleeve, Closure, Fit, Knit, Collar, Detail, Material
  Jeans/pants/shorts: Waist, Fit, Leg, Closure, Hem, Pockets, Length
  Skirts: Waist, Closure, Length, Split, Pleats, Fit
  Jackets/coats: Hood, Closure, Pockets, Sleeves, Construction, Lining
  Footwear: Toe, Heel, Closure, Sole, Upper, Shaft, Strap, Style
  Opening order: tops→Neckline,Sleeve · bottoms→Waist,Fit · footwear→Toe,Heel (closed shoes: Upper/Closure,Sole) · jackets→Hood,Closure
- "Occasion" allowed only as bullet 4, value = comma list like "Casual, evening events, office wear".
- Tone: 100% factual observation. A narrow register is allowed ONLY tied to a physical feature: "flattering silhouette", "relaxed fit", "versatile", "for enhanced comfort".
- KEYWORD DENSITY TARGET: the product keyword/type appears 2–3× across the whole description (first sentence + closing sentence + optionally one bullet value), long-tail variants 1–2× — always natural, NEVER the same phrase twice in one sentence.
- FORBIDDEN in description: "you"/"your", questions, exclamation marks, sizes or numbers with units, material percentages, care instructions, claims/guarantees, shipping/price text, store name, a 5th bullet, any second paragraph after the closing sentence, emotional superlatives.
- Color may appear in the intro sentence as observation; keep bullets color-free (multi-color variants share one description).`;

/* ================================================================
   STIJL 2 — KEYWORD STACKING (Stephanie Jennings / Chaim)
   Titel:  Leila™ | Elegant Maxi Dress
   Body:   hook → intro (naam herhaald) → Why You'll Love The <Naam>™ | <Type> → 4 benefit-bullets
================================================================ */
const STACKING_STYLE = `TITLE FORMULA — KEYWORD STACKING (branded model-name style). Follow this EXACTLY:

<FirstName>™ | <Evaluative Adjective> [<One Factual Feature>] <Product Type>

RULES:
- Invent a Western female first name, 4–9 letters (Astrid, Selena, Leila, Amelie, Colette, Willow, Nora, Peyton...). For clearly MEN'S products use a male name instead. The name must NOT come from the source title.
- "™" directly after the name, no space. Then " | " (space pipe space).
- After the pipe: FIRST word is always an evaluative adjective (Elegant, Stylish, Chic, Lightweight, Comfortable, Timeless, Classic, Relaxed, Graceful, Effortless, Cozy, Refined, Modern, Flattering, Soft). LAST word(s) = the product type. Optionally ONE factual feature in between (print, cut, material or function: Leopard Print, Floral, Striped, V-Neck, Wide Leg, Tweed, Velvet, Knit).
- Alternative allowed shape: <Name>™ | <Adjective> <Type> with <Detail>  (e.g. "Nora™ | Sleeveless Top with Square Neckline").
- Title Case; 28–55 characters total; 2–6 words after the pipe.
- FORBIDDEN in title: color words (prints are fine, colors are not), "Women's"/"Ladies" as opener, sizes, percentages, seasons+year, SALE/NEW, exclamation marks, emoji, a second pipe.

DESCRIPTION FORMULA — KEYWORD STACKING. Output EXACTLY this structure:

<h3><strong>{Hook: 4–9 word claim, e.g. "Graceful Elegance for Any Occasion", "Timeless Style with Everyday Comfort"}</strong></h3>
<p>{2–3 sentences, 30–60 words, second person ("you"/"your"). MINI-AD ZONE: the product type keyword must appear within the first ±150 characters. MUST mention "the {Name}™ | {TitleRest}" or "the {Name}™ {Type}" literally once. MUST contain an occasion-triple: "perfect for {X}, {Y}, or {Z}" using occasions shoppers actually search (casual outings, office wear, date nights, weekend brunch, evening events).}</p>
<p style="text-align: center;">{{IMAGE_1}}</p>
<h3><strong>Why You'll Love The {Name}™ | {TitleRest}</strong></h3>
<ul>
<li><strong>{Benefit Label}:</strong> {8–18 words}</li>
<li><strong>{Benefit Label}:</strong> {8–18 words}</li>
<li><strong>{Benefit Label}:</strong> {8–18 words}</li>
<li><strong>{Benefit Label}:</strong> {8–18 words}</li>
</ul>
<p style="text-align: center;">{{IMAGE_2}}</p>
<p><strong>{Soft closing line WITHOUT stock/urgency claims, e.g. "Add the {Name}™ to your wardrobe and enjoy effortless style every day."}</strong></p>

- Keep the literal placeholders {{IMAGE_1}} and {{IMAGE_2}} exactly as written — the importer swaps them for real photos.
- Bullet labels are benefit-phrases of 2–4 words (Elegant Fit, Versatile Style, Lightweight Comfort, Flattering Silhouette, Thoughtful Design, Soft Breathable Fabric). Bullets are 10–20 words each; TWO of the four bullets must contain the product type keyword or a long-tail variant of it. Bullet 1 echoes the title feature/adjective. Bullet 4 ideally ends with a pairing-triple: "Pairs effortlessly with jeans, skirts, or trousers."
- Keyword stacking mechanics (this is the point of the style): the product type appears 3–4× in the body, the title adjective 2×, the feature 2×, PLUS 1–2 natural long-tail variants of the product type (e.g. "knitted midi dress", "everyday midi dress") — spread over intro, bullets and the closing line. Density ≈5%, never spammy repetition of the same sentence, never the same phrase twice in one sentence.
- Body length 110–170 words (excluding image placeholders) — longer than before, but every sentence must still earn its place: no filler.
- Emotional lexicon to draw from: effortless, elegant, comfort, soft, lightweight, breathable, all-day, flattering, versatile, timeless, chic, refined, graceful, silhouette, wardrobe.
- FORBIDDEN: stock claims or urgency ("limited stock", "selling fast", "order now before"), guarantees, review counts, percentages, prices, shipping text, medical claims, size charts, emoji, <h1>/<h2>, more or fewer than 4 bullets.`;

/* ================================================================
   VALIDATIE — harde formule-checks op de AI-output. Faalt de output,
   dan krijgt het model zijn fouten terug en moet het corrigeren.
================================================================ */
function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

export function validateListing({ title, descriptionHtml }, { listingStyle, requiredKeyword }) {
  const issues = [];
  const t = String(title || "").trim();
  const d = String(descriptionHtml || "");
  const pipes = (t.match(/\|/g) || []).length;
  const liCount = (d.match(/<li[\s>]/g) || []).length;
  const kw = String(requiredKeyword || "").trim().toLowerCase();

  if (listingStyle === "attribute") {
    if (pipes !== 1) issues.push(`title must contain exactly one " | " separator (found ${pipes})`);
    if (t.length < 35 || t.length > 85) issues.push(`title is ${t.length} characters — must be 45–75`);
    if (!/^(Women's|Men's)\s/i.test(t) && !/\bFor (Women|Men)\b/i.test(t))
      issues.push(`title must start with "Women's"/"Men's" (clothing) or contain "For Women"/"For Men" (footwear)`);
    if (/(elegant|stylish|chic|stunning|beautiful|premium|luxury|perfect|trendy)/i.test(t))
      issues.push("title contains a forbidden evaluative word");
    if (/[,™!()]/.test(t)) issues.push("title contains a forbidden character (comma, ™, ! or parentheses)");
    if (/\d/.test(t)) issues.push("title contains digits");
    if (!/WHY CHOOSE (THIS|THESE)/i.test(d)) issues.push(`description is missing the "WHY CHOOSE THIS/THESE ...:" header`);
    if (liCount !== 4) issues.push(`description must have exactly 4 bullets (found ${liCount})`);
    if (/\b(you|your)\b/i.test(stripHtml(d))) issues.push(`description may not use "you"/"your" in attribute style`);
  } else {
    if (!/^[A-Z][A-Za-z]{3,8}™ \| /.test(t))
      issues.push(`title must start "<Name>™ | " — a 4–9 letter first name with ™ attached, then " | "`);
    if (pipes !== 1) issues.push(`title must contain exactly one pipe (found ${pipes})`);
    if (t.length < 26 || t.length > 60) issues.push(`title is ${t.length} characters — must be 28–55`);
    if (liCount !== 4) issues.push(`description must have exactly 4 bullets (found ${liCount})`);
    if (!d.includes("{{IMAGE_1}}") || !d.includes("{{IMAGE_2}}"))
      issues.push("description must keep the literal {{IMAGE_1}} and {{IMAGE_2}} placeholders");
    if (!/Why You'll Love/i.test(d)) issues.push(`description is missing the "Why You'll Love ..." header`);
  }
  if (kw && !t.toLowerCase().includes(kw))
    issues.push(`required keyword "${requiredKeyword}" is missing from the title — it must appear literally`);
  return issues;
}

/* ================================================================
   CIJFER — beoordeelt titel + omschrijving op keyword/trend-logica
   uit onze eigen research. Deterministisch, geen extra AI-call.
   10 = formule-perfect én maximale keyword-benutting.
================================================================ */
export function scoreListing({ title, descriptionHtml }, { listingStyle, requiredKeyword }) {
  const notes = [];
  let score = 10;
  const t = String(title || "").trim();
  const bodyText = stripHtml(descriptionHtml || "").toLowerCase();
  const kw = String(requiredKeyword || "").trim().toLowerCase();

  // 1. Formule-overtredingen wegen het zwaarst
  const issues = validateListing({ title, descriptionHtml }, { listingStyle, requiredKeyword });
  if (issues.length) {
    score -= Math.min(4, issues.length * 1.5);
    notes.push(`${issues.length} formule-afwijking(en): ${issues[0]}`);
  }

  // 2. Keyword-benutting (de kern van de research)
  if (kw) {
    const lower = t.toLowerCase();
    if (!lower.includes(kw)) {
      score -= 3;
      notes.push("keyword ontbreekt in de titel");
    } else if (listingStyle === "attribute") {
      const pipe = t.indexOf("|");
      if (pipe > -1 && lower.indexOf(kw) > pipe) {
        score -= 1;
        notes.push("keyword staat rechts van de pipe i.p.v. in het type-slot");
      }
    }
    const hits = bodyText.split(kw).length - 1;
    if (listingStyle === "stacking") {
      if (hits < 3) {
        score -= 1;
        notes.push(`keyword ${hits}× in omschrijving (stacking-doel: 3-4×)`);
      } else if (hits > 6) {
        score -= 0.5;
        notes.push(`keyword ${hits}× in omschrijving — stuffing-risico`);
      }
    } else {
      if (hits < 2) {
        score -= 1;
        notes.push(`keyword ${hits}× in omschrijving (doel: 2-3×, incl. slotzin)`);
      } else if (hits > 5) {
        score -= 0.5;
        notes.push(`keyword ${hits}× in omschrijving — stuffing-risico`);
      }
    }
    // Mini-ad zone: Google weegt de eerste ±150-180 tekens het zwaarst
    if (!bodyText.slice(0, 180).includes(kw)) {
      score -= 1;
      notes.push("keyword valt buiten de eerste 180 tekens van de omschrijving (mini-ad zone)");
    }
  }

  // 3. Titel-lengte sweet spot (Google toont ±70 tekens; front-loaded 45-75 is ideaal)
  const sweet = listingStyle === "attribute" ? [45, 75] : [28, 55];
  if (t.length < sweet[0] || t.length > sweet[1]) {
    score -= 0.5;
    notes.push(`titellengte ${t.length} — ideaal is ${sweet[0]}-${sweet[1]} tekens`);
  }

  // 4. Attribuut-dichtheid rechts van de pipe (alleen attribuut-stijl)
  if (listingStyle === "attribute") {
    const right = (t.split("|")[1] || "").trim().split(/\s+/).filter(Boolean).length;
    if (right < 3) {
      score -= 0.5;
      notes.push(`maar ${right} attribuut-woorden rechts van de pipe (doel 3-5)`);
    }
  }

  score = Math.max(1, Math.round(score * 10) / 10);
  return { score, notes };
}

export async function generateListing({ product, settings }) {
  const {
    listingStyle = "stacking", // "stacking" | "attribute"
    requiredKeyword = "",
    genderPrefix = false,
    forceMensKeywords = false,
  } = settings || {};

  const styleBlock = listingStyle === "attribute" ? ATTRIBUTE_STYLE : STACKING_STYLE;

  const system = `You write Shopify product listings for fashion dropshipping stores, optimized for Google Shopping (Google Merchant Center). You return ONLY valid JSON, nothing else.

UNIVERSAL GMC RULES (apply on top of the style formula):
- No promotional text in the title: no "sale", "free shipping", "discount", "%", "best", "cheap", "hot".
- No unverifiable claims anywhere: no "premium quality guaranteed", no review counts, no "bestseller", no money-back promises.
- No brand names you were not given, no celebrity names, no "as seen on".
- Describe the correct gender.
- Write in English.
- The description must be plagiarism-safe: NEVER copy sentences from the source description — write fresh text based on what the product IS.

HOW TO USE YOUR SOURCES (in order of authority):
1. THE PHOTOS are the primary source of truth. Derive gender, color, neckline, sleeve type, length, silhouette, closure, heel/toe shape and visible material texture from what you actually SEE. Every attribute you write must be visually verifiable in the photos.
2. The source title/description is secondary: use it only to confirm details you cannot see (inner lining, material name) — it may be spammy, machine-translated or plain wrong. When text and photo conflict, THE PHOTO WINS.
3. Never invent attributes that are neither visible nor stated.

${styleBlock}`;

  const userParts = [
    `SOURCE PRODUCT (raw scrape — information source only, never copy its phrasing):
Title: ${product.title}
Type: ${product.productType || "-"}
Tags: ${product.tags || "-"}
Options: ${(product.options || []).map((o) => `${o.name}: ${(o.values || []).join("/")}`).join(" | ") || "-"}
Description text:
${String(product.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2200)}`,
  ];

  if (requiredKeyword) {
    userParts.push(
      listingStyle === "attribute"
        ? `REQUIRED KEYWORD: "${requiredKeyword}" — use this literally as the product-type slot LEFT of the pipe (e.g. "Women's ${requiredKeyword} | ..."). It must also appear at least once in the description intro.`
        : `REQUIRED KEYWORD: "${requiredKeyword}" — use this literally as the product type at the END of the title (e.g. "<Name>™ | Elegant ${requiredKeyword}") and 2–3 times in the description.`
    );
  }
  if (genderPrefix && listingStyle !== "attribute") {
    userParts.push(
      `GENDER HINT: make the gender explicit in the description wording (the title formula itself has no gender word).`
    );
  }
  if (forceMensKeywords) {
    userParts.push(
      `FORCE MEN'S: This is a men's product. Use a male model name (stacking) or "Men's ..."/"... For Men" (attribute), and male-targeted wording throughout.`
    );
  }
  userParts.push(
    `Return JSON exactly like: {"title": "...", "description_html": "...", "detected_gender": "Men|Women|Unisex"}
CRITICAL: your ENTIRE response must be that single JSON object — no explanations, no image descriptions, no markdown fences, no text before or after the JSON.`
  );

  // Foto's meesturen (max 3): het model KIJKT naar het product i.p.v. blind
  // op de (vaak rommelige) bron-tekst te vertrouwen.
  const imageUrls = (product.images || [])
    .map((im) => (typeof im === "string" ? im : im && im.src))
    .filter((u) => typeof u === "string" && /^https?:\/\//.test(u))
    .slice(0, 3);

  const buildContent = (withImages, extraText) => {
    const content = [];
    if (withImages) {
      for (const url of imageUrls) {
        content.push({ type: "image", source: { type: "url", url } });
      }
    }
    let text = userParts.join("\n\n");
    if (extraText) text += "\n\n" + extraText;
    content.push({ type: "text", text });
    return content;
  };

  const callModel = async (content) => {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 2000,
      // Prompt caching: de lange stijl-formule is identiek voor elk product in
      // een batch — Anthropic rekent hem maar één keer per 5 min i.p.v. per product.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });
    const out = extractJson(res.content.map((c) => c.text || "").join(""));
    let title = String(out.title || "").trim();
    if (title.length > 150) title = title.slice(0, 147).replace(/\s+\S*$/, "") + "…";
    return {
      title,
      descriptionHtml: String(out.description_html || "").trim(),
      detectedGender: out.detected_gender || "Unisex",
    };
  };

  // Poging 1 — met foto's. Faalt dat om WELKE reden dan ook (dode
  // afbeeldings-URL, model dat door de foto's uit z'n JSON-vorm schiet,
  // "Geen JSON in AI-antwoord"), dan exact dezelfde prompt zonder foto's —
  // dat was maandenlang de betrouwbare basis.
  let listing;
  try {
    listing = await callModel(buildContent(true));
  } catch (e) {
    if (imageUrls.length) {
      listing = await callModel(buildContent(false));
    } else {
      throw e;
    }
  }

  // Validatie + maximaal 2 correctierondes: het model krijgt zijn exacte
  // overtredingen terug en moet een gecorrigeerde versie leveren.
  let issues = validateListing(listing, { listingStyle, requiredKeyword });
  for (let round = 0; issues.length && round < 2; round++) {
    const feedback = `YOUR PREVIOUS ATTEMPT FAILED VALIDATION.
Previous title: ${listing.title}
Violations that MUST all be fixed:
${issues.map((i) => `- ${i}`).join("\n")}
Return the corrected JSON. Change ONLY what is needed to fix the violations; keep everything that was already correct.`;
    try {
      listing = await callModel(buildContent(imageUrls.length > 0, feedback));
    } catch {
      break;
    }
    issues = validateListing(listing, { listingStyle, requiredKeyword });
  }

  return { ...listing, warnings: issues };
}

// Branding-check op productfoto's vóór upload: elke foto met concurrent-
// branding (logo's, watermerken, verpakkingen, thank-you-cards, tekst-
// overlays) wordt gemarkeerd en NIET mee-geïmporteerd. Streng: bij twijfel
// wordt geflagd — één doorgeslipte concurrent-foto is een GMC-probleem.
export async function flagBrandedImages(images) {
  // images: [{index, url}] → [{index, reason}] van wat WEG moet
  const content = [];
  for (const im of images) {
    content.push({ type: "text", text: `IMAGE ${im.index}:` });
    content.push({ type: "image", source: { type: "url", url: im.url } });
  }
  content.push({
    type: "text",
    text: `Screen every image above. Return ONLY JSON: {"remove": [{"index": 0, "reason": "..."}]} — an entry for every image that must be removed. If all images are clean, return {"remove": []}.`,
  });

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 800,
    system: `You screen scraped fashion product photos before they are uploaded to a NEW store. FLAG every image that contains ANY competitor branding or identifying content:
- visible brand or store names, logos, monograms or wordmarks — printed ON the image, on packaging, on labels, on swing tags or on the garment itself
- watermarks or text overlays of any kind: store names, URLs, social handles, promo text ("SALE", "NEW"), size charts, collages or infographics with readable text
- packaging/unboxing shots: mailer bags, ziplock bags, boxes, tissue paper, thank-you cards, branded hangers or ribbons
- images that are clearly another store's marketing material rather than a clean product photo
DO NOT flag clean product photos (on a model, mannequin or flat-lay) without readable branding; tiny illegible care labels are fine.
STRICT MODE: when in doubt whether branding or readable text is present, FLAG IT.
Reasons: brand-name | watermark | packaging | marketing | text.
Return ONLY the JSON object, nothing else.`,
    messages: [{ role: "user", content }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.remove || []).filter((r) => Number.isInteger(r.index));
}

// Merken/rommel-check voor de Keywords-module: welke zoektermen zijn GEEN
// echte product-zoekopdrachten? (merken, winkels, platforms, personen, ruis)
export async function classifyJunkKeywordsBatch(keywords, opts = {}) {
  // keywords: [{index, kw}] → geeft [{index, reason}] terug van wat WEG moet
  // opts.market: "USA" | "UK" | "AUS" | "CAN" — dan worden ook termen geflagd
  // die niet bij die markt horen (Brits "jumpers" op een US-store etc.)
  const list = keywords.map((k) => `${k.index}. ${k.kw}`).join("\n");

  const marketBlock = opts.market
    ? `\nThis store sells in: ${opts.market}. ALSO FLAG vocabulary that shoppers in that market do NOT use (reason: "market"):
- For USA: British/AU-only terms like "jumpers" (US = sweaters), "trainers" (US = sneakers), "wellies", "dungarees" (US = overalls), "waistcoat" (US = vest), "swimming costume", "pinafore", "court shoes" (US = pumps), "jumper dress".
- For UK/AUS: American-only terms like "pantyhose", "suspenders" (meaning braces) only when clearly mismatched.
Only flag CLEAR mismatches; terms used in both markets stay.`
    : "";

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1800,
    system: `You review Google Keyword Planner search terms for a fashion dropshipping store. Flag every term that is NOT a generic product search. FLAG when the term is or contains:
- a brand or designer name (e.g. "romanoriginals", "halston designer", "carhartts")
- a retailer, marketplace, platform, app or website (e.g. "vinted uk", "& other stories", "tu clothing")
- a store/navigational query (near me, shop, outlet, opening hours)
- a person or celebrity name
- gibberish or something nobody would sell as a product${marketBlock}
DO NOT flag generic product searches, even broad ones ("dresses", "hoodies", "black dress" are all fine).
Return ONLY JSON: {"remove": [{"index": 3, "reason": "brand"}, ...]} — reasons: brand | platform | navigational | person | noise | market. If nothing should be removed return {"remove": []}.`,
    messages: [{ role: "user", content: list }],
  });

  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.remove || []).filter((r) => Number.isInteger(r.index));
}

// Geslacht-check voor de scraper-sheet: batch van rijen → besliste labels, geen twijfel.
export async function classifyGenderBatch(rows) {
  // rows: [{index, title, keyword}]
  const list = rows
    .map((r) => `${r.index}. TITLE: ${r.title} | KEYWORD: ${r.keyword}`)
    .join("\n");

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: `You classify fashion products as "Man" or "Vrouw" (Dutch for men's/women's product). You MUST decide for every row — never answer unknown/unisex; when in doubt pick the most likely one based on the product title and the keyword it was found for. Return ONLY JSON: {"labels": [{"index": 1, "label": "Man"}, ...]}`,
    messages: [{ role: "user", content: list }],
  });

  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  const map = {};
  for (const l of out.labels || []) {
    map[l.index] = l.label === "Man" ? "Man" : "Vrouw";
  }
  return map;
}

// Underdog-keywords: AI bedenkt alternatieve zoektermen die stores WEL in hun
// titels gebruiken, met exact dezelfde product-intentie. De scraper zoekt
// daarop verder maar schrijft het ORIGINELE keyword in de sheet.
export async function suggestAlternativeKeywords(keyword, gender) {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `You help a fashion product scraper. A search keyword found ZERO products in store catalogs because stores phrase their product titles differently. Suggest up to 4 ALTERNATIVE search terms that stores DO use in product titles/types, with the SAME product intent as the original keyword.
Rules:
- Same garment category and occasion as the original. "wedding guest clothes" → "wedding guest dress", "occasion dress", "formal midi dress" — NOT "jeans".
- Order from closest match to slightly broader.
- Terms must be short generic product phrases (2-4 words), no brand names.
- Match the gender: ${gender === "Man" ? "menswear" : "womenswear"}.
Return ONLY JSON: {"alternatives": ["...", "..."]}`,
    messages: [{ role: "user", content: `Original keyword: ${keyword}` }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.alternatives || [])
    .map((a) => String(a).trim())
    .filter((a) => a && a.toLowerCase() !== String(keyword).toLowerCase())
    .slice(0, 4);
}

// Batch-versie: alternatieven voor ALLE keywords in één AI-call, vóór de run
// begint. items: [{index, kw, gender}] → { [index]: ["alt1","alt2",...] }
export async function suggestAlternativeKeywordsBatch(items) {
  const list = items
    .map((i) => `${i.index}. [${i.gender === "Man" ? "men" : "women"}] ${i.kw}`)
    .join("\n");
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: `You help a fashion product scraper. For EACH search keyword below, suggest up to 4 ALTERNATIVE search terms that online fashion stores actually use in their product titles, with the SAME product intent as the original.
Rules per keyword:
- Same garment category and occasion. "wedding guest clothes" → "wedding guest dress", "occasion dress", "formal midi dress" — never a different category.
- Order from closest match to slightly broader; the LAST one may be the bare product type (e.g. "dress").
- Short generic phrases (1-4 words), no brand names.
- Respect the gender tag on each line.
Return ONLY JSON: {"results": [{"index": 0, "alts": ["...", "..."]}, ...]} — one entry per keyword, in the same order.`,
    messages: [{ role: "user", content: list }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  const map = {};
  for (const r of out.results || []) {
    if (!Number.isInteger(r.index)) continue;
    map[r.index] = (r.alts || [])
      .map((a) => String(a).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 4);
  }
  return map;
}

// AI-vision dubbelcheck: producten die via een ALTERNATIEF zoekwoord gevonden
// zijn ("cocktail dresses" gevonden via "dress") worden op titel + FOTO
// beoordeeld: is dit écht het gevraagde product? Alleen goedgekeurde
// producten komen in de sheet.
export async function verifyProductsForKeyword(keyword, gender, items) {
  // items: [{index, title, image|null}]
  const content = [];
  for (const it of items) {
    content.push({ type: "text", text: `--- PRODUCT ${it.index} ---\nTitle: ${it.title}` });
    if (it.image) {
      try {
        content.push({ type: "image", source: { type: "url", url: it.image } });
      } catch {}
    }
  }
  content.push({
    type: "text",
    text: `Judge each product above. Return ONLY JSON: {"reject": [{"index": 2, "reason": "..."}]} — an entry for every product that is NOT truly a match. If all match, return {"reject": []}.`,
  });

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 900,
    system: `You verify scraped fashion products. The customer searched for: "${keyword}" (${gender === "Man" ? "menswear" : "womenswear"}).
For each product (title + photo) decide: is this SPECIFIC product truly a "${keyword}"?
- The photo is the strongest evidence — trust what you SEE over the title.
- REJECT anything that is a different garment category (a cardigan is not a coat, a jumpsuit is not a dress), an accessory (bags, covers, hangers, jewelry), or clearly the wrong gender.
- For qualified keywords (e.g. "cocktail dress", "fur coat", "knee high boots"): the qualifier must genuinely apply to what you see — an everyday casual dress is NOT a cocktail dress; a plain wool coat is NOT a fur coat.
- Be strict but fair: a product that a shopper searching "${keyword}" would happily buy counts as a match.`,
    messages: [{ role: "user", content }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.reject || []).filter((r) => Number.isInteger(r.index));
}
