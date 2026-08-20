"use client";

// STORE DOCTOR — de hele store scannen op systematische fouten en ze met
// één tik fixen, vóórdat Merchant Center ze vindt. De motor (checks, fixes,
// AI-checks) zit in components/DoctorPanel.js en draait óók in de importer
// als "Controles" over een verse import-run.
import { useEffect, useState } from "react";
import Header from "../components/Header";
import DoctorPanel from "../components/DoctorPanel";

const LS_STORES = "sa_stores";
const LS_SELECTED = "sa_selected_store";

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export default function QaPage() {
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    setStores(load(LS_STORES, []));
    setSelected(load(LS_SELECTED, null));
  }, []);

  const store = stores.find((s) => s.domain === selected) || null;

  return (
    <>
      <Header icon="+" title="Store Doctor" subtitle="Checks & 1-tik fixes" />
      <div className="page layout-2col">
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
              Gratis checks: variant-foto's, taal, prijzen &amp; doorstreepprijzen, titels,
              tags/gender, barcodes, vendor, templates, maten-volgorde, zichtbaarheid.
              Daarna optionele AI-checks (geslacht, kleur↔foto, watermerk, taal-restlaag)
              met de kosten vooraf in beeld. Elke fix schrijft eerst een backup-tabblad.
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
