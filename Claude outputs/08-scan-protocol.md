# Scan-protocol — wat Justin stuurt, wanneer, in welk formaat

Principe: Claude kan alleen leren van wat verandert. Daarom is elke scan een foto van dezelfde schermen, in dezelfde volgorde, zodat het verschil met de vorige scan meteen zichtbaar is. Eén bericht per scan, met bovenaan de datum en het account.

## A. Dagscan (SSB, elke ochtend, 2 minuten)
Stuur als screenshot, periode "Gisteren":
1. **Campagnes-overzicht** — kolommen: Campagne, Status, Budget, Kosten, Conversies, Conversiewaarde, Conv.waarde/kosten (ROAS), Klikken, Vertoningen. (Kolommen één keer instellen en opslaan als kolomset "RTM-scan".)
2. **Wijzigingsgeschiedenis** (Tools → Wijzigingsgeschiedenis), periode "Gisteren", alle gebruikers. Leeg = ook waardevol: dan deden ze niets.
Optioneel als er iets opvalt: Merchant Center → Producten → Diagnostiek (afkeuringen).

Claude doet hiermee: kosten/conversies in de dagtabel van het logboek, elke wijziging als regel met tijd en gebruiker, afwijking tegen de P&L-sheet (U en S van diezelfde dag) melden.

## B. Weekscan (SSB, elke maandag, 10 minuten)
Periode "Vorige week" (ma–zo):
1. Campagnes-overzicht (zelfde kolomset) + segment "Dag" als export (Downloaden → CSV) — dan hoeft Claude niet te turen op een screenshot.
2. **Wijzigingsgeschiedenis** vorige week → Downloaden CSV. Dit is de belangrijkste export van de week.
3. Per campagne: **Instellingen** (bieden, budget, locatie, doelen, klantacquisitie, asset-optimalisatie, uitsluitingslijst) — screenshot van de instellingenpagina.
4. Per campagne: **Itemgroepen** (asset groups) → advertentiekwaliteit + aantal assets per type; **Listing-groepen** (welke producten wel/niet).
5. **Inzichten → Zoektermen** (of Inzichten-rapport) — top 20 zoektermen op kosten, en of er nieuwe uitsluitingen zijn bijgekomen in de lijst "RTM | General Negative Keywords (ENG)" (Tools → Gedeelde bibliotheek → aantal items).
6. **Doelen → Conversies** — status per actie, aantal conversies afgelopen 7 dagen, "Vereist aandacht"-meldingen.
7. **Beheer → Accountinstellingen** — alleen als de wijzigingsgeschiedenis daar iets meldt.
8. **Merchant Center** → Overzicht + Diagnostiek: goedgekeurd/afgekeurd, nieuwe waarschuwingen.
9. **Aanbevelingen-pagina**: optimalisatiescore + welke aanbevelingen RTM heeft toegepast of afgewezen (staat in de wijzigingsgeschiedenis als "Aanbeveling toegepast").

## C. Weekplan RTM (Slack)
Als de Slack-connector aan het project hangt leest Claude het kanaal zelf; anders het plan kopiëren of screenshotten. Wat Claude eruit haalt: elke concrete voorgenomen actie (met datum), elke reden die ze noemen, elke KPI die ze noemen. Daarna: bij de eerstvolgende weekscan controleren of het ook ís gebeurd (wijzigingsgeschiedenis) — dat verschil gaat in het logboek.

Vragen die Justin in Slack stelt als RTM iets doet zonder uitleg — precies zo formuleren, ze kosten niets:
- "Waarom campagne #2 als kopie — wat testen jullie ermee en wanneer beslissen jullie?"
- "Op welk signaal verhogen jullie budget, en met hoeveel procent per keer?"
- "Wanneer gaan jullie over op doel-ROAS, en op welke waarde?"
- "Welke zoektermen zetten jullie op de uitsluitingslijst en waarom die?"
- "Wanneer zouden jullie assets (koppen/afbeeldingen) toevoegen aan de itemgroep?"

## D. Data naast het account
- **P&L-sheet** SSB: staat al automatisch gevuld (omzet, ad spend, COGS). Claude leest hem via Drive; niets sturen tenzij er iets niet klopt.
- **Pythago**: één keer per week een export of screenshot van het dashboard met dezelfde periode als de weekscan (omzet, orders, ROAS/MER, COGS-marge zoals Pythago het rekent). Claude legt de Pythago-cijfers naast de P&L-sheet: verschil > 5% = onderzoeken (valuta, tijdzone, refunds).
- **Shopify Analytics** alleen bij twijfel over omzet/orders van een dag.

## E. Formaat van het bericht
```
SCAN <dag|week> · SSB · <datum of periode>
[screenshots / CSV's in de bovenstaande volgorde]
Opmerkingen: <alles wat je zelf al opviel, of "geen">
```
Meer hoeft niet. Claude antwoordt met: verschillen t.o.v. vorige scan · nieuwe logboekregels · eventuele risico's · vragen voor Slack.

## F. Wat NIET nodig is
- Geen schermen van de LGB- of EMC-accounts in de RTM-scan (die volgen hun eigen ritme in Fase 3).
- Geen dagelijkse instellingen-screenshots: instellingen veranderen alleen via de wijzigingsgeschiedenis, en die wordt gescand.
- Geen Google Ads-rapportage uit Two Minute Reports; het ad-spend-script is de bron.
