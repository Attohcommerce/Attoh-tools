import "./px.css";

// Pythago Extern (/px) — eigen, witte uitstraling en geen Attoh-navigatie.
// Het scriptje zet de witte stijl op <html> vóór de eerste weergave (geen donkere flits).
export const metadata = {
  title: "Pythago",
  description: "Productprestaties: Google Ads naast Shopify",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: "#ffffff",
};

export default function PxLayout({ children }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('pyx-light')" }} />
      <div className="pyx-root">{children}</div>
    </>
  );
}
