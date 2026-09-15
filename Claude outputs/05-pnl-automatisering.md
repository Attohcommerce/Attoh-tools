# P&L-automatisering — hoe het werkt en hoe je het voor een nieuwe store opzet (stand 14-9-2026)

Twee sheets live: **SSB** (1hwv6MnKzOFlGhxe5vWSApglqwZDTYp-boT0fqGgoFiM) en **LGB** (1-bSai9JR5zGqwbfzV1UegahVtmAa5R-RO5CAQOT7SRU). Opzet geïnspireerd op de sheets van coach Chaim, zelf gebouwd.

## Sheet-ontwerp
- Tabs per maand (August, September, …, Engelse namen), Refund Sheet, COGS Log. SSB heeft nog AdSpend + TMR Query Logs (vervallen zodra het script draait).
- Alles in **£**. Schakelaar O3 GBP/EUR + koers O4 is alleen weergave, gesynchroniseerd over alle maandtabs.
- Zichtbare tabel = formules over het **raw-invoerblok S–V** per datumrij: S orders · T omzet £ · U ad spend £ · V COGS £. Rij 3 = dag 1.
- Fees: omzet × (O6% + O7%) + O8 × orders (defaults 2,9% + 1,5% + £0,25; LGB nog echte Shopify Payments-tarieven invullen). Mediabuyer-fee O9 = 10% van ad spend. Netto = bruto − refunds − alertkosten − mediabuyer.
- Kleuren: positief `[Color10]` (donkergroen), negatief `[Red]`. **Nooit `[Green]`** (neon). Kleur zoeken: `getNumberFormat()`, niet `getFontColor()`.

## De vier automatiseringen
1. **Omzet + refunds** — gebonden Apps Script, trigger `syncShopifyDaily` 06:30. Haalt gisteren's orders via Shopify Admin REST (client-credentials token via app "P&L Sync", gecachet in Script Properties), telt orders + total_price, rekent om naar £ met ECB-dagkoers (frankfurter.dev, fallback .app, weekend → laatste bankdag, gecachet als FX_<VAL>GBP_<datum>), schrijft S/T. Refunds van gisteren → Refund Sheet vanaf rij 10, dedupe op order+bedrag. SSB: USD→GBP (`fxRateUsdGbp_`), LGB: AUD→GBP (`fxRateAudGbp_`).
2. **Ad spend** — Google Ads Script (06) in het ad-account, dagelijks 06:00–07:00 accounttijd, schrijft gisteren's kosten in kolom U van de juiste datumrij (match op de datumtekst in kolom R, cijfers-only). Ads rekent al in £ → geen omrekening. LGB live sinds 13-9. SSB: script gereed, nog activeren en Two Minute Reports opzeggen.
3. **COGS** — Bills-module in Attoh Tools: Kungfubuy-PDF's uploaden → parser (pdfjs, coördinaten) → per order Shopify-lookup voor de orderdatum → ECB-koers van de orderdatum → COGS Log (Datum | Order | Invoice | Stuks | Bedrag | Valuta | Koers | Bedrag £ | Storecode) → V = som van het log per datum. Dedupe op order#+invoice#, vandaag nooit ingevuld, log = waarheid.
4. **Valuta-schakelaar** — onEdit op O3/O4, zelfherstellend als de cel in de kop belandt.

## Nieuwe store opzetten (volgorde die bij LGB werkte)
1. Kopie maken van de LGB-sheet (schoonste versie, geen TMR-restanten) → naam "P&L Sheet <Store>". Leegmaken: S3:V(laatste) in alle maandtabs, Refund Sheet rij 10+, COGS Log rij 2+.
2. Shopify: app "P&L Sync" installeren op de store (Dev Dashboard, read_orders + read_all_orders + Protected customer data). Client ID + Secret bovenin Code.gs plakken — **Justin plakt dit zelf**, secrets nooit door Claude in chat of browser laten typen. Shop-domein (xxx.myshopify.com) invullen. Shopify-tijdzone = tijdzone ad-account.
3. Code.gs: valutapaar aanpassen (`from=<STORE-VALUTA>`), sheet-titel, en de FX-cachesleutel. Trigger `syncShopifyDaily` dagelijks 06:30. Eén keer handmatig draaien en autoriseren (OAuth-scherm: Geavanceerd → doorgaan). Uitvoeringslogboek: bedrag voor gisteren moet kloppen met Shopify Analytics.
4. Google Ads: Tools → Bulkacties → Scripts → nieuw script → 06 plakken met de juiste SHEET_ID → Autoriseren → Preview (moet het bedrag van gisteren loggen) → Uitvoeren → frequentie Dagelijks 06:00 → Opslaan. Sheet delen met het Google-account waarmee je autoriseert.
5. Sheet delen met attoh-sheets@attoh-tools.iam.gserviceaccount.com (Bewerker) voor de Bills-module; Bills-pagina → store toevoegen → Orders-app-sleutels → Test koppeling → sheet-ID.
6. O6/O7/O8 Shopify Payments-tarieven van die store; O9 mediabuyer-fee (10% zolang RTM, daarna 0).
7. Eerste week: dagelijks S/T/U/V vergelijken met Shopify Analytics, Google Ads en de bills.

## Lessen (niet opnieuw tegenaan lopen)
- `ss.getSpreadsheetTimeZone()` bestaat NIET in Google Ads Scripts → daarom matcht het script op `getDisplayValues()` en cijfers-only.
- Apps Script-functiedropdown "pakt" soms een andere functie: bij twijfel de andere functie tijdelijk verwijderen.
- Apps Script via Chrome: opslaan via de knop "Project opslaan in Drive", Ctrl+S werkt niet; `getNumColumns()` niet `getNumCols()`.
- USER_ENTERED + NL-locale = datumrommel → altijd RAW schrijven.
- ECB-middenkoers ≠ wat Payoneer/kaart afrekent (±1–2% ongunstiger) — bewust geaccepteerd.
- Nieuwe maandtabs (okt–dec) eind september toevoegen: kopie van September, schakelaar O3/O4 blijft werken zolang de tabnaam een Engelse maandnaam is.
