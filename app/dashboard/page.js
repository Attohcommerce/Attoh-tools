"use client";

// OMZET-DASHBOARD (29-10-2026) — alle eigen Attoh-stores op één scherm:
// omzet in £ (live omgerekend), orders, conversie, en per store de Google
// Ads-cijfers van het hele account (ad spend, CPC, CPM, ROAS). Dagen
// navigeren met Vandaag / Gisteren / Eergisteren of de datumkiezer; elk
// cijfer toont het verschil met de dag ervoor. Stores aan/uit met chips.
//
// Bronnen:
//  - Shopify via de Orders-app per store (dezelfde sleutels als Bills:
//    sa_orders_app::<domein>), anders de gewone store-koppeling.
//  - Google Ads via de sheet "Attoh Ads Live" (tab Ads_<KEY>), elk uur
//    gevuld door het Google Ads-script in elk account.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { orgLS } from "@/lib/org-client";
import "./dashboard.css";

const LS_STORES = "sa_stores";
const LS_ORDERS_APP = "sa_orders_app::";
const LS_CFG = "attoh_dash_cfg"; // domein → { key, on }
const LS_SHEET = "attoh_dash_ads_sheet";
const REFRESH_MS = 2 * 60 * 1000;

const KNOWN = [
  { key: "SSB", match: /soul\s*society|0d6n10-zj/i },
  { key: "LGB", match: /lady\s*glam|lornvale/i },
  { key: "EMC", match: /everman/i },
  { key: "SW", match: /shapes\s*wardrobe|shapeswardrobe|6snnji-kr/i },
];
const guessKey = (s) => {
  const hay = `${s.name || ""} ${s.domain || ""}`;
  const hit = KNOWN.find((k) => k.match.test(hay));
  return hit ? hit.key : "";
};

function load(key, fallback) {
  try {
    const v = orgLS.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    orgLS.setItem(key, JSON.stringify(value));
  } catch {}
}

function londonDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}
function dayLabel(ymd, today) {
  if (ymd === today) return "Vandaag";
  if (ymd === addDays(today, -1)) return "Gisteren";
  if (ymd === addDays(today, -2)) return "Eergisteren";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

const nf2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const gbp = (v) => (v == null || !Number.isFinite(v) ? "—" : "£" + nf2.format(v));
const int = (v) => (v == null || !Number.isFinite(v) ? "—" : nf0.format(v));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : nf2.format(v * 100) + "%");
const ratio = (v) => (v == null || !Number.isFinite(v) ? "—" : nf2.format(v));
const div = (a, b) => (b ? a / b : null);

/* Alle afgeleide cijfers voor één dag van één store (of een totaal). */
function metrics(d) {
  if (!d) return {};
  const ads = d.ads;
  const cost = ads ? ads.cost : null;
  return {
    revenue: d.revenue,
    orders: d.orders,
    sessions: d.sessions,
    cvr: d.sessions ? div(d.orders, d.sessions) : null,
    cost,
    roasReal: ads && cost ? div(d.revenue || 0, cost) : null,
    roasGoogle: ads && cost ? div(ads.convValue, cost) : null,
    cpc: ads && ads.clicks ? div(cost, ads.clicks) : null,
    cpm: ads && ads.impressions ? (cost / ads.impressions) * 1000 : null,
  };
}

function sumDays(list) {
  const t = { revenue: 0, orders: 0, sessions: 0, sessOrders: 0, hasSess: false, ads: null, adsRevenue: 0 };
  for (const d of list) {
    if (!d) continue;
    t.revenue += d.revenue || 0;
    t.orders += d.orders || 0;
    if (d.sessions != null) {
      t.hasSess = true;
      t.sessions += d.sessions;
      t.sessOrders += d.orders || 0;
    }
    if (d.ads) {
      if (!t.ads) t.ads = { cost: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0 };
      for (const k of Object.keys(t.ads)) t.ads[k] += d.ads[k] || 0;
      t.adsRevenue += d.revenue || 0;
    }
  }
  const m = metrics({ revenue: t.revenue, orders: t.orders, sessions: t.hasSess ? t.sessions : null, ads: t.ads });
  // conversie alleen over stores mét sessies, echte ROAS alleen over stores mét ads
  m.cvr = t.hasSess && t.sessions ? t.sessOrders / t.sessions : null;
  m.roasReal = t.ads && t.ads.cost ? t.adsRevenue / t.ads.cost : null;
  return m;
}

const COLS = [
  { id: "revenue", label: "Omzet", fmt: gbp },
  { id: "orders", label: "Orders", fmt: int },
  { id: "cvr", label: "Conversie", fmt: pct },
  { id: "cost", label: "Ad spend", fmt: gbp, lowerIsBetter: true },
  { id: "roasReal", label: "ROAS (Shopify)", fmt: ratio, hint: "Shopify-omzet in £ / Google Ads-kosten" },
  { id: "roasGoogle", label: "ROAS (Google)", fmt: ratio, hint: "Conversiewaarde in Google Ads / kosten" },
  { id: "cpc", label: "CPC", fmt: gbp, lowerIsBetter: true, hint: "Kosten / kliks, alle campagnes samen" },
  { id: "cpm", label: "CPM", fmt: gbp, lowerIsBetter: true, hint: "Kosten per 1.000 vertoningen" },
];

function Delta({ cur, prev, lowerIsBetter }) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return <span className="dd-delta flat">—</span>;
  if (prev === 0) return <span className="dd-delta flat">{cur === 0 ? "0%" : "nieuw"}</span>;
  const ch = (cur - prev) / Math.abs(prev);
  if (Math.abs(ch) < 0.0005) return <span className="dd-delta flat">0%</span>;
  const good = lowerIsBetter ? ch < 0 : ch > 0;
  return (
    <span className={"dd-delta " + (good ? "up" : "down")}>
      {ch > 0 ? "▲" : "▼"} {nf0.format(Math.abs(ch) * 100)}%
    </span>
  );
}

export default function DashboardPage() {
  const [stores, setStores] = useState([]);
  const [cfg, setCfg] = useState({});
  const [sheet, setSheet] = useState("");
  const [today, setToday] = useState(londonDay());
  const [date, setDate] = useState(londonDay());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const list = load(LS_STORES, []);
    setStores(list);
    const saved = load(LS_CFG, {});
    const next = {};
    for (const s of list) {
      const prev = saved[s.domain] || {};
      const key = prev.key != null ? prev.key : guessKey(s);
      next[s.domain] = { key, on: prev.on != null ? prev.on : Boolean(key) };
    }
    setCfg(next);
    setSheet(load(LS_SHEET, ""));
    if (!load(LS_SHEET, "")) setShowSettings(true);
  }, []);

  function patchCfg(domain, patch) {
    setCfg((prev) => {
      const nextCfg = { ...prev, [domain]: { ...(prev[domain] || {}), ...patch } };
      save(LS_CFG, nextCfg);
      return nextCfg;
    });
  }

  const active = useMemo(() => stores.filter((s) => cfg[s.domain] && cfg[s.domain].on), [stores, cfg]);

  const refresh = useCallback(async () => {
    if (!active.length) {
      setData(null);
      return;
    }
    const id = ++reqId.current;
    setBusy(true);
    setError("");
    const body = {
      date,
      adsSheetId: sheet,
      stores: active.map((s) => {
        const keys = load(LS_ORDERS_APP + s.domain, null) || {};
        const useOrdersApp = Boolean(keys.clientId && keys.clientSecret);
        return {
          key: (cfg[s.domain] && cfg[s.domain].key) || "",
          name: s.name,
          domain: s.domain,
          currency: s.currency,
          token: useOrdersApp ? undefined : s.token,
          clientId: useOrdersApp ? keys.clientId : s.clientId,
          clientSecret: useOrdersApp ? keys.clientSecret : s.clientSecret,
        };
      }),
    };
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (id !== reqId.current) return;
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      if (json.today) setToday(json.today);
    } catch (e) {
      if (id === reqId.current) setError(String(e.message || e));
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  }, [active, cfg, date, sheet]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Vandaag = live: elke 2 minuten verversen, en bij terugkeren op het tabblad
  useEffect(() => {
    if (date !== today) return;
    const t = setInterval(refresh, REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [date, today, refresh]);

  const rows = (data && data.stores) || [];
  const totDay = useMemo(() => sumDays(rows.map((r) => r.day)), [rows]);
  const totPrev = useMemo(() => sumDays(rows.map((r) => r.prev)), [rows]);
  const lastAds = useMemo(() => {
    const ts = rows.map((r) => r.day && r.day.ads && r.day.ads.updated).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : "";
  }, [rows]);

  const quick = [today, addDays(today, -1), addDays(today, -2)];

  return (
    <>
      <Header icon="£" title="Dashboard" subtitle="Omzet · Ads · ROAS" />
      <div className="page dd">
        {/* Dagkeuze */}
        <div className="dd-bar">
          <div className="dd-days">
            <button className="dd-arrow" onClick={() => setDate(addDays(date, -1))} aria-label="Vorige dag">‹</button>
            {quick.map((d, i) => (
              <button key={d} className={"dd-day" + (d === date ? " on" : "")} onClick={() => setDate(d)}>
                {["Vandaag", "Gisteren", "Eergisteren"][i]}
              </button>
            ))}
            <button
              className="dd-arrow"
              onClick={() => setDate(addDays(date, 1) > today ? today : addDays(date, 1))}
              disabled={date >= today}
              aria-label="Volgende dag"
            >›</button>
            <input
              type="date"
              className="dd-date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
          <div className="dd-status">
            <span className="dd-label">{dayLabel(date, today)}</span>
            <span className="muted small">
              vs {data ? dayLabel(data.prevDate, today).toLowerCase() : "vorige dag"}
              {date === today ? " · live, ververst elke 2 min" : ""}
              {lastAds ? ` · Ads bijgewerkt ${lastAds}` : ""}
            </span>
            <button className="btn btn-ghost btn-small" onClick={refresh} disabled={busy}>
              {busy ? "Laden…" : "Verversen"}
            </button>
          </div>
        </div>

        {/* Stores aan/uit */}
        <div className="dd-chips">
          {stores.length === 0 && <span className="muted">Koppel eerst je stores in de Importer.</span>}
          {stores.map((s) => {
            const c = cfg[s.domain] || {};
            return (
              <button
                key={s.domain}
                className={"dd-chip" + (c.on ? " on" : "")}
                onClick={() => patchCfg(s.domain, { on: !c.on })}
                title={s.domain}
              >
                <span className="dd-dot" />
                {c.key ? <strong>{c.key}</strong> : null}
                <span>{s.name}</span>
              </button>
            );
          })}
          <button className="dd-chip dd-gear" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? "Instellingen sluiten" : "Instellingen"}
          </button>
        </div>

        {showSettings && (
          <div className="card">
            <h2>Instellingen</h2>
            <div className="field-label">Google Ads-sheet ("Attoh Ads Live") <span className="opt">link of ID</span></div>
            <input
              type="text"
              value={sheet}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              onChange={(e) => {
                setSheet(e.target.value.trim());
                save(LS_SHEET, e.target.value.trim());
              }}
            />
            <div className="hint">
              Elk Google Ads-account schrijft elk uur naar tabblad <code>Ads_&lt;SLEUTEL&gt;</code> van deze sheet.
              Deel de sheet als bewerker met het service account van Attoh Tools.
            </div>
            <div className="field-label">Sleutel per store <span className="opt">moet gelijk zijn aan STORE in het Ads-script</span></div>
            <div className="dd-keys">
              {stores.map((s) => (
                <label key={s.domain} className="dd-keyrow">
                  <span>{s.name}</span>
                  <input
                    type="text"
                    value={(cfg[s.domain] && cfg[s.domain].key) || ""}
                    placeholder="bv. SSB"
                    onChange={(e) => patchCfg(s.domain, { key: e.target.value.trim().toUpperCase() })}
                  />
                </label>
              ))}
            </div>
            <div className="hint">
              Omzet en orders komen uit de Orders-app van elke store (dezelfde sleutels als bij Bills). Voor
              conversie heeft die app ook de scope <code>read_reports</code> nodig.
            </div>
          </div>
        )}

        {error && <div className="dd-error">{error}</div>}

        {/* Totaal */}
        {rows.length > 0 && (
          <div className="dd-kpis">
            {COLS.map((c) => (
              <div key={c.id} className="dd-kpi" title={c.hint || ""}>
                <div className="dd-kpi-label">{c.label}</div>
                <div className="dd-kpi-value">{c.fmt(totDay[c.id])}</div>
                <div className="dd-kpi-sub">
                  <Delta cur={totDay[c.id]} prev={totPrev[c.id]} lowerIsBetter={c.lowerIsBetter} />
                  <span className="muted small">vorige: {c.fmt(totPrev[c.id])}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Per store */}
        {rows.length > 0 && (
          <div className="card dd-tablecard">
            <h2>Per store</h2>
            <div className="dd-tablewrap">
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>Store</th>
                    {COLS.map((c) => (
                      <th key={c.id} title={c.hint || ""}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = metrics(r.day);
                    const p = metrics(r.prev);
                    const notes = [...(r.errors || [])];
                    if (r.sessionsError) notes.push(r.sessionsError);
                    if (r.adsError) notes.push(r.adsError);
                    return (
                      <tr key={r.domain}>
                        <td className="dd-store">
                          <strong>{r.key || r.name}</strong>
                          <span className="muted small">{r.name}</span>
                          {r.adsId ? <span className="muted small">Ads {r.adsId}</span> : null}
                          {r.currency && r.currency !== "GBP" && r.day && r.day.fx ? (
                            <span className="muted small">
                              {r.currency} {nf2.format(r.day.revenueLocal)} · koers {nf2.format(r.day.fx)}
                            </span>
                          ) : null}
                          {notes.map((n, i) => (
                            <span key={i} className="dd-note">{n}</span>
                          ))}
                        </td>
                        {COLS.map((c) => (
                          <td key={c.id}>
                            <div className="dd-val">{c.fmt(m[c.id])}</div>
                            <Delta cur={m[c.id]} prev={p[c.id]} lowerIsBetter={c.lowerIsBetter} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!busy && !error && active.length === 0 && stores.length > 0 && (
          <div className="center-note">Zet hierboven minstens één store aan.</div>
        )}
      </div>
    </>
  );
}
