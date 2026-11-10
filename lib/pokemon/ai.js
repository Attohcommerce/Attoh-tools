// POKÉMON TOOL — AI schrijft de onderdelen, de tool zet de pagina in elkaar (09-11-2026).
//
// Waarom zo: eerder leverde de AI losse HTML/JSON. Ging dat mis (afgekapte of
// ongeldige JSON), dan viel de importer terug op een standaardtekstje — en
// precies dat stond in de store ("… is een officieel Pokémon TCG-product.
// Leuk om te openen …"). Nu:
//  - de AI vult een vast formulier via tool-use (altijd geldige velden),
//  - de tool bouwt daar één vaste, nette opbouw van (zelfde volgorde overal),
//  - de titel wordt door de tool gebouwd (MemTCG-vorm: "Pokémon <Set> <product> <code>"),
//  - lukt de AI niet, dan komt er GEEN product in de store: de regel wordt
//    gemeld als mislukt zodat je hem opnieuw kunt doen.
// De stijl (toon, inhoud per type, setfeiten) staat in ./brain.js.
import { getClient, addAiUsage, CHEAP_MODEL, thumb } from "../ai";
import { copyRatio, stripHtml, TYPE_NAMES, SET_NAMES, LANG_NL } from "./catalog";
import { BRAIN_VERSION, TITLE_RULES, houseStyle, TONE, SET_FACTS, HEADINGS, SET_CODES, contentsHint, markImages, buildTitle, nlDate, releaseDateOf } from "./brain";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const LANG_LABEL = { en: "English", nl: "Dutch (Nederlands)", de: "German", fr: "French" };

function systemPrompt(lang, brand) {
  return `You write product listings for an online shop that sells sealed Pokémon Trading Card Game products${brand ? ` called "${brand}"` : ""}.
Write in ${LANG_LABEL[lang] || "English"}. Importer brain version ${BRAIN_VERSION}.

HARD RULES
1. Your own words only. Never reuse a sentence or any run of 5+ words from any source text.
2. Facts only from: the source texts, the "Set facts" and the "Typical contents" given per product. Never invent contents, card counts, promo cards, rarities or dates.
3. The "What's inside" list is mandatory and every line starts with a quantity. Sources disagree? Use the most detailed source.
4. Return every product you were given, with its index i.

${TONE}

TITLE
${TITLE_RULES.map((r) => "- " + r).join("\n")}

${houseStyle(lang)}

Also classify: type (one of ${TYPE_NAMES.join(", ")}, Case, Other), set (English set name, prefer one of: ${SET_NAMES.slice(0, 40).join(", ")} …; "" if unknown), lang (card language: English, Japanese, Korean, Chinese …), featured (main Pokémon on the product, else "").

Use the save_listings tool for your answer.`;
}

const TOOL = {
  name: "save_listings",
  description: "Save the written listing parts for each product.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            i: { type: "integer", description: "Index of the product (#i in the input)" },
            core: { type: "string", description: 'Product name after the set name, without set code. E.g. "Elite Trainer Box", "Booster Box", "3-Pack Blister Seel", "Mega Feraligatr ex Box", "Pikachu ex Day Ultra Premium Collection".' },
            type: { type: "string" },
            set: { type: "string" },
            lang: { type: "string" },
            featured: { type: "string" },
            intro: { type: "string", description: "1–2 plain factual sentences" },
            inside: { type: "array", items: { type: "string" }, description: "What's inside, one item per line, quantity first" },
            about: { type: "string", description: "2–3 factual sentences about the set, or empty" },
            packs: { type: "integer", description: "Number of booster packs in this product; 0 if unknown or none" },
            cardsPerPack: { type: "integer", description: "Cards per booster pack; 0 if unknown" },
            note: { type: "string", description: "Empty, or one short caution (random design / Japanese print / source restriction)" },
            seoTitle: { type: "string" },
            seoDescription: { type: "string" },
          },
          required: ["i", "core", "type", "set", "lang", "featured", "intro", "inside", "about", "packs", "cardsPerPack", "note", "seoTitle", "seoDescription"],
        },
      },
    },
    required: ["items"],
  },
};

function sourceBlock(p, i) {
  const marked = p.imageLayout ? markImages(p.imageLayout.body) : null;
  const others = (p.extraSources || []).filter((x) => x && x.text);
  const rel = releaseDateOf(p.set);
  return [
    `#${i}`,
    p.fixedTitle ? `Our product name (keep the meaning; the tool builds the final title): ${p.fixedTitle}` : `Source title: ${p.title}`,
    p.productType ? `Source category: ${p.productType}` : "",
    `Detected: type=${p.type || "?"}, set=${p.set || "?"}, language=${p.lang || "?"}${SET_CODES[p.set] ? `, set code=${SET_CODES[p.set]}` : ""}${rel ? `, release date=${rel}` : ""}`,
    p.hint ? `Instructions for this product: ${p.hint}` : "",
    p.set && SET_FACTS[p.set] ? `Set facts: ${SET_FACTS[p.set]}` : "",
    contentsHint(p.type, p.lang),
    `Source text: ${(marked ? marked.text : stripHtml(p.body)).replace(/\[\[IMG\d+\]\]/g, " ").replace(/\s+/g, " ").slice(0, 2200) || "(none)"}`,
    ...others.slice(0, 2).map((x, k) => `Other source ${k + 1} (${x.domain || "shop"}): ${String(x.text).replace(/\s+/g, " ").slice(0, 1200)}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Hoogste overlap met welke bron dan ook (hoofdbron + extra bronnen). */
function copyAll(html, p) {
  let c = copyRatio(html, p.body);
  for (const x of p.extraSources || []) c = Math.max(c, copyRatio(html, x.text || ""));
  return c;
}

const esc = (s) => String(s || "").replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const li = (label, value) => (value ? `<li><strong>${label}:</strong> ${esc(value)}</li>` : "");

/**
 * Vaste opbouw van de omschrijving (zelfde bij elk product):
 *   intro → Wat zit erin → [foto's uit de bron] → Over <Set> → Productinformatie → Let op
 */
export function assembleListing(g, p, lang = "nl") {
  const h = HEADINGS[lang] || HEADINGS.en;
  const nl = lang === "nl";
  const set = String(g.set || p.set || "").trim();
  const type = TYPE_NAMES.includes(g.type) ? g.type : p.type || "";
  const cardLang = String(g.lang || p.lang || "English").trim();
  const core = String(g.core || "").trim() || (p.fixedTitle ? p.fixedTitle : type);
  const title = buildTitle({ set, core: p.fixedTitle ? p.fixedTitle : core, lang: cardLang });
  const code = SET_CODES[set] || "";
  const rel = releaseDateOf(set);
  const inside = (Array.isArray(g.inside) ? g.inside : []).map((x) => String(x || "").trim()).filter(Boolean);
  const imgMarkers = p.imageLayout ? markImages(p.imageLayout.body).images.map((_, i) => `<p>[[IMG${i + 1}]]</p>`).join("") : "";

  const details = [
    li(h.set, set ? `${set}${code ? ` (${code})` : ""}` : ""),
    li(h.type, type === "Case" ? (nl ? "Case" : "Case") : type),
    li(h.lang, nl ? LANG_NL[cardLang] || cardLang : cardLang),
    g.packs ? li(h.packs, String(g.packs)) : "",
    g.cardsPerPack ? li(h.cards, String(g.cardsPerPack)) : "",
    rel ? li(h.release, nl ? nlDate(rel) : rel) : "",
    li(h.condition, h.conditionValue),
  ].join("");

  const parts = [
    g.intro ? `<p>${esc(g.intro)}</p>` : "",
    inside.length ? `<h3>${h.inside}</h3><ul>${inside.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "",
    imgMarkers,
    g.about && set ? `<h3>${h.about} ${esc(set)}</h3><p>${esc(g.about)}</p>` : g.about ? `<p>${esc(g.about)}</p>` : "",
    `<h3>${h.details}</h3><ul>${details}</ul>`,
    g.note ? `<p><strong>${h.note}:</strong> ${esc(g.note)}</p>` : "",
  ];
  const descriptionHtml = parts.filter(Boolean).join("");
  const seoTitle = String(g.seoTitle || title).trim().slice(0, 70) || title.slice(0, 70);
  const seoDescription = String(g.seoDescription || "").trim().slice(0, 160) || stripHtml(descriptionHtml).slice(0, 155);
  return { title, descriptionHtml, seoTitle, seoDescription, type, set, lang: cardLang, featured: String(g.featured || "").trim(), ai: true, inside };
}

/**
 * Schrijf listings voor een rijtje producten (liefst 1–4 per aanroep).
 * products: geclassificeerde bronproducten. Geeft { items, usage }; items in dezelfde volgorde.
 * Een item dat niet lukte heeft { error } en GEEN descriptionHtml — de importer slaat het over en meldt het.
 */
export async function writeListings(products, { lang = "nl", brand = "", usage } = {}) {
  const ai = usage || { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0 };
  const fail = (p, why) => ({ title: p.fixedTitle || p.title, error: why, ai: false });
  if (!process.env.ANTHROPIC_API_KEY) return { items: products.map((p) => fail(p, "ANTHROPIC_API_KEY ontbreekt op de server")), usage: ai };

  const client = getClient();
  const sys = systemPrompt(lang, brand);

  async function call(list, extra = "") {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1600 * list.length + 500,
      system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "save_listings" },
      messages: [{ role: "user", content: list.map((p, i) => sourceBlock(p, i)).join("\n\n---\n\n") + (extra ? "\n\n" + extra : "") }],
    });
    addAiUsage(ai, MODEL, res);
    const tu = (res.content || []).find((c) => c.type === "tool_use" && c.input);
    const items = tu && Array.isArray(tu.input.items) ? tu.input.items : [];
    if (res.stop_reason === "max_tokens") throw new Error("antwoord afgekapt (te lang)");
    return items;
  }

  // 1. Hele portie in één keer; 2. wat ontbreekt of faalt → per product nog één keer
  const got = new Array(products.length).fill(null);
  let batchErr = "";
  try {
    const items = await call(products);
    items.forEach((x, k) => {
      const i = Number.isInteger(x.i) && x.i >= 0 && x.i < products.length ? x.i : k;
      if (!got[i] && x.inside && x.inside.length) got[i] = x;
    });
  } catch (e) {
    batchErr = String(e.message || e);
  }
  for (let i = 0; i < products.length; i++) {
    if (got[i]) continue;
    try {
      const items = await call([products[i]], batchErr ? "" : "Return this single product completely.");
      if (items[0] && items[0].inside && items[0].inside.length) got[i] = items[0];
    } catch (e) {
      batchErr = batchErr || String(e.message || e);
    }
  }

  const items = products.map((p, i) => {
    const g = got[i];
    if (!g) return fail(p, "AI-tekst mislukt" + (batchErr ? `: ${batchErr.slice(0, 120)}` : " (geen tekst terug)"));
    const l = assembleListing(g, p, lang);
    return { ...l, copy: copyAll(l.descriptionHtml, p) };
  });

  // Plagiaatcheck: > 15% letterlijke 5-woord-reeksen → één keer herschrijven
  const redo = items.map((it, i) => (it.ai && it.copy > 0.15 ? i : -1)).filter((i) => i >= 0);
  if (redo.length) {
    try {
      const again = await call(
        redo.map((i) => products[i]),
        "IMPORTANT: a previous attempt copied phrases from the source. Rewrite intro, inside and about with completely different sentence structures and vocabulary; keep the facts."
      );
      redo.forEach((idx, j) => {
        const g = again.find((x) => Number(x.i) === j) || again[j];
        if (!g || !g.inside || !g.inside.length) return;
        const l = assembleListing(g, products[idx], lang);
        const c = copyAll(l.descriptionHtml, products[idx]);
        if (c < items[idx].copy) items[idx] = { ...l, copy: c, rewritten: true };
      });
    } catch {}
  }
  return { items, usage: ai };
}

/** Alleen indelen (type/set/taal) voor producten die al in de store staan — goedkoop model. */
export async function classifyWithAi(rows, usage) {
  const ai = usage || { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0 };
  if (!process.env.ANTHROPIC_API_KEY || !rows.length) return { items: [], usage: ai };
  const client = getClient();
  const res = await client.messages.create({
    model: CHEAP_MODEL,
    max_tokens: 120 * rows.length + 200,
    system: `Classify Pokémon TCG products. type: one of ${TYPE_NAMES.join(", ")}, Other. set: English set name or "". lang: card language. Answer ONLY JSON {"items":[{"i":0,"type":"…","set":"…","lang":"…"}]}`,
    messages: [{ role: "user", content: rows.map((r, i) => `#${i} ${r.title} | ${stripHtml(r.body).slice(0, 300)}`).join("\n") }],
  });
  addAiUsage(ai, CHEAP_MODEL, res);
  const t = (res.content || []).map((c) => c.text || "").join("");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  let j = null;
  try {
    j = s >= 0 && e >= 0 ? JSON.parse(t.slice(s, e + 1)) : null;
  } catch {}
  return { items: (j && j.items) || [], usage: ai };
}


/* ---------- Fotocontrole (09-11-2026) ----------
   Concurrenten zetten eigen marketingplaatjes tussen hun productfoto's
   ("Lieferumfang", "Warum bei …?", sterren, USP-iconen, hun logo). Die mogen
   nooit in onze store. Elke kandidaat-foto gaat langs het goedkope model:
   alleen kale productfoto's/renders van het sealed product blijven over. */
const IMG_SYSTEM = `You screen product images of SEALED Pokémon Trading Card Game products before they are uploaded to a new shop.
KEEP an image only if it is a plain product photo or official render: the box, bundle, blister, tin, pack(s) or the official contents spread, on a plain or studio background. Text that is PRINTED ON the product packaging itself (logos, "Includes 6 booster packs", set names on the box) is fine.
REMOVE an image if it contains anything a shop added: a shop or retailer name, logo, URL or social handle; a watermark; an infographic, banner or collage with added text or icons (e.g. "Lieferumfang", "What's inside", "Why buy from us", star ratings, delivery or payment icons, price or sale badges, "pre-order" stickers); a frame or decorative border with text; a photo of other products, people, stores, or unrelated items; a screenshot.
When in doubt whether text was added by a shop, REMOVE.
Answer ONLY with JSON: {"remove":[{"index":0,"reason":"short reason"}]} — one entry per image to remove; {"remove":[]} if all are clean.`;

/** urls → { keep: [url], removed: [{url, reason}], usage } */
export async function screenImages(urls, usage) {
  const ai = usage || { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0 };
  const list = [...new Set((urls || []).filter(Boolean))].slice(0, 10);
  if (!list.length) return { keep: [], removed: [], usage: ai };
  if (!process.env.ANTHROPIC_API_KEY) return { keep: list, removed: [], usage: ai };
  const content = [];
  list.forEach((u, i) => {
    content.push({ type: "text", text: `IMAGE ${i}:` });
    content.push({ type: "image", source: { type: "url", url: thumb(u, 640) } });
  });
  content.push({ type: "text", text: "Screen every image above." });
  try {
    const res = await getClient().messages.create({
      model: CHEAP_MODEL,
      max_tokens: 600,
      system: [{ type: "text", text: IMG_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });
    addAiUsage(ai, CHEAP_MODEL, res);
    const t = (res.content || []).map((c) => c.text || "").join("");
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    const j = a >= 0 && b >= 0 ? JSON.parse(t.slice(a, b + 1)) : { remove: [] };
    const bad = new Map();
    for (const r of Array.isArray(j.remove) ? j.remove : []) if (Number.isInteger(r.index) && list[r.index]) bad.set(list[r.index], String(r.reason || "branding"));
    return { keep: list.filter((u) => !bad.has(u)), removed: [...bad].map(([url, reason]) => ({ url, reason })), usage: ai };
  } catch (e) {
    // Controle mislukt → liever geen foto's dan andermans marketing
    return { keep: [], removed: list.map((url) => ({ url, reason: "controle mislukt: " + String(e.message || e).slice(0, 80) })), usage: ai, error: String(e.message || e) };
  }
}

/**
 * Kies max `max` schone foto's uit kandidaten (volgorde = voorkeur). Eerst de
 * eerste portie; levert die te weinig op, dan de volgende bronnen.
 */
export async function pickCleanImages(candidates, max = 6, usage) {
  const all = [...new Set((candidates || []).filter(Boolean))];
  const keep = [];
  const removed = [];
  for (let i = 0; i < all.length && keep.length < max; i += 8) {
    const r = await screenImages(all.slice(i, i + 8), usage);
    keep.push(...r.keep.filter((u) => !keep.includes(u)));
    removed.push(...r.removed);
    if (r.error) break;
  }
  return { images: keep.slice(0, max), removed };
}
