# Attoh Tools — wat de tool doet en welke regels erin zitten (stand 14-9-2026)

Eigen Next.js-app op Vercel (https://attoh-tools.vercel.app), repo github.com/Attohcommerce/Attoh-tools. Werkwijze: Justin vraagt → Claude schrijft direct in de lokale repo-map (device bridge) en levert een commit-summary → Justin commit + push in GitHub Desktop → Vercel deployt. AI-stappen op Justins Anthropic-key (Haiku voor kijk-/aankruiswerk, Sonnet voor schrijfwerk met score-vangnet).

## De keten per store (van keyword tot live product)
1. **Keywords stap 1 — research**: Google Keyword Planner-CSV's (UTF-16, max 10 seeds per batch, alle batches op dezelfde dag) samenvoegen naar een tabblad in de research-sheet. Vereist een account met lopende Search-campagne, anders alleen ranges.
2. **Keywords stap 2 — verdeling** (`lib/verdeling.js`): keywords → collecties → aantal producten per keyword (max 300 per store, cap per keyword ±12, kop-termen 60% daarvan). Filters: junk/merken, buitenlands, novelty, promo, sport, artefact-frasen, geslacht, seizoen, markt-jargon. Schrijft naar de organization-sheet: A Rank · B Keyword · C Collectie · D Groep · E Avg · F Venster-volume · G Piekmaand · H Aantal · I Type, plus collectie-overzicht (K–N) en Diagnose-blok (P–Q, met trechter).
3. **Underdog-run**: niche-keywords met bewezen vraag en lage concurrentie, met scraper-uitleg in kolom J. Zelfde blad, eigen blok.
4. **Product Scraper**: leest het organization-blad (kolom D bepaalt Man/Vrouw), doorzoekt concurrentstores per keyword (titel → omschrijving → foto), schrijft de importlijst (met collectie in kolom I) + geheugen-sheet per markt.
5. **Importer**: per URL AI-titel + omschrijving (met vision), branding-check op foto's (logo's/watermerken/verpakking eruit), validatie tegen de listing-formule, score 1–10, upload naar Shopify met smart collections via tags, verify-pass (elke variant een foto), "AI kiest"-sale 30/40/50%.
6. **Store Doctor** (/qa): gratis checks + 1-klik-fixes met backup-tab, AI-checks (geslacht, kleur↔foto, watermerk, taal). Doelmarkt-keuze bepaalt maatsysteem.
7. **Size Guide-module**: eigen metafield `custom.size_guide` + Dawn-snippet; bron AliExpress-leverancierstabel; Kiwi niet meer.
8. **Bills**: Kungfubuy-PDF's → COGS in de P&L (zie 05).

## Regels die in de engine zitten (belangrijk om te weten bij het lezen van een verdeling)
- **Seizoensmodel v5** (13-9): per collectie een curve 0..1 per seizoen (jassen: winter 1 · herfst 0,90 · lente 0,40 · zomer 0,10), per keyword een specifieker woordenboek (puffer/parka = hard winter; swim/linen/sandals = hard zomer; rain = jaarrond; bomber/blazer = trans-seasonal). Halfrond per markt (AUS/NZ = zuidelijk). Latere maanden in het venster wegen zwaarder. Score < 0,12 = keyword valt af ("buiten seizoen"). Score < 0,60 = plafond op de collectie; score > 0,72 = vloer.
- **Storegeslacht** (13-9): als je alleen Man aanvinkt is élk keyword zonder vrouw-woord heren; "shoes" en "men's shoes" landen in dezelfde collectie (Men's Shoes) en dezelfde dedupe-canon. De kop van kolom D wordt "Groep — alleen heren"; scraper, underdog-route en importer nemen het geslacht daaruit over. Alleen-dames werkt gespiegeld. Unisex = per keyword.
- **STORE_PROFILES**: per domein markt + geslacht + blokkades (evermanclothing.com = AUS, M, footwearCap 0,18; ladyglamboutique.com = AUS, V; sa collective-stores; clarajames.co.uk = UK, MV). Onbekend domein = geen profiel = waarschuwing.
- **Synoniemen/dedupe**: jean=denim, trouser=pant, coat=jacket, tee=shirt, guy/bloke/lad=men, board=swim, trunk=short, slider=slide; algemene woorden (tops, shoes) vervallen naast een specifiek artikel. Merkfragmenten (rl, &denim, ck) en onzin-types (boxer shoes, gymnastic shorts) = junk.
- **Batch-geheugen** per markt (MEM/TOP/ALL-tabs): voorkomt dat volgende research dezelfde keywords opnieuw kiest. Per markt één geheugen-sheet koppelen in Keywords → Geheugen (AUS+NZ: 1QSML8DDEXzrcLUbm-wrLkHBAh6g4GWOXB2v0AggyZXU).
- **Listing-formule**: 1 pipe in de titel, lengte 45–75, 4 bullets, WHY CHOOSE-blok, geen you/your, geen claims; prijsrooster X4,95/X9,95 (USD).
- **Compliance in de tool**: branding-check strict, geen supplier-namen in metafields, geen "true to size"-claims, sale-percentages deterministisch per product (prijsstabiliteit = GMC-eis).

## Beoordelen van een verdeling (methode, gebruikt op 13-9)
Workbook exporteren (xlsx), per collectie keywords/producten/percentage, Type-verdeling (Direct/Attribuut/Underdog), piekmaanden, Diagnose-blok lezen. Cijfer 1–10 op: seizoen klopt (AUS okt–jan: geen jassen boven ±5%, wél shorts/zwem/sandalen), geslacht klopt (heren-store = 100% Men's-collecties), geen synoniemen dubbel, geen merken, geen onzin-types. Laatste runs: EMC 1309 = 7, emc 2.0 = 6 (83% in damescollecties door ontbrekend storegeslacht — gefixt).

## Openstaand in de tool
- EMC-verdeling opnieuw draaien met alleen Man (na deploy van 13-9).
- Markt-lexicon per markt (AU: jumper, boardies, thongs, singlet, Britse spelling) dat junkfilter, scraper-zoekladder en listing-prompt tegelijk voedt. "thongs" = sandalen in AU, ondergoed in de VS — engine kent de markt nog niet in `collectionFor`.
- Meta title + description door de importer laten vullen; alt-teksten uit keyword + kleur; booming keyword in het attribuut-slot van de titel.
- Service-account-key roteren (eerste JSON belandde in chat); Shopify-app-secret van P&L Sync roteren om dezelfde reden.
