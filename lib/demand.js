// Vraag-score per product: "verkoopt dit écht bij de concurrent?"
//
// Tot 21-9 was het enige signaal de positie in /collections/all?sort_by=
// best-selling, en die telde alleen als vierde sorteersleutel. Een titel-
// match op plek 500 won dus van een omschrijving-match op plek 1, en een
// thema dat sort_by negeert gaf een nep-ranking. Nu combineren we vier
// onafhankelijke signalen tot één score 0–100 en een label:
//
//   1. bestseller-positie  (gevalideerde volgorde, zie lib/scrape.js)
//   2. reviews             (JSON-LD aggregateRating, Judge.me, Loox, Okendo,
//                           Yotpo, Stamped — uit de productpagina)
//   3. deels uitverkocht   (varianten op = de concurrent verkoopt het)
//   4. fotoset             (≥4 foto's = de concurrent investeert erin)
//
// Score ≥ 50 = "Bewezen", 25–49 = "Waarschijnlijk", < 25 = "Onbewezen".
// Geen enkel signaal beschikbaar (JS-thema, geen reviews, alles op voorraad)
// = "Onbekend" (score null): dat product kan nog steeds prima zijn, maar we
// kunnen het niet onderbouwen — de run-instelling bepaalt of het meegaat.

import { fetchHtml } from "./scrape";

export const DEMAND_PROVEN = 50;
export const DEMAND_LIKELY = 25;

function num(v) {
  const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/* Reviews uit de productpagina. Geen product.json-veld hiervoor, dus HTML.
   We proberen in volgorde: JSON-LD (bijna elke review-app schrijft die),
   daarna de widget-attributen van de grote apps. Eerste treffer wint. */
export function parseReviewsFromHtml(html) {
  const src = String(html || "");
  // 1. JSON-LD aggregateRating
  for (const m of src.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let raw = m[1].trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data, ...(data["@graph"] || [])];
      for (const n of nodes) {
        const ar = n && (n.aggregateRating || (n.offers && n.offers.aggregateRating));
        if (!ar) continue;
        const count = num(ar.reviewCount ?? ar.ratingCount);
        const rating = num(ar.ratingValue);
        if (count !== null && count > 0) return { count, rating, source: "json-ld" };
      }
    } catch {
      /* kapotte JSON-LD → volgende blok */
    }
  }
  // 2. Judge.me — attribuutvolgorde verschilt per thema, dus los uitlezen
  let m = src.match(/<[^>]*jdgm-prev-badge[^>]*>/i) || src.match(/<[^>]*data-number-of-reviews=[^>]*>/i);
  if (m) {
    const c = m[0].match(/data-number-of-reviews=["'](\d+)["']/i);
    const r = m[0].match(/data-average-rating=["']([\d.]+)["']/i);
    if (c) return { count: num(c[1]), rating: r ? num(r[1]) : null, source: "judge.me" };
  }
  // 3. Loox
  m = src.match(/<[^>]*loox-rating[^>]*>/i) || src.match(/<[^>]*data-raters=[^>]*>/i);
  if (m) {
    const c = m[0].match(/data-raters=["'](\d+)["']/i);
    const r = m[0].match(/data-rating=["']([\d.]+)["']/i);
    if (c) return { count: num(c[1]), rating: r ? num(r[1]) : null, source: "loox" };
  }
  // 4. Okendo / Yotpo / Stamped (tekstuele badge "123 reviews")
  m = src.match(/(?:okeReviews|yotpo|stamped)[\s\S]{0,400}?(\d{1,6})\s*(?:reviews|beoordelingen|avis|bewertungen)/i);
  if (m) return { count: num(m[1]), rating: null, source: "widget" };
  // 5. generiek "(123 reviews)" in de buurt van een sterretje
  m = src.match(/(\d{1,6})\s+(?:reviews|beoordelingen|avis|bewertungen)\b/i);
  if (m && num(m[1]) >= 3) return { count: num(m[1]), rating: null, source: "text" };
  return null;
}

// Reviews ophalen voor één product-URL (8 s, geen retries — dit is bijvangst)
export async function fetchReviews(url) {
  const html = await fetchHtml(url, 8000);
  if (!html) return null;
  return parseReviewsFromHtml(html);
}

// Meerdere producten tegelijk, met een klein aantal parallelle fetches
export async function fetchReviewsMany(urls, concurrency = 4) {
  const out = new Map();
  const queue = [...urls];
  async function worker() {
    while (queue.length) {
      const u = queue.shift();
      try {
        out.set(u, await fetchReviews(u));
      } catch {
        out.set(u, null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}

/* Score + uitleg. `p` = product uit fetchCatalog, `reviews` = {count, rating}
   of null, `bestSellingStatus` = "geldig" | "genegeerd" | "onbekend". */
export function demandScore(p, reviews, bestSellingStatus) {
  let score = 0;
  let known = false;
  const signals = [];

  if (bestSellingStatus === "geldig") {
    known = true;
    if (p.bsRank) {
      const pct = p.bsPct ?? 1;
      if (pct <= 0.1) score += 60;
      else if (pct <= 0.25) score += 45;
      else if (pct <= 0.5) score += 30;
      else score += 10;
      signals.push(`bestseller #${p.bsRank} (top ${Math.max(1, Math.round(pct * 100))}%)`);
    } else {
      signals.push("buiten de bestseller-top");
    }
  }

  if (reviews && reviews.count > 0) {
    known = true;
    const goodRating = reviews.rating === null || reviews.rating >= 4;
    if (reviews.count >= 20 && goodRating) score += 30;
    else if (reviews.count >= 5 && goodRating) score += 20;
    else if (goodRating) score += 10;
    signals.push(`${reviews.count} reviews${reviews.rating ? ` · ${reviews.rating.toFixed(1)}★` : ""}`);
  }

  const so = Number(p.soldOutRatio) || 0;
  if (so >= 0.3 && so < 1) {
    known = true;
    score += 10;
    signals.push(`${Math.round(so * 100)}% varianten uitverkocht`);
  } else if (so >= 1) {
    known = true;
    signals.push("helemaal uitverkocht");
  }

  if ((p.imageCount || 0) >= 4) score += 5;

  score = Math.min(100, score);
  const label = !known
    ? "Onbekend"
    : score >= DEMAND_PROVEN
    ? "Bewezen"
    : score >= DEMAND_LIKELY
    ? "Waarschijnlijk"
    : "Onbewezen";
  return { score: known ? score : null, label, signals };
}
