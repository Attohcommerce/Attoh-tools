// Verificatiepagina voor Travelpayouts (28-10-2026).
// Travelpayouts geeft pas een API-token (vluchtprijzen voor de reisplanner)
// als hun "Drive"-script op de site staat. Het script staat ALLEEN op deze
// lege, openbare pagina — niet in de reisplanner of de store-tools.
import Script from "next/script";

export const metadata = { title: "Attoh", robots: { index: false, follow: false } };

export default function TravelpayoutsVerify() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#888", fontSize: 14 }}>
      <p>Attoh Tools</p>
      <Script id="tp-drive" strategy="afterInteractive">{`
        (function () {
          var script = document.createElement("script");
          script.async = 1;
          script.setAttribute("data-cmp-ab", "2");
          script.src = 'https://tpembars.com/NTkyNDM1.js?t=592435';
          document.head.appendChild(script);
        })();
      `}</Script>
    </main>
  );
}
