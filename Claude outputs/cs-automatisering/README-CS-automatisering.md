# CS-automatisering — Fase 1 (concepten in Gmail)

Wat het doet: elke 5 min checkt n8n per store de Gmail-inbox. Per klantmail:
Shopify-orders van die klant ophalen → Claude schrijft antwoord volgens POLICY → concept in dezelfde Gmail-thread → Slack-melding als er een actie nodig is (refund, maatruil, cancel, boze klant, onzeker).
Jij opent Gmail, checkt het concept, klikt Verzenden. Er wordt nog niks automatisch verstuurd of in Shopify aangepast.

## Bestanden
- n8n/CS-Brain.json — het brein (één keer, voor alle stores). Hier staat de POLICY = jullie CS-regels.
- n8n/CS-Store-TEMPLATE.json — per store één kopie.

## Eenmalig (± 30 min)
1. n8n Cloud account (n8n.io, Starter-plan) — of self-host later.
2. Anthropic API key: console.anthropic.com → API keys. In n8n: Credentials → New → "Header Auth", naam "Anthropic API (x-api-key)", Name = x-api-key, Value = je key.
3. Slack: workspace + kanaal #cs-alerts. In n8n: Credentials → Slack OAuth2.
4. Import CS-Brain.json (Workflows → Import from file). Open node "Claude" → kies de Anthropic-credential. Opslaan. (Niet activeren nodig, wordt aangeroepen.)

## Per store (± 15 min, ook bij elke nieuwe store)
1. Shopify Dev Dashboard (dev.shopify.com) → Create app → scopes: read_orders, read_customers (fase 3 erbij: write_orders, write_draft_orders) → release → installeer op de store. Kopieer Client ID + Client Secret.
   (Sinds 1-1-2026 geen legacy custom apps meer; token komt via client credentials en verloopt na 24u — de flow haalt elke run een vers token.)
2. Import CS-Store-TEMPLATE.json, hernoem naar "CS - [Store]".
3. Node "Gmail: nieuwe mail" → New credential → Gmail OAuth2 → inloggen met de Workspace-mail van die store. Zelfde credential kiezen in "Gmail: concept in thread".
   Als Google blokkeert: Workspace Admin → Security → API controls → n8n als trusted app toestaan.
4. Node "Store Config + filter" → STORE-blok invullen (naam, domein, myshopify, client id/secret, markt, valuta, signoff).
5. Node "CS Brain" → kies workflow "CS Brain".
6. Node "Slack: melding" → Slack-credential.
7. Testen: stuur vanaf een privé-mail een testvraag met een bestaand ordernummer → "Execute workflow" → check concept in Gmail.
8. Activeren (toggle rechtsboven).

## Policy aanpassen
Alles in node "Build Prompt (POLICY)" in CS Brain. Eén wijziging = geldt voor alle stores.
Harde regel staat erin: AI verzint nooit tracking, datums of "we hebben de vervoerder gebeld" (chargeback/GMC-risico).

## Volgende fases
- Fase 2: categorieën met hoge zekerheid (wismo, product_question) direct versturen i.p.v. concept.
- Fase 3: Slack-knoppen "Goedkeuren" → partial refund (refundCreate) en maatruil (draft order: juiste variant 100% korting + $10 verzending → factuur naar klant → betaald = order bij supplier). Ticketstatus per klant in n8n Data Table.
- Fase 4: supplier-terugkoppeling (afhankelijk van kanaal: mail/WhatsApp/portal).
