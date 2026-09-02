"use client";

// SIZE GUIDE — maattabellen voor élk product: AliExpress-leverancierstabel
// (gevonden op foto) → genormaliseerd naar de doelmarkt → metafield
// custom.size_guide, getoond door de theme-snippet (theme/snippets/size-guide.liquid).
// Motor in components/SizeGuidePanel.js; spec: maattabel-module-spec.md.
import { useEffect, useState } from "react";
import Header from "../components/Header";
import SizeGuidePanel from "../components/SizeGuidePanel";

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

export default function SizeGuidePage() {
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    setStores(load(LS_STORES, []));
    setSelected(load(LS_SELECTED, null));
  }, []);

  const store = stores.find((s) => s.domain === selected) || null;

  return (
    <>
      <Header icon="≡" title="Size Guide" subtitle="Maattabellen per product" />
      <div className="page layout-2col">
        <div>
          <div className="card">
            <h2>Store</h2>
            {stores.length === 0 && <div className="center-note">Koppel eerst een store in de Importer.</div>}
            {stores.map((s) => (
              <div key={s.domain} className={"store-item" + (selected === s.domain ? " selected" : "")} onClick={() => setSelected(s.domain)}>
                <div>
                  <strong>{s.name}</strong> <span className="muted small">({s.currency})</span>
                </div>
                <div className="dom">{s.domain}</div>
              </div>
            ))}
            <div className="hint">
              Per product: hoofdfoto → AliExpress search-by-image → AI kiest de match → de
              leverancierstabel wordt opgehaald, omgerekend naar de doelmarkt en uitgelijnd op de
              variantmaten. Groen/amber/standaard gaan direct de store in (metafield
              custom.size_guide); rood blijft in de review-lijst. Elke write staat in een
              logtabblad. De storefront toont de tabel via de snippet in theme/snippets/.
            </div>
          </div>
        </div>
        <div>
          <div className="card" style={{ minHeight: 320 }}>
            <h2>Maattabellen</h2>
            {!store && <div className="center-note">Kies links een store.</div>}
            {store && <SizeGuidePanel store={store} />}
          </div>
        </div>
      </div>
    </>
  );
}
