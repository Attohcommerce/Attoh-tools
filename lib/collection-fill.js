// COLLECTIES AANVULLEN (Store Doctor, 02-11-2026)
//
// Justin: "elke collectie minimaal 30 producten, liefst 40". Eén keer per
// store de basis goed zetten. Werkwijze:
//   1. scanCollections: alle collecties + aantal actieve producten.
//   2. planFill (per aangevinkte collectie):
//      - wat verkoopt er al in die collectie (orders 60 d, Orders-app)
//      - welke keywords uit het All-batch keyword-geheugen van de markt
//        passen bij die collectie (zoekvolume komende 4 maanden), merken /
//        rommel / ander geslacht / andere productfamilie eruit
//      - tekort (doel 40) verdelen over die keywords
//   3. writeFillTab: een blad in de TPK-sheet van de store, in exact het
//      verdeling-formaat dat de scraper leest (A–J), met rechts een overzicht
//      per collectie. Daarna: Scraper → bron TPK-sheet → dat blad.
import { storeRequest } from "./shopify";
import { readRange, updateValues, addTab, getTabIdByTitle, spreadsheetBatchUpdate, parseSheetId, a1Tab } from "./sheets";
import { getStoreMemory, allTopKeywords, keywordFromTitle, canonOf } from "./geheugen";
import { resolveMarket } from "./kw-memory";
import { isJunkKeyword, unknownFashionTokens } from "./brands";
import { fetchOrderProducts } from "./tpk";

export const FILL_TARGET = 20; // standaard (03-11: "eerst 20"), per store instelbaar in de tool
export const FILL_MIN = 15;
const clampTarget = (t) => Math.min(150, Math.max(5, Math.round(Number(t) || FILL_TARGET)));
const minFor = (t) => Math.round(t * 0.75);

/* Shopify REST staat ~2 calls/sec toe. Bij "Exceeded 2 calls per second" /
   429 even wachten en opnieuw — anders telt een collectie onterecht als 0. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shopReq(store, path) {
  let r;
  for (let i = 0; i < 6; i++) {
    r = await storeRequest(store, path);
    if (r.ok) return r;
    const msg = String(r.error || "");
    if (!(r.status === 429 || /exceeded|too many|rate limit|throttl/i.test(msg))) return r;
    await sleep(800 + i * 700);
  }
  return r;
}
const PER_KW_MAX = 6;
const PER_KW_MIN = 2;
const MAX_KW_PER_COLL = 10;

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const sheetUrl = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid != null ? `#gid=${gid}` : ""}`;

/* ---------- productfamilie per collectie ----------
   key = collectietitel zonder geslacht, kleine letters.
   inc = minstens één van deze woorden moet in het keyword staan,
   exc = keywords met deze woorden horen er niet in. */
const FAMILIES = [
  { re: /hoodie|sweatshirt/, inc: ["hoodie", "hoody", "hoodies", "sweatshirt", "sweatshirts", "hooded", "quarter zip", "half zip", "zip up"], exc: ["dress", "jacket", "coat", "vest"] },
  { re: /tank|cami/, inc: ["tank", "tanks", "cami", "camis", "camisole", "sleeveless top", "halter top"], exc: ["tankini", "swim", "bikini", "dress", "jumpsuit"] },
  { re: /co-?ord|sets?$|matching/, inc: ["set", "sets", "co ord", "coord", "two piece", "2 piece", "matching", "lounge set", "tracksuit"], exc: ["bikini", "swim", "swimsuit", "swimsuits", "pajama", "pyjama", "lingerie", "bedding", "jewelry", "couples", "mother daughter", "dress", "dresses", "christmas"] },
  { re: /skirt/, inc: ["skirt", "skirts", "skort"], exc: ["dress", "set"] },
  { re: /blouse/, inc: ["blouse", "blouses", "button up shirt", "button down shirt", "shirt"], exc: ["t shirt", "tee", "dress", "sweatshirt", "men"] },
  { re: /other tops|^tops?$/, inc: ["top", "tops", "tee", "tees", "t shirt", "t shirts", "bodysuit", "long sleeve", "tunic", "crop top"], exc: ["tank", "cami", "blouse", "dress", "swim", "bikini", "crop pants", "laptop"] },
  { re: /sweater|knit|cardigan|jumper/, inc: ["sweater", "sweaters", "jumper", "cardigan", "cardigans", "knit", "pullover", "turtleneck", "crewneck"], exc: ["dress", "vest", "sweatshirt", "hoodie", "pants"] },
  { re: /jacket|coat|blazer|outerwear/, inc: ["jacket", "jackets", "coat", "coats", "blazer", "parka", "trench", "puffer", "bomber", "gilet", "overcoat", "shacket", "windbreaker", "peacoat"], exc: ["dress", "raincoat for dog", "life jacket"] },
  { re: /jean/, inc: ["jeans", "jean", "denim"], exc: ["jacket", "shirt", "skirt", "shorts", "dress", "vest"] },
  { re: /trouser|pant|chino|jogger/, inc: ["pants", "pant", "trousers", "trouser", "chinos", "chino", "joggers", "jogger", "sweatpants", "cargo", "slacks", "leggings", "wide leg"], exc: ["jeans", "shorts", "dress", "jacket", "panties", "underwear", "pajama", "pyjama"] },
  { re: /short/, inc: ["shorts", "short"], exc: ["sleeve", "dress", "boots", "skirt"] },
  { re: /wedding|bridesmaid/, inc: ["wedding guest", "bridesmaid", "mother of the bride", "wedding dress guest"], exc: ["bride dress", "wedding dresses for bride", "suit", "shoes"] },
  { re: /formal|occasion|cocktail|evening|party/, inc: ["formal dress", "cocktail dress", "evening dress", "party dress", "gown", "occasion dress", "satin dress", "sequin dress", "midi dress", "maxi dress"], exc: ["casual", "wedding dress", "shoes", "kids"] },
  { re: /dress/, inc: ["dress", "dresses", "sundress", "midi dress", "maxi dress"], exc: ["formal", "evening", "cocktail", "gown", "wedding", "bridesmaid", "prom", "shirt", "shoes", "pants"] },
  { re: /boot/, inc: ["boot", "boots", "booties", "chelsea", "ankle boot"], exc: ["boot cut", "bootcut", "jeans", "bootleg"] },
  { re: /flat|loafer|mule|clog/, inc: ["loafer", "loafers", "flats", "ballet flat", "mules", "moccasin", "moccasins", "clogs", "slip on shoes", "mary jane"], exc: ["boots", "heels", "sneakers", "slippers"] },
  { re: /sneaker|trainer/, inc: ["sneaker", "sneakers", "trainers", "running shoes"], exc: ["boots"] },
  { re: /heel|pump/, inc: ["heels", "heel", "pumps", "stilettos", "block heels", "slingback"], exc: ["boots", "sneakers"] },
  { re: /sandal/, inc: ["sandal", "sandals", "slides", "flip flops"], exc: ["boots"] },
  { re: /shoe|footwear/, inc: ["shoes", "shoe", "sneakers", "loafers", "oxfords", "derby", "trainers", "slip on", "boat shoes", "dress shoes", "flats", "mules"], exc: ["boots", "shoe rack", "shoe horn", "laces"] },
  { re: /shirt/, inc: ["shirt", "shirts", "polo", "button down", "button up", "flannel", "overshirt", "henley"], exc: ["t shirt", "tee", "sweatshirt", "dress", "jacket"] },
  { re: /bag|purse/, inc: ["bag", "bags", "handbag", "purse", "tote", "crossbody", "clutch"], exc: ["sleeping bag", "laptop bag", "duffle"] },
  { re: /swim|bikini/, inc: ["swimsuit", "swimwear", "bikini", "one piece", "tankini", "swim trunks", "board shorts"], exc: [] },
];
const GENERIC_TOP = /^(women|men|all|sale|new|home page|frontpage|best ?sellers?|shop all|catalog|featured)$/i;

function bareTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\b(women'?s|womens|women|ladies|men'?s|mens|men|for him|for her)\b/g, " ")
    .replace(/&/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function familyFor(title) {
  const b = bareTitle(title);
  return FAMILIES.find((f) => f.re.test(b)) || null;
}
function genderOfTitle(title) {
  const t = String(title || "").toLowerCase();
  if (/\b(women|womens|women's|ladies)\b/.test(t)) return "V";
  if (/\b(men|mens|men's|him|guys)\b/.test(t)) return "M";
  return null;
}
const has = (kw, w) => (` ${kw} `).includes(` ${w} `) || (w.includes(" ") && kw.includes(w));
function fitsFamily(kw, fam) {
  if (!fam) return false;
  if (!fam.inc.some((w) => has(kw, w))) return false;
  if (fam.exc.some((w) => has(kw, w))) return false;
  return true;
}
function cleanKw(kw) {
  return String(kw || "")
    .toLowerCase()
    .replace(/[^a-z0-9&' -]+/g, " ")
    .replace(/\b(women'?s|womens|women|woman|ladies|lady|men'?s|mens|men|man|for him|for her|female|male)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Rommel die door het merk/junk-filter glipt: losse letters, cijfers, "near me", maten …
function looksBad(kw) {
  if (!kw || kw.length < 3) return true;
  const w = kw.split(" ");
  if (w.length > 4) return true;
  if (w.some((x) => x.length === 1 && x !== "&")) return true; // "blazer s", "t shirt" mag wel via canon
  if (/\b(near me|size|sizes|xl|xxl|plus size chart|cheap|sale|discount|amazon|walmart|target|shein|zara|h&m|kohls|nordstrom|macy'?s|asos|kids|girls|boys|baby|toddler|men and women|unisex)\b/.test(kw)) return true;
  if (/\d/.test(kw)) return true;
  if (new Set(w).size < w.length) return true; // "cargo pants pants"
  return false;
}

/* Woorden die niet in de mode-woordenschat van lib/brands.js staan maar wel
   gewone mode-taal zijn. Elk ANDER onbekend woord = waarschijnlijk een merk
   ("gildan hoodie", "essentials hoody") → keyword valt af. */
const ALLOW_UNKNOWN = new Set([
  "oversize", "oversized", "graphic", "quarter", "hoody", "zipper", "zippers", "crewneck", "halter", "shacket",
  "skort", "tankini", "coord", "puffer", "trench", "chelsea", "moccasin", "moccasins", "clog", "clogs", "mule",
  "mules", "slingback", "cami", "camis", "bodysuit", "jogger", "joggers", "chino", "chinos", "sweatpants",
  "flannel", "henley", "overshirt", "mary", "jane", "loafer", "loafers", "cargo", "bomber", "peacoat",
  "windbreaker", "turtleneck", "cardigan", "corduroy", "sherpa", "fleece", "linen", "satin", "sequin", "velvet",
  "midi", "maxi", "mini", "lounge", "matching", "tunic", "slacks", "booties", "stilettos", "sundress", "gown",
  "khaki", "camo", "plaid", "ribbed", "cropped", "fuzzy", "teddy", "quilted", "workout",
]);
function hasBrandish(kw) {
  return unknownFashionTokens(kw).some((t) => !ALLOW_UNKNOWN.has(t) && !ALLOW_UNKNOWN.has(t.replace(/s$/, "")));
}

async function listCollections(store) {
  const out = [];
  for (const [path, key, kind] of [["/custom_collections.json", "custom_collections", "custom"], ["/smart_collections.json", "smart_collections", "smart"]]) {
    let since = 0;
    for (let page = 0; page < 10; page++) {
      const r = await shopReq(store, `${path}?limit=250&since_id=${since}&fields=id,title,handle,published_at`);
      if (!r.ok) throw httpErr(r.status || 500, `Shopify: ${r.error}`);
      const list = (r.data && r.data[key]) || [];
      for (const c of list) out.push({ id: c.id, title: c.title, handle: c.handle, published: !!c.published_at, kind });
      if (list.length < 250) break;
      since = list[list.length - 1].id;
    }
  }
  return out;
}
async function productsOf(store, collId) {
  const out = [];
  let since = 0;
  for (let page = 0; page < 8; page++) {
    const r = await shopReq(store, `/products.json?collection_id=${collId}&limit=250&since_id=${since}&fields=id,title,status`);
    if (!r.ok) throw httpErr(r.status || 500, `Shopify: ${r.error}`);
    const list = (r.data && r.data.products) || [];
    out.push(...list);
    if (list.length < 250) break;
    since = list[list.length - 1].id;
  }
  return { ok: true, products: out };
}
async function inBatches(items, size, fn) {
  const res = [];
  for (let i = 0; i < items.length; i += size) {
    res.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    if (i + size < items.length) await sleep(1100); // binnen 2 calls/sec blijven
  }
  return res;
}

/** Alle collecties met aantal actieve producten + status t.o.v. 30 / 40. */
export async function scanCollections(store, targetIn) {
  if (!store || !store.domain) throw httpErr(400, "Geen store");
  const target = clampTarget(targetIn);
  const min = minFor(target);
  const colls = await listCollections(store);
  const rows = await inBatches(colls, 2, async (c) => {
    const p = await productsOf(store, c.id);
    const active = p.products.filter((x) => x.status === "active").length;
    const generic = GENERIC_TOP.test(String(c.title || "").trim()) || active > 150;
    const fam = familyFor(c.title);
    return {
      id: c.id,
      title: c.title,
      handle: c.handle,
      kind: c.kind,
      published: c.published,
      active,
      total: p.products.length,
      generic,
      family: !!fam,
      status: generic ? "hoofd" : active < min ? "te-leeg" : active < target ? "bijna" : "ok",
      gap: generic ? 0 : Math.max(0, target - active),
    };
  });
  // dubbele collecties (zelfde titel) aanwijzen
  const seen = new Map();
  for (const r of rows) {
    const k = String(r.title || "").trim().toLowerCase();
    if (seen.has(k)) r.duplicateOf = seen.get(k);
    else seen.set(k, r.title);
  }
  rows.sort((a, b) => (a.generic - b.generic) || a.active - b.active || String(a.title).localeCompare(String(b.title)));
  const entry = (await getStoreMemory(store.domain)) || (store.publicDomain ? await getStoreMemory(store.publicDomain) : null);
  const market = (entry && entry.market) || resolveMarket({ domain: store.publicDomain, altDomain: store.domain, currency: store.currency }).market || null;
  return {
    ok: true,
    collections: rows,
    target,
    min,
    memory: {
      market,
      genders: (entry && entry.genders) || "MV",
      tpk: !!(entry && entry.tpkSheetId),
      tpkUrl: entry && entry.tpkSheetId ? entry.tpkUrl || sheetUrl(entry.tpkSheetId) : "",
      name: (entry && entry.name) || store.name || "",
    },
  };
}

/** Plan per aangevinkte collectie: welke keywords, hoeveel producten. */
export async function planFill({ store, ordersStore, collections, target: targetIn = FILL_TARGET, researchOnly = true }) {
  const target = clampTarget(targetIn);
  if (!store || !store.domain) throw httpErr(400, "Geen store");
  if (!Array.isArray(collections) || !collections.length) throw httpErr(400, "Vink minstens één collectie aan");
  const entry = (await getStoreMemory(store.domain)) || (store.publicDomain ? await getStoreMemory(store.publicDomain) : null);
  if (!entry || !entry.tpkSheetId) {
    throw httpErr(422, "Deze store heeft nog geen TPK-sheet in het geheugen — Keywords → Geheugen → Store-geheugen → veld \"TPK-sheet\" invullen.");
  }
  const market = entry.market || resolveMarket({ domain: store.publicDomain, altDomain: store.domain, currency: store.currency }).market;
  if (!market) throw httpErr(422, "Markt van deze store onbekend — zet de markt in het store-geheugen.");
  const mem = await allTopKeywords(market);
  if (!mem || !mem.rows || !mem.rows.length) throw httpErr(422, `Geen All-batch keywords in het geheugen voor ${market} (Keywords → Geheugen → Markt-geheugen).`);
  const storeG = entry.genders || "MV";
  const warnings = [];

  // Verkopen (60 dagen) — mag mislukken, dan alleen keyword research
  let sold = [];
  if (researchOnly) {
    // 03-11: SSB "puur op basis van keyword research" — verkopen tellen niet mee
  } else if (ordersStore && (ordersStore.token || (ordersStore.clientId && ordersStore.clientSecret))) {
    try {
      sold = (await fetchOrderProducts(ordersStore, 60)).products || [];
    } catch (e) {
      warnings.push(`Verkopen niet op te halen (${String(e.message || e).slice(0, 120)}) — plan draait alleen op keyword research.`);
    }
  } else {
    warnings.push("Geen Orders-app-sleutels voor deze store — plan draait alleen op keyword research (zoekvolume).");
  }
  const soldById = new Map(sold.filter((p) => p.productId).map((p) => [String(p.productId), p]));

  const plans = [];
  const usedCanon = new Set(); // één keyword maar in één collectie
  for (const c of collections) {
    const fam = familyFor(c.title);
    const g = genderOfTitle(c.title) || (storeG === "M" || storeG === "V" ? storeG : "V");
    const p = await productsOf(store, c.id);
    await sleep(500);
    const active = p.products.filter((x) => x.status === "active");
    const current = active.length;
    const need = Math.max(0, Number(target) - current);
    const plan = { id: c.id, title: c.title, g, current, need, rows: [], notes: [] };
    if (!need) {
      plan.notes.push("zit al op of boven het doel");
      plans.push(plan);
      continue;
    }
    if (!fam) plan.notes.push("productfamilie niet herkend uit de collectienaam — alleen keywords die al op de collectie staan");

    // 1. bewezen: wat verkoopt in deze collectie
    const soldKw = new Map();
    const onStore = new Map();
    for (const prod of p.products) {
      const kw = cleanKw(keywordFromTitle(prod.title));
      if (!kw) continue;
      const canon = canonOf(kw);
      onStore.set(canon, (onStore.get(canon) || 0) + 1);
      const s = soldById.get(String(prod.id));
      if (s && s.orders > 0) {
        const cur = soldKw.get(canon) || { kw, orders: 0 };
        cur.orders += s.orders;
        soldKw.set(canon, cur);
      }
    }
    // 2. keyword research: All-batch geheugen, zelfde geslacht en familie
    const memKw = new Map();
    for (const r of mem.rows) {
      if (r.g && r.g !== g) continue;
      const kw = cleanKw(r.kw);
      if (!kw || looksBad(kw) || isJunkKeyword(kw) || isJunkKeyword(r.kw) || hasBrandish(kw)) continue;
      if (fam ? !fitsFamily(kw, fam) : !onStore.has(canonOf(kw))) continue;
      const canon = canonOf(kw);
      if (memKw.has(canon)) {
        memKw.get(canon).vol = Math.max(memKw.get(canon).vol, Number(r.vol) || 0);
        continue;
      }
      memKw.set(canon, { kw, vol: Number(r.vol) || 0 });
    }
    // volume bij de verkochte keywords zoeken
    for (const [canon, s] of soldKw) s.vol = (memKw.get(canon) || {}).vol || 0;

    const cands = [
      ...[...soldKw.entries()].sort((a, b) => b[1].orders - a[1].orders).map(([canon, s]) => ({ canon, kw: s.kw, orders: s.orders, vol: s.vol, src: "Verkocht" })),
      ...[...memKw.entries()]
        .filter(([canon]) => !soldKw.has(canon))
        .sort((a, b) => b[1].vol - a[1].vol)
        .map(([canon, m]) => ({ canon, kw: m.kw, orders: 0, vol: m.vol, src: "Keyword research" })),
    ].filter((x) => !usedCanon.has(`${g}|${x.canon}`));

    // verdeling: bewezen keywords 3–6, research 6 → 2 aflopend
    let left = need;
    const picks = [];
    let ri = 0;
    for (const x of cands) {
      if (left <= 0 || picks.length >= MAX_KW_PER_COLL) break;
      let n;
      if (x.src === "Verkocht") n = Math.min(PER_KW_MAX, Math.max(3, x.orders * 2));
      else n = Math.max(PER_KW_MIN, PER_KW_MAX - Math.floor(ri++ / 2));
      n = Math.min(n, left);
      if (n < 1) break;
      picks.push({ ...x, n });
      left -= n;
    }
    // nog tekort (weinig keywords): bovenaan bijplussen tot max 10 per keyword
    for (let i = 0; left > 0 && picks.length && i < 200; i++) {
      const pk = picks[i % picks.length];
      if (pk.n >= 10) {
        if (picks.every((q) => q.n >= 10)) break;
        continue;
      }
      pk.n++;
      left--;
    }
    if (left > 0) plan.notes.push(`${left} producten niet ingepland — te weinig passende keywords`);
    if (!picks.length) plan.notes.push("geen passende keywords gevonden");
    for (const pk of picks) usedCanon.add(`${g}|${pk.canon}`);
    plan.rows = picks.map((pk) => ({
      keyword: pk.kw,
      zoekterm: g === "M" ? `mens ${pk.kw}` : pk.kw,
      orders: pk.orders,
      vol: pk.vol,
      src: pk.src,
      n: pk.n,
      onStore: onStore.get(pk.canon) || 0,
    }));
    plan.planned = picks.reduce((s, x) => s + x.n, 0);
    plans.push(plan);
  }
  return {
    ok: true,
    market,
    window: mem.window || "",
    storeGenders: storeG,
    tpkSheetId: entry.tpkSheetId,
    tpkUrl: entry.tpkUrl || sheetUrl(entry.tpkSheetId),
    target: Number(target),
    plans,
    totals: {
      collections: plans.length,
      need: plans.reduce((s, p) => s + p.need, 0),
      planned: plans.reduce((s, p) => s + (p.planned || 0), 0),
      keywords: plans.reduce((s, p) => s + p.rows.length, 0),
    },
    warnings,
  };
}

const NAVY = { red: 0.11, green: 0.16, blue: 0.29 };
const DARK = { red: 0.16, green: 0.16, blue: 0.18 };
const WHITE = { red: 1, green: 1, blue: 1 };

/** Schrijft het plan als blad in de TPK-sheet (scrape-ready, A–J) + overzicht (L–R). */
export async function writeFillTab({ plan, tab }) {
  const id = parseSheetId(plan && plan.tpkSheetId);
  const title = String(tab || "").trim();
  if (!id) throw httpErr(400, "TPK-sheet ontbreekt");
  if (!title) throw httpErr(400, "Vul een bladnaam in");
  if (/^(overzicht|log)$/i.test(title)) throw httpErr(400, `"${title}" is een vaste tab van de TPK-sheet — kies een andere naam`);
  if ((await getTabIdByTitle(id, title)) !== null) throw httpErr(409, `Blad "${title}" bestaat al in de TPK-sheet — kies een andere naam`);

  const left = [["Rank", "Keyword (zoekterm)", "Collectie", "Groep", "Orders 60 d", "Zoekvolume 4 mnd", "Bron", "Aantal producten", "Type", "Uitleg"]];
  let rank = 0;
  for (const p of plan.plans) {
    for (const r of p.rows) {
      rank++;
      left.push([
        rank, r.zoekterm, p.title, p.g, r.orders || "", r.vol || "", r.src, r.n, "Direct",
        `Collectie aanvullen: ${p.title} ${p.current} → ${plan.target} · ${r.src === "Verkocht" ? `${r.orders} orders in 60 d` : `zoekvolume ${r.vol}`} · al ${r.onStore} op de collectie`,
      ]);
    }
  }
  const right = [["Collectie", "Groep", "Nu (actief)", "Doel", "Tekort", "Ingepland", "Keywords", "Opmerking"]];
  for (const p of plan.plans) {
    right.push([p.title, p.g, p.current, plan.target, p.need, p.planned || 0, p.rows.length, (p.notes || []).join(" · ")]);
  }
  const nRows = Math.max(left.length, right.length);
  const values = [];
  for (let i = 0; i < nRows; i++) {
    const a = left[i] || new Array(10).fill("");
    const b = right[i] || new Array(8).fill("");
    values.push([...a, "", ...b]);
  }
  const made = await addTab(id, title, { rows: nRows + 2, cols: 19 });
  if (!made.ok) throw httpErr(422, made.error);
  await updateValues(id, `${a1Tab(title)}!A1`, values);
  const widths = [50, 210, 190, 55, 80, 110, 120, 95, 70, 420, 20, 200, 55, 80, 55, 65, 75, 75, 300];
  const reqs = [
    { updateSheetProperties: { properties: { sheetId: made.tabId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { repeatCell: { range: { sheetId: made.tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
    { repeatCell: { range: { sheetId: made.tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 11, endColumnIndex: 19 }, cell: { userEnteredFormat: { backgroundColor: DARK, textFormat: { bold: true, foregroundColor: WHITE } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
    { repeatCell: { range: { sheetId: made.tabId, startRowIndex: 1, endRowIndex: nRows, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
    ...widths.map((px, i) => ({ updateDimensionProperties: { range: { sheetId: made.tabId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } })),
  ];
  await spreadsheetBatchUpdate(id, reqs).catch(() => {});
  // terugleescontrole: leest de scraper wat we bedoelden?
  const back = await readRange(id, `${a1Tab(title)}!A1:J`).catch(() => []);
  const okHead = back[0] && /^keyword/i.test(String(back[0][1] || "")) && /^groep/i.test(String(back[0][3] || "")) && /^aantal/i.test(String(back[0][7] || ""));
  const products = back.slice(1).reduce((s, r) => s + (Number(r[7]) || 0), 0);
  return {
    ok: true,
    tab: title,
    url: sheetUrl(id, made.tabId),
    keywords: rank,
    products,
    scrapeReady: !!okHead && products === plan.plans.reduce((s, p) => s + (p.planned || 0), 0),
  };
}
