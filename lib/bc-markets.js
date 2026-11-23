// BIG COMPETITORS — markten en standaardwaarden (23-11-2026, projectdoc 205).
// Puur JavaScript zonder server-imports: de pagina én de server gebruiken dit.
//
// Justin (23-11): "Dit doen we voor UK, Canada en USA voor nu. Australië
// laten we even links liggen." Onder de concurrent: USA $5, UK £5, Canada
// CA$5 (misschien 10) — per markt in te stellen op de pagina.

export const BC_MARKETS = [
  { key: "USA", label: "USA", currency: "USD", symbol: "$" },
  { key: "UK", label: "UK", currency: "GBP", symbol: "£" },
  { key: "CAN", label: "Canada", currency: "CAD", symbol: "CA$" },
];
export const BC_MARKET_KEYS = BC_MARKETS.map((m) => m.key);

export function bcMarket(key) {
  const k = String(key || "").toUpperCase().trim();
  return BC_MARKETS.find((m) => m.key === k) || null;
}

export const BC_DEFAULTS = {
  undercut: 5, // zoveel onder de prijs van de competitor (in de valuta van de markt)
  maxPerRun: 120, // max nieuwe producten per markt per scan — de rest schuift door naar de volgende nacht
  maxAgeDays: 90, // "nieuw" = hooguit zo lang geleden toegevoegd bij de competitor
  minVisits: 200000, // richtlijn: big competitor = ≥ 200k bezoek per maand
};

/* Stores die Justin zelf bij een markt noemde maar die in het store-profiel
   nog onder een andere markt staan (EMC ging 23-11 van AUS naar USA en is
   alleen heren). Alleen een startwaarde: per markt zet je stores aan/uit op
   de pagina. match = publiek domein en/of myshopify-domein. */
export const BC_EXTRA_STORES = {
  USA: [{ match: ["evermanclothing.com", "va3wjr-27.myshopify.com"], genders: "M" }],
};

/* De Competitor Import Sheets die Justin op 23-11-2026 klaarzette (map "Big
   Competitor import sheets", gedeeld met attoh-sheets@…). Startwaarde per
   markt: een link op de pagina of in het store-geheugen gaat voor. */
export const BC_DEFAULT_SHEETS = {
  USA: "1O2ntpF2Ib2ClgR76XA6Q5qe1CBdViPDNvPkr7uPoxBk",
  UK: "11FtiIlrWCKc-h5CL7TNpE6LyzC8EIutERFcZlyKVWRM",
  CAN: "19EjRA4rAUh68KLilPVN99e-6fRIoE172cJ5ijyIoAg4",
};
