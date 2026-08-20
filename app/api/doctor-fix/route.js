import { NextResponse } from "next/server";
import { listProductsByIds } from "@/lib/shopify";
import { applyDoctorFix, FIX_FIELDS } from "@/lib/doctor";
import { addTab, appendRows } from "@/lib/sheets";

export const maxDuration = 60;

/* STORE DOCTOR — fixes. Client stuurt de volledige id-lijst + cursor en
   herhaalt tot done (zelfde chunk-patroon als de underdog-run: korte
   server-stappen, nooit een 504 op een bulk-run).

   VEILIGHEID: bij cursor 0 wordt (als er een backup-sheet is opgegeven)
   eerst het backup-tabblad aangemaakt. Per chunk wordt een SNAPSHOT van de
   oude waarden weggeschreven VOORDAT er ook maar iets wordt aangepast —
   faalt die write, dan stopt de chunk zonder één wijziging. Zonder
   backup-sheet draait de run alleen met een expliciete skipBackup. */

const CHUNK_FOR = {
  "relink-photos": 8,
  "delete-orphan-variants": 8,
  "delete-flagged-images": 6,
  "delete-no-image-products": 10,
  "translate-options": 12,
  "convert-sizes": 12,
  default: 15,
};

// Wat er per fix in de backup-snapshot gaat — alleen de velden die de fix
// kán raken, zodat de JSON per rij klein en terugleesbaar blijft.
function snapshotFor(fix, p) {
  const vars = (v) => (p.variants || []).map(v);
  switch (fix) {
    case "relink-photos":
      return { variant_images: vars((x) => [x.id, x.image_id || null]) };
    case "delete-orphan-variants":
      return { orphan_variants: (p.variants || []).filter((x) => !x.image_id) };
    case "translate-options":
    case "convert-sizes":
      return {
        options: (p.options || []).map((o) => o.name),
        variants: vars((x) => [x.id, x.option1, x.option2, x.option3]),
      };
    case "clear-barcodes":
      return { barcodes: (p.variants || []).filter((x) => x.barcode).map((x) => [x.id, x.barcode]) };
    case "set-vendor":
      return { vendor: p.vendor || "" };
    case "set-product-type":
      return { product_type: p.product_type || "" };
    case "clean-titles":
      return { title: p.title || "" };
    case "fix-compareat":
    case "remix-compareat":
    case "unify-variant-prices":
      return { prices: vars((x) => [x.id, x.price, x.compare_at_price]) };
    case "fix-size-order":
      return { order: vars((x) => [x.id, x.position, x.title]) };
    case "fill-alt":
      return { alts: (p.images || []).map((im) => [im.id, im.alt || ""]) };
    case "fix-men-template":
    case "fix-women-template":
      return { template_suffix: p.template_suffix || "" };
    case "publish-products":
      return { published_at: p.published_at || null };
    case "delete-no-image-products":
      return { product: { id: p.id, title: p.title, handle: p.handle, status: p.status, tags: p.tags } };
    case "gender-tags":
    case "fix-gender-from-title":
      return { tags: p.tags || "", template_suffix: p.template_suffix || "" };
    case "delete-flagged-images":
      return { images: (p.images || []).map((im) => [im.id, im.src]) };
    default:
      return { title: p.title || "", tags: p.tags || "" };
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { store, fix, ids, options = {}, cursor = 0, backup, skipBackup } = body;
  if (!store || !store.domain) {
    return NextResponse.json({ error: "Geen store opgegeven" }, { status: 400 });
  }
  if (!fix || !Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: "fix/ids ontbreekt" }, { status: 400 });
  }
  const backupOn = !!(backup && backup.sheetId && backup.tab);
  if (!backupOn && !skipBackup) {
    return NextResponse.json(
      { error: "Geen backup-sheet opgegeven — vul er één in of kies expliciet 'zonder backup'." },
      { status: 400 }
    );
  }

  const CHUNK = CHUNK_FOR[fix] || CHUNK_FOR.default;
  const slice = ids.slice(cursor, cursor + CHUNK);

  try {
    // Backup-tabblad klaarzetten bij de eerste chunk
    if (backupOn && cursor === 0) {
      const t = await addTab(backup.sheetId, backup.tab, { rows: ids.length + 10, cols: 5 });
      if (!t.ok) {
        return NextResponse.json({ error: t.error || "backup-tabblad aanmaken mislukt" }, { status: 422 });
      }
      await appendRows(
        backup.sheetId,
        `'${backup.tab}'!A:E`,
        [["Datum", "Product ID", "Titel", "Fix", "Oude waarde (JSON)"]],
        "RAW"
      );
    }

    if (!slice.length) {
      return NextResponse.json({ ok: true, done: true, processed: 0, fixed: 0, skipped: 0, failed: 0, notes: [] });
    }

    // Vers ophalen — nooit fixen op stale scan-data
    const r = await listProductsByIds(store, slice, FIX_FIELDS);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    const products = r.products || [];
    const pending = slice.map((id) => products.find((p) => String(p.id) === String(id))).filter(Boolean);

    // 1. EERST de snapshot van deze chunk wegschrijven — vóór elke wijziging
    if (backupOn && pending.length) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const rows = pending.map((p) => [
        stamp,
        String(p.id),
        String(p.title || "").slice(0, 120),
        fix,
        JSON.stringify(snapshotFor(fix, p)).slice(0, 45000),
      ]);
      try {
        await appendRows(backup.sheetId, `'${backup.tab}'!A:E`, rows, "RAW");
      } catch (e) {
        return NextResponse.json(
          { error: `Backup-write faalde (${String(e.message || e).slice(0, 100)}) — er is NIETS aangepast. Probeer opnieuw of kies een andere sheet.` },
          { status: 422 }
        );
      }
    }

    // 2. Dan pas fixen — per product, netjes na elkaar (rate limits)
    let fixed = 0;
    let skipped = 0;
    let failed = 0;
    const notes = [];
    for (const p of pending) {
      try {
        const res = await applyDoctorFix(store, fix, p, options);
        if (res.changed) fixed++;
        else skipped++;
        if (res.note) notes.push(`${String(p.title || p.id).slice(0, 50)}: ${res.note}`);
      } catch (e) {
        failed++;
        notes.push(`${String(p.title || p.id).slice(0, 50)}: MISLUKT — ${String(e.message || e).slice(0, 140)}`);
      }
    }
    const missing = slice.length - pending.length;
    if (missing > 0) notes.push(`${missing} product(en) niet meer gevonden (al verwijderd?)`);

    const nextCursor = cursor + slice.length;
    return NextResponse.json({
      ok: true,
      done: nextCursor >= ids.length,
      nextCursor,
      processed: slice.length,
      fixed,
      skipped,
      failed,
      notes: notes.slice(0, 30),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
