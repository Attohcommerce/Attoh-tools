// AI-stap: GMC-compliant, keyword-rijke titels + omschrijvingen via de Anthropic API.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

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

export async function generateListing({ product, settings }) {
  const {
    listingStyle = "stacking", // "stacking" | "attribute"
    requiredKeyword = "",
    genderPrefix = false,
    forceMensKeywords = false,
    colorLabel = "Color",
    sizeLabel = "Size",
  } = settings || {};

  const styleInstruction =
    listingStyle === "attribute"
      ? `TITLE STYLE — ATTRIBUTE STYLE (Google-recommended):
Build the title from real product attributes in a natural order: [Gender] [Material/Fabric] [Product Type] [Key Feature] [Fit/Style] [Occasion]. One clean readable phrase, no separators like "-" or "|". Example: "Women's Linen Blend Relaxed Fit Blouse with Long Sleeves".`
      : `TITLE STYLE — KEYWORD STACKING:
Stack 3–4 short keyword phrases separated by " - ". Each phrase is a realistic search query a shopper would type. Most important phrase first. Example: "Elegant Chiffon Blouse - Women's Long Sleeve Top - Office Workwear Shirt - Flowy Summer Blouse". Phrases must not repeat the same word more than twice across the whole title.`;

  const system = `You write Shopify product listings optimized for Google Shopping (Google Merchant Center) for fashion dropshipping stores. You return ONLY valid JSON, nothing else.

HARD GMC COMPLIANCE RULES:
- Title max 150 characters (aim for 65–150), Title Case, NO ALL-CAPS words.
- No promotional text anywhere in title: no "sale", "free shipping", "discount", "%", "best", "cheap", "hot", "new", no exclamation marks, no emoji.
- No brand names you are not given, no celebrity names, no "as seen on", no trademark terms.
- No unverifiable claims (no "premium quality guaranteed", no review counts, no "bestseller").
- Description: clean simple HTML (<p>, <ul>, <li>, <strong> only). 150–250 words. Keyword-rich but natural and readable — weave in the main keyword and 4–8 related search terms a shopper would use (fabric, fit, occasion, style, season). No fake urgency, no shipping/price promises, no store name.
- Gendered products must be described for the correct gender.
- Write in English.

${styleInstruction}`;

  const userParts = [
    `SOURCE PRODUCT:
Title: ${product.title}
Type: ${product.productType || "-"}
Tags: ${product.tags || "-"}
Options: ${(product.options || []).map((o) => `${o.name}: ${(o.values || []).join("/")}`).join(" | ") || "-"}
Description (may be messy, use only as info source):
${String(product.bodyHtml || "").replace(/<[^>]+>/g, " ").slice(0, 2500)}`,
  ];

  if (requiredKeyword) {
    userParts.push(
      `REQUIRED KEYWORD: "${requiredKeyword}" — this exact keyword MUST appear literally in the title, as prominently as possible, and at least twice in the description.`
    );
  }
  if (genderPrefix) {
    userParts.push(
      `GENDER PREFIX: Start the title with the correct gender prefix ("Women's " or "Men's ") based on the product.`
    );
  }
  if (forceMensKeywords) {
    userParts.push(
      `FORCE MEN'S KEYWORDS: This is a men's product. Use male-targeted keywords ("Men's ...") throughout title and description.`
    );
  }
  userParts.push(
    `Return JSON exactly like: {"title": "...", "description_html": "...", "detected_gender": "Men|Women|Unisex"}`
  );

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: userParts.join("\n\n") }],
  });

  const out = extractJson(res.content.map((c) => c.text || "").join(""));
  let title = String(out.title || "").trim();
  if (title.length > 150) title = title.slice(0, 147).replace(/\s+\S*$/, "") + "…";
  return {
    title,
    descriptionHtml: String(out.description_html || "").trim(),
    detectedGender: out.detected_gender || "Unisex",
  };
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
