// COMPETITOR FINDER — markten en standaard-zoekopdrachten (03-11-2026).
// Bewust zonder server-imports: de pagina (client) leest dit ook.
//
// Per markt: `key` = het label dat in de competitor-sheet en in de Product
// Scraper gebruikt wordt (USA, UK, NL/BE, …), `gl` = Google-land voor Apify
// (countryCode), `hl` = interface-taal, `lang` = de taal waarin de
// zoekopdrachten geschreven moeten zijn (voor de AI-lokalisatie), `label` =
// hoe de markt in de UI heet, `group` = kopje in de UI.

export const MARKETS = [
  { key: "USA", label: "USA", gl: "us", hl: "en", lang: "English (United States)", group: "Engels" },
  { key: "UK", label: "UK", gl: "gb", hl: "en", lang: "English (United Kingdom)", group: "Engels" },
  { key: "IE", label: "Ierland", gl: "ie", hl: "en", lang: "English (Ireland)", group: "Engels" },
  { key: "CANADA", label: "Canada", gl: "ca", hl: "en", lang: "English (Canada)", group: "Engels" },
  { key: "AUS", label: "Australië", gl: "au", hl: "en", lang: "English (Australia)", group: "Engels" },
  { key: "NZ", label: "Nieuw-Zeeland", gl: "nz", hl: "en", lang: "English (New Zealand)", group: "Engels" },

  { key: "NL/BE", label: "NL/BE", gl: "nl", hl: "nl", lang: "Dutch (Netherlands/Belgium)", group: "West" },
  { key: "DE", label: "Duitsland", gl: "de", hl: "de", lang: "German (Germany)", group: "West" },
  { key: "AT", label: "Oostenrijk", gl: "at", hl: "de", lang: "German (Austria)", group: "West" },
  { key: "CH", label: "Zwitserland", gl: "ch", hl: "de", lang: "German (Switzerland)", group: "West" },
  { key: "FR", label: "Frankrijk", gl: "fr", hl: "fr", lang: "French (France)", group: "West" },
  { key: "ES", label: "Spanje", gl: "es", hl: "es", lang: "Spanish (Spain)", group: "West" },
  { key: "IT", label: "Italië", gl: "it", hl: "it", lang: "Italian (Italy)", group: "West" },
  { key: "PT", label: "Portugal", gl: "pt", hl: "pt-PT", lang: "Portuguese (Portugal)", group: "West" },

  { key: "PL", label: "Polen", gl: "pl", hl: "pl", lang: "Polish (Poland)", group: "Oost" },
  { key: "HU", label: "Hongarije", gl: "hu", hl: "hu", lang: "Hungarian (Hungary)", group: "Oost" },
  { key: "RO", label: "Roemenië", gl: "ro", hl: "ro", lang: "Romanian (Romania)", group: "Oost" },
  { key: "CZ", label: "Tsjechië", gl: "cz", hl: "cs", lang: "Czech (Czechia)", group: "Oost" },
  { key: "SK", label: "Slowakije", gl: "sk", hl: "sk", lang: "Slovak (Slovakia)", group: "Oost" },
  { key: "GR", label: "Griekenland", gl: "gr", hl: "el", lang: "Greek (Greece)", group: "Oost" },

  { key: "SE", label: "Zweden", gl: "se", hl: "sv", lang: "Swedish (Sweden)", group: "Noord" },
  { key: "DK", label: "Denemarken", gl: "dk", hl: "da", lang: "Danish (Denmark)", group: "Noord" },
  { key: "NO", label: "Noorwegen", gl: "no", hl: "no", lang: "Norwegian (Norway)", group: "Noord" },
  { key: "FI", label: "Finland", gl: "fi", hl: "fi", lang: "Finnish (Finland)", group: "Noord" },
];

export const MARKET_GROUPS = ["Engels", "West", "Oost", "Noord"];

export function marketByKey(key) {
  const k = String(key || "").toUpperCase();
  return MARKETS.find((m) => m.key.toUpperCase() === k) || null;
}

export function isEnglishMarket(market) {
  return !!market && market.hl === "en";
}

// De markten die Justin al in de sheet heeft — standaard aangevinkt.
export const DEFAULT_MARKET_KEYS = ["USA", "UK", "AUS", "CANADA", "NL/BE", "FR", "PL"];

/* STANDAARD-ZOEKOPDRACHTEN (Engels). Twee vormen per categorie, precies zoals
   Justin zoekt:
     1. het categorie-keyword ("women's cocktail dress")
     2. een typische dropship-producttitel in attribuut-stijl ("Women's
        Cocktail Dress | Square Neck Corset Bodycon Mini") — dropshippers
        bouwen titels zo op, dus Google toont dan vooral dropship-stores.
   Niet-Engelse markten krijgen via "AI lokaliseren" een eigen set in de
   lokale taal (bewaard in Redis, aanpasbaar in de UI). */
export const DEFAULT_QUERIES_EN = [
  // ---- dames ----
  "women's casual dress",
  "Women's Casual Dress | V-Neck Button Front Midi with Pockets",
  "women's cocktail dress",
  "Women's Cocktail Dress | Square Neck Corset Bodycon Mini",
  "women's formal dress",
  "Women's Formal Dress | Satin Cowl Neck Slip Maxi",
  "wedding guest dress",
  "Women's Wedding Guest Dress | Floral Wrap Midi Ruffle Hem",
  "women's knit sweater",
  "Women's Sweater | Chunky Cable Knit Crew Neck Oversized",
  "women's cardigan",
  "Women's Cardigan | Button Front Ribbed Knit Longline",
  "women's hoodie",
  "Women's Hoodie | Oversized Fleece Zip-Up Pocket",
  "women's blouse",
  "Women's Blouse | Satin Long Sleeve Button Up Collared",
  "women's tank top",
  "Women's Tank Top | Ribbed Square Neck Fitted Basic",
  "women's puffer jacket",
  "Women's Puffer Jacket | Quilted Hooded Lightweight Down",
  "women's wool coat",
  "Women's Coat | Double Breasted Wool Blend Long Trench",
  "women's wide leg jeans",
  "Women's Jeans | High-Rise Wide Leg Denim Five-Pocket",
  "women's trousers",
  "Women's Trousers | High Waist Pleated Wide Leg Tailored",
  "women's midi skirt",
  "Women's Skirt | Pleated A-Line Midi Elastic Waist",
  "women's ankle boots",
  "Women's Boots | Chunky Heel Ankle Side Zip Platform",
  "women's knee high boots",
  "Women's Boots | Knee High Block Heel Faux Leather",
  "women's loafers",
  "Women's Loafers | Chunky Platform Slip-On Penny",
  "women's sneakers",
  "Women's Sneakers | Chunky Sole Lace-Up Platform",
  "women's handbag",
  "Women's Handbag | Quilted Chain Strap Crossbody Shoulder Bag",
  // ---- heren ----
  "men's casual shirt",
  "Men's Shirt | Long Sleeve Button Down Linen Cotton Casual",
  "men's polo shirt",
  "Men's Polo | Short Sleeve Knit Collar Slim Fit",
  "men's knit sweater",
  "Men's Sweater | Half Zip Knit Pullover Stand Collar",
  "men's hoodie",
  "Men's Hoodie | Heavyweight Fleece Pullover Oversized",
  "men's puffer jacket",
  "Men's Puffer Jacket | Hooded Quilted Padded Winter",
  "men's overcoat",
  "Men's Coat | Wool Blend Single Breasted Long Overcoat",
  "men's bomber jacket",
  "Men's Bomber Jacket | Lightweight Zip-Up Stand Collar",
  "men's chinos",
  "Men's Chinos | Slim Fit Stretch Cotton Flat Front",
  "men's cargo pants",
  "Men's Cargo Pants | Relaxed Fit Multi-Pocket Tapered",
  "men's jeans",
  "Men's Jeans | Straight Fit Stretch Denim Mid-Rise",
  "men's chelsea boots",
  "Men's Chelsea Boots | Leather Slip-On Elastic Side",
  "men's loafers",
  "Men's Loafers | Suede Penny Slip-On Driving",
  "men's sneakers",
  "Men's Sneakers | Low Top Leather Lace-Up Casual",
];

export const VERDICT = {
  dropship: { label: "Dropship", min: 55 },
  twijfel: { label: "Twijfel", min: 35 },
  merk: { label: "Merk/retailer", min: 0 },
};

export function verdictFor(score) {
  const s = Number(score) || 0;
  if (s >= VERDICT.dropship.min) return "dropship";
  if (s >= VERDICT.twijfel.min) return "twijfel";
  return "merk";
}
