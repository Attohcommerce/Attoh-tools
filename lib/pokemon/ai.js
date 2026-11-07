// POKÉMON TOOL — AI schrijft eigen titels en omschrijvingen (07-11-2026).
//
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

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const LANG_LABEL = { en: "English", nl: "Dutch (Nederlands)", de: "German", fr: "French" };

function systemPrompt(lang, brand) {
  return `You write product listings for an online shop that sells Pokémon Trading Card Game products${brand ? ` called "${brand}"` : ""}.
Write in ${LANG_LABEL[lang] || "English"}. Tone: knowledgeable collector shop — clear, warm, confident, never pushy, no hype words like "insane" or "must-have!!!".

HARD RULES
1. Your own words only. Never reuse a sentence or any run of 5+ words from the source text. Restructure completely.
2. Only facts that are in the source (contents, number of packs, set, language, card count, promo card names). If a fact is not in the source, leave it out. Never invent release dates, rarities, pull rates or contents.
3. Never mention other shops, stock status, delivery times, prices, discounts, "pre-order", warranties or guarantees.
4. Never claim the product is graded, rare or limited unless the source says so.
5. "Pokémon" always with é. Card game is "Pokémon TCG".

TITLE FORMAT
"Pokémon TCG: <Set> <Product type> (<extra like a featured Pokémon or 'Booster Bundle 6 packs'>)" — keep it short (max ~80 characters), no shop names, no emojis. Add the language in brackets only when it is NOT English, e.g. "(Japanese)".

DESCRIPTION (HTML, no <h1>, no inline styles)
<p>2–3 sentences: what it is and why a collector or player would enjoy it.</p>
<h3>What's inside</h3>
<ul><li>…one line per item from the source…</li></ul>   (skip this block if the source does not list contents)
<h3>Product details</h3>
<ul><li><strong>Set:</strong> …</li><li><strong>Product type:</strong> …</li><li><strong>Language:</strong> …</li>(+ card count / pack count if known)</ul>
<p>One closing sentence (e.g. great for opening, gifting or keeping sealed).</p>
Headings must be in the writing language.

Also return:
- seoTitle: max 65 characters
- seoDescription: 130–155 characters
- type: one of ${TYPE_NAMES.join(", ")}, Other
- set: the set name in English (prefer one of: ${SET_NAMES.slice(0, 40).join(", ")} …) or "" if unknown
- lang: card language (English, Japanese, Korean, Chinese, German, French, Dutch, Spanish, Italian …)
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
  return [
    `#${i}`,
    `Source title: ${p.title}`,
    p.productType ? `Source category: ${p.productType}` : "",
    p.tags ? `Source tags: ${String(p.tags).slice(0, 200)}` : "",
    `Detected: type=${p.type || "?"}, set=${p.set || "?"}, language=${p.lang || "?"}`,
    `Source text: ${stripHtml(p.body).slice(0, 1800) || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fallback zonder AI (geen key / AI faalt): nette standaardtekst uit de feiten. */
export function templateListing(p, lang = "en") {
  const nl = lang === "nl";
  const title = standardTitle(p);
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
    descriptionHtml: `${intro}<h3>${nl ? "Productdetails" : "Product details"}</h3><ul>${facts}</ul>`,
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
      max_tokens: 1400 * list.length + 400,
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
      title: String(g.title).trim().slice(0, 140),
      descriptionHtml: String(g.descriptionHtml).trim(),
      seoTitle: String(g.seoTitle || g.title).slice(0, 70),
      seoDescription: String(g.seoDescription || "").slice(0, 160),
      type: TYPE_NAMES.includes(g.type) ? g.type : p.type,
      set: String(g.set || p.set || "").trim(),
      lang: String(g.lang || p.lang || "English").trim(),
      featured: String(g.featured || "").trim(),
      ai: true,
      copy: copyRatio(g.descriptionHtml, p.body),
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
        const c = copyRatio(g.descriptionHtml, products[idx].body);
        if (c < items[idx].copy) items[idx] = { ...items[idx], title: String(g.title || items[idx].title).slice(0, 140), descriptionHtml: g.descriptionHtml, copy: c, rewritten: true };
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
