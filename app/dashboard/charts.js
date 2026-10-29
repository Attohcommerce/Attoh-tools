"use client";

// Kleine SVG-grafieken voor het dashboard (geen libraries): een lijngrafiek
// met crosshair + tooltip, en een sparkline voor de KPI-tegels.
import { useEffect, useMemo, useRef, useState } from "react";

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const set = () => setW(Math.max(220, el.clientWidth));
    set();
    if (!("ResizeObserver" in window)) return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Mooie as-stappen: 0 .. max in 4 stappen met ronde getallen. */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/**
 * series: [{ name, color, values: (number|null)[], dashed?, muted? }]
 * labels: string[] (x-as), fmt: getal → tekst, height
 */
export function LineChart({ series, labels, fmt, height = 260, xEvery = 1, tooltipTitle, compact = false }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const gid = useMemo(() => "lcf" + Math.random().toString(36).slice(2, 9), []);
  const pad = compact ? { l: 4, r: 6, t: 6, b: 18 } : { l: 56, r: 16, t: 14, b: 30 };
  const n = labels.length;
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const max = useMemo(() => {
    let m = 0;
    for (const s of series) for (const v of s.values) if (v != null && v > m) m = v;
    return m;
  }, [series]);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - (v / top) * ih;

  const path = (vals) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const area = (vals) => {
    const pts = vals.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (pts.length < 2) return "";
    return `M${pts[0][0]},${pad.t + ih}` + pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("") + `L${pts[pts.length - 1][0]},${pad.t + ih}Z`;
  };

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - pad.l) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const main = series[0];
  const tipLeft = hover == null ? 0 : x(hover);

  return (
    <div className="lc" ref={ref} style={{ height }}>
      <svg
        width={width}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={series.map((s) => s.name).join(" vs ")}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={main ? main.color : "#3987e5"} stopOpacity="0.22" />
            <stop offset="100%" stopColor={main ? main.color : "#3987e5"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="lc-grid" />
            {compact ? null : <text x={pad.l - 10} y={y(t) + 4} className="lc-ylab" textAnchor="end">{fmt(t, true)}</text>}
          </g>
        ))}
        {labels.map((l, i) =>
          i % xEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - (compact ? 3 : 8)} className="lc-xlab" textAnchor={compact && i === 0 ? "start" : compact && i === n - 1 ? "end" : "middle"}>{l}</text>
          ) : null
        )}
        {main && !main.noFill ? <path d={area(main.values)} fill={`url(#${gid})`} /> : null}
        {[...series].reverse().map((s) => (
          <path
            key={s.name}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.muted ? 1.6 : 2.2}
            strokeDasharray={s.dashed ? "5 5" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="lc-cross" />
            {series.map((s) =>
              s.values[hover] == null ? null : (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4.5" fill={s.color} stroke="var(--lc-surface)" strokeWidth="2" />
              )
            )}
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="lc-tip"
          style={{ left: Math.min(Math.max(tipLeft, 90), width - 90), top: 6 }}
        >
          <div className="lc-tip-title">{tooltipTitle ? tooltipTitle(hover) : labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="lc-tip-row">
              <span className="lc-key" style={{ background: s.color }} />
              <span className="lc-tip-name">{s.name}</span>
              <span className="lc-tip-val">{s.values[hover] == null ? "—" : fmt(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mini-lijn voor KPI-tegels: laatste punt gemarkeerd. */
export function Sparkline({ values, color = "#3987e5", height = 34 }) {
  const [ref, width] = useWidth();
  const pts = values.map((v, i) => [i, v]).filter((p) => p[1] != null && Number.isFinite(p[1]));
  if (pts.length < 2) return <div ref={ref} className="sl" style={{ height }} />;
  const max = Math.max(...pts.map((p) => p[1]));
  const min = Math.min(...pts.map((p) => p[1]));
  const span = max - min || 1;
  const n = values.length;
  const x = (i) => 2 + (i / (n - 1)) * (width - 6);
  const y = (v) => 3 + (height - 6) - ((v - min) / span) * (height - 6);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <div ref={ref} className="sl" style={{ height }}>
      <svg width={width} height={height} aria-hidden="true">
        <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
        <circle cx={x(last[0])} cy={y(last[1])} r="3" fill={color} />
      </svg>
    </div>
  );
}
