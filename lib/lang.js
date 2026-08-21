// TAAL-NORMALISATIE — geïmporteerde producten komen uit FR/DE/ES/IT/NL/PL/CN…
// stores en nemen hun optienamen ("Taille", "Größe") en waarden ("Bleu",
// "Schwarz") mee. In een EN-store is dat een GMC-afkeuring (verkeerde taal
// in size/color-attributen) én slordig voor de klant. Alles hier is
// deterministisch (woordenboeken, geen AI): gratis, snel en altijd hetzelfde.
// De AI-restlaag in de Store Doctor vangt wat het woordenboek mist.

/* ---------- Optienamen ---------- */

const OPTION_NAMES = {
  size: [
    "size", "taille", "größe", "grösse", "groesse", "grosse", "talla", "taglia",
    "tamanho", "tamaño", "tamano", "maat", "storlek", "størrelse", "storrelse",
    "koko", "rozmiar", "velikost", "méret", "meret", "размер", "尺码", "尺寸",
    "サイズ", "사이즈", "mărime", "marime", "beden", "boyut", "μέγεθος",
  ],
  color: [
    "color", "colour", "couleur", "coloris", "farbe", "colore", "cor", "kleur",
    "färg", "farg", "farve", "farge", "väri", "vari", "kolor", "barva", "szín",
    "szin", "цвет", "颜色", "顏色", "カラー", "色", "색상", "culoare", "renk",
    "χρώμα",
  ],
  material: [
    "material", "matière", "matiere", "matériau", "materiau", "stoff",
    "materiale", "materiaal", "tessuto", "tela", "tecido", "materiał",
    "материал", "材质", "材質", "kumaş", "kumas", "fabric",
  ],
  style: ["style", "stil", "estilo", "stile", "stijl", "styl"],
  length: [
    "length", "longueur", "länge", "laenge", "largo", "lunghezza",
    "comprimento", "lengte", "längd", "langd", "длина", "长度",
  ],
  type: ["type", "typ", "tipo"],
  model: ["model", "modèle", "modele", "modell", "modelo"],
};

const CANON_LABEL = {
  size: "Size", color: "Color", material: "Material", style: "Style",
  length: "Length", type: "Type", model: "Model",
};

const NAME_LOOKUP = new Map();
for (const [kind, words] of Object.entries(OPTION_NAMES)) {
  for (const w of words) NAME_LOOKUP.set(w, kind);
}

/** "Taille" → {name: "Size", kind: "size", changed: true} */
export function canonOptionName(rawName) {
  const raw = String(rawName || "").trim();
  const kind = NAME_LOOKUP.get(raw.toLowerCase()) || null;
  if (!kind) return { name: raw, kind: guessKindFromEnglish(raw), changed: false };
  const name = CANON_LABEL[kind];
  return { name, kind, changed: name.toLowerCase() !== raw.toLowerCase() };
}

function guessKindFromEnglish(name) {
  const n = String(name || "").toLowerCase();
  if (/colou?r/.test(n)) return "color";
  if (/size/.test(n)) return "size";
  return "other";
}

/* ---------- Waarden: hele frases (exacte match wint altijd) ---------- */

const PHRASES = {
  // one size in alle smaken
  "taille unique": "One Size", "einheitsgröße": "One Size", "einheitsgroesse": "One Size",
  "talla única": "One Size", "talla unica": "One Size", "taglia unica": "One Size",
  "tamanho único": "One Size", "tamanho unico": "One Size", "één maat": "One Size",
  "een maat": "One Size", "one size": "One Size", "onesize": "One Size",
  "free size": "One Size", "единый размер": "One Size", "均码": "One Size",
  "unique": "One Size", "única": "One Size", "unica": "One Size",
  // samengestelde kleuren die woord-voor-woord fout gaan
  "bleu marine": "Navy", "azul marino": "Navy", "azul marinho": "Navy",
  "blu navy": "Navy", "bleu ciel": "Sky Blue", "azul celeste": "Sky Blue",
  "vert foncé": "Dark Green", "vert fonce": "Dark Green", "bleu foncé": "Dark Blue",
  "bleu fonce": "Dark Blue", "bleu clair": "Light Blue", "gris clair": "Light Grey",
  "gris foncé": "Dark Grey", "gris fonce": "Dark Grey", "rose clair": "Light Pink",
  "vert clair": "Light Green", "rouge foncé": "Dark Red", "rouge fonce": "Dark Red",
  "藏青色": "Navy", "藏青": "Navy", "军绿色": "Army Green", "军绿": "Army Green",
  "酒红色": "Wine", "酒红": "Wine", "天蓝色": "Sky Blue", "天蓝": "Sky Blue",
  "深蓝色": "Dark Blue", "深蓝": "Dark Blue", "浅蓝色": "Light Blue", "浅蓝": "Light Blue",
  "咖啡色": "Coffee", "米白色": "Off White", "玫红色": "Rose", "玫红": "Rose",
  "杏色": "Apricot", "米色": "Beige", "卡其色": "Khaki", "粉红色": "Pink",
};

/* ---------- Waarden: losse woorden ---------- */

const WORDS = {
  // Frans
  // LET OP: "rose" en "sable" staan er bewust NIET in — dat zijn ook
  // Engelse modekleuren (Dusty Rose, Rose Gold, Sable) en die moeten blijven.
  noir: "Black", noire: "Black", blanc: "White", blanche: "White", gris: "Grey",
  grise: "Grey", rouge: "Red", bleu: "Blue", bleue: "Blue", marine: "Navy",
  vert: "Green", verte: "Green", jaune: "Yellow", violet: "Purple",
  violette: "Purple", pourpre: "Purple", marron: "Brown", brun: "Brown",
  brune: "Brown", kaki: "Khaki", bordeaux: "Burgundy", doré: "Gold", dore: "Gold",
  argenté: "Silver", argente: "Silver", argent: "Silver", écru: "Ecru", ecru: "Ecru",
  crème: "Cream", creme: "Cream", ciel: "Sky", clair: "Light", claire: "Light",
  foncé: "Dark", fonce: "Dark", multicolore: "Multicolor", abricot: "Apricot",
  prune: "Plum", corail: "Coral", lavande: "Lavender", menthe: "Mint",
  moutarde: "Mustard", ivoire: "Ivory", vin: "Wine",
  petit: "Small", moyen: "Medium", grand: "Large", grande: "Large",
  // Duits
  schwarz: "Black", weiß: "White", weiss: "White", grau: "Grey", rot: "Red",
  blau: "Blue", dunkelblau: "Navy", hellblau: "Light Blue", marineblau: "Navy",
  grün: "Green", gruen: "Green", dunkelgrün: "Dark Green", gelb: "Yellow",
  lila: "Purple", violett: "Purple", braun: "Brown", dunkelbraun: "Dark Brown",
  weinrot: "Wine", golden: "Gold", silber: "Silver", hell: "Light",
  dunkel: "Dark", bunt: "Multicolor", mehrfarbig: "Multicolor", klein: "Small",
  mittel: "Medium", groß: "Large", gross: "Large",
  // Spaans
  negro: "Black", negra: "Black", blanco: "White", blanca: "White", rojo: "Red",
  roja: "Red", azul: "Blue", marino: "Navy", verde: "Green", amarillo: "Yellow",
  amarilla: "Yellow", naranja: "Orange", rosado: "Pink", rosada: "Pink",
  morado: "Purple", morada: "Purple", purpura: "Purple", violeta: "Purple",
  marrón: "Brown", café: "Brown", caqui: "Khaki", burdeos: "Burgundy",
  dorado: "Gold", plateado: "Silver", plata: "Silver", crema: "Cream",
  claro: "Light", clara: "Light", oscuro: "Dark", oscura: "Dark",
  celeste: "Sky Blue", granate: "Maroon", vino: "Wine", turquesa: "Turquoise",
  // Italiaans
  nero: "Black", nera: "Black", bianco: "White", bianca: "White",
  grigio: "Grey", grigia: "Grey", rosso: "Red", rossa: "Red", blu: "Blue",
  azzurro: "Light Blue", azzurra: "Light Blue", giallo: "Yellow", gialla: "Yellow",
  arancione: "Orange", viola: "Purple", marrone: "Brown", cachi: "Khaki",
  oro: "Gold", dorato: "Gold", argento: "Silver", chiaro: "Light",
  chiara: "Light", scuro: "Dark", scura: "Dark", vino2: "Wine",
  // Portugees
  preto: "Black", preta: "Black", branco: "White", branca: "White",
  cinza: "Grey", cinzento: "Grey", vermelho: "Red", vermelha: "Red",
  marinho: "Navy", amarelo: "Yellow", amarela: "Yellow", laranja: "Orange",
  roxo: "Purple", roxa: "Purple", castanho: "Brown", marrom: "Brown",
  bege: "Beige", vinho: "Wine", dourado: "Gold", prateado: "Silver",
  escuro: "Dark", escura: "Dark", multicolorido: "Multicolor",
  // Nederlands
  zwart: "Black", zwarte: "Black", wit: "White", witte: "White", grijs: "Grey",
  grijze: "Grey", rood: "Red", rode: "Red", blauw: "Blue", blauwe: "Blue",
  donkerblauw: "Navy", lichtblauw: "Light Blue", marineblauw: "Navy",
  groen: "Green", groene: "Green", geel: "Yellow", gele: "Yellow",
  oranje: "Orange", roze: "Pink", paars: "Purple", paarse: "Purple",
  bruin: "Brown", bruine: "Brown", bordeauxrood: "Burgundy", goud: "Gold",
  gouden: "Gold", zilver: "Silver", zilveren: "Silver", licht: "Light",
  donker: "Dark", meerkleurig: "Multicolor", groot: "Large", middel: "Medium",
  // Pools
  czarny: "Black", czarna: "Black", biały: "White", bialy: "White",
  biała: "White", biala: "White", szary: "Grey", szara: "Grey",
  czerwony: "Red", czerwona: "Red", niebieski: "Blue", niebieska: "Blue",
  granatowy: "Navy", granatowa: "Navy", zielony: "Green", zielona: "Green",
  żółty: "Yellow", zolty: "Yellow", pomarańczowy: "Orange", różowy: "Pink",
  rozowy: "Pink", fioletowy: "Purple", brązowy: "Brown", brazowy: "Brown",
  beżowy: "Beige", bezowy: "Beige", bordowy: "Burgundy", złoty: "Gold",
  zloty: "Gold", srebrny: "Silver", kremowy: "Cream", jasny: "Light",
  ciemny: "Dark", kolorowy: "Multicolor",
  // Scandinavisch
  svart: "Black", sort: "Black", vit: "White", hvid: "White", hvit: "White",
  grå: "Grey", gra: "Grey", röd: "Red", rød: "Red", blå: "Blue", bla: "Blue",
  marinblå: "Navy", grön: "Green", gron: "Green", grønn: "Green", grøn: "Green",
  gul: "Yellow", lyserød: "Pink", guld: "Gold", gull: "Gold", sølv: "Silver",
  mörk: "Dark", mork: "Dark", ljus: "Light", lys: "Light",
  // Turks
  siyah: "Black", beyaz: "White", gri: "Grey", kırmızı: "Red", kirmizi: "Red",
  mavi: "Blue", lacivert: "Navy", yeşil: "Green", yesil: "Green",
  sarı: "Yellow", sari: "Yellow", turuncu: "Orange", pembe: "Pink",
  mor: "Purple", kahverengi: "Brown", bej: "Beige", haki: "Khaki",
  bordo: "Burgundy", altın: "Gold", altin: "Gold", gümüş: "Silver",
  gumus: "Silver", krem: "Cream",
  // Chinees (losse kleurwoorden)
  "黑色": "Black", "白色": "White", "灰色": "Grey", "红色": "Red",
  "蓝色": "Blue", "绿色": "Green", "黄色": "Yellow", "橙色": "Orange",
  "粉色": "Pink", "紫色": "Purple", "棕色": "Brown", "金色": "Gold",
  "银色": "Silver", "黑": "Black", "白": "White", "红": "Red", "蓝": "Blue",
};
delete WORDS.vino2; // dubbele sleutel-guard

// Modifiers die vóór de kleur horen ("Bleu clair" → "Light Blue")
const MODIFIERS = new Set(["Light", "Dark"]);

function titleCase(s) {
  return String(s)
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Vertaal één optie-waarde naar Engels. Alleen aanpassen wanneer er echt een
 * woordenboek-match is — "Dusty Blue" en "M" blijven ongemoeid.
 * → { value, changed }
 */
/* Alleen EIGEN sleutels van het woordenboek tellen. PHRASES en WORDS zijn
   gewone objecten en erven "constructor" van Object.prototype — een waarde
   "constructor" zou anders de Object-functie als "vertaling" opleveren
   (zelfde foutklasse als de verdeling-crash op "baffin constructor boots"). */
const OWN = Object.prototype.hasOwnProperty;
const lookup = (dict, key) => (OWN.call(dict, key) ? dict[key] : undefined);

export function translateValue(rawValue) {
  const raw = String(rawValue == null ? "" : rawValue).trim();
  if (!raw) return { value: raw, changed: false };

  const lower = raw.toLowerCase();
  const phraseLower = lookup(PHRASES, lower);
  if (phraseLower) {
    return { value: phraseLower, changed: phraseLower !== raw };
  }
  // CN-frases zitten zonder spaties in PHRASES; check ook de rauwe string
  const phraseRaw = lookup(PHRASES, raw);
  if (phraseRaw) return { value: phraseRaw, changed: phraseRaw !== raw };

  const tokens = lower.split(/[\s/]+/).filter(Boolean);
  let hits = 0;
  const out = tokens.map((t) => {
    const clean = t.replace(/[(),]/g, "");
    const word = lookup(WORDS, clean);
    if (word) {
      hits++;
      return word;
    }
    return t;
  });
  if (!hits) return { value: raw, changed: false };

  // "Blue Light" → "Light Blue"
  const mods = out.filter((w) => MODIFIERS.has(w));
  const rest = out.filter((w) => !MODIFIERS.has(w));
  const rebuilt = titleCase([...mods, ...rest].join(" ").replace(/\s+/g, " ").trim());
  return { value: rebuilt, changed: rebuilt !== raw };
}

/* ---------- Detectie-helpers voor de Store Doctor ---------- */

// Niet-Latijnse schriften die nooit in een EN-listing thuishoren
export const FOREIGN_SCRIPT_RE = /[一-鿿぀-ヿ가-힯Ѐ-ӿ]/;

// Verraders in omschrijvingen: leveranciers-woorden per taal
const DESC_WORDS = [
  "livraison", "couleur", "matière", "vêtement", "grösse", "größe", "lieferung",
  "rückgabe", "kleidung", "envío", "envio gratis", "devolución", "tamaño",
  "spedizione", "reso", "taglia", "consegna", "entrega", "devolução",
  "tamanho", "verzending", "retourneren", "面料", "材质", "模特", "身高",
  "尺码", "颜色", "均码",
];
const DESC_RE = new RegExp("\\b(" + DESC_WORDS.filter((w) => !FOREIGN_SCRIPT_RE.test(w)).join("|") + ")\\b", "i");
const DESC_CJK = DESC_WORDS.filter((w) => FOREIGN_SCRIPT_RE.test(w));

/** Vind vreemde-taal-signalen in een tekst → lijst gevonden termen (leeg = schoon). */
export function foreignTextHits(text) {
  const s = String(text || "");
  const hits = [];
  const m = s.match(DESC_RE);
  if (m) hits.push(m[1]);
  for (const w of DESC_CJK) {
    if (s.includes(w)) {
      hits.push(w);
      break;
    }
  }
  if (!hits.length && FOREIGN_SCRIPT_RE.test(s)) hits.push("niet-Latijns schrift");
  return hits;
}

/**
 * EU-maatvoering herkennen (34/36/38…) in een AU/US/UK-store. Denim-taille
 * (24–33 inch) valt er bewust buiten — pas vanaf 34 én overwegend even
 * getallen is het verdacht.
 */
export function looksEuSizing(values) {
  const nums = (values || [])
    .map((v) => parseInt(String(v).trim(), 10))
    .filter((n) => !isNaN(n));
  if (nums.length < 2) return false;
  if (Math.min(...nums) < 34) return false;
  const even = nums.filter((n) => n >= 34 && n <= 54 && n % 2 === 0);
  return even.length >= nums.length * 0.7;
}
