// MARKET SWITCHES (24-11-2026) — een store die van markt wisselt.
//
// Justin (24-11): "We hebben een market switch gedaan … vanaf vandaag kan je
// tellen als US dollar. Houd er rekening mee in de sheets, houd er rekening
// mee overal." Eén plek in de tool die weet wanneer een store van markt en
// valuta wisselde, zodat:
//   - geld per dag in de juiste valuta telt (oude orders houden hun oude
//     valuta: t/m 23-11 AUD, vanaf 24-11 USD — AUD verdwijnt niet uit de som);
//   - cijfers die bepalen "wat verkoopt" (TPK, aanvulplan, Big Competitors,
//     Pythago-vensters) alleen de nieuwe markt meetellen;
//   - markt-afhankelijke dingen (maattabellen, schoenmaten, keyword-geheugen)
//     de nieuwe markt gebruiken.
//
// Puur JavaScript zonder server-imports: pagina's én server gebruiken dit.
// Dag = kalenderdag in Londen, dezelfde afspraak als het omzet-dashboard en
// de P&L-sheets.

export const MARKET_SWITCHES = [
  {
    key: "EMC",
    name: "Everman Clothing",
    domains: ["evermanclothing.com", "va3wjr-27.myshopify.com"],
    nameRe: /everman\s*clothing|^everman/i,
    date: "2026-11-24", // eerste dag in de nieuwe markt
    from: { market: "AUS", currency: "AUD" },
    to: { market: "USA", currency: "USD" },
  },
];

const TZ = "Europe/London";
const DAY = 86400000;

function cleanHost(v) {
  return String(v || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

/** Londen-kalenderdag (yyyy-mm-dd) van een moment. */
export function londonYmd(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
}

/** Middernacht in Londen op yyyy-mm-dd → ISO-tijd (UTC). */
export function londonMidnightIsoOf(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(guess));
  const hh = Number((parts.find((p) => p.type === "hour") || {}).value || 0) % 24;
  const mm = Number((parts.find((p) => p.type === "minute") || {}).value || 0);
  return new Date(guess - (hh * 60 + mm) * 60000).toISOString();
}

/**
 * De market switch van een store, of null. `x` = domein/URL (publiek of
 * myshopify), of een store-object ({ domain, publicDomain, name, myshopify }).
 */
export function marketSwitchFor(x) {
  if (!x) return null;
  const hosts = [];
  let name = "";
  if (typeof x === "string") hosts.push(cleanHost(x));
  else {
    for (const k of ["domain", "publicDomain", "myshopify", "shop", "url"]) if (x[k]) hosts.push(cleanHost(x[k]));
    name = String(x.name || "");
  }
  for (const sw of MARKET_SWITCHES) {
    if (hosts.some((h) => h && sw.domains.some((d) => h === d || h.endsWith(`.${d}`)))) return sw;
    if (name && sw.nameRe && sw.nameRe.test(name)) return sw;
  }
  return null;
}

/** Hele dagen sinds de switch (0 op de dag zelf, negatief ervoor), of null zonder switch. */
export function daysSinceSwitch(x, now = Date.now()) {
  const sw = marketSwitchFor(x);
  if (!sw) return null;
  const start = Date.parse(londonMidnightIsoOf(sw.date));
  return Math.floor((Number(now) - start) / DAY);
}

/** Geldt de nieuwe markt al (vandaag ≥ switchdatum)? */
export function switchActive(x, now = Date.now()) {
  const n = daysSinceSwitch(x, now);
  return n != null && n >= 0;
}

/** Valuta van de store op een Londen-dag (yyyy-mm-dd), of null zonder switch. */
export function currencyOnDay(x, ymd) {
  const sw = marketSwitchFor(x);
  if (!sw) return null;
  return String(ymd) >= sw.date ? sw.to.currency : sw.from.currency;
}

/** Markt van de store op een Londen-dag (standaard vandaag), of null zonder switch. */
export function marketOnDay(x, ymd = londonYmd()) {
  const sw = marketSwitchFor(x);
  if (!sw) return null;
  return String(ymd) >= sw.date ? sw.to.market : sw.from.market;
}

/**
 * Begin van "nieuwe-markt-data": de ISO-tijd van de switch als die binnen het
 * gevraagde venster valt (vanaf `fromIso`), anders `fromIso` zelf.
 * Geeft { fromIso, clamped, sw }.
 */
export function clampFromIso(x, fromIso, now = Date.now()) {
  const sw = marketSwitchFor(x);
  if (!sw || !switchActive(x, now)) return { fromIso, clamped: false, sw: null };
  const swIso = londonMidnightIsoOf(sw.date);
  if (Date.parse(swIso) > Date.parse(fromIso)) return { fromIso: swIso, clamped: true, sw };
  return { fromIso, clamped: false, sw };
}

/**
 * Grootste Pythago-venster (dagen) dat helemaal ná de switch valt.
 * Geen switch of lang genoeg geleden → het grootste venster; te kort na de
 * switch → 0 (dan tellen de vensters nog cijfers uit de oude markt mee).
 */
export function cleanWindow(x, windows = [30, 14, 7], now = Date.now()) {
  const list = [...windows].map(Number).filter((w) => w > 0).sort((a, b) => b - a);
  const max = list[0] || 30;
  const n = daysSinceSwitch(x, now);
  if (n == null || n >= max) return max;
  for (const w of list) if (n >= w) return w;
  return 0;
}

/** Korte uitleg voor in de tool, bv. "market switch 24-11 (AUS → USA)". */
export function switchLabel(x) {
  const sw = marketSwitchFor(x);
  if (!sw) return "";
  const [, m, d] = sw.date.split("-");
  return `market switch ${Number(d)}-${Number(m)} (${sw.from.market} → ${sw.to.market})`;
}
