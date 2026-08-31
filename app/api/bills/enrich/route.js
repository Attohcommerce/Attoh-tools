import { NextResponse } from "next/server";
import { storeRequest } from "@/lib/shopify";
import { readRange, getSheetSizes } from "@/lib/sheets";
import { LOG_TAB, MONTHS_EN, londonDate, splitDate, dateNLOf, dupKey, round2 } from "@/lib/bills";

export const maxDuration = 60;

// KUNGFUBUY BILL — ENRICH. Krijgt de kale orderregels uit de PDF('s) en
// maakt er sheet-klare regels van:
//   1. per ordernummer de échte orderdatum uit Shopify (dag in Londen —
//      zelfde dagvenster als de rest van het P&L-systeem, NIET de
//      factuurdatum van de bill);
//   2. omrekening naar GBP met de ECB-dagkoers van die orderdatum
//      (weekend/feestdag = laatste bankdag ervoor), zodat ook een backlog
//      van oude bills per dag klopt;
//   3. dupe-check tegen het COGS Log-tabblad, zodat een dubbel geüploade
//      bill nooit dubbel meetelt.
// Client stuurt maximaal ±100 unieke orders per aanroep (chunking daar).

/* ---------- Shopify orderlookup ---------- */

async function lookupOrder(store, name) {
  // Ordernaam kan met of zonder "#" in Shopify staan; probeer beide.
  for (const q of [name, `#${name}`]) {
    const r = await storeRequest(
      store,
      `/orders.json?status=any&name=${encodeURIComponent(q)}&fields=id,name,order_number,created_at,cancelled_at&limit=10`
    );
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return { scope: true };
      return { err: r.error };
    }
    const list = (r.data && r.data.orders) || [];
    const hit =
      list.find(
        (o) =>
          String(o.order_number) === String(name) ||
          String(o.name || "").replace(/^#/, "") === String(name)
      ) || (list.length === 1 ? list[0] : null);
    if (hit) return { order: hit };
  }
  return { notFound: true };
}

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/* ---------- Wisselkoers: ECB-dagkoers van de orderdatum ---------- */

const fxCache = new Map(); // "yyyy-mm-dd|EUR" → { rate, rateDate }

async function fxToGbp(date, currency) {
  const cur = String(currency || "").toUpperCase();
  if (cur === "GBP") return { rate: 1, rateDate: date };
  const key = `${date}|${cur}`;
  if (fxCache.has(key)) return fxCache.get(key);

  const urls = [
    `https://api.frankfurter.dev/v1/${date}?base=${cur}&symbols=GBP`,
    `https://api.frankfurter.app/${date}?from=${cur}&to=GBP`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const rate = data && data.rates && data.rates.GBP;
      if (rate) {
        const out = { rate, rateDate: data.date || date };
        fxCache.set(key, out);
        return out;
      }
    } catch {}
  }
  return null;
}

/* ---------- Route ---------- */

export async function POST(req) {
  const { store, sheetId, rows } = await req.json().catch(() => ({}));
  if (!store || !store.domain) {
    return NextResponse.json({ error: "Geen store geselecteerd" }, { status: 400 });
  }
  if (!sheetId) {
    return NextResponse.json({ error: "Geen sheet opgegeven" }, { status: 400 });
  }
  if (!Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: "Geen orderregels om te verwerken" }, { status: 400 });
  }

  try {
    // 1. Sheet-info: welke maandtabs bestaan er, en is de sheet bereikbaar?
    let tabTitles;
    try {
      tabTitles = new Set((await getSheetSizes(sheetId)).map((t) => t.title));
    } catch (e) {
      return NextResponse.json(
        {
          error: `Sheet niet leesbaar — is hij gedeeld met het service account (Bewerker)? (${String(
            e.message || e
          )})`,
        },
        { status: 422 }
      );
    }

    // 2. Bestaand COGS Log voor de dupe-check (tab mag nog ontbreken).
    const seen = new Set();
    let logMissing = false;
    try {
      const log = await readRange(sheetId, `'${LOG_TAB}'!A2:I100000`);
      for (const r of log) if (r[1] != null && r[1] !== "") seen.add(dupKey(r[1], r[2]));
    } catch {
      logMissing = true;
    }

    // 3. Shopify: unieke ordernummers opzoeken (max 6 tegelijk).
    const uniq = [...new Set(rows.map((r) => String(r.order || "").trim()).filter(Boolean))];
    const orderMap = new Map();
    let scopeError = false;
    let hardError = null;
    await mapLimit(uniq, 6, async (name) => {
      if (scopeError || hardError) return;
      const r = await lookupOrder(store, name);
      if (r.scope) scopeError = true;
      else if (r.err) hardError = r.err;
      else if (r.order) orderMap.set(name, r.order);
    });
    if (scopeError) {
      return NextResponse.json(
        {
          error:
            "Shopify weigert de order-lookup (401/403). De gekoppelde app mist vrijwel zeker de read_orders-scope — voeg die toe in het Dev Dashboard bij deze app en probeer opnieuw.",
        },
        { status: 422 }
      );
    }
    if (hardError && !orderMap.size) {
      return NextResponse.json({ error: `Order-lookup mislukt: ${hardError}` }, { status: 422 });
    }

    // 4. Regels verrijken: datum, maandtab, koers, dupe-status.
    const out = [];
    for (const r of rows) {
      const base = {
        order: String(r.order || "").trim(),
        invoiceNo: String(r.invoiceNo || "").trim(),
        stuks: Number(r.stuks) || 0,
        cost: Number(r.cost),
        currency: String(r.currency || "EUR").toUpperCase(),
        store: String(r.store || "").trim(),
      };
      if (!base.order || !Number.isFinite(base.cost)) {
        out.push({ ...base, status: "onleesbaar", note: "geen ordernummer of bedrag" });
        continue;
      }
      const o = orderMap.get(base.order);
      if (!o) {
        out.push({
          ...base,
          status: "niet_gevonden",
          note: hardError ? `lookup-fout: ${hardError}` : "order niet gevonden in Shopify",
        });
        continue;
      }
      const date = londonDate(o.created_at);
      const s = splitDate(date);
      if (!date || !s) {
        out.push({ ...base, status: "niet_gevonden", note: "orderdatum onleesbaar" });
        continue;
      }
      const monthTab = MONTHS_EN[s.m - 1];
      const fx = await fxToGbp(date, base.currency);
      if (!fx) {
        out.push({ ...base, date, dateNL: dateNLOf(date), status: "koers_mislukt", note: `geen ${base.currency}→GBP-koers voor ${date}` });
        continue;
      }
      const gbp = round2(base.cost * fx.rate);
      const dup = seen.has(dupKey(base.order, base.invoiceNo));
      out.push({
        ...base,
        shopifyOrder: o.name || `#${o.order_number}`,
        date,
        dateNL: dateNLOf(date),
        monthTab,
        tabExists: tabTitles.has(monthTab),
        rate: fx.rate,
        rateDate: fx.rateDate,
        gbp,
        cancelled: Boolean(o.cancelled_at),
        status: dup ? "dupe" : "ok",
        note: [
          dup ? "staat al in het COGS Log" : "",
          !tabTitles.has(monthTab) ? `maandtab "${monthTab}" ontbreekt — regel wordt wel gelogd, V niet geschreven` : "",
          o.cancelled_at ? "order is geannuleerd in Shopify" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }

    return NextResponse.json({ ok: true, logMissing, rows: out });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
