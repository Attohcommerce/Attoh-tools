# Stappenplan — nieuw project "Google Ads Playbook (RTM-methode)"

Doel van het project: de werkwijze van Robtronic Media (RTM, Robin Tesselaar en team) op Soul Society Boutique zo precies vastleggen dat Claude die zelf kan uitvoeren op de zes stores die nog komen — zonder mediabuyer-fee.

De aanpak in één zin: elke ingreep van RTM wordt gelogd als **wat · wanneer · waarom · welk effect**, naast de data (Google Ads, Pythago, P&L-sheets), tot er een set beslisregels overblijft die een nieuw account van nul tot winstgevend brengt.

## Fase 0 — project aanmaken (15 minuten)

1. Maak in Claude een nieuw project: **"Google Ads Playbook — RTM-methode"**.
2. Plak de inhoud van `01-projectinstructies.md` in het veld Projectinstructies.
3. Upload de bestanden 02 t/m 12 als projectkennis (alle .md-bestanden en het .js-script).
4. Koppel de Slack-connector aan het project en geef de naam van het Robtronic-kanaal door in de eerste chat. Dan leest Claude de weekplannen zelf en hoef je niets door te sturen.
5. Koppel Google Drive (voor de P&L-sheets en de organization-sheet) — die connector staat in dit project al aan.
6. Eerste bericht in het nieuwe project: "Lees 02 t/m 05 en bevestig wat je weet over SSB, LGB en EMC." Dan weet je dat de kennis is geland.

## Fase 1 — nulmeting (eerste week)

7. Exporteer in het SSB-account de **Wijzigingsgeschiedenis** (Tools → Wijzigingsgeschiedenis → periode "alle tijd" → downloaden als CSV). Dit is de belangrijkste bron die er is: elke ingreep van RTM met gebruiker, datum en tijd. Upload de CSV in het project.
8. Stuur de eerste volledige scan volgens `08-scan-protocol.md` (accountinstellingen, campagne-instellingen, conversies, uitsluitingslijst, assets). Claude vult daarmee `09-strategie-logboek.md` tot aan vandaag.
9. Geef Claude leestoegang tot Pythago (export of screenshot van het dashboard, zie 08) zodat de data naast het logboek kan.

## Fase 2 — volgen (doorlopend)

10. **Dagelijks (2 minuten):** het dagscan-blok uit 08 — kosten, conversies, conversiewaarde per campagne, plus een blik op de wijzigingsgeschiedenis van gisteren. Screenshot is genoeg.
11. **Wekelijks (10 minuten):** het weekscan-blok uit 08 + het weekplan van RTM uit Slack (leest Claude zelf als de connector staat) + de P&L-week.
12. Claude schrijft elke week de nieuwe regels van het logboek en werkt `11-playbook.md` bij: wat RTM deed, waarom (hun uitleg uit Slack of de afgeleide reden uit de data), en wat het effect was een week later.
13. Elke ingreep die RTM doet en die je niet snapt: vraag het in Slack. Hun antwoord is de "waarom"-kolom van het logboek. Dat is het goedkoopste stuk kennis dat je kunt kopen — je betaalt er al voor.

## Fase 3 — spiegelen op LGB (zodra LGB draait)

14. LGB is de eerste store die volledig volgens de kopieerlijst in 03 is opgezet. Elke beslisregel uit het playbook wordt daar eerst door Claude voorgesteld en door jou uitgevoerd — pas als de regel op LGB hetzelfde effect geeft als bij RTM op SSB, is hij bewezen.
15. Houd de LGB-P&L en de SSB-P&L naast elkaar: zelfde kolommen, zelfde valuta (£), dus direct vergelijkbaar.

## Fase 4 — uitrollen (zes stores)

16. Per nieuwe store: `11-playbook.md` van boven naar beneden afwerken. Onderdelen die al geautomatiseerd zijn (P&L-sheet, ad-spend-script, TrackBee-blauwdruk, Attoh Tools-keten) staan in 05 en 07 met exacte stappen.
17. Pas daarna de RTM-fee (O9 in de P&L-sheet, 10% van ad spend) voor die store op 0 zetten — dat is de besparing die dit project oplevert.

## Wat je NIET moet doen

- Geen instellingen op SSB aanpassen "om te testen" zolang RTM daar actief is: dan weet je niet meer wiens ingreep welk effect had.
- Geen conclusies trekken uit minder dan 7 dagen data. PMax heeft een leerfase; RTM wacht zelf ook 1–2 weken (zie 03 §7).
- Geen instellingen op LGB kopiëren die bij SSB als fout zijn gemarkeerd (03 §5): campagne #2 als identieke kopie, ontbrekende assets, account in verkeerde valuta.
