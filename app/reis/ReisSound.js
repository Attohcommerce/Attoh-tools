"use client";

// Eigen geluiden voor de Reisplanner — niks van het Attoh Tools-getik.
// Zachte "pop" bij klikken, een vliegtuig-"bing-bong" als de resultaten
// binnen zijn, een whoosh bij het opstijgen (zoeken), een plopje bij een
// hartje en een vrolijk akkoordje bij bewaren. Alles live gesynthetiseerd
// (Web Audio), geen bestanden. Aan/uit-knop in de topbar.
import { useEffect } from "react";

const LS_KEY = "attoh_reis_sound";
let ctx = null;
let master = null;

export function reisSoundOn() {
  try { return window.localStorage.getItem(LS_KEY) !== "off"; } catch { return true; }
}
export function setReisSound(on) {
  try { window.localStorage.setItem(LS_KEY, on ? "on" : "off"); } catch {}
}

function ensure() {
  if (typeof window === "undefined") return false;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return true;
}

// Zachte bel-toon (sinus + boventoon, lange uitklank) — klinkt als een
// cabine-chime / marimba in plaats van een UI-tik.
function bell(freq, { when = 0, dur = 0.6, vol = 0.5 } = {}) {
  const t0 = ctx.currentTime + when;
  for (const [mult, v] of [[1, 1], [2, 0.18], [3, 0.06]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * mult, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol * v, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / mult);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

// Bubbel-pop: korte sinus die snel omhoog glijdt.
function pop(from, to, { when = 0, dur = 0.07, vol = 0.35 } = {}) {
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(from, t0);
  o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

// Whoosh: gefilterde ruis die omhoog zwiept (opstijgen).
function whoosh({ dur = 0.9, vol = 0.25 } = {}) {
  const t0 = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(300, t0);
  f.frequency.exponentialRampToValueAtTime(2600, t0 + dur * 0.85);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur);
}

const SOUNDS = {
  click: () => pop(520, 880, { vol: 0.22, dur: 0.06 }),
  toggle: () => { pop(600, 900, { vol: 0.2 }); pop(900, 1300, { vol: 0.16, when: 0.06 }); },
  takeoff: () => whoosh(),
  // klassieke cabine-chime: hoog → laag
  chime: () => { bell(1046.5, { vol: 0.42, dur: 1.1 }); bell(830.6, { vol: 0.42, dur: 1.4, when: 0.42 }); },
  heart: () => { pop(700, 1400, { vol: 0.3, dur: 0.08 }); pop(1100, 1900, { vol: 0.2, dur: 0.07, when: 0.07 }); },
  nope: () => pop(500, 260, { vol: 0.22, dur: 0.12 }),
  save: () => { bell(784, { vol: 0.32, dur: 0.5 }); bell(988, { vol: 0.3, dur: 0.5, when: 0.08 }); bell(1175, { vol: 0.32, dur: 0.9, when: 0.16 }); },
  error: () => { bell(330, { vol: 0.35, dur: 0.5 }); bell(262, { vol: 0.35, dur: 0.7, when: 0.18 }); },
  // geboekt! — vrolijk loopje omhoog
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => bell(f, { vol: 0.32, dur: 0.6, when: i * 0.09 })); bell(1319, { vol: 0.34, dur: 1.4, when: 0.4 }); },
  check: () => pop(880, 1320, { vol: 0.18, dur: 0.05 }),
  hello: () => { bell(659, { vol: 0.3, dur: 0.6 }); bell(880, { vol: 0.3, dur: 0.6, when: 0.1 }); bell(1319, { vol: 0.28, dur: 1.1, when: 0.2 }); },
};

export function rsfx(name) {
  if (!reisSoundOn()) return;
  if (!ensure()) return;
  const fn = SOUNDS[name];
  if (fn) { try { fn(); } catch {} }
}

// Globale klik-pop binnen de reisplanner (Attoh Tools-geluid slaat .rp over).
export default function ReisSound() {
  useEffect(() => {
    const onClick = (e) => {
      const t = e.target.closest(".rp button, .rp a, .rp .rp-switch");
      if (!t || t.hasAttribute("data-sfx")) return; // eigen geluid
      rsfx("click");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
