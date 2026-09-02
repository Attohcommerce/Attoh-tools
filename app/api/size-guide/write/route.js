import { NextResponse } from "next/server";
import { setProductMetafields, ensureProductMetafieldDefinitions } from "@/lib/shopify";
import { addTab, appendRows } from "@/lib/sheets";
import { SG_NS, SG_KEY, SG_STATUS_KEY } from "@/lib/sizeguide";

export const maxDuration = 60;

/* SIZE GUIDE — schrijven. Eerst het logtabblad (herkomst, confidence,
   cijfer, JSON — de AliExpress-ID staat ALLEEN hier, nooit in Shopify),
   dan metafieldsSet (guide-JSON + status). Faalt de sheet-write → niets
   geschreven, zelfde regel als de Store Doctor. */
const CHUNK = 20;
const DEFS = [
  { namespace: SG_NS, key: SG_KEY, name: "Size guide", type: "json", description: "Maattabel (Attoh Tools Size Guide)" },
  { namespace: SG_NS, key: SG_STATUS_KEY, name: "Size guide status", type: "single_line_text_field", description: "aliexpress | standard | manual" },
];

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { store, items, cursor = 0, backup, skipBackup } = body;
  if (!store || !store.domain) return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ error: "items ontbreekt" }, { status: 400 });
  const backupOn = !!(backup && backup.sheetId && backup.tab);
  if (!backupOn && !skipBackup) {
    return NextResponse.json({ error: "Geen log-sheet opgegeven — vul er één in of kies expliciet 'zonder log'." }, { status: 400 });
  }
  try {
    if (cursor === 0) {
      const d = await ensureProductMetafieldDefinitions(store, DEFS);
      if (!d.ok) return NextResponse.json({ error: `Metafield-definities: ${d.errors.join(" · ")}` }, { status: 422 });
      if (backupOn) {
        // Eén tabblad per sessie: bestaat het al (eerdere chunk-reeks of
        // handmatige actie), dan gewoon doorschrijven eronder.
        const t = await addTab(backup.sheetId, backup.tab, { rows: items.length + 10, cols: 9 });
        if (t.ok) {
          await appendRows(backup.sheetId, `'${backup.tab}'!A:I`, [["Datum", "Product ID", "Titel", "Status", "Bron", "AliExpress ID", "Confidence", "Cijfer", "Guide (JSON)"]], "RAW");
        } else if (!/bestaat al/i.test(String(t.error || ""))) {
          return NextResponse.json({ error: t.error || "logtabblad aanmaken mislukt" }, { status: 422 });
        }
      }
    }
    const slice = items.slice(cursor, cursor + CHUNK);
    if (!slice.length) return NextResponse.json({ ok: true, done: true, written: 0, failed: 0, notes: [] });

    if (backupOn) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const rows = slice.map((it) => [
        stamp,
        String(it.id),
        String(it.title || "").slice(0, 120),
        String(it.guide && it.guide.status) || "",
        String(it.source || ""),
        it.match && it.match.pid ? String(it.match.pid) : "",
        it.match && it.match.confidence != null ? String(it.match.confidence) : "",
        it.score != null ? String(it.score) : "",
        JSON.stringify(it.guide || {}).slice(0, 45000),
      ]);
      try {
        await appendRows(backup.sheetId, `'${backup.tab}'!A:I`, rows, "RAW");
      } catch (e) {
        return NextResponse.json({ error: `Log-write faalde (${String(e.message || e).slice(0, 100)}) — er is NIETS geschreven.` }, { status: 422 });
      }
    }

    const entries = [];
    for (const it of slice) {
      if (!it.guide) continue;
      entries.push({ productId: it.id, namespace: SG_NS, key: SG_KEY, type: "json", value: JSON.stringify(it.guide) });
      entries.push({ productId: it.id, namespace: SG_NS, key: SG_STATUS_KEY, type: "single_line_text_field", value: it.guide.status || "standard" });
    }
    const w = await setProductMetafields(store, entries);
    const nextCursor = cursor + slice.length;
    return NextResponse.json({
      ok: true,
      done: nextCursor >= items.length,
      nextCursor,
      written: Math.floor(w.written / 2),
      failed: w.errors.length,
      notes: w.errors.slice(0, 10),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
