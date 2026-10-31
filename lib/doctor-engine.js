/* STORE DOCTOR — run-motor voor de browser (31-10-2026).
   Eén plek voor alles wat met de server praat, gedeeld door het
   Store Doctor-paneel (één store) en "Alle stores" (alle stores achter
   elkaar). Hier zit GEEN UI: alles meldt zich via hooks, zodat elk scherm
   zijn eigen dashboard kan tonen.

   Waarom dit bestand bestaat: FIX ALLES stopte vaak met een rode
   "Unexpected token … is not valid JSON"-melding. Dat is Vercel's
   HTML-foutpagina bij een time-out (of een 502/504 van de gateway) in
   plaats van ons JSON-antwoord. Elke call loopt nu via postJSON:
   - geen JSON / 502 / 503 / 504 / netwerkfout → rustig opnieuw proberen
   - fixes en AI-checks: daarna de stap halveren, tot één product; lukt
     ook dat niet, dan wordt alleen dát product overgeslagen
   - een échte fout (JSON met error, bv. geen API-key) stopt alleen die
     ene stap; FIX ALLES gaat door met de volgende en zet het in het verslag. */

export const FIXALL_ORDER = [
  "relink-photos",
  "fix-gender-from-title",
  "translate-options",
  "clean-size-labels",
  "convert-sizes",
  "shoe-us-eu-labels",
  "unify-variant-prices",
  "clear-barcodes",
  "set-vendor",
  "set-product-type",
  "set-sw-type", // alleen Shapes Wardrobe: type uit de lijst van Cas
  "set-category",
  "fill-category-attrs", // na de categorie: de velden hangen van de categorie af
  "fill-alt",
  "fix-size-order",
  "fix-men-template",
  "fix-women-template",
  "publish-products",
  "fix-compareat",
  "clean-titles",
  "fix-size-guides",
  "tidy-size-guides", // ná het herbouwen: hele getallen + geen dubbele US-kolom
  "theme-round-size-guide", // maattabel-snippet in het thema op hele getallen (met backup-kopie)
];

// Plukje per AI-call (server verwerkt per call precies dit aantal)
export const AI_CHUNK = { "photo-audit": 5, gender: 6, language: 25, "color-photo": 8, watermark: 4, sample: 12 };
// Ruwe kostenraming per product (haiku-tarieven)
export const AI_EST = { "photo-audit": 0.003, gender: 0.002, language: 0.0007, "color-photo": 0.002, watermark: 0.004 };
export const AI_LABEL = {
  "photo-audit": "Foto-audit (geslacht + collectie)",
  gender: "Geslacht-check",
  language: "AI-taalcheck",
  "color-photo": "Kleur ↔ foto",
  watermark: "Watermerk-check",
  sample: "AI-steekproef",
};

/** Geschatte AI-kosten van FIX ALLES voor n producten */
export function aiEstimate(n) {
  const per = AI_EST["photo-audit"] + AI_EST.gender + AI_EST.language + AI_EST.watermark + AI_EST["color-photo"];
  return n > 0 ? n * per + 0.05 : 0;
}

// Valuta → markt (fallback als er geen profiel/keuze is)
export const CUR_MARKET = { USD: "USA", GBP: "UK", AUD: "AUS+NZ", NZD: "AUS+NZ", CAD: "CAN" };
// STORE_PROFILES-markt → Doctor-markt
export const PROFILE_MARKET = { USA: "USA", UK: "UK", AUS: "AUS+NZ", "AUS+NZ": "AUS+NZ", CAN: "CAN" };
export const MARKET_CURRENCY = { USA: ["USD"], UK: ["GBP"], "AUS+NZ": ["AUD", "NZD"], CAN: ["CAD"] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GATEWAY = [502, 503, 504];
// AI-fouten die bij een volgende poging of een kleiner plukje meestal wél lukken
const AI_SOFT = /geen bruikbare json|overloaded|rate.?limit|\b529\b|time-?out|unable to download|internal server error|econnreset|socket|fetch failed|network/i;
// AI-fouten waar opnieuw proberen niets aan verandert
const AI_HARD = /api.?key|credit balance|authentication|permission|unauthori[sz]ed|ontbreekt|invalid x-api-key|billing/i;

/** Titel zegt expliciet Men's of Women's? → "Men" | "Women" | null */
export function titleSex(title) {
  const t = String(title || "");
  if (/\b(women'?s|womens|ladies)\b/i.test(t)) return "Women";
  if (/\b(men'?s|mens)\b/i.test(t)) return "Men";
  return null;
}

/**
 * postJSON(url, body, { tries, onRetry }) → { ok, status, data, error, timeout }
 * timeout=true: de server gaf geen bruikbaar antwoord (Vercel-time-out,
 * gateway-fout of netwerk) — ook na alle pogingen.
 */
export async function postJSON(url, body, opts = {}) {
  const tries = Math.max(1, opts.tries || 3);
  let why = "";
  for (let a = 1; a <= tries; a++) {
    let r = null;
    let data = null;
    try {
      r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await r.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
    } catch (e) {
      why = `geen verbinding (${String((e && e.message) || e).slice(0, 60)})`;
    }
    if (r && data && r.ok) return { ok: true, status: r.status, data };
    if (r && data && !r.ok && !GATEWAY.includes(r.status)) {
      return { ok: false, status: r.status, data, error: data.error || `HTTP ${r.status}` };
    }
    if (r) why = GATEWAY.includes(r.status) || r.status >= 500 ? `server-time-out (HTTP ${r.status})` : "server gaf geen geldig antwoord (time-out)";
    if (a < tries) {
      if (opts.onRetry) opts.onRetry(a, why);
      await sleep(1200 * a);
    }
  }
  return { ok: false, timeout: true, error: `${why} — ${tries}× geprobeerd` };
}

/**
 * scanStore(storeBody, params, { onRetry }) → rapport (zelfde vorm als /api/doctor-scan)
 * Lukt de volle scan niet binnen de tijd, dan nog één keer "licht" (zonder
 * fijne categorieën en thema-check) — beter een rapport dan een rode fout.
 */
export async function scanStore(storeBody, params, hooks = {}) {
  const body = { store: storeBody, ...params };
  let res = await postJSON("/api/doctor-scan", body, { tries: 3, onRetry: hooks.onRetry });
  if (!res.ok && res.timeout) {
    if (hooks.onRetry) hooks.onRetry(0, "scan te zwaar voor één stap — nu zonder fijne categorieën en thema-check");
    res = await postJSON("/api/doctor-scan", { ...body, light: true }, { tries: 2, onRetry: hooks.onRetry });
  }
  if (!res.ok) throw new Error(`Scan mislukt: ${res.error}`);
  return res.data;
}

/**
 * runFixLoop — één fix over een id-lijst, in stappen tot klaar.
 * opts: { options, backup, skipBackup, onProgress(tot), onNotes(lines), shouldStop() }
 * → tot { done, total, fixed, skipped, failed, stopped }
 */
export async function runFixLoop(storeBody, fix, ids, opts = {}) {
  const tot = { done: 0, total: ids.length, fixed: 0, skipped: 0, failed: 0, stopped: false };
  const report = () => opts.onProgress && opts.onProgress({ ...tot });
  const notes = (lines) => lines && lines.length && opts.onNotes && opts.onNotes(lines);
  report();
  let cursor = 0;
  let chunk = null; // null = server-standaard
  let gateway = 0;
  let okStreak = 0;
  while (cursor < ids.length) {
    if (opts.shouldStop && opts.shouldStop()) {
      tot.stopped = true;
      break;
    }
    const res = await postJSON(
      "/api/doctor-fix",
      { store: storeBody, fix: fix.id, ids, options: opts.options || {}, cursor, backup: opts.backup || null, skipBackup: !!opts.skipBackup, chunk },
      { tries: 2, onRetry: (a, why) => notes([`${why} — opnieuw (${a + 1}/2)`]) }
    );
    if (!res.ok && res.timeout) {
      gateway++;
      if (gateway > 40) throw new Error("de server blijft time-outen — later opnieuw proberen");
      okStreak = 0;
      const cur = chunk || 8;
      if (cur > 1) {
        chunk = Math.max(1, Math.floor(cur / 2));
        notes([`server-time-out — stap verkleind naar ${chunk} product(en), zelfde plek opnieuw`]);
        continue;
      }
      tot.failed += 1;
      notes([`product ${ids[cursor]}: time-out ook als losse stap — overgeslagen`]);
      cursor += 1;
      tot.done = cursor;
      report();
      continue;
    }
    if (!res.ok) throw new Error(res.error);
    const d = res.data;
    // na 3 goede stappen het verkleinde plukje weer laten groeien (time-outs zijn vaak tijdelijk)
    if (chunk) {
      okStreak++;
      if (okStreak >= 3) {
        okStreak = 0;
        chunk = chunk * 2 >= 8 ? null : chunk * 2;
      }
    }
    tot.fixed += d.fixed || 0;
    tot.failed += d.failed || 0;
    tot.skipped += d.skipped || 0;
    tot.done = d.nextCursor != null ? d.nextCursor : tot.total;
    notes(d.notes);
    report();
    if (d.done) break;
    if (d.nextCursor == null || d.nextCursor <= cursor) cursor += Math.max(1, d.processed || 1);
    else cursor = d.nextCursor;
  }
  return tot;
}

/**
 * runAiLoop — één AI-check in plukjes. Bij time-outs wordt het plukje
 * gehalveerd; een product dat ook alleen niet lukt, wordt overgeslagen.
 * opts: { onProgress(done, total), onResults(all, usd), onNote(text), shouldStop() }
 */
export async function runAiLoop(storeBody, check, idsAll, opts = {}) {
  let ids = idsAll || [];
  if (check === "sample") {
    const step = Math.max(1, Math.floor(ids.length / 12));
    ids = ids.filter((_, i) => i % step === 0).slice(0, 12);
  }
  const all = [];
  let usd = 0;
  let skipped = 0;
  const CHUNK_MAX = AI_CHUNK[check] || 8;
  let chunk = CHUNK_MAX;
  let okStreak = 0;
  let i = 0;
  let gateway = 0;
  let again = 0; // zelfde plukje nog één keer bij een "zachte" AI-fout
  const lbl = AI_LABEL[check] || check;
  while (i < ids.length) {
    if (opts.shouldStop && opts.shouldStop()) break;
    const part = ids.slice(i, i + chunk);
    if (opts.onProgress) opts.onProgress(Math.min(i + part.length, ids.length), ids.length);
    const res = await postJSON("/api/doctor-ai", { store: storeBody, check, ids: part }, { tries: 2 });
    const soft = !res.ok && (res.timeout || (!AI_HARD.test(res.error || "") && (AI_SOFT.test(res.error || "") || res.status >= 500)));
    if (soft) {
      okStreak = 0;
      gateway++;
      if (gateway > 60) throw new Error(`${lbl}: de AI blijft haperen (${res.error})`);
      if (!res.timeout && again < 1) {
        again++;
        await sleep(1500);
        continue;
      }
      again = 0;
      if (chunk > 1) {
        chunk = Math.max(1, Math.floor(chunk / 2));
        if (opts.onNote) opts.onNote(`${lbl}: ${res.timeout ? "time-out" : String(res.error || "").slice(0, 60)} — plukje verkleind naar ${chunk}`);
        continue;
      }
      // ook als losse stap niet te doen: dit ene product overslaan
      skipped += part.length;
      if (opts.onNote) opts.onNote(`${lbl}: product ${part[0]} overgeslagen (${res.timeout ? "time-out" : String(res.error || "").slice(0, 60)})`);
      i += part.length;
      continue;
    }
    if (!res.ok) throw new Error(res.error);
    again = 0;
    if (chunk < CHUNK_MAX && ++okStreak >= 3) {
      okStreak = 0;
      chunk = Math.min(CHUNK_MAX, chunk * 2);
    }
    all.push(...(res.data.results || []));
    usd += res.data.aiUsd || 0;
    if (opts.onResults) opts.onResults([...all], usd);
    i += part.length;
  }
  if (opts.onProgress) opts.onProgress(ids.length, ids.length);
  return { results: all, usd, skipped, total: ids.length };
}

/**
 * fixAllStore — FIX ALLES voor één store, in vaste volgorde:
 *   1. scan (of het meegegeven verse rapport)
 *   2. alle veilige fixes (FIXALL_ORDER) — nooit verwijderen
 *   3. AI-controles (optioneel): foto-audit → misgenderd archiveren +
 *      verkeerde collecties; geslacht → tags rechtzetten; taal, watermerk,
 *      kleur↔foto en steekproef alleen melden
 *   4. eindscan + open beslissingen
 * Eén mislukte stap stopt de run niet: die komt in het verslag (V.errors).
 *
 * ctx: { storeBody, scanParams, fixOptions(extra), backupFor(fixId), skipBackup,
 *        withAi, sizeGuides, report (vers rapport hergebruiken), hooks }
 * hooks: phase(key, label) · report(rep) · fixStart(fix, n, i, of) → handle ·
 *        fixProgress(handle, tot) · fixNotes(handle, lines) · fixDone(handle, tot, err) ·
 *        aiStart(check, n) · aiProgress(check, done, total) · aiResults(check, all, usd) ·
 *        aiDone(check, out, err) · log(text, kind) · retry(n, why) · shouldStop()
 */
export async function fixAllStore(ctx) {
  const h = {
    phase() {}, report() {}, fixStart() { return null; }, fixProgress() {}, fixNotes() {}, fixDone() {},
    aiStart() {}, aiProgress() {}, aiResults() {}, aiDone() {}, log() {}, retry() {}, shouldStop: () => false,
    ...(ctx.hooks || {}),
  };
  const V = { auto: [], ai: [], open: [], errors: [], usd: 0, paused: false, before: null, after: null };
  const stop = () => !!h.shouldStop();
  const scanParams = ctx.scanParams || {};

  // 1. SCAN
  let report = ctx.report || null;
  if (!report) {
    h.phase("scan", "Producten scannen");
    report = await scanStore(ctx.storeBody, scanParams, { onRetry: (n, why) => h.retry(n, why) });
  }
  h.report(report);
  V.before = report.stats ? { ...report.stats } : null;

  // één fix draaien met nette hooks; fouten stoppen alleen deze fix
  async function doFix(fix, ids, options, i, of) {
    const handle = h.fixStart(fix, ids.length, i, of);
    try {
      const tot = await runFixLoop(ctx.storeBody, fix, ids, {
        options,
        backup: ctx.skipBackup ? null : ctx.backupFor ? ctx.backupFor(fix.id) : null,
        skipBackup: !!ctx.skipBackup,
        onProgress: (t) => h.fixProgress(handle, t),
        onNotes: (lines) => h.fixNotes(handle, lines),
        shouldStop: stop,
      });
      h.fixDone(handle, tot, null);
      return tot;
    } catch (e) {
      const msg = String((e && e.message) || e);
      h.fixDone(handle, null, msg);
      V.errors.push(`${fix.label}: ${msg}`);
      return { done: 0, total: ids.length, fixed: 0, skipped: 0, failed: ids.length, error: msg };
    }
  }

  // 2. VEILIGE FIXES
  if (!stop()) {
    h.phase("fixes", "Veilige fixes");
    const jobs = new Map();
    for (const f of report.findings || []) {
      for (const fx of f.fixes || []) {
        if (!FIXALL_ORDER.includes(fx.id)) continue;
        if (ctx.sizeGuides === false && /size-guide/.test(fx.id)) continue;
        if (!jobs.has(fx.id)) jobs.set(fx.id, { fix: fx, ids: new Set() });
        for (const id of f.ids || []) jobs.get(fx.id).ids.add(id);
      }
    }
    const order = FIXALL_ORDER.filter((id) => jobs.has(id));
    if (!order.length) h.log("Geen veilige fixes nodig", "ok");
    for (let i = 0; i < order.length; i++) {
      if (stop()) break;
      const j = jobs.get(order[i]);
      const tot = await doFix(j.fix, [...j.ids], ctx.fixOptions(), i + 1, order.length);
      V.auto.push({ label: j.fix.label, fixed: tot.fixed, skipped: tot.skipped, failed: tot.failed, error: tot.error || "" });
    }
  }

  // 3. AI-CONTROLES
  let allIds = report.productIds || [];
  async function doAi(check) {
    h.aiStart(check, check === "sample" ? Math.min(12, allIds.length) : allIds.length);
    try {
      const out = await runAiLoop(ctx.storeBody, check, allIds, {
        onProgress: (d, t) => h.aiProgress(check, d, t),
        onResults: (all, usd) => h.aiResults(check, all, usd),
        onNote: (t) => h.log(t, "warn"),
        shouldStop: stop,
      });
      V.usd += out.usd;
      h.aiDone(check, out, null);
      return out;
    } catch (e) {
      const msg = String((e && e.message) || e);
      V.errors.push(`${AI_LABEL[check] || check}: ${msg}`);
      h.aiDone(check, null, msg);
      return null;
    }
  }
  if (ctx.withAi && !stop() && allIds.length) {
    h.phase("ai", "AI-controles");
    const pa = await doAi("photo-audit");
    if (pa) {
      const mis = pa.results.filter((m) => m.kind === "gender");
      const fitList = pa.results.filter((m) => m.kind === "fit" && !mis.some((x) => x.id === m.id));
      if (mis.length && !stop()) {
        const tot = await doFix({ id: "archive-products", label: "Misgenderde producten eruit (archiveren)" }, mis.map((m) => m.id), ctx.fixOptions(), 1, 1);
        V.ai.push(`Foto-audit: ${mis.length} misgenderd product(en) → ${tot.fixed} gearchiveerd (terug te zetten via Products → Archived)`);
        const gone = new Set(mis.map((m) => String(m.id)));
        allIds = allIds.filter((id) => !gone.has(String(id)));
      }
      if (fitList.length && !stop()) {
        const fit = {};
        for (const m of fitList) fit[String(m.id)] = { drop: m.drop, add: m.add };
        const tot = await doFix({ id: "fix-collection-fit", label: "Uit verkeerde collecties halen" }, fitList.map((m) => m.id), ctx.fixOptions({ fit }), 1, 1);
        V.ai.push(`Foto-audit: ${fitList.length} product(en) in een verkeerde collectie → ${tot.fixed} rechtgezet`);
      }
      if (!mis.length && !fitList.length) V.ai.push("Foto-audit: geslacht en collecties kloppen met de foto's");
      if (pa.skipped) V.ai.push(`Foto-audit: ${pa.skipped} product(en) niet gecontroleerd (AI haperde)`);
    }
    if (!stop() && allIds.length) {
      const g = await doAi("gender");
      if (g && g.skipped) V.ai.push(`Geslacht: ${g.skipped} product(en) niet gecontroleerd (AI haperde)`);
      if (g && g.results.length && !stop()) {
        /* VEILIGHEID (31-10): automatisch alleen als de titel het niet tegenspreekt
           (tags fout, dubbele Men+Women, titel zonder geslacht). Zegt de titel
           expliciet het andere geslacht ("Men's Cargo Pants" → AI zegt Women), dan
           NIET zelf omzetten — de strenge foto-audit hierboven was er niet zeker
           genoeg van. Die komen bij "Voor jou om te beslissen". */
        const safe = g.results.filter((m) => {
          const ts = titleSex(m.title);
          return !ts || ts === m.suggested;
        });
        const doubt = g.results.filter((m) => !safe.includes(m));
        if (safe.length) {
          const labels = {};
          for (const m of safe) labels[String(m.id)] = m.suggested;
          const tot = await doFix({ id: "gender-tags", label: "Gender-tags rechtzetten (AI)" }, safe.map((m) => m.id), ctx.fixOptions({ labels }), 1, 1);
          V.ai.push(`Geslacht: ${safe.length} product(en) met verkeerde of dubbele gender-tags → ${tot.fixed} rechtgezet`);
        }
        if (doubt.length) {
          V.ai.push(`Geslacht: ${doubt.length} product(en) waar de AI iets anders ziet dan de titel zegt — NIET automatisch aangepast`);
          V.open.push(`Geslacht twijfel (${doubt.length}): ${doubt.slice(0, 4).map((m) => `"${String(m.title).split("|")[0].trim()}" → ${m.suggested}?`).join(", ")}${doubt.length > 4 ? " …" : ""} — check de foto's; toepassen kan met de knop bij AI-controles → Geslacht`);
        }
        if (!safe.length && !doubt.length) V.ai.push("Geslacht: alle producten kloppen");
      } else if (g) {
        V.ai.push("Geslacht: alle producten kloppen (titel + omschrijving + foto)");
      }
    }
    const REST = [
      ["language", (n) => (n ? `AI-taalcheck: ${n} product(en) met vreemde taal — handwerk, lijst in het rapport` : "AI-taalcheck: alles Engels")],
      ["watermark", (n) => (n ? `Watermerk-check: ${n} foto('s) geflagd — verwijderen is jouw beslissing` : "Watermerk-check: schoon")],
      ["color-photo", (n) => (n ? `Kleur↔foto: ${n} afwijking(en) — lijst in het rapport` : "Kleur↔foto: klopt")],
      ["sample", (n) => (n ? `Steekproef: ${n} terugkerend patroon/patronen` : "Steekproef: geen terugkerende fouten")],
    ];
    for (const [check, line] of REST) {
      if (stop()) break;
      const out = await doAi(check);
      if (out) V.ai.push(line(out.results.length) + (out.skipped ? ` · ${out.skipped} product(en) niet gecontroleerd (AI haperde)` : ""));
    }
  }

  V.paused = stop();

  // 4. EINDSCAN + open beslissingen
  h.phase("final", "Eindscan");
  let fresh = null;
  try {
    fresh = await scanStore(ctx.storeBody, scanParams, { onRetry: (n, why) => h.retry(n, why) });
  } catch (e) {
    V.errors.push(`Eindscan: ${String((e && e.message) || e)}`);
  }
  if (fresh) {
    h.report(fresh);
    V.after = fresh.stats ? { ...fresh.stats } : null;
    const keepOpen = V.open.length;
    for (const f of fresh.findings || []) {
      const danger = (f.fixes || []).some((x) => x.danger);
      if (danger) V.open.push(`${f.title}: nog ${f.count} — verwijder-knop staat in het rapport; dat doe ik nooit automatisch`);
      else if (f.level === "error" && !f.soft) V.open.push(`${f.title}: nog ${f.count}`);
    }
    if (V.open.length === keepOpen && !keepOpen) V.open.push("Geen open fouten meer — loop hooguit de waarschuwingen na.");
  }
  h.phase("done", V.paused ? "Gepauzeerd" : "Klaar");
  return { verslag: V, report: fresh || report };
}
