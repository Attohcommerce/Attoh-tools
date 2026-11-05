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
 * Ontbreekt er een dag in die periode (script stond uit), dan haalt de volgende
 * run alles vanaf de oudste ontbrekende dag opnieuw op (gat-reparatie, 05-11).
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
  var dagStr = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var tot = dagStr(nu);
  var grens = dagStr(new Date(nu.getTime() - BEWAAR_DAGEN * 86400000));

  // bestaande rijen lezen; onthoud de laatste datum die al in de tab staat
  var oud = tab.getLastRow() > 1 ? tab.getRange(2, 1, tab.getLastRow() - 1, kop.length).getValues() : [];
  var laatste = '';
  for (var i0 = 0; i0 < oud.length; i0++) {
    var d0 = oud[i0][0];
    var iso0 = (d0 instanceof Date) ? dagStr(d0) : String(d0).slice(0, 10);
    oud[i0][0] = iso0;
    if (iso0 > laatste) laatste = iso0;
  }

  // hoeveel dagen terug ophalen: normaal DAGEN; lege tab → EERSTE_RUN_DAGEN;
  // zit er een gat (script stond stil of de tab is incompleet) → vanaf de laatste
  // aanwezige datum, tot maximaal EERSTE_RUN_DAGEN terug
  var DAGEN_NU = oud.length ? DAGEN : EERSTE_RUN_DAGEN;
  if (oud.length && laatste) {
    var gat = Math.round((nu.getTime() - new Date(laatste + 'T12:00:00Z').getTime()) / 86400000) + 1;
    if (gat > DAGEN_NU) DAGEN_NU = Math.min(EERSTE_RUN_DAGEN, gat);
  }
  // gat-reparatie (05-11): ontbreekt er een dag MIDDEN in de laatste
  // EERSTE_RUN_DAGEN dagen (script stond een paar dagen uit), dan vanaf de
  // oudste ontbrekende dag opnieuw ophalen — anders blijven 7/14/30 d scheef
  // dagen die al eens zijn opgehaald (ook als er die dag niets draaide) staan in
  // de scripteigenschappen — anders haalt een dag zonder vertoningen elk uur
  // opnieuw 35 dagen op
  var props = PropertiesService.getScriptProperties();
  var propKey = 'opgehaald_' + STORE;
  var opgehaald = {};
  try { opgehaald = JSON.parse(props.getProperty(propKey) || '{}') || {}; } catch (e0) { opgehaald = {}; }
  if (oud.length) {
    var aanwezig = {};
    for (var i1 = 0; i1 < oud.length; i1++) aanwezig[oud[i1][0]] = true;
    for (var dk0 in opgehaald) aanwezig[dk0] = true;
    for (var k1 = EERSTE_RUN_DAGEN - 1; k1 >= 1; k1--) {
      var dk = dagStr(new Date(nu.getTime() - k1 * 86400000));
      if (!aanwezig[dk]) {
        if (k1 + 1 > DAGEN_NU) DAGEN_NU = k1 + 1;
        break;
      }
    }
  }

  var dagen = {};
  for (var k = 0; k < DAGEN_NU; k++) {
    dagen[dagStr(new Date(nu.getTime() - k * 86400000))] = true;
  }
  var van = dagStr(new Date(nu.getTime() - (DAGEN_NU - 1) * 86400000));

  // bestaande rijen bewaren, behalve de dagen die we nu opnieuw schrijven en wat te oud is
  var bewaar = [];
  for (var i = 0; i < oud.length; i++) {
    var iso = oud[i][0];
    if (!iso || dagen[iso] || iso < grens) continue;
    bewaar.push(oud[i]);
  }
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
  for (var u = 0; u < alles.length; u++) {
    var ua = alles[u][8];
    if (ua instanceof Date) alles[u][8] = Utilities.formatDate(ua, tz, 'yyyy-MM-dd HH:mm');
  }

  // Veilig schrijven: eerst alles in een tijdelijke tab, dan omwisselen. Zo blijft
  // de oude tab heel als het schrijven halverwege misgaat (anders: halve data).
  var tmpNaam = naam + '_tmp';
  var tmp = ss.getSheetByName(tmpNaam);
  if (tmp) ss.deleteSheet(tmp);
  tmp = ss.insertSheet(tmpNaam);
  try {
    if (tmp.getMaxColumns() > kop.length) tmp.deleteColumns(kop.length + 1, tmp.getMaxColumns() - kop.length);
    var nodig = alles.length + 1;
    if (tmp.getMaxRows() < nodig) tmp.insertRowsAfter(tmp.getMaxRows(), nodig - tmp.getMaxRows());
    else if (tmp.getMaxRows() > nodig + 1) tmp.deleteRows(nodig + 1, tmp.getMaxRows() - nodig - 1);
    tmp.getRange('A:B').setNumberFormat('@');
    tmp.getRange('I:I').setNumberFormat('@');
    tmp.getRange(1, 1, 1, kop.length).setValues([kop]);
    // kleinere blokken + opnieuw proberen: Sheets geeft bij grote writes soms
    // een tijdelijke "systeemfout"
    var blok = 4000;
    for (var s = 0; s < alles.length; s += blok) {
      var deel = alles.slice(s, s + blok);
      opnieuw(function () {
        tmp.getRange(2 + s, 1, deel.length, kop.length).setValues(deel);
        SpreadsheetApp.flush();
      });
    }
    if (tmp.getLastRow() !== nodig) throw new Error('Niet alles geschreven: ' + (tmp.getLastRow() - 1) + ' van ' + alles.length + ' rijen');
  } catch (e) {
    // mislukt → tijdelijke tab weg, oude tab blijft onaangeroerd
    ss.deleteSheet(tmp);
    throw e;
  }
  opnieuw(function () { ss.deleteSheet(tab); });
  opnieuw(function () { tmp.setName(naam); });
  // opgehaalde dagen onthouden (alleen de laatste BEWAAR_DAGEN)
  for (var dg in dagen) opgehaald[dg] = 1;
  var schoon = {};
  for (var dg2 in opgehaald) if (dg2 >= grens) schoon[dg2] = 1;
  props.setProperty(propKey, JSON.stringify(schoon));
  Logger.log(STORE + ' producten: ' + nieuw.length + ' rijen voor ' + van + ' t/m ' + tot + ' · totaal ' + alles.length + ' rijen in ' + naam);
}

// tot 3× opnieuw proberen bij een tijdelijke fout van Google (Sheets/Ads)
function opnieuw(fn) {
  for (var p = 0; ; p++) {
    try { return fn(); } catch (e) {
      if (p >= 2) throw e;
      Utilities.sleep(3000 * (p + 1));
    }
  }
}
