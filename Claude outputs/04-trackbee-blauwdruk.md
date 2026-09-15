# TrackBee — blauwdruk per store (referentie SSB, 13-9-2026)

RTM heeft TrackBee op SSB ingericht. LGB is op 13-9 exact zo gedaan. Dit is de configuratie voor elke volgende store.

## Google-integratie (status Connected)
| Instelling | Waarde |
|---|---|
| TrackBee Conversion Booster | AAN |
| Profit optimization | UIT |
| Send cart data to Google Ads | AAN — Product ID mode: **Global** |
| Google Ads Conversion Enhancement | AAN |
| Include VAT in conversion tracking | AAN |
| Track new / returning customers | UIT |
| Shopify Markets | UIT (ook bij AU+NZ uit één account) |
| Manager Ad Account | Robtronic Media (210-638-2617) — zolang RTM toegang heeft; bij eigen beheer: eigen MCC |
| Ad Account | het store-eigen account |

## Google Analytics 4
Per store een EIGEN GA4-property + datastream: Measurement ID uit de stream, API Secret nieuw genereren (GA4 → Beheer → Datastreams → stream → Measurement Protocol API secrets → Maken). SSB = G-V66YCXBMN4 — nooit hergebruiken.

## In Google Ads na koppeling
- TrackBee maakt 7 acties aan. ORDER (TrackBee) → Primair; rest Secundair.
- Shopify-app-acties (Google Shopping App Purchase etc.) → Secundair + niet in Conversies. Bestemmingen van de Shopify-app → "Niet meten in gekoppeld account" (voorkomt dubbeltelling).
- ORDER staat "Inactief / 0" tot de eerste order. Na de eerste verkoop controleren dat hij Actief wordt; blijft hij inactief, dan draait PMax zonder signaal.

## Aandachtspunten
- VAT-toggle AAN = conversiewaarde inclusief belasting (AU/NZ: GST). Overal gelijk houden, anders zijn ROAS-cijfers tussen stores niet vergelijkbaar.
- Conversiewaarde in Ads structureel ±10% naast Shopify → VAT-toggle vs feed checken.
- TrackBee levert attributie, GEEN ad spend. Ad spend komt uit het Google Ads Script (06).
- Installatie op een store waar de Google & YouTube-app al staat: de tutorial-stappen "app installeren" overslaan; alleen de conversie-instellingen zoals hierboven.
