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

## Wijzigingsplan in Store Doctor (31-10-2026)

Algemene fixes over een hele store in één keer, net als het prijsplan. Claude loopt de store na (geslacht in titel/tags/type/omschrijving, producten zonder categorie, rommelige optie-namen en -waarden, lege producttypes …), schrijft `public/change-plans/<store>-<datum>.json` en zet hem in `public/change-plans/index.json`.

Doorvoeren: **Store Doctor → store kiezen → Wijzigingsplan toepassen → plan laden → groepen aan/uit → 🔍 Controleer eerst → ⚡ Zet door** (↩ Draai terug kan altijd).

Veiligheid (`lib/change-plan.js`): elk veld heeft een "from" — is een product intussen handmatig veranderd, dan wordt het hele product overgeslagen. Tags: alleen toevoegen/weghalen wat in het plan staat. Optie-wijzigingen die varianten zouden samenvoegen worden geweigerd. Alles gaat eerst naar het backup-tabblad. Nieuwe url alleen mét doorverwijzing (lukt die niet, dan blijft de url staan). Motor: fix `apply-change-plan` in `lib/doctor.js`, route `app/api/doctor-fix`, knoppen in `components/DoctorPanel.js`.

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
