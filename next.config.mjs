/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfjs-dist (Kungfubuy bill-parser) niet door webpack laten bundelen:
  // als extern pakket laden werkt op Vercel én lokaal zonder gedoe met
  // de .mjs-bestanden van pdf.js.
  experimental: {
    serverComponentsExternalPackages: ["pdfjs-dist"],
    // Extra zekerheid bovenop de expliciete worker-import in lib/bills.js:
    // neem de hele pdfjs legacy-build mee in de bundel van de parse-route,
    // zodat "Cannot find module …/pdf.worker.mjs" nooit meer kan optreden.
    outputFileTracingIncludes: {
      "/api/bills/parse": ["./node_modules/pdfjs-dist/legacy/build/**"],
    },
  },
};

export default nextConfig;
