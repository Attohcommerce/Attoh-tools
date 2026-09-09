// SIZE GUIDE — de twee AI-stappen, allebei kijk/aankruis-werk → CHEAP_MODEL
// (regel uit de Kosten-fix van 11-8: alleen schrijf- en merkenkennis-werk
// op het grote model).
//
//   pickMatch()          onze foto's + kandidaat-thumbnails → welke
//                        AliExpress-kandidaat is HETZELFDE product?
//   readSizeChartImage() screenshot/afbeelding van een maattabel → tabel
//                        (koppen + rijen + unit) — de handmatige route voor
//                        sellers die de tabel als plaatje plaatsen

import { getClient, addAiUsage, thumb, CHEAP_MODEL, emptyAiUsage } from "./ai.js";
import { KINDS } from "./sizeguide.js";

/**
 * imageSource(url) → Anthropic image-source.
 * AliExpress/alicdn-URL's mag de Anthropic-fetcher niet ophalen (robots.txt →
 * 400 "This URL is disallowed by the website's robots.txt file"). Daarom halen
 * we het plaatje zelf op en sturen base64 mee; lukt dat niet, dan valt het
 * terug op de URL-bron (Shopify-CDN werkt daar wél mee).
 */
const IMG_MAX = 4.5 * 1024 * 1024;
async function imageSource(url) {
  const u = String(url || "");
  try {
    const headers = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    };
    if (/alicdn|aliexpress/i.test(u)) headers.referer = "https://www.aliexpress.com/";
    const res = await fetch(u, { headers, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > IMG_MAX) throw new Error("size");
    if (type === "image/jpg") type = "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) {
      if (buf[0] === 0xff && buf[1] === 0xd8) type = "image/jpeg";
      else if (buf[0] === 0x89 && buf[1] === 0x50) type = "image/png";
      else if (buf.subarray(0, 4).toString() === "RIFF") type = "image/webp";
      else if (buf.subarray(0, 3).toString() === "GIF") type = "image/gif";
      else throw new Error("type");
    }
    return { type: "base64", media_type: type, data: buf.toString("base64") };
  } catch {
    return { type: "url", url: u };
  }
}

const MATCH_SYSTEM = `You compare fashion product photos. You get 1-2 photos of OUR product (labeled A/B) and up to 8 candidate photos from a supplier marketplace (numbered). Decide which candidate shows the EXACT SAME garment/shoe: same cut, same details (collar, buttons, seams, print, sole), same colorway available. Similar style is NOT a match. Photos of the same item often reuse the identical source image or the same model shot — that is the strongest signal. If no candidate is the same item, answer index -1. Be strict: a wrong match produces a wrong size chart for a customer.`;

/**
 * pickMatch({ourImages, ourTitle, candidates}) → { index, confidence, reason, ai }
 *   index = positie in `candidates` (−1 = geen match)
 */
export async function pickMatch({ ourImages, ourTitle, candidates }) {
  const ai = emptyAiUsage();
  const content = [];
  content.push({ type: "text", text: `Our product title: ${String(ourTitle || "").slice(0, 120)}\nOur photos:` });
  for (const [i, url] of (ourImages || []).slice(0, 2).entries()) {
    content.push({ type: "text", text: `Photo ${i === 0 ? "A" : "B"}:` });
    content.push({ type: "image", source: await imageSource(thumb(url, 480)) });
  }
  content.push({ type: "text", text: "Candidates:" });
  const withImg = [];
  const candList = (candidates || []).slice(0, 8);
  const candSources = await Promise.all(candList.map((c) => (c.image ? imageSource(c.image) : null)));
  candList.forEach((c, i) => {
    if (!c.image) return;
    withImg.push(i);
    content.push({ type: "text", text: `Candidate ${i}: ${String(c.title || "").slice(0, 90)}` });
    content.push({ type: "image", source: candSources[i] });
  });
  if (!withImg.length) return { index: -1, confidence: 0, reason: "geen kandidaat-foto's", ai };

  const res = await getClient().messages.create({
    model: CHEAP_MODEL,
    max_tokens: 300,
    system: [{ type: "text", text: MATCH_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: "pick_match",
        description: "Report which candidate is the exact same product.",
        input_schema: {
          type: "object",
          properties: {
            index: { type: "integer", description: "candidate number, or -1 when none is the same item" },
            confidence: { type: "number", description: "0-1" },
            reason: { type: "string", description: "one short sentence" },
          },
          required: ["index", "confidence", "reason"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "pick_match" },
    messages: [{ role: "user", content }],
  });
  addAiUsage(ai, CHEAP_MODEL, res);
  const tu = res.content.find((c) => c.type === "tool_use");
  const out = (tu && tu.input) || {};
  let index = Number.isInteger(out.index) ? out.index : -1;
  if (index >= 0 && !withImg.includes(index)) index = -1;
  const confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0));
  return { index, confidence, reason: String(out.reason || "").slice(0, 200), ai };
}

const READ_SYSTEM = `You transcribe garment size charts from images into a table. Copy the numbers EXACTLY as printed; never invent or "correct" values. Column headers: use the header text in the image (translate to English if needed, e.g. Bust, Waist, Hips, Length, Shoulder, Sleeve, Foot length). The first column must be the size label (S, M, L, 38, One Size...). If the image shows both cm and inch values, transcribe the cm values only and set unit to "cm". If a cell is a range like 84-88 keep it as "84-88". Skip decorative rows (e.g. "Size", "cm/in" repeated) and any rows that are not sizes.`;

/**
 * readSizeChartImage({imageUrl | dataUrl}) → { ok, headers, rows, unit, ai } | { ok:false, error }
 *   dataUrl = "data:image/png;base64,…" (screenshot uit de review-UI)
 */
export async function readSizeChartImage({ imageUrl, dataUrl }) {
  const ai = emptyAiUsage();
  let source = null;
  if (dataUrl) {
    const m = String(dataUrl).match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
    if (!m) return { ok: false, error: "ongeldige afbeelding (verwacht png/jpeg/webp)" };
    source = { type: "base64", media_type: m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase(), data: m[2] };
  } else if (imageUrl) {
    source = await imageSource(imageUrl);
  } else {
    return { ok: false, error: "geen afbeelding" };
  }
  const res = await getClient().messages.create({
    model: CHEAP_MODEL,
    max_tokens: 1500,
    system: [{ type: "text", text: READ_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: "save_table",
        description: "Save the transcribed size chart.",
        input_schema: {
          type: "object",
          properties: {
            unit: { type: "string", enum: ["cm", "in", "unknown"] },
            headers: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "array", items: { type: "string" } } },
            readable: { type: "boolean", description: "false when the image contains no legible size chart" },
          },
          required: ["unit", "headers", "rows", "readable"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_table" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this size chart." },
          { type: "image", source },
        ],
      },
    ],
  });
  addAiUsage(ai, CHEAP_MODEL, res);
  const tu = res.content.find((c) => c.type === "tool_use");
  const out = (tu && tu.input) || {};
  if (out.readable === false || !Array.isArray(out.rows) || !out.rows.length) {
    return { ok: false, error: "geen leesbare maattabel in deze afbeelding", ai };
  }
  return {
    ok: true,
    headers: (out.headers || []).map((h) => String(h)),
    rows: out.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c)) : [])),
    unit: out.unit === "cm" || out.unit === "in" ? out.unit : null,
    ai,
  };
}

const KIND_SYSTEM = `You classify fashion products into exactly one size-chart category. Categories: top (blouses, shirts, t-shirts, sweaters, cardigans, hoodies, knitwear, tunics), outerwear (jackets, coats, blazers, vests), dress (dresses, gowns), skirt, bottoms (pants, jeans, shorts, leggings), set (two-piece sets, jumpsuits, rompers, suits, pajama sets), swim (swimwear, bodysuits, lingerie, shapewear), shoes, bra, accessory (bags, hats, belts, jewelry, scarves, socks), unknown (only if truly unclear). Judge by the garment itself, not by style words.`;

/**
 * classifyKindsBatch(items) — items: [{index, title, productType}] → { kinds: [{index, kind}], ai }
 * Alleen tekst → spotgoedkoop; wordt alleen gebruikt voor titels die de
 * deterministische regels niet herkennen.
 */
export async function classifyKindsBatch(items) {
  const ai = emptyAiUsage();
  if (!items || !items.length) return { kinds: [], ai };
  const lines = items.map((it) => `${it.index}: ${String(it.title || "").slice(0, 100)}${it.productType ? ` [type: ${String(it.productType).slice(0, 40)}]` : ""}`).join("\n");
  const res = await getClient().messages.create({
    model: CHEAP_MODEL,
    max_tokens: 1500,
    system: [{ type: "text", text: KIND_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: "save_kinds",
        description: "Save one category per product.",
        input_schema: {
          type: "object",
          properties: {
            kinds: {
              type: "array",
              items: {
                type: "object",
                properties: { index: { type: "integer" }, kind: { type: "string", enum: KINDS } },
                required: ["index", "kind"],
              },
            },
          },
          required: ["kinds"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_kinds" },
    messages: [{ role: "user", content: `Products:\n${lines}` }],
  });
  addAiUsage(ai, CHEAP_MODEL, res);
  const tu = res.content.find((c) => c.type === "tool_use");
  const out = (tu && tu.input && tu.input.kinds) || [];
  return { kinds: out.filter((k) => Number.isInteger(k.index) && KINDS.includes(k.kind)), ai };
}
