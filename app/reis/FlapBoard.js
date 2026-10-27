"use client";

import { useEffect, useState } from "react";

// Vertrekbord: rijen klapperen (split-flap) door bestemmingen heen.
const ROWS = [
  ["PHUKET", "13N", "1.167"],
  ["DUBAI", "8N", "1.284"],
  ["CURACAO", "13N", "1.690"],
  ["BODRUM", "10N", "943"],
  ["BALI", "16N", "1.512"],
  ["MALDIVEN", "9N", "2.150"],
  ["HURGHADA", "13N", "1.021"],
  ["SANTORINI", "7N", "1.098"],
  ["MAURITIUS", "14N", "1.940"],
  ["KRETA", "11N", "896"],
  ["CANCUN", "13N", "1.733"],
  ["ZANZIBAR", "12N", "1.455"],
];
const W = { city: 10, nights: 3, price: 6 };
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.";
const pad = (s, n, right) => (right ? String(s).padStart(n, " ") : String(s).padEnd(n, " ")).slice(0, n);
const rowText = (r) => pad(r[0], W.city) + pad(r[1], W.nights, true) + "€" + pad(r[2], W.price, true);

function useFlapBoard(count) {
  const [idx, setIdx] = useState(() => Array.from({ length: count }, (_, i) => i));
  const [shown, setShown] = useState(() => Array.from({ length: count }, (_, i) => rowText(ROWS[i])));
  useEffect(() => {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let row = 0;
    let timers = [];
    const flipRow = (r, nextIdx) => {
      const target = rowText(ROWS[nextIdx]);
      if (reduce) {
        setShown((s) => s.map((x, i) => (i === r ? target : x)));
        return;
      }
      const start = performance.now();
      const tick = setInterval(() => {
        const t = performance.now() - start;
        setShown((s) =>
          s.map((x, i) => {
            if (i !== r) return x;
            return target
              .split("")
              .map((ch, k) => {
                const doneAt = 120 + k * 38;
                if (t >= doneAt) return ch;
                if (ch === " " && x[k] === " ") return " ";
                return CHARS[Math.floor(Math.random() * CHARS.length)];
              })
              .join("");
          })
        );
        if (t > 120 + target.length * 38 + 40) clearInterval(tick);
      }, 55);
      timers.push(tick);
    };
    const loop = setInterval(() => {
      setIdx((cur) => {
        const used = new Set(cur);
        let n = (Math.max(...cur) + 1) % ROWS.length;
        while (used.has(n)) n = (n + 1) % ROWS.length;
        const next = cur.map((v, i) => (i === row ? n : v));
        flipRow(row, n);
        row = (row + 1) % count;
        return next;
      });
    }, 2400);
    return () => { clearInterval(loop); timers.forEach(clearInterval); };
  }, [count]);
  return { idx, shown };
}

export default function FlapBoard({ rows = 4 }) {
  const { shown } = useFlapBoard(rows);
  return (
    <div className="rp-board" aria-hidden="true">
      <div className="rp-board-head">
        <span>Bestemming</span><span>Nachten</span><span>Samen</span>
      </div>
      {shown.map((txt, r) => (
        <div className="rp-board-row" key={r}>
          {txt.split("").map((ch, k) => (
            <span key={k} className={"rp-flap" + (k === W.city + W.nights ? " eur" : "") + (k === W.city || k === W.city + W.nights ? " gap" : "")}>
              {ch === " " ? "\u00a0" : ch}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
