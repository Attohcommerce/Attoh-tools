// COMPETITOR FINDER — zoekopdrachten-pool per markt (03-11-2026).
//
// Justin zoekt op Google met de producttitels van goed draaiende dropship-
// stores ("Women's Cocktail Dress | Square Neck Corset Bodycon Mini"). Dat
// doet de tool nu zelf: per markt de beste stores uit de competitor-sheet
// (hoogste bezoek), hun products.json ophalen, titels schoonmaken en als
// zoekopdrachten bewaren (Redis cf:pool:v1:<markt>). Elke scan gebruikt een
// volgend deel van de pool (rotatie), zodat je elke week andere stores vindt.
// De pool ververst zichzelf na 7 dagen en groeit mee met de sheet.
//
// Geen store in de sheet voor een markt? Dan de vaste startset uit
// lib/finder-queries.js (in de code → pushbaar, overal beschikbaar), en
// voor Engelse markten ook de Engelse standaardset.
import { fetchJson } from "./scrape.js";
import { readRange, listTabs } from "./sheets.js";
import { getJSON, setJSON } from "./finder-redis.js";
import { MARKETS, marketByKey, DEFAULT_QUERIES_EN, isEnglishMarket } from "./finder-markets.js";
import { SEED } from "./finder-queries.js";

const POOL_TTL_MS = 7 * 24 * 3600 * 1000;
const STORES_PER_MARKET = 4;
const TITLES_PER_STORE = 60;
const poolKey = (k) => `cf:pool:v1:${String(k).toUpperCase()}`;
const rotKey = (k) => `cf:rot:v1:${String(k).toUpperCase()}`;

/* ---------------- stores per markt uit de sheet ---------------- */

const DOMAIN_RE = /^(https?:\/\/)?(www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i;
const MARKET_ALIAS = { US: "USA", GB: "UK", AU: "AUS", CA: "CANADA", CAN: "CANADA", NL: "NL/BE", BE: "NL/BE", NLBE: "NL/BE" };

function cleanDom(v) {
  return String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}
function parseNum(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/[!\s]/g, "");
  if (!s) return null;
  const m = s.match(/^([\d.,]+)([km])?/);
  if (!m) return null;
  let num = m[1];
  if (m[2]) {
    num = num.replace(",", ".");
    const parts = num.split(".");
    if (parts.length > 2) num = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
    const v2 = parseFloat(num);
    return isFinite(v2) ? Math.round(v2 * (m[2] === "m" ? 1e6 : 1e3)) : null;
  }
  const n = parseInt(num.replace(/[.,]/g, ""), 10);
  return isFinite(n) ? n : null;
}

/** Rijen van één tab → store-records (pure functie, testbaar). */
export function rowsToStores(values, out = new Map()) {
  const labels = new Set(MARKETS.map((m) => m.key.toUpperCase()));
  {
    for (const row of values || []) {
      const cells = (row || []).slice(0, 8).map((c) => String(c ?? "").trim());
      let domain = "";
      for (const c of cells) {
        if (!c || c.length > 1200 || !DOMAIN_RE.test(c)) continue;
        const d = cleanDom(c);
        if (d && !/(^|\.)google\.|docs\.|sheets\./.test(d)) {
          domain = d;
          break;
        }
      }
      if (!domain) continue;
      let market = "";
      for (const c of cells) {
        const u = c.toUpperCase();
        const k = MARKET_ALIAS[u] || u;
        if (labels.has(k)) {
          market = k;
          break;
        }
      }
      if (!market) continue;
      const nums = cells.map(parseNum).filter((n) => n !== null && n > 0).sort((a, b) => b - a);
      const visits = nums.length >= 2 ? nums[0] : nums.length === 1 && nums[0] >= 5000 ? nums[0] : 0;
      const products = nums.length >= 2 ? nums[1] : nums.length === 1 && nums[0] < 5000 ? nums[0] : 0;
      const key = `${market}|${domain}`;
      const prev = out.get(key);
      if (!prev || visits > prev.visits) out.set(key, { domain, market, visits, products });
    }
  }
  return out;
}

/** Alle store-rijen uit alle tabs: [{domain, market, visits, products}]. */
export async function readSheetStores(sheetId) {
  let tabs = [];
  try {
    tabs = (await listTabs(sheetId)).map((t) => t.title);
  } catch {
    return [];
  }
  const out = new Map();
  for (const title of tabs) {
    let values = [];
    try {
      values = (await readRange(sheetId, `'${String(title).replace(/'/g, "''")}'!A1:H2000`)) || [];
    } catch {
      continue;
    }
    rowsToStores(values, out);
  }
  return [...out.values()];
}

/** Top-n op bezoek + 2 willekeurige andere (meer spreiding in categorieën). */
export function bestStoresFor(stores, marketKey, n = STORES_PER_MARKET) {
  const k = String(marketKey).toUpperCase();
  const all = stores.filter((s) => s.market === k).sort((a, b) => (b.visits || 0) - (a.visits || 0));
  const top = all.slice(0, n);
  const rest = all.slice(n);
  for (let i = 0; i < 2 && rest.length; i++) top.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  return top;
}

/* ---------------- titels schoonmaken ---------------- */

const GARMENT = /\b(dress|top|sweater|jumper|cardigan|hoodie|sweatshirt|jacket|coat|parka|blazer|vest|gilet|pants|trousers|jeans|skirt|blouse|shirt|polo|tee|t-shirt|boots?|loafers?|sneakers?|sandals?|heels?|flats|mules|bag|set|jumpsuit|romper|shorts|leggings|scarf|gloves|hat|beanie|cap|overshirt|chinos|joggers|tracksuit|kimono|poncho|cape|bodysuit|corset|lingerie|pajama|pyjama|robe|jurk|jas|trui|broek|laarzen|laars|rok|vest|mantel|blouse|shirt|schoenen|sneakers|hoodie|sweater|pull|manteau|veste|pantalon|bottes?|jupe|chemise|chemisier|robe|gilet|doudoune|baskets|mocassins|kleid|pullover|jacke|mantel|hose|stiefel|rock|bluse|hemd|strickjacke|sukienka|sweter|kurtka|p[łl]aszcz|spodnie|buty|sp[óo]dnica|bluzka|koszula|vestido|chaqueta|abrigo|pantal[oó]n|botas|falda|blusa|camisa|su[ée]ter|jersey|vestito|giacca|cappotto|pantaloni|stivali|gonna|camicia|maglione|ruha|kab[aá]t|nadr[aá]g|csizma|szoknya|rochie|jacheta|palton|pantaloni|cizme|fusta|[šs]aty|bunda|kab[áa]t|kalhoty|sukn[eě]|kl[äa]nning|jacka|kappa|byxor|st[öo]vlar|kjol|kjole|bukser|st[øo]vler|nederdel|mekko|takki|housut|saappaat|hame|φόρεμα|μπουφάν|παλτό|παντελόνι|μπότες|φούστα)\b/i;

function stripPrefix(title) {
  let t = String(title || "").replace(/[™®©]/g, "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // "Harper | Ribbed Turtleneck Sweater Dress" / "Ayrana - Long Leopard Print Dress"
  const m = t.match(/^(.{1,40}?)(?:\s*\|\s*|\s+[–—-]\s+)(.+)$/);
  if (m) {
    const pre = m[1].trim();
    const post = m[2].trim();
    if (pre.split(/\s+/).length <= 3 && !GARMENT.test(pre) && post.split(/\s+/).length >= 2) t = post;
  }
  return t.trim();
}

/* Voornaam vóór de titel ("Selena-Faye Cashmere Sweater", "Ayrana Long Dress"):
   namen zijn uniek in een catalogus, bijvoeglijke naamwoorden ("Ribbed",
   "Cozy") komen terug. Dus: eerste woord weg als het maar één keer als
   eerste woord voorkomt in deze lijst, met hoofdletter, geen kledingwoord,
   en er daarna nog ≥ 3 woorden overblijven. Dubbele namen met streepje
   ("Selena-Faye") altijd weg. */
function stripFirstNames(titles) {
  const freq = new Map();
  for (const t of titles) {
    const w = t.split(/\s+/)[0] || "";
    freq.set(w.toLowerCase(), (freq.get(w.toLowerCase()) || 0) + 1);
  }
  return titles.map((t) => {
    const w = t.split(/\s+/);
    if (w.length < 3) return t;
    const first = w[0];
    const dbl = /^[A-Z][a-z]{2,}-[A-Z][a-z]{2,}$/.test(first);
    const single = w.length >= 4 && /^[A-Z][a-z]{2,}$/.test(first) && (freq.get(first.toLowerCase()) || 0) === 1;
    if ((dbl || single) && !GARMENT.test(first) && !/^(women|womens|men|mens|ladies|new|the|chic|elegant|casual|classic|vintage|luxury|premium|cozy|warm|soft|basic|dames|heren|damen|herren|femme|homme|mujer|hombre|donna|uomo)$/i.test(first)) {
      return w.slice(1).join(" ");
    }
    return t;
  });
}

export function cleanTitles(titles, max = TITLES_PER_STORE) {
  const seen = new Set();
  const out = [];
  const pre = (titles || []).map(stripPrefix).filter(Boolean);
  for (const t of stripFirstNames(pre)) {
    if (!t) continue;
    const words = t.split(/\s+/).length;
    if (words < 3 || words > 14) continue;
    if (/\b(gift ?card|cadeaubon|e-?gift|sample|test product|tip jar)\b/i.test(t)) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function titlesFromStore(domain) {
  const r = await fetchJson(`https://${domain}/products.json?limit=250`, 8000);
  if (!r.ok || !r.data || !Array.isArray(r.data.products)) return [];
  // spreiding: niet alleen de nieuwste → elke n-de titel + de eerste 30
  const all = r.data.products.map((p) => p.title);
  const step = Math.max(1, Math.floor(all.length / 90));
  const picked = [...all.slice(0, 30), ...all.filter((_, i) => i % step === 0)];
  return cleanTitles(picked, TITLES_PER_STORE);
}

/* ---------------- pool bouwen / lezen ---------------- */

export function seedQueries(marketKey) {
  const m = marketByKey(marketKey);
  if (!m) return [];
  const own = Array.isArray(SEED[m.key]) ? SEED[m.key] : [];
  const byLang = Array.isArray(SEED[m.hl]) ? SEED[m.hl] : [];
  const en = isEnglishMarket(m) ? DEFAULT_QUERIES_EN : [];
  const seen = new Set();
  return [...own, ...byLang, ...en].filter((q) => {
    const k = String(q).toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function getPool(marketKey) {
  return getJSON(poolKey(marketKey));
}

/**
 * ensurePool(marketKey, { sheetStores, force }) → { titles, stores, at, fresh, source }
 *   sheetStores = uitkomst van readSheetStores (één keer per run ophalen)
 */
export async function ensurePool(marketKey, { sheetStores = [], force = false } = {}) {
  const m = marketByKey(marketKey);
  if (!m) return { titles: [], stores: [], at: 0, source: "none" };
  const cur = await getPool(m.key);
  if (!force && cur && cur.at && Date.now() - cur.at < POOL_TTL_MS && Array.isArray(cur.titles) && cur.titles.length) {
    return { ...cur, fresh: false };
  }
  const best = bestStoresFor(sheetStores, m.key);
  const perStore = await Promise.all(best.map((s) => titlesFromStore(s.domain).catch(() => [])));
  const titles = [];
  const stores = [];
  best.forEach((s, i) => {
    stores.push({ domain: s.domain, visits: s.visits, titles: perStore[i].length });
    titles.push(...perStore[i]);
  });
  // seeds erachter (altijd), zodat ook categorie-keywords meegaan
  const seen = new Set();
  const all = [...titles, ...seedQueries(m.key)].filter((q) => {
    const k = q.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const pool = { titles: all, stores, at: Date.now(), source: titles.length ? "sheet-stores+seed" : "seed" };
  if (all.length) await setJSON(poolKey(m.key), pool);
  return { ...pool, fresh: true };
}

/** Volgend deel van de pool (rotatie per markt), n zoekopdrachten. */
export async function takeQueries(marketKey, pool, n) {
  const titles = (pool && pool.titles) || [];
  if (!titles.length) return [];
  const want = Math.max(1, Math.min(titles.length, Number(n) || titles.length));
  const rot = (await getJSON(rotKey(marketKey))) || { offset: 0 };
  let offset = Number(rot.offset) || 0;
  if (offset >= titles.length) offset = 0;
  const out = [];
  for (let i = 0; i < want; i++) out.push(titles[(offset + i) % titles.length]);
  await setJSON(rotKey(marketKey), { offset: (offset + want) % titles.length, at: Date.now() });
  return out;
}

export const POOL_INFO = { STORES_PER_MARKET, TITLES_PER_STORE, POOL_TTL_MS };
