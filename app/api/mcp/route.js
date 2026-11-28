import { NextResponse } from "next/server";
import { checkMcpKey, getStores, findStore } from "@/lib/claude-link";
import { storeGraphql, getShopInfo } from "@/lib/shopify";
import { agentNext, agentDone, agentDoneMany, agentFail, agentSource } from "@/lib/photo-queue";
import { copyThemeFiles } from "@/lib/theme-copy";
import { keywordsLookup, storeMemoryOverview, putPlan, listPlans, getPlan, deletePlan } from "@/lib/import-plans";

/* CLAUDE-KOPPELING · MCP-server (13-11-2026).
   Eigen connector voor claude.ai (Instellingen → Connectors → Custom connector)
   met de link van de pagina /claude. Eén koppeling, ALLE stores — Claude hoeft
   niet meer per store te herkoppelen. Streamable HTTP, JSON-antwoorden.
   Beveiliging: ?key=… moet gelijk zijn aan de sleutel in Redis. */
export const maxDuration = 300; // photo_queue done: foto uploaden + fitnote + omschrijving per product
export const dynamic = "force-dynamic";

const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "list_stores",
    description: "Lijst van alle Shopify-stores van Justin waar deze koppeling bij kan (naam, domein, valuta). Gebruik de naam, afkorting (SSB, LGB, EMC, SW, CC) of het domein als 'store' in de andere tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "shop_info",
    description: "Basisgegevens van één store (naam, valuta, domein) — handig om te checken of je de goede store hebt.",
    inputSchema: { type: "object", properties: { store: { type: "string", description: "Naam, afkorting of domein van de store" } }, required: ["store"], additionalProperties: false },
  },
  {
    name: "shopify_graphql",
    description: "Voer een Shopify Admin GraphQL-query of -mutation uit op één store. Gebruik variables voor grote invoer. Mutations veranderen de live store: alleen doen als Justin daarom vroeg.",
    inputSchema: {
      type: "object",
      properties: {
        store: { type: "string", description: "Naam, afkorting of domein van de store" },
        query: { type: "string", description: "GraphQL query of mutation" },
        variables: { type: "object", description: "Variabelen voor de query" },
      },
      required: ["store", "query"],
      additionalProperties: false,
    },
  },
  {
    /* 18-11-2026: de AI-foto-wachtrij (importer tab 4 / Pythago, motor "Higgsfield via Claude") via deze koppeling,
       zodat Justin geen aparte wachtrij-sleutel meer hoeft te plakken. Zelfde functies als /api/photo-queue/agent. */
    name: "photo_queue",
    description:
      "AI-modelfoto-wachtrij van Attoh Tools (motor 'Higgsfield via Claude'). action=next: openstaande opdrachten met kant-en-klare prompt, bronfoto-URL, model en de kostenregel (limit 1 tot 12); limit 13 tot 200 geeft een compact overzicht zonder prompts. action=sources: bronfoto's van max 8 opdrachten als plaatjes (ids als 'org:id'). action=done: gemaakte foto's (https-URL) op het product zetten, vooraan in de galerij, als variantfoto van de kleur, met fitnote en foto in de omschrijving; geef één opdracht (org, id, imageUrl) of een lijst items (max 8). action=fail: opdracht afkeuren met reden (begin met 'Overgeslagen' als het geen afkeur is). Kosten: altijd gpt_image_2, 1k, medium, 1:1 = 1 credit per foto; nooit gpt_image_2_6, high of 2k. Opdrachten met kind='infographic' (één beeld per product met tekst erop): zelfde model en kwaliteit maar aspect_ratio 4:5 (staat per opdracht in settings); bronfoto als referentie meegeven; vóór done controleren dat het product klopt en de tekst op het beeld foutloos is. Bij done komt een infographic achter de modelfoto's in de galerij, zonder variantkoppeling of fitnote.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["next", "sources", "done", "fail"] },
        store: { type: "string", description: "next: alleen opdrachten van deze store (naam of domein)" },
        limit: { type: "number", description: "next: aantal opdrachten, 1 tot 12 met prompt (standaard 8); 13 tot 200 = compact overzicht zonder prompts" },
        ids: { type: "array", items: { type: "string" }, description: "sources: max 8 opdrachten als 'org:id'" },
        width: { type: "number", description: "sources: breedte in px, 200 tot 700 (standaard 360)" },
        org: { type: "string", description: "done/fail: org van de opdracht (staat bij next)" },
        id: { type: "string", description: "done/fail: id van de opdracht" },
        imageUrl: { type: "string", description: "done: https-URL van de gemaakte foto" },
        items: {
          type: "array",
          description: "done: meerdere opdrachten tegelijk (max 8); kleuren van hetzelfde product worden na elkaar geplaatst",
          items: { type: "object", properties: { org: { type: "string" }, id: { type: "string" }, imageUrl: { type: "string" } }, required: ["org", "id", "imageUrl"] },
        },
        reason: { type: "string", description: "fail: reden" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    /* 26-11-2026: themabestanden tussen stores kopiëren op de server (bijv. de BFCM-laag van
       Code of Clothes naar Season of Style). De inhoud gaat niet door Claude heen. */
    name: "theme_copy_files",
    description:
      "Kopieer themabestanden van het thema van de ene store naar een (niet-gepubliceerd) thema van een andere of dezelfde store, op de server. files = lijst paden (bijv. 'sections/header.liquid') of objecten {from, to}. replace = optionele lijst {find, replace} die op tekstbestanden wordt toegepast (alle voorkomens, in volgorde). Nooit naar een live (MAIN) thema. Geeft per bestand ok/fout en de nieuwe grootte terug.",
    inputSchema: {
      type: "object",
      properties: {
        from_store: { type: "string", description: "Bron-store (naam, afkorting of domein)" },
        from_theme: { type: "string", description: "Bron-thema-id (getal of gid://shopify/OnlineStoreTheme/…)" },
        to_store: { type: "string", description: "Doel-store (naam, afkorting of domein)" },
        to_theme: { type: "string", description: "Doel-thema-id (niet het live thema)" },
        files: {
          type: "array",
          description: "Paden of {from, to} (max 60)",
          items: { anyOf: [{ type: "string" }, { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from"] }] },
        },
        replace: {
          type: "array",
          description: "Tekstvervangingen op tekstbestanden, in volgorde",
          items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] },
        },
      },
      required: ["from_store", "from_theme", "to_store", "to_theme", "files"],
      additionalProperties: false,
    },
  },
  {
    /* 26-11-2026: één mutation voor élk product dat aan een zoekopdracht voldoet, op de server.
       Scheelt honderden losse aanroepen (bijv. alle producten even aanraken zodat de Google-feed opnieuw synct). */
    name: "products_each",
    description:
      "Voer één GraphQL-mutation uit voor elk product dat aan product_query voldoet (Shopify-zoeksyntax, bijv. 'status:active'). De mutation krijgt per product de variabele $id (ID!) plus de meegegeven variables. dry_run=true telt alleen. Max 2000 producten per aanroep. Verandert de live store: alleen op verzoek van Justin.",
    inputSchema: {
      type: "object",
      properties: {
        store: { type: "string", description: "Naam, afkorting of domein van de store" },
        product_query: { type: "string", description: "Shopify-zoekopdracht voor producten, bijv. 'status:active'" },
        mutation: { type: "string", description: "GraphQL-mutation met variabele $id: ID!" },
        variables: { type: "object", description: "Extra variabelen (voor elk product gelijk)" },
        dry_run: { type: "boolean", description: "Alleen tellen, niets wijzigen" },
      },
      required: ["store", "product_query", "mutation"],
      additionalProperties: false,
    },
  },
  /* IMPORTPLANNEN (28-11-2026) — Claude maakt in de chat het weekplan
     (keywords × aantallen per store), Justin voert het in de tool door
     (pagina Importplannen → TPK-sheets). Logica in lib/import-plans.js. */
  {
    name: "keywords_lookup",
    description:
      "Zoekvolumes uit ALL KEYWORDS (Google Keyword Planner) per markt en geslacht: per keyword de 12 maanden, het venster (komende maanden, vorig jaar), jaargemiddelde en piekmaand. Gebruik terms voor exacte keywords of contains om te zoeken (alle woorden moeten erin zitten, gesorteerd op venstervolume).",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", enum: ["USA", "UK", "AUS", "CAN"] },
        gender: { type: "string", enum: ["V", "M"], description: "V = vrouw, M = man" },
        terms: { type: "array", items: { type: "string" }, description: "Exacte keywords (max 200)" },
        contains: { type: "string", description: "Woorden die in het keyword moeten zitten, bijv. 'puffer jacket'" },
        limit: { type: "number", description: "Max resultaten bij contains (standaard 40, max 200)" },
        ahead: { type: "number", description: "Venster in maanden vanaf nu (standaard 3)" },
      },
      required: ["market", "gender"],
      additionalProperties: false,
    },
  },
  {
    name: "store_memory",
    description: "Alle stores uit Keywords → Geheugen: markt, geslacht (V/M/MV), TPK-sheet, organization-sheet, import-sheet en de laatste snapshot (aantal producten, collecties). Nodig om een importplan per store te maken.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "import_plan",
    description:
      "Importplannen: action=put zet een plan klaar (Justin voert het door op de pagina Importplannen → per store een blad in de TPK-sheet, scraper-formaat). action=list / get / delete. Plan: {id?, name, week:'W49', source, note, stores:[{store, tab:'Plan W49', note, rows:[{keyword, collection, gender:'V'|'M', count, type:'Direct'|'Attribuut'|'Gelegenheid', uitleg, vol, avg, peak}]}]}. Schrijft zelf niets in de sheets.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["put", "list", "get", "delete"] },
        id: { type: "string" },
        plan: { type: "object" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
];

const escRe = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function photoQueueTool(a) {
  const act = String(a.action || "");
  if (act === "next") {
    const want = Number(a.limit) || 8;
    const store = a.store ? escRe(a.store) : "";
    if (want > 12) {
      // overzicht: compacte lijst zonder prompts (prompt = buildPrompt uit lib/photo-brain.js, of haal hem op met limit <= 12)
      const out = await agentNext({ limit: Math.min(200, want), store, cap: 200 });
      const profiles = {};
      const items = out.items.map((it) => {
        const p = it.profile || {};
        if (p.id && !profiles[p.id]) profiles[p.id] = { age: p.age, look: p.look, height: p.height, size: p.size };
        return { org: it.org, id: it.id, store: it.store, title: it.title, type: it.type, color: it.color, gender: it.gender, sourceImage: it.sourceImage, profile: p.id, shot: it.shot, shotType: it.shotType, mode: it.mode, kind: it.kind };
      });
      return text({ pending: out.pending, compact: true, settings: out.brain.settings, costRule: out.brain.costRule, profiles, items });
    }
    const out = await agentNext({ limit: Math.max(1, want), store });
    return text({ pending: out.pending, settings: out.brain.settings, infographicSettings: out.brain.infographicSettings, infographicRule: out.brain.infographicRule, costRule: out.brain.costRule, items: out.items });
  }
  if (act === "sources") {
    const list = (Array.isArray(a.ids) ? a.ids : []).slice(0, 8);
    if (!list.length) return text("Geef ids als 'org:id'", true);
    const width = Math.max(200, Math.min(700, Number(a.width) || 360));
    const content = [];
    for (const raw of list) {
      const [org, id] = String(raw).includes(":") ? String(raw).split(":") : ["attoh", String(raw)];
      try {
        const img = await agentSource({ org, id, width });
        content.push({ type: "text", text: `${org}:${id}` });
        content.push({ type: "image", data: img.buf.toString("base64"), mimeType: String(img.type || "image/jpeg").split(";")[0] });
      } catch (e) {
        content.push({ type: "text", text: `${org}:${id} mislukt: ${String((e && e.message) || e)}` });
      }
    }
    return { content, isError: false };
  }
  if (act === "done") {
    if (Array.isArray(a.items) && a.items.length) return text(await agentDoneMany(a.items.slice(0, 8)));
    return text(await agentDone({ org: a.org, id: a.id, imageUrl: a.imageUrl }));
  }
  if (act === "fail") return text(await agentFail({ org: a.org, id: a.id, reason: a.reason }));
  return text(`Onbekende actie: ${act}`, true);
}

const text = (obj, isError = false) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }], isError });


/* ---------- theme_copy_files (26-11-2026) — logica in lib/theme-copy.js ---------- */
async function themeCopyTool(a, stores) {
  const r = await copyThemeFiles(a, stores);
  return text(r.ok ? r : r.message || r.error || "mislukt", !r.ok);
}

async function productsEachTool(a, store) {
  const pq = String(a.product_query || "").trim();
  const mutation = String(a.mutation || "");
  if (!pq) return text("product_query ontbreekt", true);
  if (!/^\s*mutation\b/.test(mutation) || !mutation.includes("$id")) return text("mutation moet met 'mutation' beginnen en $id gebruiken", true);
  const ids = [];
  let cursor = null;
  for (let page = 0; page < 8; page++) {
    const r = await storeGraphql(store, "query($q:String!,$c:String){ products(first:250, query:$q, after:$c){ nodes{ id } pageInfo{ hasNextPage endCursor } } }", { q: pq, c: cursor });
    if (!r.ok) return text({ error: r.error }, true);
    const p = r.data.products;
    for (const n of p.nodes) ids.push(n.id);
    if (!p.pageInfo.hasNextPage) break;
    cursor = p.pageInfo.endCursor;
  }
  if (a.dry_run) return text({ store: store.name || store.domain, products: ids.length, dry_run: true });
  const started = Date.now();
  let ok = 0;
  const errors = [];
  let i = 0;
  const worker = async () => {
    while (i < ids.length && Date.now() - started < 270000) {
      const id = ids[i++];
      const r = await storeGraphql(store, mutation, { ...(a.variables || {}), id });
      let ue = null;
      if (r.ok) {
        for (const v of Object.values(r.data || {})) if (v && Array.isArray(v.userErrors) && v.userErrors.length) ue = v.userErrors.map((e) => e.message).join("; ");
      }
      if (r.ok && !ue) ok++;
      else if (errors.length < 10) errors.push({ id, error: ue || r.error });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return text({ store: store.name || store.domain, products: ids.length, done: ok, failed: ids.length - ok - Math.max(0, ids.length - i), not_reached: Math.max(0, ids.length - i), errors });
}

async function importPlanTool(name, a) {
  try {
    if (name === "keywords_lookup") return text(await keywordsLookup(a));
    if (name === "store_memory") return text(await storeMemoryOverview());
    const act = String(a.action || "");
    if (act === "put") return text(await putPlan(a.plan));
    if (act === "list") return text(await listPlans());
    if (act === "get") return text(await getPlan(a.id));
    if (act === "delete") return text(await deletePlan(a.id));
    return text(`Onbekende actie: ${act}`, true);
  } catch (e) {
    return text(String((e && e.message) || e), true);
  }
}

async function callTool(name, args) {
  if (name === "photo_queue") return photoQueueTool(args || {});
  if (name === "keywords_lookup" || name === "store_memory" || name === "import_plan") return importPlanTool(name, args || {});
  const stores = await getStores();
  if (name === "theme_copy_files") return themeCopyTool(args || {}, stores);
  if (name === "list_stores") {
    if (!stores.length) return text("Nog geen stores klaargezet. Open Attoh Tools → /claude en klik op 'Stores klaarzetten'.", true);
    return text(stores.map((s) => ({ name: s.name, domain: s.domain, currency: s.currency || "" })));
  }
  const store = findStore(stores, args && args.store);
  if (!store) return text(`Store "${args && args.store}" niet gevonden. Beschikbaar: ${stores.map((s) => s.name || s.domain).join(", ")}`, true);
  if (name === "shop_info") {
    const r = await getShopInfo(store);
    return r.ok ? text(r.shop) : text(r.error || "mislukt", true);
  }
  if (name === "products_each") return productsEachTool(args || {}, store);
  if (name === "shopify_graphql") {
    const q = String((args && args.query) || "");
    if (!q.trim()) return text("Lege query", true);
    const r = await storeGraphql(store, q, (args && args.variables) || {});
    if (!r.ok) return text({ store: store.name || store.domain, error: r.error, errors: r.errors || null }, true);
    const out = JSON.stringify({ store: store.name || store.domain, data: r.data });
    return text(out.length > 90000 ? out.slice(0, 90000) + " …[afgekapt — vraag minder velden of kleinere pagina's]" : out);
  }
  return text(`Onbekende tool: ${name}`, true);
}

function rpc(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcErr(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // notificatie (bijv. notifications/initialized)
  if (method === "initialize") {
    return rpc(id, {
      protocolVersion: (params && params.protocolVersion) || PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "attoh-tools-stores", version: "1.0.0" },
      instructions: "Toegang tot alle Shopify-stores van Justin (Attoh Tools). Begin met list_stores. Gebruik shopify_graphql met store = naam/afkorting/domein. AI-modelfoto's uit de wachtrij van de importer: photo_queue (next, sources, done, fail); maak ze met Higgsfield gpt_image_2, 1k, medium, 1:1 (1 credit per foto); opdrachten met kind=infographic op 4:5. Themabestanden tussen stores kopiëren (server-side, met optionele tekstvervangingen): theme_copy_files.",
    });
  }
  if (method === "ping") return rpc(id, {});
  if (method === "tools/list") return rpc(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      return rpc(id, await callTool(params && params.name, (params && params.arguments) || {}));
    } catch (e) {
      return rpc(id, text(String((e && e.message) || e), true));
    }
  }
  return rpcErr(id, -32601, `Methode niet ondersteund: ${method}`);
}

export async function POST(req) {
  const key = new URL(req.url).searchParams.get("key");
  if (!(await checkMcpKey(key))) return NextResponse.json(rpcErr(null, -32001, "Geen toegang"), { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json(rpcErr(null, -32700, "Ongeldige JSON"), { status: 400 });
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  const out = await handle(body);
  return out ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
}

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 200 });
}
