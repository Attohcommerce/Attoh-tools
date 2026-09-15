# Google Ads — hoe Robtronic Media het op SSB heeft opgezet (audit 10-9-2026)

Bron: SSB-account 480-581-8700, uitgelezen via Chrome op 10 sep 2026 (wijzigingsgeschiedenis, campagne-instellingen, conversies, gedeelde bibliotheek). Dit is de nulmeting van het project: alles wat RTM hierna doet, wordt hiertegen afgezet in het strategie-logboek (09).

## 1. Tijdlijn — wie deed wat (uit de wijzigingsgeschiedenis)

| Datum | Wie | Wat |
|---|---|---|
| 11 aug 13:14 | Shopify Google & YouTube app (GSF) | Conversieacties Purchase / Add To Cart / Begin Checkout aangemaakt |
| 11 aug 13:56 | eigenaar | Ads-account aangemaakt (GBP, tijdzone UK) |
| 11 aug 14:13 | Simprosys | Gekoppeld als beheerder; eigen conversies Purchases / Add to cart / Begin checkout + toegevoegd aan accountdoelen |
| 14 aug 10:33–10:48 | eigenaar | Campagne "Sales-Performance Max-1" (£5/dag, 1 itemgroep, 12 hints), voorwaarden geaccepteerd |
| 20 aug | Google Ads System | Beveiligingsinstellingen gewijzigd |
| 22 aug 02:25 / 12:04 | bulkupload / RTM | MCC van RTM gekoppeld en geaccepteerd |
| **24 aug 09:40–09:42** | **Trackbee via API** | 7 conversieacties: ORDER, ORDER_FROM_NEW_CUSTOMER, ORDER_FROM_RETURNING_CUSTOMER, ADD_TO_CART, CHECKOUT_STARTED, PRODUCT_VIEW, PAGE_VIEW. ORDER 2× opnieuw aangemaakt (oude → "[DISABLED …]") |
| **24 aug 13:28–13:30** | **info@robtronicmedia** | GSF Purchase / Add To Cart / Begin Checkout → Secundair (alleen observatie) + "opnemen in Conversies" = Nee; Add to cart + Page views uit accountdoelen |
| 24 aug 13:34–13:35 | RTM | Budget aangemaakt; items (logo's/afbeeldingen) aangemaakt |
| **26 aug 15:10–15:11** | **RTM** | Campagne **"RTM \| PMax shopping \| All Products \| USA \| Convmax 26.08.26"** aangemaakt (budget, 4 platform-items, standaarddoelen) |
| 26 aug 15:14 | RTM | Uitsluitingslijst **"RTM \| General Negative Keywords (ENG)"** (87 woorden) aangemaakt + gekoppeld |
| 28 aug 07:13 | eigenaar | "Sales-Performance Max-1" onderbroken |
| **9 sep 10:57** | **paulius@robtronicmedia** | Budget campagne 1 verhoogd |
| **9 sep 11:02** | **paulius@robtronicmedia** | Campagne **"… Convmax 26.08.26 #2"** aangemaakt als kopie (budget, Asset Group 1, listing-groepfilter, uitsluitingslijst, 1 bodaanpassing, land + taal) → actief |

Wat de tijdlijn al vertelt over hun methode: eerst tracking schoon (één primaire aankoopactie, al het andere secundair), dan pas een campagne; campagne live op dag 15 van het account; twee weken niets aanpassen; op dag 29 budget omhoog én een tweede identieke campagne. De reden voor #2 staat nergens — dat is de eerste vraag voor Slack.

## 2. Campagne-instellingen (campagne 1, exact)
- Type Performance Max, doel Verkoop, Merchant Center 5837729596, feed USD_107589402953, alle winkellocaties
- Bieden: **Conversies maximaliseren, géén doel-ROAS, géén doel-CPA**
- Budget: £30/dag (campagne 1 én #2); "Sales-Performance Max-1" £5/dag gepauzeerd
- Conversiedoelen: accountstandaard (Aankopen)
- Klantacquisitie: gelijk bieden voor nieuwe en bestaande klanten; retentie uit; geen waarderegels
- Locatie: United States (land), taal Engels, geen einddatum, alle apparaten
- Branding: naam "Soul Society Boutique" + 2 logo's
- Asset-optimalisatie: tekstaanpassing + uitbreiding definitieve URL + 2 andere AAN
- Geen URL-opties, geen merk-/demografische/data-uitsluitingen, geen meting van derden
- Uitsluitingslijst "RTM | General Negative Keywords (ENG)" gekoppeld
- 1 itemgroep "Asset Group 1", listing-groep = alle producten

## 3. Conversies (Doelen → Conversies)
| Actie | Bron | Status |
|---|---|---|
| ORDER (TrackBee) | Trackbee | **Primair**, actief, klik-window 90 dagen, in accountdoel Aankoop |
| ORDER (TrackBee) [DISABLED 2026-08-24] ×2 | Trackbee | oude versies, uit |
| ORDER_FROM_NEW_CUSTOMER / ORDER_FROM_RETURNING_CUSTOMER | Trackbee | secundair |
| ADD_TO_CART / CHECKOUT_STARTED / PRODUCT_VIEW | Trackbee | secundair |
| Purchase / Add To Cart / Begin Checkout – GSF | Shopify-app | secundair, Purchase inactief, niet in Conversies |

"Vereist aandacht"/"Verkeerd ingesteld" op de doelenpagina is cosmetisch: TrackBee ORDER is de enige teller. Regel: **nooit twee primaire aankoopacties** (dubbeltelling).

## 4. Uitsluitingslijst "RTM | General Negative Keywords (ENG)" — 87 items, allemaal woordgroep behalve "Lowe's" (breed)
2ehands, 5 Below, action, Alibaba, Aliexpress, alixpress, amazon, Asos, Banggood, belfast, Best Buy, Big Lots, bol.com, Boohoo, bq, cheap, china, Compare, cost, Costco, CSV, CVS, decathlon, DHgate, direct, Dollar General, Dollar Tree, eBay, electric, Etsy, File, Flipkart, Forever 21, free, Gap, Gearbest, Gratis, H&M, Home Depot, How, ideal, ideas, Ikea, inspiration, installation, JD.com, jt atkinson, Jumia, Kmart, Lazada, local, Lowe's, Macy's, marktplaats, Marshalls, modern, Newegg, Nordstrom, Office Depot, Old Navy, Overstock, PDF, picture, plumbing, QVC, Rakuten, refurbished, Sears, Shein, Shopee, SSENSE, Staples, Taobao, Target, temu, tweedehands, Uniqlo, victorian, Walgreens, Walmart, Wayfair, What, what is the, When, Where, Wish, Zalando

Dit is een generieke lijst (er staan NL-woorden en bouwmarkt-termen in) — RTM gebruikt hem kennelijk over al hun klanten heen. Per markt aanvullen met lokale retailers (AUS/NZ: myer, david jones, the iconic, cotton on, big w, catch, kogan, ezibuy, trade me, the warehouse, farmers).

## 5. Bevindingen SSB — NIET kopiëren
- Advertentiekwaliteit "slecht" op beide campagnes: alleen 2 logo's, geen koppen/beschrijvingen/afbeeldingen. Bij LGB wél 5 koppen, 5 beschrijvingen, 3–5 afbeeldingen.
- Campagne #2 = identieke kopie (zelfde feed, alle producten, USA) → concurreert met zichzelf. Alleen zinvol als bewuste test; RTM heeft dit niet uitgelegd.
- Account in GBP/UK-tijd terwijl de markt USA is. Werkt, maar rapportage in £ en dagvenster op UK-tijd.
- Klantacquisitie-doel kon niet aan (doelgroep < 100) — genegeerd, prima.

## 6. Kopieerlijst nieuwe store (gebruikt voor LGB 984-701-3293) — vóór de eerste euro
1. **Merchant Center**: feed via Shopify Google & YouTube app, juiste land + valuta; koppel MC aan Ads (Tools → Gegevensbeheer → Gekoppelde accounts); wacht op groene Diagnostiek.
2. **TrackBee** installeren → koppelen aan het Ads-account → maakt de 7 conversieacties zelf (04).
3. **Conversies**: ORDER (TrackBee) primair, telling "elke", 90 dagen, data-driven, in accountdoel Aankoop. Alle andere TrackBee-acties secundair. Bestaande Shopify-app-acties secundair + "opnemen in Conversies" = Nee. Accountdoelen alleen Aankoop.
4. **Uitsluitingslijst** "<STORE> | General Negative Keywords (ENG)" — lijst §4 + lokale retailers, woordgroep.
5. **Campagne**: Verkoop → Performance Max → MC + feedlabel. Naam `<STORE> | PMax shopping | All Products | <MARKT> | Convmax <datum>`. Conversies maximaliseren zonder tROAS/tCPA. Budget 30/dag, geen einddatum. Locatie = markt, optie "Aanwezigheid". Taal Engels. Accountstandaard-doelen. Klantacquisitie gelijk, retentie uit. Asset-optimalisatie AAN. Alle apparaten. Geen uitsluitingen. 1 itemgroep, alle producten. Branding + logo's (breed én vierkant) + 5 koppen + 5 beschrijvingen + 3–5 afbeeldingen. Uitsluitingslijst koppelen.
6. **Accountinstellingen**: auto-tagging AAN (nodig voor TrackBee), automatisch toegepaste aanbevelingen UIT, contact gegevensbeveiliging invullen.
7. De standaard Shopify-campagne "Sales-Performance Max-1" NIET aanmaken, of direct pauzeren.
8. Eén campagne, geen #2-kopie.
9. Erbij (les 12-9): kleine Search-campagne £5/dag laten lopen voor Keyword Planner-toegang.

## 7. Na livegang — wat RTM (vermoedelijk) aanhoudt, te bevestigen in het logboek
- Leerfase 1–2 weken niets aanpassen; budget max +20% per keer.
- Conversies ≈ Shopify-orders (TrackBee telt binnen 24–48 u); afwijking > 15% → tag checken.
- Merchant Center diagnostiek: afkeuringen direct fixen.
- Zoektermen wekelijks → nieuwe uitsluitingen.
- Advertentiekwaliteit minimaal "goed".
- Na 30–50 conversies: doel-ROAS overwegen (start op gemeten ROAS − 20%).
Deze punten zijn deels eigen best practice, nog niet bewezen RTM-gedrag. Zodra het logboek een RTM-ingreep laat zien die hierbij past, wordt het punt in het playbook (11) als "bevestigd" gemarkeerd.
