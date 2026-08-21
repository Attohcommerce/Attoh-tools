import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  readRange,
  getTabIdByTitle,
  deleteRows,
  renameTab,
  sortTabByColumn,
  a1Tab,
} from "@/lib/sheets";
import { cleanTopRows } from "@/lib/keyword-clean";

export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const TOOLS = [
  {
    name: "get_top_keywords",
    description: "Lees de bovenste N keywords met hun gemiddelde maandvolume uit het tabblad. Gebruik dit om vragen te beantwoorden of om te zien wat er staat voordat je iets verwijdert.",
    input_schema: {
      type: "object",
      properties: { n: { type: "number", description: "Aantal rijen, max 300" } },
      required: ["n"],
    },
  },
  {
    name: "remove_keywords",
    description: "Verwijder specifieke keyword-rijen uit het tabblad (exacte keyword-tekst, hoofdletterongevoelig). Gebruik dit als de gebruiker specifieke keywords weg wil.",
    input_schema: {
      type: "object",
      properties: { keywords: { type: "array", items: { type: "string" } } },
      required: ["keywords"],
    },
  },
  {
    name: "clean_top",
    description: "Draai de automatische merken/platforms/rommel-opschoning over de bovenste N rijen (merkenlijst + AI).",
    input_schema: {
      type: "object",
      properties: { topN: { type: "number", description: "10-800" } },
      required: ["topN"],
    },
  },
  {
    name: "rename_tab",
    description: "Hernoem het tabblad.",
    input_schema: {
      type: "object",
      properties: { newName: { type: "string" } },
      required: ["newName"],
    },
  },
  {
    name: "sort_by_column",
    description: "Sorteer alle datarijen op één kolom. column kan zijn: 'avg' of een maandkop zoals 'Aug 2025', 'Nov 2025'.",
    input_schema: {
      type: "object",
      properties: {
        column: { type: "string" },
        descending: { type: "boolean" },
      },
      required: ["column"],
    },
  },
];

async function execTool(name, input, ctx) {
  const { sheetId, tabName } = ctx;

  if (name === "get_top_keywords") {
    const n = Math.min(Math.max(Number(input.n) || 50, 1), 300);
    const values = await readRange(sheetId, `${a1Tab(ctx.tabName)}!A2:B${n + 1}`);
    return {
      summary: `Top ${values.length} gelezen`,
      data: values.map((r) => ({ kw: r[0], avg: r[1] })),
    };
  }

  if (name === "remove_keywords") {
    const wanted = new Set(
      (input.keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean)
    );
    if (!wanted.size) return { summary: "Geen keywords opgegeven", data: { removed: 0 } };
    const tabId = await getTabIdByTitle(sheetId, tabName);
    if (tabId === null) throw new Error(`Tabblad "${tabName}" niet gevonden`);
    const col = await readRange(sheetId, `${a1Tab(tabName)}!A2:A`);
    const rows = [];
    const found = [];
    col.forEach((r, i) => {
      const kw = String(r[0] || "").trim();
      if (kw && wanted.has(kw.toLowerCase())) {
        rows.push(i + 1); // 0-based sheetrij (header = 0)
        found.push(kw);
      }
    });
    const notFound = [...wanted].filter(
      (w) => !found.some((f) => f.toLowerCase() === w)
    );
    await deleteRows(sheetId, tabId, rows);
    return {
      summary: `${rows.length} rijen verwijderd${notFound.length ? `; niet gevonden: ${notFound.join(", ")}` : ""}`,
      data: { removed: rows.length, notFound },
    };
  }

  if (name === "clean_top") {
    const r = await cleanTopRows(sheetId, tabName, input.topN);
    return {
      summary: `Opschoning: ${r.removedCount} van ${r.checked} rijen verwijderd`,
      data: r,
    };
  }

  if (name === "rename_tab") {
    const newName = String(input.newName || "").trim();
    if (!newName) throw new Error("Nieuwe naam ontbreekt");
    const tabId = await getTabIdByTitle(sheetId, tabName);
    if (tabId === null) throw new Error(`Tabblad "${tabName}" niet gevonden`);
    await renameTab(sheetId, tabId, newName);
    ctx.tabName = newName; // vervolgtools in dezelfde beurt gebruiken de nieuwe naam
    return { summary: `Tabblad hernoemd naar "${newName}"`, data: { newName } };
  }

  if (name === "sort_by_column") {
    const tabId = await getTabIdByTitle(sheetId, tabName);
    if (tabId === null) throw new Error(`Tabblad "${tabName}" niet gevonden`);
    const header = (await readRange(sheetId, `${a1Tab(tabName)}!A1:Z1`))[0] || [];
    const want = String(input.column || "").trim().toLowerCase();
    let colIndex = -1;
    if (want === "avg" || want.includes("avg") || want.includes("monthly")) {
      colIndex = 1;
    } else {
      colIndex = header.findIndex((h) => String(h).trim().toLowerCase() === want);
      if (colIndex === -1) {
        colIndex = header.findIndex((h) =>
          String(h).trim().toLowerCase().startsWith(want.slice(0, 3))
        );
      }
    }
    if (colIndex < 1) throw new Error(`Kolom "${input.column}" niet gevonden`);
    const colA = await readRange(sheetId, `${a1Tab(tabName)}!A2:A`);
    await sortTabByColumn(
      sheetId,
      tabId,
      colIndex,
      colA.length + 1,
      header.length,
      input.descending !== false
    );
    return {
      summary: `Gesorteerd op "${header[colIndex]}" (${input.descending !== false ? "hoog→laag" : "laag→hoog"})`,
      data: { column: header[colIndex] },
    };
  }

  throw new Error(`Onbekende tool: ${name}`);
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { sheetId, tabName, history, message } = body;
  if (!sheetId || !tabName) {
    return NextResponse.json({ error: "Sessie-context ontbreekt" }, { status: 400 });
  }
  if (!message || !String(message).trim()) {
    return NextResponse.json({ error: "Leeg bericht" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY ontbreekt" }, { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ctx = { sheetId, tabName: String(tabName) };

  const system = `Je bent de sessie-assistent van de Keywords-module in Attoh Tools (fashion dropshipping). Je werkt op ÉÉN Google Sheet-tabblad met keyword-onderzoek: kolom A = keyword, kolom B = gemiddeld maandvolume, daarna maandkolommen.

Huidige sessie: tabblad "${ctx.tabName}".

Regels:
- Voer verzoeken uit met je tools. Combineer tools als dat nodig is (eerst kijken met get_top_keywords, dan verwijderen).
- Verwijder NOOIT generieke product-zoektermen tenzij de gebruiker er expliciet om vraagt.
- Kun je iets niet met je tools (bijv. rijen toevoegen, kolommen wijzigen, andere sheets), zeg dat dan eerlijk en kort — verzin geen alternatief gedrag.
- Antwoord in het Nederlands, kort en concreet. Benoem wat je gedaan hebt met aantallen.`;

  const msgs = [];
  for (const m of Array.isArray(history) ? history.slice(-10) : []) {
    if (m && (m.role === "user" || m.role === "assistant") && m.content) {
      msgs.push({ role: m.role, content: String(m.content).slice(0, 2000) });
    }
  }
  msgs.push({ role: "user", content: String(message).slice(0, 2000) });

  const actions = [];
  try {
    for (let turn = 0; turn < 6; turn++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system,
        tools: TOOLS,
        messages: msgs,
      });

      if (res.stop_reason === "tool_use") {
        msgs.push({ role: "assistant", content: res.content });
        const results = [];
        for (const block of res.content) {
          if (block.type !== "tool_use") continue;
          let out;
          try {
            out = await execTool(block.name, block.input || {}, ctx);
            actions.push({ name: block.name, summary: out.summary, data: out.data });
          } catch (e) {
            out = { summary: `Fout: ${e.message}` };
            actions.push({ name: block.name, summary: out.summary });
          }
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(out.data !== undefined ? out.data : out.summary).slice(0, 12000),
          });
        }
        msgs.push({ role: "user", content: results });
        continue;
      }

      const text = res.content.map((c) => c.text || "").join("").trim();
      return NextResponse.json({ ok: true, reply: text, actions, tabName: ctx.tabName });
    }
    return NextResponse.json({
      ok: true,
      reply: "Ik ben gestopt na het maximum aantal stappen — de uitgevoerde acties staan hieronder.",
      actions,
      tabName: ctx.tabName,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e), actions }, { status: 500 });
  }
}
