// POKÉMON TOOL — AI schrijft eigen titels en omschrijvingen (07-11-2026).
//
// De stijl (titels, opbouw, inhoud per type, setfeiten) staat in ./brain.js.
// Regels:
//  - Alles in eigen woorden: geen zin van de concurrent overnemen. Na het
//    schrijven meten we het zelf (copyRatio, 5-woord-reeksen); te veel
//    overlap → nog één keer herschrijven.
//  - Alleen feiten die in de bron staan (inhoud van de doos, aantal packs,
//    set, taal). Niets verzinnen: geen releasedatum, geen "in stock", geen
//    levertijd, geen garanties, geen namen van andere winkels.
//  - Vaste opbouw, zodat de hele store er hetzelfde uitziet.
import { getClient, addAiUsage, CHEAP_MODEL } from "../ai";
import { copyRatio, stripHtml, standardTitle, TYPE_NAMES, SET_NAMES } from "./catalog";
import { BRAIN_VERSION, TITLE_RULES, HOUSE_STYLE, IMAGE_STYLE, TONE, SET_FACTS, contentsHint, markImages } from "./brain";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const LANG_LABEL = { en: "English", nl: "Dutch (Nederlands)", de: "German", fr: "French" };

function systemPrompt(lang, brand) {
  return `You write product listings for an online shop that sells sealed Pokémon Trading Card Game products${brand ? ` called "${brand}"` : ""}.
Write in ${LANG_LABEL[lang] || "English"} (headings too). Importer brain version ${BRAIN_VERSION}.

HARD RULES
1. Your own words only. Never reuse a sentence or any run of 5+ words from any source text. Restructure completely.
2. Facts only from: the source texts, the "Set facts" and the "Typical contents" given per product. If a fact is in none of them, leave it out. Never invent contents, card counts, promo cards, rarities or release dates.
3. The "What's inside" list is mandatory and must give quantities. Sources disagree? Use the most detailed source.
4. If the product is given a fixed title, use it exactly as the title.

${TONE}

TITLE RULES
${TITLE_RULES.map((r) => "- " + r).join("\n")}

${HOUSE_STYLE}

${IMAGE_STYLE}

HTML: only <p>, <h3>, <ul>, <li>, <strong>, <em>. No <h1>/<h2>, no inline styles, no links.

Also return:
- seoTitle: max 65 characters
- seoDescription: 130–155 characters, with a call to action
- type: one of ${TYPE_NAMES.join(", ")}, Case, Other
- set: the set name in English (prefer one of: ${SET_NAMES.slice(0, 40).join(", ")} …) or "" if unknown
- lang: card language (English, Japanese, Korean, Chinese …)
- featured: main Pokémon featured on the product if any (e.g. "Charizard"), else ""

Answer ONLY with JSON: {"items":[{"i":0,"title":"…","descriptionHtml":"…","seoTitle":"…","seoDescription":"…","type":"…","set":"…","lang":"…","featured":"…"}]}`;
}

function parseJson(text) {
  const t = String(text || "");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e < 0) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

function sourceBlock(p, i) {
  const marked = p.imageLayout ? markImages(p.imageLayout.body) : null;
  const others = (p.extraSources || []).filter((x) => x && x.text);
  return [
    `#${i}`,
    p.fixedTitle ? `FIXED TITLE (use exactly): ${p.fixedTitle}` : `Source title: ${p.title}`,
    p.productType ? `Source category: ${p.productType}` : "",
    `Detected: type=${p.type || "?"}, set=${p.set || "?"}, language=${p.lang || "?"}`,
    p.hint ? `Instructions for this product: ${p.hint}` : "",
    p.set && SET_FACTS[p.set] ? `Set facts: ${SET_FACTS[p.set]}` : "",
    contentsHint(p.type, p.lang),
    marked
      ? `STRATEGY 1 (source has ${marked.images.length} images in its description). Source text with markers:\n${marked.text.slice(0, 2600)}`
      : `STRATEGY 2 (house style). Source text: ${stripHtml(p.body).slice(0, 1800) || "(none)"}`,
    ...others.slice(0, 2).map((x, k) => `Other source ${k + 1} (${x.domain || "shop"}): ${String(x.text).slice(0, 1200)}`),
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

/** Fallback zonder AI (geen key / AI faalt): nette standaardtekst uit de feiten. */
export function templateListing(p, lang = "en") {
  const nl = lang === "nl";
  const title = p.fixedTitle || standardTitle(p);
  const facts = [
    p.set ? `<li><strong>Set:</strong> ${p.set}</li>` : "",
    `<li><strong>${nl ? "Producttype" : "Product type"}:</strong> ${p.type || "Pokémon TCG"}</li>`,
    `<li><strong>${nl ? "Taal" : "Language"}:</strong> ${p.lang || "English"}</li>`,
  ].join("");
  const intro = nl
    ? `<p>${title.replace("Pokémon TCG: ", "")} is een officieel Pokémon TCG-product${p.set ? ` uit de set ${p.set}` : ""}. Leuk om te openen, te verzamelen of cadeau te geven.</p>`
    : `<p>${title.replace("Pokémon TCG: ", "")} is an official Pokémon TCG product${p.set ? ` from the ${p.set} set` : ""}. A great pick for opening, collecting or gifting.</p>`;
  return {
    title,
    descriptionHtml: `${intro}${p.contentsList && p.contentsList.length ? `<h3>${nl ? "Wat zit erin" : "What's inside"}</h3><ul>${p.contentsList.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}<h3>${nl ? "Productdetails" : "Product details"}</h3><ul>${facts}<li><strong>Condition:</strong> Brand new, factory sealed</li></ul>`,
    seoTitle: title.slice(0, 65),
    seoDescription: (nl ? `${title} kopen. ` : `Shop ${title}. `) + (p.set ? `${p.set} · ` : "") + (p.lang || "English"),
    type: p.type,
    set: p.set,
    lang: p.lang,
    featured: "",
    ai: false,
  };
}

/**
 * Schrijf listings voor een rijtje producten (liefst 1–4 per aanroep).
 * products: geclassificeerde bronproducten. Geeft [{…listing, copy}] in dezelfde volgorde.
 */
export async function writeListings(products, { lang = "en", brand = "", usage } = {}) {
  const ai = usage || { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0 };
  if (!process.env.ANTHROPIC_API_KEY) return { items: products.map((p) => ({ ...templateListing(p, lang), copy: 0, note: "geen ANTHROPIC_API_KEY" })), usage: ai };

  const client = getClient();
  const sys = systemPrompt(lang, brand);

  async function call(list, extra = "") {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1900 * list.length + 400,
      system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: list.map((p, i) => sourceBlock(p, i)).join("\n\n---\n\n") + (extra ? "\n\n" + extra : "") }],
    });
    addAiUsage(ai, MODEL, res);
    const txt = (res.content || []).map((c) => c.text || "").join("");
    const j = parseJson(txt);
    return (j && Array.isArray(j.items) && j.items) || [];
  }

  let got = [];
  try {
    got = await call(products);
  } catch (e) {
    return { items: products.map((p) => ({ ...templateListing(p, lang), copy: 0, note: "AI-fout: " + String(e.message || e).slice(0, 120) })), usage: ai };
  }

  const items = products.map((p, i) => {
    const g = got.find((x) => Number(x.i) === i) || got[i];
    if (!g || !g.title || !g.descriptionHtml) return { ...templateListing(p, lang), copy: 0, note: "AI gaf geen tekst — standaardtekst gebruikt" };
    return {
      title: p.fixedTitle || String(g.title).trim().slice(0, 140),
      descriptionHtml: String(g.descriptionHtml).trim(),
      seoTitle: String(g.seoTitle || g.title).slice(0, 70),
      seoDescription: String(g.seoDescription || "").slice(0, 160),
      type: TYPE_NAMES.includes(g.type) ? g.type : p.type,
      set: String(g.set || p.set || "").trim(),
      lang: String(g.lang || p.lang || "English").trim(),
      featured: String(g.featured || "").trim(),
      ai: true,
      copy: copyAll(g.descriptionHtml, p),
    };
  });

  // Plagiaatcheck: > 15% letterlijke 5-woord-reeksen → één keer herschrijven
  const redo = items.map((it, i) => (it.ai && it.copy > 0.15 ? i : -1)).filter((i) => i >= 0);
  if (redo.length) {
    try {
      const again = await call(
        redo.map((i) => products[i]),
        "IMPORTANT: a previous attempt copied phrases from the source. Rewrite with completely different sentence structures and vocabulary."
      );
      redo.forEach((idx, j) => {
        const g = again.find((x) => Number(x.i) === j) || again[j];
        if (!g || !g.descriptionHtml) return;
        const c = copyAll(g.descriptionHtml, products[idx]);
        if (c < items[idx].copy) items[idx] = { ...items[idx], title: products[idx].fixedTitle || String(g.title || items[idx].title).slice(0, 140), descriptionHtml: g.descriptionHtml, copy: c, rewritten: true };
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
  const j = parseJson((res.content || []).map((c) => c.text || "").join(""));
  return { items: (j && j.items) || [], usage: ai };
}
