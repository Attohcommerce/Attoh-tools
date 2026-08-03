import "./globals.css";

export const metadata = {
  title: "Shopify Product Importer",
  description: "Scrape · AI Generate · Upload",
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
