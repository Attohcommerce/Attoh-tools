import "./reis.css";
import { getReisSession } from "@/lib/reis/session";
import ReisSound from "./ReisSound";

export const metadata = {
  title: "Attoh Ultra Reisplanner",
  description: "De goedkoopste losse vakantie: vlucht en hotel apart vergeleken",
  // Op de telefoon: "Zet op beginscherm" → opent als eigen app met icoon
  manifest: "/reis-manifest.json",
  icons: { icon: "/reis-icon-192.png", apple: "/reis-icon-180.png" },
  appleWebApp: { capable: true, title: "Reisplanner", statusBarStyle: "default" },
};

export const viewport = { themeColor: "#121830" };

export const dynamic = "force-dynamic";

// Eigen jasje voor de reisplanner: thema per gebruiker (Justin = wit,
// Quinty = roze), eigen lettertype. Staat over de donkere Attoh Tools-
// achtergrond heen (.rp is fixed full-screen met eigen achtergrond).
export default async function ReisLayout({ children }) {
  const s = await getReisSession();
  const theme = (s.user && s.user.theme) || "wit";
  return (
    <div className="rp" data-theme={theme}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&display=swap"
      />
      <ReisSound />
      {children}
    </div>
  );
}
