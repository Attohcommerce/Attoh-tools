// DROPSHIP-SCORE (03-11-2026) — herkent een general-fashion dropship-store
// zoals Justin dat met het oog doet, maar dan uit publieke data:
//   products.json  → één vendor voor alles, producten in bursts aangemaakt,
//                    compare-at op bijna alles, .95/.99-prijzen, maten tot
//                    5XL, veel kleuren, "please allow 1-3 cm" in de tekst,
//                    leeftijd van de store (oudste published_at)
//   homepage-HTML  → trust bar (gratis verzending / 30 dagen retour / koop 2),
//                    sale-banner, "ships by", Ltd/LLC/HK-adres in de footer,
//                    thema (Impulse/Prestige/Dawn…), reviews-app, track-app
//   AliExpress     → hoofdfoto van een bestseller door de bestaande
//                    search-by-image (Apify) — gevonden = hard bewijs (+30)
// Score 0–100: ≥ 55 dropship · 35–54 twijfel · < 35 merk/retailer.
// Retailer-signaal (veel verschillende merken als vendor) trekt hard af.
import { fetchJson, fetchHtml, cleanDomain } from "./scrape.js";
import { searchByImage, imageSearchConfigured } from "./imagesearch.js";
import { verdictFor } from "./finder-markets.js";

const MAX_PAGES = 12; // 12 × 250 = 3.000 producten tellen is genoeg

const TRUST = [
  /free (?:\w+ )?shipping|gratis verzending|livraison gratuite|kostenloser versand|versandkostenfrei|env[ií]o gratis|spedizione gratuita|envio gr[aá]tis|darmowa dostawa|ingyenes sz[aá]ll[ií]t[aá]s|livrare gratuit[aă]|doprava zdarma|bezplatn[aá] doprava|δωρεάν αποστολή|fri frakt|gratis fragt|ilmainen toimitus/i,
  /\b(?:14|30|60|90)[- ]?(?:day|days|dagen|jours|tage|d[ií]as|giorni|dias|dni|nap|zile|dn[ií]|dní|ημέρες|dagar|dage|päivän?)\b[^.<]{0,40}(?:return|retour|r[üu]ckgabe|devoluci|reso|devolu|zwrot|visszak|retur|vr[aá]cen|vr[aá]ten|επιστροφ|retur|palautus)|(?:return|retour|r[üu]ckgabe|devoluci|reso|zwrot|retur)[^.<]{0,40}\b(?:14|30|60|90)\b/i,
  /buy ?2|koop ?2|achetez ?2|kaufe?n? ?2|compra ?2|acquista ?2|kup ?2|2\+? (?:items|stuks|artikelen|articles|artikel|art[ií]culos|articoli)|get (?:10|15|20)% off|(?:10|15|20)% (?:korting|rabatt|de descuento|di sconto|zniżki|kedvezm|reducere|sleva|rabat|alennus)/i,
];
const SALE = /\b(?:sale|soldes|uitverkoop|rabatt|rebajas|saldi|promo[cç][aã]o|wyprzeda|akci[oó]|reduceri|v[yý]prodej|έκπτωση|rea\b|udsalg|salg|ale\b)\b|\d{2}% ?(?:off|korting|rabatt|de descuento|di sconto|zniżki|kedvezm|reducere|sleva|rabat|alennus)|countdown|ends (?:in|tonight|soon)|limited time|autumn sale|winter sale|black friday/i;
const SHIPS_BY = /ships? by|order (?:today|now)[^.<]{0,30}(?:ship|dispatch)|vandaag besteld|aujourd'hui command|heute bestellt|hoy pedido|oggi ordin|dzi[sś] zam[oó]w|azonnal|ast[aă]zi comand|dnes objedn|i dag|idag|tänään/i;
const THEMES = /"name"\s*:\s*"(impulse|prestige|dawn|sense|refresh|craft|ride|taste|studio|origin|colorblock|publisher|crave|spotlight|symmetry|empire|warehouse|turbo|flex|motion|streamline|pipeline|broadcast|expanse|focal|shapes|be yours|kalles|ella|debutify|booster|minimog|avone|wokiee|palo alto|district|venue|cascade|avenue|mobilia|showtime|startup|boundless|brooklyn|narrative|simple|supply|venture|minimal|debut)"/i;
const REVIEW_APPS = /judge\.me|judgeme|loox\.io|loox|alireviews|ali-reviews|vitals\.co|rivyo|opinew|stamped\.io|yotpo|okendo|reviews\.io|trustoo|ryviu|areviews/i;
const TRACK_APPS = /17track|parcelpanel|track123|trackingmore|aftership|track your order|bestelling volgen|suivre (?:ma|votre) commande|bestellung verfolgen|rastrear (?:mi|tu) pedido|traccia (?:il|l')? ?ordine|śledź zamówienie|rendel[eé]s k[oö]vet|urm[aă]rire comand|sledovat objedn|spåra|spor din ordre|seuraa tilausta/i;
const VIRTUAL_OFFICE = /shelton street|kemp house|covent garden|wc2h 9jq|71[-–]75 shelton|hong ?kong|kowloon|connaught road|cma building|20-22 wenlock|wenlock road|128 city road|ec1v 2nx|international house|sheung wan|tsim sha tsui|wan chai|lai chi kok|kwun tong|1309 coffeen|sheridan, wy|30 n gould|casper, wy|wyoming/i;
const COMPANY = /\b(?:ltd|limited|llc|inc\.?|l\.l\.c|co\., ?ltd|gmbh|ug \(haftungsbeschr|s\.r\.o|sp\. ?z ?o\.o|kft|srl|bv|b\.v\.)\b/i;
const MEASURE = /manual measurement|measurement error|1-3 ?cm|1–3 ?cm|2-3 ?cm|please allow|slight (?:color|colour) difference|due to (?:the )?(?:light|monitor|screen)|handmatig gemeten|afwijking van 1|mesure manuelle|manuelle messung|medici[oó]n manual|misurazione manuale/i;
const SHOPIFY_HTML = /cdn\.shopify\.com|shopify\.theme|shopify-section|myshopify\.com|Shopify\.shop\b/i;
const BIG_SIZES = /^(?:3xl|4xl|5xl|6xl|xxxl|xxxxl|xxxxxl)$/i;

function monthsBetween(a, b) {
  return (b - a) / (1000 * 60 * 60 * 24 * 30.4);
}

async function fetchAllProducts(dom, deadline) {
  const out = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() > deadline - 4000) {
      truncated = true;
      break;
    }
    const r = await fetchJson(`https://${dom}/products.json?limit=250&page=${page}`, 8000);
    if (!r.ok || !r.data || !Array.isArray(r.data.products)) {
      if (page === 1) return { ok: false, status: r.status, error: r.error, products: [] };
      break;
    }
    out.push(...r.data.products);
    if (r.data.products.length < 250) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { ok: true, products: out, truncated };
}

/**
 * auditDropship(domain, { aliCheck, deadline }) →
 *   { domain, ok, shopify, products, productsPlus, score, verdict, signals[],
 *     negatives[], vendorTop, ageMonths, theme, currencyHint, images[], ali }
 */
export async function auditDropship(domain, opts = {}) {
  const dom = cleanDomain(domain);
  const deadline = Number(opts.deadline) || Date.now() + 40000;
  const out = {
    domain: dom, ok: false, shopify: false, products: 0, productsPlus: false, score: 0, verdict: "merk",
    signals: [], negatives: [], vendorTop: "", vendors: 0, ageMonths: null, theme: "", images: [], ali: null, note: "",
  };
  const [pj, html] = await Promise.all([fetchAllProducts(dom, deadline), fetchHtml(`https://${dom}/`, 9000)]);
  const h = html || "";
  if (!pj.ok) {
    out.shopify = SHOPIFY_HTML.test(h);
    out.note = !h ? "onbereikbaar" : out.shopify ? `Shopify, maar products.json ${pj.status || "dicht"}` : "geen Shopify";
    if (!out.shopify) return out;
  } else {
    out.shopify = true;
  }
  out.ok = true;
  const prods = pj.products || [];
  out.products = prods.length;
  out.productsPlus = !!pj.truncated;
  let score = 0;
  const sig = (text, pts) => {
    out.signals.push(`${text} (+${pts})`);
    score += pts;
  };
  const neg = (text, pts) => {
    out.negatives.push(`${text} (−${pts})`);
    score -= pts;
  };

  if (prods.length) {
    // --- vendor-uniformiteit vs. retailer ---
    const vc = new Map();
    for (const p of prods) {
      const v = String(p.vendor || "").trim().toLowerCase();
      vc.set(v, (vc.get(v) || 0) + 1);
    }
    const sorted = [...vc.entries()].sort((a, b) => b[1] - a[1]);
    out.vendors = sorted.length;
    out.vendorTop = sorted[0] ? sorted[0][0] : "";
    const topShare = sorted[0] ? sorted[0][1] / prods.length : 0;
    if (topShare >= 0.9) sig("één vendor voor alles", 12);
    else if (topShare >= 0.7) sig("bijna één vendor", 6);
    else if (sorted.length >= 12 && topShare < 0.5) neg(`${sorted.length} verschillende merken als vendor → retailer`, 25);
    else if (sorted.length >= 6 && topShare < 0.5) neg(`${sorted.length} merken als vendor`, 10);

    // --- bursts: veel producten op dezelfde dag aangemaakt ---
    const days = new Map();
    let oldest = null;
    for (const p of prods) {
      const c = String(p.created_at || "").slice(0, 10);
      if (c) days.set(c, (days.get(c) || 0) + 1);
      const pub = Date.parse(p.published_at || p.created_at || "");
      if (pub && (!oldest || pub < oldest)) oldest = pub;
    }
    const busiest = Math.max(0, ...days.values());
    const top7 = [...days.values()].sort((a, b) => b - a).slice(0, 7).reduce((a, b) => a + b, 0);
    if (busiest / prods.length >= 0.3 && prods.length >= 20) sig(`${Math.round((busiest / prods.length) * 100)}% van de producten op één dag aangemaakt`, 10);
    else if (top7 / prods.length >= 0.6 && prods.length >= 20) sig("producten in bulk-bursts aangemaakt", 8);
    if (oldest) {
      out.ageMonths = Math.round(monthsBetween(oldest, Date.now()) * 10) / 10;
      if (out.ageMonths < 4) sig(`jonge store (±${out.ageMonths} mnd)`, 8);
      else if (out.ageMonths < 12) sig(`store < 1 jaar (±${out.ageMonths} mnd)`, 5);
    }

    // --- compare-at, prijseindes, maten, kleuren, tekst ---
    let cmp = 0;
    let disc = [];
    let endings = 0;
    let priced = 0;
    let bigSize = false;
    let colorVals = 0;
    let colorOpts = 0;
    let measure = 0;
    for (const p of prods) {
      const v = (p.variants || [])[0];
      if (v) {
        const price = parseFloat(v.price);
        const cap = parseFloat(v.compare_at_price);
        if (isFinite(price) && price > 0) {
          priced++;
          const cents = Math.round((price % 1) * 100);
          if (cents === 95 || cents === 99 || cents === 90) endings++;
          if (isFinite(cap) && cap > price) {
            cmp++;
            disc.push(1 - price / cap);
          }
        }
      }
      for (const o of p.options || []) {
        const name = String(o.name || "").toLowerCase();
        const vals = Array.isArray(o.values) ? o.values : [];
        if (/size|maat|taille|gr[oö][sß]e|talla|taglia|rozmiar|m[eé]ret|m[aă]rime|velikost|μέγεθος|storlek|st[oø]rrelse|koko/.test(name)) {
          if (vals.some((x) => BIG_SIZES.test(String(x).trim()))) bigSize = true;
        }
        if (/colou?r|kleur|couleur|farbe|color|colore|cor\b|kolor|sz[ií]n|culoare|barva|χρώμα|f[aä]rg|farve|v[aä]ri/.test(name)) {
          colorOpts++;
          colorVals += vals.length;
        }
      }
      if (MEASURE.test(String(p.body_html || ""))) measure++;
    }
    if (priced) {
      const cmpShare = cmp / priced;
      if (cmpShare >= 0.6) sig(`compare-at op ${Math.round(cmpShare * 100)}% van de producten`, 12);
      else if (cmpShare >= 0.3) sig(`compare-at op ${Math.round(cmpShare * 100)}%`, 6);
      if (disc.length) {
        disc.sort((a, b) => a - b);
        const med = disc[Math.floor(disc.length / 2)];
        if (med >= 0.3 && med <= 0.7) sig(`"korting" mediaan ${Math.round(med * 100)}%`, 3);
      }
      if (endings / priced >= 0.7) sig("prijzen op .95/.99", 4);
    }
    if (bigSize) sig("maten tot 3XL–5XL", 5);
    if (colorOpts && colorVals / colorOpts >= 3) sig("veel kleurvarianten", 3);
    if (measure / Math.max(1, prods.length) >= 0.1) sig('"please allow 1–3 cm" in omschrijvingen', 8);
    if (prods.length >= 100 && prods.length <= 3000) sig("catalogus 100–3.000 producten", 2);

    out.images = prods
      .slice(0, 6)
      .map((p) => (p.images && p.images[0] && p.images[0].src) || null)
      .filter(Boolean)
      .slice(0, 3);
  }

  // --- homepage ---
  if (h) {
    const trust = TRUST.filter((re) => re.test(h)).length;
    if (trust >= 2) sig("trust bar (verzending/retour/koop 2)", 8);
    else if (trust === 1) sig("1 trust-regel", 4);
    if (SALE.test(h)) sig("sale-banner / korting", 4);
    if (SHIPS_BY.test(h)) sig('"ships by" / vandaag besteld', 3);
    const tm = h.match(THEMES);
    if (tm) {
      out.theme = tm[1];
      sig(`thema ${tm[1]}`, 4);
    } else {
      const any = h.match(/Shopify\.theme\s*=\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i);
      if (any) out.theme = any[1];
    }
    if (REVIEW_APPS.test(h)) sig("reviews-app", 3);
    if (TRACK_APPS.test(h)) sig("track-je-bestelling", 5);
    const tail = h.slice(-60000); // footer zit onderaan
    if (VIRTUAL_OFFICE.test(tail)) sig("virtueel kantoor / HK-adres in footer", 8);
    else if (COMPANY.test(tail)) sig("Ltd/LLC in footer", 3);
    const lower = tail.toLowerCase();
    if (/store locator|our stores|onze winkels|winkel vinden|nos magasins|unsere filialen|nuestras tiendas|i nostri negozi|nasze sklepy|üzleteink|magazinele noastre|naše prodejny|våra butiker|vores butikker|myymälämme/.test(lower)) neg("fysieke winkels", 15);
    if (/wholesale|b2b portal|groothandel|trade account/.test(lower)) neg("groothandel/B2B", 5);
  }

  // --- AliExpress-bewijs (alleen als het al naar dropship neigt; kost Apify-tegoed) ---
  const pre = Math.max(0, Math.min(100, score));
  if (opts.aliCheck && imageSearchConfigured() && out.images.length && pre >= 35 && Date.now() < deadline - 25000) {
    try {
      const r = await searchByImage(out.images[0], { limit: 4 });
      if (r.ok) {
        const n = (r.candidates || []).length;
        out.ali = { checked: true, found: n > 0, candidates: n, top: n ? r.candidates[0].link : null };
        if (n > 0) sig(`hoofdfoto op AliExpress gevonden (${n}×)`, 30);
      } else {
        out.ali = { checked: false, error: r.error };
      }
    } catch (e) {
      out.ali = { checked: false, error: String(e.message || e) };
    }
  }

  out.score = Math.max(0, Math.min(100, Math.round(score)));
  out.verdict = verdictFor(out.score);
  return out;
}
