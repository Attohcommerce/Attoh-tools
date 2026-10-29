// Boek-links. De tool boekt zelf niets: hij laat zien WAAR het het
// goedkoopst is en geeft voor elke combinatie de links met datums,
// 2 personen en filters al ingevuld.

const enc = encodeURIComponent;

function yymmdd(iso) {
  return String(iso).slice(2, 10).replace(/-/g, "");
}

// Travelpayouts-partnercode (optioneel, env TRAVELPAYOUTS_MARKER): dan
// verdienen jullie een klein bedrag als je via Aviasales boekt.
function marker() {
  const m = typeof process !== "undefined" ? String(process.env.TRAVELPAYOUTS_MARKER || "").trim() : "";
  return m ? `&marker=${enc(m)}` : "";
}
function aviasalesUrl(path) {
  if (!path) return "";
  const sep = path.includes("?") ? "&" : "?";
  return `https://www.aviasales.com${path}${sep}currency=eur&locale=en${marker()}`;
}

// Website van de maatschappij zelf (boeken bij de bron = makkelijkst bij
// wijzigingen, vertraging en bagage).
const AIRLINE_SITES = {
  KL: "https://www.klm.nl", HV: "https://www.transavia.com/nl-NL/home/", OR: "https://www.tui.nl/vliegtickets/",
  TB: "https://www.tuifly.be/nl", CND: "https://www.corendon.nl/vliegtickets", XR: "https://www.corendon.nl/vliegtickets",
  XC: "https://www.corendon.nl/vliegtickets", PC: "https://www.flypgs.com/nl", TK: "https://www.turkishairlines.com/nl-nl/",
  EK: "https://www.emirates.com/nl/dutch/", EY: "https://www.etihad.com/nl-nl/", QR: "https://www.qatarairways.com/nl-nl/homepage.html",
  FZ: "https://www.flydubai.com/en/", WY: "https://www.omanair.com/nl/en", LH: "https://www.lufthansa.com/nl/nl/homepage",
  SN: "https://www.brusselsairlines.com/nl/nl/homepage", LX: "https://www.swiss.com/nl/nl/homepage", OS: "https://www.austrian.com/nl/nl/homepage",
  AF: "https://wwws.airfrance.nl/", IB: "https://www.iberia.com/nl/", VY: "https://www.vueling.com/nl", UX: "https://www.aireuropa.com/nl/nl/home",
  TP: "https://www.flytap.com/nl-nl/", A3: "https://nl.aegeanair.com/", AZ: "https://www.ita-airways.com/nl_nl", EW: "https://www.eurowings.com/nl.html",
  DE: "https://www.condor.com/nl", U2: "https://www.easyjet.com/nl", FR: "https://www.ryanair.com/nl/nl", W6: "https://wizzair.com/nl-nl",
  MS: "https://www.egyptair.com/en/", AT: "https://www.royalairmaroc.com/nl-en", RJ: "https://www.rj.com/en", TG: "https://www.thaiairways.com/nl-nl/",
  BR: "https://www.evaair.com/nl-nl/", CI: "https://www.china-airlines.com/nl/nl", SQ: "https://www.singaporeair.com/nl_NL/nl/",
  GA: "https://www.garuda-indonesia.com/nl/nl/", UL: "https://www.srilankan.com/nl_nl/", MK: "https://www.airmauritius.com/",
  ET: "https://www.ethiopianairlines.com/nl", KQ: "https://www.kenya-airways.com/", DL: "https://nl.delta.com/", UA: "https://www.united.com/nl/nl",
  BA: "https://www.britishairways.com/nl-nl", VS: "https://www.virginatlantic.com/", XQ: "https://www.sunexpress.com/nl/", X3: "https://www.tuifly.com/",
  BY: "https://www.tui.co.uk/flight/", "2W": "https://world2fly.com/en/", VN: "https://www.vietnamairlines.com/nl/nl/home",
};
export function airlineSite(code) {
  return AIRLINE_SITES[String(code || "").toUpperCase()] || "";
}

// Retour: elke link heeft een korte uitleg, zodat je weet wat je krijgt.
export function flightLinks({ origin, dest, depart, ret, direct, aviasalesPath, airline }) {
  const o = String(origin).toLowerCase();
  const d = String(dest).toLowerCase();
  const stops = direct ? "&stops=!oneStop,!twoPlusStops" : "&stops=!twoPlusStops";
  const links = [];
  links.push({
    label: "Google Flights", id: "google", primary: true,
    why: "Duidelijkst: alle maatschappijen en sites naast elkaar, in het Nederlands, prijs in euro's.",
    url: `https://www.google.com/travel/flights?hl=nl&gl=NL&curr=EUR&q=${enc(`Flights from ${origin} to ${dest} on ${depart} through ${ret} ${direct ? "nonstop " : ""}2 adults economy`)}`,
  });
  const site = airlineSite(airline);
  if (site) links.push({ label: "Bij de maatschappij zelf", id: "airline", why: "Zelfde vlucht direct bij de maatschappij. Makkelijkst bij wijzigingen of vertraging. Zoek zelf op de datums hieronder." , url: site });
  links.push({
    label: "Skyscanner", id: "skyscanner",
    why: "Vergelijkt honderden boekingssites. Klik op de prijs en kies bij voorkeur de maatschappij zelf.",
    url: `https://www.skyscanner.nl/transport/vluchten/${o}/${d}/${yymmdd(depart)}/${yymmdd(ret)}/?adultsv2=2&cabinclass=economy&rtn=1${stops}`,
  });
  if (aviasalesPath) {
    links.push({ label: "Aviasales (waar wij de prijs zagen)", id: "aviasales", why: "Hier vonden wij deze prijs. Engelstalig. Let op: bij sommige verkopers betaal je bagage apart.", url: aviasalesUrl(aviasalesPath) });
  }
  links.push({
    label: "Kayak", id: "kayak", why: "Nog een vergelijker, soms net een paar euro goedkoper.",
    url: `https://www.kayak.nl/flights/${origin}-${dest}/${depart}/${ret}/2adults?sort=price_a${direct ? "&fs=stops=0" : "&fs=stops=-2"}`,
  });
  return links;
}

// Enkele reis (voor 2 losse tickets)
export function oneWayLinks({ from, to, date, direct, aviasalesPath, airline }) {
  const links = [
    {
      label: "Google Flights", id: "google", primary: true,
      why: "Enkele reis, 2 volwassenen, prijs in euro's.",
      url: `https://www.google.com/travel/flights?hl=nl&gl=NL&curr=EUR&q=${enc(`One way flights from ${from} to ${to} on ${date} ${direct ? "nonstop " : ""}2 adults`)}`,
    },
  ];
  const site = airlineSite(airline);
  if (site) links.push({ label: "Bij de maatschappij zelf", id: "airline", why: "Kies daar 'enkele reis'.", url: site });
  links.push({
    label: "Skyscanner", id: "skyscanner", why: "Vergelijkt alle boekingssites.",
    url: `https://www.skyscanner.nl/transport/vluchten/${String(from).toLowerCase()}/${String(to).toLowerCase()}/${yymmdd(date)}/?adultsv2=2&cabinclass=economy&rtn=0${direct ? "&stops=!oneStop,!twoPlusStops" : ""}`,
  });
  if (aviasalesPath) links.push({ label: "Aviasales (waar wij de prijs zagen)", id: "aviasales", why: "Engelstalig.", url: aviasalesUrl(aviasalesPath) });
  return links;
}

// Booking.com-filters: class=4/5 (sterren), hotelfacility=433 (zwembad),
// review_score=80 (8+), mealplan=1 (ontbijt inbegrepen).
export function hotelLinks({ city, hotelName, checkin, checkout, minStars = 4, pool = true, minReview = 8, board }) {
  const nflt = [];
  for (let s = Math.max(1, minStars); s <= 5; s++) nflt.push(`class=${s}`);
  if (pool) nflt.push("hotelfacility=433");
  if (minReview) nflt.push(`review_score=${Math.round(minReview * 10)}`);
  if (board === "ontbijt") nflt.push("mealplan=1");
  const ss = hotelName ? `${hotelName} ${city}` : city;
  const links = [
    {
      label: hotelName ? "Booking.com (dit hotel)" : "Booking.com (gefilterd)",
      url: `https://www.booking.com/searchresults.nl.html?ss=${enc(ss)}&checkin=${checkin}&checkout=${checkout}&group_adults=2&no_rooms=1&group_children=0&order=price&nflt=${enc(nflt.join(";"))}`,
      primary: true,
    },
    {
      label: "Google Hotels",
      url: `https://www.google.com/travel/search?hl=nl&q=${enc(
        (hotelName ? hotelName + " " : `${minStars} sterren hotels met zwembad `) + city
      )}`,
    },
    {
      label: "Expedia",
      url: `https://www.expedia.nl/Hotel-Search?destination=${enc(ss)}&startDate=${checkin}&endDate=${checkout}&adults=2&sort=PRICE_LOW_TO_HIGH${minStars >= 4 ? "&star=40&star=50" : ""}${pool ? "&amenities=POOL" : ""}`,
    },
    {
      label: "Hotels.com",
      url: `https://nl.hotels.com/Hotel-Search?destination=${enc(ss)}&startDate=${checkin}&endDate=${checkout}&adults=2&sort=PRICE_LOW_TO_HIGH`,
    },
    {
      label: "Agoda",
      url: `https://www.agoda.com/nl-nl/search?textToSearch=${enc(ss)}&checkIn=${checkin}&checkOut=${checkout}&rooms=1&adults=2&children=0&sort=priceLowToHigh`,
    },
    {
      label: "Trip.com",
      url: `https://nl.trip.com/hotels/list?keyword=${enc(ss)}&checkin=${checkin.replace(/-/g, "/")}&checkout=${checkout.replace(/-/g, "/")}&adult=2&crn=1`,
    },
  ];
  if (hotelName) links.push({ label: "Website van het hotel", url: `https://www.google.com/search?q=${enc(hotelName + " " + city + " official website")}` });
  const WHY = {
    "Booking.com (dit hotel)": "Meestal goedkoopst, vaak gratis annuleren. In het Nederlands.",
    "Booking.com (gefilterd)": "Al gefilterd op sterren, zwembad en reviewscore.",
    "Google Hotels": "Laat de prijs van alle sites naast elkaar zien.",
    Expedia: "Soms goedkoper met Expedia-ledenprijs.",
    "Hotels.com": "Spaar nachten: elke 10 nachten 1 gratis (ongeveer).",
    Agoda: "Vaak goedkoper bij hotels buiten Europa.",
    "Trip.com": "Soms de laagste prijs in Azië en het Midden-Oosten.",
    "Website van het hotel": "Direct bij het hotel: vraag naar een betere kamer of gratis ontbijt.",
  };
  return links.map((l) => ({ ...l, why: WHY[l.label] || "" }));
}

// Pakketreizen: geen open API bij TUI/Corendon/Sunweb — de tool opent hun
// zoekresultaten / zoekopdracht voor dezelfde bestemming en maand, zodat je
// de pakketprijs direct naast de losse combinatie kunt leggen.
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
export function packageLinks({ city, country, depart, nights }) {
  const d = new Date(depart + "T12:00:00Z");
  const maand = `${MAANDEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const q = (site) =>
    `https://www.google.com/search?q=${enc(`site:${site} ${city}${country && country !== city ? " " + country : ""} vlucht hotel ${maand} ${nights} nachten`)}`;
  return [
    { label: "TUI", url: q("tui.nl") },
    { label: "Corendon", url: q("corendon.nl") },
    { label: "Sunweb", url: q("sunweb.nl") },
    { label: "D-reizen", url: q("d-reizen.nl") },
    { label: "Booking Vlucht+Hotel", url: `https://www.booking.com/packages.nl.html?ss=${enc(city)}` },
  ];
}
