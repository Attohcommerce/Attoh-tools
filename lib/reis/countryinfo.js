// Praktische landinfo per bestemming: tijdzone (tijdsverschil wordt live
// uitgerekend met Intl, dus zomer/wintertijd klopt altijd), valuta,
// stekker (heb je een adapter nodig vanuit NL?) en de link naar het
// officiële reisadvies van de Nederlandse overheid.

const C = {
  TR: { tz: "Europe/Istanbul", cur: "Turkse lira (TRY)", plug: null, advies: "turkije" },
  ES: { tz: "Europe/Madrid", cur: "Euro", plug: null, advies: "spanje" },
  PT: { tz: "Europe/Lisbon", cur: "Euro", plug: null, advies: "portugal" },
  GR: { tz: "Europe/Athens", cur: "Euro", plug: null, advies: "griekenland" },
  IT: { tz: "Europe/Rome", cur: "Euro", plug: null, advies: "italie" },
  MT: { tz: "Europe/Malta", cur: "Euro", plug: "type G (Brits)", advies: "malta" },
  HR: { tz: "Europe/Zagreb", cur: "Euro", plug: null, advies: "kroatie" },
  CY: { tz: "Asia/Nicosia", cur: "Euro", plug: "type G (Brits)", advies: "cyprus" },
  EG: { tz: "Africa/Cairo", cur: "Egyptisch pond (EGP)", plug: null, advies: "egypte" },
  MA: { tz: "Africa/Casablanca", cur: "Marokkaanse dirham (MAD)", plug: null, advies: "marokko" },
  TN: { tz: "Africa/Tunis", cur: "Tunesische dinar (TND)", plug: null, advies: "tunesie" },
  JO: { tz: "Asia/Amman", cur: "Jordaanse dinar (JOD)", plug: "wisselend, neem een universele mee", advies: "jordanie" },
  CV: { tz: "Atlantic/Cape_Verde", cur: "Kaapverdische escudo (CVE)", plug: null, advies: "kaapverdie" },
  AE: { tz: "Asia/Dubai", cur: "Dirham (AED)", plug: "type G (Brits)", advies: "verenigde-arabische-emiraten" },
  OM: { tz: "Asia/Muscat", cur: "Omaanse rial (OMR)", plug: "type G (Brits)", advies: "oman" },
  TH: { tz: "Asia/Bangkok", cur: "Thaise baht (THB)", plug: "meestal past NL, universele is handig", advies: "thailand" },
  ID: { tz: "Asia/Makassar", cur: "Indonesische roepia (IDR)", plug: null, advies: "indonesie" },
  VN: { tz: "Asia/Ho_Chi_Minh", cur: "Vietnamese dong (VND)", plug: "wisselend, universele is handig", advies: "vietnam" },
  SG: { tz: "Asia/Singapore", cur: "Singaporese dollar (SGD)", plug: "type G (Brits)", advies: "singapore" },
  MV: { tz: "Indian/Maldives", cur: "Rufiyaa (MVR), dollars worden overal aangenomen", plug: "wisselend, universele is handig", advies: "malediven" },
  LK: { tz: "Asia/Colombo", cur: "Sri Lankaanse roepie (LKR)", plug: "type D/G", advies: "sri-lanka" },
  MU: { tz: "Indian/Mauritius", cur: "Mauritiaanse roepie (MUR)", plug: "type C/G, universele is handig", advies: "mauritius" },
  SC: { tz: "Indian/Mahe", cur: "Seychelse roepie (SCR)", plug: "type G (Brits)", advies: "seychellen" },
  TZ: { tz: "Africa/Dar_es_Salaam", cur: "Tanzaniaanse shilling (TZS), dollars worden veel aangenomen", plug: "type D/G", advies: "tanzania" },
  ZA: { tz: "Africa/Johannesburg", cur: "Rand (ZAR)", plug: "type M/N", advies: "zuid-afrika" },
  CW: { tz: "America/Curacao", cur: "Caribische gulden (XCG)", plug: "type A/B (Amerikaans)", advies: "curacao" },
  AW: { tz: "America/Aruba", cur: "Arubaanse florin (AWG)", plug: "type A/B (Amerikaans)", advies: "aruba" },
  BQ: { tz: "America/Kralendijk", cur: "Amerikaanse dollar (USD)", plug: "type A/B (Amerikaans)", advies: null },
  MX: { tz: "America/Cancun", cur: "Mexicaanse peso (MXN)", plug: "type A/B (Amerikaans)", advies: "mexico" },
  DO: { tz: "America/Santo_Domingo", cur: "Dominicaanse peso (DOP)", plug: "type A/B (Amerikaans)", advies: "dominicaanse-republiek" },
  US: { tz: "America/New_York", cur: "Amerikaanse dollar (USD)", plug: "type A/B (Amerikaans)", advies: "verenigde-staten" },
};

// Bestemmingen in een andere tijdzone dan de rest van het land
const TZ_OVERRIDE = {
  tenerife: "Atlantic/Canary",
  grancanaria: "Atlantic/Canary",
  lanzarote: "Atlantic/Canary",
  fuerteventura: "Atlantic/Canary",
  madeira: "Atlantic/Madeira",
};

function offsetMinutes(tz, at) {
  // verschil tussen lokale tijd in tz en UTC op moment `at`
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export function countryInfo(dest, isoDate) {
  if (!dest) return null;
  const c = C[dest.cc];
  if (!c) return null;
  const tz = TZ_OVERRIDE[dest.id] || c.tz;
  const at = isoDate ? new Date(isoDate + "T12:00:00Z") : new Date();
  let diff = null;
  try {
    diff = (offsetMinutes(tz, at) - offsetMinutes("Europe/Amsterdam", at)) / 60;
  } catch {}
  let diffLabel = "";
  if (diff === 0) diffLabel = "Zelfde tijd als NL";
  else if (diff !== null) {
    const h = Math.abs(diff);
    const hs = Number.isInteger(h) ? String(h) : String(h).replace(".", ",");
    diffLabel = `${hs} uur ${diff > 0 ? "later" : "eerder"} dan NL`;
  }
  return {
    tz,
    diff,
    diffLabel,
    currency: c.cur,
    plug: c.plug ? `Adapter nodig: ${c.plug}` : "Geen stekkeradapter nodig",
    needsAdapter: Boolean(c.plug),
    advies: c.advies ? `https://www.nederlandwereldwijd.nl/reisadvies/${c.advies}` : "https://www.nederlandwereldwijd.nl/reisadvies",
  };
}
