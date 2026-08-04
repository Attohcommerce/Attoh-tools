"use client";

// Attoh Tools geluidssysteem — Web Audio API, geen bestanden nodig.
// Alle klanken worden live gesynthetiseerd: korte, cleane UI-tonen.

import { useEffect } from "react";

let ctx = null;
let master = null;

const LS_KEY = "attoh_sound";

export function isSoundOn() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(LS_KEY) !== "off";
}

export function setSoundOn(on) {
  try {
    window.localStorage.setItem(LS_KEY, on ? "on" : "off");
  } catch {}
}

function ensure() {
  if (typeof window === "undefined") return false;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16; // totaalvolume — bewust bescheiden
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return true;
}

function tone({ freq = 880, to = null, time = 0.06, type = "sine", vol = 1, when = 0 }) {
  if (!ensure()) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + time);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + time);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + time + 0.03);
}

const SOUNDS = {
  // korte tik bij elke klik
  click: () => tone({ freq: 2100, to: 1350, time: 0.045, type: "triangle", vol: 0.5 }),
  // heel zacht blipje bij hover over een module
  hover: () => tone({ freq: 2700, time: 0.028, type: "sine", vol: 0.16 }),
  // schakelaar aan/uit
  toggle: () => {
    tone({ freq: 1200, time: 0.04, type: "triangle", vol: 0.4 });
    tone({ freq: 1800, time: 0.05, type: "triangle", vol: 0.3, when: 0.045 });
  },
  // één product gelukt — subtiel duo-tikje omhoog
  ok: () => {
    tone({ freq: 1046, time: 0.06, type: "sine", vol: 0.35 });
    tone({ freq: 1568, time: 0.09, type: "sine", vol: 0.28, when: 0.06 });
  },
  // hele run klaar — klein akkoordje
  success: () => {
    tone({ freq: 880, time: 0.09, type: "sine", vol: 0.32 });
    tone({ freq: 1174.7, time: 0.1, type: "sine", vol: 0.3, when: 0.09 });
    tone({ freq: 1568, time: 0.16, type: "sine", vol: 0.3, when: 0.18 });
  },
  // fout — lage dubbele zoem
  error: () => {
    tone({ freq: 208, time: 0.13, type: "square", vol: 0.2 });
    tone({ freq: 156, time: 0.18, type: "square", vol: 0.17, when: 0.1 });
  },
  // opstart-veeg (homepage)
  boot: () => {
    tone({ freq: 320, to: 1280, time: 0.5, type: "sine", vol: 0.22 });
    tone({ freq: 1568, time: 0.14, type: "sine", vol: 0.2, when: 0.42 });
  },
};

export function sfx(name) {
  if (!isSoundOn()) return;
  const fn = SOUNDS[name];
  if (fn) {
    try {
      fn();
    } catch {}
  }
}

/**
 * Globale geluidslaag: één keer mounten in layout.
 * - klik-tik op alle knoppen/links/switches (event delegation)
 * - hover-blip op module-nodes en navigatie
 * - luistert naar custom events: window.dispatchEvent(new CustomEvent("attoh-sfx", {detail:"ok"}))
 */
export default function SoundFX() {
  useEffect(() => {
    let lastHover = null;

    const onClick = (e) => {
      const t = e.target.closest(
        "button, a, .switch, .store-item, .seg button, .hud-sync"
      );
      if (t) sfx("click");
    };

    const onOver = (e) => {
      const t = e.target.closest(".mod-node, .mod, .onode, .navlink");
      if (t && t !== lastHover) {
        lastHover = t;
        sfx("hover");
      } else if (!t) {
        lastHover = null;
      }
    };

    const onCustom = (e) => sfx(e.detail);

    document.addEventListener("click", onClick, true);
    document.addEventListener("mouseover", onOver, true);
    window.addEventListener("attoh-sfx", onCustom);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mouseover", onOver, true);
      window.removeEventListener("attoh-sfx", onCustom);
    };
  }, []);

  return null;
}
