// ============================================================
// FASHION MATCHING ENGINE
// ------------------------------------------------------------
// Vindt producten die een keyword ÉCHT zijn, in vaste volgorde:
//
//   Stap 1 — TITEL      product heet zo → sterkste bewijs
//   Stap 2 — OMSCHRIJVING  alleen als de tekst ultra-duidelijk
//             over DIT product gaat ("this dress features…"),
//             nooit via styling-zinnen ("pair with a dress")
//   Stap 3 — FOTO'S     bestandsnamen/alt-teksten van de foto's
//             (spaghetti-strap-dress-2.jpg telt als bewijs)
//
// Waterdicht gemaakt met:
//  - woordgrens-matching (geen "dress" meer in "address")
//  - producttype-eis: het zelfstandig naamwoord van het keyword
//    (dress/heels/jeans/…) moet als type bewezen zijn, anders geen match
//  - mode-synoniemen: tee=t-shirt, pumps=heels, cami=spaghetti strap,
//    long sleeve=longsleeve, palazzo=wide leg, enz.
//  - stijlwoorden (elegant/occasion/casual…) matchen op hun hele cluster
//  - ALLE keyword-woorden moeten bewezen zijn, anders valt het product af
// ============================================================

/* ---------------- Tokenizer ---------------- */

export function tok(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Kandidaat-stammen van een woord: dresses→dress, stripes→stripe/strip
function stems(w) {
  const out = [w];
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) out.push(w.slice(0, -1));
  if (w.length > 4 && w.endsWith("es")) out.push(w.slice(0, -2));
  return out;
}

function eqW(a, b) {
  if (a === b) return true;
  const sa = stems(a);
  const sb = stems(b);
  for (const x of sa) if (sb.includes(x)) return true;
  return false;
}

// Zit term (array van woorden) in tokens? Met woordgrenzen én
// samensmelt-tolerantie: "long sleeve" ↔ "longsleeve".
function hasTerm(tokens, term) {
  const n = term.length;
  if (n === 1) {
    const w = term[0];
    for (let i = 0; i < tokens.length; i++) {
      if (eqW(tokens[i], w)) return true;
      if (i + 1 < tokens.length && eqW(tokens[i] + tokens[i + 1], w)) return true;
    }
    return false;
  }
  outer: for (let i = 0; i + n <= tokens.length; i++) {
    for (let j = 0; j < n; j++) {
      if (!eqW(tokens[i + j], term[j])) continue outer;
    }
    return true;
  }
  // "spaghettistrap" als één token
  const joined = term.join("");
  for (const t of tokens) if (eqW(t, joined)) return true;
  return false;
}

function hasAnyTerm(tokens, terms) {
  for (const t of terms) if (hasTerm(tokens, t)) return true;
  return false;
}

// Exacte woordreeks (voor Literal-check)
function hasSeq(tokens, seq) {
  return hasTerm(tokens, seq);
}

/* ---------------- Mode-taxonomie ---------------- */

const T = (s) => s.split(" ");

// Producttypes met hun synoniemen/varianten
const TYPE_GROUPS = [
  { id: "dress", terms: ["dress", "gown", "sundress", "shirtdress", "maxidress", "minidress", "mididress"] },
  { id: "tshirt", terms: ["tshirt", "t shirt", "tee", "graphic tee"] },
  { id: "shirt", terms: ["shirt"] },
  { id: "blouse", terms: ["blouse"] },
  { id: "top", terms: ["top", "tank top", "camisole", "cami top", "crop top"] },
  { id: "sweater", terms: ["sweater", "jumper", "pullover", "knit", "knitwear"] },
  { id: "hoodie", terms: ["hoodie", "sweatshirt"] },
  { id: "cardigan", terms: ["cardigan"] },
  { id: "jacket", terms: ["jacket"] },
  { id: "coat", terms: ["coat", "overcoat", "parka", "trench"] },
  { id: "blazer", terms: ["blazer"] },
  { id: "jeans", terms: ["jeans"] },
  { id: "pants", terms: ["pants", "trousers", "slacks"] },
  { id: "leggings", terms: ["leggings", "legging"] },
  // "shorts" is het gevaarlijkste type dat er is: de stemmer maakt van
  // "shorts" ook "short", waardoor "Short-Sleeve Blouse" als korte broek
  // matchte. exactOnly = alleen het letterlijke woord telt als producttype.
  { id: "shorts", terms: ["shorts"], exactOnly: true },
  { id: "skirt", terms: ["skirt", "skort"] },
  { id: "jumpsuit", terms: ["jumpsuit", "playsuit", "romper"] },
  { id: "heels", terms: ["heels", "heel", "pumps", "stiletto", "stilettos"], implied: ["high"] },
  { id: "boots", terms: ["boots", "boot", "booties"] },
  { id: "sneakers", terms: ["sneakers", "sneaker", "trainers", "runners"] },
  { id: "loafers", terms: ["loafers", "loafer", "moccasin"] },
  { id: "sandals", terms: ["sandals", "sandal", "slides"] },
  { id: "flats", terms: ["flats", "ballerina", "ballet flats"] },
  { id: "mules", terms: ["mules", "mule"] },
  { id: "bag", terms: ["bag", "handbag", "tote", "purse", "crossbody bag"] },
  { id: "scarf", terms: ["scarf", "scarves"] },
  { id: "belt", terms: ["belt"] },
  { id: "hat", terms: ["hat", "beanie", "cap"] },
  { id: "swimsuit", terms: ["swimsuit", "swimwear", "bathing suit"] },
  { id: "bikini", terms: ["bikini"] },
  { id: "vest", terms: ["vest", "gilet", "waistcoat"] },
  { id: "polo", terms: ["polo", "polo shirt"] },
  { id: "bodysuit", terms: ["bodysuit"] },
  { id: "kimono", terms: ["kimono", "kaftan", "caftan"] },
  { id: "pajamas", terms: ["pajamas", "pyjamas", "sleepwear", "nightwear"] },
  { id: "bra", terms: ["bra", "bralette", "sports bra"] },
  { id: "set", terms: ["set", "two piece", "co ord", "coord"] },
  { id: "suit", terms: ["suit"] },
  { id: "sunglasses", terms: ["sunglasses"] },
].map((g) => ({ ...g, terms: g.terms.map(T) }));

// Harde eigenschappen — moeten ergens bewezen worden (titel/omschrijving/foto's)
const MODIFIER_GROUPS = [
  ["long sleeve", "long sleeves", "long sleeved", "longsleeve"],
  ["short sleeve", "short sleeves", "short sleeved", "shortsleeve"],
  ["sleeveless", "tank", "no sleeves"],
  ["spaghetti strap", "spaghetti straps", "thin strap", "thin straps", "skinny strap", "cami", "camisole"],
  ["off shoulder", "off the shoulder", "bardot"],
  ["one shoulder", "single shoulder", "asymmetric"],
  ["halter", "halter neck", "halterneck"],
  ["strapless", "bandeau", "tube"],
  ["v neck", "vneck", "plunge", "plunging", "plunge neck"],
  ["crew neck", "crewneck", "round neck", "o neck"],
  ["turtleneck", "turtle neck", "high neck", "mock neck", "roll neck", "funnel neck"],
  ["square neck", "square neckline"],
  ["sweetheart", "sweetheart neckline"],
  ["maxi", "floor length", "full length", "ankle length"],
  ["midi", "knee length", "tea length"],
  ["mini"],
  ["bodycon", "body con", "fitted"],
  ["a line", "aline", "fit and flare", "skater", "flare", "flared", "swing"],
  ["wrap", "faux wrap", "surplice"],
  ["high waist", "high waisted", "high rise"],
  ["low rise", "low waist", "low waisted"],
  ["wide leg", "palazzo", "loose leg"],
  ["straight leg"],
  ["skinny", "slim fit", "slim"],
  ["bootcut", "boot cut"],
  ["distressed", "ripped", "destroyed", "raw hem"],
  ["cropped", "crop"],
  ["oversized", "oversize", "relaxed fit", "loose fit", "baggy", "slouchy"],
  ["plus size", "curve", "curvy"],
  ["puff sleeve", "puff sleeves", "puffed sleeve", "balloon sleeve", "bishop sleeve"],
  ["ruffle", "ruffles", "ruffled", "frill", "frilled", "flounce"],
  ["lace", "lacy"],
  ["crochet", "crocheted"],
  ["satin", "silk", "silky", "sateen"],
  ["linen"],
  ["cotton"],
  ["leather", "faux leather", "pu leather", "vegan leather"],
  ["suede"],
  ["velvet"],
  ["denim", "jean", "jeans"],
  ["chiffon"],
  ["tulle"],
  ["mesh", "sheer"],
  ["ribbed", "rib knit"],
  ["cable knit", "chunky knit", "knitted"],
  ["corduroy"],
  ["tweed", "boucle"],
  ["floral", "flower", "flowers", "botanical"],
  ["striped", "stripe", "stripes", "pinstripe"],
  ["polka dot", "polka dots", "dotted"],
  ["plaid", "check", "checked", "checkered", "gingham", "tartan", "houndstooth"],
  ["leopard", "animal print", "cheetah"],
  ["snake print", "snakeskin", "python"],
  ["zebra"],
  ["sequin", "sequins", "sequined", "glitter", "sparkly", "sparkle", "embellished", "rhinestone"],
  ["embroidered", "embroidery"],
  ["pleated", "pleats", "plisse"],
  ["cutout", "cut out", "keyhole"],
  ["backless", "open back", "low back"],
  ["tie back", "tie up", "lace up"],
  ["belted", "tie waist", "waist tie"],
  ["button down", "button up", "button front", "buttoned"],
  ["collared", "collar"],
  ["graphic", "printed", "print"],
  ["pointed toe", "pointy toe", "point toe"],
  ["ankle strap", "ankle straps"],
  ["platform"],
  ["block heel", "chunky heel"],
  ["kitten heel", "kitten"],
  ["knee high", "over the knee", "thigh high", "tall"],
  ["chelsea"],
  ["combat", "lug sole"],
  ["chunky"],
  ["quilted"],
  ["chain", "chain strap"],
  // Kleuren. Zonder deze groepen viel "gold" onder "onbekend woord" en werd
  // hij overal geaccepteerd waar hij toevallig in de omschrijving stond —
  // vandaar "Giorgia Milano Pump" onder het keyword "gold heels".
  ["black", "noir", "nero"],
  ["white", "ivory", "cream", "blanc"],
  ["gold", "golden", "oro", "dore"],
  ["silver", "argent"],
  ["red", "burgundy", "wine", "rouge"],
  ["blue", "navy", "cobalt", "bleu"],
  ["green", "olive", "emerald", "khaki"],
  ["brown", "tan", "camel", "cognac", "chocolate"],
  ["beige", "nude", "sand", "taupe"],
  ["grey", "gray", "charcoal"],
  ["pink", "blush", "rose", "fuchsia"],
  ["purple", "lilac", "lavender", "violet"],
  ["yellow", "mustard"],
  ["orange", "rust", "terracotta"],
  ["camouflage", "camo", "camouflaged"],
].map((terms) => terms.map(T));

/* Kleur/materiaal/patroon = ONDERSCHEIDENDE eigenschappen. Die mogen NOOIT
   bewezen worden met een losse zin verderop in de omschrijving ("pairs
   beautifully with your favourite jeans" maakte van een top een jean short).
   Ze moeten in de titel, het producttype, de tags, de foto-bestandsnamen of
   in de eerste zinnen van de omschrijving staan — daar waar een winkel het
   product zelf beschrijft. */
const DISTINCTIVE = new Set(
  `black noir nero white ivory cream blanc gold golden oro dore silver argent
   red burgundy wine rouge blue navy cobalt bleu green olive emerald khaki
   brown tan camel cognac chocolate beige nude sand taupe grey gray charcoal
   pink blush rose fuchsia purple lilac lavender violet yellow mustard orange
   rust terracotta camouflage camo camouflaged
   leather suede velvet denim jean jeans linen cotton satin silk cashmere wool
   fleece corduroy tweed boucle chiffon tulle mesh sequin sequins glitter
   floral striped stripe plaid check checked tartan houndstooth leopard zebra
   snakeskin python polka waterproof`
    .split(/\s+/)
    .filter(Boolean)
);

/* Kleuren apart: een kleur mag NOOIT uit de omschrijving komen, ook niet uit
   de eerste zinnen. Winkels noemen daar de kleur van het beslag, de rits, de
   accessoire of de styling ("the gold hardware catches the light") — zo werd
   "Giorgia Milano Pump" een gold heel. Kleur = titel, tags of foto, punt. */
const COLOR_WORDS = new Set(
  `black noir nero white ivory cream blanc gold golden oro dore silver argent
   red burgundy wine rouge blue navy cobalt bleu green olive emerald khaki
   brown tan camel cognac chocolate beige nude sand taupe grey gray charcoal
   pink blush rose fuchsia purple lilac lavender violet yellow mustard orange
   rust terracotta camouflage camo camouflaged`
    .split(/\s+/)
    .filter(Boolean)
);

/** Onderscheidende eigenschappen van een keyword (kleur/materiaal/patroon).
 *  De scraper gebruikt dit om te bepalen of een product per se met de FOTO
 *  gecontroleerd moet worden — een kleur zie je, die lees je niet. */
export function hardAttributes(keyword) {
  const out = [];
  for (const w of tok(keyword)) {
    for (const s of stems(w)) {
      if (DISTINCTIVE.has(s) && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

/* Woord → groep-nummer, zodat synoniemen als één eigenschap tellen:
   camouflage = camo, jean = denim, gold = golden = oro. Anders zou de
   scraper "camo cargo trousers" weigeren als alternatief voor
   "camouflage pants", terwijl dat exact hetzelfde product is. */
const ATTR_GROUP = (() => {
  const m = new Map();
  MODIFIER_GROUPS.forEach((terms, gi) => {
    for (const t of terms) {
      if (t.length !== 1) continue;
      for (const s of stems(t[0])) {
        if (DISTINCTIVE.has(s)) m.set(s, `g${gi}`);
      }
    }
  });
  return m;
})();

/** De eigenschappen van een keyword als groep-namen (synoniem-bestendig). */
export function attributeGroups(keyword) {
  const out = new Set();
  for (const a of hardAttributes(keyword)) out.add(ATTR_GROUP.get(a) || a);
  return out;
}

// Zachte stijlwoorden — het hele cluster telt als bewijs
const SOFT_CLUSTERS = [
  ["elegant", "classy", "sophisticated", "refined", "graceful", "timeless", "chic", "polished", "luxe", "luxury"],
  // Gelegenheid opgesplitst: "cocktail" is semi-formeel knie/midi, een
  // bruidsjurk of een casual party dress is iets ANDERS. Eén grote pot maakte
  // elke feestjurk een geldige "cocktail dress" — vandaar aparte clusters.
  ["occasion", "formal", "evening", "cocktail", "gala", "black tie", "semi formal"],
  ["party", "event", "celebration", "festive", "night out", "club"],
  ["wedding", "bridal", "bride", "bridesmaid"],
  ["prom", "homecoming", "graduation", "ball"],
  ["casual", "everyday", "relaxed", "laidback", "weekend", "comfy", "comfortable"],
  ["boho", "bohemian", "festival"],
  ["vintage", "retro", "classic", "heritage"],
  ["summer", "beach", "vacation", "holiday", "resort", "tropical"],
  ["winter", "cozy", "warm", "thermal"],
  ["work", "office", "business", "professional", "workwear"],
  ["sexy", "date night", "night out", "going out"],
  ["cute", "sweet", "adorable", "playful", "lovely"],
  ["trendy", "stylish", "modern", "contemporary", "fashion"],
  ["basic", "essential", "staple", "minimal", "minimalist"],
].map((terms) => terms.map(T));

/* ---------------- Keyword-analyse ---------------- */

function findTypeGroup(term) {
  for (const g of TYPE_GROUPS) {
    for (const t of g.terms) {
      if (t.length === term.length && t.every((w, i) => eqW(w, term[i]))) return g;
      if (t.length === 1 && term.length === 1 && eqW(t[0], term[0])) return g;
    }
  }
  return null;
}

// strict = deze eigenschap mag niet uit een losse zin in de omschrijving
// komen. Geldt voor kleur, materiaal, patroon en voor woorden die de engine
// niet kent (dan weten we juist niet wat het is, dus zijn we streng).
const isStrictTerm = (terms) => terms.some((t) => t.some((w) => stems(w).some((s) => DISTINCTIVE.has(s))));
const isColorTerm = (terms) => terms.some((t) => t.some((w) => stems(w).some((s) => COLOR_WORDS.has(s))));

function findModifierGroup(term) {
  for (const terms of MODIFIER_GROUPS) {
    for (const t of terms) {
      if (t.length === term.length && t.every((w, i) => eqW(w, term[i])))
        return { terms, soft: false, strict: isStrictTerm(terms), color: isColorTerm(terms) };
    }
  }
  for (const terms of SOFT_CLUSTERS) {
    for (const t of terms) {
      if (t.length === term.length && t.every((w, i) => eqW(w, term[i])))
        return { terms, soft: true, strict: false };
    }
  }
  return null;
}

export function analyzeKeyword(keyword) {
  const kwTokens = tok(keyword);
  if (kwTokens.length === 0) return null;

  // Type = laatste woord(en). Eerst 2-woordige types proberen ("tank top").
  let typeGroup = null;
  let typeLen = 1;
  if (kwTokens.length >= 2) {
    const bi = kwTokens.slice(-2);
    const g = findTypeGroup(bi);
    if (g) {
      typeGroup = g;
      typeLen = 2;
    }
  }
  if (!typeGroup) {
    typeGroup = findTypeGroup([kwTokens[kwTokens.length - 1]]);
  }
  const typeTerms = typeGroup ? typeGroup.terms : [[kwTokens[kwTokens.length - 1]]];
  const implied = (typeGroup && typeGroup.implied) || [];

  // Rest = modifiers; eerst bigrams ("spaghetti strap"), dan losse woorden
  const rest = kwTokens.slice(0, kwTokens.length - typeLen);
  const modifiers = [];
  let i = 0;
  while (i < rest.length) {
    if (i + 1 < rest.length) {
      const g = findModifierGroup([rest[i], rest[i + 1]]);
      if (g) {
        modifiers.push(g);
        i += 2;
        continue;
      }
    }
    const g = findModifierGroup([rest[i]]);
    if (g) {
      modifiers.push(g);
    } else if (implied.some((w) => eqW(w, rest[i]))) {
      // "high" bij heels — zit al in het type
    } else {
      // Onbekend woord: juist dan streng — we weten niet wat het betekent,
      // dus moet het in de titel/tags/foto's van het product staan.
      modifiers.push({ terms: [[rest[i]]], soft: false, strict: true });
    }
    i += 1;
  }

  return {
    kwTokens,
    typeTerms,
    typeId: typeGroup ? typeGroup.id : null,
    typeExactOnly: !!(typeGroup && typeGroup.exactOnly),
    modifiers,
  };
}

/* ---------------- Omschrijving-analyse ---------------- */

const PAIR_TRIGGERS = new Set([
  "pair", "pairs", "paired", "pairing", "wear", "wears", "wearing", "match",
  "matched", "matching", "style", "styles", "styled", "styling", "team",
  "teams", "combine", "combines", "combined", "goes", "layer", "layered",
  "complete", "completes", "accessorize", "complement", "complements",
  "compliment", "compliments", "tuck", "tucked", "under", "over",
  // Styling-zinnen zonder werkwoord uit de lijst hierboven: "Looks great with
  // a jean skirt", "Perfect with ankle boots", "Add a blazer". Zonder deze
  // woorden werd een paar laarzen gevonden onder het keyword "jean skirt".
  "looks", "look", "great", "perfect", "add", "throw", "finish", "toss",
  "alongside", "beneath", "atop",
]);

// "… with a jean skirt" / "… with your boots": een lidwoord na "with" wijst
// bijna altijd op een ANDER kledingstuk dan het product zelf. Zonder lidwoord
// ("a dress with long sleeves") gaat het juist wél over dit product.
const WITH_FOLLOWERS = new Set(["a", "an", "your", "some", "any", "our", "these", "those"]);
const IDENTITY_BACK = new Set(["this", "the", "our", "its"]);
const IDENTITY_FWD = new Set([
  "features", "feature", "is", "made", "designed", "crafted", "offers",
  "brings", "delivers", "fits", "flatters", "drapes", "hugs", "combines",
  "comes", "has",
]);

// Zoek type-voorkomens in de omschrijving en beoordeel of de tekst
// echt over DIT product gaat.
function analyzeDescription(descTokens, typeTerms) {
  let clean = 0;
  let strong = false;
  let firstPos = Infinity;

  for (let i = 0; i < descTokens.length; i++) {
    let hit = false;
    for (const term of typeTerms) {
      if (term.length === 1) {
        if (eqW(descTokens[i], term[0])) hit = true;
      } else if (i + term.length <= descTokens.length) {
        if (term.every((w, j) => eqW(descTokens[i + j], w))) hit = true;
      }
      if (hit) break;
    }
    if (!hit) continue;

    // Besmet? ("pair it with your favorite dress")
    let contaminated = false;
    const backStart = Math.max(0, i - 7);
    for (let b = backStart; b < i; b++) {
      const w = descTokens[b];
      if (PAIR_TRIGGERS.has(w)) contaminated = true;
      if (w === "your" || w === "favorite" || w === "favourite" || w === "any") contaminated = true;
      if (w === "with" && WITH_FOLLOWERS.has(descTokens[b + 1] || "")) contaminated = true;
    }
    if (!contaminated) {
      clean++;
      if (i < firstPos) firstPos = i;
      // Identiteitszin? ("this dress features…")
      let back = false;
      for (let b = Math.max(0, i - 3); b < i; b++) if (IDENTITY_BACK.has(descTokens[b])) back = true;
      let fwd = false;
      for (let f = i + 1; f < Math.min(descTokens.length, i + 10); f++) if (IDENTITY_FWD.has(descTokens[f])) fwd = true;
      if (back && fwd) strong = true;
    }
  }
  return { clean, strong, firstPos };
}

/* ---------------- Product matchen ---------------- */

function imageFileWords(src) {
  try {
    const u = new URL(src);
    let f = u.pathname.split("/").pop() || "";
    f = f.toLowerCase();
    f = f.replace(/\.[a-z0-9]+$/, "");
    f = f.replace(/_(\d+x\d*|\d*x\d+|x\d+|\d+x|small|medium|large|grande|original|master|compact|icon|thumb)$/g, "");
    return f;
  } catch {
    return String(src || "").toLowerCase();
  }
}

// Zones per product één keer opbouwen en cachen (zelfde product wordt
// voor meerdere keywords bekeken).
const zoneCache = new WeakMap();

function zonesFor(p) {
  const hit = zoneCache.get(p);
  if (hit) return hit;
  const z = {
    title: tok(p.title),
    tt: tok(`${p.productType || ""} ${p.tags || ""}`),
    desc: tok(p.bodyHtml || ""),
    img: tok(
      (p.images || [])
        .map((im) => `${im.alt || ""} ${imageFileWords(im.src)}`)
        .join(" ")
    ),
  };
  zoneCache.set(p, z);
  return z;
}

/* ---------------- Accessoire-bewaking ----------------
   "Protective Garment Bag for Suits & Dresses" bevat het woord "dresses",
   maar het product is een TAS. Twee verdedigingslinies:
   1. Titel bevat een opberg/verzorgings-accessoire (bag, hanger, storage…)
      terwijl het keyword een kledingstuk is → product volledig afwijzen.
   2. Een type-match in de titel telt niet als hij in een "for …"-bijzin
      staat ("bag FOR dresses") of direct gevolgd wordt door een
      accessoire-woord ("dress cover", "dress box", "dress form").         */

const ACCESSORY_TITLE_BLOCK = new Set([
  "bag", "bags", "hanger", "hangers", "rack", "racks", "organizer", "organiser",
  "organizers", "organisers", "storage", "protector", "protectors", "pouch",
  "pouches", "mannequin", "mannequins", "steamer", "steamers", "detergent",
  "laundry", "suitcase", "suitcases", "luggage", "backpack", "backpacks",
  "holdall", "umbrella", "umbrellas", "keychain", "keyring", "wallet",
  "wallets", "handbag", "handbags", "tote", "totes", "duffel", "duffle",
  "briefcase", "satchel", "insole", "insoles", "laces", "shoelaces",
  "shoehorn", "polish", "freshener", "deodorizer", "covers", "cases", "boxes",
]);
const ACCESSORY_AFTER_TYPE = new Set([
  ...ACCESSORY_TITLE_BLOCK, "cover", "box", "form", "case", "tape", "clips",
]);

// Niet-menselijke "mode": hondenjassen, poppenkleertjes enz. — NOOIT meenemen
// tenzij de klant er expliciet zelf naar zoekt ("dog winter jacket").
const NON_HUMAN_BLOCK = new Set([
  "dog", "dogs", "cat", "cats", "pet", "pets", "puppy", "puppies", "kitten",
  "kittens", "doll", "dolls", "dollhouse",
]);

function termPositions(tokens, terms) {
  const out = [];
  for (const term of terms) {
    for (let i = 0; i + term.length <= tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < term.length; j++) {
        if (!eqW(term[j], tokens[i + j])) {
          ok = false;
          break;
        }
      }
      if (ok) out.push([i, term.length]);
    }
  }
  return out;
}

function validTitleTypeOccurrence(tokens, pos, len) {
  // "dress bag" / "dress cover" / "dress form" → het type is hier bijvoeglijk
  const after = tokens[pos + len];
  if (after && ACCESSORY_AFTER_TYPE.has(after)) return false;
  // "bag for suits & dresses" → het type staat in een for-bijzin
  for (let i = Math.max(0, pos - 4); i < pos; i++) {
    if (tokens[i] === "for") return false;
  }
  return true;
}

/**
 * Match één product tegen een geanalyseerd keyword.
 * Retourneert null of { tier, source, literal }
 *  tier 1 = Titel, 2 = Omschrijving, 3 = Foto's
 */
export function matchProduct(analysis, p) {
  if (!analysis) return null;
  const z = zonesFor(p);

  // Zoekt de klant zélf een accessoire (bv. "garment bag")? Dan geldt de
  // accessoire-bewaking niet.
  const kwIsAccessory = analysis.typeTerms.some((t) =>
    t.some((w) => ACCESSORY_TITLE_BLOCK.has(w) || ACCESSORY_AFTER_TYPE.has(w))
  );

  // Harde blokkade: titel bevat een opberg/accessoire-woord (bag, rack,
  // organizer, storage…) terwijl het keyword een kledingstuk is → dit
  // product NOOIT meenemen — óók niet via titel, omschrijving of foto's.
  // ("Protective Garment Bag for Suits & Dresses", "Shoe Rack Organizer")
  if (!kwIsAccessory && z.title.some((t) => ACCESSORY_TITLE_BLOCK.has(t))) {
    return null;
  }

  // Harde blokkade: dieren- en poppenkleding ("Dog Winter Jacket") — alleen
  // toegestaan als het keyword er zelf om vraagt.
  const kwNonHuman = analysis.kwTokens.some((t) => NON_HUMAN_BLOCK.has(t));
  if (!kwNonHuman && z.title.some((t) => NON_HUMAN_BLOCK.has(t))) {
    return null;
  }

  // Types met exactOnly (shorts) accepteren geen gestemde variant.
  const typeIn = (zone) =>
    analysis.typeExactOnly
      ? analysis.typeTerms.some((t) => t.length === 1 && zone.includes(t[0]))
      : hasAnyTerm(zone, analysis.typeTerms);

  // ---- Stap 1/2/3: waar is het TYPE bewezen? ----
  let tier = null;
  let titleHit = typeIn(z.title);
  if (titleHit && !kwIsAccessory) {
    const occ = termPositions(z.title, analysis.typeTerms);
    if (occ.length > 0 && !occ.some(([pos, len]) => validTitleTypeOccurrence(z.title, pos, len))) {
      titleHit = false; // alle voorkomens zijn bijzinnen/accessoire-combinaties
    }
  }
  if (titleHit) {
    tier = 1;
  } else {
    const authoritative = typeIn(z.tt);
    const d = analysis.typeExactOnly ? { strong: false, clean: 0, firstPos: 999 } : analyzeDescription(z.desc, analysis.typeTerms);
    if (authoritative || d.strong || d.clean >= 2 || (d.clean >= 1 && d.firstPos < 25)) {
      if (authoritative || d.strong || d.clean >= 2 || d.firstPos < 25) tier = 2;
    }
    if (tier === null && typeIn(z.img)) {
      tier = 3;
    }
  }
  if (tier === null) return null;

  /* ---- Alle modifiers moeten bewezen zijn ----
     Onderscheidende eigenschappen (kleur/materiaal/patroon/onbekend woord)
     tellen ALLEEN uit de titel, het producttype, de tags, de foto's of de
     eerste zinnen van de omschrijving — dus daar waar de winkel het product
     zelf beschrijft. Niet uit styling-zinnen verderop ("pairs perfectly with
     your favourite jeans"), want daar kwamen de valse jean shorts, gold heels
     en camouflage pants vandaan. */
  const descHead = z.desc.slice(0, 40);
  const looseZones = [z.title, z.tt, z.desc, z.img];
  const strictZones = [z.title, z.tt, z.img, descHead];
  const colorZones = [z.title, z.tt, z.img];
  const strictProof = [];
  for (const mod of analysis.modifiers) {
    const zones = mod.color ? colorZones : mod.strict ? strictZones : looseZones;
    let ok = false;
    for (const zone of zones) {
      if (hasAnyTerm(zone, mod.terms)) {
        ok = true;
        break;
      }
    }
    if (!ok) return null;
    if (mod.strict) {
      // Staat de eigenschap alleen in de omschrijving/foto-naam en niet in de
      // titel? Dan is het bewijs zwak — de scraper laat die door de foto-AI.
      strictProof.push(hasAnyTerm(z.title, mod.terms) ? "titel" : "zwak");
    }
  }
  const weakAttribute = strictProof.includes("zwak");

  // ---- Literal = exacte woordreeks in de bron-zone ----
  const literalZone = tier === 1 ? z.title : tier === 2 ? [...z.desc, ...z.tt] : z.img;
  const literal = hasSeq(literalZone, analysis.kwTokens);

  const source = tier === 1 ? "Titel" : tier === 2 ? "Omschrijving" : "Foto's";
  return { tier, source, literal, weakAttribute };
}

/** Mag de scraper met dit alternatieve zoekwoord zoeken?
 *  Een alternatief mag het TYPE verbreden ("wedding guest" → "wedding guest
 *  midi dress"), maar nooit een onderscheidende eigenschap laten vallen.
 *  "camouflage pants" → "cargo pants" en "gold heels" → "heels" verloren de
 *  eigenschap en leverden daardoor producten op die niets met het keyword te
 *  maken hadden. */
export function alternativeIsSafe(keyword, alt) {
  const need = attributeGroups(keyword);
  if (need.size === 0) return true;
  const have = attributeGroups(alt);
  for (const g of need) if (!have.has(g)) return false;
  return true;
}

/** Compat-wrapper: analyseert het keyword per aanroep. */
export function matchKeyword(p, keyword) {
  return matchProduct(analyzeKeyword(keyword), p);
}
