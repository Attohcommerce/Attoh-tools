// Zoekopdracht als stream (NDJSON): de interface ziet live hoeveel routes en
// combinaties er al vergeleken zijn, en krijgt aan het eind de resultaten.
import { requireReisUser } from "@/lib/reis/session";
import { runSearch } from "@/lib/reis/engine";
import { getPrefs } from "@/lib/reis/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req) {
  const user = await requireReisUser();
  if (!user) return new Response(JSON.stringify({ error: "Niet ingelogd" }), { status: 401 });
  const search = await req.json().catch(() => ({}));
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        const prefs = await getPrefs();
        const out = await runSearch(search, { prefs, onProgress: send });
        send({ type: "done", ...out });
      } catch (e) {
        send({ type: "error", error: e.message || String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
