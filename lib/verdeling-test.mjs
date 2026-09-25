#!/usr/bin/env node
/* ============================================================================
   GOUDEN TESTSET voor de verdeling-engine.

   Waarom dit bestaat: elke losse fix in lib/verdeling.js is een regel die op
   woorden matcht, en die regels beïnvloeden elkaar. Zonder vangnet merk je
   pas drie runs later dat een fix iets anders sloopte — dat kostte in
   september een reeks runs achter elkaar.

   De set bevat elk keyword dat ooit in een echte run in de sheet stond
   (lib/verdeling-golden.json), met het verwachte antwoord: opgeschoonde
   titel, junk-reden, collectie, geslacht en canonieke vorm.

   Gebruik:
     node lib/verdeling-test.mjs           # draaien, faalt bij verschil
     node lib/verdeling-test.mjs --update  # nieuw gedrag vastleggen

   --update pas gebruiken NADAT je de verschillen hebt gelezen en ze allemaal
   verbeteringen zijn. Dat is het hele punt van de set.
   ========================================================================== */
import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

register("./_extless-loader.mjs", import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, "verdeling-golden.json");

const V = await import("./verdeling.js");

const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
const update = process.argv.includes("--update");
const verbose = process.argv.includes("--all");

function evaluate(kw, storeGenders = "MV") {
  const title = V.fixKeywordOrder(kw);
  // Zelfde volgorde als de engine: junk wordt op de opgeschoonde ÉN op de
  // rauwe tekst gecontroleerd, anders ontloopt een opschoning een junk-regel.
  const junk = V.isVerdelingJunk(title) || (title !== kw ? V.isVerdelingJunk(kw) : null) || null;
  if (junk) return { kw, title, junk, col: null, g: null, src: null, canon: null };
  const c = V.collectionFor(title, { storeGenders });
  return {
    kw,
    title,
    junk: null,
    col: c.col || null,
    g: c.g || null,
    src: c.gSrc || null,
    canon: V.canonKey(title, { storeGenders }),
  };
}

const FIELDS = ["title", "junk", "col", "g", "canon"];
const fresh = [];
const diffs = [];

for (const exp of golden.cases) {
  const got = evaluate(exp.kw, exp.storeGenders || "MV");
  if (exp.storeGenders) got.storeGenders = exp.storeGenders;
  fresh.push(got);
  const changed = FIELDS.filter((f) => (exp[f] ?? null) !== (got[f] ?? null));
  if (changed.length) diffs.push({ kw: exp.kw, changed, exp, got });
}

/* Invarianten: eigenschappen die ALTIJD moeten gelden, ongeacht welke
   keywords er in de set zitten. Een nieuwe regel die hier tegenaan loopt is
   per definitie fout, ook als de golden-set ermee zou kunnen leven. */
const invariants = [
  ["volgorde is idempotent", () =>
    golden.cases.every((c) => V.fixKeywordOrder(V.fixKeywordOrder(c.kw)) === V.fixKeywordOrder(c.kw))],
  ["canon is volgorde-onafhankelijk", () => {
    const k = (x) => V.canonKey(x, { storeGenders: "MV" });
    return k("baggy cargo shorts") === k("cargo baggy shorts") && k("black maxi dress") === k("maxi black dress");
  }],
  ["geslacht is volgorde-onafhankelijk", () => {
    const g = (x) => V.genderOf(x, "MV");
    return g("baggy cargo shorts") === g("cargo baggy shorts") && g("polo jersey shirt") === g("jersey polo shirt");
  }],
  ["schoenwoord achteraan draait niet om", () =>
    V.fixKeywordOrder("dress shoes") === "dress shoes" && V.fixKeywordOrder("dress boots") === "dress boots"],
  ["geen lege of kale titel", () =>
    golden.cases.every((c) => {
      const t = V.fixKeywordOrder(c.kw);
      return t.length > 1 && !/^(mens|womens)$/.test(t);
    })],
  ["geslachtswoord staat vooraan", () =>
    golden.cases.every((c) => {
      const t = V.fixKeywordOrder(c.kw).split(" ");
      const i = t.findIndex((w) => /^(mens?|womens?|males?|females?|ladies|guys?)$/.test(w));
      return i <= 0;
    })],
  ["single-gender store kent geen tegengesteld geslacht", () =>
    golden.cases.every((c) => V.genderOf(V.fixKeywordOrder(c.kw), "M") === "M" || /\b(women|womens|ladies|lady|girls|female|maternity|bridal|bridesmaid)\b/.test(V.fixKeywordOrder(c.kw)))],
];

const failed = invariants.filter(([, fn]) => { try { return !fn(); } catch { return true; } });

if (update) {
  golden.cases = fresh.map((c, i) => ({ ...(golden.cases[i].storeGenders ? { storeGenders: golden.cases[i].storeGenders } : {}), ...c }));
  golden.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + "\n");
  console.log(`golden-set bijgewerkt: ${fresh.length} keywords, ${diffs.length} gewijzigd`);
}

if (verbose) for (const c of fresh) console.log(`${c.kw} → ${c.title} | ${c.junk || `${c.col}/${c.g} (${c.src})`}`);

if (!update) {
  for (const d of diffs) {
    console.log(`\n✗ ${d.kw}`);
    for (const f of d.changed) console.log(`    ${f}: ${JSON.stringify(d.exp[f] ?? null)} → ${JSON.stringify(d.got[f] ?? null)}`);
  }
}
for (const [name] of failed) console.log(`\n✗ INVARIANT: ${name}`);

const ok = diffs.length === 0 && failed.length === 0;
console.log(
  `\n${ok ? "OK" : "FOUT"} — ${golden.cases.length} keywords, ${diffs.length} verschil(len), ${failed.length} gebroken invariant(en)`
);
if (!ok && !update) {
  console.log("Zijn alle verschillen verbeteringen? Dan: node lib/verdeling-test.mjs --update");
  process.exit(1);
}
