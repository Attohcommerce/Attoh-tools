/* VASTE WERKREGELS (10-11-2026, afgesproken met Justin na de eerste batch van 37 op LGB):
   1. AI-foto's staan altijd VOORAAN in de galerij: eerste kleur plek 1, volgende kleuren 2, 3, ...
      en elke AI-foto is de variantfoto van zijn kleur. De leveranciersfoto's blijven erachter staan.
   2. De eerste AI-foto van een product komt ook in de omschrijving: echt in het midden (display:block + margin auto), 80% breed,
      direct na de inleiding en vóór "WHY CHOOSE ...". Eén foto per product.
   3. Alleen het kledingstuk uit de bronfoto gebruiken; persoon, pose, achtergrond, sieraden en
      andere kleding in de bronfoto negeren (staat in de prompt als THE PRODUCT-regel).
   4. AI kiest = op GALERIJCIJFER, niet op "is er een gezicht". Kijk naar de hele galerij, niet alleen de variantfoto.
      Goed genoeg → OVERSLAAN: een nette set van meerdere foto's waarop het product gedragen wordt door een model,
      studio of rustige achtergrond, product helemaal in beeld, scherp. Een uitsnede vanaf de taille is bij
      broeken/jeans/rokken gewoon goed. (Les 10-11: de baggy jeans op LGB had prima studiofoto's en kreeg
      onterecht een AI-foto.)
      Ook goed genoeg → OVERSLAAN: een nette set PRODUCTFOTO'S zonder model (packshots: ghost mannequin of
      strak neergelegd/opgehangen, witte of rustige studio-achtergrond, goed licht, bij elkaar horend).
      Het gaat om hoe mooi de foto's zijn, niet om of er een model op staat. (Les 11-11, eerste run op
      Consistent Couture: bomberjack met 4 packshots, jack met capuchon, trenchcoat en vest kregen onterecht
      AI-foto's omdat er geen model op stond.)
      Wel maken: maar één foto in de galerij; amateurfoto zonder model (hanger aan een deur, op bed of vloer,
      gekreukt, slecht licht); mockup (kledingstuk op een lichaam geplakt, geen echte foto); leveranciersfoto
      (vlak licht, stijve pose, strakke uitsnede, gekreukt); spiegelselfie of rommelige achtergrond; product
      nergens helemaal in beeld.
      Twijfel bij een set van 3+ nette foto's (model of packshot) = overslaan en melden, niet maken.
      Steekproef van Justin (11-11): GEEN foto → gebreide set op model voor grijze studiowand, maxi-jurk met
      4 modelfoto's, pyjamaset met 21 studiofoto's, twee jeans met 6 foto's, coltrui met 5 studiofoto's.
      WEL foto → Fair Isle-trui met 1 afgesneden leveranciersfoto, colour-block trui met 1 mockup-achtige foto.
      De regels staan onderaan dit bestand: GALLERY_RUBRIC (wat de AI ziet) en galleryVerdict (de vaste beslisregels).
   5. Bronfoto die alleen de achterkant toont of voor twee kleuren dezelfde is: overslaan.
   6. Omschrijvingen kort (80-105 woorden), zelfde aantal keywords — zie ATTRIBUTE_STYLE in lib/ai.js. */
// FOTO-BREIN v1 (10-11-2026, projectdoc 135/136) — AI-modelfoto's na import.
// Eén bron voor de regels: model-instellingen, prompt-blokken, modelprofielen.
// Claude (via de Higgsfield-koppeling) haalt dit op samen met de wachtrij.
export const PHOTO_SETTINGS = { model: "gpt_image_2", quality: "medium", resolution: "2k", aspect_ratio: "1:1" };

export const GARMENT_RULES = `IMAGE EDIT TASK: virtual try-on. The reference image is a photograph of the REAL product. Put this exact garment on the model. It is the product being sold, so it must be the SAME physical garment as in the reference, not a similar one and not a redesign.

GARMENT FIDELITY RULES (highest priority, above everything else):
1. Take the garment from the reference image as it is. Do not redraw, reinterpret, restyle, simplify or 'improve' it.
2. Keep every element in the same place and the same size relative to the garment: neckline/collar, closure (zip, buttons), every band, print or motif, pockets, seams, hem, cuffs, length.
3. Keep the exact colours of the reference. Do not shift hue, saturation or brightness of the garment.
4. Count check: number of bands, rows of motifs, buttons and pockets must be identical to the reference.
5. Do not add anything that is not in the reference and do not remove anything that is there.
6. Only what changes: the garment is now worn by a body, so it gains natural 3D shape, soft folds and realistic fabric texture.`;

export const PHOTO_BLOCK = `PHOTO: real studio catalogue photograph for a product page, full-frame camera, 85mm at f/4, fine grain, true-to-life colour. One large softbox at 45 degrees, plain seamless light warm-grey background, soft natural shadow. Hands visible and anatomically correct. No text, no logos, no props.`;

export const PERSON_RULES = `An attractive, well-groomed, healthy-looking person, the kind of good-looking mature model a quality fashion brand casts. Real photographic skin texture with fine pores and light smile lines, natural not airbrushed, no exaggerated flaws, no plastic skin, no perfect symmetry. Relaxed genuine expression.`;

// lengte in cm + maat = fitnote. Het model draagt één maat groter dan normaal (vaste regel).
export const PROFILES = {
  man: [
    { id: "m1", age: 47, look: "American, athletic normal build, thick dark-blond hair with grey at the temples, short neat stubble, hazel eyes", height: 185, size: "L" },
    { id: "m2", age: 52, look: "African American, fit normal build, short neat hair grey at the sides, well-kept salt-and-pepper beard, warm dark-brown eyes", height: 183, size: "L" },
    { id: "m3", age: 45, look: "Italian-American, lean build, dark wavy hair greying at the temples, clean-shaven with light shadow, brown eyes", height: 178, size: "M" },
    { id: "m4", age: 55, look: "American, broad-shouldered sturdy build, full silver-grey hair neatly cut, short grey beard, blue eyes", height: 188, size: "XL" },
    { id: "m5", age: 49, look: "Latino American, medium build, short black hair with some grey, trimmed dark beard, dark eyes", height: 176, size: "M" },
    { id: "m6", age: 58, look: "American, tall slim build, short white-grey hair, clean-shaven, light-blue eyes, friendly lined face", height: 186, size: "L" },
    { id: "m7", age: 44, look: "American, stocky strong build, shaved head, full short brown beard with grey, green eyes", height: 180, size: "XL" },
    { id: "m8", age: 50, look: "Asian American, slim athletic build, short black hair with grey streaks, clean-shaven, dark eyes", height: 177, size: "M" },
  ],
  vrouw: [
    { id: "v1", age: 46, look: "American, curvy fuller figure, shoulder-length chestnut hair with soft waves, hazel eyes, light natural make-up", height: 168, size: "XL" },
    { id: "v2", age: 52, look: "American, average build, chin-length ash-blonde bob with some grey, blue eyes, light natural make-up", height: 170, size: "L" },
    { id: "v3", age: 48, look: "African American, curvy fuller figure, natural shoulder-length curls, warm brown eyes, soft natural make-up", height: 167, size: "XL" },
    { id: "v4", age: 55, look: "American, slim build, silver-grey shoulder-length hair, green eyes, minimal make-up, elegant", height: 172, size: "M" },
    { id: "v5", age: 44, look: "Latina American, medium curvy build, long dark-brown hair, dark eyes, light natural make-up", height: 164, size: "L" },
    { id: "v6", age: 50, look: "American, plus-size figure, auburn hair in a loose low bun, grey-blue eyes, light natural make-up", height: 166, size: "2XL" },
    { id: "v7", age: 58, look: "American, average build, short layered grey-blonde hair, brown eyes, warm lined face, minimal make-up", height: 165, size: "L" },
    { id: "v8", age: 47, look: "Asian American, slim build, straight black bob with a few grey strands, dark eyes, light natural make-up", height: 162, size: "M" },
  ],
};

const FEMALE_TYPE = /\b(dress|gown|skirt|blouse|bra|bikini|swimsuit|leggings|jumpsuit|romper|tunic|cami|bodysuit|kaftan|kimono)\b/i;
/** man | vrouw — uit titel/type/tags */
export function genderOf(p) {
  const t = `${p.title || ""} ${p.product_type || ""} ${p.tags || ""}`;
  if (/\bwomen'?s?\b|\bladies\b|\bfemale\b|\bvrouw/i.test(t)) return "vrouw";
  if (/\bmen'?s?\b|\bmale\b|\bman\b|\bheren/i.test(t)) return "man";
  return FEMALE_TYPE.test(t) ? "vrouw" : "man";
}

const BOTTOM_RE = /\b(pants?|trousers?|jeans|chinos?|leggings|shorts|skirts?|skort|joggers?|sweatpants|culottes|capris?)\b/i;
const FULL_RE = /\b(dress|gown|jumpsuit|romper|coat|trench|overcoat|kaftan|kimono|co-?ord|two[- ]piece|matching set)\b/i;
/** top | bottom | full — soort kledingstuk. "Short Sleeve Sweater" is een top, geen short. */
export function kindOf(p) {
  const head = `${String(p.title || "").split("|")[0]} ${p.product_type || p.type || ""}`
    .replace(/\bshort[\s-]?sleeves?d?\b|\bcargo (jacket|shirt|vest)\b|\bsweater dress\b/gi, (m) => (/dress/i.test(m) ? "dress" : " "));
  if (FULL_RE.test(head)) return "full";
  if (BOTTOM_RE.test(head) || /\bcargo\b/i.test(head)) return "bottom";
  return "top";
}

/** Kadrering per kledingsoort */
export function framingOf(p) {
  const k = kindOf(p);
  if (k === "full") return "Full-length shot from head to shoes, simple neutral shoes.";
  if (k === "bottom") return "Full-length shot from head to shoes so the whole garment and its length are visible, plain fitted neutral top tucked in so the waistband is visible, simple neutral shoes.";
  return "Three-quarter length from mid-thigh to just above the head, plain neutral trousers or dark jeans.";
}

/** "Women's Cocktail Dress | Midi ..." → "cocktail dress" */
export function productNoun(p) {
  const left = String(p.title || "").split("|")[0].replace(/\b(wo)?men'?s\b|\bfor (wo)?men\b|\bladies\b/gi, " ").replace(/\s+/g, " ").trim();
  return (left || p.product_type || p.type || "garment").toLowerCase();
}

/* SHOT-INDELING (aantal foto's per kleur → welke soorten, in deze volgorde).
   front  = gedragen, recht van voren (dit is altijd de variantfoto en de foto in de omschrijving)
   angle  = zelfde model, driekwart gedraaid — laat pasvorm en zijkant zien
   detail = close-up van het belangrijkste detail, gedragen (kraag/sluiting/print/stof)
   flat   = product alleen, netjes plat gelegd op lichte ondergrond, zonder persoon
   Bewust GEEN achteraanzicht: de achterkant staat niet op de bronfoto en zou verzonnen zijn. */
export const SHOT_PLAN = { 1: ["front"], 2: ["front", "angle"], 3: ["front", "angle", "flat"], 4: ["front", "angle", "detail", "flat"] };
export const SHOT_LABEL = { front: "vooraanzicht", angle: "schuin van opzij", detail: "detail", flat: "plat gelegd" };
export function shotPlan(per) {
  return SHOT_PLAN[Math.max(1, Math.min(4, Number(per) || 1))];
}

const REF_RULE = (noun) => `THE PRODUCT: the ${noun} in the first reference image. Use ONLY that garment. Ignore the person, pose, background, hanger, jewellery, bags, shoes and all other clothing in the reference; do not copy them.`;
const SAME_MODEL = `SAME MODEL: the second reference image shows the model already wearing this garment. Use exactly the same person (face, hair, body, skin tone) and the same other clothing as in that image.`;

/** Volledige prompt voor één opdracht. item: { title, type, profile, gender, shotType, hasModelRef } */
export function buildPrompt(item) {
  const noun = productNoun(item);
  const p = item.profile || {};
  const who = item.gender === "man" ? "man" : "woman";
  const shot = item.shotType || "front";
  if (shot === "flat") {
    return [
      `IMAGE EDIT TASK: product-only photograph. The first reference image is a photograph of the REAL product. Show this exact garment on its own, neatly laid flat. It must be the SAME physical garment as in the reference, not a similar one and not a redesign.`,
      REF_RULE(noun),
      GARMENT_RULES.split("\n\n")[1].replace("6. Only what changes: the garment is now worn by a body, so it gains natural 3D shape, soft folds and realistic fabric texture.", "6. Only what changes: the garment now lies flat, front side up, sleeves or legs arranged naturally, with soft realistic folds and fabric texture. Do not invent details that are not visible in the reference."),
      `FRAMING: flat lay photographed straight from above, the whole garment in frame with a little space around it, centred. No person, no mannequin, no hanger.`,
      `PHOTO: real studio product photograph, soft even daylight from the side, plain light warm-grey surface, soft natural shadow under the garment, true-to-life colour, fine grain. No text, no logos, no props.`,
    ].join("\n\n");
  }
  const person = `MODEL: a ${p.age || 48}-year-old ${who}, ${p.look || "American, average build"}. ${PERSON_RULES}`;
  const framing =
    shot === "angle"
      ? `FRAMING: ${framingOf(item)} The model stands turned about 45 degrees away from the camera with the face turned back towards the camera, so the side and the fit of the ${noun} are visible. Natural relaxed pose.`
      : shot === "detail"
      ? `FRAMING: close-up of the upper body or of the most characteristic part of the ${noun} (collar, closure, print or fabric texture), worn by the model, face partly or fully out of frame, sharp focus on the fabric and details.`
      : `FRAMING: ${framingOf(item)} Natural relaxed standing pose, facing the camera, arms relaxed so the whole front of the ${noun} is visible.`;
  return [GARMENT_RULES.split("\n\n")[0], REF_RULE(noun), GARMENT_RULES.split("\n\n")[1], item.hasModelRef && shot !== "front" ? SAME_MODEL : "", person, framing, PHOTO_BLOCK].filter(Boolean).join("\n\n");
}

/* Modelkeuze: één model per product (alle kleuren en shots van dat product hetzelfde gezicht),
   en binnen een batch elk product een ander model tot de lijst op is. */
export function profilePicker() {
  const order = {};
  const n = { man: 0, vrouw: 0 };
  return (gender) => {
    const pool = PROFILES[gender] || PROFILES.vrouw;
    if (!order[gender]) order[gender] = [...pool].sort(() => Math.random() - 0.5);
    return order[gender][n[gender]++ % pool.length];
  };
}

/* ================================================================
   AI KIEST — GALERIJCIJFER (11-11-2026, steekproef van Justin)
   Vraag: heeft dit product al een mooie set foto's, of is de galerij dun/zwak?
   De AI kijkt (GALLERY_RUBRIC) en geeft per product: worn, full, look, score, why.
   Daarna beslist galleryVerdict met vaste regels, zodat de keuze voorspelbaar is.
   Cijfer 7 of hoger = overslaan. Cijfer 6 of lager = AI-foto's maken.
================================================================ */
export const GALLERY_LOOKS = ["studio", "lifestyle", "packshot", "supplier", "mockup", "selfie", "amateur"];
const GOOD_LOOKS = ["studio", "lifestyle", "packshot"];

export const GALLERY_RUBRIC = `You decide for a fashion web store whether a product needs NEW AI-generated model photos. For each item you see the first photos of its gallery (up to 6) and the total number of photos. Judge the photos, not the garment's design.

The store owner's rule: a product that already has a good-looking set of photos gets NO new photo, whether or not a model is in them. Clean professional product photos without a model are good enough. Only a thin or ugly gallery gets new photos.

STEP 1. Look at every photo of the item and note:
- worn = how many of the shown photos show the garment worn by a real person, clearly visible.
- full = true when at least one photo shows the WHOLE garment, not cut off, worn or not (the face may be out of frame). For trousers, jeans, shorts and skirts a waist-down view that shows the full length counts. For a set (two pieces) both pieces must be visible.
- look = the overall impression of the gallery, exactly one of:
  "studio" = professional e-commerce shoot with a model: styled model, even soft light, clean seamless or calm backdrop, photos belong together.
  "lifestyle" = professional outdoor or interior shoot with a model, tasteful, the garment is clearly the subject.
  "packshot" = professional product photos without a model: ghost mannequin or invisible mannequin, or the garment neatly laid flat or hung, on a clean white or neutral studio background, even light, no creases, sharp, photos belong together (for example the same view in each colour, plus detail close-ups). A gallery of packshots with one or two worn or detail photos is still "packshot".
  "supplier" = factory or marketplace look with a person: flat or harsh light, stiff pose, tight torso crop that hides the model, creased garment, plain wall, phone quality, photos that do not belong together.
  "mockup" = not a real photograph: digital render, garment pasted onto a body or template, illustration-like, unnaturally smooth fabric.
  "selfie" = mirror selfie or home snapshot, busy room or street.
  "amateur" = product without a model, photographed carelessly: hanger on a door or wall, lying on a bed, floor or table, creased, bad light, shadows, phone quality.

STEP 2. Score the GALLERY as a whole, 1 to 10:
9-10 = complete professional set: 3 or more photos that belong together, studio, lifestyle or packshot, whole garment visible, sharp, good light.
7-8 = good gallery: 2 or more clean professional photos (with a model or packshots), whole garment visible in at least one, calm background. Nothing needs fixing.
5-6 = thin or weak gallery: only 1 photo, however decent; or only tight crops that never show the whole garment; or supplier look; or mockup look; or selfie or busy background; or the garment is partly hidden by a bag, arms or hair.
3-4 = amateur product photos; or a collage; or low resolution.
1-2 = marketplace junk: text, watermarks, size charts or swatches on the photos, heavy distortion, blurry.

Calibration from the store owner:
- NO new photo (7 or higher): a knit two-piece set on a model, full body, grey studio backdrop. A printed maxi dress with 4 clean model photos. A pajama set with 21 studio photos. Jeans with 6 clean photos on a model. An oversized turtleneck sweater with 5 clean studio photos. A bomber jacket with 4 clean ghost-mannequin packshots, one per colour, on white. A hooded jacket with clean product shots in 3 colours, one worn crop and detail close-ups. A trench coat and a cardigan with a clean packshot and several more clean photos.
- New photo (6 or lower): a sweater with only 1 photo, a tight torso crop with a plain supplier look. A colour-block sweater with only 1 photo that looks like a mockup. A sweater on a hanger against a door, phone quality.

When a gallery has 3 or more clean photos that belong together and you hesitate between a good look ("studio", "lifestyle", "packshot") and a weak one, or between 6 and 7, choose the good look and 7: do not make photos that are not needed.
why = the main reason in Dutch, max 10 words (e.g. "nette set studiofoto's op model", "nette productfoto's, geen model nodig", "maar 1 foto, strakke uitsnede", "lijkt een mockup, geen echte foto").
Return ONLY the JSON object.`;

export const GALLERY_JSON_HINT = `Judge every item. Return ONLY JSON: {"results":[{"index":0,"worn":4,"full":true,"look":"studio","score":8,"why":"max 10 words, in Dutch"}]}`;

/** Tekst boven de foto's van één product: titel + hoeveel foto's er in totaal zijn. */
export function galleryItemLine(index, title, count, shown) {
  const n = Math.max(0, Number(count) || 0);
  const s = Math.max(0, Number(shown) || 0);
  const photos = n <= 1 ? `${n} photo in the gallery` : n > s ? `${n} photos in the gallery, first ${s} shown` : `${n} photos in the gallery`;
  return `ITEM ${index}: ${String(title || "").slice(0, 90)} (${photos})`;
}

/** Vaste beslisregels bovenop het oordeel van de AI.
    raw: { score, worn, full, look, why } van de AI · count: totaal aantal foto's van het product
    → { score, needs, why, photos, worn, full, look, rule } — needs = AI-foto's maken.
    Of er een model op staat telt niet mee; alleen hoe netjes de galerij is. */
export function galleryVerdict(raw, count) {
  const r = raw || {};
  const photos = Math.max(0, Math.round(Number(count) || 0));
  const shown = Math.min(photos || 6, 6);
  let score = Math.max(1, Math.min(10, Math.round(Number(r.score) || 0)));
  const worn = r.worn === undefined || r.worn === null || Number.isNaN(Number(r.worn)) ? null : Math.max(0, Math.min(shown, Math.round(Number(r.worn))));
  const full = r.full === undefined || r.full === null ? null : r.full === true || r.full === "true";
  const look = GALLERY_LOOKS.includes(String(r.look || "").toLowerCase()) ? String(r.look).toLowerCase() : "";
  let why = String(r.why || "").replace(/\s+/g, " ").trim().slice(0, 90);
  let rule = "";
  const cap = (max, name, reason) => {
    if (score > max) {
      score = max;
      rule = name;
      why = reason;
    }
  };
  // 1. zwakke galerij: altijd AI-foto's, wat het cijfer van de AI ook is.
  //    Geen model is op zich GEEN reden meer (11-11): nette packshots blijven zoals ze zijn.
  if (look === "amateur" || look === "product") cap(4, "amateur", "amateurfoto's zonder model");
  if (look === "mockup") cap(5, "mockup", "lijkt een mockup, geen echte modelfoto");
  if (photos === 1) cap(6, "1-foto", "maar 1 foto in de galerij");
  if (look === "supplier") cap(6, "leverancier", "leveranciersfoto's, geen nette modelshoot");
  if (look === "selfie") cap(6, "selfie", "selfie of rommelige achtergrond");
  if (full === false) cap(6, "afgesneden", "product nergens helemaal in beeld");
  // 2. mooie set: 3+ nette foto's die bij elkaar horen (model of packshot), product heel in beeld → niet maken bij twijfel (5 of 6)
  const cleanShots = look === "packshot" ? photos : worn === null ? 0 : worn;
  if (!rule && (score === 5 || score === 6) && GOOD_LOOKS.includes(look) && cleanShots >= 3 && full === true) {
    score = 7;
    rule = "mooie-set";
    why = look === "packshot" ? `nette set van ${photos} productfoto's` : `nette set van ${photos > worn ? photos : worn} foto's op model`;
  }
  return { score, needs: score <= 6, why, photos, worn, full, look, rule };
}
