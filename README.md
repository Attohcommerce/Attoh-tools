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
