// POKÉMON TOOL — het "brein" van de importer (09-11-2026).
//
// Los van de fashion-tools: dit is alleen voor de Pokémon-store (Pull Society).
// Hier staat HOE we importeren, zodat de hele store er hetzelfde uitziet:
//   1. titelregels
//   2. omschrijving — strategie 1 (concurrent heeft foto's in de omschrijving:
//      die opbouw is leidend) of strategie 2 (onze vaste huisstijl)
//   3. inhoudskennis per producttype (wat zit er in een ETB, box, bundle …)
//   4. setkennis (feiten die bij de concurrenten stonden)
//   5. collecties die bij het importeren worden aangemaakt
//
// Analyse 09-11-2026 van ~3.000 producten bij Beam, Bescards, Brothers in
// Cards en MemTCG:
//  - Geen enkele concurrent zet foto's in de omschrijving (0 van ~3.000).
//    Strategie 1 is er dus voor later of voor nieuwe bronnen; nu is
//    strategie 2 de standaard.
//  - Ze hebben ALLEMAAL een lijst met wat er in de verpakking zit, met aantallen
//    ("9 booster packs", "65 card sleeves"). Dat is het belangrijkste blok.
//  - Beam (meeste omzet): korte haak → "Product description" (2 alinea's,
//    vergelijkt met andere producttypes) → "<product> includes:"-lijst →
//    "Collector & player appeal" (Collectors / Players / extra voordeel).
//  - Bescards: titel als kop → intro → "Contents" → "The booster packs" (kaarten
//    per pack, kansen) → "Product information" (taal, set, type).
//  - Brothers in Cards: intro → wat de set bijzonder maakt (Mega Pokémon,
//    nieuwe mechanics, aantallen rarities) → "Product bevat" → releasedatum.
//  - MemTCG: setcode en releasedatum, "Wat zit er in…", "Voor de verzamelaar",
//    en altijd een waarschuwing bij Japanse kaarten.
//  - Titels: "Pokémon <Set> <Type>", Japans met "(Japanese)" en de setcode
//    (M3/M5/M6). Varianten achter een streepje ("Tin – Mega Emboar").
//
// Wij combineren het beste: haak, inhoudslijst, wat de set bijzonder maakt,
// voor wie het is, productdetails, en een korte urgente afsluiter.

export const BRAIN_VERSION = "2026-11-09";

/* ---------- 1. Titels ---------- */

export const TITLE_RULES = [
  'Format: "Pokémon TCG: <Set> <Product type>" + " – <variant>" if there is one (featured Pokémon or design).',
  'Japanese products end with "(Japanese, <set code>)" when the code is known, else "(Japanese)". English gets no language tag.',
  'Use the official product type words: Elite Trainer Box, Pokémon Center Elite Trainer Box, Booster Box, Booster Bundle, Booster Pack, Sleeved Booster Pack, 3-Pack Blister, 2-Pack Blister, Premium Checklane Blister, Mini Tin, Tin, Mini Tin Display, Premium Collection, Ultra Premium Collection, Battle Deck, League Battle Deck, Booster Box Case, Elite Trainer Box Case.',
  "No shop names, no emojis, no ALL CAPS, max ~90 characters. Always Pokémon with é.",
];

/* ---------- 2. Omschrijving ---------- */

// Strategie 2 — onze huisstijl (wordt gebruikt als de bron geen foto's in de tekst heeft)
export const HOUSE_STYLE = `HOUSE STYLE (strategy 2 — use this exact structure, in this order)
<p>HOOK: 1–2 punchy sentences. Name the product and the main draw (featured Pokémon, promo card, number of packs). Energetic, collector-to-collector, a little urgency is good.</p>
<h3>What's inside</h3>
<ul><li>One line per item WITH quantities, e.g. "9 Delta Reign booster packs", "1 full-art foil promo card featuring Kyogre", "65 card sleeves". Most important block: the customer must see exactly what they get. For a case: first "6 × sealed <product>", then a nested line per item of ONE box.</li></ul>
<h3>About <Set></h3>
<p>2–3 sentences on what makes the set special: headline Pokémon, new mechanics, chase rarities. Only facts from the sources or the set facts given to you.</p>
<h3>Why you'll love it</h3>
<ul><li><strong>Collectors:</strong> …</li><li><strong>Players:</strong> …</li><li><strong><one more angle: opening night, gifting, keeping sealed>:</strong> …</li></ul>
<h3>Product details</h3>
<ul><li><strong>Set:</strong> …</li><li><strong>Product type:</strong> …</li><li><strong>Language:</strong> …</li><li><strong>Booster packs:</strong> … (if known)</li><li><strong>Cards per pack:</strong> … (if known)</li><li><strong>Release:</strong> … (only if a source states it)</li><li><strong>Condition:</strong> Brand new, factory sealed</li></ul>
<p>CLOSER: one short urgent line, e.g. "New releases move fast — lock yours in, or hit Notify me and be first in line when the next batch lands."</p>
Extra blocks when they apply:
- Random design/artwork → add <p><em>Please note: the design is picked at random; a specific artwork can't be chosen.</em></p> right after the hook.
- Japanese → in Product details add "<li><strong>Note:</strong> cards are printed in Japanese</li>".
- Several variants (option "Design") → in What's inside, explain what changes per variant.`;

// Strategie 1 — bron heeft foto's in de omschrijving
export const IMAGE_STYLE = `IMAGE LAYOUT (strategy 1 — the source description contains images)
The source text below has markers like [[IMG1]], [[IMG2]] where the source shows images. That layout is LEADING:
- Keep every marker, in the same order and at the same position relative to the text (a marker on its own line between blocks).
- Rewrite the text around the markers in your own words, block for block, following the source's order of sections.
- Still include a clear "What's inside" list with quantities and a "Product details" list if the source has no such block.
- Do not add <img> tags yourself; only keep the markers.`;

export const TONE = `TONE
- English (unless told otherwise), confident shop-floor energy: like a collector telling a friend why this box is worth it. Short sentences, active voice.
- Urgency is welcome ("goes fast", "don't sleep on it", "be first in line") but no fake numbers, no fake countdowns, no fake "only 2 left".
- Never mention other shops, prices, discounts, shipping times or stock levels.
- Never promise specific pulls: booster contents are random.
- "Pokémon" always with é; the game is "Pokémon TCG".`;

/* ---------- 3. Inhoudskennis per type ---------- */
// Gebruikt als de bron geen inhoud noemt. Staat het WEL in een bron, dan wint de bron.

export const CONTENTS = {
  "Booster Box": {
    en: ["36 booster packs (English booster boxes)"],
    ja: ["30 booster packs (Japanese main-series boxes)", "5 cards per Japanese booster pack"],
  },
  "Booster Bundle": { en: ["6 booster packs"] },
  "Elite Trainer Box": {
    en: [
      "9 booster packs (Pokémon Center edition: 11)",
      "1 full-art foil promo card",
      "65 card sleeves",
      "Basic Energy cards",
      "1 player's guide to the expansion",
      "6 damage-counter dice",
      "1 competition-legal coin-flip die",
      "1 collector's box with dividers",
      "1 Pokémon TCG Live code card",
    ],
  },
  "Booster Pack": { en: ["1 sealed booster pack", "10 cards per English pack (30th Celebration: 6 foil cards)"], ja: ["1 sealed booster pack", "5 cards per Japanese pack"] },
  Blister: {
    en: [
      "3-Pack Blister: 3 booster packs + 1 foil promo card + 1 coin",
      "2-Pack Blister: 2 booster packs + 1 foil promo card + 1 coin",
      "Premium Checklane Blister: 1 booster pack + 1 foil promo card + 1 coin",
    ],
  },
  Tin: { en: ["Tin: 4 booster packs + 1 foil promo card", "Mini Tin: 2 booster packs + 1 art card (+ sticker sheet or coin, depending on the release)"] },
  "Collection Box": { en: ["Contents differ per box: always take them from the sources"] },
  "Ultra Premium Collection": { en: ["Contents differ per release: always take them from the sources"] },
  "Theme Deck": { en: ["1 ready-to-play 60-card deck + accessories (take the details from the sources)"] },
  Accessories: { en: ["Card storage/protection, no cards included (unless a source says so)"] },
  Case: { en: ["A sealed case = several identical sealed products straight from the distributor"] },
};

export function contentsHint(type, lang) {
  const c = CONTENTS[type];
  if (!c) return "";
  const list = (lang === "Japanese" && c.ja) || c.en || [];
  return list.length ? "Typical contents for this product type (use only if the sources don't list contents; sources win): " + list.join("; ") : "";
}

/* ---------- 4. Setkennis (uit de concurrentteksten van 09-11) ---------- */

export const SET_FACTS = {
  "Delta Reign": "English Mega Evolution set led by Mega Rayquaza ex; also Mega Golurk ex, Mega Malamar ex and Mega Golisopod ex. Introduces Legendary Stadiums: pairs of Stadium cards that form one big illustration. ETB promo: full-art Kyogre. 3-Pack Blister promo: Seel.",
  "30th Celebration": "Anniversary set for 30 years of the Pokémon TCG. Every card is foil, Basic Energy included. Packs hold 6 foil cards (5 Pokémon + 1 foil Basic Energy), and every pack has one of 30 different Pikachu illustrations. Classic Collection cards and the new Futuristic Rare rarity. ETB promo: full-art Nidorina (Pokémon Center ETB: 2 Nidorina promos, 11 packs). UPC Day: Pikachu ex + Espeon ex promos, 29 packs + 1 Classic Collection pack. Mini Tin Display: 10 Mini Tins, one of each design, 2 packs each.",
  "Ascended Heroes": "English Mega Evolution set. Tins and ex boxes feature Mega Meganium ex, Mega Emboar ex and Mega Feraligatr ex; tins hold 4 booster packs + a foil promo.",
  "Nihil Zero": "Japanese Mega Evolution set M3 (released 23 January 2026), led by Mega Zygarde ex, with Mega Starmie, Mega Clefable and Mega Skarmory. 80-card main set plus secret rares (AR, SAR, gold Mega Zygarde ex).",
  "Storm Emeralda": "Japanese Mega Evolution set M6 (released 31 July 2026), led by Mega Rayquaza ex. Japanese counterpart of Delta Reign. About 76 cards in the main set plus secret rares (AR, SAR).",
  "Abyss Eye": "Japanese Mega Evolution set M5.",
  "Ninja Spinner": "Japanese Mega Evolution set M4.",
};

export const SET_CODES = { "Nihil Zero": "M3", "Ninja Spinner": "M4", "Abyss Eye": "M5", "Storm Emeralda": "M6" };

/* ---------- 5. Collecties ---------- */
// Smart collections op tag. Handles komen overeen met de links in het thema.

export const RELEASE_YEAR = {
  "Delta Reign": 2026, "30th Celebration": 2026, "Pitch Black": 2026, "Chaos Rising": 2026, "Perfect Order": 2026,
  "Ascended Heroes": 2026, "Storm Emeralda": 2026, "Abyss Eye": 2026, "Ninja Spinner": 2026, "Nihil Zero": 2026,
};

/** Extra tags/collecties bovenop type/set/era/taal: "2026 Releases", "Cases". */
export function extraCollections({ set, type, year }) {
  const out = [];
  const y = year || RELEASE_YEAR[set];
  if (y) out.push(`${y} Releases`);
  if (type === "Case") out.push("Cases");
  return out;
}

/* ---------- Foto's in de omschrijving (strategie 1) ---------- */

/** Haal <img>-bronnen uit HTML (geen icoontjes/tracking-pixels). */
export function bodyImages(html) {
  const out = [];
  const re = /<img\b[^>]*?\s(?:data-src|src)=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    let u = m[1].trim();
    if (u.startsWith("//")) u = "https:" + u;
    if (!/^https?:\/\//i.test(u)) continue;
    if (/\.(svg|gif)(\?|$)/i.test(u) || /pixel|spacer|icon|emoji|badge|logo/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 10);
}

/** Bron-HTML → tekst met [[IMGn]]-markers op de plek van de foto's. */
export function markImages(html) {
  const imgs = bodyImages(html);
  let n = 0;
  const text = String(html || "")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const u = (tag.match(/(?:data-src|src)=["']([^"']+)["']/i) || [])[1] || "";
      const full = u.startsWith("//") ? "https:" + u : u;
      const i = imgs.indexOf(full);
      if (i < 0) return " ";
      n = Math.max(n, i + 1);
      return `\n[[IMG${i + 1}]]\n`;
    })
    .replace(/<\/(p|h\d|li|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { text, images: imgs };
}

/** Markers in onze HTML vervangen door echte <img>-tags (ontbrekende markers achteraan). */
export function fillImageMarkers(html, urls, alt) {
  const used = new Set();
  const tag = (u) => `<p><img src="${u}" alt="${String(alt || "").replace(/"/g, "&quot;")}" loading="lazy" style="max-width:100%;height:auto"></p>`;
  let out = String(html || "")
    .replace(/<p>\s*\[\[IMG(\d+)\]\]\s*<\/p>/gi, (m, d) => {
      const u = urls[Number(d) - 1];
      if (!u) return "";
      used.add(u);
      return tag(u);
    })
    .replace(/\[\[IMG(\d+)\]\]/gi, (m, d) => {
      const u = urls[Number(d) - 1];
      if (!u) return "";
      used.add(u);
      return tag(u);
    });
  const rest = urls.filter((u) => !used.has(u));
  if (rest.length) out += rest.map(tag).join("");
  return out;
}
