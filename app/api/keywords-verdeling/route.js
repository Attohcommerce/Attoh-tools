import { NextResponse } from "next/server";
import { readRange, readColumnsBatch, addTab, appendRows, formatVerdelingTab, parseSheetId, a1Tab } from "@/lib/sheets";
import { buildVerdeling, keywordType, orderWindow, storeProfile } from "@/lib/verdeling";
import { classifyJunkKeywordsBatch, reviewVerdelingFinal, classifyUnknownTokens } from "@/lib/ai";
import { unknownFashionTokens } from "@/lib/brands";
import { getTabMarket } from "@/lib/kw-memory";

// 300s (Fluid Compute) — faalt de deploy hierop, zet 60 terug; het interne
// tijdsbudget rekent automatisch mee.
export const maxDuration = 300;

// Nederlandse maand-key → Engels token zoals in de sheet-koppen ("Jul 2025")
const MONTH_TOKEN = {
  jan: "jan", feb: "feb", mrt: "mar", apr: "apr", mei: "may", jun: "jun",
  jul: "jul", aug: "aug", sep: "sep", okt: "oct", nov: "nov", dec: "dec",
};

function colLetter(i) {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { sourceSheetId, sourceTab, targetSheetId, targetTab, genders: gendersIn, total, mode, storeUrl } = body;
  /* Venster altijd in TIJDSVOLGORDE (okt-nov-dec-jan, niet jan-okt-nov-dec)
     en markt/geslacht automatisch uit het store-profiel als ze ontbreken. */
  const months = orderWindow(body.months || []);
  const prof = storeProfile(storeUrl);
  const market = body.market || (prof && prof.market) || "";
  const genders = gendersIn || (prof && prof.genders) || "MV";

  if (!sourceSheetId || !String(sourceTab || "").trim()) {
    return NextResponse.json({ error: "Bron-sheet of bron-tabblad ontbreekt" }, { status: 400 });
  }
  if (!targetSheetId || !String(targetTab || "").trim()) {
    return NextResponse.json({ error: "Doel-sheet of bladnaam ontbreekt" }, { status: 400 });
  }
  if (!Array.isArray(months) || months.length !== 4) {
    return NextResponse.json({ error: "Kies precies 4 maanden" }, { status: 400 });
  }

  // Vercel kapt de functie op maxDuration af (→ HTTP 504). We bewaken de tijd
  // zelf: zware AI-controles worden overgeslagen zodra de klok krap wordt,
  // zodat je altijd een verdeling terugkrijgt i.p.v. een timeout.
  const T0 = Date.now();
  const msLeft = () => maxDuration * 1000 - 14000 - (Date.now() - T0);
  const skipped = [];

  try {
    const src = String(sourceTab).trim();

    /* ---- 0. MARKT-BEWAKING (heilig): is dit tabblad via stap 1 of het
            geheugen als een ANDERE markt geregistreerd, dan is elke verdeling
            erop verspild geld — hard weigeren i.p.v. waarschuwen. Bij een
            onbekend tabblad of een Redis-storing draait alles gewoon door. ---- */
    const knownMarket = await getTabMarket(sourceSheetId, src);
    if (knownMarket && market && knownMarket !== market) {
      return NextResponse.json(
        {
          error:
            `MARKT KLOPT NIET: "${src}" is geregistreerd als ${knownMarket}-batch, maar je draait deze verdeling op ${market}. ` +
            `Kies markt ${knownMarket}, of gebruik een ${market}-tabblad (zie het Geheugen-tabblad in de Keywords-module).`,
        },
        { status: 422 }
      );
    }

    /* ---- 1. kolommen vinden in het bron-tabblad ---- */
    const headerRows = await readRange(sourceSheetId, `${a1Tab(src)}!1:1`);
    const header = (headerRows[0] || []).map((h) => String(h || "").toLowerCase());
    if (!header.length) throw new Error(`Tabblad "${src}" is leeg`);

    const kwIdx = header.findIndex((h) => h.startsWith("keyword"));
    const avgIdx = header.findIndex((h) => h.startsWith("avg"));
    const monthIdx = months.map((m) => {
      const tok = MONTH_TOKEN[m] || m;
      const i = header.findIndex((h) => h.replace(/^searches:\s*/, "").startsWith(tok));
      if (i === -1) throw new Error(`Maandkolom "${m}" niet gevonden in "${src}"`);
      return i;
    });
    if (kwIdx === -1) throw new Error(`Kolom "Keyword" niet gevonden in "${src}"`);

    /* De maand NA het venster meelezen (als die in de sheet staat). Daarmee
       zien we of de vraag ná het venster doorloopt of instort — het verschil
       tussen "boots" (loopt door in december) en "homecoming dress" (dood na
       oktober). Zonder deze kolom kregen stervende zomerkeywords evenveel
       producten als stijgende winterkeywords. */
    const KEYS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
    const afterKey = KEYS[(KEYS.indexOf(months[3]) + 1) % 12];
    const afterTok = MONTH_TOKEN[afterKey] || afterKey;
    const nextIdx = header.findIndex((h) => h.replace(/^searches:\s*/, "").startsWith(afterTok));

    /* Alle maandkolommen (max de laatste 12) voor de AUTOMATISCHE
       seizoensherkenning: vraag in het venster t.o.v. het jaargemiddelde.
       Ontbreken ze, dan rekent de engine alleen met het woordenboek. */
    const MONTH_TOKS = Object.values(MONTH_TOKEN);
    const yearIdx = header
      .map((h, i) => ({ h: h.replace(/^searches:\s*/, ""), i }))
      .filter(({ h }) => MONTH_TOKS.some((t) => h.startsWith(t)))
      .map(({ i }) => i)
      .slice(-12);

    /* ---- 2. alleen de nodige kolommen lezen (bron kan tienduizenden rijen zijn) ---- */
    // Alle kolommen in ÉÉN batchGet-verzoek — minder roundtrips dan parallel
    // losse reads, en voorspelbaarder onder de Vercel-tijdslimiet.
    const useYear = yearIdx.length >= 6;
    const readIdx = [...new Set([kwIdx, avgIdx, ...monthIdx, nextIdx, ...(useYear ? yearIdx : [])].filter((i) => i >= 0))];
    const columns = await readColumnsBatch(sourceSheetId, src, readIdx);
    const nRows = columns[kwIdx].length;
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const rows = [];
    for (let r = 0; r < nRows; r++) {
      const kw = String(columns[kwIdx][r] || "").trim();
      if (!kw) continue;
      rows.push({
        kw,
        avg: avgIdx >= 0 ? num(columns[avgIdx][r]) : 0,
        months: monthIdx.map((i) => num(columns[i][r])),
        next: nextIdx >= 0 ? num(columns[nextIdx][r]) : null,
        year: useYear ? yearIdx.map((i) => num((columns[i] || [])[r])) : null,
      });
    }

    /* Venster-signaal: is de maand ná het venster in totaal GROTER dan de
       eerste venstermaand, dan kijkt het venster achteruit — de piek van het
       seizoen valt buiten beeld en de verdeling loopt achter de feiten aan. */
    let windowWarn = "";
    if (nextIdx >= 0) {
      let sumFirst = 0;
      let sumNext = 0;
      for (const r of rows) {
        sumFirst += r.months[0];
        sumNext += r.next || 0;
      }
      if (sumNext > sumFirst * 1.1) {
        windowWarn =
          `De maand ná je venster (${afterKey}) heeft in totaal MEER zoekvolume dan de eerste venstermaand (${months[0]}). ` +
          `Je producten gaan pas later live — schuif het venster een maand op (${months.slice(1).join("-")}-${afterKey}) voor een verdeling die op de piek mikt.`;
      }
    }

    /* ---- 3. verdeling berekenen ---- */
    /* Markt en store gaan nu ook de VERDEEL-ENGINE in, niet alleen de
       AI-prompt. Daar bepalen ze het halfrond (dus welk seizoen de gekozen
       maanden zijn), of een productsoort aan de beurt is of net voorbij, en
       of het evenement achter een gelegenheidskeyword binnen het venster
       valt. Zonder dit kreeg een Australische lente-store evenveel laarzen
       en truien als een Amerikaanse herfst-store. */
    const opts = {
      monthNames: months,
      genders: genders === "M" || genders === "V" ? genders : "MV",
      total: Math.max(1, Math.min(2000, Number(total) || 1000)),
      mode: mode === "focus" ? "focus" : "spread",
      market,
      storeUrl,
    };
    let result = buildVerdeling(rows, opts);

    /* ---- 4. AI-nacontrole op de geselecteerde keywords (vangt merken die
            door de statische lijst glippen) — faalt stil bij API-problemen ---- */
    let aiRemoved = [];
    const exclude = new Set();
    try {
      const items = result.rows.map((r, i) => ({ index: i, kw: r.kw }));
      const BATCH = 160;
      if (msLeft() < 12000) throw new Error("skip");
      for (let i = 0; i < items.length; i += BATCH) {
        const part = items.slice(i, i + BATCH);
        const removals = await classifyJunkKeywordsBatch(part, { market });
        for (const rem of removals) {
          const hit = items[rem.index];
          if (hit && part.some((p) => p.index === rem.index)) {
            exclude.add(hit.kw);
            aiRemoved.push(`${hit.kw} (${rem.reason || "junk"})`);
          }
        }
      }
      if (exclude.size) {
        result = buildVerdeling(rows, { ...opts, exclude });
      }
    } catch {
      skipped.push("merken-nacontrole");
    }

    /* ---- 4a-bis. ONBEKEND-WOORD-ZEEF: elk gekozen keyword dat een woord
            bevat dat niet in de mode-woordenschat staat, gaat langs een
            gerichte merk-check. Zo hoeft een merk niet vooraf bekend te
            zijn ("veja", "frye", "on") — onbekend = bewijslast omdraaien.
            Herhaalt tot er geen onbekende woorden meer in de selectie zitten. ---- */
    let unknownWarn = [];
    // Keywords die de AI dáádwerkelijk heeft beoordeeld en goedgekeurd.
    // Alles wat een onbekend woord bevat en hier NIET in staat, gaat er
    // sowieso uit — zie de harde poort hieronder.
    const cleared = new Set();
    try {
      for (let round = 0; round < 3; round++) {
        const suspects = result.rows
          .map((r) => ({ kw: r.kw, unknown: unknownFashionTokens(r.kw) }))
          .filter((s) => s.unknown.length && !cleared.has(s.kw));
        if (!suspects.length) break;
        if (msLeft() < 8000) {
          skipped.push("onbekend-woord-check");
          break;
        }
        let verdicts = [];
        try {
          verdicts = await classifyUnknownTokens(suspects);
        } catch {
          break; // niet goedkeuren; de harde poort ruimt ze straks op
        }
        const rejected = new Set(verdicts.map((v) => v.kw));
        for (const sp of suspects) if (!rejected.has(sp.kw)) cleared.add(sp.kw);
        const fresh = verdicts.filter((v) => !exclude.has(v.kw));
        if (!fresh.length) break;
        for (const v of fresh) {
          exclude.add(v.kw);
          aiRemoved.push(`${v.kw} (${v.reason})`);
        }
        result = buildVerdeling(rows, { ...opts, exclude });
      }
    } catch {
      /* zeef is een extra laag — de harde poort hieronder blijft gelden */
    }

    /* ---- 4a-ter. HARDE POORT: onbekend en niet goedgekeurd = eruit.
            Hiervoor bleef een onbekend woord staan met alleen een
            waarschuwing zodra de AI-check werd overgeslagen of faalde — zo
            kwamen timbs boots, sp5der hoodie, nikelab hoodie en bathing ape
            hoodie in de sheet. Een merk hoeft niet herkend te worden om
            geweerd te worden: niet-bewezen-mode is genoeg reden. ---- */
    {
      const stillUnknown = result.rows
        .map((r) => ({ kw: r.kw, unknown: unknownFashionTokens(r.kw) }))
        .filter((u) => u.unknown.length && !cleared.has(u.kw));
      if (stillUnknown.length) {
        for (const u of stillUnknown) {
          exclude.add(u.kw);
          aiRemoved.push(`${u.kw} (onbekend woord "${u.unknown.join("/")}" — niet goedgekeurd)`);
        }
        result = buildVerdeling(rows, { ...opts, exclude });
        unknownWarn = stillUnknown.map((u) => `${u.kw} (${u.unknown.join("/")})`);
      }
    }

    /* ---- 4b. Holistische eind-QA over de complete tabel (max 2 rondes):
            vangt wat alleen in samenhang opvalt — daarna herberekenen,
            zodat het budget naar het volgende beste keyword vloeit ---- */
    try {
      for (let round = 0; round < 2; round++) {
        if (msLeft() < 9000) {
          skipped.push("eind-QA");
          break;
        }
        const flagged = await reviewVerdelingFinal(
          result.rows.map((r) => ({ kw: r.kw, col: r.col, n: r.n, vol: r.season })),
          market,
          storeUrl,
          {
            months,
            seasons: result.windowSeasons || [],
            audience: result.storeProfile && result.storeProfile.audience,
          }
        );
        const fresh = flagged.filter((f) => result.rows.some((r) => r.kw === f.kw));
        if (!fresh.length) break;
        for (const f of fresh) {
          exclude.add(f.kw);
          aiRemoved.push(`${f.kw} (${f.reason})`);
        }
        result = buildVerdeling(rows, { ...opts, exclude });
      }
    } catch {
      /* eind-QA is een extra vangnet — zonder ook prima */
    }

    if (!result.rows.length) {
      throw new Error("Geen keywords over na filteren — controleer bron-tabblad en maanden");
    }

    /* ---- Dekking-waarschuwingen: een groep met maar 1-2 keywords betekent
            meestal dat de bron-CSV's die doelgroep amper dekken ---- */
    const warnings = [];
    if (windowWarn) warnings.push(windowWarn);
    if (!result.market) {
      warnings.push(
        "Geen markt gekozen — de verdeling rekent dan zonder halfrond, seizoen en verkoopagenda. Kies een markt voor een verdeling die op koopgedrag stuurt in plaats van op kaal zoekvolume."
      );
    }
    if (result.storeProfile && result.market && result.storeProfile.market !== result.market) {
      warnings.push(
        `${result.storeProfile.domain} staat bekend als een ${result.storeProfile.market}-store, maar je hebt markt ${result.market} gekozen. Klopt dat? De seizoensberekening draait nu op het verkeerde halfrond.`
      );
    }
    if (result.storeProfile && result.storeProfile.genders && result.storeProfile.genders !== opts.genders) {
      warnings.push(
        `${result.storeProfile.domain} is ingesteld als "${result.storeProfile.genders}"-store; je draait deze verdeling op "${opts.genders}".`
      );
    }
    if (result.stats && result.stats.artefact) {
      warnings.push(
        `${result.stats.artefact} artefact-frasen geweerd (fors volume, maar komen in geen enkel ander keyword voor — Planner-bundels, geen echte zoekvraag): ${(result.stats.artefactList || []).join(", ")}`
      );
    }
    if (result.blockedCollections && result.blockedCollections.length) {
      warnings.push(
        `Collecties bewust buiten deze store gehouden (past niet bij de positionering): ${result.blockedCollections.join(", ")}`
      );
    }
    if (skipped.length) {
      warnings.push(
        `Tijdslimiet bereikt — overgeslagen: ${[...new Set(skipped)].join(", ")}. De verdeling klopt, maar draai 'm nog eens (of met een kleiner bron-tabblad) voor de volledige AI-controle.`
      );
    }
    if (unknownWarn.length) {
      warnings.push(
        `Uit voorzorg verwijderd (onbekend woord, niet door de merk-check goedgekeurd): ${unknownWarn.join(", ")}. Staat hier een echt mode-keyword tussen, draai de verdeling dan nog eens — dan krijgt de AI-check wél de tijd.`
      );
    }
    if (result.stats && result.stats.marketWord) {
      warnings.push(
        `${result.stats.marketWord} keywords met Brits/Australisch jargon geweerd voor de USA-markt (jumpers, trainers, cord trousers, waistcoat …).`
      );
    }
    if (result.caps) {
      warnings.push(
        `Cap per keyword bij ${opts.total} producten: ${result.caps.perKeyword} (kale kop-termen zoals "mens shoes": ${result.caps.headTerm}).`
      );
    }
    /* GAT IN DE BRONDATA. Een collectie die volgens het seizoen juist NU aan
       de beurt is maar nul keywords kreeg, is bijna altijd een ontbrekende
       Keyword Planner-batch — geen rekenfout. In de Shapes-run van 25-9 zat
       zo 0 schoeisel en 5 stuks zwemkleding in een Australische zomerstore,
       en dat zag je nergens terug. */
    if (result.stats && result.stats.colSeason) {
      const got = new Set((result.collections || []).map((c) => c.col));
      const blockedSet = new Set([
        ...(body.blockCollections || []),
        ...((result.storeProfile && result.storeProfile.block) || []),
      ]);
      const missing = [
        ...Object.entries(result.stats.colSeason)
          .filter(([c, v]) => v >= 0.72 && !got.has(c) && !blockedSet.has(c))
          .map(([c]) => c),
        /* Collecties die niet één keyword haalden staan niet in colSeason —
           de engine levert ze apart aan, anders blijft juist het grootste
           gat onzichtbaar (Shapes 25-9: geen enkele sandaal of schoen). */
        ...(result.stats.missingCore || []).filter((c) => !got.has(c) && !blockedSet.has(c)),
      ].filter((c, i, a) => a.indexOf(c) === i);
      if (missing.length) {
        warnings.push(
          `GAT IN DE BRONDATA — deze collecties zijn in dit venster juist in seizoen maar kregen NUL keywords: ${missing.join(", ")}. Dat is geen rekenfout: er zitten geen zoektermen voor in je bron-tabblad. Draai er een extra Keyword Planner-batch op en voeg die toe aan de all-batch.`
        );
      }
      const thin = (result.collections || [])
        .filter((c) => (result.stats.colSeason[c.col] || 0) >= 0.72 && c.kws <= 1)
        .map((c) => `${c.col} (${c.kws} keyword, ${c.products} producten)`);
      if (thin.length) {
        warnings.push(
          `Dun in seizoen — deze collecties staan op één zoekterm terwijl ze nu wél aan de beurt zijn: ${thin.join(", ")}. De cap per keyword is hier automatisch gehalveerd; meer zoektermen geeft pas echt assortiment.`
        );
      }
    }
    if (opts.genders === "MV") {
      const mKws = result.rows.filter((r) => r.g === "M").length;
      const vKws = result.rows.filter((r) => r.g === "V").length;
      if (mKws > 0 && mKws < 3) {
        warnings.push(
          `Herenkant rust op maar ${mKws} keyword(s) — je CSV's bevatten weinig heren-zoektermen. Draai een aparte heren-batch in Keyword Planner, of zet de doelgroep op Vrouw.`
        );
      }
      if (vKws > 0 && vKws < 3) {
        warnings.push(`Damenkant rust op maar ${vKws} keyword(s) — bron-data dekt vrouwen amper.`);
      }
      const mProd = result.rows.filter((r) => r.g === "M").reduce((a, r) => a + r.n, 0);
      const share = result.totalProducts ? Math.round((mProd / result.totalProducts) * 100) : 0;
      const tgt = (result.stats && result.stats.menTarget) || 40;
      if (share < tgt - 5) {
        warnings.push(
          `Heren ${share}% van de producten (doel ${tgt}%) — er zijn te weinig bruikbare heren-keywords in dit tabblad. Draai in Keyword Planner een extra heren-batch (mens shorts, mens linen shirt, board shorts, mens slides …) en voeg die toe aan de all-batch.`
        );
      }
    }
    if (!body.market && market) {
      warnings.push(`Markt automatisch op ${market} gezet vanuit het store-profiel.`);
    }
    if (Array.isArray(body.months) && body.months.join("-") !== months.join("-")) {
      warnings.push(`Venster in tijdsvolgorde gezet: ${months.join("-")} (was ${body.months.join("-")}).`);
    }

    /* ---- 5. wegschrijven: tabel (A-H) + collectie-overzicht (J-M) ---- */
    const t = await addTab(targetSheetId, String(targetTab).trim());
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: 422 });

    const label = months.join("-");
    // Kolom I = Type: stuurt de werkwijze van de scraper én de titelvorm bij
    // het importeren. A-H blijft ongewijzigd zodat bestaande lezers werken.
    /* Het storegeslacht hoort ÉÉN keer vastgelegd te worden en daarna
       automatisch mee te reizen. Het staat daarom in de kop van kolom D:
       "Groep — alleen heren". De scraper leest die kop al (hij controleert of
       hij met "groep" begint) en weet zo zonder extra instelling dat elk
       keyword in dit blad heren is — ook keywords zonder het woord "mens".
       Zo kan er in geen enkele vervolgstap het verkeerde geslacht op de site
       belanden. */
    const gLabel =
      opts.genders === "M" ? "Groep — alleen heren"
      : opts.genders === "V" ? "Groep — alleen dames"
      : "Groep";
    const left = [
      ["Rank", "Keyword", "Collectie", gLabel, "Avg. volume", `Volume ${label}`, "Piekmaand", "Aantal producten", "Type"],
      ...result.rows.map((r) => [r.rank, r.kw, r.col, r.g, r.avg, r.season, r.peak, r.n, keywordType(r.kw)]),
    ];
    const right = [
      ["Collectie", "Aantal keywords", "Aantal producten", "Top keywords"],
      ...result.collections.map((c) => [c.col, c.kws, c.products, c.top.join(", ")]),
    ];
    /* Diagnose-blok (P-Q): wat de AI schrapte, waarschuwingen en de trechter.
       Stond tot nu toe alleen in de vluchtige run-log — onzichtbaar zodra je
       de sheet later terugkijkt, terwijl juist DAAR de vraag "waarom staat
       mens sneakers er niet in?" beantwoord wordt. */
    const st = result.stats || {};
    const diag = [["Diagnose", ""]];
    diag.push([
      "Store-geslacht",
      opts.genders === "M"
        ? "Alleen heren (M) — elk keyword zonder vrouw-woord telt als heren; scraper en importer nemen dit over uit de kop van kolom D."
        : opts.genders === "V"
        ? "Alleen dames (V) — elk keyword zonder heren-woord telt als dames; scraper en importer nemen dit over uit de kop van kolom D."
        : "Unisex (M+V) — het geslacht wordt per keyword bepaald en staat per rij in kolom D.",
    ]);
    if (st.colSeason && Object.keys(st.colSeason).length) {
      const top = Object.entries(st.colSeason).sort((a, b) => b[1] - a[1]);
      diag.push([
        "Seizoen (auto)",
        `${months.join("-")}${st.season && st.season !== "n.v.t." ? ` = ${st.season}` : ""} · ${st.dataSeason ? `${st.dataSeason} keywords met jaardata` : "geen jaardata — alleen woordenboek"} · in seizoen: ${top.filter((x) => x[1] >= 0.72).map((x) => x[0]).join(", ") || "—"} · uit seizoen: ${top.filter((x) => x[1] < 0.45).map((x) => x[0]).join(", ") || "—"}`,
      ]);
    }
    if (opts.genders === "MV") {
      const mProd = result.rows.filter((r) => r.g === "M").reduce((a, r) => a + r.n, 0);
      diag.push(["Man/vrouw", `heren ${mProd} · dames ${result.totalProducts - mProd} producten (doel heren ${st.menTarget || 40}%)`]);
    }
    diag.push(["Trechter", `${st.input || 0} rijen → junk ${st.junk || 0} · te weinig volume ${st.lowSeason || 0} · geen collectie ${st.unmapped || 0} · ander geslacht ${st.genderSkip || 0} · buiten seizoen ${st.offSeason || 0} · markt-jargon ${st.marketWord || 0} · na dedupe ${st.afterDedupe || 0} · gekozen ${result.rows.length}`]);
    for (const w of warnings) diag.push(["Let op", w]);
    for (const d of result.droppedCollections || []) diag.push(["Weggelaten collectie", d]);
    for (const a of aiRemoved) diag.push(["AI verwijderde", a]);
    const nOut = Math.max(left.length, right.length, diag.length);
    const values = [];
    const padLeft = ["", "", "", "", "", "", "", "", ""];
    const padRight = ["", "", "", ""];
    for (let i = 0; i < nOut; i++) {
      values.push([...(left[i] || padLeft), "", ...(right[i] || padRight), "", ...(diag[i] || [])]);
    }
    await appendRows(targetSheetId, `${a1Tab(t.title)}!A1`, values, "RAW");
    await formatVerdelingTab(targetSheetId, t.tabId, left.length, 9, 17);

    const id = parseSheetId(targetSheetId);
    return NextResponse.json({
      ok: true,
      url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${t.tabId}`,
      title: t.title,
      tabId: t.tabId,
      keywordCount: result.rows.length,
      totalProducts: result.totalProducts,
      collections: result.collections.map(({ col, kws, products }) => ({ col, kws, products })),
      droppedCollections: result.droppedCollections || [],
      mode: result.mode,
      market: result.market,
      windowSeasons: result.windowSeasons || [],
      aiRemoved,
      warnings,
      stats: result.stats,
    });
  } catch (e) {
    // Stack naar de Vercel-runtime-log: de UI krijgt alleen de (geminifieerde)
    // melding — "e.replace is not a function" zei niets over wáár het misging.
    console.error("[keywords-verdeling]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
