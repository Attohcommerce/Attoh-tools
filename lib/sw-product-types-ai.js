// SHAPES WARDROBE — producttype van Cas kiezen met AI (foto + titel), 23-10-2026.
// Lijst + regels: lib/sw-product-types.js. Kijkwerk → CHEAP_MODEL, 8 producten
// per call, eerste productfoto op 400px. Antwoord buiten de lijst of fout
// geslacht → vangnet guessSwType() op de titel. Faalt de call met foto's
// (bv. een foto-URL die niet te laden is), dan één keer zonder foto's.
// Fotocheck (opts.photoCheck, Doctor-knop "Fotocheck"): ook producten die
// volgens de regels al goed staan gaan langs de AI, met hun huidige type
// erbij; alleen een andere SOORT op de foto telt (geen seizoen-gewiebel).
import { getClient, addAiUsage, thumb, CHEAP_MODEL, emptyAiUsage } from "./ai.js";
import { SW_TYPES, swTypeListText, swTypeGender, swGenderOf, guessSwType, swTypeVerdict, isSwType, normalizeSwType, parseSwType } from "./sw-product-types";

const BATCH = 8;

const SYSTEM = `You assign exactly ONE product type to each fashion product of Shapes Wardrobe, an Australian online store for men and women. The type MUST be copied character-for-character from the fixed list below (made by the store's media buyer): "<SEASON> - <Womens|Mens> - <Type>".

How to decide:
1. GENDER: when the item's GENDER line says men or women, use only that gender's types (Mens / Womens). Only when it says "unknown", decide from the photo and title.
2. WHAT IT IS: look at the PHOTO first (the main garment/shoe/accessory being sold, not props), then the title. One type per product, for the main item.
3. SEASON — AS (All Season) is the DEFAULT. SS (Spring/Summer) ONLY for:
   - swimwear (incl. board shorts, swim trunks), sandals / slides / flip-flops (open, closed-toe or heeled sandals alike), all shorts (incl. sport shorts), men's tank tops / singlets, men's leather/suede casual or dress shoes (that type only exists in SS)
   - an explicit summer feature in the title: linen, Hawaiian/tropical print, beach/resort wear, sun or straw hats, crochet
   - men's short-sleeve button-up shirts, and sets that include shorts
   Everything else is AS — also sleeveless dresses and tops, sneakers, running shoes, jeans, trousers (unless linen), polos, t-shirts, bags, belts, caps, even when "lightweight", "breathable", "mesh" or "canvas".
   AW (Autumn/Winter) only for clearly cold-weather items: wool, fleece, padded, thick knit, coats, parkas, winter boots, scarves. Some types exist in one season only (Swimwear only SS, Coat only AW, Mens Shoes only SS) — then use that season.
4. CLOSEST FIT when nothing matches literally:
   - jumpsuit / playsuit / romper / co-ord / matching two-piece → Casual Set; tracksuit / lounge set → Loungewear Set
   - button-up shirts (also for men) → Blouse; women's tank tops / camis / bodysuits → Top
   - sleeveless compression or gym shirts → Sports Tanktop (men) / Sports Top (women)
   - men's shoes: lace-up athletic, trainer, mesh, knit or canvas low-tops → Sneakers; only real leather/suede boat shoes, loafers, moccasins, derbies, oxfords → SS - Mens - Shoes
   - cowboy / western shoes and anything ankle-high → Boots
   - women's closed flats (ballet flats, Mary Janes, slip-on flat shoes) → Sneakers; backless or open → Sandals; only a visible heel → Heels (a "wedge" in the title that is flat on the photo is NOT Heels)
   - linen pants are Trousers — Jeans only for denim
   - generic jacket: padded → Parka, denim → Denim Jacket, leather → Leather Jacket, otherwise Bomber Jacket
   - wallets, purses, totes, backpacks → Bag; necklaces, bracelets, rings, earrings → Jewellery
5. TRUST THE PHOTO when the title is misleading: "Mini Shorts" that is a one-piece playsuit → Casual Set; a "Maxi Skirt" that is a full dress → Dress; a "Shoe" that is a boot → Boots.
6. When an item has a CURRENT type (store check): keep that exact type unless the photo clearly shows a different kind of item. Close calls (Top vs Blouse, Lingerie vs Top, Jogger vs Trousers, Casual Set vs Loungewear Set, Shorts vs Sports Shorts) → keep CURRENT.
7. Never invent a type, never answer two types, never leave one out.

THE LIST:
${swTypeListText()}`;

function imageOf(p) {
  if (!p) return null;
  if (p.imageUrl) return p.imageUrl;
  if (p.image && p.image.src) return p.image.src;
  if (Array.isArray(p.images) && p.images.length) return p.images[0].src || p.images[0].url || null;
  return null;
}

async function callBatch(batch, withImages, ai) {
  const content = [];
  batch.forEach((it, i) => {
    const url = withImages ? imageOf(it.p) : null;
    content.push({
      type: "text",
      text: `ITEM ${i}\nGENDER: ${it.gender || "unknown"}\nTITLE: ${String(it.p.title || "").slice(0, 200)}${it.current ? `\nCURRENT: ${it.current}` : ""}${url ? "\nPHOTO:" : "\n(no photo)"}`,
    });
    if (url) content.push({ type: "image", source: { type: "url", url: thumb(url, 400) } });
  });
  content.push({ type: "text", text: `Give every ITEM above (0–${batch.length - 1}) its one type from the list via save_types.` });
  const res = await getClient().messages.create({
    model: CHEAP_MODEL,
    max_tokens: 900,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: "save_types",
        description: "Save one product type per item.",
        input_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: { index: { type: "integer" }, type: { type: "string", enum: SW_TYPES } },
                required: ["index", "type"],
              },
            },
          },
          required: ["items"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_types" },
    messages: [{ role: "user", content }],
  });
  addAiUsage(ai, CHEAP_MODEL, res);
  const tu = res.content.find((c) => c.type === "tool_use");
  const out = new Map();
  for (const r of (tu && tu.input && tu.input.items) || []) {
    if (Number.isInteger(r.index) && r.index >= 0 && r.index < batch.length) out.set(r.index, String(r.type || ""));
  }
  return out;
}

const baseOf = (t) => (parseSwType(t) || {}).base || "";

/**
 * products: [{id, title, product_type, tags, images|image|imageUrl}]
 * opts.force: ook producten die al goed staan opnieuw indelen (standaard niet)
 * opts.photoCheck: alles langs de AI met het huidige type erbij; een type dat
 *   volgens de regels klopt blijft staan, tenzij de foto een andere soort laat zien
 * → { results: Map(id → {type, source: "ok"|"spelling"|"seizoen"|"soort"|"foto"|"ai"|"fallback", old}), ai, errors: [] }
 */
export async function classifySwTypes(products, opts = {}) {
  const ai = emptyAiUsage();
  const results = new Map();
  const errors = [];
  const todo = [];
  const photo = !!opts.photoCheck;
  for (const p of products || []) {
    const id = String(p.id);
    const old = String(p.product_type || "").trim();
    const v = swTypeVerdict(p);
    if (v.ok && !opts.force && !photo) {
      results.set(id, { type: old, source: "ok", old });
      continue;
    }
    if (v.canonical && !opts.force && !photo) {
      // spelling, seizoen of soort volgens de vaste regel — geen AI nodig
      results.set(id, { type: v.canonical, source: v.kind || "spelling", old });
      continue;
    }
    // bij de fotocheck: het type zoals het volgens de regels hoort als "CURRENT"
    const current = photo ? (v.ok ? old : v.canonical || "") : "";
    todo.push({ id, p, old, v, current, gender: swGenderOf(p) });
  }

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    let got = null;
    try {
      got = await callBatch(batch, opts.images !== false, ai);
    } catch (e) {
      errors.push(`AI met foto's mislukt (${String(e.message || e).slice(0, 120)}) — opnieuw zonder foto's`);
      try {
        got = await callBatch(batch, false, ai);
      } catch (e2) {
        errors.push(`AI zonder foto's ook mislukt (${String(e2.message || e2).slice(0, 120)}) — vangnet op de titel`);
        got = new Map();
      }
    }
    batch.forEach((it, idx) => {
      let t = got.get(idx) || "";
      let source = "ai";
      const tg = swTypeGender(t);
      const aiOk = isSwType(t) && !(it.gender && tg && tg !== it.gender);
      if (it.current) {
        // FOTOCHECK: zelfde soort als het (regel-)type → dat type houden; AI weg
        // of onbruikbaar → nooit een goed type overschrijven met het vangnet
        const keepSource = it.v.ok ? "ok" : it.v.kind || "spelling";
        if (!aiOk) {
          results.set(it.id, { type: it.current, source: keepSource, old: it.old });
          return;
        }
        t = normalizeSwType(t, it.p);
        if (baseOf(t) === baseOf(it.current) || swTypeGender(t) !== swTypeGender(it.current)) {
          results.set(it.id, { type: it.current, source: keepSource, old: it.old });
          return;
        }
        results.set(it.id, { type: t, source: "foto", old: it.old });
        return;
      }
      if (!aiOk) {
        t = guessSwType(it.p, it.gender || tg || "women");
        source = "fallback";
      } else {
        // seizoensregel (sandalen/shorts/zwemkleding SS, sneakers/jeans … AS) + soortregel
        t = normalizeSwType(t, it.p);
      }
      results.set(it.id, { type: t, source, old: it.old });
    });
  }
  return { results, ai, errors };
}
