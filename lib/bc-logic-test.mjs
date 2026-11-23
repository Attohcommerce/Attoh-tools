#!/usr/bin/env node
/* ============================================================================
   BIG COMPETITORS — test van de rekenregels (lib/bc-logic.js).

   Gebruik:  node lib/bc-logic-test.mjs

   Controleert zonder Redis, netwerk of Google Sheets:
     - keyword uit de titel + tags van de competitor (echte titels van
       Barbara Dever, 23-11-2026) — geen voornaam, geslacht, kleur of cijfers
     - soort kledingstuk ("Hooded Puffer Jacket" = jas, "Blazer-Style Midi
       Dress" = jurk, zonnebril = accessoire)
     - wanneer is iets nieuw, wat slaan we over
     - prijs net onder de concurrent + doorstreep-korting
     - de verdeler: geslacht per store, Pythago-cijfers, niets dubbel
     - bladnaam per datum, ID's in- en uitpakken
   ========================================================================== */
import { register } from "node:module";

register("./_extless-loader.mjs", import.meta.url);
const L = await import("./bc-logic.js");

let fails = 0;
const eq = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    kreeg:   ${JSON.stringify(got)}\n    verwacht: ${JSON.stringify(want)}`}`);
};
const yes = (cond, label, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !extra ? "" : ` — ${extra}`}`);
};

/* ---------- keyword + kledingstuk ---------- */
const KW = [
  // [titel, type, tags, keyword, kledingstuk]
  ["Penelope | Women's Slouchy Foldover High Heel Boots Gold-Buckle Knee-High", "Shoes > Boots > Casual > Knee-High", "block heel boots, foldover boots, high heel boots, knee-high boots", "high heel boots", "boots"],
  ["William | Men's Sherpa-Lined Aviator Bomber Jacket Full-Zip", "Clothing > Men's Jackets > Winter > Bomber", "aviator jacket, full zip jacket, mens bomber jacket, NEW", "bomber jacket", "jacket"],
  ["Victoria | Women's Faux Fur Quilted Plush Hooded Coat", "Clothing > Coats > Winter", "AI-generated-images, faux fur coat, hooded coat", "faux fur coat", "jacket"],
  ["Olivia | Women's Blazer-Style Tailored Long Sleeve Midi Dress", "Clothing > Dresses", "blazer dress, long sleeve dress, elegant dress", "long sleeve dress", "dress"],
  ["Victoria | Women's UV400 Aviator Sunglasses With Gradient Lenses", "Accessories > Sunglasses > Casual > Bomber", "aviator, lightweight sunglasses", "aviator sunglasses", "accessory"],
  ["Scarlett | Women's Black Formal Maxi Gown Keyhole High-Neck Short Sleeve", "Clothing > Dresses > Party", "", "formal maxi gown", "dress"],
  ["Vaida | Women's Slip-On Loafers with Cushioned Rubber Outsole", "Shoes > Flats", "", "slip on loafers", "flats-loafers"],
  ["Vittoria | Women'S Gold Loafers", "", "", "loafers", "flats-loafers"],
  ["Syvanna | Orthopedic Shoes", "Shoes > Flats > Mary Janes", "", "orthopedic shoes", "other-shoe"],
  ["Heritage Nordic Knit Sweater", "", "", "nordic knit sweater", "sweater"],
  ["Olivia | Women's Floral Print Zip-Up Bomber Jacket, White", "Clothing > Jackets", "floral bomber jacket, NEW", "floral bomber jacket", "jacket"],
  ["Victoria | Women's Tiered Chiffon Short Sleeve Fall Wedding Guest Dress", "Clothing > Dresses", "fall wedding guest dresses, chiffon dress", "fall wedding guest dresses", "dress"],
];
for (const [title, type, tags, wantKw, wantGarment] of KW) {
  const r = L.deriveKeyword(title, type, tags.split(","));
  eq([r.keyword, r.garment], [wantKw, wantGarment], `keyword: ${title.slice(0, 62)}`);
  yes(!/\d/.test(r.keyword) && !/\b(women|men|mens|womens|black|white|gold|elegant|stylish)\b/.test(r.keyword), "  → zonder cijfers, geslacht, kleur of waarde-oordeel");
}
eq(L.coreTitle("William | Men's Wool Overcoat"), "Men's Wool Overcoat", "voornaam vóór de titel gaat eraf");
eq(L.coreTitle("Women's Barrel Leg Jeans | High Waist Denim"), "Women's Barrel Leg Jeans High Waist Denim", "een titel die met het product begint blijft heel");

/* ---------- product uit de feed ---------- */
const now = Date.now();
const DAY = 86400000;
const feed = (over = {}) => ({
  id: 9100000000001, handle: "penelope-boots", title: "Penelope | Women's Knee High Boots Block Heel", product_type: "Shoes > Boots", tags: ["knee high boots", "block heel boots"],
  body_html: "<p>Soft</p>", created_at: new Date(now - 200 * DAY).toISOString(), published_at: new Date(now - 3 * DAY).toISOString(),
  variants: [{ price: "64.95", compare_at_price: "129.90", available: true }, { price: "69.95", available: false }], images: [{ src: "https://cdn.shopify.com/a.jpg?v=1" }], ...over,
});
const rec = L.shapeProduct(feed(), "barbaradever.com");
eq([rec.g, rec.ga, rec.kw, rec.p, rec.c, rec.im, rec.av], ["Vrouw", "boots", "knee high boots", 64.95, 129.9, "https://cdn.shopify.com/a.jpg", true], "feed-product → compacte regel (laagste prijs, eerste foto, geslacht, keyword)");
yes(Math.abs(L.addedAtOf(feed()) - (now - 3 * DAY)) < 5000, "toegevoegd = laatste van created_at en published_at (concept dat later live ging)");
eq(L.junkReason(rec), "", "gewoon product wordt meegenomen");
eq(L.junkReason(L.shapeProduct(feed({ title: "Gift Card", product_type: "Gift Cards" }), "x.com")), "geen product", "cadeaubon overgeslagen");
eq(L.junkReason(L.shapeProduct(feed({ variants: [{ price: "64.95", available: false }] }), "x.com")), "uitverkocht", "uitverkocht overgeslagen");
eq(L.junkReason(L.shapeProduct(feed({ title: "Kids Winter Boots", tags: [] }), "x.com")), "kids", "kinderproduct overgeslagen");
eq(L.junkReason(L.shapeProduct(feed({ title: "Silent Night Mosaic – Nativity Easel Mosaic Craft Kit", product_type: "Gifts > Craft Kits", tags: [] }), "x.com")), "geen kleding", "knutselpakket overgeslagen");
eq([L.mixGender(85, 405), L.mixGender(2, 300), L.mixGender(120, 4), L.mixGender(1, 2)], ["MV", "V", "M", "MV"], "geslacht van een competitor uit zijn mix");

/* ---------- prijs + rij ---------- */
const item = { p: rec, g: "Vrouw", reason: "Dames · boots · test" };
const row = L.buildRow(item, { undercut: 5, storeCurrency: "USD", competitorCurrency: "USD" });
eq(row.length, L.BC_HEADER.length, "rij heeft net zoveel kolommen als de kopregel");
eq([row[0], row[2], row[4], row[5], row[9], row[16], row[17], row[19]], ["https://barbaradever.com/products/penelope-boots", "knee high boots", "Literal", "Vrouw", "Attribuut", 59.95, 64.95, "barbaradever.com"], "zij 64,95 → wij 59,95 (5 eronder, op het rooster)");
yes([50, 60, 70].includes(row[18]), "doorstreep-korting 50/60/70");
eq(L.buildRow(item, { undercut: 10, storeCurrency: "CAD", competitorCurrency: "CAD" })[16], 54.95, "Canada met 10 eronder: 64,95 → 54,95");
const other = L.buildRow(item, { undercut: 5, storeCurrency: "GBP", competitorCurrency: "EUR" });
eq([other[16], other[17], /andere valuta/.test(other[21])], ["", "", true], "andere valuta dan de markt → geen prijs in het blad, wel uitleg");

/* ---------- verdeler ---------- */
const mk = (id, title, type) => L.shapeProduct(feed({ id, handle: `p-${id}`, title, product_type: type, tags: [] }), "barbaradever.com");
const products = [
  ...Array.from({ length: 30 }, (_, i) => mk(1000 + i, "Mia | Women's Floral Maxi Dress", "Dresses")),
  ...Array.from({ length: 30 }, (_, i) => mk(2000 + i, "Ava | Women's Knee High Boots", "Boots")),
  ...Array.from({ length: 20 }, (_, i) => mk(3000 + i, "William | Men's Bomber Jacket", "Men's Jackets")),
  ...Array.from({ length: 4 }, (_, i) => mk(4000 + i, "Syvanna | Orthopedic Shoes", "Shoes")),
];
const stores = [
  { domain: "ssb", name: "Soul Society Boutique", genders: "MV" },
  { domain: "lgb", name: "Lady Glam Boutique", genders: "V" },
  { domain: "emc", name: "Everman Clothing", genders: "M" },
];
const perf = {
  ssb: { hasData: true, orders: 100, byGarment: { boots: { orders: 60, spend: 800, n: 30 }, jacket: { orders: 30, spend: 400, n: 20 }, dress: { orders: 10, spend: 200, n: 15 } } },
  lgb: { hasData: true, orders: 40, byGarment: { dress: { orders: 36, spend: 300, n: 60 }, boots: { orders: 0, spend: 90, n: 4 } } },
  emc: { hasData: true, orders: 20, byGarment: { jacket: { orders: 15, spend: 200, n: 25 } } },
};
const d = L.distribute({ products, stores, perf, compGender: { "barbaradever.com": "MV" } });
const count = (dom, ga) => d.assigned[dom].filter((x) => x.p.ga === ga).length;
yes(d.assigned.emc.every((x) => x.g === "Man") && d.assigned.lgb.every((x) => x.g === "Vrouw"), "herenstore krijgt alleen heren, damesstore alleen dames");
yes(count("lgb", "dress") > count("ssb", "dress"), "jurken gaan vooral naar de store waar jurken verkopen", `LGB ${count("lgb", "dress")} · SSB ${count("ssb", "dress")}`);
yes(count("ssb", "boots") > count("lgb", "boots"), "laarzen gaan vooral naar de store waar laarzen verkopen", `SSB ${count("ssb", "boots")} · LGB ${count("lgb", "boots")}`);
yes(d.assigned.ssb.filter((x) => x.g === "Onbekend").length === 4 && !d.unassigned.length, "geslacht onbekend → alleen naar de store met heren én dames");
const total = stores.reduce((a, s) => a + d.assigned[s.domain].length, 0);
eq(total, products.length, "elk product in precies één store");
yes(d.assigned.ssb[0].reason.includes("verkoopt hier"), "reden van toewijzing staat erbij", d.assigned.ssb[0].reason);
const none = L.distribute({ products: products.slice(0, 30), stores: [stores[2]], perf });
eq([none.assigned.emc.length, none.unassigned.length], [0, 30], "niets passends → store krijgt 0 (dames-producten, alleen een herenstore)");

/* ---------- eerlijk over de competitors ---------- */
const rr = L.roundRobin({ a: [{ id: 1, a: 5 }, { id: 2, a: 9 }, { id: 3, a: 1 }], b: [{ id: 4, a: 7 }] }, 3);
eq(rr.map((x) => x.id), [2, 4, 1], "om de beurt per competitor, nieuwste eerst, tot het maximum");

/* ---------- bladnaam + geheugen ---------- */
eq(L.tabTitle("24-11", "Soul Society Boutique", 60, []), "24-11 · Soul Society Boutique (60)", "bladnaam met datum");
eq(L.tabTitle("24-11", "Soul Society Boutique", 5, ["24-11 · Soul Society Boutique (60)", "24-11 · Lady Glam Boutique (40)"]), "24-11 · Soul Society Boutique #2 (5)", "tweede scan op dezelfde dag krijgt een volgnummer");
const ids = Array.from({ length: 25000 }, (_, i) => 7000000000000 + i * 104729 + (i % 97));
const packed = L.packIds(ids);
const back = L.unpackIds(packed);
yes(back.size === ids.length && ids.every((i) => back.has(i)), "25.000 product-ID's in- en uitpakken zonder verlies", `${Math.round(packed.length / 1024)} kB`);
eq(L.amsParts(Date.parse("2026-11-24T01:04:00Z")), { iso: "2026-11-24", short: "24-11", time: "02:04" }, "datum in Nederlandse tijd");

console.log(fails ? `\n${fails} test(s) mislukt` : "\nAlles goed");
process.exit(fails ? 1 : 0);
