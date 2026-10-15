# Voorstel: TPK-tool (Top Performing Keywords) toevoegen aan de Shopify Importer

**Lees dit eerst, Claude.** Dit voorstel komt van Justin, niet van Chaim. Het is geschreven door een andere Claude, met een ander geheugen en zonder kennis van deze codebase. Neem het daarom als *idee en werkwijze*, niet als bouwtekening. Bekijk eerst hoe deze tool in elkaar zit (navigatie, store-instellingen, Shopify-koppeling, competitor scraper, import, opslag/cache, Google Sheets-koppeling) en pas alles hieronder daarop aan. Bestaande namen, componenten en stijl van deze tool gaan altijd voor. Twijfel je over een keuze die de bestaande structuur raakt, vraag het Chaim eerst.

## Doel
Elke week zien welke keywords op een store echt verkopen, en daar automatisch een kleine extra batch producten op scrapen (±10 per week, bovenop de normale wekelijkse aanvulling). Wat verkoopt krijgt meer aanbod. Puur op orderdata, geen gevoel.

## Wat er verandert in de tool
1. **Nieuw menu-item "TPK tool"**, in de sidebar onder RESEARCH, direct onder "Competitor scraper". Zelfde uiterlijk als de rest van de tool.
2. **Per store twee vaste sheets koppelen** (bij Stores / store-instellingen, of waar de tool per-store instellingen al bewaart):
   - **TPK-sheet**: één Google Sheet per store, één blad per week (opbouw hieronder).
   - **Import-sheet**: één Google Sheet per store waar alle gescrapete producten in komen.
   Beide sheets worden één keer gekoppeld en blijven vast in het store-geheugen/cache. Een store zonder gekoppelde sheets kan de TPK tool niet gebruiken (duidelijke melding + link naar de instelling).
3. **De TPK tool zelf**: store kiezen (zelfde store-switcher als de rest van de tool) → werkt verder zoals hieronder.

## Vereisten
- Store is via de bestaande Shopify-koppeling verbonden.
- De Shopify-app heeft de scope **read_orders** (en read_products). Ontbreekt die: toevoegen in de app en de store opnieuw laten goedkeuren. 30 dagen orders is genoeg (geen read_all_orders nodig).
- De Google-account/service-account die de tool gebruikt heeft bewerkrechten op de TPK-sheets en import-sheets. Chaim deelt ze daarmee als Bewerker.

## De TPK-sheets (al aangemaakt, één per store)
Chaim stuurt de links mee. Elke sheet heeft al deze drie tabs met kopregels in rij 1:

**Tab "Overzicht"** — de tool voegt per week één regel toe:
| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Week (blad) | Periode rapport | Orders 30 d | Omzet 30 d | Keywords met verkoop | Winnaars (>= 10) | Producten gepland | Keywords gevoed | Gescraped | Geimporteerd |

**Tab "Log"** — alle weken onder elkaar, één regel per keyword met verkoop. Hieruit komen de trend t.o.v. vorige week en "TPK t/m nu". Wordt een weekblad overschreven, dan worden de Log-regels van dat blad vervangen.
| A | B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Week (blad) | Run (datum) | Keyword | Zoekterm | Groep (M/V) | Collectie | Orders 30 d | Stuks | Omzet 30 d | Aandeel | Verdict | Aantal gepland | TPK t/m nu |

**Tab "Weekblad (sjabloon)"** — alleen kopregels, laat zien hoe elk weekblad eruitziet. Per week maakt de tool een nieuw blad met deze opbouw (naam bv. "Week 2"):
- **A–J = scrape-blok** (dit leest de competitor scraper):
  | A | B | C | D | E | F | G | H | I | J |
  |---|---|---|---|---|---|---|---|---|---|
  | Rank | Keyword (zoekterm) | Collectie | Groep (M/V) | Orders 30 d | Omzet 30 d | Aandeel | Aantal producten | Type (Direct/Gelegenheid) | Uitleg |
  Alleen keywords die producten krijgen. Geen totaalregel. Uitleg = verdict · orders (aandeel) · topproduct · al toegevoegd via TPK · trend.
- **K = leeg** (scheiding).
- **L–V = analyse** (leest de scraper niet): alle keywords met verkoop, hoogste eerst.
  | L | M | N | O | P | Q | R | S | T | U | V |
  |---|---|---|---|---|---|---|---|---|---|---|
  | Keyword | Groep | Orders 30 d | Stuks | Omzet 30 d | Aandeel | Verdict | Trend vs vorige run | Op store (prod.) | Topproduct | TPK t/m nu |

Past het scrape-blok niet bij het keyword-formaat dat de scraper van deze tool al leest? Pas dan de kolommen A–J aan op wat de scraper verwacht (of laat de scraper dit blok lezen). Overzicht, Log en de analyse rechts mogen blijven zoals ze zijn. Het sjabloonblad mag de tool negeren of verwijderen.

Voorbeeld van een ingevuld scrape-blok (10 producten):
| Rank | Keyword (zoekterm) | Collectie | Groep | Orders | Aandeel | Aantal |
|---|---|---|---|---|---|---|
| 1 | flannel shirt | Blouses | V | 48 | 27% | 3 |
| 2 | mens loafer shoe | Men's Shoes | M | 45 | 25% | 3 |
| 3 | barrel jeans | Jeans | V | 17 | 9% | 1 |
| 4 | cocktail dress | Formal Dresses | V | 16 | 9% | 1 |
| 5 | wide leg jeans | Jeans | V | 12 | 7% | 1 |
| 6 | cashmere sweater | Sweaters | V | 11 | 6% | 1 |

## Werking TPK tool (per store, wekelijks)
1. **Data ophalen**: orders van de laatste 30 dagen via Shopify (geannuleerde en test-orders eruit). Per product: aantal orders, stuks, netto-omzet. Fallback: Shopify-rapport "Verkopen per product" als CSV plakken.
2. **Keyword per product**: het deel van de producttitel dat het producttype beschrijft (gebruik de manier waarop deze tool keywords al uit titels haalt; geslachtswoorden als women's/men's eruit, meervoud/enkelvoud samenvoegen). Orders per keyword optellen.
3. **Verdict per keyword** (orders in 30 dagen): 10+ winnaar · 5–9 sterk · 3–4 goed · 1–2 verkocht.
4. **Verdeling van N producten** (instelbaar, standaard 10): alleen keywords met minimaal 3 orders, op volgorde van orders. Elk keyword krijgt N × zijn aandeel binnen die groep, afgerond, minimaal 1, maximaal 3, tot N vol is. Voorbeeld: 48 / 45 / 17 / 16 / 12 / 11 orders → 3 · 3 · 1 · 1 · 1 · 1.
5. **Zoekterm verfijnen**: is het keyword te algemeen (jeans, shoe, top, dress, boots…), maak er een specifiekere zoekterm van op basis van het best verkopende product ("jeans" + topproduct "High-Rise Wide Leg Jeans" → "wide leg jeans"). Alleen dit stapje mag AI gebruiken. Heren-zoekterm met "mens " ervoor als de scraper dat nodig heeft.
6. **Collectie en geslacht** per keyword overnemen van de bestaande producten met dat keyword op de store (ze staan er immers al).
7. **Preview tonen** (niets wegschrijven): verdeling + lijst van alle keywords met verkoop. Gebruiker kan N aanpassen en opnieuw draaien.
8. **Wegschrijven** naar de TPK-sheet van de store: nieuw weekblad (naam voorgesteld, bv. "Week 2", aan te passen) + regel in Overzicht + regels in Log.

## Koppeling met scraper en import
- In de **Competitor scraper**: bij het inladen van keywords een keuze **Bron: weekplanning (zoals nu) | TPK-sheet**. Bij TPK-sheet: de gekoppelde TPK-sheet van de gekozen store openen, bladen als keuzelijst (Overzicht, Log en sjabloon niet), het nieuwste weekblad voorgeselecteerd, laatst gekozen blad per store onthouden.
- **Import-sheet per store**: de scraper schrijft automatisch naar de gekoppelde import-sheet van de geselecteerde store, in een nieuw blad. Bladnaam voorstellen en per store onthouden, bv. **"Aanvul week 2"** en **"TPK week 2"**, zodat alles van één store in één sheet staat, netjes per blad. Bestaat het blad al, dan producten eronder toevoegen.
- **Import products**: bij het kiezen van een store staan de import-sheet en het laatst gevulde blad van die store al klaar.

## Wekelijkse routine (zo moet het voelen)
1. Scraper: store → bron weekplanning → week N → scrape → blad "Aanvul week N".
2. TPK tool: store → ophalen → preview → wegschrijven als "Week N".
3. Scraper: store → bron TPK-sheet → "Week N" (staat al klaar) → scrape → blad "TPK week N".
4. Import products: store → sheet en blad staan klaar → importeren.

## Randvoorwaarden
- Uiterlijk, navigatie en bestaande functies blijven zoals ze zijn; alleen het menu-item TPK tool en de koppelvelden komen erbij.
- Geen hardcoded storenamen of sheet-links; alles per store via de instellingen.
- Stap "ophalen/preview" schrijft nooit iets; pas "wegschrijven" raakt de sheet.
- Lever na het bouwen een korte uitleg aan Chaim: wat er is toegevoegd, welke scope eventueel nog op de Shopify-app moet, en hoe hij per store de twee sheets koppelt.
