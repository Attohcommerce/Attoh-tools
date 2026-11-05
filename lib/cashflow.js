// CASHFLOW — Shopify Payments-uitbetalingen (04-11-2026).
//
// Per store: de geplande en onderweg zijnde uitbetalingen (SCHEDULED /
// IN_TRANSIT) met datum en nettobedrag, de laatste betaalde uitbetalingen
// (PAID, 14 dagen terug), het huidige saldo bij Shopify Payments en het
// uitbetaalschema. Alles ook omgerekend naar £ (ECB-koers van vandaag, zelfde
// afspraak als het omzet-dashboard). Zo zie je per dag wat er nog
// binnenkomt — vandaag, morgen, overmorgen, de rest van de week.
//
// Credentials: ALTIJD de gewone store-koppeling (sa_stores) — dat is de
// Attoh Tools-app, dezelfde als de Importer — nooit de Orders-app van Bills
// (05-11-2026). Die app moet op elke store de scopes
//   read_shopify_payments_payouts + read_shopify_payments_accounts
// hebben (of de brede read_shopify_payments). Ontbreken ze, dan geeft Shopify
// "access denied" en melden we dat per store.
//
// Let op: issuedAt is de dag waarop Shopify de uitbetaling verstuurt; op de
// bankrekening staat het meestal 1–3 werkdagen later.
import { storeGraphql, resolveToken, cleanDomain } from "./shopify";
import { fxToGbp, londonDay, addDays, TZ } from "./dashboard";

const Q = `
  query Payouts($first: Int!) {
    shopifyPaymentsAccount {
      activated
      balance { amount currencyCode }
      payouts(first: $first, sortKey: ISSUED_AT, reverse: true) {
        nodes {
          id
          issuedAt
          status
          transactionType
          net { amount currencyCode }
          summary {
            chargesGross { amount }
            chargesFee { amount }
            refundsFeeGross { amount }
            refundsFee { amount }
            adjustmentsGross { amount }
            adjustmentsFee { amount }
            reservedFundsGross { amount }
            reservedFundsFee { amount }
          }
        }
      }
    }
  }
`;

/* Uitbetaalschema apart: bij sommige accounts (bv. EMC) geeft Shopify
   "Field inside method payout_schedule is not available for this account" —
   dat mag de uitbetalingen zelf niet blokkeren. */
const Q_SCHEDULE = `
  query PayoutSchedule {
    shopifyPaymentsAccount {
      payoutSchedule { interval weeklyAnchor monthlyAnchor }
    }
  }
`;

/** Welke scopes zitten er écht op het token van deze store? (diagnose bij access denied) */
async function grantedScopes(store) {
  try {
    const t = await resolveToken(store, { force: true });
    if (!t.ok) return "";
    const res = await fetch(`https://${cleanDomain(store.domain)}/admin/oauth/access_scopes.json`, { headers: { "X-Shopify-Access-Token": t.token } });
    const data = await res.json().catch(() => null);
    const list = (data && data.access_scopes) || [];
    return list.map((x) => x.handle).join(", ");
  } catch {
    return "";
  }
}

/** ISO-tijd → kalenderdag in Londen. */
function londonYmd(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const num = (m) => (m && m.amount != null ? Number(m.amount) : 0);

/**
 * storePayouts(store) → {
 *   key, name, domain, ok, error, currency, activated,
 *   balance: [{ amount, currency, gbp }], schedule,
 *   upcoming: [{ id, date, status, net, currency, gbp, gross, fees, refunds, adjustments }],
 *   paid: [...]  (laatste 14 dagen)
 * }
 */
export async function storePayouts(store, { history = 14, first = 60 } = {}) {
  const out = { key: store.key || "", name: store.name, domain: store.domain, ok: false, error: "", currency: store.currency || "", activated: null, balance: [], schedule: null, upcoming: [], paid: [] };
  const r = await storeGraphql(store, Q, { first });
  if (!r.ok) {
    const msg = String(r.error || "");
    if (/access ?denied|ACCESS_DENIED|not approved|scope/i.test(msg)) {
      const scopes = await grantedScopes(store);
      const heeft = /read_shopify_payments(_payouts|_accounts)?\b/.test(scopes);
      out.error = store.token
        ? "Geen toegang tot Shopify Payments — deze store is gekoppeld met een vast Admin API-token zonder de scopes read_shopify_payments_payouts + read_shopify_payments_accounts. Geef de custom app in de Shopify-admin van deze store die scopes en plak het nieuwe token in de store-koppeling (Importer)."
        : heeft
          ? "Shopify weigert de Payments-query terwijl het token de scopes wel heeft — probeer het over een minuut opnieuw."
          : `Geen toegang tot Shopify Payments — de Attoh Tools-app (store-koppeling, zelfde als de Importer) heeft op deze store de payments-scopes nog niet. Scopes op het token nu: ${scopes || "onbekend"}. Fix: Dev Dashboard → Attoh Tools-app → scopes read_shopify_payments_payouts + read_shopify_payments_accounts toevoegen → nieuwe versie releasen → in de Shopify-admin van deze store de nieuwe toegang goedkeuren.`;
    } else if (/not available for this account/i.test(msg)) {
      out.error = "Shopify Payments is niet beschikbaar op dit account (geen Shopify Payments actief, of een ander land/provider).";
    } else out.error = msg;
    return out;
  }
  const acc = r.data && r.data.shopifyPaymentsAccount;
  if (!acc) {
    out.error = "Geen Shopify Payments-account op deze store (of geen toegang).";
    return out;
  }
  out.ok = true;
  out.activated = !!acc.activated;
  // schema apart en optioneel
  try {
    const rs = await storeGraphql(store, Q_SCHEDULE);
    out.schedule = (rs.ok && rs.data && rs.data.shopifyPaymentsAccount && rs.data.shopifyPaymentsAccount.payoutSchedule) || null;
  } catch {
    out.schedule = null;
  }
  const today = londonDay();
  const histFrom = addDays(today, -history);

  // koers per valuta (vandaag) — één keer per valuta
  const fxCache = {};
  const fx = async (cur) => {
    const c = String(cur || "GBP").toUpperCase();
    if (fxCache[c] === undefined) fxCache[c] = await fxToGbp(today, c);
    return fxCache[c];
  };

  for (const b of acc.balance || []) {
    const rate = await fx(b.currencyCode);
    out.balance.push({ amount: Math.round(num(b) * 100) / 100, currency: b.currencyCode, gbp: rate == null ? null : Math.round(num(b) * rate * 100) / 100 });
  }
  if (out.balance.length && !out.currency) out.currency = out.balance[0].currency;

  for (const p of (acc.payouts && acc.payouts.nodes) || []) {
    const date = londonYmd(p.issuedAt);
    const net = num(p.net);
    const cur = (p.net && p.net.currencyCode) || out.currency || "GBP";
    const rate = await fx(cur);
    const s = p.summary || {};
    const rec = {
      id: String(p.id || "").split("/").pop(),
      date,
      status: String(p.status || "").toUpperCase(), // SCHEDULED | IN_TRANSIT | PAID | FAILED | CANCELED
      type: p.transactionType || "DEPOSIT",
      net: Math.round(net * 100) / 100,
      currency: cur,
      gbp: rate == null ? null : Math.round(net * rate * 100) / 100,
      gross: Math.round(num(s.chargesGross) * 100) / 100,
      fees: Math.round((num(s.chargesFee) + num(s.refundsFee) + num(s.adjustmentsFee) + num(s.reservedFundsFee)) * 100) / 100,
      refunds: Math.round(num(s.refundsFeeGross) * 100) / 100,
      adjustments: Math.round((num(s.adjustmentsGross) + num(s.reservedFundsGross)) * 100) / 100,
    };
    if (rec.status === "SCHEDULED" || rec.status === "IN_TRANSIT" || (rec.status === "PAID" && date >= today)) out.upcoming.push(rec);
    else if (rec.status === "PAID" && date >= histFrom) out.paid.push(rec);
    else if (rec.status === "FAILED" && date >= histFrom) out.paid.push(rec);
  }
  out.upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  out.paid.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
  return out;
}

/** Maandag van de week waarin ymd valt (Londen-kalender). */
export function weekStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0 = zo
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

/**
 * aggregate(storesOut, today) → {
 *   days: { ymd: { gbp, items: [{ store, key, net, currency, gbp, status }] } }  (vandaag … +14)
 *   week: { from, to, gbp, count }      — nog te ontvangen t/m zondag
 *   next7: { gbp, count }                — vandaag … +6
 *   later: { gbp, count }                — alles na +14
 *   balanceGbp, balances: [{ key, amount, currency, gbp }]
 * }
 */
export function aggregate(storesOut, today) {
  const days = {};
  for (let i = 0; i <= 14; i++) days[addDays(today, i)] = { gbp: 0, items: [] };
  const wkFrom = today;
  const wkTo = addDays(weekStart(today), 6);
  const week = { from: wkFrom, to: wkTo, gbp: 0, count: 0 };
  const next7 = { gbp: 0, count: 0 };
  const later = { gbp: 0, count: 0 };
  const overdue = { gbp: 0, count: 0 }; // gepland met een datum in het verleden (nog niet betaald)
  let balanceGbp = 0;
  const balances = [];
  for (const s of storesOut) {
    if (!s.ok) continue;
    for (const b of s.balance) {
      balances.push({ key: s.key || s.name, amount: b.amount, currency: b.currency, gbp: b.gbp });
      balanceGbp += b.gbp || 0;
    }
    for (const p of s.upcoming) {
      const item = { store: s.name, key: s.key || s.name, net: p.net, currency: p.currency, gbp: p.gbp, status: p.status, id: p.id };
      if (p.date < today) {
        overdue.gbp += p.gbp || 0;
        overdue.count++;
        (days[today].items = days[today].items).push({ ...item, late: p.date });
        days[today].gbp += p.gbp || 0;
      } else if (days[p.date]) {
        days[p.date].items.push(item);
        days[p.date].gbp += p.gbp || 0;
      } else {
        later.gbp += p.gbp || 0;
        later.count++;
      }
      if (p.date <= wkTo) {
        week.gbp += p.gbp || 0;
        week.count++;
      }
      if (p.date <= addDays(today, 6)) {
        next7.gbp += p.gbp || 0;
        next7.count++;
      }
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const d of Object.keys(days)) days[d].gbp = r2(days[d].gbp);
  return { days, week: { ...week, gbp: r2(week.gbp) }, next7: { ...next7, gbp: r2(next7.gbp) }, later: { ...later, gbp: r2(later.gbp) }, overdue: { ...overdue, gbp: r2(overdue.gbp) }, balanceGbp: r2(balanceGbp), balances };
}
