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

/** Kadrering per kledingsoort */
export function framingOf(p) {
  const t = `${String(p.title || "").split("|")[0]} ${p.product_type || ""}`;
  if (/\b(dress|gown|jumpsuit|romper|maxi|coat|trench|kaftan|kimono|set|co-?ord)\b/i.test(t)) return "Full-length shot from head to shoes, simple neutral shoes.";
  if (/\b(pants?|trousers?|jeans|chinos?|leggings|shorts?|skirt|joggers?|cargo)\b/i.test(t)) return "Full-length shot from head to shoes so the whole garment and its length are visible, plain neutral top that does not distract, simple neutral shoes.";
  return "Three-quarter length from mid-thigh to just above the head, plain dark jeans or neutral trousers.";
}
