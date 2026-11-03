/**
 * Attoh Tools — Pythago: Google Ads-cijfers PER PRODUCT → Google Sheet "Attoh Ads Live".
 * (03-11-2026) Vervangt de handmatige Productrapport-exports (7/14/30 dagen).
 *
 * Zet dit script in elk Google Ads-account (Tools → Bulkacties → Scripts → + →
 * plakken → Autoriseren → Voorbeeld → frequentie: elk uur of dagelijks 06:00).
 * Per account alleen SHEET_ID en STORE aanpassen — zelfde sheet en sleutel als
 * google-ads-live.js (SSB · LGB · EMC · SW · …).
 *
 * Schrijft per dag en per Shopping-item (shopify_XX_<product>_<variant>) naar tab
 * Prod_<STORE>: date, item_id, title, impressions, clicks, cost, conversions,
 * conv_value, updated_at. Alleen items met vertoningen. Bij elke run worden de
 * laatste DAGEN dagen opnieuw geschreven (gisteren/eergisteren veranderen nog
 * door late conversies); rijen ouder dan BEWAAR_DAGEN gaan eruit.
 * Eerste run (tab nog leeg) haalt vanzelf EERSTE_RUN_DAGEN dagen geschiedenis op.
 */
var SHEET_ID = '1xac7M4--kCb2DKShQy7s2A13sgfl4NxW8CXbLGW4H8o'; // Attoh Ads Live
var STORE = 'SSB';          // SSB · LGB · EMC · SW
var DAGEN = 3;              // normale run: laatste 3 dagen opnieuw
var EERSTE_RUN_DAGEN = 35;  // tab nog leeg → 35 dagen geschiedenis
var BEWAAR_DAGEN = 40;      // ouder dan dit wordt opgeruimd

function main() {
  var acc = AdsApp.currentAccount();
  var tz = acc.getTimeZone();
  var nu = new Date();
  var bijgewerkt = Utilities.formatDate(nu, tz, 'yyyy-MM-dd HH:mm');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var naam = 'Prod_' + STORE;
  var tab = ss.getSheetByName(naam) || ss.insertSheet(naam);
  var kop = ['date', 'item_id', 'title', 'impressions', 'clicks', 'cost', 'conversions', 'conv_value', 'updated_at'];
  var DAGEN_NU = tab.getLastRow() > 1 ? DAGEN : EERSTE_RUN_DAGEN;

  var dagen = {};
  for (var k = 0; k < DAGEN_NU; k++) {
    dagen[Utilities.formatDate(new Date(nu.getTime() - k * 86400000), tz, 'yyyy-MM-dd')] = true;
  }
  var grens = Utilities.formatDate(new Date(nu.getTime() - BEWAAR_DAGEN * 86400000), tz, 'yyyy-MM-dd');

  // bestaande rijen bewaren, behalve de dagen die we nu opnieuw schrijven en wat te oud is
  var oud = tab.getLastRow() > 1 ? tab.getRange(2, 1, tab.getLastRow() - 1, kop.length).getValues() : [];
  var bewaar = [];
  for (var i = 0; i < oud.length; i++) {
    var d = oud[i][0];
    var iso = (d instanceof Date) ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d).slice(0, 10);
    if (!iso || dagen[iso] || iso < grens) continue;
    oud[i][0] = iso;
    bewaar.push(oud[i]);
  }

  var van = Utilities.formatDate(new Date(nu.getTime() - (DAGEN_NU - 1) * 86400000), tz, 'yyyy-MM-dd');
  var tot = Utilities.formatDate(nu, tz, 'yyyy-MM-dd');
  var rows = AdsApp.report(
    'SELECT segments.date, segments.product_item_id, segments.product_title, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM shopping_performance_view ' +
    "WHERE segments.date BETWEEN '" + van + "' AND '" + tot + "'"
  ).rows();

  var per = {}; // date|item → telling (zelfde item kan in meerdere campagnes staan)
  var titels = {};
  while (rows.hasNext()) {
    var r = rows.next();
    var impr = Number(r['metrics.impressions']) || 0;
    var klik = Number(r['metrics.clicks']) || 0;
    var micros = Number(r['metrics.cost_micros']) || 0;
    var conv = Number(r['metrics.conversions']) || 0;
    var waarde = Number(r['metrics.conversions_value']) || 0;
    if (!impr && !klik && !micros && !conv) continue;
    var dag = String(r['segments.date']);
    var item = String(r['segments.product_item_id'] || '');
    if (!item) continue;
    var key = dag + '|' + item;
    if (!per[key]) per[key] = [dag, item, 0, 0, 0, 0, 0];
    per[key][2] += impr;
    per[key][3] += klik;
    per[key][4] += micros;
    per[key][5] += conv;
    per[key][6] += waarde;
    if (!titels[item]) titels[item] = String(r['segments.product_title'] || '');
  }

  var nieuw = [];
  for (var key2 in per) {
    var p = per[key2];
    nieuw.push([p[0], p[1], titels[p[1]], p[2], p[3], Math.round(p[4] / 10000) / 100,
      Math.round(p[5] * 100) / 100, Math.round(p[6] * 100) / 100, bijgewerkt]);
  }
  var alles = bewaar.concat(nieuw);
  alles.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });

  tab.clearContents();
  tab.getRange('A:A').setNumberFormat('@');
  tab.getRange('B:B').setNumberFormat('@');
  tab.getRange(1, 1, 1, kop.length).setValues([kop]);
  if (alles.length) {
    var blok = 20000;
    for (var s = 0; s < alles.length; s += blok) {
      var deel = alles.slice(s, s + blok);
      tab.getRange(2 + s, 1, deel.length, kop.length).setValues(deel);
    }
  }
  Logger.log(STORE + ' producten: ' + nieuw.length + ' rijen voor ' + van + ' t/m ' + tot + ' · totaal ' + alles.length + ' rijen in ' + naam);
}
