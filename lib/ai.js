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

/* KOSTEN: vision rekent per pixel. Shopify's CDN levert elke foto óók
   verkleind via een URL-parameter — zelfde foto, zelfde beoordeling, tot
   8x minder tokens. Volle resolutie naar de AI sturen was de grootste
   kostenpost van de hele tool (tot 20 foto's per product bij de
   branding-check). 640px is ruim genoeg om logo's, watermerken, kleuren
   en modellen te beoordelen. */
function thumb(url, w = 640) {
  try {
    const u = new URL(String(url));
    if (!/\.(shopify|shopifycdn)\./.test(u.hostname) && !u.hostname.includes("cdn.shopify.com")) return String(url);
    u.searchParams.set("width", String(w));
    return u.toString();
  } catch {
    return String(url);
  }
}

/* Vangnet voor de titelvorm van gelegenheids-keywords. Hoort uit de
   AI-briefing te komen (kolom K), maar als die leeg is mag de titel NOOIT
   terugvallen op het rauwe keyword — "fall wedding guest outfit" is geen
   titel. Deterministische regel: seizoenswoorden eruit, outfit/look wordt
   een kledingstuk, meervoud enkelvoud, Title Case. */
const TF_SEASONS = /\b(fall|autumn|winter|spring|summer)\b/g;
const TF_OUTFIT = /\b(outfits?|looks?|ideas?|styles?)\b/g;
const TF_GARMENT = /\b(dress|dresses|gown|gowns|top|tops|skirt|skirts|suit|suits|jumpsuit|heels|boots|sweater|sweaters|hoodie|hoodies|shirt|shirts|blouse|blouses|pants|jeans)\b/;
export function fallbackTitleForm(kw) {
  let t = String(kw || "").toLowerCase();
  t = t.replace(TF_SEASONS, " ").replace(TF_OUTFIT, " ").replace(/\s+/g, " ").trim();
  if (!TF_GARMENT.test(t)) t = (t + " dress").trim();
  // laatste woord enkelvoud: "gowns" → "gown", "dresses" → "dress"
  t = t.replace(/(\w+?)(sses|ches|shes|xes)$/, (m, a, b) => a + b.slice(0, -2));
  t = t.replace(/(\w{3,})s$/, (m, a) => (a.endsWith("s") ? m : a));
  return t.split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function extractJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, " ");
  const m = cleaned.match(/\{[\s\S]*\}/);
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

// Keyword-check op TOKEN-niveau i.p.v. letterlijke frase. Nodig omdat de
// formules woordvolgorde mogen omgooien: keyword "womens sneakers" wordt in
// schoenen-titels correct "White Sneakers For Women | ..." — letterlijk
// matchen keurt dan perfecte titels af. Elke betekenisvolle token van het
// keyword moet (enkelvoud/meervoud-ongevoelig) in de tekst voorkomen.
const KW_SKIP = new Set(["for", "the", "a", "an", "with", "and", "&"]);
function kwTokens(kw) {
  return String(kw || "")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((t) => t.replace(/'s$/, "").replace(/s$/, ""))
    .filter((t) => t && !KW_SKIP.has(t));
}
export function keywordSatisfied(text, kw) {
  const tokens = kwTokens(kw);
  if (!tokens.length) return true;
  const hay = new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map((t) => t.replace(/'s$/, "").replace(/s$/, ""))
      .filter(Boolean)
  );
  return tokens.every((t) => hay.has(t));
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
  if (kw && !t.toLowerCase().includes(kw) && !keywordSatisfied(t, kw))
    issues.push(`required keyword "${requiredKeyword}" is missing from the title — every word of it must appear (word order may follow the title formula)`);
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
    const inTitle = lower.includes(kw) || keywordSatisfied(t, kw);
    if (!inTitle) {
      score -= 3;
      notes.push("keyword ontbreekt in de titel");
    } else if (listingStyle === "attribute" && lower.includes(kw)) {
      const pipe = t.indexOf("|");
      if (pipe > -1 && lower.indexOf(kw) > pipe) {
        score -= 1;
        notes.push("keyword staat rechts van de pipe i.p.v. in het type-slot");
      }
    }
    // Frase-telling; staat de frase er 0× maar zijn alle woorden wel aanwezig
    // (omgegooide volgorde), dan telt dat als 1 voorkomen.
    let hits = bodyText.split(kw).length - 1;
    if (hits === 0 && keywordSatisfied(bodyText, kw)) hits = 1;
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
    titleForm = "", // natuurlijke titelvorm van het keyword (uit de briefing)
    keywordType = "", // Direct | Attribuut | Gelegenheid
    genderPrefix = false,
    forceMensKeywords = false,
  } = settings || {};
  // Bij gelegenheids-keywords ("autumn wedding guest dresses") gaat de
  // natuurlijke vorm in de TITEL en de exacte frase in de OMSCHRIJVING.
  const isOccasionKw = keywordType === "Gelegenheid";
  let titleKeyword = (isOccasionKw && titleForm) || requiredKeyword;
  /* De titel-formule zet zélf al "Men's"/"Women's" vooraan. Zit het geslacht
     óók in het keyword ("mens sweaters"), dan werd dat "Men's Mens
     Sweaters | ..." — geslachtswoorden gaan dus uit het titel-slot. De
     volledige zoekterm blijft gewoon in de omschrijving staan. */
  titleKeyword = titleKeyword
    .replace(/\b(men'?s?|women'?s?|ladies|for men|for women)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || requiredKeyword;

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
        ? `REQUIRED KEYWORD: "${titleKeyword}" — use this literally as the product-type slot LEFT of the pipe (e.g. "Women's ${titleKeyword} | ..."). It must also appear at least once in the description intro.`
        : `REQUIRED KEYWORD: "${titleKeyword}" — use this literally as the product type at the END of the title (e.g. "<Name>™ | Elegant ${titleKeyword}") and 2–3 times in the description.`
    );
    if (isOccasionKw && requiredKeyword.toLowerCase() !== String(titleKeyword).toLowerCase()) {
      userParts.push(
        `OCCASION LONG-TAIL: shoppers also search the exact phrase "${requiredKeyword}". Do NOT force that phrase into the title (it would read unnaturally) — instead work it into the DESCRIPTION exactly once, in a natural sentence, e.g. "...an easy choice for ${requiredKeyword}." Keep it grammatical; adapt only articles/plurals around it, never the phrase itself.`
      );
    }
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
        content.push({ type: "image", source: { type: "url", url: thumb(url, 640) } });
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
      // 3000: een lange stacking-omschrijving haalde soms de 2000 en dan
      // breekt de JSON halverwege af — dat oogde als "Geen JSON".
      max_tokens: 3000,
      // Prompt caching: de lange stijl-formule is identiek voor elk product in
      // een batch — Anthropic rekent hem maar één keer per 5 min i.p.v. per product.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      // Prefill: het antwoord BEGINT als "{" — het model kán niet meer met
      // proza of een foto-beschrijving openen. Dit maakte "Geen JSON in
      // AI-antwoord" vrijwel onmogelijk i.p.v. hopen op gehoorzaamheid.
      messages: [
        { role: "user", content },
        { role: "assistant", content: "{" },
      ],
    });
    const out = extractJson("{" + res.content.map((c) => c.text || "").join(""));
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
  let issues = validateListing(listing, { listingStyle, requiredKeyword: titleKeyword });
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
    issues = validateListing(listing, { listingStyle, requiredKeyword: titleKeyword });
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
    content.push({ type: "image", source: { type: "url", url: thumb(im.url, 640) } });
  }
  content.push({
    type: "text",
    text: `Screen every image above. Return ONLY JSON: {"remove": [{"index": 0, "reason": "..."}]} — an entry for every image that must be removed. If all images are clean, return {"remove": []}.`,
  });

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 800,
    system: [{ type: "text", cache_control: { type: "ephemeral" }, text: `You screen scraped fashion product photos before they are uploaded to a NEW store. FLAG every image that contains ANY competitor branding or identifying content:
- visible brand or store names, logos, monograms or wordmarks — printed ON the image, on packaging, on labels, on swing tags or on the garment itself
- watermarks or text overlays of any kind: store names, URLs, social handles, promo text ("SALE", "NEW"), size charts, collages or infographics with readable text
- packaging/unboxing shots: mailer bags, ziplock bags, boxes, tissue paper, thank-you cards, branded hangers or ribbons
- images that are clearly another store's marketing material rather than a clean product photo
DO NOT flag clean product photos (on a model, mannequin or flat-lay) without readable branding; tiny illegible care labels are fine.
STRICT MODE: when in doubt whether branding or readable text is present, FLAG IT.
Reasons: brand-name | watermark | packaging | marketing | text.
Return ONLY the JSON object, nothing else.` }],
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
- a brand or designer name — INCLUDING misspellings and reversed word orders. Real examples that slipped through before and MUST be caught: "frye boots" (Frye), "northern face jacket" (The North Face misspelled), "jeans purple" (Purple Brand denim — note: "purple jeans" as a color IS fine, "jeans purple" is the brand search), "docmart boots" (Dr. Martens).
- a retailer, marketplace, platform, app or website (e.g. "vinted uk", "& other stories", "tu clothing", "fashion nova")
- a store/navigational query (near me, shop, outlet, opening hours)
- a person or celebrity name
- an ARTIFACT phrase no real shopper types — machine-generated variant phrasings like "fall wedding attendee dress" or "bridal guest dress" (real term: "wedding guest dress"). Test: would a normal person type this into Google? If clearly not, flag as "artifact".
- gibberish or something nobody would sell as a product${marketBlock}
DO NOT flag generic product searches, even broad ones ("dresses", "hoodies", "black dress" are all fine).
Return ONLY JSON: {"remove": [{"index": 3, "reason": "brand"}, ...]} — reasons: brand | platform | navigational | person | artifact | noise | market. If nothing should be removed return {"remove": []}.`,
    messages: [{ role: "user", content: list }],
  });

  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.remove || []).filter((r) => Number.isInteger(r.index));
}

// GERICHTE MERK-CHECK op onbekende woorden. De mode-woordenschat in
// lib/brands.js markeert elk woord dat geen bekende mode-term is; die
// woorden krijgen hier één scherpe vraag: is dit een merk/eigennaam of
// gewoon een mode-woord dat we nog niet kenden? Eén nauwe vraag is véél
// betrouwbaarder dan "beoordeel deze keyword-lijst in het algemeen".
export async function classifyUnknownTokens(items) {
  // items: [{kw, unknown: ["veja"]}] → [{kw, reason}]
  if (!items.length) return [];
  const list = items
    .map((i, n) => `${n}. keyword: "${i.kw}" — unrecognised word(s): ${i.unknown.join(", ")}`)
    .join("\n");
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: `For each line below, a fashion keyword contains one or more words that are NOT in a dictionary of generic fashion vocabulary (garment types, cuts, materials, colours, occasions, fits).

For every line decide what the unrecognised word actually is:
- "brand" — a clothing/footwear brand, label, designer or retailer (Veja, Frye, Steve Madden, Aritzia, Shein, On, Purple Brand…). Includes misspellings and plurals ("vejas", "northern face"). THIS IS THE MOST COMMON CASE — be suspicious of any word that looks like a company or surname.
- "proper-noun" — a person, celebrity, city, country or other name
- "non-fashion" — a word from another product category entirely (electronics, food, sports gear, tools)
- "fashion" — a legitimate fashion word the dictionary simply missed (e.g. a garment style, fabric or trend term a shopper would recognise: "peplum", "gorpcore", "balletcore", "tabi")

Return ONLY JSON: {"verdicts": [{"i": 0, "type": "brand"}, ...]} — one entry per line, in order.`,
    messages: [{ role: "user", content: list }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  const bad = [];
  for (const v of out.verdicts || []) {
    const item = items[v.i];
    if (!item) continue;
    if (v.type && v.type !== "fashion") bad.push({ kw: item.kw, reason: v.type });
  }
  return bad;
}

// Holistische eind-QA op de COMPLETE verdeling: de laatste verdedigingslinie.
// Ziet de hele tabel in samenhang (i.t.t. de per-keyword check) en vangt wat
// alleen in context opvalt: overgebleven merken, artefact-frasen, duplicate
// intenties en verkeerde-markt-termen. Alles wat hier sneuvelt wordt
// uitgesloten en de verdeling wordt opnieuw berekend — het budget vloeit
// automatisch naar het volgende beste keyword.
export async function reviewVerdelingFinal(rows, market, storeUrl) {
  // rows: [{kw, col, n}] → [{kw, reason}]
  const list = rows.map((r) => `- "${r.kw}" (${r.col}, ${r.n} products)`).join("\n");
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: `You are the FINAL quality gate for a fashion store's keyword/product plan${market ? ` for the ${market} market` : ""}. The store${storeUrl ? ` (${storeUrl})` : ""} is a general fashion boutique selling everyday clothing, shoes and outerwear — NOT a sports/athletics shop. Below is the complete chosen plan. Products will be sourced and advertised on Google Shopping under these exact keywords, so every bad keyword wastes real money.

Flag every keyword that is:
- a brand/designer/retailer, including misspellings and reversed orders ("frye boots", "northern face jacket", "jeans purple" = Purple Brand)
- an artifact phrase real shoppers don't type ("fall wedding attendee dress", "bridal guest dress")
- wrong vocabulary for the market${market === "USA" ? ' (British terms like "jumpers", "trainers", "wellies" on a US store)' : ""}
- a duplicate intent of another keyword IN THIS LIST — flag the LESS natural phrasing of the pair
- a WRONG-AUDIENCE keyword: this store sells to ADULT shoppers. Flag teen/school events (homecoming, hoco, prom, quinceanera, sweet 16, back-to-school) and anything for children (kids, toddler, girls'/boys' sizes). An adult occasion that merely mentions a youthful word is fine ("girls night out dress" is adult).
- an ASSORTMENT MISFIT: sport-function or niche gear that doesn't belong in a fashion boutique ("volleyball shoes", "running shoes", "cleats", "running spikes", "soccer jersey", "hiking crampons", "swim goggles", battery-heated apparel, scrubs, workwear/PPE). Everyday fashion sneakers, hoodies and joggers are FINE — only flag items bought for the sport/function, not the look.
Be precise: only flag genuine problems. Generic product terms and legitimate long-tails stay.
Return ONLY JSON: {"remove": [{"kw": "...", "reason": "brand|artifact|market|duplicate|fit"}]} — empty array if the plan is clean.`,
    messages: [{ role: "user", content: list }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.remove || [])
    .map((r) => ({ kw: String(r.kw || "").toLowerCase().trim(), reason: r.reason || "qa" }))
    .filter((r) => r.kw);
}

// STORE-STEEKPROEF: kijkt naar een dwarsdoorsnede van de catalogus en zoekt
// naar SYSTEMATISCHE problemen — patronen die bij veel producten terugkomen.
// Vult de harde checks aan met wat alleen een lezer opvalt.
export async function reviewStoreSample(items) {
  const list = items
    .map((p, i) => `--- PRODUCT ${i + 1} ---\nTITLE: ${p.title}\nTAGS: ${p.tags || "-"}\nDESCRIPTION: ${p.desc}`)
    .join("\n\n");
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1400,
    system: `You are auditing a fashion dropshipping store's product listings before it applies to Google Merchant Center. Below is a cross-section of the catalogue.

Look for SYSTEMATIC problems — patterns that repeat across products, not one-off typos. Examples of what matters:
- titles that all follow the same formula but get an attribute wrong (e.g. colour named that isn't the product's colour, "long sleeve" on sleeveless items)
- descriptions that read as machine-written, repeat the same sentence structure verbatim across products, or make claims that can't be verified
- keyword stuffing, promotional language, or anything that trips a misrepresentation review
- gender/category inconsistencies between title, tags and description
- descriptions that contradict the title

For each pattern you find, report it once with the number of sample products affected. Ignore anything that is fine. Be concrete and blunt — this store's approval depends on it.

Return ONLY JSON: {"issues":[{"title":"short label","why":"one sentence, what is wrong and why it matters","affected":3,"example":"exact product title"}]} — empty array if the sample is clean.`,
    messages: [{ role: "user", content: list }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.issues || []).slice(0, 8);
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

/* ================================================================
   PRODUCT-BRIEFING PER KEYWORD — "eerst weten wát je zoekt".
   Vóór het scrapen bepaalt het model per keyword wat het product
   ECHT is: definitie, harde eisen, typische kenmerken, wat het
   NIET is en de klassieke verwarringen. Die briefing stuurt daarna
   de foto-controle, zodat "cocktail dress" niet zomaar elke
   feestjurk of avondjapon binnenhaalt.
================================================================ */
export async function buildKeywordBriefs(items) {
  // items: [{index, kw, gender}] → { [index]: brief }
  const list = items
    .map((i) => `${i.index}. [${i.gender === "Man" ? "menswear" : "womenswear"}] ${i.kw}`)
    .join("\n");
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: `You are a fashion buyer with deep product knowledge. For EACH search keyword below, write a short buying brief that a sourcing assistant can use to judge whether a specific product truly is that item.

For every keyword give:
- "kwType": "direct" | "attribute" | "occasion".
   · direct = the keyword IS a garment type shops literally put in product titles ("blazer", "ankle boots", "cardigan").
   · attribute = a garment type plus a visible property ("black midi dress", "wide leg pants", "faux fur coat") — shops often title it this way, but not always.
   · occasion = a USE CASE, not a product type ("christmas party dress", "fall wedding guest outfit", "cocktail dress", "work outfit"). No shop titles products this way; many different garments can serve the occasion.
- "definition": one sentence, what the garment/shoe actually IS (formality, silhouette, typical length, defining construction).
- "must": 1-4 hard requirements a product MUST meet to qualify.
- "typical": 2-5 common but not mandatory traits (fabrics, details, colours).
- "not": 2-5 things that DISQUALIFY, especially the near-misses.
- "confusions": 1-3 product types that get mislabelled as this keyword in webshops.
- "searchTerms": 3-6 search terms that competitor fashion shops ACTUALLY use in their product titles and that would surface suitable products. For occasion keywords these are the physical proxies — e.g. "christmas party dress" → "sequin dress", "velvet dress", "sparkly midi dress", "red party dress"; "fall wedding guest outfit" → "wedding guest dress", "floral midi dress", "long sleeve midi dress". Order: closest first. Never brand names.
- "titleForm": how this keyword should read INSIDE a product title — singular, natural, no season words if they'd sound odd, and a real garment noun instead of "outfit". Examples: "autumn wedding guest dresses" → "Wedding Guest Dress"; "fall wedding guest outfit" → "Wedding Guest Dress"; "christmas party dress" → "Christmas Party Dress"; "blazer" → "Blazer". Title Case.
- "descPhrases": 1-2 natural sentences fragments that contain the EXACT original keyword, usable inside a product description (e.g. "an easy pick for autumn wedding guest outfits").

Be concrete and visual — the brief is used to judge PHOTOS. Use real product knowledge, not generic filler. Keep each field short.

Return ONLY JSON: {"briefs":[{"index":0,"kwType":"occasion","definition":"...","must":["..."],"typical":["..."],"not":["..."],"confusions":["..."],"searchTerms":["..."],"titleForm":"...","descPhrases":["..."]}, ...]}`,
    messages: [{ role: "user", content: list }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  const map = {};
  for (const b of out.briefs || []) {
    if (!Number.isInteger(b.index)) continue;
    map[b.index] = {
      kwType: ["direct", "attribute", "occasion"].includes(b.kwType) ? b.kwType : "direct",
      definition: String(b.definition || "").trim(),
      must: (b.must || []).map(String),
      typical: (b.typical || []).map(String),
      not: (b.not || []).map(String),
      confusions: (b.confusions || []).map(String),
      searchTerms: (b.searchTerms || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 6),
      titleForm: String(b.titleForm || "").trim(),
      descPhrases: (b.descPhrases || []).map(String).slice(0, 2),
    };
  }
  return map;
}

export function briefToText(brief) {
  if (!brief) return "";
  const L = [];
  if (brief.definition) L.push(`WHAT IT IS: ${brief.definition}`);
  if (brief.must && brief.must.length) L.push(`MUST HAVE (all of these): ${brief.must.join("; ")}`);
  if (brief.typical && brief.typical.length) L.push(`TYPICALLY: ${brief.typical.join("; ")}`);
  if (brief.not && brief.not.length) L.push(`DISQUALIFIES: ${brief.not.join("; ")}`);
  if (brief.confusions && brief.confusions.length)
    L.push(`OFTEN CONFUSED WITH (reject these): ${brief.confusions.join("; ")}`);
  return L.join("\n");
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
export async function verifyProductsForKeyword(keyword, gender, items, brief) {
  // items: [{index, title, image|null}]
  const content = [];
  for (const it of items) {
    content.push({ type: "text", text: `--- PRODUCT ${it.index} ---\nTitle: ${it.title}` });
    // Twijfelgevallen (kleur alleen in de omschrijving, match via
    // omschrijving, anderstalige titel) krijgen een tweede foto mee: op de
    // eerste foto zie je vaak niet of het een heren- of damesmodel is en
    // hoe de kleur er echt uitziet.
    const shots = Array.isArray(it.images) && it.images.length ? it.images : it.image ? [it.image] : [];
    for (const src of shots.slice(0, it.needsPhotoProof ? 2 : 1)) {
      try {
        content.push({ type: "image", source: { type: "url", url: thumb(src, 480) } });
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
    system: [{ type: "text", cache_control: { type: "ephemeral" }, text: `You verify scraped fashion products. The customer searched for: "${keyword}" (${gender === "Man" ? "menswear" : "womenswear"}).
${brief ? `\nPRODUCT BRIEF for "${keyword}" — judge against THIS, not against a loose interpretation of the words:\n${briefToText(brief)}\n` : ""}
For each product (title + photo) decide: is this SPECIFIC product truly a "${keyword}"?
- The photo is the strongest evidence — trust what you SEE over the title. Shop titles are often keyword-stuffed and wrong.
- REJECT anything that fails a MUST requirement or hits a DISQUALIFIER from the brief.
- REJECT a different garment category (a cardigan is not a coat, a jumpsuit is not a dress) or an accessory (bags, covers, hangers, jewelry).
- GENDER IS A HARD GATE. This store sells ${gender === "Man" ? "MENSWEAR only" : "WOMENSWEAR only"}. Look at the model, the cut, the styling and the fit in the photo. ${gender === "Man" ? "Reject anything modelled on a woman or cut for a woman." : "Reject anything modelled on a man or cut for a man — men's quarter-zips, men's polos, men's flannel shirts and men's fleece hoodies slip through constantly because the title carries a man's first name (Simon, Chase, Liam, Gavin, Keith, Hunter) and never says \"men\"."} A product with no visible model but an unmistakably ${gender === "Man" ? "feminine" : "masculine"} cut must also be rejected. When the gender is genuinely unclear from both photo and title, reject.
- COLOUR AND MATERIAL ARE HARD GATES. If the keyword names a colour, pattern or material ("gold heels", "black boots", "camouflage pants", "cashmere sweater", "jean shorts"), the product in the PHOTO must actually be that colour/pattern/material. Gold hardware on a black shoe is not a gold heel. Plain olive cargo trousers are not camouflage pants. A blended knit is not cashmere unless the title says so.
- A qualifier is not decoration: an everyday casual dress is NOT a cocktail dress; a plain wool coat is NOT a fur coat; an ankle boot is NOT a knee high boot.
- Two-piece sets: reject when the keyword names a single garment ("blouse", "cardigan", "hoodie") and the product is really a top-and-trousers set — the shopper wants one item.
- Be strict: if you would be embarrassed to show this product to a shopper who searched "${keyword}", reject it. When genuinely unsure, reject.` }],
    messages: [{ role: "user", content }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.reject || []).filter((r) => Number.isInteger(r.index));
}

/* COMPETITOR-SELECTIE: kiest uit de competitor-sheet de beste stores voor
   déze run — eigen markt eerst (hoogste maandbezoek = bewezen winnaars),
   aangevuld met buitenland-stores die uniek aanbod toevoegen tegen minder
   concurrentie. Opmerkingen als "alleen schoentjes" wegen mee. */
export async function selectCompetitors(stores, { targetMarket, keywords, maxStores, totalProducts }) {
  const list = stores
    .map((s) => `- ${s.domain} | markt: ${s.market} | bezoek/mnd: ${s.visits ?? "?"} | producten: ${s.products ?? "?"}${s.note ? ` | opmerking: ${s.note}` : ""}`)
    .join("\n");
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1600,
    system: `You select competitor Shopify stores to scrape products from, for a fashion dropshipping store targeting the ${targetMarket} market${totalProducts ? ` (${totalProducts} products to source)` : ""}.

The list below is real: domain, market, monthly visits (higher = proven winner whose best-sellers are validated by real ad spend), product count, and notes.

Selection rules, in order:
1. MARKET MIX IS MANDATORY: roughly 60% target-market stores, 25% other English markets (USA/UK/AUS/CANADA), 15% translation markets (NL/BE, FR, PL, DE) — always at least 3 non-target-market stores when they exist, even if the target market has plenty. Cross-market stores carry winning products the target market does NOT sell yet = same search demand, less competition. Never return a single-market list.
2. Within each market bucket, rank by monthly visits — high visits = best-sellers validated by real ad spend.
3. Respect the notes: "alleen schoentjes" = shoes only (include ONLY if the keywords contain footwear); "clean store" is a plus; skip anything marked as irrelevant.
4. Skip obvious duplicates (same domain) and stores with very low visits when better options exist.
5. Aim for supply DIVERSITY: not everything from one store or one market.

Keywords being sourced (sample): ${(keywords || []).join(", ") || "-"}

Return ONLY JSON: {"picks": [{"domain": "...", "reason": "max 8 words"}, ...]} — best first, max ${maxStores}.`,
    messages: [{ role: "user", content: list }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  return (out.picks || []).filter((p) => p && p.domain);
}

/* KEYWORD-VERTALING voor buitenlandse competitor-stores: hoe heet dit
   product op een NL/FR/PL webshop? Geen woordenboek-vertaling maar de
   term die winkels daar ZELF gebruiken ("wide leg jeans" → "flared jeans"
   blijft in NL gewoon Engels; "boots" → "laarzen"; "cocktail dress" →
   "robe de cocktail"). Max 2 zoektermen per keyword. */
export async function translateKeywordsForMarket(keywords, market) {
  const LANG = { "NL/BE": "Dutch (Netherlands/Belgium webshops)", NL: "Dutch", FR: "French", PL: "Polish", DE: "German" };
  const lang = LANG[String(market || "").toUpperCase()] || LANG[market] || market;
  const list = keywords.map((k, i) => `${i}: ${k}`).join("\n");
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1800,
    system: `You translate fashion search keywords into the terms ${lang} fashion webshops actually use in product titles. Rules:
- Give the term a LOCAL webshop would put in a product title, not a dictionary translation.
- Many English fashion terms are used as-is locally (jeans, hoodie, blazer, oversized) — if locals use the English word, KEEP the English word.
- Max 2 search terms per keyword, best first. Lowercase.
Return ONLY JSON: {"map": {"0": ["term1", "term2"], ...}} keyed by index.`,
    messages: [{ role: "user", content: list }],
  });
  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  const map = {};
  for (const [i, arr] of Object.entries(out.map || {})) {
    const kw = keywords[Number(i)];
    if (kw && Array.isArray(arr)) map[kw.toLowerCase()] = arr.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 2);
  }
  return map;
}
