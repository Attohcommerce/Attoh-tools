# Stores en accounts — feitenblad (stand 14-9-2026)

Alles wat hier staat is geverifieerd in eerdere sessies. Getallen met een ID zijn letterlijk over te nemen. Bij twijfel: dit bestand wint van het geheugen.

## Bedrijven
- **ATTOH COMMERCE LTD** — UK Ltd, Companies House 17242162, 71–75 Shelton Street, Covent Garden, London WC2H 9JQ. Adverteerdersverificatie Google Ads (Dun & Bradstreet) is op deze entiteit gedaan.
- **Sa Collective LLC** — US, reg. 42-3368597, 25 Prospect St, Watertown MA 02472. Entiteit achter de vier Sa Collective-stores (Julia Raven, Dunhill Lily, Alessandra Mariano, Emily Neill).
- Warehouse (alle stores): Building 4, 4th Floor, 58 Baiye Road, 523000 Guangdong, China.
- Leverancier/fulfilment: Kungfubuy (bills in EUR, per invoice met orderregels).

## Soul Society Boutique (SSB) — de referentiestore
| | |
|---|---|
| Markt | USA |
| Assortiment | dames + heren sinds aug 2026 (was dames-only) |
| Shopify-valuta | **USD** — P&L rekent om naar £ |
| Shopify-domein | 0d6n10-zj.myshopify.com, tijdzone London |
| Google Ads | **480-581-8700** — GBP, tijdzone UK, aangemaakt 11-8-2026 (kan niet meer wijzigen) |
| MCC mediabuyer | Robtronic Media **210-638-2617** |
| Merchant Center | 5837729596 (CSS Google Shopping), feed via Simprosys, feedlabel USD_107589402953 |
| Conversies | TrackBee (ORDER primair), GA4 G-V66YCXBMN4 — store-specifiek, nooit kopiëren |
| P&L-sheet | 1hwv6MnKzOFlGhxe5vWSApglqwZDTYp-boT0fqGgoFiM |
| Apps Script (gebonden) | 1iepNKtXYTAlNFpRAa3tJXQkl9LHdZJ_F3HdYVXKDPjZhbPkNRqrYRgE3 |
| Shopify-app P&L | "P&L Sync" (p-l-sync-3), read_orders + read_all_orders; ook de Orders-app van de Bills-module |
| Ad spend in P&L | nog via Two Minute Reports (£80/mnd) → wordt vervangen door het Google Ads Script (06) — zie 12 |
| Mediabuyer-fee | 10% van ad spend (cel O9 in de P&L) |
| Benchmark RTM | 11 aug–10 sep 2026: £404 kosten / 16 conversies ≈ £25 per order |
| Bekende issues | ±413 producten allemaal op vaste −50% doorstreepprijs; "★ Loved by customers 4.7/5"-badge zonder reviews → beide GMC-risico, nog niet opgelost |
| Beeld | modern gallery-interieur, pale plaster/concrete, vrouwen 25–40; prijsbanden USD eindigend op X4,95/X9,95 |

## Lady Glam Boutique (LGB) — eerste kopie van de RTM-opzet
| | |
|---|---|
| Markt | Australië + Nieuw-Zeeland, dames-only |
| Shopify-valuta | **AUD** — P&L rekent om naar £ |
| Shopify-handle | lornvale; tijdzone → London (gelijk aan ad-account) |
| Google Ads | **984-701-3293** — GBP, aangemaakt 9-9-2026 |
| Conversies | TrackBee geïnstalleerd 13-9 volgens SSB-blauwdruk (04); ORDER (TrackBee) staat "Inactief/0" tot de eerste verkoop → daarna controleren dat hij Actief wordt |
| Campagnes | PMax volgens kopieerlijst (03 §6) + **"LGB \| Search \| AUS+NZ \| Keyword data unlock"** £5/dag, max CPC £0,40 — NOOIT pauzeren (ontgrendelt exacte Keyword Planner-data) |
| Uitsluitingslijst | "LGB \| General Negative Keywords (ENG)" = 87 RTM-woorden + AUS/NZ-retailers (03 §6.4) |
| P&L-sheet | 1-bSai9JR5zGqwbfzV1UegahVtmAa5R-RO5CAQOT7SRU — omzet-sync live (06:30), ad-spend-script live (06:00–07:00 accounttijd), getest 12/09: omzet £37,14, ad spend £65,60 |
| Apps Script (gebonden) | 1pRRr-K8nSEkgDm9LFI7KbpzXpWRjBtsRKQRwTWRqsx8fN3-fq_bFPcPo |
| Nog in te vullen | Shopify Payments-tarieven O6/O7/O8; omzet 12/09 nacontroleren tegen Shopify Analytics |
| Merk | Charcoal #241D20 · Deep Plum #5B3947 · Mauve #9E7C88 · Ivory #F9F5F0 · Crimson #BE1734 alleen sale. Vrouwen 25–40, avond-boutique, trans-seasonal |

## Everman Clothing (EMC) — volgende store
| | |
|---|---|
| Markt | Australië primair + Nieuw-Zeeland, **heren-only** |
| Domein | evermanclothing.com (GoDaddy → Shopify). Let op: ≠ everymanclothing.com (mét y, USA, 55+) — andere store |
| Lanceervenster | okt–nov–dec 2026 + jan 2027 (AUS lente → zomer) |
| Valuta | AUD |
| Google Ads | nog geen account. Bij aanmaken: valuta en tijdzone bewust kiezen (staat daarna vast) — zie 03 §5 en 11 |
| Keywords | research gedraaid 11–13 sep; verdeling "emc 2.0" beoordeeld met 6/10 (geslachtsfout, inmiddels gefixt in de tool, zie 07). Nieuwe run nodig met "alleen Man" |
| Geheugen-sheet AUS+NZ | 1QSML8DDEXzrcLUbm-wrLkHBAh6g4GWOXB2v0AggyZXU (gedeeld met service account; nog koppelen in Attoh Tools → Keywords → Geheugen) |
| STORE_PROFILES | evermanclothing.com: market AUS, genders M, footwearCap 0,18 |

## Overige stores in het portfolio (context voor "de zes die komen")
Sa Collective LLC: **Julia Raven** (AUS+NZ, M/V, juliaraven.com), **Dunhill Lily** (AUS+NZ, M/V, dunhill-lily.com), **Alessandra Mariano** (CAN, dames, alessandramariano.com), **Emily Neill** (CAN, M/V, emilyneill.com). Verder: Clara James London (UK), Clara & Rose Vancouver (CAN), Clara & Sienna Dublin (IE), Evelyn Grace London (UK), Ruby & Mason Newport (USA). Harde regel sinds 18-8-2026: **max 300 producten per store**.

## Gedeelde infrastructuur
- **Attoh Tools**: https://attoh-tools.vercel.app — repo github.com/Attohcommerce/Attoh-tools (public, main), lokale kloon C:\Users\justi\OneDrive\Documents\GitHub\Attoh-tools, deploy via GitHub Desktop commit+push → Vercel.
- **Google service account** attoh-sheets@attoh-tools.iam.gserviceaccount.com — elke sheet die de tool leest/schrijft één keer delen als Bewerker.
- **Sheets**: Import-werkboek 1Y3wg8X5ivuwaUTfUapzgUOIMzVqr0KRs6g2FR1COuKE · Geheugen 1gbu2XAZMPBIbyr47B_rBvoHDcWoVaTNUuBNwmp9ucJg · Keyword-research 1nsUSUjWAWqLZOIkzNEipRPnWbVKryC29iSy9fByhcGw · Collection & Product organization 1MaVHQ76s54lrZkNPfr-J32y7GvjJpLfV2j-m0MvXO3g.
- **Shopify-apps**: aanmaken in het Dev Dashboard (dev.shopify.com), Client ID + Secret, tool mint zelf tokens (client credentials). Eén app is op meerdere stores installeerbaar.
- **Keyword Planner**: exacte cijfers alleen in een account met een LOPENDE Search-campagne (min. £5/dag). PMax alleen = ranges. Data is accountonafhankelijk; alle batches van één research op dezelfde dag exporteren.
- **FX-conventie** overal: ECB-dagkoers van de orderdag (frankfurter API), weekend/feestdag → laatste bankdag.
- **Tijdzone-regel**: Shopify-tijdzone = tijdzone van het ad-account. Nieuwe ad-accounts: bewust kiezen vóór aanmaken.
