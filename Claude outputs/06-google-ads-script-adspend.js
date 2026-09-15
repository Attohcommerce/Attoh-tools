/**
 * Ad spend → P&L-sheet (kolom U van de datumrij), dagelijks.
 * Google Ads → Tools → Bulkacties → Scripts → nieuw script → plakken → Autoriseren → Preview → Uitvoeren.
 * Frequentie: Dagelijks, 06:00 (accounttijdzone). Schrijft altijd GISTEREN.
 *
 * Per store alleen SHEET_ID aanpassen:
 *   SSB  = 1hwv6MnKzOFlGhxe5vWSApglqwZDTYp-boT0fqGgoFiM
 *   LGB  = 1-bSai9JR5zGqwbfzV1UegahVtmAa5R-RO5CAQOT7SRU
 * De sheet moet gedeeld zijn met het Google-account dat het script autoriseert.
 */
var SHEET_ID    = 'PLAK_HIER_HET_SHEET_ID';
var KOL_DATUM   = 18;  // R — datum van de rij (rij 3 = dag 1)
var KOL_ADSPEND = 21;  // U — ad spend £ (raw-invoerblok)
var DAGEN_TERUG = 1;   // 1 = gisteren
var MAANDEN = ['January','February','March','April','May','June',
               'July','August','September','October','November','December'];

function main() {
  // Alles in de tijdzone van het ad-account: zowel de dag die we ophalen als de
  // maandtab en de rij. ss.getSpreadsheetTimeZone() bestaat NIET in Ads Scripts.
  var tz = AdsApp.currentAccount().getTimeZone();
  var d = new Date();
  d.setDate(d.getDate() - DAGEN_TERUG);
  var dagISO   = Utilities.formatDate(d, tz, 'yyyy-MM-dd');   // voor GAQL
  var datumKey = Utilities.formatDate(d, tz, 'ddMMyyyy');     // voor de rij-match
  var maandNr  = Number(Utilities.formatDate(d, tz, 'M'));
  var tabNaam  = MAANDEN[maandNr - 1];

  // Kosten van die dag over het hele account (alle campagnes), in accountvaluta (£).
  var rapport = AdsApp.report(
    "SELECT segments.date, metrics.cost_micros FROM customer " +
    "WHERE segments.date BETWEEN '" + dagISO + "' AND '" + dagISO + "'");
  var rows = rapport.rows();
  var micros = 0;
  while (rows.hasNext()) micros += Number(rows.next()['metrics.cost_micros']) || 0;
  var bedrag = Math.round(micros / 10000) / 100;

  var ss  = SpreadsheetApp.openById(SHEET_ID);
  var tab = ss.getSheetByName(tabNaam);
  if (!tab) { Logger.log('Tabblad "' + tabNaam + '" bestaat niet — maandtab eerst aanmaken.'); return; }

  // Rij zoeken op de ZICHTBARE datumtekst (dd/mm/yyyy), cijfers-only vergeleken.
  // Zo maakt het niet uit hoe de sheet de datum opmaakt of in welke tijdzone hij staat.
  var laatste = tab.getLastRow();
  var datums  = tab.getRange(3, KOL_DATUM, laatste - 2, 1).getDisplayValues();
  var rij = -1;
  for (var i = 0; i < datums.length; i++) {
    if (String(datums[i][0]).replace(/\D/g, '') === datumKey) { rij = i + 3; break; }
  }
  if (rij < 0) { Logger.log('Geen rij gevonden voor ' + datumKey + ' in "' + tabNaam + '".'); return; }

  tab.getRange(rij, KOL_ADSPEND).setValue(bedrag);
  Logger.log('Ad spend ' + dagISO + ' → £' + bedrag.toFixed(2) + ' in "' + tabNaam + '" rij ' + rij + ' (kolom U).');
}
