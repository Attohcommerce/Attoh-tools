"use client";

// STORE DOCTOR — de hele store scannen op systematische fouten en ze met
// één tik fixen, vóórdat Merchant Center ze vindt. De motor (checks, fixes,
// AI-checks) zit in components/DoctorPanel.js en draait óók in de importer
// als "Controles" over een verse import-run.
import { useEffect, useState } from "react";
import Header from "../components/Header";
import DoctorPanel from "../components/DoctorPanel";
import AllStoresDoctor from "../components/AllStoresDoctor";
import { orgLS } from "@/lib/org-client";
import { useOrgDef } from "../components/OrgProvider";

const LS_STORES = "sa_stores";
const LS_SELECTED = "sa_selected_store";
const LS_ALLVIEW = "sa_doctor_allview";

function load(key, fallback) {
  try {
    const v = orgLS.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export default function QaPage() {
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);
  // 31-10: "Alle stores" — scan / fix alle gekoppelde stores in één run
  const [showAll, setShowAll] = useState(false);
  // Organisatie (20-10): Sa Collective = alleen laatste producten, zonder maattabellen
  const orgDoc = useOrgDef().doctor;

  useEffect(() => {
    setStores(load(LS_STORES, []));
    setSelected(load(LS_SELECTED, null));
    try {
      setShowAll(orgLS.getItem(LS_ALLVIEW) === "1");
    } catch {}
  }, []);

  function toggleAll() {
    setShowAll((v) => {
      try {
        orgLS.setItem(LS_ALLVIEW, v ? "0" : "1");
      } catch {}
      return !v;
    });
  }
  function openStore(domain) {
    setSelected(domain);
    try {
      orgLS.setItem(LS_SELECTED, JSON.stringify(domain));
    } catch {}
    setTimeout(() => {
      const el = document.getElementById("sd-single");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  const store = stores.find((s) => s.domain === selected) || null;

  return (
    <>
      <Header icon="+" title="Store Doctor" subtitle="Checks & 1-tik fixes" />
      <div className="page">
        <div className="sd-topbar">
          <div>
            <div className="sd-eyebrow">Alle stores in één keer</div>
            <div className="sd-topbar__txt">
              Controleer koppeling, valuta en markt van elke store, scan ze allemaal en laat FIX ALLES per store achter elkaar lopen.
            </div>
          </div>
          <button type="button" className={`sd-btn ${showAll ? "sd-btn--ghost" : "sd-btn--gold"}`} onClick={toggleAll} disabled={!stores.length}>
            {showAll ? "Verberg alle stores" : "⚡ Scan alle stores"}
          </button>
        </div>
        {showAll && stores.length > 0 && (
          <div className="card sd-allcard">
            <AllStoresDoctor stores={stores} onOpenStore={openStore} />
          </div>
        )}
      </div>
      <div className="page layout-2col" id="sd-single">
        <div>
          <div className="card">
            <h2>Store</h2>
            {stores.length === 0 && (
              <div className="center-note">Koppel eerst een store in de Importer.</div>
            )}
            {stores.map((s) => (
              <div
                key={s.domain}
                className={"store-item" + (selected === s.domain ? " selected" : "")}
                onClick={() => setSelected(s.domain)}
              >
                <div>
                  <strong>{s.name}</strong> <span className="muted small">({s.currency})</span>
                </div>
                <div className="dom">{s.domain}</div>
              </div>
            ))}
            <div className="hint">
              {orgDoc.latestOnly ? (
                <>
                  Sa Collective: de Doctor kijkt alleen naar de <strong>laatste … producten</strong> (nieuw
                  toegevoegd, actief + draft). Gratis checks: variant-foto's, taal, prijzen &amp; doorstreepprijzen,
                  titels, tags/gender, barcodes, vendor, templates, maten-volgorde, zichtbaarheid.
                  Maattabellen blijven buiten beschouwing. Daarna optionele AI-checks (geslacht, kleur↔foto,
                  watermerk, taal-restlaag) met de kosten vooraf in beeld. Elke fix schrijft eerst een backup-tabblad.
                </>
              ) : (
                <>
                  Gratis checks: variant-foto's, taal, prijzen &amp; doorstreepprijzen, titels,
                  tags/gender, barcodes, vendor, templates, maten-volgorde, zichtbaarheid,
                  maattabellen (ontbreekt / past niet bij de productsoort).
                  Daarna optionele AI-checks (geslacht, kleur↔foto, watermerk, taal-restlaag)
                  met de kosten vooraf in beeld. Elke fix schrijft eerst een backup-tabblad.
                </>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ minHeight: 320 }}>
            <h2>Controle &amp; fixes</h2>
            {!store && <div className="center-note">Kies links een store.</div>}
            {store && <DoctorPanel store={store} />}
          </div>
        </div>
      </div>
    </>
  );
}
