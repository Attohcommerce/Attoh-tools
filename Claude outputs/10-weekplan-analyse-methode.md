# Weekplan-analyse — hoe Claude een RTM-weekplan tegen de data legt

Elke maandag, na de weekscan (08 B) en het weekplan (08 C). Vaste volgorde, zodat elke week hetzelfde soort uitkomst geeft en het playbook groeit in plaats van dat elke week een los verhaal wordt.

## Stap 1 — Gezegd vs gedaan
Leg het weekplan van vorige week naast de wijzigingsgeschiedenis van vorige week.
- Gezegd én gedaan → logboekregel met "waarom = Slack".
- Gezegd, niet gedaan → noteren; volgende week nog eens checken; is het na twee weken nog niet gedaan, dan was het geen echte regel.
- Gedaan, niet gezegd → dit zijn de interessantste: vraag stellen in Slack (formulering in 08 C).

## Stap 2 — Effect meten
Per ingreep uit het logboek die 7+ dagen oud is: kosten, conversies, conversiewaarde en ROAS in de 7 dagen ervóór en de 7 dagen erna (uit de dagtabel). Verschil in de effect-kolom zetten. Minder dan 7 dagen na de ingreep: "meten t/m <datum>".
Nooit een effect toeschrijven aan een ingreep als er in dezelfde week een tweede ingreep was — dan "vervuild door <ingreep>".

## Stap 3 — Drie bronnen naast elkaar
| Bron | Wat het zegt | Waar het van afwijkt |
|---|---|---|
| Google Ads | kosten, conversies (TrackBee), conv.waarde | conversies lopen 24–48 u achter; waarde incl. VAT |
| P&L-sheet | orders + omzet (Shopify, £, ECB-koers), ad spend (script), COGS | omzet excl. refunds op dagbasis; refunds apart |
| Pythago | omzet/orders/ROAS/MER zoals de app het rekent | eigen valuta- en attributielogica — precies daarom naast de sheet leggen |
Verschil > 5% tussen bronnen op dezelfde week → eerst verklaren (valuta, tijdzone, refunds, attributie) vóór er een conclusie over de strategie wordt getrokken.

## Stap 4 — Regel destilleren
Een ingreep wordt pas een playbook-regel als:
1. RTM hem minstens twee keer heeft gedaan in vergelijkbare omstandigheden, óf één keer met een expliciete uitleg in Slack, én
2. het effect meetbaar is (of RTM zelf zegt waarop ze het beoordelen).
Formaat van een regel: **ALS <signaal in de data> DAN <ingreep> — bewijs: <logboekregels> — status: bevestigd / vermoed / weerlegd.**

## Stap 5 — Wat Claude elke week teruggeeft (in deze volgorde, kort)
1. Nieuwe logboekregels (klaar om in 09 te plakken).
2. Effecten die deze week meetbaar werden.
3. Playbook-wijzigingen (nieuwe regel, status veranderd).
4. Afwijkingen tussen de drie bronnen.
5. Vragen voor Slack (max 3, de belangrijkste eerst).
6. Risico's: budget dat harder loopt dan de omzet, conversies die stilvallen, GMC-afkeuringen, tracking die 0 telt terwijl Shopify orders heeft.

## Wat we specifiek willen leren (de vragen die het playbook moet beantwoorden)
- Startopzet: is de kopieerlijst in 03 §6 compleet, of doen ze bij een volgende klant iets anders?
- Leerfase: hoe lang wachten ze echt, en wat is hun signaal om in te grijpen?
- Budget: stapgrootte, frequentie, op welk signaal (ROAS? conversies/dag? impression share?).
- Bieden: wanneer van Convmax naar tROAS, en welke waarde; wanneer terug.
- Structuur: waarom en wanneer een tweede campagne; splitsen op product/collectie/marge?
- Assets: voegen ze ooit koppen/afbeeldingen toe, en helpt het?
- Uitsluitingen: hoe vaak, welke bron, welke matchtypes.
- Feed/GMC: grijpen ze in op afkeuringen, prijzen, titels?
- Wat doen ze bij een slechte week (ROAS < X)? Pauzeren, budget omlaag, wachten?
- Wat rapporteren ze zelf als succes — welke KPI sturen ze op?
