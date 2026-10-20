import "./globals.css";
import SoundFX from "./components/sfx";
import { OrgProvider } from "./components/OrgProvider";
import { getOrg } from "@/lib/org-server";

export const metadata = {
  title: "Attoh Tools",
  description: "Scrape · AI Generate · Upload",
};

export const viewport = {
  themeColor: "#0a0a0c",
};

export default function RootLayout({ children }) {
  // Organisatie uit de cookie (lib/org.js): stuurt nav, tools, kleur en
  // welke Shopify-koppelingen/geheugen de pagina's gebruiken.
  const org = getOrg();
  return (
    <html lang="nl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body data-org={org}>
        <SoundFX />
        <OrgProvider org={org}>{children}</OrgProvider>
      </body>
    </html>
  );
}
