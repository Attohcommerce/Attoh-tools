// Gedeelde opmaak-hulpjes voor de reisplanner (client).
const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MON = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

export const eur = (n) => "€" + Math.round(n || 0).toLocaleString("nl-NL");
export const fmtDay = (iso) => {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};

// Hele dagen tot vertrek (vandaag = 0), lokale datum.
export function daysUntil(iso) {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((d - today) / 86400000);
}

export function countdownLabel(iso) {
  const n = daysUntil(iso);
  if (n > 1) return `Nog ${n} dagen`;
  if (n === 1) return "Morgen vertrekken jullie!";
  if (n === 0) return "Vandaag vertrekken jullie!";
  return "Onderweg of geweest";
}

// Tekst om te delen (WhatsApp of kopiëren)
export function shareText(r) {
  const lines = [
    `✈ ${r.city} — ${fmtDay(r.depart)} t/m ${fmtDay(r.ret)} (${r.nights} nachten)`,
    `Vlucht: ${r.origin} → ${r.airport}${r.flight && r.flight.airlineName ? `, ${r.flight.airlineName}` : ""}${r.flight ? `, ${eur(r.flight.cost)} voor 2` : ""}`,
  ];
  if (r.hotel && r.hotel.name) lines.push(`Hotel: ${r.hotel.name}${r.hotel.stars ? ` (${r.hotel.stars}★)` : ""}, ${eur(r.hotelTotal)}`);
  lines.push(`Totaal: ${eur(r.total)} (${eur(r.total / 2)} p.p.)`);
  const fl = r.links && r.links.flight && (r.links.flight.find((l) => l.primary) || r.links.flight[0]);
  const ho = r.links && r.links.hotel && r.links.hotel[0];
  if (fl) lines.push(`Vlucht boeken: ${fl.url}`);
  if (ho) lines.push(`Hotel boeken: ${ho.url}`);
  return lines.join("\n");
}

export async function shareTrip(r) {
  const text = shareText(r);
  try {
    if (navigator.share) {
      await navigator.share({ title: `Reis naar ${r.city}`, text });
      return "gedeeld";
    }
  } catch {
    return "";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "gekopieerd";
  } catch {
    return "";
  }
}

export function whatsappUrl(r) {
  return `https://wa.me/?text=${encodeURIComponent(shareText(r))}`;
}

export const PEOPLE = { justin: "Justin", quinty: "Quinty" };

// Verlofdagen: werkdagen (ma–vr) tussen vertrek en terugkomst (beide
// meegeteld), min de Nederlandse feestdagen (Nieuwjaar, Pasen, Koningsdag,
// Hemelvaart, Pinksteren, Kerst; Bevrijdingsdag alleen in lustrumjaren).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}
const hdCache = {};
function holidays(y) {
  if (hdCache[y]) return hdCache[y];
  const D = 86400000, e = easter(y);
  let kd = Date.UTC(y, 3, 27);
  if (new Date(kd).getUTCDay() === 0) kd -= D; // Koningsdag op zondag → zaterdag
  const list = [Date.UTC(y, 0, 1), e + D, kd, e + 39 * D, e + 50 * D, Date.UTC(y, 11, 25), Date.UTC(y, 11, 26)];
  if (y % 5 === 0) list.push(Date.UTC(y, 4, 5));
  hdCache[y] = new Set(list);
  return hdCache[y];
}
export function leaveDays(depart, ret) {
  const D = 86400000;
  let t = new Date(String(depart).slice(0, 10) + "T00:00:00Z").getTime();
  const end = new Date(String(ret).slice(0, 10) + "T00:00:00Z").getTime();
  let n = 0;
  for (; t <= end; t += D) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    if (holidays(new Date(t).getUTCFullYear()).has(t)) continue;
    n++;
  }
  return n;
}
