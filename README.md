# Attoh Tools

Interne tools voor Sa Collective LLC — product-import, concurrent-scraper en GMC-audit.

## Tools

| Tool | Pad | Wat het doet |
|---|---|---|
| **Importer** | `/` | Scrapet een productpagina, laat AI titel + beschrijving genereren en zet het product live in Shopify |
| **Product Scraper** | `/scraper` | Zoekt op keyword door concurrent-stores en schrijft resultaten naar Google Sheets |
| **GMC Checklist** | `/gmc-checklist` | Crawlt een winkel en controleert Merchant Center-vereisten |

## Organisaties (20-10-2026)

Eén Attoh Tools, twee werkruimtes — de switch staat links in de topbar en zet de cookie `sa_org`:

| Organisatie | Kleur | Tools | Geheugen |
|---|---|---|---|
| **ATTOH COMMERCE LTD** (standaard) | goud | alles | Redis-keys en localStorage zoals altijd (geen prefix) |
| **Sa Collective** (stores van Chaim) | blauwgroen | Importer · Product Scraper · Keywords (alles) · Store Doctor (alleen "laatste … producten", zonder maattabellen) · Pythago | eigen store-koppelingen (`sc:sa_stores`) en eigen store-geheugen per store (`sc:geh:stores`: organization-/import-/TPK-sheet) |

Gedeeld tussen beide: het markt-geheugen (All keywords per markt + batch-geheugen — dezelfde All batch-sheets, `geh:all:*`, `kwmem:*`), concurrentenlijst + catalogi-cache, To Do-board, size-guide-cache. Bills, Niche kiezen, Size Guide en GMC Checklist bestaan niet in Sa Collective (directe link → homepage). Code: `lib/org.js` (definities), `lib/org-server.js` (`rkey()` voor Redis), `lib/org-client.js` (`orgLS` voor localStorage), `app/components/OrgProvider.js` (context uit de root layout).

## Attoh Reisplanner (27-10-2026)

Aparte app binnen dezelfde deployment: **/reis**. Eigen login (cookie `attoh_reis_session`), eigen gebruikers (Justin + Quinty), eigen look (Justin wit, Quinty roze). Staat volledig los van de store-tools. Zoekt de goedkoopste **losse** vakantie: vluchten van elk vertrekvliegveld × bestemmingen × datums, met bagage en reiskosten naar het vliegveld erbij, daarna hotels voor precies die datums (sterren, review, zwembad, maaltijd) + AI-fotocheck. Boeken gaat via links (Skyscanner, Google Flights, Booking, Expedia, pakketreizen).

Code: `lib/reis/*` (engine, bronnen, bestemmingen-database, opslag), `app/reis/*` (interface), `app/api/reis/*` (API), `vercel.json` (dagelijkse prijsalert-cron).

| Variabele | Verplicht | Waarde |
|---|---|---|
| `REIS_JUSTIN_PASSWORD` | ja | Wachtwoord Justin (e-mail: justinattoh.veerman@gmail.com) |
| `REIS_QUINTY_PASSWORD` | ja | Wachtwoord Quinty (e-mail: quintygbr@gmail.com) |
| `TRAVELPAYOUTS_TOKEN` | nee* | Gratis — travelpayouts.com → Aviasales Data API. Live vluchtprijzen voor honderden routes |
| `LITEAPI_KEY` | nee* | liteapi.travel — live hotelprijzen, faciliteiten en foto's |
| `DUFFEL_TOKEN` | nee | duffel.com — live controle van de top-5 vluchten mét bagage-info |
| `RESEND_API_KEY` | nee | resend.com — mail bij prijsdaling van een bewaarde reis |
| `CRON_SECRET` | nee | Beveiligt `/api/reis/cron` (Vercel stuurt hem automatisch mee) |

\* Zonder deze keys werkt alles, maar met geschatte prijzen (duidelijk gemarkeerd). Redis en `ANTHROPIC_API_KEY` worden gedeeld met de rest van Attoh Tools.

## Attoh Pokémon (07-11-2026)

Eigen tool voor de Pokémon-kaartenstore: **/pokemon** (gewone Attoh Tools-login, alleen in ATTOH COMMERCE LTD). Eigen lichte look (`app/pokemon/pokemon.css`, alles onder `.pk`).

| Tab | Wat het doet |
|---|---|
| **01 Scraper** | Concurrenten toevoegen (platform wordt herkend). Shopify → `/products.json`, WooCommerce → `/wp-json/wc/store/v1/products`, overige winkels → sitemap + JSON-LD in porties. Filtert op Pokémon (laat One Piece, Magic, Yu-Gi-Oh, Lorcana weg) en deelt elk product in: type, set, era, taal. |
| **02 Importer** | Alle concurrenten samen, ontdubbeld (zelfde product bij 3 winkels = 1 kaart met prijsbereik). Filters op type/set/taal. AI schrijft eigen titel + omschrijving + SEO (plagiaatcheck op 5-woord-reeksen, > 15% overlap → herschrijven). Prijs = laagste/middelste/hoogste concurrent × factor, eindes ,95 / ,99 / 4,95-9,95. Producten komen op voorraad 0, voorraad bijhouden aan, doorverkopen uit → **Sold out**. Tags = slimme collecties (type, set, era, taal, Sealed Products). 👁 Voorbeeld = bron naast onze tekst. |
| **03 Store Doctor** | Scan + ⚡ Fix / FIX ALLES: bestelbaar zonder voorraad, concept, geen/1 foto, korte tekst, tekst lijkt op concurrent, noemt concurrent of belooft levering, type/tags/collecties, titelvorm, SEO, alt-teksten, SKU's, prijs 0, dubbele producten. Tab **Voorraad**: aantallen invullen als de levering binnen is. |

Code: `lib/pokemon/*` (catalog = herkennen/indelen/ontdubbelen, scrape, ai, importer, doctor, store = Redis `pk:*`), `app/api/pokemon/*`, `app/pokemon/*`. Shopify-scopes: `write_products`, `write_inventory`, `read_locations`.

## AI-modelfoto's: AI kiest op galerijcijfer (11-11-2026)

Importer → tab 4 en Pythago → AI-foto's. "AI kiest" bepaalt per product of er AI-modelfoto's nodig zijn.

- **Mooie set = overslaan.** Meerdere nette foto's krijgen een 7 of hoger en blijven zoals ze zijn. Dat geldt voor foto's op een model én voor nette productfoto's zonder model (packshots: ghost mannequin of strak neergelegd, witte of rustige achtergrond). Het gaat om hoe mooi de foto's zijn, niet om of er een model op staat.
- **Dunne of zwakke galerij = maken** (6 of lager): maar 1 foto, mockup, leveranciersfoto, amateurfoto zonder model (hanger aan een deur, op bed of vloer), spiegelselfie, product nergens helemaal in beeld.
- **Twee lagen.** De AI kijkt naar de galerij en geeft `worn`, `full`, `look`, `score` en `why` (`GALLERY_RUBRIC` in `lib/photo-brain.js`). Daarna beslissen vaste regels (`galleryVerdict`), zodat de keuze voorspelbaar is. De AI krijgt ook het totaal aantal foto's mee, niet alleen de eerste zes.
- **Zichtbaar in tab 4.** Onder de knop staan twee lijsten met cijfer en reden: "Krijgt AI-foto's" en "Overgeslagen".
- Regels aanpassen: alleen in `lib/photo-brain.js` (rubriek + `galleryVerdict`).
- **Tot 500 producten per klik** (was 150). De wachtrij haalt de producten nu per 50 op in plaats van één voor één en beoordeelt 6 groepjes tegelijk. Raakt de tijd toch op, dan krijgt de rest geen cijfer en geen foto's; nog een keer klikken pakt ze alsnog, zonder dubbele opdrachten.
- **Laad producten uit de store** (tab 4). Knoppen Vandaag · 7 dagen · 30 dagen · Alles halen de producten van de gekozen store op, zodat het overzicht met productsoorten er ook is na verversen of op een andere pc. Een grote selectie gaat in stukken van 250 naar de server en komt als één batch in de wachtrij.

## Collecties, menu en fitnote-maat in Store Doctor (09-11-2026)
- **Wijzigingsplan kan nu ook collecties en het menu aanpassen.** Naast `items` (per product) mag een plan `collections` en `menus` hebben, elk met een groep:
  - collecties: `create` (nieuwe smart collection met regels), `rename` (bv. dubbele collecties markeren als "DUBBEL - … (verwijderen)") en `rules` (regels van een bestaande collectie, met `from` als veiligheid);
  - menu: `menu-add` (item onder een pad van titels, na een bepaald item, met sub-items). Bestaande menu-items houden hun id en blijven precies staan.
  - 🔍 Controleer eerst doet ook de collectie/menu-stappen als droge run. ⚡ Zet door doet eerst de collecties + het menu, daarna de producten. ↩ Draai terug zet namen en regels terug en haalt de menu-items weg; een nieuwe collectie wordt nooit automatisch verwijderd.
  - Code: `lib/plan-store-ops.js`, route `app/api/change-plan-store`, knoppen in `components/DoctorPanel.js`, hulpjes in `lib/change-plan.js`.
  - Voor het menu heeft de app de scopes `read_online_store_navigation` en `write_online_store_navigation` nodig (Dev Dashboard → app → Versions). Zonder die scopes zegt de stap dat en staat in het log wat je met de hand moet zetten. Menu-calls gebruiken API-versie 2025-01 (`storeGraphql(…, { version })`).
- **Nieuwe check "Product in geen enkele categorie-collectie"** (fix `fix-category-collection`, ook in ⚡ FIX ALLES, ná het geslacht). Een product dat alleen in Men/Women/Sale valt, krijgt de tag van de juiste hoofdcollectie. Bestaat die nog niet (bv. Suits & Blazers), dan maakt de fix hem aan. Alleen collecties die op één tag werken tellen. Heeft de store bijna geen tag-collecties, of hangt het product handmatig in een collectie, dan gebeurt er niets. Code: `lib/category-collection.js`, `listSmartCollections` in `lib/shopify.js`.
- **Foto-audit zet geen nutteloze tags meer.** Hij koos de tag uit alle collectienamen, ook sub-collecties die op de titel werken ("Sneakers", "Henleys"). Zo'n tag doet niets, dus het product viel in geen enkele collectie. Nu telt alleen een tag die in een tag-regel van een smart collection staat (`app/api/doctor-ai`).
- **Fitnote: herenmodel één maat groter** (`MEN_STEP` = 2 in `lib/fit-note.js`, man normaal M → XL). Knop **Heren-model +1 maat** bij Fitnotes (actie `resize`): die telt eerst en zet na bevestigen alleen de fitnotes die nog precies op de oude regel staan één maat omhoog. Handmatig aangepaste fitnotes blijven staan.
- **Pakkentabel voor heren-pakken** (`lib/sizeguide.js`). Een pak (producttype of titel vóór de | met "Suit", geen blazer/jas/broek/tracksuit) krijgt als standaardtabel: Size · Suit size · Chest · Trousers · Waist. Suit size = de borst in inches (zoals 38R in AU/NZ en de USA), Trousers = de taille in inches, allebei uitgerekend uit dezelfde Chest/Waist als de gewone herentabel (bv. M = 38–40 / 32–34). Note: "Runs snug — choose one size up for your desired fit. The jacket and trousers come in the same size." (bij 3-piece met waistcoat). Rijen van klein naar groot, ook als de site "… 3XL, 2XS, 3XS" heeft; 3XS staat nu ook in de herenladder. De check "Maattabel past niet bij het product" meldt een pak met een gewone standaardtabel; de fix zet de pakkentabel. Leveranciers- en handmatige tabellen blijven met rust.
- **Importer: pakken, blazers en linnen sets in de juiste collectie** (`lib/verdeling.js` → `collectionFor`). Oorzaak bij EMC: de scraper vult kolom COLLECTIE alleen uit de planning; met handmatig getypte keywords ("mens suit", "mens 3 piece suit") bleef die leeg. Dan kiest de importer de collectie uit het keyword, maar de blauwdruk kende geen pakken, dus kreeg het product alleen de tag Men. Nu: heren-pakken, smokings, blazers en sportcoats → Men's Suits & Blazers; heren linnen sets → Men's Linen Sets (tracksuits, jumpsuits, suit pants en suit shoes niet). En de importer meldt per product "COLLECTIE: geen categorie-collectie voor keyword ..." als er toch niets gevonden wordt (`app/api/import/route.js` → `collectionWarn`, log in `app/importer/page.js`).

## Wijzigingsplan in Store Doctor (31-10-2026)

Algemene fixes over een hele store in één keer, net als het prijsplan. Claude loopt de store na (geslacht in titel/tags/type/omschrijving, producten zonder categorie, rommelige optie-namen en -waarden, lege producttypes …), schrijft `public/change-plans/<store>-<datum>.json` en zet hem in `public/change-plans/index.json`.

Doorvoeren: **Store Doctor → store kiezen → Wijzigingsplan toepassen → plan laden → groepen aan/uit → 🔍 Controleer eerst → ⚡ Zet door** (↩ Draai terug kan altijd).

Veiligheid (`lib/change-plan.js`): elk veld heeft een "from" — is een product intussen handmatig veranderd, dan wordt het hele product overgeslagen. Tags: alleen toevoegen/weghalen wat in het plan staat. Optie-wijzigingen die varianten zouden samenvoegen worden geweigerd. Alles gaat eerst naar het backup-tabblad. Nieuwe url alleen mét doorverwijzing (lukt die niet, dan blijft de url staan). Motor: fix `apply-change-plan` in `lib/doctor.js`, route `app/api/doctor-fix`, knoppen in `components/DoctorPanel.js`.

## Maattabellen en schoenmaten in Store Doctor (31-10-2026)
- **Hele getallen in elke maattabel.** Nieuwe check "Maattabel met kommagetallen of dubbele US-kolom" (fix `tidy-size-guides`). Die rondt de kledingmaten in custom.size_guide af en haalt bij herenkleding de "US"-kolom weg, omdat die alleen de borstmaat herhaalde (S = 35/37). Schoenen: de voetlengte wordt alleen bij het tonen afgerond, niet in de opslag.
- **Thema-snippet.** Nieuwe check "Maattabel toont kommagetallen (thema)" (fix `theme-round-size-guide`). Die zoekt in het live thema de maattabel-snippet die nog met `round: 1` afrondt. De fix zet eerst een backup-kopie (…-backup-datum.liquid) in hetzelfde thema en zet daarna alleen de afronding op hele getallen. Hiervoor zijn de app-scopes `read_themes` en `write_themes` nodig; zonder die scopes komt er een melding en wordt er niets aangepast.
- **Standaardtabel heren** heeft geen US-kolom meer (`standardGuide`). De preview (`formatCell`) toont ook hele getallen.
- **Schoenmaten in het verkeerde systeem**, check "size-system":
  - "UK 5, 5.5, 6 … 11" wordt nu als UK gelezen; alleen de eerste maat had het label (`inferSetSystem` in `lib/sizes.js`). In een US-store wordt dat US 6–12 (heren UK +1, dames UK +2).
  - "AU/NZ 6" wordt als AU gelezen.
  - Slippers, clogs, booties, oxfords, brogues en moccasins tellen nu ook als schoen.
- **Clove & Cloth** heeft een store-profiel (USA, man + vrouw).

## Store Doctor v2: dashboard, alle stores en geen vastlopers meer (31-10-2026)
- **Live dashboard** (`app/components/RunDashboard.js`). Plakt bovenin tijdens elke scan, fix of FIX ALLES en toont:
  - de fases (Scan → Fixes → AI-controles → Eindscan);
  - de huidige stap met voortgangsbalk, looptijd en verwachte resttijd;
  - tellers (aangepast, al goed, mislukt, AI-kosten);
  - een live logboek.
  Er is een pauzeknop die na de lopende stap stopt.
- **Strakker overzicht** in `DoctorPanel.js`. Bovenin staan de store-kaart met markt, valuta, scope en backup, plus 🔍 Scan en ⚡ FIX ALLES. Daaronder volgen:
  - het eindverslag (vóór → na);
  - een score-ring;
  - een filter (Alles / Fouten / Waarschuwingen);
  - compacte bevindingen met een eigen ⚡ Fix-knop.
  De instellingen, het logboek per fix en de plannen staan ingeklapt.
- **Alle stores** (`app/components/AllStoresDoctor.js`, knop "⚡ Scan alle stores" bovenin de Store Doctor):
  - ✓ Controleer laat elke store zien met valuta, markt (aanpasbaar, wordt onthouden), profiel en schrijfrechten. Rood (geen verbinding of geen `write_products`) wordt overgeslagen. Oranje: valuta en markt kloppen niet.
  - 🔍 Scan alle stores scant ze één voor één.
  - ⚡ Fix alle stores doet controleren → scannen → één bevestiging met de echte aantallen per store → FIX ALLES per store, met een eigen backup-tabblad per fix.
  - Een fout in één store stopt de rest niet.
  - API: `app/api/doctor-stores` (shopinfo, profiel, scopes).
- **Motor zonder UI** (`lib/doctor-engine.js`), gedeeld door beide schermen: `postJSON`, `scanStore`, `runFixLoop`, `runAiLoop`, `fixAllStore`.
  - Geen JSON, 502/503/504 of een netwerkfout → opnieuw proberen.
  - Fixes en AI-checks: de stap halveren tot één product. Lukt dat ook niet, dan wordt alleen dat product overgeslagen.
  - Een echte fout stopt alleen die ene fix. FIX ALLES gaat door en zet de fout in het verslag.
- **Scan met tijdsbudget** (`app/api/doctor-scan`, `DOCTOR_SCAN_BUDGET_MS`, standaard 40 s). Bij tijdgebrek worden eerst de fijne categorieën, attributen en de thema-check overgeslagen (`partial` in het antwoord). Bij een time-out volgt nog één "lichte" scan.
- **AI-foutjes opgelost**:
  - "Unable to download the file": een foto die Anthropic niet kan ophalen, wordt zelf opgehaald en als base64 meegestuurd. Lukt dat niet, dan gaat er tekst mee in plaats van de foto (`lib/ai.js`).
  - "Geen bruikbare JSON in AI-antwoord": nog één keer proberen, daarna een kleiner plukje, daarna dat ene product overslaan.
- **Geen verkeerde gender-flips**. FIX ALLES zet gender-tags alleen automatisch als de titel het niet tegenspreekt. Bij "Men's Cargo Pants" waar de AI Women zegt, wordt niets aangepast; zo'n product komt bij "Voor jou om te beslissen".
- **Maten met inch-teken** ("30\"", "32 in") worden als 30/32 gelezen (`normalizeSizeLabel`), zodat herenbroeken weer een standaardtabel krijgen.
- **Backup bij een nieuwe poging**. Loopt de eerste stap in een time-out nadat het backup-tabblad er al stond, dan schrijft de nieuwe poging gewoon verder in hetzelfde tabblad. Hij stopt niet meer met "bestaat al".

## Environment variables

Zet deze in Vercel → Project → Settings → Environment Variables.

| Variabele | Verplicht | Waarde |
|---|---|---|
| `SESSION_SECRET` | ja | Willekeurige string van minimaal 32 tekens |
| `USER1_EMAIL` | ja | E-mailadres gebruiker 1 |
| `USER1_PASSWORD` | ja | Wachtwoord gebruiker 1 |
| `USER2_EMAIL` | nee | E-mailadres gebruiker 2 |
| `USER2_PASSWORD` | nee | Wachtwoord gebruiker 2 |
| `ANTHROPIC_API_KEY` | ja | API-key van console.anthropic.com |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | nee | Volledige service-account JSON (alleen nodig voor Sheets) |

Shopify-tokens worden niet in env-vars gezet — die vul je per store in binnen de app zelf.

## Lokaal draaien

```bash
npm install
npm run dev
```

## Stack

Next.js 14 (App Router) · iron-session · Anthropic SDK · Google Sheets API · Shopify Admin API
