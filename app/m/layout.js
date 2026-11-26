// Dashboard Mobiel (/m) — geen Attoh-navigatie, klaar om op het beginscherm te zetten.
export const metadata = {
  title: "Attoh Dashboard",
  description: "Omzet · Ads · ROAS",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Dashboard", statusBarStyle: "black-translucent" },
};

export const viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function MLayout({ children }) {
  return <div className="ddm-root">{children}</div>;
}
