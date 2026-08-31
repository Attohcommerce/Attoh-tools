/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfjs-dist (Kungfubuy bill-parser) niet door webpack laten bundelen:
  // als extern pakket laden werkt op Vercel én lokaal zonder gedoe met
  // de .mjs-bestanden van pdf.js.
  experimental: {
    serverComponentsExternalPackages: ["pdfjs-dist"],
  },
};

export default nextConfig;
