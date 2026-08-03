import "./globals.css";
import SoundFX from "./components/sfx";

export const metadata = {
  title: "Attoh Tools",
  description: "Scrape · AI Generate · Upload",
};

export const viewport = {
  themeColor: "#0a0a0c",
};

export default function RootLayout({ children }) {
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
      <body>
        <SoundFX />
        {children}
      </body>
    </html>
  );
}
