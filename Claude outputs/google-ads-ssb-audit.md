# Google Ads — SSB-opzet (mediabuyer) → kopie voor LGB

Bron: audit SSB-account 480-581-8700 via Chrome, 10 sep 2026. Mediabuyer = Robtronic Media (RTM), conversies via Trackbee.

## 1. Hoe RTM het bij SSB heeft gedaan (tijdlijn uit wijzigingsgeschiedenis)

| Datum | Wie | Wat |
|---|---|---|
| 11 aug 13:56 | info@soulsocietyboutique | Ads-account aangemaakt (GBP, tijdzone UK) |
| 11 aug 13:14 | Shopify Google & YouTube app (GSF) | Conversieacties Purchase / Add To Cart / Begin Checkout aangemaakt (naam "… – Primary Goal – Data-driven – GSF – 20260811131407") |
| 11 aug 14:13 | Simprosys (Google Shopping Feed app) | Gekoppeld als beheerder; conversies Purchases / Add to cart / Begin checkout (Website) + toegevoegd aan accountdoelen |
| 14 aug 10:33–10:48 | eigenaar | Campagne "Sales-Performance Max-1" (£5/dag, itemgroep 1, 12 hints), voorwaarden geaccepteerd, klantidentiteit aangemaakt |
| 20 aug | Google Ads System | Beveiligingsinstellingen gewijzigd |
| 22 aug 02:25 | Bulkupload | Klantbeheerder (MCC van RTM) gekoppeld; 22 aug 12:04 geaccepteerd |
| 24 aug 09:40–09:42 | Trackbee via API | 7 conversieacties aangemaakt (ORDER, ORDER_FROM_NEW_CUSTOMER, ORDER_FROM_RETURNING_CUSTOMER, ADD_TO_CART, CHECKOUT_STARTED, PRODUCT_VIEW, PAGE_VIEW). ORDER 2× opnieuw aangemaakt (oude = "[DISABLED …]") |
| 24 aug 13:28–13:30 | info@robtronicmedia | Accountinstellingen gewijzigd; voorwaarden 2× geaccepteerd; GSF Purchase / Add To Cart / Begin Checkout → **Secundair (alleen observatie)** + **opnemen in Conversies = Nee**; Add to cart + Page views uit accountdoelen verwijderd |
| 24 aug 13:34–13:35 | info@robtronicmedia | Budget aangemaakt, items (logo's/afbeeldingen) aangemaakt |
| 26 aug 15:10–15:11 | info@robtronicmedia | Campagne **"RTM \| PMax shopping \| All Products \| USA \| Convmax 26.08.26"** aangemaakt (budget, 4 platform-items, standaarddoelen account) |
| 26 aug 15:14 | info@robtronicmedia | Uitsluitingslijst **"RTM \| General Negative Keywords (ENG)"** (87 zoekwoorden) aangemaakt + gekoppeld |
| 28 aug 07:13 | eigenaar | "Sales-Performance Max-1" onderbroken |
| 9 sep 10:57 | paulius@robtronicmedia | Budget campagne 1 verhoogd |
| 9 sep 11:02 | paulius@robtronicmedia | Campagne **"… Convmax 26.08.26 #2"** aangemaakt (kopie: budget, Asset Group 1, listing-groepfilter, uitsluitingslijst, 1 bodaanpassing, land + taal, standaarddoelen) → actief |

## 2. Campagne-instellingen (campagne 1, exact)

- Type: Performance Max, doel Verkoop, Merchant Center 5837729596 (CSS: Google Shopping), feed USD_107589402953 (feedlabel), alle winkellocaties
- Bieden: Conversies maximaliseren, **geen** doel-ROAS / doel-CPA
- Budget: £30/dag (campagne 1 en #2), Sales-Performance Max-1 £5/dag (gepauzeerd)
- Conversiedoelen: accountstandaard (Aankopen)
- Klantacquisitie: gelijk bieden voor nieuwe en bestaande klanten; retentie uit; geen waarderegels
- Locatie: United States (land); taal: Engels; geen einddatum; alle apparaten
- Branding: naam "Soul Society Boutique" + 2 logo's
- Asset-optimalisatie: tekstaanpassing + uitbreiding definitieve URL + 2 andere AAN
- Geen URL-opties, geen merk-/demografische/data-uitsluitingen, geen meting van derden
- Uitsluitingslijst "RTM | General Negative Keywords (ENG)" gekoppeld
- 1 itemgroep "Asset Group 1", listing-groep = alle producten

## 3. Conversies (Doelen → Conversies)

| Actie | Bron | Status |
|---|---|---|
| ORDER (TrackBee) | Trackbee | **Primair**, actief, 90 dagen, in accountdoel Aankoop |
| ORDER (TrackBee) [DISABLED 2026-08-24] ×2 | Trackbee | oude versies, uitgeschakeld |
| ORDER_FROM_NEW_CUSTOMER / ORDER_FROM_RETURNING_CUSTOMER | Trackbee | secundair |
| ADD_TO_CART / CHECKOUT_STARTED / PRODUCT_VIEW | Trackbee (import uit klikken) | secundair |
| Purchase / Add To Cart / Begin Checkout – GSF | Shopify Google & YouTube app | secundair, Purchase inactief, niet in Conversies |

Doelenpagina toont "Vereist aandacht" (Aankoop) en "Verkeerd ingesteld" (rest) — cosmetisch: komt doordat GSF-acties secundair/inactief zijn. Trackbee ORDER is de enige teller.

## 4. Uitsluitingslijst "RTM | General Negative Keywords (ENG)" — 87 items

Alle woordgroep (phrase), behalve "Lowe's" (breed).

2ehands, 5 Below, action, Alibaba, Aliexpress, alixpress, amazon, Asos, Banggood, belfast, Best Buy, Big Lots, bol.com, Boohoo, bq, cheap, china, Compare, cost, Costco, CSV, CVS, decathlon, DHgate, direct, Dollar General, Dollar Tree, eBay, electric, Etsy, File, Flipkart, Forever 21, free, Gap, Gearbest, Gratis, H&M, Home Depot, How, ideal, ideas, Ikea, inspiration, installation, JD.com, jt atkinson, Jumia, Kmart, Lazada, local, Lowe's, Macy's, marktplaats, Marshalls, modern, Newegg, Nordstrom, Office Depot, Old Navy, Overstock, PDF, picture, plumbing, QVC, Rakuten, refurbished, Sears, Shein, Shopee, SSENSE, Staples, Taobao, Target, temu, tweedehands, Uniqlo, victorian, Walgreens, Walmart, Wayfair, What, what is the, When, Where, Wish, Zalando

## 5. Bevindingen SSB (niet kopiëren)

- Advertentiekwaliteit = "slecht" op beide campagnes (te weinig assets: alleen 2 logo's, rest auto).
- Campagne #2 is een identieke kopie van campagne 1 (zelfde feed, alle producten, USA) → concurreert met zichzelf; alleen zinvol als bewuste test.
- Account in GBP/UK-tijdzone terwijl markt USA is (kan niet meer wijzigen). LGB-account 984-701-3293 staat ook in GBP — zelfde situatie, werkt, maar rapportage in £.
- Klantacquisitie-doel kon niet aan (doelgroep < 100 leden) — genegeerd, prima.

## 6. Kopieerlijst LGB (984-701-3293) — vóór de eerste euro

1. **Merchant Center LGB**: feed via Shopify Google & YouTube app, land Australië (+ NZ als 2e land/feedlabel), valuta AUD. Koppel MC aan Ads-account (Tools → Gegevensbeheer → Gekoppelde accounts). Wacht tot producten goedgekeurd zijn (Producten → Diagnostiek).
2. **Trackbee installeren** op LGB → koppelen aan Ads-account → Trackbee maakt de 7 conversieacties zelf aan.
3. **Doelen → Conversies**:
   - ORDER (TrackBee) = Primair, telling "elke", klik-window 90 dagen, attributie data-driven, in accountdoel Aankoop.
   - Alle andere Trackbee-acties = Secundair.
   - De 5 bestaande (GSF) acties in LGB = Secundair + "opnemen in Conversies" = Nee. Nooit twee primaire aankoop-acties.
   - Accountdoelen: alleen Aankoop; Add to cart / Page views eruit.
4. **Uitsluitingslijst** aanmaken: Tools → Gedeelde bibliotheek → Lijsten met uitzonderingen → naam "LGB | General Negative Keywords (ENG)" → plak lijst uit §4 (woordgroep). Voor AUS/NZ erbij: myer, david jones, the iconic, cotton on, big w, catch, kogan, ezibuy, trade me, the warehouse, farmers.
5. **Campagne**: Nieuwe campagne → Verkoop → Performance Max → Merchant Center LGB, feedlabel AU.
   - Naam: `LGB | PMax shopping | All Products | AUS | Convmax <datum>`
   - Bieden: Conversies maximaliseren, geen doel-ROAS/CPA.
   - Budget: 30/dag (zelfde als SSB), geen einddatum.
   - Locatie: Australië (+ Nieuw-Zeeland als je NZ meeneemt); locatie-optie "Aanwezigheid" (mensen in de doellocatie). Taal: Engels.
   - Conversiedoelen: accountstandaard. Klantacquisitie: gelijk bieden, retentie uit.
   - Asset-optimalisatie: tekstaanpassing + uitbreiding definitieve URL AAN. Alle apparaten. Geen uitsluitingen.
   - 1 itemgroep, listing-groep = alle producten. Branding: LGB-naam + 2 logo's (breed + vierkant). Voeg wél 5 koppen, 5 beschrijvingen, 3–5 afbeeldingen toe (SSB scoort "slecht" zonder).
   - Uitsluitingslijst koppelen (Instellingen → Uitsluitingszoekwoorden).
6. **Accountinstellingen** (Beheerder → Accountinstellingen): auto-tagging AAN (nodig voor Trackbee), automatisch toegepaste aanbevelingen UIT.
7. Maak NIET de standaard Shopify-campagne ("Sales-Performance Max-1") aan — of pauzeer hem direct.
8. Eén campagne, geen #2-kopie.

## 7. Na livegang — waarop letten

- Leerfase 1–2 weken: niets aanpassen; budget max +20% per keer.
- Conversies: kolom "Conversies" ≈ Shopify-orders (Trackbee telt binnen 24–48 u). Afwijking > 15% → Trackbee-tag checken.
- Merchant Center diagnostiek: afkeuringen (prijs/verzending/maat) direct fixen — dit is de GMC-reden achter maattabellen en policies.
- Inzichten → Zoektermen wekelijks → nieuwe uitsluitingen aan de lijst toevoegen.
- Advertentiekwaliteit minimaal "goed".
- Na 30–50 conversies: overweeg doel-ROAS (start op de gemeten ROAS − 20%).
- SSB-benchmark 11 aug–10 sep: £404 kosten / 16 conversies ≈ £25 per order.
