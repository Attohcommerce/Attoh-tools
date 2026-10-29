"use client";

// OMZET-DASHBOARD (29-10-2026, v3 — live vs gisteren zelfde tijd + klikbare KPI-pop-ups) — alle eigen Attoh-stores op één scherm,
// in Shopify-stijl: omzet per uur (gekozen dag vs dag ervoor), KPI-tegels met
// 14-dagen-sparkline, 14-dagen-trend omzet vs ad spend, en een kaart per store.
//
// Bronnen:
//  - Shopify via de Orders-app per store (dezelfde sleutels als Bills:
//    sa_orders_app::<domein>), anders de gewone store-koppeling.
//  - Google Ads via de sheet "Attoh Ads Live" (tab Ads_<KEY>), elk uur
//    gevuld door het Google Ads-script in elk account.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import { orgLS } from "@/lib/org-client";
import { LineChart, Sparkline } from "./charts";
import MetricModal from "./MetricModal";
import {
  nf2, ok, gbp, gbpAxis, metrics, sumDays, upTo, TILES, METRIC, STORE_STATS, RATIO_IDS, ADS_IDS, Delta, HOURS, hhmm,
} from "./metrics";
import "./dashboard.css";

const LS_STORES = "sa_stores";
const LS_ORDERS_APP = "sa_orders_app::";
const LS_CFG = "attoh_dash_cfg"; // domein → { key, on }
const LS_SHEET = "attoh_dash_ads_sheet";
const DEFAULT_ADS_SHEET = "1xac7M4--kCb2DKShQy7s2A13sgfl4NxW8CXbLGW4H8o"; // Attoh Ads Live
const REFRESH_MS = 2 * 60 * 1000;

// Vaste kleur per store (volgt de store, nooit de positie)
const STORE_COLOR = { SSB: "#3987e5", LGB: "#d95926", EMC: "#199e70", SW: "#c98500" };
const EXTRA_COLORS = ["#9085e9", "#d55181", "#008300", "#e66767"];
const PREV_COLOR = "#6b6b78";

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
function shortDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" });
}
function dayLabel(ymd, today) {
  if (ymd === today) return "Vandaag";
  if (ymd === addDays(today, -1)) return "Gisteren";
  if (ymd === addDays(today, -2)) return "Eergisteren";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/** Uur-reeks → cumulatief; uren na "nu" (alleen vandaag) worden null. */
function cumulative(arr, cutAfter) {
  let run = 0;
  return (arr || new Array(24).fill(0)).map((v, h) => {
    if (cutAfter != null && h > cutAfter) return null;
    run += v || 0;
    return Math.round(run * 100) / 100;
  });
}

export default function DashboardPage() {
  const [stores, setStores] = useState([]);
  const [cfg, setCfg] = useState({});
  const [sheet, setSheet] = useState(DEFAULT_ADS_SHEET);
  const [today, setToday] = useState(londonDay());
  const [date, setDate] = useState(londonDay());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [modal, setModal] = useState(null); // { id, scope }
  const reqId = useRef(0);

  useEffect(() => {
    const list = load(LS_STORES, []);
    setStores(list);
    const saved = load(LS_CFG, {});
    const next = {};
    for (const s of list) {
      const prev = saved[s.domain] || {};
      const key = prev.key != null && prev.key !== "" ? prev.key : guessKey(s);
      next[s.domain] = { key, on: prev.on != null ? prev.on : Boolean(key) };
    }
    setCfg(next);
    setSheet(load(LS_SHEET, "") || DEFAULT_ADS_SHEET);
  }, []);

  function patchCfg(domain, patch) {
    setCfg((prev) => {
      const nextCfg = { ...prev, [domain]: { ...(prev[domain] || {}), ...patch } };
      save(LS_CFG, nextCfg);
      return nextCfg;
    });
  }

  const active = useMemo(() => stores.filter((s) => cfg[s.domain] && cfg[s.domain].on), [stores, cfg]);
  const colorOf = useCallback(
    (key, i) => STORE_COLOR[key] || EXTRA_COLORS[i % EXTRA_COLORS.length],
    []
  );

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

  /* ---------- Afgeleide data ---------- */
  const rows = (data && data.stores) || [];
  const dates = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (let d = data.from; d <= data.date; d = addDays(d, 1)) out.push(d);
    return out;
  }, [data]);
  const totalsByDate = useMemo(
    () => Object.fromEntries(dates.map((d) => [d, sumDays(rows.map((r) => r.days && r.days[d]))])),
    [dates, rows]
  );
  const isToday = Boolean(data && data.date === data.today);
  const ctx = useMemo(() => {
    if (!data) return null;
    const minute = isToday ? Number(data.nowMinute) || 0 : 59;
    return {
      isToday,
      cut: isToday ? data.nowHour : 23,
      minute,
      frac: isToday ? Math.min(1, (minute + 1) / 60) : 1,
      // Ads per uur alleen meenemen als élke store met Ads ook uurdata heeft
      adsHourlyAll: rows.some((r) => r.adsHourly) && rows.every((r) => !(r.days && r.days[data.date] && r.days[data.date].ads) || r.adsHourly),
    };
  }, [data, rows, isToday]);

  /** Vorige dag om te vergelijken: vandaag → gisteren t/m hetzelfde tijdstip. */
  const lflPrev = useCallback(
    (list) => {
      if (!data) return {};
      const full = sumDays(list.map((r) => r.days && r.days[data.prevDate]));
      if (!ctx.isToday) return full;
      const part = sumDays(list.map((r) => upTo(r.hours && r.hours[data.prevDate], ctx.cut, ctx.frac, ctx.adsHourlyAll)));
      const out = {};
      for (const id of Object.keys(METRIC)) {
        if (ok(part[id]) && (!ADS_IDS.has(id) || ctx.adsHourlyAll)) out[id] = part[id];
        else out[id] = RATIO_IDS.has(id) ? full[id] : null; // ratio mag met hele dag; absolute cijfers niet
      }
      return out;
    },
    [data, ctx]
  );
  const sel = (data && totalsByDate[data.date]) || {};
  const prv = useMemo(() => (data ? lflPrev(rows) : {}), [data, rows, lflPrev]);
  const prvFull = (data && totalsByDate[data.prevDate]) || {};
  const vsLabel = data ? (isToday ? `vs gisteren t/m ${hhmm(ctx.cut, ctx.minute)}` : `vs ${dayLabel(data.prevDate, data.today).toLowerCase()}`) : "";

  const hourly = useMemo(() => {
    if (!data) return null;
    const sumHours = (d) => {
      const out = new Array(24).fill(0);
      for (const r of rows) {
        const h = r.hours && r.hours[d];
        if (h && h.revenue) h.revenue.forEach((v, i) => (out[i] += v || 0));
      }
      return out;
    };
    return {
      day: cumulative(sumHours(data.date), isToday ? data.nowHour : null),
      prev: cumulative(sumHours(data.prevDate), null),
    };
  }, [data, rows, isToday]);

  /* Laatste uur: omzet + orders in het lopende uur vs dezelfde 60 min gisteren */
  const lastHour = useMemo(() => {
    if (!data || !ctx.isToday) return null;
    const tot = (d, h, f) => sumDays(rows.map((r) => upTo(r.hours && r.hours[d], h, f, false)));
    const now = tot(data.date, ctx.cut, 1);
    const back = tot(data.date, ctx.cut - 1, ctx.frac);
    return { revenue: (now.revenue || 0) - (back.revenue || 0), orders: (now.orders || 0) - (back.orders || 0) };
  }, [data, rows, ctx]);

  const trend = useMemo(
    () => ({
      revenue: dates.map((d) => (totalsByDate[d] && ok(totalsByDate[d].revenue) ? totalsByDate[d].revenue : null)),
      cost: dates.map((d) => (totalsByDate[d] && ok(totalsByDate[d].cost) ? totalsByDate[d].cost : null)),
    }),
    [dates, totalsByDate]
  );
  const hasAds = trend.cost.some((v) => v != null);

  const issues = useMemo(() => {
    const groups = {};
    const add = (title, store) => {
      groups[title] = groups[title] || [];
      groups[title].push(store);
    };
    for (const r of rows) {
      const k = r.key || r.name;
      if (r.sessionsError) {
        if (/read_reports|Level 2|protected/i.test(r.sessionsError)) add("Conversie: de Orders-app mist read_reports + toegang tot protected customer data (Level 2)", k);
        else add("Conversie: " + r.sessionsError, k);
      }
      if (r.adsError) {
        if (/bestaat nog niet/i.test(r.adsError)) add("Google Ads: script draait nog niet in dit account (geen tab Ads_" + (r.key || "?") + ")", k);
        else add("Google Ads: " + r.adsError, k);
      }
      for (const e of r.errors || []) add(e, k);
    }
    return Object.entries(groups);
  }, [rows]);

  const quick = [today, addDays(today, -1), addDays(today, -2)];
  const lastAds = useMemo(() => {
    const ts = rows.flatMap((r) => Object.values(r.days || {}).map((d) => d.ads && d.ads.updated)).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : "";
  }, [rows]);

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
            <button className="dd-arrow" onClick={() => setDate(addDays(date, 1) > today ? today : addDays(date, 1))} disabled={date >= today} aria-label="Volgende dag">›</button>
            <input type="date" className="dd-date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <div className="dd-status">
            {date === today ? <span className="dd-live"><span className="dd-livedot" />Live</span> : null}
            <span className="muted small">{lastAds ? `Ads bijgewerkt ${lastAds.slice(11)}` : ""}</span>
            <button className="dd-refresh" onClick={refresh} disabled={busy} title="Verversen">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={busy ? "spin" : ""}>
                <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stores aan/uit */}
        <div className="dd-chips">
          {stores.map((s, i) => {
            const c = cfg[s.domain] || {};
            return (
              <button key={s.domain} className={"dd-chip" + (c.on ? " on" : "")} onClick={() => patchCfg(s.domain, { on: !c.on })} title={s.domain}>
                <span className="dd-dot" style={c.on ? { background: colorOf(c.key, i) } : null} />
                {c.key || s.name}
              </button>
            );
          })}
          <span className="dd-flex" />
          {issues.length > 0 && (
            <button className={"dd-chip dd-warnchip" + (showIssues ? " on" : "")} onClick={() => setShowIssues((v) => !v)}>
              ⚠ {issues.length} {issues.length === 1 ? "melding" : "meldingen"}
            </button>
          )}
          <button className="dd-chip dd-gear" onClick={() => setShowSettings((v) => !v)} title="Instellingen">⚙</button>
        </div>

        {showIssues && issues.length > 0 && (
          <div className="dd-issues">
            {issues.map(([title, list]) => (
              <div key={title} className="dd-issue">
                <span>{title}</span>
                <span className="muted small">{list.join(" · ")}</span>
              </div>
            ))}
          </div>
        )}

        {showSettings && (
          <div className="card">
            <h2>Instellingen</h2>
            <div className="field-label">Google Ads-sheet ("Attoh Ads Live") <span className="opt">link of ID</span></div>
            <input
              type="text"
              value={sheet}
              onChange={(e) => {
                const v = e.target.value.trim();
                setSheet(v || DEFAULT_ADS_SHEET);
                save(LS_SHEET, v);
              }}
            />
            <div className="field-label">Sleutel per store <span className="opt">gelijk aan STORE in het Ads-script</span></div>
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
          </div>
        )}

        {error && <div className="dd-error">{error}</div>}
        {!data && busy && <div className="dd-skeleton" />}

        {data && (
          <>
            {/* Hoofdgrafiek: omzet per uur */}
            <section className="dd-card dd-hero dd-click" onClick={() => setModal({ id: "revenue" })} title="Klik voor details">
              <div className="dd-hero-head">
                <div>
                  <div className="dd-eyebrow">Totale omzet · {dayLabel(data.date, data.today)}</div>
                  <div className="dd-big">{gbp(sel.revenue)}</div>
                  <div className="dd-hero-sub">
                    <Delta cur={sel.revenue} prev={prv.revenue} />
                    <span className="muted">{vsLabel} {gbp(prv.revenue)}</span>
                    {isToday ? <span className="muted">· hele dag gisteren {gbp(prvFull.revenue)}</span> : null}
                  </div>
                  {lastHour && (
                    <div className="dd-hero-sub dd-lasthour">
                      <span className="dd-livedot sm" />
                      <span>Laatste uur: <b>{gbp(lastHour.revenue)}</b> · <b>{lastHour.orders === 1 ? "1 order" : `${Math.round(lastHour.orders)} orders`}</b></span>
                    </div>
                  )}

                </div>
                <div className="dd-legend">
                  <span><i style={{ background: "#3987e5" }} />{dayLabel(data.date, data.today)}</span>
                  <span><i className="dashed" />{dayLabel(data.prevDate, data.today)}</span>
                </div>
              </div>
              {hourly && (
                <LineChart
                  height={280}
                  labels={HOURS}
                  xEvery={3}
                  fmt={(v, axis) => (axis ? gbpAxis(v) : gbp(v))}
                  tooltipTitle={(i) => `t/m ${HOURS[i].replace(":00", ":59")}`}
                  series={[
                    { name: dayLabel(data.date, data.today), color: "#3987e5", values: hourly.day },
                    { name: dayLabel(data.prevDate, data.today), color: PREV_COLOR, values: hourly.prev, dashed: true, muted: true },
                  ]}
                />
              )}
            </section>

            {/* KPI-tegels */}
            <div className="dd-tiles">
              {TILES.map((t) => {
                const series = dates.map((d) => (totalsByDate[d] ? totalsByDate[d][t.id] : null));
                return (
                  <button key={t.id} className="dd-tile dd-click" title={(t.hint ? t.hint + " · " : "") + "Klik voor details"} onClick={() => setModal({ id: t.id })}>
                    <div className="dd-tile-top">
                      <span className="dd-tile-label">{t.label}</span>
                      <Delta cur={sel[t.id]} prev={prv[t.id]} lowerIsBetter={t.lowerIsBetter} />
                    </div>
                    <div className="dd-tile-value">{t.fmt(sel[t.id])}</div>
                    <Sparkline values={series} color={t.lowerIsBetter ? "#d95926" : "#3987e5"} />
                    <div className="dd-tile-foot muted small">{isToday ? `vs gisteren t/m ${hhmm(ctx.cut, ctx.minute)}` : "14 dagen"}</div>
                  </button>
                );
              })}
            </div>

            {/* Trend 14 dagen */}
            <section className="dd-card">
              <div className="dd-hero-head">
                <div>
                  <div className="dd-eyebrow">Laatste 14 dagen</div>
                  <div className="dd-mid">Omzet {hasAds ? "vs ad spend" : ""}</div>
                </div>
                <div className="dd-legend">
                  <span><i style={{ background: "#3987e5" }} />Omzet</span>
                  {hasAds ? <span><i style={{ background: "#d95926" }} />Ad spend</span> : null}
                </div>
              </div>
              <LineChart
                height={240}
                labels={dates.map(shortDate)}
                xEvery={2}
                fmt={(v, axis) => (axis ? gbpAxis(v) : gbp(v))}
                series={[
                  { name: "Omzet", color: "#3987e5", values: trend.revenue },
                  ...(hasAds ? [{ name: "Ad spend", color: "#d95926", values: trend.cost, noFill: true }] : []),
                ]}
              />
            </section>

            {/* Per store */}
            <div className="dd-stores">
              {rows.map((r, i) => {
                const d = r.days && r.days[data.date];
                const p = r.days && r.days[data.prevDate];
                const m = metrics(d);
                const pm = lflPrev([r]);
                const color = colorOf(r.key, i);
                const hDay = cumulative(r.hours && r.hours[data.date] && r.hours[data.date].revenue, isToday ? data.nowHour : null);
                const hPrev = cumulative(r.hours && r.hours[data.prevDate] && r.hours[data.prevDate].revenue, null);
                return (
                  <section key={r.domain} className="dd-card dd-store">
                    <div className="dd-store-head">
                      <span className="dd-store-dot" style={{ background: color }} />
                      <strong>{r.key || r.name}</strong>
                      <span className="muted small">{r.name}</span>
                      {r.currency && r.currency !== "GBP" && d && d.fx ? (
                        <span className="dd-pill">{r.currency} {nf2.format(d.revenueLocal)}</span>
                      ) : null}
                    </div>
                    <div className="dd-store-main dd-click" onClick={() => setModal({ id: "revenue", scope: r.domain })} title="Klik voor details">
                      <div>
                        <div className="dd-mid">{gbp(m.revenue)}</div>
                        <Delta cur={m.revenue} prev={pm.revenue} />
                      </div>
                      <div className="dd-store-chart">
                        <LineChart
                          height={96}
                          compact
                          labels={HOURS}
                          xEvery={6}
                          fmt={(v, axis) => (axis ? gbpAxis(v) : gbp(v))}
                          series={[
                            { name: dayLabel(data.date, data.today), color, values: hDay },
                            { name: dayLabel(data.prevDate, data.today), color: PREV_COLOR, values: hPrev, dashed: true, muted: true },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="dd-store-stats">
                      {STORE_STATS.map((id) => {
                        const t = METRIC[id];
                        return (
                          <button key={id} className="dd-stat dd-click" title={(t.hint ? t.hint + " · " : "") + "Klik voor details"} onClick={() => setModal({ id, scope: r.domain })}>
                            <span className="dd-stat-label">{t.label}</span>
                            <span className="dd-stat-value">{t.fmt(m[id])}</span>
                            <Delta cur={m[id]} prev={pm[id]} lowerIsBetter={t.lowerIsBetter} />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {modal && data && (
          <MetricModal
            metricId={modal.id}
            initialScope={modal.scope}
            data={data}
            rows={rows}
            ctx={ctx}
            colorOf={colorOf}
            dayLabel={(d) => dayLabel(d, data.today)}
            onClose={() => setModal(null)}
          />
        )}

        {!busy && !error && active.length === 0 && stores.length > 0 && (
          <div className="center-note">Zet hierboven minstens één store aan.</div>
        )}
        {stores.length === 0 && <div className="center-note">Koppel eerst je stores in de Importer.</div>}
      </div>
    </>
  );
}
