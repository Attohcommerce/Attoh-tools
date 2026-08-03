# Attoh Tools

Interne tools voor Sa Collective LLC — product-import, concurrent-scraper en GMC-audit.

## Tools

| Tool | Pad | Wat het doet |
|---|---|---|
| **Importer** | `/` | Scrapet een productpagina, laat AI titel + beschrijving genereren en zet het product live in Shopify |
| **Product Scraper** | `/scraper` | Zoekt op keyword door concurrent-stores en schrijft resultaten naar Google Sheets |
| **GMC Checklist** | `/gmc-checklist` | Crawlt een winkel en controleert Merchant Center-vereisten |

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
