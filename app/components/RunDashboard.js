"use client";

/* RUN-DASHBOARD (Store Doctor, 31-10-2026)
   Live overzicht van wat de Doctor op dit moment doet: fase-balk
   (Scan → Fixes → AI → Eindscan), de huidige stap met voortgang, tijd en
   verwachte resttijd, tellers en een live logboek. Plakt bovenaan in beeld
   (sticky) zodat je ook tijdens het scrollen ziet waar hij is.

   useRun() geeft { run, api } — api.start/phase/step/progress/log/finish —
   zodat elk scherm (één store of alle stores) hetzelfde dashboard voedt. */

import { useCallback, useEffect, useRef, useState } from "react";

export const PHASES_STORE = [
  { key: "scan", label: "Scan" },
  { key: "fixes", label: "Fixes" },
  { key: "ai", label: "AI-controles" },
  { key: "final", label: "Eindscan" },
];

const EMPTY = null;

export function useRun() {
  const [run, setRun] = useState(EMPTY);
  const seq = useRef(0);
  const api = useRef(null);
  if (!api.current) {
    const upd = (fn) => setRun((r) => (r ? fn(r) : r));
    api.current = {
      start(title, opts = {}) {
        const now = Date.now();
        setRun({
          title,
          sub: opts.sub || "",
          phases: opts.phases || PHASES_STORE,
          phase: opts.phases && opts.phases[0] ? opts.phases[0].key : "scan",
          phaseLabel: "",
          step: null, // { label, i, of, done, total, unit, at }
          counts: { fixed: 0, skipped: 0, failed: 0 },
          usd: 0,
          startedAt: now,
          status: "busy", // busy | done | paused | error
          feed: [],
          store: opts.store || null, // { i, of, name } bij alle stores
        });
      },
      sub(text) {
        upd((r) => ({ ...r, sub: text }));
      },
      store(i, of, name) {
        upd((r) => ({ ...r, store: { i, of, name } }));
      },
      phase(key, label) {
        upd((r) => ({ ...r, phase: key, phaseLabel: label || "", step: null }));
      },
      step(label, extra = {}) {
        upd((r) => ({ ...r, step: { label, i: extra.i || 0, of: extra.of || 0, done: 0, total: extra.total || 0, unit: extra.unit || "producten", at: Date.now() } }));
      },
      progress(done, total) {
        upd((r) => (r.step ? { ...r, step: { ...r.step, done, total: total != null ? total : r.step.total } } : r));
      },
      count(delta) {
        upd((r) => ({
          ...r,
          counts: {
            fixed: r.counts.fixed + (delta.fixed || 0),
            skipped: r.counts.skipped + (delta.skipped || 0),
            failed: r.counts.failed + (delta.failed || 0),
          },
        }));
      },
      usd(v) {
        upd((r) => ({ ...r, usd: v }));
      },
      log(text, kind = "info") {
        const id = ++seq.current;
        upd((r) => ({ ...r, feed: [{ id, at: Date.now(), text: String(text), kind }, ...r.feed].slice(0, 60) }));
      },
      finish(status = "done", label) {
        upd((r) => ({ ...r, status, phase: "done", phaseLabel: label || (status === "paused" ? "Gepauzeerd" : status === "error" ? "Gestopt" : "Klaar"), step: null, endedAt: Date.now() }));
      },
      clear() {
        setRun(EMPTY);
      },
    };
  }
  return { run, api: api.current };
}

function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}u ${String(m % 60).padStart(2, "0")}m`;
}
function clock(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export default function RunDashboard({ run, onPause, onClose, pausing }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!run || run.status !== "busy") return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [run && run.status]);
  const [showFeed, setShowFeed] = useState(true);
  if (!run) return null;

  const now = run.endedAt || Date.now();
  const busy = run.status === "busy";
  const phases = run.phases || PHASES_STORE;
  const pIdx = run.phase === "done" ? phases.length : Math.max(0, phases.findIndex((p) => p.key === run.phase));
  const st = run.step;
  const pct = st && st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : null;
  let eta = null;
  if (st && st.total && st.done > 0 && st.done < st.total) {
    const el = Date.now() - st.at;
    eta = (el / st.done) * (st.total - st.done);
  }
  const statusTxt = busy ? (pausing ? "Pauzeert na deze stap…" : "Bezig") : run.status === "paused" ? "Gepauzeerd" : run.status === "error" ? "Gestopt" : "Klaar";

  return (
    <div className={`sd-run ${busy ? "is-busy" : `is-${run.status}`}`}>
      <div className="sd-run__head">
        <div className="sd-run__pulse" aria-hidden="true" />
        <div className="sd-run__titles">
          <div className="sd-run__eyebrow">
            {statusTxt}
            {run.store ? ` · store ${run.store.i} van ${run.store.of}` : ""}
          </div>
          <div className="sd-run__title">{run.title}</div>
          {run.sub ? <div className="sd-run__sub">{run.sub}</div> : null}
        </div>
        <div className="sd-run__time">
          <span className="sd-run__time-big">{fmtDur(now - run.startedAt)}</span>
          <span className="sd-run__time-lbl">looptijd</span>
        </div>
        {busy && onPause ? (
          <button type="button" className="sd-btn sd-btn--ghost" onClick={onPause} disabled={pausing}>
            {pausing ? "Pauzeert…" : "⏸ Pauzeer"}
          </button>
        ) : null}
        {!busy && onClose ? (
          <button type="button" className="sd-btn sd-btn--ghost" onClick={onClose}>
            Sluit
          </button>
        ) : null}
      </div>

      <ol className="sd-steps">
        {phases.map((p, i) => (
          <li key={p.key} className={i < pIdx ? "done" : i === pIdx && busy ? "now" : ""}>
            <span className="sd-steps__dot">{i < pIdx ? "✓" : i + 1}</span>
            <span className="sd-steps__lbl">{p.label}</span>
          </li>
        ))}
      </ol>

      <div className="sd-run__now">
        <div className="sd-run__now-top">
          <span className="sd-run__now-lbl">
            {st ? (
              <>
                {st.of > 1 ? <span className="sd-chip">stap {st.i}/{st.of}</span> : null}
                {st.label}
              </>
            ) : busy ? (
              run.phaseLabel || "Bezig…"
            ) : (
              run.phaseLabel || statusTxt
            )}
          </span>
          {st && st.total ? (
            <span className="sd-run__now-num">
              {st.done}/{st.total} {st.unit}
              {eta != null ? <span className="sd-muted"> · nog ±{fmtDur(eta)}</span> : null}
            </span>
          ) : null}
        </div>
        <div className="sd-bar">
          <div
            className={`sd-bar__fill${busy ? " live" : ""}${pct == null && busy ? " indet" : ""}`}
            style={{ width: pct != null ? `${pct}%` : busy ? "35%" : "100%" }}
          />
        </div>
      </div>

      <div className="sd-run__tiles">
        <div className="sd-tile sd-tile--ok">
          <span className="sd-tile__num">{run.counts.fixed}</span>
          <span className="sd-tile__lbl">aangepast</span>
        </div>
        <div className="sd-tile">
          <span className="sd-tile__num">{run.counts.skipped}</span>
          <span className="sd-tile__lbl">al goed / overgeslagen</span>
        </div>
        <div className={`sd-tile${run.counts.failed ? " sd-tile--err" : ""}`}>
          <span className="sd-tile__num">{run.counts.failed}</span>
          <span className="sd-tile__lbl">mislukt</span>
        </div>
        <div className="sd-tile">
          <span className="sd-tile__num">${(run.usd || 0).toFixed(2)}</span>
          <span className="sd-tile__lbl">AI-kosten</span>
        </div>
      </div>

      <div className="sd-feed">
        <button type="button" className="sd-feed__toggle" onClick={() => setShowFeed((v) => !v)}>
          {showFeed ? "▾" : "▸"} Live logboek <span className="sd-muted">({run.feed.length})</span>
        </button>
        {showFeed && (
          <div className="sd-feed__list">
            {run.feed.length === 0 && <div className="sd-feed__row sd-muted">Wacht op de eerste stap…</div>}
            {run.feed.map((f) => (
              <div key={f.id} className={`sd-feed__row is-${f.kind}`}>
                <span className="sd-feed__t">{clock(f.at)}</span>
                <span className="sd-feed__i">{f.kind === "ok" ? "✓" : f.kind === "err" ? "✗" : f.kind === "warn" ? "!" : "›"}</span>
                <span className="sd-feed__x">{f.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Kleine score-ring (0–10) */
export function ScoreRing({ score, size = 76 }) {
  const s = Math.max(0, Math.min(10, Number(score) || 0));
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const col = s >= 8.5 ? "var(--ok)" : s >= 6.5 ? "var(--warn)" : "var(--err)";
  return (
    <div className="sd-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(s / 10) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray .8s cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <span className="sd-ring__val" style={{ color: col }}>
        {String(s).replace(".", ",")}
      </span>
    </div>
  );
}

export function useStableCallback(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a) => ref.current(...a), []);
}
