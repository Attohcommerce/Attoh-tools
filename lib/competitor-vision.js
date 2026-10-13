// Competitor-sheet als SCREENSHOT → per winkel domein, land, producten,
// maandelijkse bezoekers en opmerking. Kijkwerk → CHEAP_MODEL.
// De getallen ("117.000", "1.7M!", "146K", "8k") worden hier deterministisch
// omgezet, niet door de AI — dan gaat er nooit een nul verloren.
import { getClient, addAiUsage, CHEAP_MODEL, emptyAiUsage } from "./ai.js";
import { cleanStoreDomain } from "./catalog-cache";

const SYSTEM = `You transcribe a spreadsheet screenshot that lists competitor webshops. For EVERY data row return: the store name (first column), the webshop domain or URL exactly as written, the country/market cell, the products cell and the monthly visits cell copied EXACTLY as printed (keep dots, commas, K/M and "!"), and the remarks cell (e.g. WOMAN, GENERAL, "GOOGLE en META"). Skip the header row. Never invent rows or values; leave a field empty if the cell is empty or unreadable.`;

const MARKETS = { USA: "USA", US: "USA", UK: "UK", GB: "UK", AUS: "AUS", AU: "AUS", NZ: "NZ", CANADA: "CANADA", CAN: "CANADA", CA: "CANADA", NL: "NL/BE", BE: "NL/BE", "NL/BE": "NL/BE", FR: "FR", PL: "PL", DE: "DE" };

/** "117.000" → 117000 · "1.7M!" → 1700000 · "146K" → 146000 · "8k" → 8000 · "1,2K" → 1200 */
export function parseVisits(raw) {
  let s = String(raw || "").trim().toLowerCase().replace(/[!\s]/g, "");
  if (!s) return null;
  const m = s.match(/^([\d.,]+)\s*([km])?/);
  if (!m) return null;
  let num = m[1];
  const suf = m[2];
  if (suf) {
    num = num.replace(",", ".");
    const parts = num.split(".");
    if (parts.length > 2) num = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
    const v = parseFloat(num);
    if (!isFinite(v)) return null;
    return Math.round(v * (suf === "m" ? 1e6 : 1e3));
  }
  // zonder K/M: punten en komma's zijn duizendtallen (NL-notatie "117.000")
  const v = parseInt(num.replace(/[.,]/g, ""), 10);
  return isFinite(v) ? v : null;
}

export function parseCount(raw) {
  const v = parseInt(String(raw || "").replace(/[^\d]/g, ""), 10);
  return isFinite(v) && v > 0 ? v : null;
}

export async function readCompetitorScreenshot(dataUrl) {
  const ai = emptyAiUsage();
  const m = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!m) return { ok: false, error: "ongeldige afbeelding (verwacht png/jpeg/webp)" };
  const source = { type: "base64", media_type: m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase(), data: m[2] };
  const res = await getClient().messages.create({
    model: CHEAP_MODEL,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: "save_rows",
        description: "Save all competitor rows from the screenshot.",
        input_schema: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  domain: { type: "string" },
                  country: { type: "string" },
                  products: { type: "string" },
                  visits: { type: "string" },
                  note: { type: "string" },
                },
                required: ["domain"],
              },
            },
          },
          required: ["rows"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_rows" },
    messages: [{ role: "user", content: [{ type: "text", text: "Transcribe every competitor row." }, { type: "image", source }] }],
  });
  addAiUsage(ai, CHEAP_MODEL, res);
  const tu = res.content.find((c) => c.type === "tool_use");
  const raw = (tu && tu.input && tu.input.rows) || [];
  const rows = [];
  for (const r of raw) {
    const domain = cleanStoreDomain(r.domain);
    if (!domain || !domain.includes(".") || /google\.|docs\./.test(domain)) continue;
    rows.push({
      domain,
      name: String(r.name || "").trim(),
      market: MARKETS[String(r.country || "").trim().toUpperCase()] || (String(r.country || "").trim().toUpperCase() || null),
      products: parseCount(r.products),
      visits: parseVisits(r.visits),
      note: String(r.note || "").trim(),
    });
  }
  return { ok: true, rows, ai };
}
