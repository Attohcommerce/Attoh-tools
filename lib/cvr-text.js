// CONVERSION BOOSTER — plakklare tekst voor Claude (23-10-2026, projectdoc 64).
// Puur JavaScript zonder imports: de Pythago-pagina bouwt de tekst in de
// browser (zodat "kopieer" binnen de klik gebeurt) én de server zet dezelfde
// tekst in het CVR BOOST-blad.

const sym = (c) => (c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : c === "AUD" ? "A$" : c === "NZD" ? "NZ$" : c === "CAD" ? "C$" : `${c || ""} `);
const n2 = (x) => (x == null || x === "" ? "—" : Number(x).toFixed(2));
const n0 = (x) => (x == null || x === "" ? "—" : String(Math.round(Number(x))));
const pct = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : `${(Number(x) * 100).toFixed(1)}%`);

/** Regels per product voor de Claude-tekst en voor het blad (kolom "Voor Claude"). */
export function itemLines(it, { cur, shopCur } = {}) {
  const m = it.m || {};
  const L = it.listing || {};
  const a = it.ai || {};
  const money = (x) => (x == null ? "—" : `${sym(cur)}${n2(x)}`);
  const price = (x) => (x == null || x === "" ? "—" : `${sym(shopCur)}${n2(x)}`);
  const lines = [];
  lines.push(`${it.title}${it.productId ? ` — ID ${it.productId}` : ""}${it.adminUrl ? ` · admin: ${it.adminUrl}` : ""}${it.storeUrl ? ` · store: ${it.storeUrl}` : ""}`);
  lines.push(
    `30 d: ${money(m.spend30)} spend · ${n0(m.clicks30)} klikken · CTR ${pct(m.ctr)} · CPC ${money(m.cpc)} · ${n0(m.orders30)} orders · ${money(m.rev30)} omzet · ROAS ${n2(m.roas30)} · G-conv ${n2(m.gconv30)}${m.cpo != null ? ` · ${n0(m.cpo)} klikken per order` : ""}` +
      ` | 14 d: ${money(m.spend14)} · ${n0(m.orders14)} orders · ROAS ${n2(m.roas14)} | 7 d: ${money(m.spend7)} · ${n0(m.orders7)} orders`
  );
  const sold = L.soldOut ? `${L.soldOut} uitverkocht${L.soldOutNames && L.soldOutNames.length ? ` (${L.soldOutNames.join(", ")})` : ""}` : "niets uitverkocht";
  lines.push(
    `Listing: ${price(L.price)}${L.compareAt ? ` (compare-at ${price(L.compareAt)}${L.discountPct ? `, −${L.discountPct}%` : ""})` : ""} · ${L.images ?? "—"} foto's · ${L.variants ?? "—"} varianten, ${sold} · ${L.age ?? "—"} dagen live · size guide ${L.sizeGuide ? "ja" : "nee"}${L.type ? ` · type ${L.type}` : ""}${L.issues ? ` · feed: ${L.issues}` : ""}`
  );
  if (it.typeStat) lines.push(`Zelfde type in deze run: ${it.typeStat}`);
  if (a.verdict) {
    lines.push(`AI: ${String(a.verdict).toUpperCase()}${a.prio ? ` · prio ${a.prio}` : ""}${a.cause ? ` · oorzaak ${a.cause}` : ""}${a.report ? ` · "${a.report}"` : ""}`);
    if (Array.isArray(a.actions) && a.actions.length) lines.push(`Acties: ${a.actions.map((x, i) => `${i + 1}) ${x}`).join(" ")}`);
  }
  return lines;
}

/**
 * Hele tekst voor Claude. run = { storeName, domain, tab, period, cur, shopCur, be, summary, items }
 */
export function buildClaudeText(run) {
  const items = (run.items || []).filter((it) => it && it.title);
  const head = [
    `${run.tab || "CVR BOOST"} · ${run.storeName || run.domain || "store"} · Ads-data ${run.period && run.period.from ? `${run.period.from} t/m ` : "t/m "}${(run.period && run.period.to) || "?"} · ${items.length} product${items.length === 1 ? "" : "en"}${run.candidates ? ` (van ${run.candidates} kandidaten)` : ""} · break-even ROAS ${n2(run.be)} · Ads in ${run.cur || "GBP"}, prijzen in ${run.shopCur || "?"}`,
    `Opdracht: per product de listing verbeteren zodat de spend beter converteert — titel (listing-formule, 1 pipe), omschrijving, foto's en volgorde, prijs (binnen het rooster X4,95/X9,95, geen prijsschommeling i.v.m. GMC), maten/voorraad, size guide. Wijzigingen direct doorvoeren in Shopify en per product kort melden wat er is veranderd. Niet draften — dat doet Pythago na het boost-venster.`,
  ];
  if (run.summary) head.push(`Samenvatting tool: ${run.summary}`);
  const body = items.map((it, i) => {
    const lines = itemLines(it, { cur: run.cur, shopCur: run.shopCur });
    return `${i + 1}. ${lines[0]}\n${lines.slice(1).map((l) => `   ${l}`).join("\n")}`;
  });
  return `${head.join("\n")}\n\n${body.join("\n\n")}\n`;
}

export const CVR_SYM = sym;
