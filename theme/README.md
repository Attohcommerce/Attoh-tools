# Theme-bestanden (Shopify / Dawn)

## snippets/size-guide.liquid — maattabel op de productpagina

Toont de maattabel uit product-metafield `custom.size_guide` (json), geschreven door de
Size Guide-module in Attoh Tools (`/size-guide`). Zonder metafield rendert de snippet niets.

**Installeren (eenmalig per store):**

1. Shopify admin → Online Store → Themes → … → Edit code → Snippets → *Add a new snippet* → naam `size-guide` → inhoud van `theme/snippets/size-guide.liquid` plakken → Save.
2. Theme editor (Customize) → een productpagina openen → in de "Product information"-sectie een blok **Custom Liquid** toevoegen, direct onder de variantkiezer, met:
   ```liquid
   {% render 'size-guide', product: product %}
   ```
   (Of in `sections/main-product.liquid` na de `variant_picker`-case dezelfde regel plaatsen.)
3. Per store de kleur-tokens bovenaan de `<style>` aanpassen (`--sg-line`, `--sg-accent`, `--sg-muted`) aan het palet van die store — structuur blijft gelijk, alleen tokens en de note/how-to-teksten (via de tool) verschillen per store.

Gedrag: knop "Size guide" (inline SVG, storekleur) → modal met tabel, in/cm-knop (keuze onthouden in
localStorage, default uit `unit_default`: USA/CAN inches, AUS/NZ/UK cm), note en meet-instructies.
Mobiel: links uitgelijnd, tabel horizontaal scrollbaar. `font-family: inherit` overal.

## Env vars voor de module (Vercel)

- `APIFY_TOKEN` — search-by-image op AliExpress (Apify, pay-per-result). Zonder token: alleen
  handmatige routes (AliExpress-URL plakken, screenshot → AI) + standaardtabellen.
- `APIFY_IMAGE_ACTOR` — optioneel, default `freecamp008~aliexpress-search-by-image-actor`.
- `APIFY_PROXY_PASSWORD` — Apify console → Proxy → HTTP settings → Password. AliExpress stuurt Vercel
  (datacenter-IP) naar een login-pagina; met dit wachtwoord gaan geblokkeerde requests via Apify's
  residential proxy (US). Optioneel `APIFY_PROXY_GROUPS` (default RESIDENTIAL) en `APIFY_PROXY_COUNTRY`
  (default US).
- Browser-route (geen extra env nodig, draait op `APIFY_TOKEN`): AliExpress herkent server-side fetches
  óók via de residential proxy (TLS-vingerafdruk) → als laatste poging laadt een echte Chromium in Apify
  (`apify~playwright-scraper`, ±$0,005–0,01 per product) de maattabel-pagina en volgt versleutelde
  affiliate-links tot het product-ID. `APIFY_BROWSER_ACTOR` om een andere actor te kiezen (bv.
  `apify~camoufox-scraper`, stealth), `SIZEGUIDE_BROWSER=off` om de route uit te zetten.
- Bron-store-route (geen env nodig, wel `REDIS_URL`): vóór AliExpress zoekt de module het bronproduct
  bij de concurrent waar het geïmporteerd is (foto-bestandsnamen/SKU's tegen een index van alle
  competitor-stores uit de scraper-lijst, de Geheugen-sheet en het Import-werkboek) en leest daar de
  maattabel: HTML-tabel in de omschrijving, app-block op de productpagina (ESC/Clean Size Charts/Avada
  zetten die server-side in de HTML, cm én inch) of een maattabel-afbeelding (AI leest). Index per
  store 24 u in Redis; "Bouw maattabellen" indexeert automatisch eerst.
- `SCRAPER_PROXY_URL` — alternatief voor bovenstaande: sjabloon met `{url}`,
  bv. `https://api.scraperapi.com?api_key=KEY&url={url}`.
- `REDIS_URL` — bestaat al (To Do-board); wordt gebruikt als match-cache (120 dagen).
