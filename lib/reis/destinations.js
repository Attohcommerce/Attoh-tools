// ATTOH REISPLANNER — bestemmingen-database (27-10-2026)
//
// Per bestemming: luchthaven(s), vlieguren vanaf AMS, vibes, strandkwaliteit
// (0–10, "echt mooi strand" = 8+), gemiddelde maximumtemperatuur per maand
// (jan..dec, °C, afgerond), en twee SCHATTINGEN die alleen gebruikt worden
// als er (nog) geen live prijsbron gekoppeld is:
//   hotelEst  = typische prijs per nacht, 4★+ met zwembad, 2 personen (EUR)
//   flightEst = typische retour per persoon buiten de schoolvakanties (EUR)
// `lite` = stadsnaam zoals de hotel-API (LiteAPI) hem kent.
//
// Vibes: zon · strand · cultuur · stad · natuur · party · toerisme

export const VIBES = [
  { id: "zon", label: "Zon", icon: "☀" },
  { id: "strand", label: "Mooi strand", icon: "◠" },
  { id: "cultuur", label: "Cultuur", icon: "⌂" },
  { id: "stad", label: "Stad", icon: "▦" },
  { id: "natuur", label: "Natuur", icon: "▲" },
  { id: "party", label: "Party", icon: "✦" },
  { id: "toerisme", label: "Toerisme", icon: "◎" },
];

const D = (id, city, country, cc, iata, region, hours, tags, beach, temp, hotelEst, flightEst, lite) => ({
  id, city, country, cc, iata, region, hours, tags, beach, temp, hotelEst, flightEst, lite: lite || city,
});

export const DESTINATIONS = [
  // ── Turkije
  D("antalya", "Antalya", "Turkije", "TR", ["AYT"], "Middellandse Zee", 3.8, ["zon", "strand", "toerisme", "cultuur"], 7, [15,16,18,22,26,31,34,34,31,26,21,17], 90, 280),
  D("dalaman", "Dalaman · Fethiye", "Turkije", "TR", ["DLM"], "Middellandse Zee", 3.7, ["zon", "strand", "natuur"], 9, [15,16,18,21,26,31,34,34,30,25,20,16], 95, 290, "Fethiye"),
  D("kusadasi", "Kuşadası · Izmir", "Turkije", "TR", ["ADB"], "Middellandse Zee", 3.4, ["strand", "cultuur", "zon"], 6, [13,14,17,21,26,31,34,34,30,25,19,15], 85, 270, "Kusadasi"),
  D("bodrum", "Bodrum", "Turkije", "TR", ["BJV"], "Middellandse Zee", 3.6, ["zon", "strand", "party"], 8, [15,15,17,20,25,30,33,33,29,25,20,16], 110, 290),
  D("istanbul", "Istanbul", "Turkije", "TR", ["IST", "SAW"], "Europa", 3.3, ["stad", "cultuur", "toerisme"], 2, [9,10,12,17,22,27,29,29,26,20,15,11], 100, 220),
  // ── Spanje + Canarische Eilanden
  D("malaga", "Málaga · Costa del Sol", "Spanje", "ES", ["AGP"], "Middellandse Zee", 2.8, ["zon", "strand", "stad", "cultuur"], 6, [17,18,20,22,25,29,31,31,28,24,20,18], 120, 220, "Marbella"),
  D("tenerife", "Tenerife", "Spanje", "ES", ["TFS"], "Canarische Eilanden", 4.5, ["zon", "strand", "natuur", "toerisme"], 6, [21,21,22,23,24,26,28,29,28,26,24,22], 110, 300, "Adeje"),
  D("grancanaria", "Gran Canaria", "Spanje", "ES", ["LPA"], "Canarische Eilanden", 4.4, ["zon", "strand", "toerisme"], 7, [21,21,22,22,23,24,26,27,27,26,24,22], 110, 300, "Maspalomas"),
  D("lanzarote", "Lanzarote", "Spanje", "ES", ["ACE"], "Canarische Eilanden", 4.2, ["zon", "strand", "natuur"], 7, [21,22,24,25,26,28,29,30,29,27,25,22], 105, 290, "Playa Blanca"),
  D("fuerteventura", "Fuerteventura", "Spanje", "ES", ["FUE"], "Canarische Eilanden", 4.3, ["zon", "strand"], 8, [21,21,23,24,25,26,28,29,28,27,24,22], 100, 290, "Corralejo"),
  D("mallorca", "Mallorca", "Spanje", "ES", ["PMI"], "Middellandse Zee", 2.2, ["zon", "strand", "party", "natuur"], 8, [15,15,17,20,23,28,31,31,28,24,19,16], 130, 200, "Palma de Mallorca"),
  D("ibiza", "Ibiza", "Spanje", "ES", ["IBZ"], "Middellandse Zee", 2.4, ["party", "strand", "zon"], 8, [16,16,18,20,23,27,30,31,28,24,20,17], 170, 230),
  D("barcelona", "Barcelona", "Spanje", "ES", ["BCN"], "Europa", 2.1, ["stad", "cultuur", "party", "strand"], 5, [14,15,17,19,23,27,29,29,26,22,17,14], 150, 180),
  D("menorca", "Menorca", "Spanje", "ES", ["MAH"], "Middellandse Zee", 2.3, ["strand", "natuur", "zon"], 9, [14,14,16,18,22,27,30,30,27,23,18,15], 130, 220, "Ciutadella"),
  D("lapalma", "La Palma", "Spanje", "ES", ["SPC"], "Canarische Eilanden", 4.5, ["natuur", "zon"], 4, [20,20,21,21,22,24,26,27,27,25,23,21], 100, 320, "Los Llanos de Aridane"),
  D("costablanca", "Alicante · Costa Blanca", "Spanje", "ES", ["ALC"], "Middellandse Zee", 2.6, ["zon", "strand", "party"], 7, [17,18,20,22,25,29,32,32,29,25,21,18], 110, 200, "Benidorm"),
  D("valencia", "Valencia", "Spanje", "ES", ["VLC"], "Europa", 2.4, ["stad", "strand", "cultuur"], 5, [16,17,19,21,24,28,30,31,28,24,20,17], 120, 190),
  D("costabrava", "Costa Brava", "Spanje", "ES", ["GRO"], "Middellandse Zee", 2.0, ["strand", "natuur", "cultuur"], 7, [13,14,16,18,22,26,29,29,26,22,17,14], 130, 190, "Lloret de Mar"),
  // ── Portugal
  D("algarve", "Algarve", "Portugal", "PT", ["FAO"], "Atlantische kust", 2.9, ["zon", "strand", "natuur"], 9, [16,17,19,21,23,27,29,29,27,24,19,17], 120, 230, "Albufeira"),
  D("madeira", "Madeira", "Portugal", "PT", ["FNC"], "Atlantische kust", 4.0, ["natuur", "zon", "toerisme"], 3, [19,19,20,20,21,23,25,26,26,24,22,20], 110, 300, "Funchal"),
  D("lissabon", "Lissabon", "Portugal", "PT", ["LIS"], "Europa", 2.8, ["stad", "cultuur", "strand"], 5, [15,16,19,20,23,27,29,29,27,23,18,15], 130, 200, "Lisbon"),
  D("porto", "Porto", "Portugal", "PT", ["OPO"], "Europa", 2.4, ["stad", "cultuur"], 3, [14,15,17,18,20,23,25,26,24,21,17,14], 110, 190),
  // ── Griekenland
  D("kreta", "Kreta", "Griekenland", "GR", ["HER", "CHQ"], "Middellandse Zee", 3.6, ["strand", "zon", "cultuur", "natuur"], 8, [15,16,17,20,24,28,29,29,27,24,20,17], 100, 290, "Hersonissos"),
  D("rhodos", "Rhodos", "Griekenland", "GR", ["RHO"], "Middellandse Zee", 3.7, ["strand", "zon", "cultuur"], 7, [15,16,18,21,25,29,31,32,29,25,21,17], 95, 280, "Rhodes"),
  D("corfu", "Corfu", "Griekenland", "GR", ["CFU"], "Middellandse Zee", 3.0, ["strand", "natuur", "zon"], 7, [14,15,17,20,24,29,32,32,28,23,19,15], 100, 260),
  D("santorini", "Santorini", "Griekenland", "GR", ["JTR"], "Middellandse Zee", 3.6, ["strand", "cultuur", "toerisme"], 6, [14,14,16,19,23,27,29,29,26,23,19,16], 180, 320),
  D("zakynthos", "Zakynthos", "Griekenland", "GR", ["ZTH"], "Middellandse Zee", 3.2, ["strand", "party", "natuur"], 9, [15,15,17,20,24,29,31,32,28,24,20,16], 90, 280),
  D("kos", "Kos", "Griekenland", "GR", ["KGS"], "Middellandse Zee", 3.5, ["strand", "party", "zon"], 7, [15,15,17,20,24,28,31,31,28,24,20,17], 95, 280),
  D("mykonos", "Mykonos", "Griekenland", "GR", ["JMK"], "Middellandse Zee", 3.5, ["party", "strand", "zon"], 8, [14,14,16,19,23,27,28,28,26,22,19,16], 200, 330),
  D("athene", "Athene", "Griekenland", "GR", ["ATH"], "Europa", 3.2, ["stad", "cultuur", "toerisme"], 2, [13,14,16,20,25,30,33,33,28,23,18,15], 120, 230, "Athens"),
  // ── Italië, Malta, Kroatië, Cyprus
  D("sicilie", "Sicilië", "Italië", "IT", ["CTA", "PMO"], "Middellandse Zee", 2.8, ["cultuur", "strand", "natuur"], 6, [15,15,17,20,24,29,32,32,29,24,20,16], 110, 230, "Taormina"),
  D("sardinie", "Sardinië", "Italië", "IT", ["OLB", "CAG"], "Middellandse Zee", 2.3, ["strand", "natuur", "zon"], 10, [14,14,16,19,23,28,31,31,27,23,18,15], 140, 250, "Olbia"),
  D("rome", "Rome", "Italië", "IT", ["FCO"], "Europa", 2.3, ["stad", "cultuur", "toerisme"], 1, [12,14,16,19,24,28,31,31,27,22,17,13], 140, 190),
  D("puglia", "Puglia", "Italië", "IT", ["BRI"], "Middellandse Zee", 2.4, ["strand", "cultuur", "zon"], 7, [13,14,16,19,23,28,31,31,27,22,18,14], 120, 220, "Polignano a Mare"),
  D("amalfi", "Napels · Amalfikust", "Italië", "IT", ["NAP"], "Middellandse Zee", 2.2, ["cultuur", "natuur", "strand"], 5, [13,14,16,19,23,28,31,31,27,23,18,14], 150, 210, "Sorrento"),
  D("dubrovnik", "Dubrovnik", "Kroatië", "HR", ["DBV"], "Middellandse Zee", 2.3, ["cultuur", "strand", "toerisme"], 6, [12,13,15,18,23,27,30,30,26,22,16,13], 150, 250),
  D("malta", "Malta", "Malta", "MT", ["MLA"], "Middellandse Zee", 2.9, ["cultuur", "strand", "zon"], 5, [16,16,18,20,24,28,31,31,28,25,21,17], 110, 230, "St Julian's"),
  D("split", "Split · Dalmatië", "Kroatië", "HR", ["SPU"], "Middellandse Zee", 2.1, ["strand", "cultuur", "natuur", "party"], 7, [11,12,15,18,23,27,30,30,26,21,16,12], 130, 230, "Split"),
  D("cyprus", "Paphos", "Cyprus", "CY", ["PFO"], "Middellandse Zee", 4.3, ["zon", "strand", "cultuur"], 7, [17,17,19,22,26,30,32,33,31,28,23,19], 100, 300, "Paphos"),
  D("ayianapa", "Ayia Napa · Larnaca", "Cyprus", "CY", ["LCA"], "Middellandse Zee", 4.3, ["strand", "party", "zon"], 9, [17,17,19,22,26,30,32,33,31,28,23,19], 100, 290, "Ayia Napa"),
  // ── Noord-Afrika + Rode Zee + Kaapverdië
  D("hurghada", "Hurghada", "Egypte", "EG", ["HRG"], "Rode Zee", 5.3, ["zon", "strand", "toerisme"], 8, [22,23,26,30,33,35,36,36,34,31,27,23], 70, 330),
  D("marsaalam", "Marsa Alam", "Egypte", "EG", ["RMF"], "Rode Zee", 5.5, ["strand", "natuur", "zon"], 8, [23,24,26,29,32,34,35,35,33,31,28,24], 80, 360, "Marsa Alam"),
  D("sharm", "Sharm el Sheikh", "Egypte", "EG", ["SSH"], "Rode Zee", 5.3, ["zon", "strand", "natuur"], 7, [22,23,26,30,34,37,38,38,36,32,27,23], 75, 340, "Sharm El Sheikh"),
  D("marrakech", "Marrakech", "Marokko", "MA", ["RAK"], "Noord-Afrika", 3.7, ["cultuur", "stad", "zon", "toerisme"], 0, [19,20,23,26,29,33,37,37,32,28,23,20], 90, 230),
  D("agadir", "Agadir", "Marokko", "MA", ["AGA"], "Noord-Afrika", 4.2, ["zon", "strand"], 6, [21,22,23,24,25,26,27,28,27,27,24,22], 80, 260),
  D("djerba", "Djerba", "Tunesië", "TN", ["DJE"], "Noord-Afrika", 3.3, ["zon", "strand"], 6, [16,18,20,23,26,30,33,33,31,27,22,18], 70, 280),
  D("aqaba", "Aqaba · Petra", "Jordanië", "JO", ["AQJ"], "Rode Zee", 5.0, ["natuur", "cultuur", "strand", "zon"], 6, [21,22,26,30,34,37,38,38,36,32,27,22], 90, 350, "Aqaba"),
  D("sal", "Sal", "Kaapverdië", "CV", ["SID"], "Atlantische Oceaan", 6.3, ["zon", "strand"], 8, [24,24,25,25,26,27,28,29,29,29,27,25], 120, 450, "Santa Maria"),
  // ── Midden-Oosten
  D("dubai", "Dubai", "Ver. Arabische Emiraten", "AE", ["DXB"], "Midden-Oosten", 6.5, ["zon", "strand", "stad", "party", "toerisme"], 7, [24,25,28,33,38,40,41,41,39,35,30,26], 130, 450),
  D("abudhabi", "Abu Dhabi", "Ver. Arabische Emiraten", "AE", ["AUH"], "Midden-Oosten", 6.6, ["zon", "strand", "stad", "cultuur"], 7, [24,25,28,33,38,40,41,41,39,35,30,26], 120, 450, "Abu Dhabi"),
  D("oman", "Muscat", "Oman", "OM", ["MCT"], "Midden-Oosten", 7.0, ["natuur", "strand", "cultuur", "zon"], 7, [25,26,29,34,38,40,38,35,35,34,30,27], 120, 500),
  // ── Azië + Indische Oceaan
  D("bangkok", "Bangkok", "Thailand", "TH", ["BKK"], "Zuidoost-Azië", 11.0, ["stad", "cultuur", "party", "toerisme"], 0, [32,33,34,35,34,33,32,32,32,32,31,31], 70, 650),
  D("phuket", "Phuket", "Thailand", "TH", ["HKT"], "Zuidoost-Azië", 12.5, ["strand", "zon", "party", "toerisme"], 8, [32,33,33,33,32,31,31,31,30,31,31,31], 80, 700),
  D("samui", "Koh Samui", "Thailand", "TH", ["USM"], "Zuidoost-Azië", 13.0, ["strand", "zon", "natuur"], 9, [29,30,32,33,33,33,32,32,32,31,29,28], 100, 800, "Koh Samui"),
  D("krabi", "Krabi", "Thailand", "TH", ["KBV"], "Zuidoost-Azië", 12.5, ["strand", "natuur", "zon"], 9, [32,34,34,34,32,31,31,30,30,31,31,31], 75, 720, "Ao Nang"),
  D("chiangmai", "Chiang Mai", "Thailand", "TH", ["CNX"], "Zuidoost-Azië", 13.0, ["cultuur", "natuur"], 0, [29,32,35,36,34,32,31,31,31,31,30,28], 50, 750),
  D("lombok", "Lombok", "Indonesië", "ID", ["LOP"], "Zuidoost-Azië", 16.5, ["strand", "natuur"], 8, [31,31,31,31,31,30,30,30,31,32,32,31], 70, 850, "Senggigi"),
  D("phuquoc", "Phu Quoc", "Vietnam", "VN", ["PQC"], "Zuidoost-Azië", 13.5, ["strand", "zon"], 9, [30,31,32,33,32,31,30,30,30,30,30,30], 70, 800, "Phu Quoc"),
  D("bali", "Bali", "Indonesië", "ID", ["DPS"], "Zuidoost-Azië", 16.0, ["strand", "natuur", "cultuur", "party"], 7, [31,31,31,32,31,30,30,30,31,32,32,31], 70, 800, "Seminyak"),
  D("hcmc", "Ho Chi Minh City", "Vietnam", "VN", ["SGN"], "Zuidoost-Azië", 12.0, ["stad", "cultuur"], 0, [32,33,34,35,34,32,32,32,31,31,31,31], 60, 700),
  D("singapore", "Singapore", "Singapore", "SG", ["SIN"], "Zuidoost-Azië", 12.5, ["stad", "toerisme", "cultuur"], 2, [30,31,32,32,32,31,31,31,31,31,31,30], 160, 750),
  D("malediven", "Malediven", "Malediven", "MV", ["MLE"], "Indische Oceaan", 11.0, ["strand", "zon"], 10, [30,31,32,32,32,31,31,30,30,30,30,30], 250, 800, "Male"),
  D("srilanka", "Sri Lanka", "Sri Lanka", "LK", ["CMB"], "Indische Oceaan", 11.0, ["strand", "cultuur", "natuur"], 8, [30,31,32,32,31,30,30,30,30,30,30,30], 80, 700, "Bentota"),
  D("mauritius", "Mauritius", "Mauritius", "MU", ["MRU"], "Indische Oceaan", 12.0, ["strand", "natuur", "zon"], 9, [30,31,30,29,27,25,25,25,26,27,28,30], 150, 850, "Flic en Flac"),
  D("seychellen", "Seychellen", "Seychellen", "SC", ["SEZ"], "Indische Oceaan", 12.0, ["strand", "natuur"], 10, [29,30,31,31,30,29,28,28,29,29,30,29], 220, 900, "Mahe"),
  D("zanzibar", "Zanzibar", "Tanzania", "TZ", ["ZNZ"], "Indische Oceaan", 10.0, ["strand", "zon", "natuur"], 9, [32,32,32,30,29,29,28,28,29,30,31,32], 100, 700, "Nungwi"),
  D("kaapstad", "Kaapstad", "Zuid-Afrika", "ZA", ["CPT"], "Afrika", 11.5, ["natuur", "stad", "strand", "cultuur"], 7, [27,27,26,24,21,19,18,19,20,22,24,26], 110, 850, "Cape Town"),
  // ── Caribisch gebied + Amerika
  D("curacao", "Curaçao", "Curaçao", "CW", ["CUR"], "Caribisch gebied", 10.0, ["strand", "zon", "natuur"], 8, [30,30,30,31,31,32,32,32,32,31,31,30], 140, 750, "Willemstad"),
  D("aruba", "Aruba", "Aruba", "AW", ["AUA"], "Caribisch gebied", 10.0, ["strand", "zon", "party"], 9, [30,30,31,31,32,32,32,33,33,32,31,30], 180, 750, "Palm Beach"),
  D("bonaire", "Bonaire", "Bonaire", "BQ", ["BON"], "Caribisch gebied", 10.0, ["natuur", "zon", "strand"], 6, [30,30,30,31,31,32,32,32,32,31,31,30], 140, 750, "Kralendijk"),
  D("cancun", "Cancún · Riviera Maya", "Mexico", "MX", ["CUN"], "Caribisch gebied", 11.0, ["strand", "party", "cultuur", "zon"], 9, [28,29,30,31,32,33,33,33,32,31,30,28], 130, 750, "Playa del Carmen"),
  D("puntacana", "Punta Cana", "Dominicaanse Republiek", "DO", ["PUJ"], "Caribisch gebied", 9.5, ["strand", "zon"], 9, [29,29,29,30,30,31,31,31,31,31,30,29], 120, 700, "Punta Cana"),
  D("miami", "Miami", "Verenigde Staten", "US", ["MIA"], "Noord-Amerika", 10.0, ["stad", "strand", "party"], 7, [24,25,26,28,30,32,32,33,32,30,27,25], 230, 650, "Miami Beach"),
  D("newyork", "New York", "Verenigde Staten", "US", ["JFK", "EWR"], "Noord-Amerika", 8.0, ["stad", "cultuur", "toerisme", "party"], 1, [4,6,10,17,22,27,30,29,25,19,13,7], 220, 500, "New York"),
];

export const DEST_BY_ID = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d]));
const BY_IATA = {};
for (const d of DESTINATIONS) for (const a of d.iata) BY_IATA[a] = d;
export function destByAirport(code) {
  return BY_IATA[String(code || "").toUpperCase()] || null;
}

// Vertrekvliegvelden. `toAirport` = schatting OV/parkeren heen+terug voor 2
// personen vanuit Noord-Holland (Hoorn) — telt mee in de totaalprijs, want een
// ticket dat €40 goedkoper is vanaf Düsseldorf is niet goedkoper als je er
// €100 voor moet rijden en parkeren.
export const ORIGINS = [
  { code: "AMS", name: "Amsterdam Schiphol", short: "Schiphol", toAirport: 30, def: true },
  { code: "RTM", name: "Rotterdam The Hague", short: "Rotterdam", toAirport: 55, def: true },
  { code: "EIN", name: "Eindhoven", short: "Eindhoven", toAirport: 75, def: true },
  { code: "BRU", name: "Brussel Zaventem", short: "Brussel", toAirport: 110, def: true },
  { code: "DUS", name: "Düsseldorf", short: "Düsseldorf", toAirport: 110, def: true },
  { code: "NRN", name: "Weeze (Niederrhein)", short: "Weeze", toAirport: 95, def: false },
  { code: "CGN", name: "Keulen-Bonn", short: "Keulen", toAirport: 130, def: false },
  { code: "CRL", name: "Brussel-Charleroi", short: "Charleroi", toAirport: 130, def: false },
];
export const ORIGIN_BY_CODE = Object.fromEntries(ORIGINS.map((o) => [o.code, o]));

// Verre reis = meer dan 6 vlieguren → max 1 overstap toegestaan.
export const LONG_HAUL_HOURS = 6;
export function isLongHaul(dest) {
  return (dest && dest.hours) > LONG_HAUL_HOURS;
}

// Maand-index (0..11) → gemiddelde max temp, of null.
export function tempIn(dest, monthIdx) {
  if (!dest || !Array.isArray(dest.temp)) return null;
  return dest.temp[((monthIdx % 12) + 12) % 12];
}

// Landen met hun gebieden (voor de bestemmingskiezer), alfabetisch
export function countriesWithDests() {
  const map = new Map();
  for (const d of DESTINATIONS) {
    if (!map.has(d.country)) map.set(d.country, { country: d.country, cc: d.cc, dests: [] });
    map.get(d.country).dests.push(d);
  }
  return [...map.values()]
    .map((c) => ({ ...c, dests: c.dests.sort((a, b) => a.city.localeCompare(b.city, "nl")) }))
    .sort((a, b) => a.country.localeCompare(b.country, "nl"));
}
