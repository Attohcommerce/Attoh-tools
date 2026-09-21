import { NextResponse } from "next/server";
import { fetchCatalog, guessGender, analyzeKeyword, matchProduct } from "@/lib/scrape";
import { demandScore, fetchReviewsMany, DEMAND_PROVEN, DEMAND_LIKELY } from "@/lib/demand";

export const maxDuration = 60;

// Doorzoekt ÉÉN store voor ÉÉN keyword. De client loopt zelf over
// stores/keywords zodat elke serverless-call kort blijft.
//
// Volgorde: eerst alle titel-matches, dan omschrijving, dan foto's — en
// BINNEN een tier eerst de producten met bewezen vraag (vraag-score uit
// lib/demand.js: gevalideerde bestseller-positie, reviews, uitverkochte
// varianten). We beoordelen de HELE catalogus, halen voor de shortlist de
// reviews op en sorteren daarna — de eerste N die je terugkrijgt zijn dus
// altijd de best onderbouwde N.
//
// proof: "bewezen"  → alleen score ≥ 50 (of Onbekend als de winkel geen
//                     enkel signaal geeft — dat kan de winkel niet helpen)
//        "kansrijk" → score ≥ 25 of Onbekend
//        "alles"    → geen vraag-filter (oude gedrag)
export async function POST(req) {
  const { store, keyword, gender, need, excludeLinks, maxPerStore, proof } =
    await req.json().catch(() => ({}));
  if (!store || !keyword) {
    return NextResponse.json({ error: "store en keyword zijn verplicht" }, { status: 400 });
  }

  const analysis = analyzeKeyword(keyword);
  if (!analysis) {
    return NextResponse.json({ error: "Leeg keyword" }, { status: 400 });
  }

  const exclude = new Set(
    (excludeLinks || []).map((l) => String(l).toLowerCase().replace(/\/$/, ""))
  );

  const catalog = await fetchCatalog(store);
  if (catalog.products.length === 0) {
    return NextResponse.json({
      ok: true,
      store: catalog.domain,
      usedBestSelling: catalog.usedBestSelling,
      bestSellingStatus: catalog.bestSellingStatus,
      total: 0,
      matches: [],
    });
  }

  const skipped = { gender: 0, foreign: 0, vraag: 0 };
  const scored = [];
  for (let i = 0; i < catalog.products.length; i++) {
    const p = catalog.products[i];
    const link = p.url.toLowerCase().replace(/\/$/, "");
    if (exclude.has(link)) continue;

    // Bewust GEEN filters op foto-aantal of voorraad: de voorraad van de
    // concurrent zegt niets over de leverancier — uitverkocht bij de
    // concurrent is eerder een bestseller-signaal dan een bezwaar.

    const m = matchProduct(analysis, p);
    if (!m) continue;

    const g = guessGender(p);
    if (gender === "Vrouw" && g === "Man") {
      skipped.gender++;
      continue;
    }
    if (gender === "Man" && g === "Vrouw") {
      skipped.gender++;
      continue;
    }

    /* Anderstalige titels ("Pull Femme Francesca en Maille", "Manteau
       Doudoune Long à Capuche") kan de Engelse taxonomie niet beoordelen.
       Vorige run leverde dat een trui, een winterjas én enkellaarsjes op
       onder het keyword "leggings". Voor die producten telt alleen bewijs
       uit de TITEL — nooit uit de omschrijving of een bestandsnaam. */
    const foreign = isForeignTitle(p.title);
    if (foreign && m.tier > 1) {
      skipped.foreign++;
      continue;
    }

    scored.push({
      idx: i,
      p,
      tier: m.tier,
      lit: m.literal ? 1 : 0,
      // Zwak bewijs voor kleur/materiaal (stond niet in de titel) en
      // magere fotosets zakken naar achteren, ze vallen er niet uit.
      penalty: (m.weakAttribute ? 1 : 0) + ((p.imageCount || 0) < 3 ? 1 : 0),
      link: p.url,
      title: p.title,
      source: m.source, // Titel | Omschrijving | Foto's
      literal: m.literal ? "Literal" : "Ruim",
      image: p.images && p.images[0] ? p.images[0].src : null, // voor AI-vision dubbelcheck
      images: (p.images || []).slice(0, 3).map((im) => im.src), // strengere foto-controle
      needsPhotoProof: !!m.weakAttribute || m.tier > 1 || foreign,
    });
  }

  const want = Number(need) || 10;
  const cap = Math.max(1, Math.min(want, Number(maxPerStore) || want));
  const mode = proof === "alles" ? "alles" : proof === "kansrijk" ? "kansrijk" : "bewezen";

  // Voorlopige rangorde zonder reviews: tier → literal → bestseller → penalty
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.lit - a.lit ||
      (a.p.bsRank || 1e9) - (b.p.bsRank || 1e9) ||
      a.penalty - b.penalty ||
      a.idx - b.idx
  );

  /* Reviews alleen voor de shortlist (max 2× de cap, max 8): dat zijn de
     enige producten die de eindronde kunnen halen, en elke productpagina
     kost een fetch. */
  const shortlist = scored.slice(0, Math.min(8, cap * 2));
  const reviews = shortlist.length ? await fetchReviewsMany(shortlist.map((c) => c.link)) : new Map();
  for (const c of scored) {
    const d = demandScore(c.p, reviews.get(c.link) || null, catalog.bestSellingStatus);
    c.demand = d.score;
    c.demandLabel = d.label;
    c.signals = d.signals;
  }

  // Rangorde: 1) titel vóór omschrijving vóór foto's
  //           2) binnen een tier: Literal vóór Ruim
  //           3) daarna: hoogste vraag-score eerst (Onbekend achteraan)
  //           4) daarna: sterk bewijs en volle fotosets eerst
  //           5) daarbinnen: best selling / catalogusvolgorde
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.lit - a.lit ||
      (b.demand ?? -1) - (a.demand ?? -1) ||
      a.penalty - b.penalty ||
      a.idx - b.idx
  );

  // Vraag-filter: bij "bewezen"/"kansrijk" vallen producten met een te lage
  // score af. Onbekend (winkel geeft geen enkel signaal) blijft staan, maar
  // wordt als "Onbekend" gemarkeerd zodat je het in de sheet ziet.
  const minScore = mode === "bewezen" ? DEMAND_PROVEN : mode === "kansrijk" ? DEMAND_LIKELY : 0;
  const filtered = scored.filter((c) => {
    if (minScore === 0 || c.demand === null) return true;
    if (c.demand >= minScore) return true;
    skipped.vraag++;
    return false;
  });

  /* Spreiding binnen één keyword. Zonder grens vulde de eerste (grootste)
     concurrent in z'n eentje het hele quotum — twaalf van de twaalf boots
     kwamen uit dezelfde winkel. Met een grens per winkel pak je van elke
     winkel de bovenkant in plaats van de staart van één winkel. */
  const matches = filtered
    .slice(0, cap)
    .map(({ idx, tier, lit, penalty, p, ...rest }) => ({
      ...rest,
      bsRank: p.bsRank || null,
      bsPct: p.bsPct === null || p.bsPct === undefined ? null : Math.round(p.bsPct * 100),
      price: p.price || null,
      soldOutRatio: p.soldOutRatio || 0,
      signals: (rest.signals || []).join(" · "),
    }));

  return NextResponse.json({
    ok: true,
    store: catalog.domain,
    usedBestSelling: catalog.usedBestSelling,
    bestSellingStatus: catalog.bestSellingStatus,
    rankTotal: catalog.rankTotal,
    total: catalog.products.length,
    candidates: scored.length,
    proof: mode,
    skipped,
    matches,
  });
}

// Snelle taaldetectie op de titel: accenten of veelvoorkomende niet-Engelse
// modewoorden. Alleen bedoeld om de tekstmatcher niet te laten gokken.
const FOREIGN_WORDS = new Set(
  `femme homme robe pantalon veste manteau bottes bottines chaussures jupe
   chemise pull jean blouson ceinture sac elegante elegant confortable
   decontracte taille haute mousseline daim cuir soie hiver ete printemps
   damen herren kleid hose jacke mantel stiefel schuhe rock hemd pullover
   vestido pantalon chaqueta abrigo botas zapatos falda camisa jersey mujer
   donna abito camicia gonna scarpe stivali giacca cappotto`
    .split(/\s+/)
    .filter(Boolean)
);

function isForeignTitle(title) {
  const t = String(title || "").toLowerCase();
  if (/[àâçéèêëîïôùûüœ]/.test(t)) return true;
  const words = t.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const w of words) if (FOREIGN_WORDS.has(w)) hits++;
  return hits >= 2;
}
