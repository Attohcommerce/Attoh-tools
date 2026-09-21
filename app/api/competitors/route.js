import { NextResponse } from "next/server";
import { readRange } from "@/lib/sheets";
import { selectCompetitors, translateKeywordsForMarket } from "@/lib/ai";
import { auditStore } from "@/lib/scrape";

export const maxDuration = 60;

/* De competitor-sheet is een dashboard, geen nette tabel: markt-blokken
   onder elkaar, hulptabellen ernaast, duplicaten erin. We parsen daarom
   RIJ voor RIJ op patronen in plaats van op vaste kolommen: een cel die
   op een domein lijkt maakt de rij een store-rij; markt, bezoekers,
   productaantal en opmerking worden uit dezelfde rij gevist. */

const MARKETS = new Set(["USA", "UK", "AUS", "CANADA", "CAN", "NL/BE", "NLBE", "NL", "BE", "FR", "PL", "DE"]);
const MARKET_LANG = { "NL/BE": "nl", NL: "nl", BE: "nl", NLBE: "nl", FR: "fr", PL: "pl", DE: "de" };

function cleanDomain(v) {
  return String(v || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

const DOMAIN_RE = /^(https?:\/\/)?(www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i;

function parseNum(v) {
  const s = String(v ?? "").trim().replace(/\./g, "").replace(/,/g, "");
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

export function parseCompetitorRows(values) {
  const out = new Map(); // domein → record (dedupe, hoogste bezoek wint)
  for (const row of values) {
    if (!row || !row.length) continue;
    const cells = row.map((c) => String(c ?? "").trim());
    // domein zoeken (google.com e.d. overslaan)
    let domain = "";
    for (const c of cells) {
      if (!c || c.length > 60) continue;
      if (!DOMAIN_RE.test(c)) continue;
      const d = cleanDomain(c);
      if (!d || /(^|\.)google\.|docs\.|sheets\./.test(d)) continue;
      domain = d;
      break;
    }
    if (!domain) continue;

    let market = "";
    for (const c of cells) {
      const u = c.toUpperCase();
      if (MARKETS.has(u)) {
        market = u === "CAN" ? "CANADA" : u === "NLBE" || u === "NL" || u === "BE" ? "NL/BE" : u;
        break;
      }
    }

    // getallen: grootste = maandbezoek, kleinere = productaantal
    const nums = [];
    for (const c of cells) {
      const n = parseNum(c);
      if (n !== null && n > 0) nums.push(n);
    }
    nums.sort((a, b) => b - a);
    let visits = null;
    let products = null;
    if (nums.length >= 2) {
      visits = nums[0];
      products = nums[1];
    } else if (nums.length === 1) {
      if (nums[0] >= 5000) visits = nums[0];
      else products = nums[0];
    }

    // opmerking: tekstcel die geen naam/platform/land/domein is
    let note = "";
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i];
      if (!c || DOMAIN_RE.test(c) || parseNum(c) !== null) continue;
      if (MARKETS.has(c.toUpperCase()) || /^google$|^meta$/i.test(c)) continue;
      if (cleanDomain(c) === domain) continue;
      if (i === 0) break; // eerste cel = naam
      note = c;
      break;
    }

    const rec = { domain, market: market || "?", visits, products, note };
    const prev = out.get(domain);
    if (!prev || (rec.visits || 0) > (prev.visits || 0)) {
      // markten samenvoegen als dezelfde store in meer markten draait
      if (prev && prev.market && prev.market !== rec.market && prev.market !== "?") {
        rec.market = `${prev.market}+${rec.market}`;
      }
      out.set(domain, rec);
    } else if (prev && market && !prev.market.includes(market)) {
      prev.market = `${prev.market}+${market}`;
    }
  }
  return [...out.values()];
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action } = body;
  try {
    if (action === "parse") {
      const { sheetId, tab } = body;
      if (!sheetId || !String(tab || "").trim()) {
        return NextResponse.json({ error: "Sheet-link of bladnaam ontbreekt" }, { status: 400 });
      }
      const values = await readRange(sheetId, `'${String(tab).trim()}'!A1:Z500`);
      const stores = parseCompetitorRows(values || []);
      if (!stores.length) {
        return NextResponse.json({ error: `Geen stores herkend in "${tab}" — staat elke store-rij met een domein in de sheet?` }, { status: 400 });
      }
      const perMarket = {};
      for (const s of stores) perMarket[s.market] = (perMarket[s.market] || 0) + 1;
      return NextResponse.json({ ok: true, stores, perMarket });
    }

    if (action === "select") {
      const { stores, targetMarket, keywords, maxStores, totalProducts } = body;
      if (!Array.isArray(stores) || !stores.length) {
        return NextResponse.json({ error: "Geen stores om uit te kiezen" }, { status: 400 });
      }
      const max = Math.max(5, Math.min(60, Number(maxStores) || 25));

      /* Deterministische basis-ranking als vangnet én als voorwerk — met een
         HARDE marktmix. Zonder quota vulde de eigen markt (48 USA-stores bij
         max 25) alle plekken en kwam het buitenland er nooit in, terwijl
         juist dáár de producten zitten die de eigen markt nog niet verkoopt:
         ±60% eigen markt, ±25% andere Engelstalige markten, ±15%
         vertaal-markten (NL/BE, FR, PL, DE) — telkens de hoogste bezoekers. */
      const EN = new Set(["USA", "UK", "AUS", "CANADA"]);
      const inMarket = (s, m) => String(s.market || "").split("+").includes(m);
      const byVisits = (a, b) => (b.visits || 0) - (a.visits || 0);
      const same = stores.filter((s) => inMarket(s, targetMarket)).sort(byVisits);
      const enOther = stores
        .filter((s) => !inMarket(s, targetMarket) && EN.has(String(s.market).split("+")[0]))
        .sort(byVisits);
      const foreign = stores
        .filter((s) => !EN.has(String(s.market).split("+")[0]) && s.market !== "?")
        .sort(byVisits);
      const nSame = Math.round(max * 0.6);
      const nEn = Math.round(max * 0.25);
      const mix = [
        ...same.slice(0, nSame),
        ...enOther.slice(0, nEn),
        ...foreign.slice(0, Math.max(0, max - Math.min(nSame, same.length) - Math.min(nEn, enOther.length))),
      ];
      // ondervulling van een groep → aanvullen met de beste rest
      if (mix.length < max) {
        const chosen = new Set(mix.map((s) => s.domain));
        for (const s of [...same, ...enOther, ...foreign]) {
          if (mix.length >= max) break;
          if (!chosen.has(s.domain)) {
            chosen.add(s.domain);
            mix.push(s);
          }
        }
      }
      const baseline = mix.slice(0, max)
        .map((s) => ({ domain: s.domain, market: s.market, visits: s.visits, reason: "ranking op bezoek", lang: MARKET_LANG[String(s.market).split("+")[0]] || "en" }));

      try {
        const picks = await selectCompetitors(stores, {
          targetMarket: targetMarket || "USA",
          keywords: (keywords || []).slice(0, 25),
          maxStores: max,
          totalProducts: Number(totalProducts) || 0,
        });
        if (Array.isArray(picks) && picks.length) {
          const byDomain = new Map(stores.map((s) => [s.domain, s]));
          const enriched = picks
            .filter((p) => byDomain.has(cleanDomain(p.domain)))
            .map((p) => {
              const s = byDomain.get(cleanDomain(p.domain));
              return {
                domain: s.domain,
                market: s.market,
                visits: s.visits,
                reason: p.reason || "",
                lang: MARKET_LANG[String(s.market).split("+")[0]] || "en",
              };
            });
          if (enriched.length) return NextResponse.json({ ok: true, picks: enriched.slice(0, max), ai: true });
        }
      } catch {
        /* AI niet beschikbaar → deterministische ranking */
      }
      return NextResponse.json({ ok: true, picks: baseline, ai: false });
    }


    /* AUDIT — echte feiten per store i.p.v. alleen bezoekers uit de sheet.
       Levert per domein een score 0–100 en de zoekvolgorde (hoogste eerst):
         bezoek (sheet)        0–35  log-schaal, 1M/mnd = max
         best-selling geldig   +30   (onbekend +10, genegeerd 0)
         dekking producttypes  0–25  35% van de catalogus over jouw types = max
         valuta = doelmarkt    +10
         geslacht past niet    −20   (heren-run bij een winkel met <10% heren)
       Winkels die offline zijn of geen Shopify draaien krijgen 0. */
    if (action === "audit") {
      const { domains, types, targetMarket, genders, meta } = body;
      if (!Array.isArray(domains) || !domains.length) {
        return NextResponse.json({ error: "Geen stores om te checken" }, { status: 400 });
      }
      const CUR = { USA: "USD", UK: "GBP", AUS: "AUD", NZ: "NZD", CANADA: "CAD", "NL/BE": "EUR", FR: "EUR", DE: "EUR", PL: "PLN" };
      const wantCur = CUR[String(targetMarket || "").toUpperCase()] || null;
      const list = [...new Set(domains.map(cleanDomain).filter(Boolean))].slice(0, 60);
      const results = [];
      const queue = [...list];
      async function worker() {
        while (queue.length) {
          const d = queue.shift();
          let a;
          try {
            a = await auditStore(d, { types: types || [] });
          } catch (e) {
            a = { domain: d, ok: false, note: String(e.message || e) };
          }
          const m = (meta && meta[d]) || {};
          const visits = Number(m.visits) || 0;
          let score = 0;
          const why = [];
          if (a.ok) {
            const v = visits > 0 ? Math.min(35, Math.round((Math.log10(visits) / 6) * 35)) : 0;
            score += v;
            if (visits) why.push(`${Math.round(visits / 1000)}k/mnd`);
            if (a.bestSelling === "geldig") { score += 30; why.push(`best-selling geldig (${a.rankTotal})`); }
            else if (a.bestSelling === "onbekend") { score += 10; why.push("best-selling onbekend"); }
            else why.push("best-selling genegeerd door thema");
            const cov = Math.min(25, Math.round((a.coverage / 0.35) * 25));
            score += cov;
            why.push(`${Math.round(a.coverage * 100)}% dekking`);
            if (wantCur && a.currency === wantCur) { score += 10; why.push(a.currency); }
            else if (a.currency) why.push(a.currency);
            const g = Array.isArray(genders) ? genders : [];
            if (g.length === 1 && g[0] === "Man" && a.men < 0.1) { score -= 20; why.push("bijna geen heren"); }
            if (g.length === 1 && g[0] === "Vrouw" && a.women < 0.1) { score -= 20; why.push("bijna geen dames"); }
            score = Math.max(0, Math.min(100, score));
          } else {
            why.push(a.note || "onbereikbaar");
          }
          results.push({ ...a, visits, score, why: why.join(" · ") });
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
      results.sort((x, y) => y.score - x.score || (y.visits || 0) - (x.visits || 0));
      return NextResponse.json({ ok: true, audits: results });
    }

    if (action === "translate") {
      const { keywords, market } = body;
      if (!Array.isArray(keywords) || !keywords.length) {
        return NextResponse.json({ error: "Geen keywords" }, { status: 400 });
      }
      const map = await translateKeywordsForMarket(keywords.slice(0, 120), market);
      return NextResponse.json({ ok: true, map });
    }

    return NextResponse.json({ error: "Onbekende action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
