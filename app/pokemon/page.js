"use client";

// ATTOH POKÉMON (07-11-2026) — eigen tool voor de Pokémon-kaartenstore.
// 1 Scraper   → concurrenten toevoegen, met één klik alles van ze ophalen
// 2 Importlijst → wat er in de store moet (2026-lijst of eigen CSV), matchen, importeren
// 3 Importer  → los kiezen, eigen teksten laten schrijven, op "Sold out" in de store
// 3 Doctor    → store nalopen en fixen; voorraad zetten als de levering binnen is
import { useEffect, useState } from "react";
import Link from "next/link";
import { loadStores, LS_PICK, lsGet, lsSet } from "./util";
import StorePicker from "./StorePicker";
import ScraperTab from "./ScraperTab";
import ImporterTab from "./ImporterTab";
import ListTab from "./ListTab";
import DoctorTab from "./DoctorTab";

const TABS = [
  { id: "scraper", n: "01", label: "Scraper" },
  { id: "list", n: "02", label: "Importlijst" },
  { id: "importer", n: "03", label: "Importer (los)" },
  { id: "doctor", n: "04", label: "Store Doctor" },
];

export default function PokemonPage() {
  const [tab, setTab] = useState("scraper");
  const [stores, setStores] = useState([]);
  const [picked, setPickedRaw] = useState("");
  const [toast, setToast] = useState(null);
  const [comps, setComps] = useState([]);

  useEffect(() => {
    setStores(loadStores());
    setPickedRaw(lsGet(LS_PICK, ""));
    const t = lsGet("pk_tab", "scraper");
    if (TABS.some((x) => x.id === t)) setTab(t);
  }, []);

  function setPicked(d) {
    setPickedRaw(d);
    lsSet(LS_PICK, d);
  }
  function go(t) {
    setTab(t);
    lsSet("pk_tab", t);
  }
  function notify(msg, err = false) {
    setToast({ msg, err });
    clearTimeout(notify._t);
    notify._t = setTimeout(() => setToast(null), 3800);
  }

  const store = stores.find((s) => s.domain === picked) || null;

  return (
    <>
      <header className="pk-top">
        <Link href="/" className="pk-back">
          ← Attoh Tools
        </Link>
        <div className="pk-brand">
          <span className="pk-ball" />
          Attoh Pokémon
        </div>
        <nav className="pk-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={"pk-tab" + (tab === t.id ? " on" : "")} onClick={() => go(t.id)}>
              <span className="n">{t.n}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <span className="pk-spacer" />
        <StorePicker stores={stores} setStores={setStores} picked={picked} setPicked={setPicked} />
      </header>

      <main className="pk-main">
        {tab === "scraper" && <ScraperTab notify={notify} comps={comps} setComps={setComps} goImport={() => go("importer")} />}
        {tab === "list" && <ListTab notify={notify} store={store} goDoctor={() => go("doctor")} />}
        {tab === "importer" && <ImporterTab notify={notify} store={store} goScraper={() => go("scraper")} goDoctor={() => go("doctor")} />}
        {tab === "doctor" && <DoctorTab notify={notify} store={store} />}
      </main>

      {toast && <div className={"pk-toast" + (toast.err ? " err" : "")}>{toast.msg}</div>}
    </>
  );
}
