// Maatschappijen: naam, "netjes"-klasse en geschatte prijs ruimbagage
// (EUR per persoon per enkele reis, 20–23 kg). De goedkope vluchtprijs-
// bronnen tonen vaak de prijs ZONDER ruimbagage — dit telt hem er eerlijk
// bij op, zodat een Ryanair-ticket van €49 niet goedkoper lijkt dan hij is.
// tier: 1 = netjes/full service, 2 = prima (leisure/low cost met service),
//       3 = ultra low cost (krappe stoelen, alles extra)
// Bagage 0 = zit (bij economy standaard) inbegrepen.
export const AIRLINES = {
  KL: { name: "KLM", tier: 1, bag: 0, bagShort: 35 },
  HV: { name: "Transavia", tier: 2, bag: 35 },
  OR: { name: "TUI fly", tier: 2, bag: 30 },
  TB: { name: "TUI fly België", tier: 2, bag: 30 },
  CND: { name: "Corendon", tier: 2, bag: 30 },
  XR: { name: "Corendon Airlines Europe", tier: 2, bag: 30 },
  XC: { name: "Corendon Airlines", tier: 2, bag: 30 },
  PC: { name: "Pegasus", tier: 3, bag: 35 },
  TK: { name: "Turkish Airlines", tier: 1, bag: 0 },
  EK: { name: "Emirates", tier: 1, bag: 0 },
  EY: { name: "Etihad", tier: 1, bag: 0 },
  QR: { name: "Qatar Airways", tier: 1, bag: 0 },
  FZ: { name: "flydubai", tier: 2, bag: 25 },
  WY: { name: "Oman Air", tier: 1, bag: 0 },
  LH: { name: "Lufthansa", tier: 1, bag: 35 },
  SN: { name: "Brussels Airlines", tier: 1, bag: 35 },
  LX: { name: "Swiss", tier: 1, bag: 35 },
  OS: { name: "Austrian", tier: 1, bag: 35 },
  AF: { name: "Air France", tier: 1, bag: 35 },
  IB: { name: "Iberia", tier: 1, bag: 35 },
  VY: { name: "Vueling", tier: 2, bag: 35 },
  UX: { name: "Air Europa", tier: 2, bag: 30 },
  TP: { name: "TAP Air Portugal", tier: 1, bag: 35 },
  A3: { name: "Aegean", tier: 1, bag: 30 },
  AZ: { name: "ITA Airways", tier: 1, bag: 35 },
  KM: { name: "KM Malta Airlines", tier: 2, bag: 30 },
  OU: { name: "Croatia Airlines", tier: 2, bag: 30 },
  EW: { name: "Eurowings", tier: 2, bag: 35 },
  DE: { name: "Condor", tier: 2, bag: 30 },
  U2: { name: "easyJet", tier: 2, bag: 40 },
  FR: { name: "Ryanair", tier: 3, bag: 45 },
  W6: { name: "Wizz Air", tier: 3, bag: 45 },
  MS: { name: "EgyptAir", tier: 1, bag: 0 },
  AT: { name: "Royal Air Maroc", tier: 2, bag: 0 },
  RJ: { name: "Royal Jordanian", tier: 1, bag: 0 },
  TG: { name: "Thai Airways", tier: 1, bag: 0 },
  BR: { name: "EVA Air", tier: 1, bag: 0 },
  CI: { name: "China Airlines", tier: 1, bag: 0 },
  SQ: { name: "Singapore Airlines", tier: 1, bag: 0 },
  GA: { name: "Garuda Indonesia", tier: 1, bag: 0 },
  UL: { name: "SriLankan", tier: 1, bag: 0 },
  MK: { name: "Air Mauritius", tier: 1, bag: 0 },
  HM: { name: "Air Seychelles", tier: 2, bag: 0 },
  ET: { name: "Ethiopian", tier: 1, bag: 0 },
  KQ: { name: "Kenya Airways", tier: 2, bag: 0 },
  SA: { name: "South African", tier: 1, bag: 0 },
  DL: { name: "Delta", tier: 1, bag: 0 },
  UA: { name: "United", tier: 1, bag: 0 },
  AA: { name: "American Airlines", tier: 1, bag: 0 },
  B6: { name: "JetBlue", tier: 2, bag: 0 },
  "4M": { name: "Sundair", tier: 2, bag: 30 },
  BY: { name: "TUI Airways", tier: 2, bag: 30 },
  X3: { name: "TUI fly Deutschland", tier: 2, bag: 30 },
  "2W": { name: "World2fly", tier: 2, bag: 0 },
  "6E": { name: "IndiGo", tier: 2, bag: 0 },
  VN: { name: "Vietnam Airlines", tier: 1, bag: 0 },
  VS: { name: "Virgin Atlantic", tier: 1, bag: 0 },
  BA: { name: "British Airways", tier: 1, bag: 0 },
};

export function airlineName(code) {
  const a = AIRLINES[String(code || "").toUpperCase()];
  return a ? a.name : code || "Onbekend";
}

export function airlineTier(code) {
  const a = AIRLINES[String(code || "").toUpperCase()];
  return a ? a.tier : 2;
}

// Bagage-opslag voor 2 personen, heen + terug.
export function bagCostFor2(code, longHaul) {
  const a = AIRLINES[String(code || "").toUpperCase()];
  let perLeg;
  if (!a) perLeg = longHaul ? 0 : 35;
  else if (a.bagShort !== undefined && !longHaul) perLeg = a.bagShort;
  else perLeg = a.bag;
  return perLeg * 2 * 2;
}

export const ULCC = ["FR", "W6"];
