/* INFOGRAPHIC-BREIN v1 (25-11-2026, projectdoc 211/212) — luxe "infographic" per product.
   Eén 4:5-beeld: nieuw model + het exacte product, 1-2 detailfoto's, korte verkooptekst op het beeld.
   Stijl = de prompts die Justin zelf met de hand maakte (Shapes Wardrobe, henley + cross-strap sandalen):
   editorial campagne, "2028 quiet luxury", emotionele verkooppunten, geen iconen of kaders.

   Logica per product:
   1. familie bepalen (schoenen / badmode / shorts / broeken / rokken / tops / truien / jassen / jurken / sets / tassen / hoeden)
   2. per familie: kader van de hoofdfoto, welke twee detailfoto's, wat het model verder draagt, realisme-eisen
   3. uit het product zelf: kleur, kenmerken uit titel + "WHY CHOOSE"-lijst, moment (Occasion) → decor
   4. tekst op het beeld: vaste vorm (kleine regel, kop van 2 regels, 3 punten, slotzin, merknaam);
      zinnen met een materiaal- of comfortclaim alleen als de omschrijving dat woord ook noemt
   5. stijl (art direction) rouleert per product, heren en dames elk een eigen set; AW-producten krijgen koel decor */

export const INFOGRAPHIC_SETTINGS = { model: "gpt_image_2", quality: "medium", resolution: "1k", aspect_ratio: "4:5" };

const strip = (html) =>
  String(html || "")
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ");

/** vaste, herhaalbare keuze per product (zelfde product = zelfde stijl bij opnieuw maken) */
function hashOf(s) {
  let h = 2166136261;
  for (const c of String(s || "")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const pickN = (list, seed, n = 1) => {
  const a = [...list];
  const out = [];
  let h = seed || 1;
  while (a.length && out.length < n) {
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
    out.push(a.splice(h % a.length, 1)[0]);
  }
  return out;
};

/* ---------- 1. familie ---------- */
const FAMILY_RULES = [
  ["bag", /\b(bag|tote|handbag|crossbody|backpack|wallet|purse|clutch|duffle|satchel)\b/i],
  ["hat", /\b(hat|cap|beanie|visor|fedora)\b/i],
  ["sandal", /\b(sandals?|slides?|flip[- ]?flops?|thongs?|mules?|espadrilles?|clogs?)\b/i],
  ["shoe", /\b(shoes?|loafers?|sneakers?|boots?|heels?|flats?|oxfords?|derby|moccasins?|trainers?|pumps?)\b/i],
  ["swim_w", /\b(swimsuit|swimwear|bikini|tankini|one[- ]piece|bathing suit)\b/i],
  ["swim_m", /\b(swim (shorts?|trunks?)|board ?shorts?|swim trunk)\b/i],
  ["dress", /\b(dress|gown|kaftan)\b/i],
  ["set", /\b(jumpsuit|romper|playsuit|co-?ord|two[- ]piece|matching set|set)\b/i],
  ["outer", /\b(jacket|coat|blazer|parka|trench|bomber|gilet|puffer|windbreaker|overcoat)\b/i],
  ["knit", /\b(sweater|jumper|cardigan|knitwear|hoodie|sweatshirt|pullover|turtleneck|quarter[- ]zip)\b/i],
  ["skirt", /\b(skirt|skort)\b/i],
  ["shorts", /\b(shorts?)\b/i],
  ["pants", /\b(pants?|trousers?|jeans|chinos?|joggers?|leggings|cargo|capris?|slacks)\b/i],
  ["top", /\b(shirt|henley|polo|tee|t[- ]?shirt|blouse|top|tank|singlet|cami|tunic|corset|bodysuit)\b/i],
];
/** familie uit het linkerdeel van de titel + producttype. "Dress Shirt" is een top, "Short Sleeve" geen short. */
export function familyOf(p) {
  const head = `${String(p.title || "").split("|")[0]} ${p.type || p.product_type || ""}`
    .replace(/\bdress[\s-]+(shirts?|pants?|trousers?|shoes?)\b/gi, "$1")
    .replace(/\bshort[\s-]?sleeves?d?\b/gi, " ")
    .replace(/\bswim(ming)? (shorts?|trunks?)\b/gi, "swim trunk");
  if (/\bswim trunk|board ?shorts?\b/i.test(head)) return "swim_m";
  if (/\bswimwear\b/i.test(head) && /\bmen'?s\b|\bmens\b/i.test(head) && !/\bwomen/i.test(head)) return "swim_m";
  for (const [fam, re] of FAMILY_RULES) if (re.test(head)) return fam;
  return "top";
}
export const FAMILY_LABEL = { bag: "tas", hat: "hoed", sandal: "sandaal", shoe: "schoen", swim_w: "badmode dames", swim_m: "zwemshort", dress: "jurk", set: "set/jumpsuit", outer: "jas", knit: "trui", skirt: "rok", shorts: "short", pants: "broek", top: "top/shirt" };

/* ---------- 3. uit het product zelf ---------- */
/** "Women's Maxi Dress | Square Neckline ..." → "maxi dress" */
function nounOf(p) {
  const left = String(p.title || "").split("|")[0].replace(/\b(wo)?men'?s\b|\bfor (wo)?men\b|\bladies\b|\bunisex\b/gi, " ").replace(/\s+/g, " ").trim();
  return (left || "garment").toLowerCase();
}
/** kenmerken: de "Label: tekst"-regels uit de omschrijving (WHY CHOOSE ...), Occasion apart */
export function featuresOf(bodyHtml) {
  const txt = strip(bodyHtml);
  const feats = [];
  let occasion = "";
  for (const line of txt.split("\n")) {
    const m = line.trim().match(/^([A-Z][A-Za-z /&-]{2,26}):\s*(.{4,180})$/);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim().replace(/\s+/g, " ");
    if (/^why (choose|you)/i.test(label)) continue;
    if (/^occasions?$/i.test(label)) occasion = value;
    else feats.push({ label, value });
  }
  return { features: feats.slice(0, 6), occasion, text: txt.replace(/\s+/g, " ").slice(0, 1600) };
}

/* ---------- 5. stijl (art direction) — uit Justins eigen prompts, plus damesrichtingen in dezelfde toon ---------- */
const STYLES = {
  man: [
    { id: "coastal", dir: "2028 coastal quiet luxury. Inspired by Massimo Dutti, Loro Piana and contemporary Australian summer lifestyle campaigns.", scene: "A beautiful modern coastal residence overlooking the ocean. Natural limestone surfaces, understated architectural details, warm sunlight, authentic shadows and muted coastal colours. The scene should feel like a genuine photographed moment, not an artificially generated luxury backdrop." },
    { id: "villa", dir: "2028 luxury lifestyle editorial. Inspired by Massimo Dutti, Saint Laurent summer campaigns and contemporary luxury travel magazines. Capture the feeling of an effortless, sophisticated lifestyle.", scene: "A premium modern coastal villa or serene Mediterranean-inspired architectural setting with warm natural daylight, calm shadows and premium surroundings. The mood is elevated, masculine, relaxed and aspirational." },
    { id: "quiet", dir: "2028 quiet luxury. Inspired by Loro Piana, Zegna and refined minimalist architecture. The image should feel expensive, calm, elegant and editorial.", scene: "A premium architectural environment with warm limestone, soft beige walls, subtle shadow play and natural sunlight. The atmosphere is clean, elevated and luxurious." },
    { id: "editorial", dir: "2028 designer editorial. Swiss-grid precision meets luxury fashion branding. Think modern fashion magazine layout, elevated typography, structural composition and ultra-clean visual hierarchy.", scene: "A minimal premium interior or gallery-like studio with warm neutrals, off-white, taupe and stone tones. Directional natural light and soft architectural shadows." },
    { id: "launch", dir: "Futuristic 2028 luxury campaign. Apple-level product precision combined with Bottega Veneta editorial sophistication. Hyper-refined, minimal, precise and design-led.", scene: "A premium architectural studio in warm ivory, espresso brown, limestone and subtle charcoal tones, photographed with soft directional daylight, realistic lens characteristics and beautiful material detail." },
  ],
  vrouw: [
    { id: "riviera", dir: "2028 coastal quiet luxury for women. Inspired by Zimmermann resort, Loro Piana and contemporary Australian summer lifestyle campaigns.", scene: "A beautiful modern coastal residence overlooking the ocean. Pale limestone, soft arches, warm golden sunlight, authentic shadows and muted coastal colours with a touch of blush. The scene should feel like a genuine photographed moment, not an artificially generated luxury backdrop." },
    { id: "villa", dir: "2028 luxury lifestyle editorial. Inspired by Massimo Dutti women, Max Mara resort campaigns and contemporary luxury travel magazines. Capture the feeling of an effortless, sophisticated lifestyle.", scene: "A refined Mediterranean-inspired villa terrace with warm natural daylight, linen curtains moving slightly, calm shadows and premium surroundings. The mood is elevated, feminine, relaxed and aspirational." },
    { id: "quiet", dir: "2028 quiet luxury. Inspired by The Row, Loro Piana and refined minimalist architecture. The image should feel expensive, calm, elegant and editorial.", scene: "A premium architectural environment with warm limestone, soft cream walls, subtle shadow play and natural sunlight. The atmosphere is clean, elevated and luxurious." },
    { id: "editorial", dir: "2028 designer editorial. Swiss-grid precision meets luxury fashion branding. Think modern fashion magazine layout, elevated typography, structural composition and ultra-clean visual hierarchy.", scene: "A minimal premium interior or gallery-like studio with warm neutrals, ivory, soft sand and stone tones. Directional natural light and soft architectural shadows." },
  ],
};
/* koel seizoen (AW-producten, truien, jassen): zelfde toon, geen zomerdecor */
const COOL_STYLE = {
  man: { id: "cool", dir: "2028 quiet luxury for cooler days. Inspired by Loro Piana, Brunello Cucinelli and refined city architecture. The image should feel expensive, calm and editorial.", scene: "A refined city setting in soft autumn light: pale stone facades, a quiet street or a warm minimalist interior with oak and wool textures. Cool daylight, gentle shadows, muted camel, charcoal and cream tones." },
  vrouw: { id: "cool", dir: "2028 quiet luxury for cooler days. Inspired by Max Mara, Loro Piana and refined city architecture. The image should feel expensive, calm and editorial.", scene: "A refined city setting in soft autumn light: pale stone facades, a quiet street or a warm minimalist interior with oak and wool textures. Cool daylight, gentle shadows, muted camel, cream and soft grey tones." },
};

/* ---------- 2. regels per familie ---------- */
/* hero = kader van de hoofdfoto · a/b = de twee kleine editorial foto's · wear = wat het model verder draagt
   real = extra realisme-eis · cool = koel decor · keep = wat er nooit bij verzonnen mag worden */
const FAMILY = {
  sandal: {
    word: "footwear", hero: "One dominant lifestyle photograph showing the model naturally walking, photographed from a low angle so the sandals are clearly visible and remain the primary product focus.",
    a: "A close-up of the sandals being worn naturally while walking.", b: "A beautifully lit macro photograph of the straps, stitching and footbed.",
    wear: (g) => (g === "man" ? "elegant, lightweight cream or sand tailored trousers, slightly cropped, and a relaxed premium summer shirt" : "an elegant flowing linen dress or cropped tailored trousers in ivory with a relaxed premium top"),
    real: "The feet must have correct human anatomy: exactly five naturally proportioned toes per foot, realistic toenails, skin folds, subtle veins, fine body hair and realistic pressure against the footbed. Show believable contact shadows, strap tension and weight distribution.",
    keep: "additional straps, logos, buckles or fictional comfort technologies",
  },
  shoe: {
    word: "footwear", hero: "One dominant photograph showing the model from approximately knee height downward, wearing the exact shoes in a natural standing or walking position. The footwear occupies the dominant visual area.",
    a: "A candid lifestyle crop of the same model, seen from further away, with the shoes still visible.", b: "A beautifully lit macro photograph of the upper material, stitching and outsole edge.",
    wear: (g) => (g === "man" ? "sophisticated, slightly cropped ivory or charcoal tailored trousers" : "elegant cropped tailored trousers or a midi skirt in ivory or sand"),
    real: "Ankles and lower legs must look exceptionally realistic: natural skin texture, fine body hair, subtle veins. The shoes must interact physically and naturally with the feet and the floor: believable contact shadows, natural creasing and weight distribution.",
    keep: "logos, tassels, buckles, extra stitching or fictional comfort technologies",
  },
  swim_w: {
    word: "swimwear", hero: "One dominant lifestyle photograph showing the model from mid-thigh up, standing relaxed in three-quarter view so the neckline and the back line are both readable. Elegant and tasteful resort mood, never provocative.",
    a: "A candid moment of the same model seen from behind or the side, showing the back of the swimsuit.", b: "An intimate close-up of the neckline and fabric.",
    wear: () => "a light open linen shirt hanging off one arm or a simple straw hat in her hand",
    real: "A real, healthy body with soft natural curves, natural skin with visible pores, faint freckles on the shoulders and a slightly uneven natural tan. No exaggerated proportions.",
    keep: "prints, logos, cut-outs, belts or hardware", pool: true,
  },
  swim_m: {
    word: "swimwear", hero: "One dominant lifestyle photograph showing the model from mid-thigh up, relaxed, an open linen shirt over his shoulders so the swim shorts are fully visible.",
    a: "A candid moment of the same model walking along the water's edge.", b: "A close-up of the waistband, drawstring and fabric.",
    wear: () => "an open white linen shirt",
    real: "A natural, fit but ordinary male body: real chest hair, natural skin texture, no bodybuilder physique.",
    keep: "logos, extra pockets or prints that are not in the reference", pool: true,
  },
  shorts: {
    word: "menswear", hero: "One dominant lifestyle photograph showing the model from head to just below the knees, slightly side-on so the pockets and the length of the shorts are clearly visible. The shorts remain the primary product focus.",
    a: "A candid lifestyle moment featuring the same model and shorts.", b: "An intimate close-up of the waistband and pocket detail.",
    wear: (g) => (g === "man" ? "a relaxed premium linen shirt in white or soft stone, untucked, and a simple watch" : "a relaxed premium linen shirt in white, loosely tucked at the front"),
    real: "Real legs: natural leg hair, real knees, a slight tan, small skin marks. One hand resting naturally in a pocket.",
    keep: "logos, belts, zips or extra pockets",
  },
  pants: {
    word: "fashion", hero: "One dominant lifestyle photograph showing the model full length, mid-stride, so the cut, the waist and the full leg length of the trousers are visible.",
    a: "A candid lifestyle moment featuring the same model, seated or leaning, trousers clearly visible.", b: "An intimate close-up of the waistband and fabric.",
    wear: (g) => (g === "man" ? "a plain premium knit polo or linen shirt tucked in so the waistband is visible, and simple leather shoes" : "a plain fitted premium top tucked in so the waistband is visible, and simple flat sandals or loafers"),
    real: "Natural creases at the knee and hip where the body bends, and a hem that breaks naturally on the shoe.",
    keep: "logos, belts, extra pockets, rips or washes that are not in the reference",
  },
  skirt: {
    word: "womenswear", hero: "One dominant lifestyle photograph showing the model full length, taking a slow natural step so the skirt moves a little and its full length is visible.",
    a: "A candid lifestyle moment featuring the same model, skirt clearly visible.", b: "An intimate close-up of the waistband and fabric.",
    wear: () => "a plain fitted premium top in ivory tucked in so the waistband is visible, and simple flat sandals",
    real: "The fabric moves with the step and falls naturally; natural legs and ankles.",
    keep: "slits, belts, prints or buttons that are not in the reference",
  },
  top: {
    word: "fashion", hero: "One dominant lifestyle photograph, occupying approximately 70% of the composition, showing the model from the hips up wearing the exact garment.",
    a: "A candid lifestyle moment featuring the same model and garment.", b: "An intimate close-up showing the natural fabric and neckline.",
    wear: (g) => (g === "man" ? "relaxed off-white or stone tailored trousers" : "relaxed ivory tailored trousers or soft denim"),
    real: "Real creases where the fabric folds at the elbow and waist; naturally proportioned hands.",
    keep: "logos, pockets, prints or buttons that are not in the reference",
  },
  knit: {
    word: "knitwear", hero: "One dominant lifestyle photograph, occupying approximately 70% of the composition, showing the model from the hips up wearing the exact knit.",
    a: "A candid lifestyle moment featuring the same model and knit.", b: "An intimate macro close-up of the knit texture and the collar or cuff.",
    wear: (g) => (g === "man" ? "dark tailored trousers or clean dark denim" : "tailored trousers in camel or cream"),
    real: "Visible, true-to-life knit structure with natural soft folds; naturally proportioned hands.",
    keep: "logos, patterns, zips or buttons that are not in the reference", cool: true,
  },
  outer: {
    word: "outerwear", hero: "One dominant lifestyle photograph showing the model from the knees up, wearing the exact jacket naturally layered over a simple knit, walking.",
    a: "A candid lifestyle moment featuring the same model and jacket.", b: "An intimate close-up of the collar and closure.",
    wear: (g) => (g === "man" ? "a fine-gauge neutral knit underneath and dark tailored trousers" : "a fine-gauge neutral knit underneath and tailored trousers"),
    real: "The jacket hangs with real weight; natural folds at the elbows; naturally proportioned hands.",
    keep: "logos, patches, extra pockets, hoods or fur trims that are not in the reference", cool: true,
  },
  dress: {
    word: "womenswear", hero: "One dominant lifestyle photograph showing the model full length, from head to hem, taking a slow natural step so the fabric moves a little. The whole dress must be visible.",
    a: "A candid lifestyle moment featuring the same model and dress.", b: "An intimate close-up showing the neckline and the fabric.",
    wear: () => "simple flat sandals or low heels and minimal gold jewellery",
    real: "Natural arms, collarbones and hands; the fabric falls and moves the way real fabric does.",
    keep: "slits, belts, sleeves, prints or embellishments that are not in the reference",
  },
  set: {
    word: "fashion", hero: "One dominant lifestyle photograph showing the model full length so every piece of the outfit is completely visible, walking naturally.",
    a: "A candid lifestyle moment featuring the same model and outfit.", b: "An intimate close-up showing the fabric and the most characteristic detail.",
    wear: (g) => (g === "man" ? "simple leather sandals or loafers" : "simple flat sandals and minimal gold jewellery"),
    real: "Natural creases where the body bends; naturally proportioned hands and feet.",
    keep: "belts, prints, pockets or details that are not in the reference",
  },
  bag: {
    word: "accessories", hero: "One dominant lifestyle photograph showing the model from the hips to the shoulders or full figure, carrying the exact bag the way it is meant to be worn. The bag is the primary product focus.",
    a: "A candid lifestyle moment of the same model with the bag.", b: "A beautifully lit macro photograph of the closure, handle and material.",
    wear: (g) => (g === "man" ? "a relaxed premium linen shirt and tailored trousers in neutral tones" : "an elegant neutral linen outfit in ivory or sand"),
    real: "The hand grips the handle or strap naturally, with real knuckles and correct fingers; the bag hangs with real weight.",
    keep: "logos, charms, extra pockets or hardware that are not in the reference",
  },
  hat: {
    word: "accessories", hero: "One dominant lifestyle portrait from the chest up, the model wearing the exact hat, eyes still visible under the brim.",
    a: "A candid lifestyle moment of the same model wearing the hat.", b: "A beautifully lit macro photograph of the weave and band.",
    wear: (g) => (g === "man" ? "a relaxed premium linen shirt with the top button open" : "a relaxed premium linen shirt or a simple summer dress"),
    real: "Natural hair visible under the hat, real skin texture, eyes sharp and natural.",
    keep: "logos, ribbons, pins or bands that are not in the reference",
  },
};

/* ---------- 4. tekst op het beeld ---------- */
/* Vorm: [kleine regel, kop regel 1, kop regel 2, slotzin]. Punten: [KOP., zin, voorwaarde?]
   voorwaarde = regex die in de omschrijving moet voorkomen (materiaal-/comfortclaim alleen als het product het heeft). */
const COPY = {
  sandal: {
    heads: [["MADE FOR WARMER DAYS", "Good days.", "Great steps.", "Effortless looks good on you."], ["THE EVERYDAY ESSENTIAL", "Step out.", "In easy style.", "Made for the way you live."]],
    points: [["TAKE IT EASY.", "Cushioned comfort for everyday living.", /cushion|padded|soft footbed/i], ["KEEP IT COOL.", "Open-toe freedom for warmer days.", /open[- ]toe|open toe|sandal|slide/i], ["GO ANYWHERE.", "From coastal escapes to city afternoons."], ["EFFORTLESS BY DESIGN.", "Slip on. Step out.", /slip[- ]on|slide|mule/i], ["REFINED, NOT RESTRICTIVE.", "An open design with timeless appeal."], ["EASY TO PAIR.", "Looks right with everything you own."]],
  },
  shoe: {
    heads: [["THE EVERYDAY ESSENTIAL", "Step into comfort.", "Without compromising style.", "Made for the way you live."], ["DESIGNED FOR EVERYDAY LIVING", "Understated.", "Never unnoticed.", "Effortless looks good on you."]],
    points: [["EFFORTLESS BY DESIGN.", "Slip on. Step out.", /slip[- ]on|loafer|moccasin/i], ["GO ANYWHERE.", "From slow mornings to evenings out."], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GRIP UNDERFOOT.", "A sole made for everyday wear.", /rubber|traction|grip|non[- ]slip/i], ["SOFT TO THE TOUCH.", "A finish you notice straight away.", /suede|soft|nubuck/i], ["EASY TO PAIR.", "Looks right with everything you own."]],
  },
  swim_w: {
    heads: [["MADE FOR SUMMER", "Simply", "beautiful.", "Your everyday escape."], ["THE RESORT EDIT", "Feel good.", "From pool to lunch.", "Effortless looks good on you."]],
    points: [["FEEL GOOD.", "A fit that moves with you."], ["LOOK EFFORTLESS.", "Clean lines, nothing overdone."], ["GO ANYWHERE.", "From the pool to long lunches."], ["A QUIET STATEMENT.", "Seen from the front. Remembered from the back.", /open[- ]back|low back|backless/i], ["KEEP IT SIMPLE.", "One piece. Endless summer days."]],
  },
  swim_m: {
    heads: [["MADE FOR SUMMER", "Good days.", "Start here.", "Your everyday escape."], ["THE HOLIDAY ESSENTIAL", "Dive in.", "Dry off. Carry on.", "Weekends, sorted."]],
    points: [["TAKE IT EASY.", "Made for long days by the water."], ["QUICK TO DRY.", "From the pool to the bar.", /quick[- ]dry|fast[- ]dry/i], ["GO ANYWHERE.", "Beach, pool, boat, lunch."], ["EASY FIT.", "A drawstring waist that stays put.", /drawstring|drawcord/i], ["LOOK PUT TOGETHER.", "Without trying too hard."]],
  },
  shorts: {
    heads: [["MADE FOR WARMER DAYS", "Good style.", "Comes naturally.", "Your everyday escape."], ["THE EVERYDAY SHORT", "Room to move.", "Ready for anything.", "Weekends, sorted."]],
    points: [["FEEL GOOD.", "Relaxed comfort, all day."], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From slow mornings to evenings out."], ["EASY FIT.", "A waist that adjusts to you.", /drawstring|elastic|adjustable/i], ["CARRY MORE.", "Pockets for the essentials.", /cargo|patch pocket|utility/i], ["KEEP IT COOL.", "Light on the leg in summer.", /linen|lightweight|breathable/i]],
  },
  pants: {
    heads: [["DESIGNED FOR EVERYDAY LIVING", "Understated.", "Never unnoticed.", "Made for the way you live."], ["EVERYDAY, REFINED.", "Less effort.", "More style.", "All the comfort. None of the compromise."]],
    points: [["FEEL GOOD.", "Comfort that lasts the whole day."], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From the office to the weekend."], ["FREEDOM TO MOVE.", "A relaxed fit with a polished line.", /relaxed|stretch|elastic|wide[- ]leg/i], ["KEEP IT COOL.", "Light and breathable.", /linen|lightweight|breathable/i], ["SHARP BY DESIGN.", "A clean line from waist to hem."]],
  },
  skirt: {
    heads: [["MADE TO MOVE", "Effortless,", "from day to night.", "Your everyday escape."], ["THE EVERYDAY SKIRT", "Good style.", "Comes naturally.", "Made for the way you live."]],
    points: [["FEEL GOOD.", "Moves with every step."], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From slow mornings to evenings out."], ["EASY WAIST.", "Comfort you forget you are wearing.", /elastic|drawstring/i], ["DRESS IT UP.", "Or keep it simple. It works both ways."]],
  },
  top: {
    heads: [["FOR WHEREVER THE DAY TAKES YOU", "Good style.", "Comes naturally.", "Your everyday escape."], ["RELAXED LUXURY FOR MODERN DAYS", "Look polished.", "Stay comfortable.", "Made for the way you live."], ["EVERYDAY, REFINED.", "Less effort.", "More style.", "All the comfort. None of the compromise."]],
    points: [["FEEL GOOD.", "Lightweight everyday comfort.", /linen|lightweight|breathable|cotton/i], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From slow mornings to evenings out."], ["BREATHES EASY.", "Cool comfort, all day ease.", /linen|breathable/i], ["SHARP BY DESIGN.", "A clean neckline with modern edge."], ["RELAXED BY NATURE.", "Room to move. Easy to wear.", /relaxed|loose|oversized/i], ["FEEL GOOD.", "Soft on the skin, easy all day."]],
  },
  knit: {
    heads: [["MADE FOR COOLER DAYS", "Soft.", "Never shapeless.", "Made for the way you live."], ["THE EVERYDAY KNIT", "Warmth,", "worn well.", "All the comfort. None of the compromise."]],
    points: [["FEEL GOOD.", "Soft warmth for slow mornings."], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["LAYER IT.", "Over a shirt or under a coat."], ["GO ANYWHERE.", "From the office to the weekend."], ["KEEPS ITS SHAPE.", "A knit that sits the way it should."]],
  },
  outer: {
    heads: [["MADE FOR COOLER DAYS", "Understated.", "Never unnoticed.", "Made for the way you live."], ["THE FINISHING LAYER", "Step out.", "Looking the part.", "All the comfort. None of the compromise."]],
    points: [["LAYER UP.", "The piece that finishes the outfit."], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From the commute to dinner."], ["READY FOR THE WEATHER.", "Made for changing days.", /water[- ]?(proof|resistant)|wind/i], ["SHARP BY DESIGN.", "A clean line from collar to hem."]],
  },
  dress: {
    heads: [["FOR WHEREVER THE DAY TAKES YOU", "Effortless,", "from day to night.", "One dress. Every occasion."], ["MADE FOR SUMMER", "Simply", "beautiful.", "Effortless looks good on you."]],
    points: [["FEEL GOOD.", "Moves with every step."], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From long lunches to evenings out."], ["FLATTERS NATURALLY.", "Shapes without squeezing.", /ruch|wrap|gather|a-line|flatter/i], ["DRESS IT UP.", "Or keep it simple. It works both ways."], ["KEEP IT COOL.", "Light and breathable.", /linen|lightweight|breathable/i]],
  },
  set: {
    heads: [["ONE OUTFIT. DONE.", "Good style.", "Comes naturally.", "Your everyday escape."], ["EVERYDAY, REFINED.", "Less effort.", "More style.", "Made for the way you live."]],
    points: [["FEEL GOOD.", "Comfort that lasts the whole day."], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From slow mornings to evenings out."], ["WEAR IT TOGETHER.", "Or mix it with what you own."], ["RELAXED BY NATURE.", "Room to move. Easy to wear.", /relaxed|loose|wide[- ]leg/i]],
  },
  bag: {
    heads: [["THE EVERYDAY ESSENTIAL", "Carry less.", "Look better.", "Made for the way you live."], ["DESIGNED FOR EVERYDAY LIVING", "Understated.", "Never unnoticed.", "Effortless looks good on you."]],
    points: [["ROOM FOR IT ALL.", "Everything you need, close at hand.", /spacious|compartment|pocket|large/i], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From the office to the weekend."], ["CARRY IT YOUR WAY.", "A strap that adjusts to you.", /adjustable|crossbody|shoulder strap/i], ["KEEP IT SAFE.", "A closure you can trust.", /zip|magnetic|flap|closure/i]],
  },
  hat: {
    heads: [["MADE FOR WARMER DAYS", "Good days.", "Under the sun.", "Your everyday escape."], ["THE FINISHING TOUCH", "Understated.", "Never unnoticed.", "Effortless looks good on you."]],
    points: [["KEEP IT COOL.", "Shade when the sun is high.", /wide brim|sun|brim/i], ["LOOK PUT TOGETHER.", "Without trying too hard."], ["GO ANYWHERE.", "From the beach to long lunches."], ["PACK IT.", "Travels as easily as you do.", /packable|foldable/i], ["EASY TO WEAR.", "Finishes any summer outfit."]],
  },
};

/** de tekst op het beeld voor één product → { intro, h1, h2, points:[[kop,zin]], closing } */
export function copyFor(item) {
  const fam = item.family || familyOf(item);
  const c = COPY[fam] || COPY.top;
  const seed = hashOf(`${item.productId || item.title}`);
  const text = `${item.title || ""} ${item.featureText || ""}`;
  const head = pickN(c.heads, seed, 1)[0];
  const ok = c.points.filter((p) => !p[2] || p[2].test(text));
  // punten met een voorwaarde die klopt eerst (die gaan echt over dit product), daarna de algemene
  const specific = ok.filter((p) => p[2]);
  const general = ok.filter((p) => !p[2]);
  const chosen = [...pickN(specific, seed, 2), ...pickN(general, seed >>> 3, 3)];
  const seen = new Set();
  const points = [];
  for (const p of chosen) {
    if (seen.has(p[0]) || points.length >= 3) continue;
    seen.add(p[0]);
    points.push([p[0], p[1]]);
  }
  return { intro: head[0], h1: head[1], h2: head[2], points, closing: head[3] };
}

/* ---------- DE PROMPT ----------
   25-11 (tweede ronde, Justin: "de prompts die je maakt zijn niet zoals ik je doorstuur"):
   de prompt is nu letterlijk een van zijn twee eigen prompts, met alleen de productdelen ingevuld.
     Sjabloon A = zijn schoenen-prompt (cross-strap sandalen): strak, productgericht, Apple x Bottega,
                  hoofdfoto + twee macrofoto's met fijne lijntjes. Voor schoenen, sandalen, tassen en hoeden.
     Sjabloon B = zijn lifestyle-prompt (linnen henley): Massimo Dutti / Saint Laurent, hoofdfoto 70%
                  + candid foto + close-up. Voor alle kleding.
   Enige toevoeging aan B: een blok HUMAN REALISM (zijn opmerking: "alleen de persoon ziet er nep uit"). */
const T = {
  sandal: { tpl: "A", piece: "sandals", primary: "The primary photograph shows the model from approximately knee height downward, wearing the exact sandals in a natural standing position.", dom: "The footwear occupies the dominant visual area.", m1: "The straps and visible stitching.", m2: "The footbed and original outsole construction." },
  shoe: { tpl: "A", piece: "shoes", primary: "The primary photograph shows the model from approximately knee height downward, wearing the exact shoes in a natural standing position.", dom: "The footwear occupies the dominant visual area.", m1: "The upper material and visible stitching.", m2: "The toe shape and original outsole construction." },
  bag: { tpl: "A", piece: "bag", primary: "The primary photograph shows the model from the shoulders to the hips, carrying the exact bag the way it is meant to be worn.", dom: "The bag occupies the dominant visual area.", m1: "The closure, hardware and visible stitching.", m2: "The handle or strap and the original material texture." },
  hat: { tpl: "A", piece: "hat", primary: "The primary photograph shows the model from the chest upward, wearing the exact hat, eyes still visible under the brim.", dom: "The hat occupies the dominant visual area.", m1: "The weave or fabric texture of the crown.", m2: "The brim edge and band." },
  swim_w: { tpl: "B", piece: "swimsuit", detail: "neckline", place: "by the pool of a premium modern coastal villa", frame: "The model is shown from mid-thigh up in an elegant, tasteful resort pose, never provocative." },
  swim_m: { tpl: "B", piece: "swim shorts", detail: "waistband", place: "by the pool of a premium modern coastal villa", frame: "The model is shown from mid-thigh up, an open linen shirt over his shoulders so the swim shorts are fully visible." },
  shorts: { tpl: "B", piece: "shorts", detail: "waistband and pockets", frame: "The model is shown from head to just below the knees, slightly side-on so the pockets and the length of the shorts are clearly visible." },
  pants: { tpl: "B", piece: "trousers", detail: "waistband", frame: "The model is shown full length, mid-stride, top tucked in so the waistband and the full leg length are visible." },
  skirt: { tpl: "B", piece: "skirt", detail: "waistband", frame: "The model is shown full length, taking a slow natural step so the skirt moves and its full length is visible." },
  top: { tpl: "B", piece: "shirt", detail: "neckline" },
  knit: { tpl: "B", piece: "knit", detail: "collar", cool: true },
  outer: { tpl: "B", piece: "jacket", detail: "collar and closure", cool: true, frame: "The model is shown from the knees up, the jacket worn naturally layered over a simple fine knit." },
  dress: { tpl: "B", piece: "dress", detail: "neckline", frame: "The model is shown full length, from head to hem, taking a slow natural step so the whole dress is visible." },
  set: { tpl: "B", piece: "outfit", detail: "most characteristic detail", frame: "The model is shown full length so every piece of the outfit is completely visible." },
};

/** "Rounded toe shape" → preserving-regel in de vorm van Justins lijst */
function preserveLines(item, noun) {
  const colour = String(item.color || "").trim().toLowerCase();
  const short = (v) => {
    const t = String(v || "").split(/[.;]/)[0].trim();
    if (t.length <= 70) return t;
    const clause = t.split(/,| and | without | for | while | that | so /i)[0].trim();
    return clause.length >= 12 && clause.length <= 90 ? clause : t.slice(0, 90).replace(/\s+\S*$/, "");
  };
  const lines = [colour ? `Original ${colour} colour, exactly as in the reference.` : "Original colour, exactly as in the reference.", "Authentic material and texture appearance."];
  for (const f of (item.features || []).slice(0, 5)) lines.push(`${short(f.value).replace(/^./, (c) => c.toUpperCase())}.`);
  lines.push("Original stitching and edge finishing.", "Original proportions.");
  return { colour, lines, name: `${colour ? colour + " " : ""}${noun}` };
}

/** Volledige prompt voor één infographic-opdracht.
    item: { title, type, color, gender, storeName, productId, features[], occasion, featureText, family } */
export function buildInfographicPrompt(item) {
  const fam = item.family || familyOf(item);
  const F = FAMILY[fam] || FAMILY.top;
  const X = T[fam] || T.top;
  const man = item.gender === "man";
  const who = man ? "male" : "female";
  const noun = nounOf(item);
  const brand = String(item.brand || item.storeName || "").replace(/\s+/g, " ").trim().toUpperCase() || "OUR STORE";
  const copy = copyFor({ ...item, family: fam });
  const pr = preserveLines(item, noun);
  const cool = !!X.cool || /^\s*AW\b/i.test(String(item.type || ""));
  const plural = /s$/.test(X.piece) && X.piece !== "dress";
  const thisPiece = `${plural ? "these" : "this"} ${X.piece}`;
  const pieceS = plural ? `${X.piece}'` : `${X.piece}'s`;

  if (X.tpl === "A") {
    return [
      `Create ONE exceptionally refined, ultra-photorealistic, conversion-focused luxury ${F.word} infographic for ${brand}.`,
      `PRODUCT REFERENCE — STRICT ACCURACY\nUse the attached reference image exclusively as a ${F.word} reference.\nFaithfully reproduce the exact ${pr.name}, preserving:\n${pr.lines.join("\n")}\nDo not redesign, upgrade or modify the product. Do not introduce ${F.keep}.`,
      `HUMAN REALISM — CRITICAL PRIORITY\nGenerate a completely new adult ${who} model. Do not recreate the person, legs, feet, clothing or pose from the reference photograph.\nPhotograph a naturally proportioned ${who} model aged 30–45, wearing ${F.wear(man ? "man" : "vrouw")}.\n${F.real}${fam === "shoe" || fam === "sandal" ? "" : `\nThe ${X.piece} must interact physically and naturally with the body. Show believable contact shadows and weight distribution.`}\nAvoid overly smooth skin, duplicated limbs, artificial anatomy or a CGI-looking product.`,
      `ART DIRECTION\nFuturistic 2028 luxury ${F.word} campaign. Apple-level product precision combined with Bottega Veneta editorial sophistication.\nWarm ivory, espresso brown, limestone and subtle charcoal tones.\nPhotographed in a premium architectural studio using soft directional daylight, realistic lens characteristics and beautiful material detail.`,
      `COMPOSITION\nCreate a visually striking, asymmetrical editorial layout.\n${X.primary}\n${X.dom}\nIntegrate two smaller, exceptionally sharp macro photographs:\n${X.m1}\n${X.m2}\nConnect selected details using exceptionally fine editorial callout lines.\nUse a precise invisible Swiss grid, sophisticated typography, controlled negative space and minimal graphic interference.\nThe composition should feel like an expensive designer ${F.word} campaign, not a technical instruction sheet.`,
      `EXACT ON-IMAGE TEXT\nSmall introductory text:\n${copy.intro}\nLarge editorial headline:\n${copy.h1}\n${copy.h2}\nThree sophisticated benefit callouts:\n${copy.points.map((p) => `${p[0].replace(/\.$/, "")}\n${p[1]}`).join("\n")}\nMinimal brand signature:\n${brand}`,
      `CONVERSION OBJECTIVE\nMake the customer immediately imagine how easy, comfortable and stylish this ${X.piece === "sandals" || X.piece === "shoes" ? "footwear" : X.piece} would be to wear.\nCommunicate premium aesthetics, everyday practicality and relaxed sophistication through the photography itself.`,
      `STRICTLY AVOID\nCircular icons, conventional Amazon infographics, oversized badges, rounded information cards, fake medical claims, exaggerated cushioning effects, artificial 3D renders, incorrect anatomy, generic stock photography and excessive text.\nThe final composition must feel contemporary, expensive and exceptionally clean.`,
      `OUTPUT SETTINGS\nOne image only.\nPortrait 4:5.\n1K resolution.\nMedium generation quality.\nMobile-first Shopify product page.\nPrioritise photographic realism and accurate typography.`,
    ].join("\n");
  }

  // Sjabloon B — lifestyle
  const feats = (item.features || []).slice(0, 4).map((f) => f.label.toLowerCase()).join(", ");
  const place = cool ? "in a refined city setting in soft autumn light" : X.place || "at a premium modern coastal villa";
  const mood = cool ? "an effortless, sophisticated city lifestyle on a cool day" : "an effortless, sophisticated coastal lifestyle";
  const light = cool ? "Soft cool daylight, beautiful architectural surroundings" : "Warm natural daylight, beautiful architectural surroundings";
  const candid = cool ? "A candid city lifestyle moment" : "A candid coastal lifestyle moment";
  // korte zin onder de kop (in Justins voorbeeld: "For wherever the day takes you.") — nooit dezelfde als de slotzin
  const support = pickN(["For wherever the day takes you.", "Made for the way you live.", "Effortless looks good on you.", "Made for warmer days."].filter((x) => x !== copy.closing && (!cool || !/warmer/.test(x))), hashOf(`${item.productId || item.title}`) >>> 7, 1)[0];
  const occ = String(item.occasion || "").replace(/\s+/g, " ").trim().toLowerCase();
  return [
    `Create ONE ultra-photorealistic, high-converting luxury fashion lifestyle infographic for ${brand}.`,
    `Use the attached product photograph as the exact garment reference. The same ${pr.name} must appear throughout the composition, preserving its original fabric, colour${feats ? ", " + feats : ""}, construction and fit. Do not redesign or modify the product and do not introduce ${F.keep}.`,
    `ART DIRECTION\n2028 luxury lifestyle editorial. Inspired by Massimo Dutti, Saint Laurent ${cool ? "autumn" : "summer"} campaigns and contemporary luxury travel magazines.\nCapture the feeling of ${mood}.\nA charismatic, naturally ${man ? "masculine male" : "elegant female"} model aged 30–40 wearing the exact ${X.piece} ${place}${F.wear ? `, styled with ${F.wear(man ? "man" : "vrouw")}` : ""}.\n${light}, authentic skin texture, natural body language and cinematic photographic realism.`,
    `HUMAN REALISM — CRITICAL PRIORITY\nGenerate a completely new model. Do not recreate the person, face, body or pose from the reference photograph.\nThe model must look like a real person photographed on a real campaign shoot, not a rendered face: believable facial proportions, subtle facial asymmetry, visible pores, fine lines around the eyes, slightly uneven skin tone, ${man ? "natural stubble" : "a few flyaway hairs"}, real hair texture, naturally proportioned hands with real knuckles and veins.\n${F.real}\nShot on a full-frame camera with a 50–85mm lens, natural depth of field and slight film grain. No beauty retouching, no airbrushed or waxy skin, no perfect symmetry, no artificial AI beauty aesthetic.`,
    `INNOVATIVE EDITORIAL COMPOSITION\nCreate a highly sophisticated visual narrative within a single portrait image.\nOne dominant lifestyle photograph occupies approximately 70% of the composition.${X.frame ? " " + X.frame : ""}\nIntegrate two smaller editorial photographs seamlessly into the layout:\n${candid} featuring the same model and ${X.piece}.\nAn intimate close-up showing the ${pieceS} natural fabric and ${X.detail}.\nUse asymmetrical alignment, subtle image overlaps, refined typography and beautiful negative space.\nThe composition must feel intentionally art-directed rather than like a conventional photo collage.`,
    `EXACT ON-IMAGE COPY\nMain headline:\n${copy.h1}\n${copy.h2}\nSmall supporting statement:\n${support}\nThree aspirational benefit statements, integrated into the photographic composition:\n${copy.points.map((p) => `${p[0]}\n${p[1]}`).join("\n")}\nMinimal footer:\n${copy.closing}\n${brand}`,
    `CONVERSION OBJECTIVE\nSell the lifestyle associated with wearing ${thisPiece}: confidence, freedom, comfort, attractive personal style and versatility.\nMake the customer imagine wearing ${plural ? "them" : "it"} ${occ ? "for " + occ.slice(0, 90) : "on weekends, holidays, relaxed evenings and coastal outings"}.\nThe image should create an emotional desire to own the product rather than simply repeating its description.`,
    `STRICTLY AVOID\nGeneric stock photography, artificial expressions, visible information boxes, oversized icons, fake customer testimonials, excessive copy, misspelled or extra text, dated collages, unrealistic fabric and generic e-commerce infographic designs.\nEvery photograph and typographic detail must feel like part of one cohesive luxury fashion campaign.`,
    `OUTPUT: One image only, portrait 4:5, 1K resolution, medium generation quality, optimised for mobile Shopify product pages.`,
  ].join("\n");
}
