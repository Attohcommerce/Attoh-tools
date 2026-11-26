import "./px.css";

// Pythago Extern (/px) — eigen, witte uitstraling en geen Attoh-navigatie.
// Het scriptje zet de gekozen stijl (licht of donker, onthouden per browser) op <html> vóór de eerste weergave.
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
      <script dangerouslySetInnerHTML={{ __html: "(function(){var t='light';try{t=localStorage.getItem('pyx-theme')||'light'}catch(e){}document.documentElement.classList.add(t==='dark'?'pyx-dark':'pyx-light')})()" }} />
      <div className="pyx-root">{children}</div>
    </>
  );
}
