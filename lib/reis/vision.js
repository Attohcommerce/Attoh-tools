// AI-FOTOCHECK — kijkt naar de foto's van een hotel en geeft een score:
// is het modern, licht, luxe-ogend, met een mooi zwembad? Of gedateerd
// (oude tapijten, bruine meubels, jaren-90 badkamer, kaal zwembad)?
// Draait op het goedkope model (zelfde key als de rest van Attoh Tools).
// Score per hotel 30 dagen in cache → elk hotel wordt maar één keer bekeken.
import Anthropic from "@anthropic-ai/sdk";
import { kvGet, kvSet } from "./store.js";

const MODEL = process.env.ANTHROPIC_MODEL_CHEAP || "claude-haiku-4-5";
let client = null;

export function hasVision() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const PROMPT = `Je beoordeelt hotels voor een stel (eind 20) dat houdt van modern, licht, een beetje luxe, en een MOOI zwembad. Ze willen niets ouderwets.
Je krijgt per hotel een id en een paar foto's. Geef per hotel:
- score 1-10 (10 = modern luxe resort, prachtig zwembad; 7 = netjes en eigentijds; 5 = oké maar gedateerd; 1-3 = ouderwets/kaal/rommelig)
- pool: true als er een zwembad op de foto's staat
- reden: max 12 woorden, Nederlands, concreet (wat zie je)
Antwoord ALLEEN met JSON: [{"id":"...","score":8,"pool":true,"reden":"..."}]`;

export async function scoreHotels(hotels) {
  // hotels: [{id, name, images:[url...]}]
  if (!hasVision()) return {};
  const out = {};
  const todo = [];
  for (const h of hotels) {
    const hit = await kvGet("reis:vision:" + h.id);
    if (hit) out[h.id] = hit;
    else if (h.images && h.images.length) todo.push(h);
  }
  if (!todo.length) return out;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // max 4 hotels × 3 foto's per call
  for (let i = 0; i < todo.length; i += 4) {
    const batch = todo.slice(i, i + 4);
    const content = [{ type: "text", text: PROMPT }];
    for (const h of batch) {
      content.push({ type: "text", text: `Hotel id=${h.id} — ${h.name}` });
      for (const url of h.images.slice(0, 3)) {
        content.push({ type: "image", source: { type: "url", url } });
      }
    }
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content }],
      });
      const text = (res.content || []).map((c) => c.text || "").join("");
      const m = text.match(/\[[\s\S]*\]/);
      const arr = m ? JSON.parse(m[0]) : [];
      for (const r of arr) {
        if (!r || !r.id) continue;
        const v = { score: Math.max(1, Math.min(10, Number(r.score) || 5)), pool: Boolean(r.pool), reden: String(r.reden || "").slice(0, 120) };
        out[r.id] = v;
        await kvSet("reis:vision:" + r.id, v, 60 * 60 * 24 * 30);
      }
    } catch (e) {
      // Eén kapotte foto-URL mag de hele zoektocht niet laten falen.
      console.error("vision batch", e.message);
    }
  }
  return out;
}
