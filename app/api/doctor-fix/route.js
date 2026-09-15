import { NextResponse } from "next/server";
import { listProductsByIds, getProductMetafieldValues } from "@/lib/shopify";
import { applyDoctorFix, FIX_FIELDS } from "@/lib/doctor";
import { SG_NS, SG_KEY } from "@/lib/sizeguide";
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

/* TIJDBUDGET (fix van "Unexpected token 'A', "An error o…" is not valid JSON"):
   die tekst is Vercel's HTML-foutpagina "An error occurred with your deployment"
   (FUNCTION_INVOCATION_TIMEOUT) in plaats van onze JSON. Een chunk van 8
   producten met elk meerdere Shopify-PUT's + rate-limit-wachttijden + de
   backup-write haalde de 60 s niet. Daarom: (1) de server stopt zelf na
   BUDGET_MS en geeft een nextCursor halverwege de chunk terug, (2) de client
   mag een kleinere chunk meesturen (body.chunk) en doet dat automatisch na
   een niet-JSON-antwoord. Gevolg: nooit meer een dode run, alleen een
   kortere stap. */
const BUDGET_MS = 38000;

const CHUNK_FOR = {
  "relink-photos": 6,
  "delete-orphan-variants": 6,
  "delete-flagged-images": 5,
  "delete-no-image-products": 10,
  "translate-options": 12,
  "convert-sizes": 12,
  "fix-size-guides": 10,
  "delete-small-men-shoe-sizes": 8,
  "clean-size-labels": 12,
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
    case "fix-size-guides":
      return { size_guide: p.__sizeGuide || null };
    case "delete-small-men-shoe-sizes":
      return { variants: vars((x) => [x.id, x.option1, x.option2, x.option3, x.price, x.sku]) };
    case "clean-size-labels":
      return { variants: vars((x) => [x.id, x.option1, x.option2, x.option3]) };
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

  const t0 = Date.now();
  const CHUNK_MAX = CHUNK_FOR[fix] || CHUNK_FOR.default;
  const chunkReq = Number(body.chunk) || CHUNK_MAX;
  const CHUNK = Math.max(1, Math.min(chunkReq, CHUNK_MAX));
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

    // Maattabel-fix: de huidige metafield erbij halen (voor backup + manual-guard)
    if (fix === "fix-size-guides" && pending.length) {
      const mf = await getProductMetafieldValues(store, pending.map((p) => p.id), { namespace: SG_NS, key: SG_KEY });
      if (mf.ok) for (const p of pending) p.__sizeGuide = mf.values[String(p.id)] || null;
    }

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

    // 2. Dan pas fixen — per product, netjes na elkaar (rate limits), in
    //    slice-volgorde zodat de cursor exact klopt als het budget op is.
    //    Producten die door het budget níet meer aan de beurt komen, worden
    //    in de volgende stap opnieuw gesnapshot (dubbele backup-rij, geen kwaad).
    let fixed = 0;
    let skipped = 0;
    let failed = 0;
    let missing = 0;
    let consumed = 0;
    let budgetHit = false;
    const notes = [];
    for (const id of slice) {
      if (consumed > 0 && Date.now() - t0 > BUDGET_MS) {
        budgetHit = true;
        break;
      }
      const p = pending.find((x) => String(x.id) === String(id));
      consumed++;
      if (!p) {
        missing++;
        continue;
      }
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
    if (missing > 0) notes.push(`${missing} product(en) niet meer gevonden (al verwijderd?)`);
    if (budgetHit) notes.push(`tijdbudget bereikt na ${consumed}/${slice.length} — rest volgt in de volgende stap`);

    const nextCursor = cursor + consumed;
    return NextResponse.json({
      ok: true,
      done: nextCursor >= ids.length,
      nextCursor,
      processed: consumed,
      chunk: CHUNK,
      budgetHit,
      ms: Date.now() - t0,
      fixed,
      skipped,
      failed,
      notes: notes.slice(0, 30),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
