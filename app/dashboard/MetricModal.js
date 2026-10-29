"use client";

// Pop-up per KPI: grafiek per uur of per dag, totaal / per store / één store,
// en vergelijken met 1 uur terug, gisteren zelfde tijd of vorige week.
import { useEffect, useMemo, useState } from "react";
import { LineChart } from "./charts";
import {
  METRIC, ADS_IDS, RATIO_IDS, ADDITIVE, HOURS, hhmm, ok, sumDays, upTo, atHour, Delta, nf0,
} from "./metrics";

const PREV_COLOR = "#6b6b78";

function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}
function shortDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function MetricModal({ metricId, initialScope, data, rows, ctx, colorOf, dayLabel, onClose }) {
  const [id, setId] = useState(metricId);
  const m = METRIC[id];
  const isAds = ADS_IDS.has(id);
  const hourlyOk = !isAds || ctx.adsHourlyAll;
  const [view, setView] = useState(hourlyOk ? "uur" : "dag");
  const [cum, setCum] = useState(true);
  const [scope, setScope] = useState(initialScope || "all"); // all | split | <domain>
  const [cmp, setCmp] = useState(ctx.isToday ? "yesterday" : "prevday");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!hourlyOk && view === "uur") setView("dag");
  }, [hourlyOk, view]);

  function close() {
    setShown(false);
    setTimeout(onClose, 180);
  }

  const date = data.date;
  const prevDate = data.prevDate;
  const weekDate = addDays(date, -7);
  const cut = ctx.cut;
  const frac = ctx.frac;
  const wa = ctx.adsHourlyAll;

  const scoped = useMemo(
    () => (scope === "all" || scope === "split" ? rows : rows.filter((r) => r.domain === scope)),
    [rows, scope]
  );
  const val = (list) => sumDays(list)[id];
  const day = (rs, d) => val(rs.map((r) => r.days && r.days[d]));
  const hrs = (r, d) => r.hours && r.hours[d];
  const hasHours = scoped.some((r) => hrs(r, date));

  /* ---------- Huidige waarde + vergelijkingen ---------- */
  const current = day(scoped, date);
  const comps = useMemo(() => {
    const list = [];
    if (ctx.isToday) {
      if (hasHours && hourlyOk) {
        const now = val(scoped.map((r) => upTo(hrs(r, date), cut, 1, wa)));
        const back = val(scoped.map((r) => upTo(hrs(r, date), cut - 1, frac, wa)));
        list.push({ key: "hour", label: "1 uur terug", sub: `t/m ${hhmm(Math.max(cut - 1, 0), ctx.minute)}`, cur: now, prev: back });
      } else {
        list.push({ key: "hour", label: "1 uur terug", sub: isAds ? "wacht op Ads-uurdata" : "geen uurdata", cur: null, prev: null, disabled: true });
      }
      let y = null;
      let yc = current;
      if (hasHours && hourlyOk) {
        y = val(scoped.map((r) => upTo(hrs(r, prevDate), cut, frac, wa)));
        if (ok(y)) yc = val(scoped.map((r) => upTo(hrs(r, date), cut, 1, wa))); // zelfde bron als gisteren
      }
      if (!ok(y) && RATIO_IDS.has(id)) y = day(scoped, prevDate);
      list.push({ key: "yesterday", label: "Gisteren zelfde tijd", sub: `t/m ${hhmm(cut, ctx.minute)}`, cur: yc, prev: y, disabled: !ok(y) });
    } else {
      list.push({ key: "prevday", label: dayLabel(prevDate), sub: "hele dag", cur: current, prev: day(scoped, prevDate) });
    }
    const w = data.from <= weekDate ? day(scoped, weekDate) : null;
    list.push({
      key: "week", label: "Vorige week", sub: ctx.isToday && !RATIO_IDS.has(id) ? "hele dag " + shortDate(weekDate) : shortDate(weekDate),
      cur: current, prev: ctx.isToday && !RATIO_IDS.has(id) ? null : w, disabled: !ok(w) || (ctx.isToday && !RATIO_IDS.has(id)), wholeDay: w,
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scoped, current, ctx, hasHours, hourlyOk]);
  const active = comps.find((c) => c.key === cmp && !c.disabled) || comps.find((c) => !c.disabled) || comps[0];

  /* ---------- Grafiek ---------- */
  const chart = useMemo(() => {
    const groups =
      scope === "split"
        ? rows.map((r, i) => ({ name: r.key || r.name, color: colorOf(r.key, i), rows: [r] }))
        : [{ name: scope === "all" ? "Totaal" : (scoped[0] && (scoped[0].key || scoped[0].name)) || "", color: scope === "all" ? "#3987e5" : colorOf(scoped[0] && scoped[0].key, rows.indexOf(scoped[0])), rows: scoped }];
    if (view === "uur") {
      const at = (rs, d, h) =>
        val(rs.map((r) => (cum ? upTo(hrs(r, d), h, 1, wa) : atHour(hrs(r, d), h, wa))));
      const series = groups.map((g) => ({
        name: g.name + (scope !== "split" ? " · " + dayLabel(date) : ""),
        color: g.color,
        values: HOURS.map((_, h) => (ctx.isToday && h > cut ? null : at(g.rows, date, h) ?? null)),
      }));
      if (scope !== "split") {
        series.push({
          name: dayLabel(prevDate), color: PREV_COLOR, dashed: true, muted: true,
          values: HOURS.map((_, h) => at(scoped, prevDate, h) ?? null),
        });
      }
      return { labels: HOURS, series, xEvery: 3, title: (i) => (cum ? `t/m ${HOURS[i].replace(":00", ":59")}` : `${HOURS[i]}–${HOURS[i].replace(":00", ":59")}`) };
    }
    const dates = [];
    for (let d = data.from; d <= date; d = addDays(d, 1)) dates.push(d);
    const series = groups.map((g) => ({
      name: g.name, color: g.color, noFill: scope === "split",
      values: dates.map((d) => day(g.rows, d) ?? null),
    }));
    return { labels: dates.map(shortDate), series, xEvery: 2, title: (i) => dayLabel(dates[i]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, view, cum, scope, scoped, rows, data, wa]);

  /* ---------- Laatste uren (stijgt/daalt per uur) ---------- */
  const lastHours = useMemo(() => {
    if (!hasHours || !hourlyOk) return [];
    const end = ctx.isToday ? cut : 23;
    const out = [];
    for (let h = Math.max(0, end - 5); h <= end; h++) {
      const v = val(scoped.map((r) => atHour(hrs(r, date), h, wa)));
      const p = h > 0 ? val(scoped.map((r) => atHour(hrs(r, date), h - 1, wa))) : null;
      const y = val(scoped.map((r) => atHour(hrs(r, prevDate), h, wa)));
      out.push({ h, v, p, y, live: ctx.isToday && h === cut });
    }
    return out.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scoped, hasHours, hourlyOk, ctx]);

  /* ---------- Per store ---------- */
  const perStore = rows.map((r, i) => {
    const cur = day([r], date);
    let prev = null;
    if (active.key === "hour" || active.key === "yesterday") {
      const rh = hrs(r, date) && (!isAds || wa);
      if (active.key === "hour") {
        prev = rh ? val([upTo(hrs(r, date), cut - 1, frac, wa)]) : null;
        return { r, i, cur: rh ? val([upTo(hrs(r, date), cut, 1, wa)]) : null, prev };
      }
      prev = rh ? val([upTo(hrs(r, prevDate), cut, frac, wa)]) : null;
      if (!ok(prev) && RATIO_IDS.has(id)) prev = day([r], prevDate);
    } else if (active.key === "prevday") prev = day([r], prevDate);
    else if (active.key === "week") prev = day([r], weekDate);
    return { r, i, cur, prev };
  });

  const fmt = m.fmt;
  const axisFmt = m.axis || m.fmt;
  const diffAbs = active && ok(active.cur) && ok(active.prev) ? active.cur - active.prev : null;

  return (
    <div className={"dd-modal-wrap" + (shown ? " in" : "")} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dd-modal" role="dialog" aria-modal="true" aria-label={m.label}>
        <div className="dd-modal-head">
          <div className="dd-modal-tabs">
            {["revenue", "orders", "aov", "cvr", "cost", "roasReal", "roasGoogle", "cpc", "cpm"].map((k) => (
              <button key={k} className={"dd-mtab" + (k === id ? " on" : "")} onClick={() => setId(k)}>{METRIC[k].label}</button>
            ))}
          </div>
          <button className="dd-close" onClick={close} aria-label="Sluiten">×</button>
        </div>

        <div className="dd-modal-hero">
          <div>
            <div className="dd-eyebrow">{m.label} · {dayLabel(date)}{ctx.isToday ? ` t/m ${hhmm(cut, ctx.minute)}` : ""}{scope !== "all" && scope !== "split" ? " · " + (scoped[0] && (scoped[0].key || scoped[0].name)) : ""}</div>
            <div className="dd-big">{fmt(active && (active.key === "hour" || active.key === "yesterday") && ok(active.cur) ? active.cur : current)}</div>
            <div className="dd-hero-sub">
              {active && <Delta big cur={active.cur} prev={active.prev} lowerIsBetter={m.lowerIsBetter} />}
              <span className="muted">
                {active ? `vs ${active.label.toLowerCase()} ${fmt(active.prev)}` : ""}
                {ok(diffAbs) && ADDITIVE.has(id) ? ` · ${diffAbs >= 0 ? "+" : "−"}${id === "orders" ? nf0.format(Math.abs(diffAbs)) : fmt(Math.abs(diffAbs))}` : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Vergelijk met … */}
        <div className="dd-cmp">
          {comps.map((c) => (
            <button key={c.key} disabled={c.disabled} className={"dd-cmp-card" + (active && c.key === active.key ? " on" : "")} onClick={() => setCmp(c.key)}>
              <span className="dd-cmp-label">vs {c.label}</span>
              <span className="dd-cmp-sub">{c.sub}</span>
              <span className="dd-cmp-row">
                <span className="dd-cmp-val">{c.disabled && c.key === "week" && ok(c.wholeDay) ? fmt(c.wholeDay) : fmt(c.prev)}</span>
                {!c.disabled ? <Delta cur={c.cur} prev={c.prev} lowerIsBetter={m.lowerIsBetter} /> : null}
              </span>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="dd-filters">
          <div className="dd-seg">
            <button className={view === "uur" ? "on" : ""} disabled={!hourlyOk} onClick={() => setView("uur")} title={!hourlyOk ? "Ads-uurdata komt zodra het nieuwe Ads-script draait" : ""}>Per uur</button>
            <button className={view === "dag" ? "on" : ""} onClick={() => setView("dag")}>Per dag · 14 d</button>
          </div>
          {view === "uur" && (
            <div className="dd-seg">
              <button className={cum ? "on" : ""} onClick={() => setCum(true)}>{ADDITIVE.has(id) ? "Opgeteld" : "t/m uur"}</button>
              <button className={!cum ? "on" : ""} onClick={() => setCum(false)}>Los per uur</button>
            </div>
          )}
          <div className="dd-seg">
            <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Totaal</button>
            <button className={scope === "split" ? "on" : ""} onClick={() => setScope("split")}>Per store</button>
            {rows.map((r, i) => (
              <button key={r.domain} className={scope === r.domain ? "on" : ""} onClick={() => setScope(r.domain)}>
                <span className="dd-dot" style={{ background: colorOf(r.key, i) }} />{r.key || r.name}
              </button>
            ))}
          </div>
        </div>
        {!hourlyOk && <div className="dd-note">Per uur voor Ads-cijfers verschijnt zodra het nieuwe Ads-script (met tab Ads_…_H) in elk account draait.</div>}

        <div className="dd-modal-chart" key={view + String(cum) + scope + id}>
          <LineChart
            height={260}
            labels={chart.labels}
            xEvery={chart.xEvery}
            fmt={(v, axis) => (axis ? axisFmt(v, true) : fmt(v))}
            tooltipTitle={chart.title}
            series={chart.series}
          />
        </div>

        <div className="dd-modal-grid">
          {lastHours.length > 0 && (
            <div className="dd-mini">
              <div className="dd-mini-title">Laatste uren <span className="muted small">los per uur · vs uur ervoor · vs gisteren</span></div>
              {lastHours.map((x) => (
                <div key={x.h} className="dd-mini-row">
                  <span className="dd-mini-h">{HOURS[x.h]}{x.live ? <span className="dd-livedot sm" /> : null}</span>
                  <span className="dd-mini-v">{fmt(x.v)}</span>
                  <Delta cur={x.v} prev={x.p} lowerIsBetter={m.lowerIsBetter} />
                  <span className="muted small dd-mini-y">gist. {fmt(x.y)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="dd-mini">
            <div className="dd-mini-title">Per store <span className="muted small">vs {active ? active.label.toLowerCase() : ""}</span></div>
            {perStore.map(({ r, i, cur, prev }) => (
              <button key={r.domain} className={"dd-mini-row dd-mini-btn" + (scope === r.domain ? " on" : "")} onClick={() => setScope(scope === r.domain ? "all" : r.domain)}>
                <span className="dd-mini-h"><span className="dd-dot" style={{ background: colorOf(r.key, i) }} />{r.key || r.name}</span>
                <span className="dd-mini-v">{fmt(cur)}</span>
                <Delta cur={cur} prev={prev} lowerIsBetter={m.lowerIsBetter} />
                <span className="muted small dd-mini-y">{fmt(prev)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

