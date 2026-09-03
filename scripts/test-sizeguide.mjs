// Unit-tests Size Guide-motor — draaien met:  node scripts/test-sizeguide.mjs
// (geen framework; elke regel is een case, groen = ✓, rood = ✗ + exit 1)
import {
  columnFor, parseCell, normalizeChart, normalizeSizeLabel, sizeSortKey, findSizeOption,
  euToMarket, alignRows, sanityCheck, scoreGuide, buildGuide, standardGuide, productSummary, formatCell,
  kindOf, columnsForKind, checkGuide,
} from "../lib/sizeguide.js";
import { parseSizeChartHtml, parseAliProductId, detectBlock } from "../lib/aliexpress.js";

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}\n    got:  ${g}\n    want: ${w}`);
  }
}
const ok = (name, cond) => eq(name, !!cond, true);

/* ---------- kolommen ---------- */
eq("col Size", columnFor("Size").key, "size");
eq("col EU Size", columnFor("EU Size").key, "eu");
eq("col US Size", columnFor("US Size").key, "us");
eq("col Bust", columnFor("Bust").key, "bust");
eq("col Chest", columnFor("Chest (cm)").key, "bust");
eq("col Sleeve Length → sleeve", columnFor("Sleeve Length").key, "sleeve");
eq("col Foot Length → foot", columnFor("Foot Length").key, "foot");
eq("col Pants Length → length_bottom", columnFor("Pants Length").key, "length_bottom");
eq("col Top Length → length_top", columnFor("Top Length").key, "length_top");
eq("col Dress Length → length", columnFor("Dress Length").key, "length");
eq("col Shoulder Width → shoulder", columnFor("Shoulder Width").key, "shoulder");
eq("col Heel Height → heel", columnFor("Heel Height").key, "heel");
eq("col Hips", columnFor("Hips").key, "hip");
eq("col Weight → mass", columnFor("Weight (kg)").kind, "mass");
eq("col NL Borstomvang", columnFor("Borstomvang").key, "bust");
eq("col onbekend", columnFor("Fabric").key, "x_fabric");

/* ---------- cellen ---------- */
eq("cell 84", parseCell("84"), { a: 84, b: null, text: "84" });
eq("cell 84-88 range", parseCell("84-88"), { a: 84, b: 88, text: "84-88" });
eq("cell 40/42 range", parseCell("40/42"), { a: 40, b: 42, text: "40/42" });
eq("cell 33,07 komma", parseCell("33,07").a, 33.07);
eq("cell leeg", parseCell("").a, null);

/* ---------- labels ---------- */
eq("label XXL → 2XL", normalizeSizeLabel("XXL"), "2XL");
eq("label xl", normalizeSizeLabel(" xl "), "XL");
eq("label US 8", normalizeSizeLabel("US 8"), "8");
eq("label 08/10", normalizeSizeLabel("08/10"), "8/10");
eq("label One size", normalizeSizeLabel("One Size"), "ONE SIZE");
eq("label S (US 4)", normalizeSizeLabel("S (US 4)"), "S");
ok("sort S < M < XL < 2XL", sizeSortKey("S") < sizeSortKey("M") && sizeSortKey("XL") < sizeSortKey("2XL"));
ok("sort 6 < 8", sizeSortKey("6") < sizeSortKey("8"));

/* ---------- product-maten ---------- */
const prodLetters = {
  id: 1, title: "Women's Ribbed Knit Sweater", tags: "Women, Sweaters", product_type: "Sweaters",
  options: [{ name: "Color" }, { name: "Size" }],
  variants: [
    { option1: "Black", option2: "S" }, { option1: "Black", option2: "M" }, { option1: "Black", option2: "L" },
    { option1: "Black", option2: "XL" }, { option1: "Black", option2: "XXL" }, { option1: "Beige", option2: "S" },
  ],
  images: [{ src: "https://cdn.shopify.com/a.jpg" }, { src: "https://cdn.shopify.com/b.jpg" }],
};
eq("findSizeOption Size-kolom", findSizeOption(prodLetters).values, ["S", "M", "L", "XL", "XXL"]);
const summ = productSummary(prodLetters);
eq("summary family/gender", [summ.family, summ.gender], ["clothing", "women"]);
eq("findSizeOption zonder Size-naam (heuristiek)", findSizeOption({ options: [{ name: "Maat/Kleur" }], variants: [{ option1: "S" }, { option1: "M" }] }).values, ["S", "M"]);
eq("findSizeOption Default Title → leeg", findSizeOption({ options: [{ name: "Title" }], variants: [{ option1: "Default Title", title: "Default Title" }] }).values, []);
eq("findSizeOption One Size", findSizeOption({ options: [{ name: "Title" }], variants: [{ option1: "One Size", title: "One Size" }] }).values, ["One Size"]);

/* ---------- EU → markt ---------- */
eq("EU 36 dames → US 4", euToMarket("36", "clothing", "women", "USA"), "4");
eq("EU 40/42 dames → US 8/10", euToMarket("40/42", "clothing", "women", "USA"), "8/10");
eq("EU 36 dames → AU 8", euToMarket("36", "clothing", "women", "AUS+NZ"), "8");
eq("EU 38 damesschoen → US 7", euToMarket("38", "shoes", "women", "USA"), "7");
eq("EU 43 herenschoen → US 10", euToMarket("43", "shoes", "men", "USA"), "10");
eq("EU 43 herenschoen → AU 9", euToMarket("43", "shoes", "men", "AUS+NZ"), "9");
eq("EU 50 herenjas → 40", euToMarket("50", "clothing", "men", "USA"), "40");
eq("EU onzin → null", euToMarket("abc", "clothing", "women", "USA"), null);
eq("EU buiten band → null", euToMarket("12", "clothing", "women", "USA"), null);

/* ---------- AliExpress-tabel (de live geziene structuur, inches) ---------- */
const aliHtml = `<html><head><title>Size chart</title></head><body>
<div class="size-chart-inner-v2--unit--1Ea5Rs9">CM</div><div class="size-chart-inner-v2--unit--1Ea5Rs9 size-chart-inner-v2--activated--RKsXYVv">IN</div>
<div class="chart-table--chart--1Cq4CEj"><table><thead><tr><th>Size</th><th>EU Size</th><th>Bust</th><th>Length</th></tr></thead>
<tbody><tr><td><strong>S</strong></td><td>36</td><td>33.07</td><td>22.44</td></tr>
<tr><td><strong>M</strong></td><td>38</td><td>34.65</td><td>22.44</td></tr>
<tr><td><strong>L</strong></td><td>40/42</td><td>36.22</td><td>22.83</td></tr>
<tr><td><strong>XL</strong></td><td>44</td><td>37.80</td><td>23.23</td></tr>
<tr><td><strong>XXL</strong></td><td>46</td><td>39.37</td><td>23.62</td></tr></tbody></table></div>
<p>The way the product is measured</p></body></html>`;
const parsed = parseSizeChartHtml(aliHtml);
eq("ali parse headers", parsed.headers, ["Size", "EU Size", "Bust", "Length"]);
eq("ali parse 5 rijen", parsed.rows.length, 5);
eq("ali parse rij L", parsed.rows[2], ["L", "40/42", "36.22", "22.83"]);
eq("ali unitHint IN", parsed.unitHint, "in");
eq("ali geen tabel → no_table", parseSizeChartHtml("<html><body>nothing</body></html>").reason, "no_table");
eq("block detect punish", detectBlock(200, "<html>" + "x".repeat(2000) + "_____tmd_____ punish</html>"), "slider/captcha-pagina");
eq("block detect ok", detectBlock(200, aliHtml + "x".repeat(2000)), null);
eq("pid uit item-url", parseAliProductId("https://www.aliexpress.com/item/1005005712746295.html?spm=a2g0o"), "1005005712746295");
eq("pid uit /i/-url", parseAliProductId("https://nl.aliexpress.com/i/1005005712746295.html"), "1005005712746295");
eq("pid uit kaal nummer", parseAliProductId("1005005712746295"), "1005005712746295");
eq("pid uit rommel → null", parseAliProductId("https://example.com/abc"), null);

const chart = normalizeChart({ headers: parsed.headers, rows: parsed.rows, unitHint: parsed.unitHint });
eq("chart unit in", chart.unit, "in");
eq("chart bust S → 84 cm", chart.rows[0].bust, 84);
eq("chart length XXL → 60 cm", chart.rows[4].length, 60);
eq("chart eu L", chart.rows[2].eu, "40/42");
eq("chart kolom-keys", chart.columns.map((c) => c.key), ["size", "eu", "bust", "length"]);

/* ---------- uitlijnen + build ---------- */
const al = alignRows(chart, ["S", "M", "L", "XL", "XXL"], { family: "clothing", gender: "women", market: "USA" });
eq("align 5/5 label-mode", [al.rows.length, al.missing.length, al.mode], [5, 0, "label"]);
eq("align marketSize L = 8/10", al.rows[2].marketSize, "8/10");

const built = buildGuide({ chart, product: summ, market: "USA", source: "aliexpress", confidence: 0.95 });
ok("build ok", built.ok);
eq("build verdict groen", built.verdict, "green");
eq("build kolommen (US-markt: geen EU)", built.guide.columns.map((c) => c.key), ["size", "us", "bust", "length"]);
eq("build rij XXL", built.guide.rows[4], { size: "XXL", us: "14", bust: 100, length: 60 });
eq("build status", built.guide.status, "aliexpress");
eq("build unit_default USA", built.guide.unit_default, "in");
eq("build how_to_measure keys", built.guide.how_to_measure.map((h) => h.key), ["bust", "length"]);

const builtAU = buildGuide({ chart, product: summ, market: "AUS+NZ", confidence: 0.95 });
eq("build AU-kolom + EU", builtAU.guide.columns.map((c) => c.key), ["size", "au", "eu", "bust", "length"]);
eq("build AU rij S = 8", builtAU.guide.rows[0].au, "8");
eq("build AU unit cm", builtAU.guide.unit_default, "cm");

// store heeft US-nummers, tabel letters + EU → number-mode
const prodNumbers = { ...prodLetters, variants: [{ option1: "Black", option2: "4" }, { option1: "Black", option2: "6" }, { option1: "Black", option2: "8" }, { option1: "Black", option2: "10" }] };
const bNum = buildGuide({ chart, product: productSummary(prodNumbers), market: "USA", confidence: 0.95 });
ok("number-mode ok", bNum.ok);
eq("number-mode 4 rijen", bNum.guide.rows.map((r) => r.size), ["4", "6", "8", "10"]);
eq("number-mode 8 en 10 delen rij L", [bNum.guide.rows[2].bust, bNum.guide.rows[3].bust], [92, 92]);
eq("number-mode mode", bNum.mode, "number");

// tabel past niet op de productmaten → geen tabel
const bMiss = buildGuide({ chart, product: { ...summ, sizes: ["XS", "2XS", "3XS"] }, market: "USA" });
eq("mismatch → ok:false", bMiss.ok, false);

// deels ontbrekend (4 van 5) → geen tabel (website is leidend: exact de variantmaten)
const bPart = buildGuide({ chart, product: { ...summ, sizes: ["S", "M", "L", "XL", "3XL"] }, market: "USA", confidence: 0.95 });
eq("deels ontbrekend → ok:false + missing", [bPart.ok, bPart.missing], [false, ["3XL"]]);
ok("deels ontbrekend → reden noemt de maat", /mist maat 3XL/.test(bPart.reason));

// lage match-confidence → cijfer omlaag
const bLow = buildGuide({ chart, product: summ, market: "USA", confidence: 0.7 });
eq("confidence 0.7 → 6.5 (amber)", [bLow.score, bLow.verdict], [6.5, "amber"]);

// cm-tabel + range-cellen + onbekende kolom
const chart2 = normalizeChart({ headers: ["Size", "Bust (cm)", "Waist", "Hip", "Fabric"], rows: [["S", "84-88", "66", "90", "Cotton"], ["M", "88-92", "70", "94", "Cotton"], ["L", "92-96", "74", "98", "Cotton"]] });
eq("chart2 unit cm", chart2.unit, "cm");
eq("chart2 range bust", chart2.rows[0].bust, [84, 88]);
eq("chart2 fabric tekstkolom", chart2.columns.find((c) => c.key === "x_fabric").kind, "text");
const b2 = buildGuide({ chart: chart2, product: { ...summ, sizes: ["S", "M", "L"] }, market: "USA", confidence: 1 });
eq("build2 kolommen", b2.guide.columns.map((c) => c.key), ["size", "bust", "waist", "hip", "x_fabric"]);
eq("build2 verdict", b2.verdict, "green");

// sanity: waarden buiten band → hard → rood
const chartBad = normalizeChart({ headers: ["Size", "Bust", "Length"], rows: [["S", "84", "5"], ["M", "88", "6"], ["L", "92", "7"]] });
const bBad = buildGuide({ chart: chartBad, product: { ...summ, sizes: ["S", "M", "L"] }, market: "USA", confidence: 1 });
eq("sanity hard → rood", bBad.verdict, "red");
ok("sanity issue-tekst", /Length valt buiten de band/.test(bBad.issues.join("|")));

// sanity: niet-oplopend
const chartDip = normalizeChart({ headers: ["Size", "Bust", "Waist"], rows: [["S", "84", "66"], ["M", "80", "70"], ["L", "92", "74"]] });
const san = sanityCheck(chartDip.columns, chartDip.rows);
ok("sanity dip gevonden", san.issues.some((i) => /loopt niet op/.test(i)) && !san.hard);

// schoenen: EU-tabel + voetlengte, store in US-nummers
const shoeChart = normalizeChart({ headers: ["Size", "EU", "Foot Length"], rows: [["36", "36", "23"], ["37", "37", "23.5"], ["38", "38", "24"], ["39", "39", "24.5"], ["40", "40", "25"]] });
const shoeProd = { id: 2, title: "Women's Chunky Ankle Boots", tags: "Women", product_type: "Boots", options: [{ name: "Size" }], variants: [{ option1: "5" }, { option1: "6" }, { option1: "7" }, { option1: "8" }, { option1: "9" }], images: [] };
const bShoe = buildGuide({ chart: shoeChart, product: productSummary(shoeProd), market: "USA", confidence: 0.95 });
ok("schoenen ok", bShoe.ok);
eq("schoenen rijen via EU→US", bShoe.guide.rows.map((r) => [r.size, r.foot]), [["5", 23], ["6", 23.5], ["7", 24], ["8", 24.5], ["9", 25]]);
eq("schoenen family", bShoe.guide.family, "shoes");

/* ---------- standaardtabellen ---------- */
const std = standardGuide(summ, "USA");
ok("standaard dames ok", std.ok);
eq("standaard status", std.guide.status, "standard");
eq("standaard kolommen (trui = top: bust+waist)", std.guide.columns.map((c) => c.key), ["size", "us", "bust", "waist"]);
eq("standaard rij M", std.guide.rows[1], { size: "M", us: "8/10", bust: [91, 94], waist: [71, 74] });
eq("standaard kind in guide", std.guide.kind, "top");
eq("standaard XXL → 2XL-rij", std.guide.rows[4].us, "20/22");
const stdAU = standardGuide(summ, "AUS+NZ");
eq("standaard AU-label M = 12/14", stdAU.guide.rows[1].au, "12/14");
const stdMen = standardGuide({ ...summ, gender: "men", sizes: ["M", "L", "XL"] }, "USA");
eq("standaard heren kolommen", stdMen.guide.columns.map((c) => c.key), ["size", "us", "bust", "waist"]);
eq("standaard heren label Chest", stdMen.guide.columns[2].label, "Chest");
const stdShoe = standardGuide(productSummary(shoeProd), "USA");
eq("standaard schoenen rij 7", stdShoe.guide.rows[2], { size: "7", us: "7", eu: "37.5", uk: "5", foot: 23.8 });
const stdShoeAU = standardGuide({ ...productSummary(shoeProd), gender: "men", sizes: ["9", "10"] }, "AUS+NZ");
eq("standaard herenschoen AU 9 = US 10", stdShoeAU.guide.rows[0].us, "10");
const stdNum = standardGuide({ ...summ, sizes: ["4", "6", "8", "10"] }, "USA");
eq("standaard US-nummers → letters", stdNum.guide.rows.map((r) => r.bust[0]), [86, 86, 91, 91]);
const stdWaist = standardGuide({ ...summ, family: "bottoms", kind: "bottoms", sizes: ["26", "28", "30"] }, "USA");
eq("standaard taille-nummers", stdWaist.guide.rows[0], { size: "26", us: "26", waist: 66 });
eq("standaard bh → geen", standardGuide({ ...summ, family: "bra", sizes: ["34B"] }, "USA").ok, false);
eq("standaard onbekende maten → geen", standardGuide({ ...summ, sizes: ["A", "B", "C"] }, "USA").ok, false);

/* ---------- productsoorten + soort-controle ---------- */
eq("kind sweater dress → dress", kindOf("", "Women's Sweater Dress | Ribbed Knit"), "dress");
eq("kind maxi skirt → skirt", kindOf("", "Pleated Maxi Skirt"), "skirt");
eq("kind flannel → top", kindOf("Shirts", "Men's Flannel Shirt | Plaid"), "top");
eq("kind pant set → set", kindOf("", "Women's Two-Piece Pant Set"), "set");
eq("kind jeans → bottoms", kindOf("", "High Waist Wide Leg Jeans"), "bottoms");
eq("kind blazer → outerwear", kindOf("", "Men's Slim Fit Blazer"), "outerwear");
eq("kind boots → shoes", kindOf("Boots", "Men's Boots | Lace-Up"), "shoes");
eq("kind bag → accessory", kindOf("", "Leather Tote Bag"), "accessory");
eq("kind onbekend", kindOf("", "Something Nice"), "unknown");
eq("kind via product_type", kindOf("Dresses", "Evening Elegance"), "dress");
const colsBlouseBad = [{ key: "size", kind: "size" }, { key: "bust", kind: "length" }, { key: "inseam", kind: "length" }];
eq("columnsForKind top: inseam verboden", columnsForKind(colsBlouseBad, "top").forbidden, ["inseam"]);
eq("columnsForKind skirt: bust verboden", columnsForKind([{ key: "bust", kind: "length" }, { key: "waist", kind: "length" }], "skirt").forbidden, ["bust"]);
eq("columnsForKind bottoms ok", columnsForKind([{ key: "waist", kind: "length" }, { key: "inseam", kind: "length" }], "bottoms").forbidden, []);
eq("columnsForKind top zonder kernmaat", columnsForKind([{ key: "sleeve", kind: "length" }], "top").missingNeed, true);
const stdSkirt = standardGuide({ ...summ, kind: "skirt", sizes: ["S", "M", "L"] }, "USA");
eq("standaard rok = waist+hips", stdSkirt.guide.columns.map((c) => c.key), ["size", "us", "waist", "hip"]);
const stdDress = standardGuide({ ...summ, kind: "dress", sizes: ["S", "M"] }, "USA");
eq("standaard jurk = bust+waist+hips", stdDress.guide.columns.map((c) => c.key), ["size", "us", "bust", "waist", "hip"]);
const stdMenTop = standardGuide({ ...summ, gender: "men", kind: "top", sizes: ["M", "L"] }, "USA");
eq("standaard heren top = chest+waist", stdMenTop.guide.columns.map((c) => c.label), ["Size", "US", "Chest", "Waist"]);
eq("standaard accessoire → geen", standardGuide({ ...summ, kind: "accessory", sizes: ["One Size"] }, "USA").ok, false);
// AliExpress-tabel met bust op een rok → verkeerd product → rood
const skirtProd = { ...summ, kind: "skirt", title: "Pleated Maxi Skirt", sizes: ["S", "M", "L", "XL", "XXL"] };
const bSkirt = buildGuide({ chart, product: skirtProd, market: "USA", confidence: 0.95 });
eq("bust op rok → rood", bSkirt.verdict, "red");
ok("bust op rok → issue-tekst", /horen niet bij Rokken/.test(bSkirt.issues.join("|")));
// checkGuide
const chk = checkGuide(built.guide, summ, "USA");
eq("checkGuide trui ok", [chk.level, chk.issues], ["ok", []]);
const chkSkirt = checkGuide(built.guide, skirtProd, "USA");
eq("checkGuide bust-tabel op rok → error", chkSkirt.level, "error");
const chkSizes = checkGuide(built.guide, { ...summ, sizes: ["S", "M", "L", "XL", "XXL", "3XL"] }, "USA");
eq("checkGuide ontbrekende maat → error", [chkSizes.level, chkSizes.issues[0]], ["error", "variantmaten zonder rij: 3XL"]);
const chkExtra = checkGuide(built.guide, { ...summ, sizes: ["S", "M", "L"] }, "USA");
eq("checkGuide extra rijen → error", [chkExtra.level, chkExtra.issues[0]], ["error", "rijen voor maten die niet op de site staan: XL/XXL"]);
// schoenen: tabel = exact de websitematen (4/5/6/6.5/7/8/9/10/11)
const stdLoafer = standardGuide({ ...productSummary(shoeProd), gender: "men", sizes: ["4", "5", "6", "6.5", "7", "8", "9", "10", "11"] }, "USA");
eq("standaard loafer = exact 9 rijen", stdLoafer.guide.rows.map((r) => r.size), ["4", "5", "6", "6.5", "7", "8", "9", "10", "11"]);
eq("standaard 5XL", standardGuide({ ...summ, sizes: ["4XL", "5XL", "6XL"] }, "USA").guide.rows.map((r) => r.us), ["28", "30", "32"]);
eq("standaard onbekende maat → geen tabel", standardGuide({ ...summ, sizes: ["S", "M", "7XL"] }, "USA").ok, false);
eq("checkGuide geen tabel → missing", checkGuide(null, summ, "USA").level, "missing");
eq("checkGuide accessoire → skip", checkGuide(null, { ...summ, kind: "accessory" }, "USA").level, "skip");
eq("checkGuide schoenentabel op kleding → error", checkGuide(stdShoe.guide, summ, "USA").level, "error");
eq("checkGuide andere markt → warn", checkGuide(built.guide, summ, "AUS+NZ").level, "warn");
eq("checkGuide standaard-vlag", checkGuide(std.guide, summ, "USA").standard, true);

/* ---------- weergave ---------- */
eq("format 84 cm → in", formatCell(84, "length", "in"), "33.1");
eq("format range in", formatCell([84, 88], "length", "in"), "33.1–34.6");
eq("format cm", formatCell([84, 88], "length", "cm"), "84–88");
eq("format tekst", formatCell("8/10", "text", "in"), "8/10");

console.log(`\n${pass} groen, ${fail} rood`);
process.exit(fail ? 1 : 0);
