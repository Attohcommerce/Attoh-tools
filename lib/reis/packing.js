// Automatische paklijst voor 2 personen, op basis van de bestemming:
// temperatuur in die maand, strand/zwembad, stad/cultuur, verre vlucht,
// stekker, aantal nachten. Daarna zelf aan te vullen en af te vinken.
import { countryInfo } from "./countryinfo.js";
import { DEST_BY_ID, tempIn } from "./destinations.js";

let n = 0;
const item = (cat, text) => ({ id: `p${Date.now().toString(36)}${(n++).toString(36)}`, cat, text, done: false, by: "" });

export const PACK_CATS = ["Papieren", "Kleding", "Strand & zon", "Toilettas", "Elektronica", "Onderweg", "Overig"];

export function makePackingList(trip) {
  const r0 = trip.result || trip;
  const d = DEST_BY_ID[r0.destId] || {};
  const r = { ...r0, cc: r0.cc || d.cc, tags: r0.tags || d.tags || [], hours: r0.hours || d.hours };
  const temp = r0.temp ?? (d.temp && r0.depart ? tempIn(d, new Date(r0.depart + "T12:00:00Z").getUTCMonth()) : 25);
  const nights = r.nights || 7;
  const tags = r.tags;
  const long = (r.hours || 0) > 6;
  const sunny = temp >= 22;
  const beach = true; // zwembad is altijd een eis, dus badkleding altijd mee
  const city = tags.includes("stad") || tags.includes("cultuur");
  const party = tags.includes("party");
  const info = r.cc ? countryInfo({ id: r.destId, cc: r.cc }, r.depart) : null;
  const days = Math.min(nights + 1, 10);

  const L = [
    item("Papieren", "Paspoorten (minimaal 6 maanden geldig)"),
    item("Papieren", "Boekingsbevestiging vlucht"),
    item("Papieren", "Boekingsbevestiging hotel"),
    item("Papieren", "Bankpas + creditcard"),
    item("Papieren", "Reisverzekering (pasje of app)"),
    item("Papieren", "Rijbewijs (voor huurauto of scooter)"),
    item("Kleding", `Ondergoed (${days} per persoon)`),
    item("Kleding", `Sokken (${Math.max(3, Math.round(days * 0.6))} paar per persoon)`),
    item("Kleding", sunny ? `T-shirts / tops (${Math.min(days, 8)} per persoon)` : "Truien / vesten"),
    item("Kleding", sunny ? "Korte broeken / rokjes" : "Lange broeken"),
    item("Kleding", "Outfit voor uit eten"),
    item("Kleding", "Pyjama"),
    item("Kleding", city ? "Comfortabele loopschoenen" : "Sneakers"),
    item("Toilettas", "Tandenborstels + tandpasta"),
    item("Toilettas", "Deodorant"),
    item("Toilettas", "Shampoo / conditioner (100 ml in handbagage)"),
    item("Toilettas", "Medicijnen + paracetamol"),
    item("Toilettas", "Pleisters"),
    item("Elektronica", "Telefoonopladers"),
    item("Elektronica", "Powerbank (in handbagage)"),
    item("Elektronica", "Oordopjes / koptelefoon"),
    item("Onderweg", "Lege waterfles (vullen na de security)"),
    item("Onderweg", "Snacks voor onderweg"),
  ];
  if (info && info.needsAdapter) L.push(item("Elektronica", `Stekkeradapter (${String(info.plug).replace("Adapter nodig: ", "")})`));
  if (sunny) {
    L.push(item("Strand & zon", "Zonnebrand factor 30+"));
    L.push(item("Strand & zon", "Aftersun"));
    L.push(item("Strand & zon", "Zonnebrillen"));
    L.push(item("Strand & zon", "Pet / zonnehoed"));
    L.push(item("Strand & zon", "Slippers"));
  }
  if (beach) {
    L.push(item("Strand & zon", "Badkleding (2 per persoon)"));
    L.push(item("Strand & zon", "Strandtas"));
  }
  if (tags.includes("strand")) L.push(item("Strand & zon", "Snorkelset of waterschoenen"));
  if (party) L.push(item("Kleding", "Uitgaansoutfits"));
  if (long) {
    L.push(item("Onderweg", "Nekkussens"));
    L.push(item("Onderweg", "Slaapmaskers"));
    L.push(item("Onderweg", "Vest of trui voor in het vliegtuig"));
    L.push(item("Onderweg", "Series / films gedownload"));
  }
  if (["AE", "OM", "JO", "EG", "MA"].includes(r.cc)) L.push(item("Kleding", "Bedekkende kleding voor moskeeën en souks"));
  if (temp >= 28) L.push(item("Toilettas", "Muggenspray"));
  if (r.cc === "US") L.push(item("Papieren", "ESTA aangevraagd"));
  if (info && /USD|dollar/.test(info.currency)) L.push(item("Papieren", "Wat contante dollars"));
  return L;
}
