// Kleine confetti-knal (canvas, geen library). Respecteert "minder beweging".
export function confetti(opts = {}) {
  if (typeof window === "undefined") return;
  // Quinty's roze thema krijgt roze/gouden confetti
  const roze = document.querySelector(".rp[data-theme='roze']");
  const colors = opts.colors || (roze ? ["#e0457b", "#ff8fb5", "#ffd1e1", "#f5b72b", "#ffffff"] : ["#f5b72b", "#e0457b", "#2160e8", "#0f9d7a", "#ffffff"]);
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  document.body.appendChild(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: 160 }, (_, i) => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.55,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 16 - 6,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[i % colors.length],
  }));
  const t0 = performance.now();
  function frame(t) {
    const age = t - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.42;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 2600);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (age < 2700) requestAnimationFrame(frame);
    else c.remove();
  }
  requestAnimationFrame(frame);
}
