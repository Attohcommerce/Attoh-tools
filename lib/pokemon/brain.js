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
  'Japanese products end with "(Japans, <set code>)" when the code is known, else "(Japans)" — in Dutch, also when the rest of the title is English. English gets no language tag.',
  'Use the official product type words: Elite Trainer Box, Pokémon Center Elite Trainer Box, Booster Box, Booster Bundle, Booster Pack, Sleeved Booster Pack, 3-Pack Blister, 2-Pack Blister, Premium Checklane Blister, Mini Tin, Tin, Mini Tin Display, Premium Collection, Ultra Premium Collection, Battle Deck, League Battle Deck, Booster Box Case, Elite Trainer Box Case.',
  "No shop names, no emojis, no ALL CAPS, max ~90 characters. Always Pokémon with é.",
];

/* ---------- 2. Omschrijving ---------- */

// Strategie 2 — onze huisstijl (wordt gebruikt als de bron geen foto's in de tekst heeft)
// Vaste koppen per taal — het thema haalt het "Wat zit erin"-blok uit de omschrijving op deze kop.
export const HEADINGS = {
  nl: { inside: "Wat zit erin", about: "Over", why: "Waarom je dit wilt", details: "Productdetails", set: "Set", type: "Producttype", lang: "Taal", packs: "Booster packs", cards: "Kaarten per pack", release: "Release", condition: "Conditie", conditionValue: "Nieuw, factory sealed", note: "Let op", collectors: "Verzamelaars", players: "Spelers" },
  en: { inside: "What's inside", about: "About", why: "Why you'll love it", details: "Product details", set: "Set", type: "Product type", lang: "Language", packs: "Booster packs", cards: "Cards per pack", release: "Release", condition: "Condition", conditionValue: "Brand new, factory sealed", note: "Note", collectors: "Collectors", players: "Players" },
};

export function houseStyle(lang = "nl") {
  const h = HEADINGS[lang] || HEADINGS.en;
  return `HOUSE STYLE (strategy 2 — use this exact structure, in this order; headings EXACTLY as written here)
<p>HOOK: 1–2 punchy sentences. Name the product and the main draw (featured Pokémon, promo card, number of packs). Energetic, collector-to-collector, a little urgency is good.</p>
<h3>${h.inside}</h3>
<ul><li>One line per item WITH quantities, e.g. "9 Delta Reign booster packs", "1 full-art foil promokaart met Kyogre", "65 card sleeves". Most important block: the customer must see exactly what they get. For a case: first "6 × sealed <product>", then a nested line per item of ONE box.</li></ul>
<h3>${h.about} <Set></h3>
<p>2–3 sentences on what makes the set special: headline Pokémon, new mechanics, chase rarities. Only facts from the sources or the set facts given to you.</p>
<h3>${h.why}</h3>
<ul><li><strong>${h.collectors}:</strong> …</li><li><strong>${h.players}:</strong> …</li><li><strong><one more angle: opening night, gifting, keeping sealed>:</strong> …</li></ul>
<h3>${h.details}</h3>
<ul><li><strong>${h.set}:</strong> …</li><li><strong>${h.type}:</strong> …</li><li><strong>${h.lang}:</strong> …</li><li><strong>${h.packs}:</strong> … (if known)</li><li><strong>${h.cards}:</strong> … (if known)</li><li><strong>${h.release}:</strong> … (only if a source states it)</li><li><strong>${h.condition}:</strong> ${h.conditionValue}</li></ul>
<p>CLOSER: one short urgent line, e.g. "Nieuwe releases gaan hard. Leg 'm vast, of klik op Houd me op de hoogte en sta vooraan bij de volgende lading."</p>
Extra blocks when they apply:
- Random design/artwork → add <p><em>${h.note}: het design wordt willekeurig gekozen; een specifieke artwork kun je niet kiezen.</em></p> right after the hook (translate to the writing language).
- Japanese → in ${h.details} add "<li><strong>${h.note}:</strong> de kaarten zijn Japans gedrukt</li>" (translate to the writing language).
- Several variants (option "Design") → in ${h.inside}, explain what changes per variant.
Keep the product-type words as collectors use them (Elite Trainer Box, Booster Box, Booster Bundle, Booster Pack, blister, tin, promokaart, sleeves, sealed); do not translate those.`;
}

// Oude constante (Engels) blijft bestaan voor compatibiliteit
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
- Write in the language you are told (Dutch by default: informeel "je", geen "u"), confident shop-floor energy: like a collector telling a friend why this box is worth it. Short sentences, active voice.
- Urgency is welcome ("goes fast", "don't sleep on it", "be first in line") but no fake numbers, no fake countdowns, no fake "only 2 left".
- Never mention other shops, prices, discounts, shipping times or stock levels.
- Never promise specific pulls: booster contents are random.
- "Pokémon" always with é; the game is "Pokémon TCG".`;

/* ---------- 3. Inhoudskennis per type ---------- */
// Gebruikt als de bron geen inhoud noemt. Staat het WEL in een bron, dan wint de bron.

export const CONTENTS = {
  "Booster Box": {
    en: ["36 booster packs (English booster boxes; a Half Booster Box has 18)"],
    ja: ["30 booster packs in a standard Japanese box (30th Celebration Japanese box: 20 packs; High Class Pack boxes: 10 packs)", "5 cards per Japanese booster pack (30th Celebration: 6 foil cards; High Class: 10 cards)", "Japanese boxes are often sold without outer shrink film — never claim shrink wrap unless a source says so"],
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
  "Booster Pack": { en: ["1 sealed booster pack", "10 cards + 1 Basic Energy + 1 Pokémon TCG Live code card per English pack (30th Celebration: 6 foil cards)"], ja: ["1 sealed booster pack", "5 cards per Japanese pack (30th Celebration: 6 foil cards; High Class Pack: 10 cards)"] },
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
  "Theme Deck": { en: ["1 ready-to-play 60-card deck + accessories (take the details from the sources)", "Battle Deck: 60 cards + promo, no booster packs", "League Battle Deck: 60-card competitive deck, 6 damage-counter dice, coin-flip die, 2 condition markers, deck box, strategy sheet, code card"] },
  "Build & Battle": { en: ["4 booster packs", "1 40-card ready-to-play deck", "1 prerelease promo card"] },
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
  // Bronnen 09-11-2026: pokennoisseur release calendar, Bill's Archive, TCG Protectors, Samurai Sword Tokyo, Wargamer + concurrentteksten
  "Delta Reign":
    "English Mega Evolution set ME06 (code DLR), released worldwide 6 November 2026, over 135 cards (main set numbered /103). Japanese counterpart: Storm Emeralda (M6). Headline: Mega Rayquaza ex (Special Illustration Rare and Mega Ultra Rare chase cards); also Mega Golisopod ex, Mega Golurk ex and Mega Malamar ex. New mechanic: Legendary Stadiums, pairs of Stadium cards that share a name and form one continuous illustration (Legendary Summit, Legendary Trench and a third pair). Four booster pack arts: Mega Rayquaza, Mega Golisopod, Mega Golurk, Mega Malamar. ETB promo: Kyogre Illustration Rare (ETB exclusive, not in packs); Pokémon Center ETB has 11 packs plus a stamped Kyogre and a standard Kyogre. 3-Pack Blister promo: Seel. Checklane blister promos: Spritzee, Ampharos, Delphox. Build & Battle Box (20 November 2026): 4 packs + 40-card deck + prerelease promo. MEGA Starter Decks: Eevee ex, Zoroark ex, Meowscarada ex.",
  "30th Celebration":
    "Anniversary set (code 30C, Japanese M6a) for 30 years of the Pokémon TCG, released worldwide on the same day, 16 September 2026. Every card is foil, Basic Energy included. Packs hold 6 foil cards (5 Pokémon + 1 foil Basic Energy) and every pack has one of 30 different Pikachu illustrations, each by a different illustrator. Classic Collection cards (reprints such as Crystal Lugia and Dark Tyranitar) and the new Futuristic Rare rarity (first seen on Mew ex). Products: ETB 9 packs + Nidorina promo; Pokémon Center ETB 11 packs + 2 Nidorina promos (one Pokémon Center stamped); Sylveon ex Box and Greninja ex Box 4 packs + ex promo; Poster Collection 3 packs + Articuno/Zapdos/Moltres promos + poster; Tech Sticker Collection (Alolan Exeggutor or Lucario) 3 packs + promo; Knock Out Collection 2 packs + Eevee; 2-Pack Blister 2 packs + Eevee; Booster Bundle 6 packs; Day & Night Mini Tins 2 packs each, 10 designs (display = all 10 tins, 20 packs); Battle Deck Espeon ex (Victini promo) and Umbreon ex (Zeraora promo), 60-card decks, no packs; Ultra-Premium Collection Day (Pikachu ex Day + Espeon ex) and Night (Pikachu ex Night + Umbreon ex), 29 packs + 1 Classic Collection pack, 6 November 2026; Ditto Premium Collection 8 packs + Ditto; Figure Collection Mew / Mewtwo 5 packs + promo + figure; Sylveon ex Tin and Greninja ex Tin 4 packs (4 December 2026); Binder Collection 5 packs (4 December 2026). Japanese: booster box 20 packs, pack 6 foil cards (¥360); Premium Deck Set Espeon & Umbreon 2 × 60-card decks (no packs); Futuristic Collection Box (Pokémon Center Online exclusive, no packs, Pikachu ex Day & Night promos); First Partner Card Sets Gen 1–9 (Kanto to Paldea): 3 holo starter promos + 2 packs + card stand each (16 October 2026).",
  "Ascended Heroes":
    "English Mega Evolution set ME2.5 (released 30 January 2026, delayed to mid-February in some regions). Tins and ex boxes feature Mega Meganium ex, Mega Emboar ex and Mega Feraligatr ex; tins hold 4 booster packs + a foil promo. Pull rate reported by the community: roughly 1 Special Illustration Rare per 70 packs.",
  "Perfect Order": "English Mega Evolution set ME03, released 27 March 2026. Japanese counterpart: Nihil Zero (M3), led by Mega Zygarde ex.",
  "Chaos Rising": "English Mega Evolution set ME04, released 22 May 2026. Japanese counterpart: Ninja Spinner (M4). Gold Greninja is a known chase card.",
  "Pitch Black": "English Mega Evolution set ME05, released 17 July 2026. Japanese counterpart: Abyss Eye (M5).",
  "Flowing Fists": "English Mega Evolution set ME07 (code FLO), releases 5 February 2027. Japanese counterpart: Aura Seeker (M7, 27 November 2026). Headline: Mega Lucario Z ex (Metal, 210 HP, Aura Seeker ability fetches a Supporter). Also Sigilyph ex. Products not announced yet — never list contents.",
  "Nihil Zero": "Japanese Mega Evolution set M3 (released 23 January 2026), led by Mega Zygarde ex, with Mega Starmie, Mega Clefable and Mega Skarmory. 80-card main set plus secret rares (AR, SAR, gold Mega Zygarde ex). English counterpart: Perfect Order.",
  "Ninja Spinner": "Japanese Mega Evolution set M4 (released 13 March 2026). English counterpart: Chaos Rising.",
  "Abyss Eye": "Japanese Mega Evolution set M5. English counterpart: Pitch Black.",
  "Storm Emeralda": "Japanese Mega Evolution set M6 (released 31 July 2026), led by Mega Rayquaza ex. Japanese counterpart of Delta Reign. About 76 cards in the main set plus secret rares (AR, SAR). Pack: 5 cards, ¥200; box: 30 packs.",
  "Aura Seeker": "Japanese Mega Evolution set M7, releases 27 November 2026, led by Mega Lucario Z ex. English counterpart: Flowing Fists (February 2027).",
  "MEGA x MEGA Parade": "Japanese High Class Pack set, 19 February 2027. 10 cards per pack (¥550) with a guaranteed hit per pack. Mega Raichu X and Y; also Mega Greninja ex, Mega Zygarde ex, Mega Darkrai ex, Mega Rayquaza ex.",
};

export const SET_CODES = {
  "Delta Reign": "ME06", "Pitch Black": "ME05", "Chaos Rising": "ME04", "Perfect Order": "ME03", "Ascended Heroes": "ME2.5", "30th Celebration": "30C", "Flowing Fists": "ME07",
  "Nihil Zero": "M3", "Ninja Spinner": "M4", "Abyss Eye": "M5", "Storm Emeralda": "M6", "Aura Seeker": "M7",
};

// Japanse set ↔ Engelse set (zelfde kaarten, andere taal)
export const JP_OF = { "Delta Reign": "Storm Emeralda", "Pitch Black": "Abyss Eye", "Chaos Rising": "Ninja Spinner", "Perfect Order": "Nihil Zero", "Flowing Fists": "Aura Seeker" };

/* ---------- 5. Collecties ---------- */
// Smart collections op tag. Handles komen overeen met de links in het thema.

export const RELEASE_YEAR = {
  "Delta Reign": 2026, "30th Celebration": 2026, "Pitch Black": 2026, "Chaos Rising": 2026, "Perfect Order": 2026,
  "Ascended Heroes": 2026, "Storm Emeralda": 2026, "Abyss Eye": 2026, "Ninja Spinner": 2026, "Nihil Zero": 2026, "Aura Seeker": 2026,
  "Flowing Fists": 2027, "MEGA x MEGA Parade": 2027,
};

// Releasedatums (voor "Coming soon" en de releasekalender) — bron: pokennoisseur / Bill's Archive 09-11-2026
export const RELEASE_DATES = {
  // Engels (Mega Evolution / Scarlet & Violet / Sword & Shield)
  "Flowing Fists": "2027-02-05", "Delta Reign": "2026-11-06", "30th Celebration": "2026-09-16", "Pitch Black": "2026-07-17", "Chaos Rising": "2026-05-22",
  "Perfect Order": "2026-03-27", "Ascended Heroes": "2026-01-30", "Phantasmal Flames": "2025-11-14", "Mega Evolution": "2025-09-26",
  "Black Bolt": "2025-07-18", "White Flare": "2025-07-18", "Destined Rivals": "2025-05-30", "Journey Together": "2025-03-28", "Prismatic Evolutions": "2025-01-17",
  "Surging Sparks": "2024-11-08", "Stellar Crown": "2024-09-13", "Shrouded Fable": "2024-08-02", "Twilight Masquerade": "2024-05-24", "Temporal Forces": "2024-03-22",
  "Paldean Fates": "2024-01-26", "Paradox Rift": "2023-11-03", "151": "2023-09-22", "Obsidian Flames": "2023-08-11", "Paldea Evolved": "2023-06-09",
  "Scarlet & Violet Base": "2023-03-31", "Crown Zenith": "2023-01-20", "Silver Tempest": "2022-11-11", "Lost Origin": "2022-09-09", "Pokémon GO": "2022-07-01",
  "Astral Radiance": "2022-05-27", "Brilliant Stars": "2022-02-25", "Fusion Strike": "2021-11-12", "Celebrations": "2021-10-08", "Evolving Skies": "2021-08-27",
  "Chilling Reign": "2021-06-18", "Battle Styles": "2021-03-19", "Shining Fates": "2021-02-19", "Vivid Voltage": "2020-11-13", "Champion's Path": "2020-09-25",
  "Darkness Ablaze": "2020-08-14", "Rebel Clash": "2020-05-01", "Sword & Shield Base": "2020-02-07", "Cosmic Eclipse": "2019-11-01", "Hidden Fates": "2019-08-23",
  // Japans (alleen zekere datums; de rest sorteert op de volgorde in de setlijst)
  "MEGA x MEGA Parade": "2027-02-19", "Aura Seeker": "2026-11-27", "Storm Emeralda": "2026-07-31", "Ninja Spinner": "2026-03-13", "Nihil Zero": "2026-01-23",
  "Terastal Festival ex": "2024-12-06", "Shiny Treasure ex": "2023-12-01", "VSTAR Universe": "2022-12-02",
};

// Sets die altijd gevraagd blijven (voor de knop "Klassiekers" in de importer)
export const CLASSIC_SETS = [
  "151", "Prismatic Evolutions", "Evolving Skies", "Crown Zenith", "Celebrations", "Paldean Fates", "Shining Fates", "Hidden Fates",
  "Obsidian Flames", "Surging Sparks", "Destined Rivals", "Champion's Path", "Shiny Treasure ex", "Terastal Festival ex", "VSTAR Universe",
];

// Max per bestelling op hete producten (thema toont "Max X per customer"); 0 = geen limiet.
// Justins voorstel 09-11: 2 ETB's, 1 UPC, 1 booster box, 1 case.
export const MAX_QTY = { "Ultra Premium Collection": 1, "Booster Box": 1, "Elite Trainer Box": 2, Case: 1 };

/** Releasedatum (YYYY-MM-DD) van een set, of "" als onbekend. */
export function releaseDateOf(set) {
  return RELEASE_DATES[set] || "";
}

/** Nog niet uit? (releasedatum in de toekomst) */
export function isUpcoming(set, now = new Date()) {
  const d = RELEASE_DATES[set];
  return !!d && d > now.toISOString().slice(0, 10);
}

/** Extra tags/collecties bovenop type/set/era/taal: "2026 Releases", "Cases", "Binnenkort" (coming soon). */
export function extraCollections({ set, type, year }) {
  const out = [];
  const y = year || RELEASE_YEAR[set];
  if (y) out.push(`Releases ${y}`);
  if (type === "Case") out.push("Cases");
  if (isUpcoming(set)) out.push("Binnenkort");
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
