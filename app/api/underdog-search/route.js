import { NextResponse } from "next/server";
import { fetchCatalog, guessGender, analyzeKeyword, matchProduct } from "@/lib/scrape";
import { verifyUnderdogCandidates } from "@/lib/ai";

export const maxDuration = 60;

/* Doorzoekt ÉÉN store voor ÉÉN underdog-keyword — fundamenteel anders dan
   de gewone zoekroute.

   Gewone keywords ("denim shorts") staan letterlijk in producttitels. Een
   underdog ("victorian swimsuit", "xmas day dress") staat er nooit in. Dus:

   1. BREED VANGEN op het producttype uit het profiel ("swimsuit"), niet op
      het keyword zelf.
   2. BEWEZEN WINNERS EERST — en dit is de kern van je vraag: alleen
      producten uit de BOVENKANT van de best-selling volgorde van de winkel
      doen mee. Een niche-zoekvraag levert zo alsnog producten op die het bij
      de concurrent al bewijsbaar goed doen, in plaats van stoffige
      staartartikelen die toevallig aan de omschrijving voldoen.
   3. VOORSELECTIE OP WOORDEN uit het profiel (gratis, geen AI): kandidaten
      met breekpunten in titel of omschrijving vallen meteen af, kandidaten
      met de gezochte kenmerken schuiven naar voren.
   4. BEWIJS OP DE FOTO — de overgebleven top gaat langs de AI, die titel,
      omschrijving én foto's beoordeelt tegen de uitleg uit kolom J.

   Alleen wat door stap 4 komt, komt in de import-lijst. */

const BESTSELLER_TOP_FRACTION = 0.45; // bovenste 45% van de best-selling volgorde
const BESTSELLER_MIN_POOL = 120; // maar altijd minstens deze eerste N producten
const MAX_TO_AI = 14; // kandidaten per AI-controle (foto's kosten tokens)

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ");

function hitCount(haystack, phrases) {
  let n = 0;
  for (const p of phrases || []) {
    const t = norm(p);
    if (!t) continue;
    // Hele frase, of alle losse woorden ervan aanwezig
    if (haystack.includes(t)) {
      n++;
      continue;
    }
    const words = t.split(" ").filter((w) => w.length > 3);
    if (words.length && words.every((w) => haystack.includes(w))) n++;
  }
  return n;
}

export async function POST(req) {
  const { store, keyword, profile, gender, need, excludeLinks, maxPerStore, relaxBestseller } =
    await req.json().catch(() => ({}));
  if (!store || !keyword) {
    return NextResponse.json({ error: "store en keyword zijn verplicht" }, { status: 400 });
  }
  const p = profile || {};

  const exclude = new Set(
    (excludeLinks || []).map((l) => String(l).toLowerCase().replace(/\/$/, ""))
  );

  const catalog = await fetchCatalog(store);
  if (!catalog.products.length) {
    return NextResponse.json({ ok: true, store: catalog.domain, total: 0, matches: [], stats: {} });
  }

  /* 1+2. Zoeken op de VAKTERM eerst, daarna pas verbreden.

     De kern: "pregnancy swimsuit" bestaat niet in producttitels, maar
     "maternity swimsuit" wél — exact hetzelfde product, andere woorden. Het
     profiel levert die vakterm (mainstream) plus een paar zoektermen. We
     proberen ze op volgorde van precisie:
       1. de vakterm            → "maternity swimsuit"   (beste treffer)
       2. de overige zoektermen → "pregnancy swimwear", "ruched belly …"
       3. het brede type        → "swimsuit"             (laatste redmiddel)
     Het keyword dat in de sheet belandt blijft gewoon de underdog zelf. */
  const ladder = [];
  const seenTerm = new Set();
  const addTerm = (t, level) => {
    const s = String(t || "").trim().toLowerCase();
    if (!s || seenTerm.has(s)) return;
    seenTerm.add(s);
    const a = analyzeKeyword(s);
    if (a) ladder.push({ term: s, analysis: a, level });
  };
  addTerm(p.mainstream, 0);
  for (const t of p.searchTerms || []) addTerm(t, 1);
  addTerm(p.broadType, 2);
  addTerm(String(keyword).split(" ").pop(), 2);
  if (!ladder.length) {
    const a = analyzeKeyword(String(keyword));
    if (a) ladder.push({ term: String(keyword).toLowerCase(), analysis: a, level: 2 });
  }
  /* Bestseller-eis. Tweede ronde (relaxBestseller) laat hem los: liever een
     passend product uit de staart dan een leeg keyword — maar pas nadat de
     bewezen verkopers van álle winkels geprobeerd zijn. */
  const cutoff =
    catalog.usedBestSelling && !relaxBestseller
      ? Math.max(BESTSELLER_MIN_POOL, Math.ceil(catalog.products.length * BESTSELLER_TOP_FRACTION))
      : catalog.products.length;
  const stats = { bekeken: 0, buitenBestseller: 0, typeMis: 0, geslacht: 0, breekpunt: 0, naarAi: 0 };

  const pool = [];
  for (let i = 0; i < catalog.products.length; i++) {
    const prod = catalog.products[i];
    const link = prod.url.toLowerCase().replace(/\/$/, "");
    if (exclude.has(link)) continue;
    stats.bekeken++;
    if (i >= cutoff) {
      stats.buitenBestseller++;
      continue;
    }
    /* Welke trede van de ladder raakt dit product? De eerste (meest
       precieze) die matcht telt; raakt geen enkele, dan valt het af. */
    let hit = null;
    for (const step of ladder) {
      const m = matchProduct(step.analysis, prod);
      if (m) {
        hit = { ...step, m };
        break;
      }
    }
    if (!hit) {
      stats.typeMis++;
      continue;
    }
    const g = guessGender(prod);
    if (gender === "Vrouw" && g === "Man") {
      stats.geslacht++;
      continue;
    }
    if (gender === "Man" && g === "Vrouw") {
      stats.geslacht++;
      continue;
    }

    /* 3. Woord-voorselectie. Breekpunten in de TITEL zijn hard (een titel die
       "bikini" zegt is geen badpak); in de omschrijving tellen ze mee als
       min-punt maar zijn ze niet fataal — omschrijvingen noemen vaak
       varianten die niet op de foto staan. */
    const title = norm(prod.title);
    const body = norm(String(prod.bodyHtml || "").replace(/<[^>]+>/g, " ")).slice(0, 1200);
    const tags = norm(prod.tags);
    if (hitCount(title, p.disqualifiers) > 0) {
      stats.breekpunt++;
      continue;
    }
    const haystack = `${title} ${tags} ${body}`;
    /* Een treffer op de vakterm is véél meer waard dan een treffer op het
       brede type: die eerste zegt "dit ís het product", de tweede alleen
       "dit is de juiste categorie". */
    const levelBonus = hit.level === 0 ? 8 : hit.level === 1 ? 4 : 0;
    const score =
      levelBonus +
      hitCount(title, p.searchTerms) * 3 +
      hitCount(haystack, p.searchTerms) +
      hitCount(haystack, p.mustHave) * 2 -
      hitCount(body, p.disqualifiers);

    pool.push({
      idx: i,
      rank: i + 1,
      score,
      level: hit.level,
      via: hit.term,
      link: prod.url,
      title: prod.title,
      desc: body.slice(0, 300),
      images: (prod.images || []).slice(0, 3).map((im) => im.src),
      imageCount: prod.imageCount || 0,
    });
  }

  if (!pool.length) {
    return NextResponse.json({
      ok: true, store: catalog.domain, total: catalog.products.length,
      usedBestSelling: catalog.usedBestSelling, matches: [], stats,
    });
  }

  /* Volgorde naar de AI: eerst kenmerk-score, dan bestseller-rang. Zo krijgt
     de dure fotocontrole de meest kansrijke bewezen verkopers als eerste. */
  // Eerst de precieze treffers (vakterm), daarbinnen de bestverkopende.
  pool.sort((a, b) => a.level - b.level || b.score - a.score || a.rank - b.rank);
  const want = Math.max(1, Math.min(Number(need) || 5, Number(maxPerStore) || 5));
  const shortlist = pool.slice(0, Math.min(MAX_TO_AI, Math.max(want * 3, 8)));
  stats.naarAi = shortlist.length;

  /* 4. Fotobewijs. Faalt de AI-call, dan geven we NIETS terug in plaats van
     ongecontroleerde producten — bij underdogs is de foto het enige echte
     bewijs, want de titel zegt per definitie niets. */
  let keep = [];
  try {
    keep = await verifyUnderdogCandidates(
      keyword,
      p,
      shortlist.map((c, n) => ({ index: n, title: c.title, desc: c.desc, images: c.images, rank: c.rank }))
    );
  } catch (e) {
    return NextResponse.json({
      ok: true, store: catalog.domain, total: catalog.products.length,
      usedBestSelling: catalog.usedBestSelling, matches: [], stats,
      warn: `Fotocontrole mislukte (${e.message}) — niets meegenomen uit deze winkel.`,
    });
  }

  const matches = keep
    .map((k) => {
      const c = shortlist[k.index];
      if (!c) return null;
      return {
        link: c.link,
        title: c.title,
        /* Zichtbaar bewijs in de sheet: via welke vakterm is hij gevonden, en
           hoe hoog stond het product in de best-selling volgorde? */
        source:
          `via "${c.via}"` +
          (catalog.usedBestSelling ? ` · bestseller #${c.rank}` : "") +
          (relaxBestseller ? " · buiten top" : ""),
        literal: "Ruim",
        why: k.why,
        rank: c.rank,
        image: c.images[0] || null,
        images: c.images,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, want);

  return NextResponse.json({
    ok: true,
    store: catalog.domain,
    total: catalog.products.length,
    usedBestSelling: catalog.usedBestSelling,
    candidates: pool.length,
    ladder: ladder.map((l) => l.term),
    stats,
    matches,
  });
}
