/**
 * Attoh Tools — Google Ads live cijfers → Google Sheet "Attoh Ads Live" (elk uur).
 * Google Ads → Tools → Bulkacties → Scripts → + → plakken → Autoriseren → Voorbeeld → frequentie Elk uur.
 * Per account alleen SHEET_ID en STORE aanpassen. STORE = sleutel in het dashboard
 * (SSB 480-581-8700 · LGB 984-701-3293 · EMC 101-493-0915 · SW 306-181-2644).
 * Schrijft vandaag, gisteren en eergisteren (hele account, alle campagnes samen) naar tab Ads_<STORE>.
 */
var SHEET_ID = 'PLAK_HIER_HET_SHEET_ID';
var STORE    = 'SSB';
var DAGEN    = 3;

function main() {
  var acc = AdsApp.currentAccount();
  var tz  = acc.getTimeZone();
  var cur = acc.getCurrencyCode();
  var nu  = new Date();
  var bijgewerkt = Utilities.formatDate(nu, tz, 'yyyy-MM-dd HH:mm');

  var ss  = SpreadsheetApp.openById(SHEET_ID);
  var naam = 'Ads_' + STORE;
  var tab = ss.getSheetByName(naam) || ss.insertSheet(naam);
  var kop = ['date', 'cost', 'clicks', 'impressions', 'conversions', 'conv_value', 'cpc', 'cpm', 'roas_google', 'currency', 'updated_at'];
  if (tab.getLastRow() === 0) tab.appendRow(kop);
  tab.getRange('A:A').setNumberFormat('@');

  var waarden = tab.getDataRange().getValues();

  for (var k = 0; k < DAGEN; k++) {
    var d   = new Date(nu.getTime() - k * 86400000);
    var iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');

    var rows = AdsApp.report(
      'SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, ' +
      'metrics.conversions, metrics.conversions_value FROM customer ' +
      "WHERE segments.date = '" + iso + "'").rows();

    var micros = 0, kliks = 0, vert = 0, conv = 0, waarde = 0;
    while (rows.hasNext()) {
      var r = rows.next();
      micros += Number(r['metrics.cost_micros']) || 0;
      kliks  += Number(r['metrics.clicks']) || 0;
      vert   += Number(r['metrics.impressions']) || 0;
      conv   += Number(r['metrics.conversions']) || 0;
      waarde += Number(r['metrics.conversions_value']) || 0;
    }
    var kosten = Math.round(micros / 10000) / 100;
    var cpc  = kliks ? Math.round(kosten / kliks * 100) / 100 : 0;
    var cpm  = vert  ? Math.round(kosten / vert * 1000 * 100) / 100 : 0;
    var roas = kosten ? Math.round(waarde / kosten * 100) / 100 : 0;

    var rij = [iso, kosten, kliks, vert, Math.round(conv * 100) / 100,
               Math.round(waarde * 100) / 100, cpc, cpm, roas, cur, bijgewerkt];

    var gevonden = -1;
    for (var i = 1; i < waarden.length; i++) {
      var v = waarden[i][0];
      var s = (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v);
      if (s === iso) { gevonden = i + 1; break; }
    }
    if (gevonden > 0) {
      tab.getRange(gevonden, 1, 1, rij.length).setValues([rij]);
    } else {
      tab.appendRow(rij);
      waarden.push(rij);
    }
    Logger.log(STORE + ' ' + iso + ': £' + kosten + ' · ' + kliks + ' kliks · CPC ' + cpc + ' · CPM ' + cpm + ' · ROAS ' + roas);
  }
}
