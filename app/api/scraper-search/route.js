import { NextResponse } from "next/server";
import { fetchCatalog, guessGender, analyzeKeyword, matchProduct, isKidsProduct, isSetMismatch } from "@/lib/scrape";
import { demandScore, fetchReviewsMany, DEMAND_PROVEN, DEMAND_LIKELY } from "@/lib/demand";

export const maxDuration = 60;

// Doorzoekt concurrent-catalogi voor een keyword.
//
// TWEE VORMEN (05-11-2026):
//   1. klassiek: { store, keyword, ... }        → één store, één zoekterm
//   2. batch:    { jobs: [{ store, terms: [...] }], keyword, ... }
//      → een hele golf winkels in ÉÉN serverless-call. Per winkel wordt de
//        catalogus één keer uit het geheugen/Redis gehaald en daarna voor
//        álle zoektermen tegelijk doorzocht. Dat scheelt per golf tientallen
//        round-trips en het uitpakken van dezelfde catalogus per term.
//        Tijdbewaking: winkels die niet meer binnen de limiet passen komen
//        terug in `pending`; de client stuurt die in de volgende golf mee.
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
  const body = await req.json().catch(() => ({}));
  const { store, keyword, gender, need, excludeLinks, maxPerStore, proof, fast } = body;

  const exclude = new Set((excludeLinks || []).map((l) => String(l).toLowerCase().replace(/\/$/, "")));
  const want = Number(need) || 10;
  const cap = Math.max(1, Math.min(want, Number(maxPerStore) || want));
  const mode = proof === "alles" ? "alles" : proof === "kansrijk" ? "kansrijk" : "bewezen";
  const opts = { gender, exclude, want, cap, mode, fast: !!fast };

  /* ---------- batch: een golf winkels in één call ---------- */
  if (Array.isArray(body.jobs)) {
    const t0 = Date.now();
    const BUDGET_MS = 44000; // daarna geen nieuwe winkel meer starten (limiet 60 s)
    const jobs = body.jobs
      .filter((j) => j && j.store && Array.isArray(j.terms) && j.terms.length)
      .map((j) => ({ store: String(j.store), terms: [...new Set(j.terms.map((t) => String(t || "").trim()).filter(Boolean))] }));
    const results = [];
    const pending = [];
    const queue = [...jobs];
    const CONCURRENCY = 4; // catalogi uitpakken kost geheugen — niet alles tegelijk
    async function worker() {
      while (queue.length) {
        const job = queue.shift();
        if (Date.now() - t0 > BUDGET_MS) {
          pending.push(job.store);
          continue;
        }
        let catalog = null;
        try {
          catalog = await fetchCatalog(job.store);
        } catch (e) {
          results.push({ job: job.store, store: job.store, term: job.terms[0], error: String((e && e.message) || e), matches: [] });
          continue;
        }
        const mine = [];
        for (const term of job.terms) {
          try {
            const r = searchCatalog(catalog, term, opts);
            r.job = job.store; // zoals de client de winkel noemt (catalog.domain is opgeschoond)
            mine.push(r);
          } catch (e) {
            mine.push({ job: job.store, store: job.store, term, error: String((e && e.message) || e), matches: [] });
          }
        }
        // reviews (niet-snelmodus) per winkel in één keer voor alle termen
        if (!opts.fast) await addReviews(mine.filter((r) => r._shortlist), catalog);
        results.push(...mine);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    for (const r of results) delete r._shortlist;
    return NextResponse.json({ ok: true, results, pending, ms: Date.now() - t0 });
  }

  /* ---------- klassiek: één store, één term ---------- */
  if (!store || !keyword) {
    return NextResponse.json({ error: "store en keyword zijn verplicht" }, { status: 400 });
  }
  if (!analyzeKeyword(keyword)) {
    return NextResponse.json({ error: "Leeg keyword" }, { status: 400 });
  }
  const catalog = await fetchCatalog(store);
  const r = searchCatalog(catalog, keyword, opts);
  if (!opts.fast) await addReviews([r], catalog);
  delete r._shortlist;
  return NextResponse.json(r);
}

/* Eén catalogus × één zoekterm → resultaat (zelfde vorm als vroeger).
   Reviews worden hier nog niet opgehaald (zie addReviews): in snelmodus
   nooit, anders na afloop voor de shortlist. */
function searchCatalog(catalog, keyword, { gender, exclude, want, cap, mode, fast }) {
  const base = {
    ok: true,
    store: catalog.domain,
    term: keyword,
    usedBestSelling: catalog.usedBestSelling,
    bestSellingStatus: catalog.bestSellingStatus,
    rankTotal: catalog.rankTotal,
    lang: catalog.lang || "en",
    total: catalog.products.length,
    candidates: 0,
    proof: mode,
    skipped: { gender: 0, foreign: 0, vraag: 0, kids: 0, set: 0 },
    matches: [],
  };
  const analysis = analyzeKeyword(keyword);
  if (!analysis || catalog.products.length === 0) return base;

  const skipped = base.skipped;
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

    // Zoals Chaim's scraper: baby/kids eruit, en geen sets/meerdelige
    // outfits als het keyword om één item vraagt.
    if (isKidsProduct(p)) {
      skipped.kids++;
      continue;
    }
    if (isSetMismatch(p, keyword)) {
      skipped.set++;
      continue;
    }

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
       Voor die producten telt alleen bewijs uit de TITEL — nooit uit de
       omschrijving of een bestandsnaam. */
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
  base.candidates = scored.length;

  // Voorlopige rangorde zonder reviews: tier → literal → bestseller → penalty
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.lit - a.lit ||
      (a.p.bsRank || 1e9) - (b.p.bsRank || 1e9) ||
      a.penalty - b.penalty ||
      a.idx - b.idx
  );

  const ctx = { scored, cap, mode, catalog, skipped, base };
  // Snelmodus: geen productpagina's ophalen voor reviews — de score draait
  // dan op bestseller-positie, uitverkochte varianten en fotoset.
  if (fast) return finish(ctx, new Map());
  // Reviews alleen voor de shortlist (max 2× de cap, max 8): dat zijn de
  // enige producten die de eindronde kunnen halen, en elke productpagina
  // kost een fetch.
  base._shortlist = { ctx, links: scored.slice(0, Math.min(8, cap * 2)).map((c) => c.link) };
  return base;
}

/* Reviews voor de shortlists van één winkel ophalen (alle termen samen,
   dubbele links maar één keer) en de resultaten afmaken. */
async function addReviews(results, catalog) {
  const links = [...new Set(results.flatMap((r) => (r._shortlist ? r._shortlist.links : [])))];
  const reviews = links.length ? await fetchReviewsMany(links) : new Map();
  for (const r of results) {
    if (!r._shortlist) continue;
    const done = finish(r._shortlist.ctx, reviews);
    Object.assign(r, done);
    delete r._shortlist;
  }
  void catalog;
}

function finish({ scored, cap, mode, catalog, skipped, base }, reviews) {
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

  /* Spreiding binnen één keyword: een grens per winkel, zodat je van elke
     winkel de bovenkant pakt in plaats van de staart van één winkel. */
  const matches = filtered.slice(0, cap).map(({ idx, tier, lit, penalty, p, ...rest }) => ({
    ...rest,
    bsRank: p.bsRank || null,
    bsPct: p.bsPct === null || p.bsPct === undefined ? null : Math.round(p.bsPct * 100),
    price: p.price || null,
    soldOutRatio: p.soldOutRatio || 0,
    signals: (rest.signals || []).join(" · "),
  }));
  return { ...base, matches, _shortlist: undefined };
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
