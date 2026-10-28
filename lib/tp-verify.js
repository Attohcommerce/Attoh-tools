// Verificatiepagina voor Travelpayouts (28-10-2026) — geserveerd door de
// middleware op /tp. Travelpayouts geeft pas een API-token (vluchtprijzen
// voor de reisplanner) als hun "Drive"-script in de <head> staat; hun checker
// leest de ruwe HTML. Het script staat ALLEEN op /tp — niet in de reisplanner
// of de store-tools.
export const TP_VERIFY_HTML = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Attoh</title>
<script nowprocket data-noptimize="1" data-cfasync="false" data-wpfc-render="false" seraph-accel-crit="1" data-no-defer="1" data-cmp-ab="2">
  (function () {
      var script = document.createElement("script");
      script.async = 1;
      script.setAttribute("data-cmp-ab","2");
      script.src = 'https://tpembars.com/NTkyNDM1.js?t=592435';
      document.head.appendChild(script);
  })();
</script>
</head>
<body style="font-family:system-ui,sans-serif;color:#888;display:grid;place-items:center;min-height:100vh;margin:0">
<p>Attoh Tools</p>
</body>
</html>`;
