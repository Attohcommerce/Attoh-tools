import { NextResponse } from "next/server";
import { checkMcpKey, getStores, findStore } from "@/lib/claude-link";
import { storeGraphql, getShopInfo } from "@/lib/shopify";

/* CLAUDE-KOPPELING · MCP-server (13-11-2026).
   Eigen connector voor claude.ai (Instellingen → Connectors → Custom connector)
   met de link van de pagina /claude. Eén koppeling, ALLE stores — Claude hoeft
   niet meer per store te herkoppelen. Streamable HTTP, JSON-antwoorden.
   Beveiliging: ?key=… moet gelijk zijn aan de sleutel in Redis. */
export const maxDuration = 60;
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
];

const text = (obj, isError = false) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }], isError });

async function callTool(name, args) {
  const stores = await getStores();
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
      instructions: "Toegang tot alle Shopify-stores van Justin (Attoh Tools). Begin met list_stores. Gebruik shopify_graphql met store = naam/afkorting/domein.",
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
