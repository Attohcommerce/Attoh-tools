// Boek-links. De tool boekt zelf niets: hij laat zien WAAR het het
// goedkoopst is en geeft voor elke combinatie de links met datums,
// 2 personen en filters al ingevuld.

const enc = encodeURIComponent;

function yymmdd(iso) {
  return String(iso).slice(2, 10).replace(/-/g, "");
}

export function flightLinks({ origin, dest, depart, ret, direct, aviasalesPath }) {
  const o = String(origin).toLowerCase();
  const d = String(dest).toLowerCase();
  const stops = direct ? "&stops=!oneStop,!twoPlusStops" : "&stops=!twoPlusStops";
  const links = [];
  if (aviasalesPath) {
    links.push({ label: "Aviasales (gevonden prijs)", url: "https://www.aviasales.com" + aviasalesPath, primary: true });
  }
  links.push({
    label: "Skyscanner",
    url: `https://www.skyscanner.nl/transport/vluchten/${o}/${d}/${yymmdd(depart)}/${yymmdd(ret)}/?adultsv2=2&cabinclass=economy&rtn=1${stops}`,
    primary: !aviasalesPath,
  });
  links.push({
    label: "Google Flights",
    url: `https://www.google.com/travel/flights?hl=nl&curr=EUR&q=${enc(
      `Flights from ${origin} to ${dest} on ${depart} through ${ret} ${direct ? "nonstop " : ""}2 adults`
    )}`,
  });
  links.push({
    label: "Kayak",
    url: `https://www.kayak.nl/flights/${origin}-${dest}/${depart}/${ret}/2adults?sort=price_a${direct ? "&fs=stops=0" : "&fs=stops=-2"}`,
  });
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
  ];
  return links;
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
