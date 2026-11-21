"use client";

// CHAIM GENERAL STORES (19-11-2026) — main unit en main source voor alles
// rond Chaims general store(s). Alleen zichtbaar in Sa Collective. Rood
// accent, zodat je meteen ziet dat je hier zit (goud = Attoh, blauw = Sa
// Collective). Alles wat je hier afvinkt of opschrijft staat in Redis
// (lib/general-stores.js) en is dus op elk apparaat hetzelfde.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Header from "../components/Header";

const PHASES = [
  {
    id: "thema",
    n: "01",
    title: "Thema",
    steps: [
      ["thema-refs", "Thema-referenties vastleggen (thomler.com en een tweede referentie)"],
      ["thema-analyse", "Per referentie opbouw ontleden: header, homepage, productpagina, cart"],
      ["thema-menu", "Megamenu met foto's, kolommen en aantallen per collectie"],
      ["thema-colimg", "Elke collectie een mooie foto (mooi product of Higgsfield, één stijl)"],
      ["thema-hero", "Hero: eigen foto via Higgsfield, daarna video van die foto"],
      ["thema-zoek", "Sterke zoekfunctie (general store = veel zoekende klanten)"],
      ["thema-home", "Homepage langer en per categorie opbouwen, meer navigatie"],
      ["thema-pdp", "Productpagina voor general dropshipping, conversiegericht"],
      ["thema-i18n", "Alle teksten vertaalbaar, zodat een nieuwe markt alleen een vertaling is"],
      ["thema-draft", "Thema als draft op de store gezet"],
      ["thema-live", "Thema gepubliceerd"],
    ],
  },
  {
    id: "catalogus",
    n: "02",
    title: "Catalogus klaar voor Frankrijk",
    steps: [
      ["cat-fr", "Titels, beschrijvingen, varianten en collectienamen naar het Frans"],
      ["cat-handles", "Bronnamen (bowlift, sansoti) uit de product-URL's halen"],
      ["cat-voorraad", "Voorraad en doorverkopen bij geen voorraad controleren"],
      ["cat-dubbel", "Dubbele collecties samenvoegen (Home & Living en Home Indoor)"],
      ["cat-leeg", "Lege collecties vullen of verwijderen"],
      ["cat-stekker", "Alleen EU-stekkers als variant"],
    ],
  },
  {
    id: "compliance",
    n: "03",
    title: "Compliance en Merchant Center",
    steps: [
      ["gmc-ssd", "SSD's met onrealistische capaciteit nalopen"],
      ["gmc-merk", "Merknamen uit varianten en titels halen"],
      ["gmc-medisch", "Medische claims uit productteksten halen"],
      ["gmc-keur", "Keurmerk-claims (DOT, ECE) alleen als ze aantoonbaar zijn"],
      ["gmc-actie", "Actievarianten (koop 2, krijg 1) laten kloppen met de prijs"],
      ["gmc-legal", "Franse pagina's: mentions légales, CGV, herroepingsrecht 14 dagen, wettelijke garantie"],
    ],
  },
  {
    id: "research",
    n: "04",
    title: "Competitor research Frankrijk",
    steps: [
      ["res-lijst", "Zo groot mogelijke lijst Franse general stores"],
      ["res-analyse", "Alle Franse stores uit de competitor sheet analyseren (opbouw en teksten)"],
      ["res-sheet", "Per store: domein, producten, prijsniveau, advertentiekanaal"],
      ["res-best", "Bestsellers per competitor vastleggen"],
    ],
  },
  {
    id: "eu",
    n: "05",
    title: "Uitbreiden binnen de EU",
    steps: [
      ["eu-tractie", "Tractie in Frankrijk bewezen"],
      ["eu-research", "Research in de volgende markten"],
      ["eu-volgende", "Volgende markt gekozen en vertaald"],
    ],
  },
];

const MARKETS = [
  ["FR", "Frankrijk"],
  ["BE", "België"],
  ["LU", "Luxemburg"],
  ["NL", "Nederland"],
  ["IT", "Italië"],
  ["ES", "Spanje"],
  ["DE", "Duitsland"],
  ["AT", "Oostenrijk"],
  ["PL", "Polen"],
  ["SE", "Zweden"],
  ["DK", "Denemarken"],
  ["FI", "Finland"],
  ["IE", "Ierland"],
  ["PT", "Portugal"],
];
// klik = volgende status; "" = nog niets
const STATUS_ORDER = ["", "gepland", "research", "focus", "live"];
const STATUS_LABEL = { "": "Later", gepland: "Gepland", research: "Research", focus: "Focus", live: "Live" };

const TOOLS = [
  ["/importer", "Importer"],
  ["/scraper", "Product Scraper"],
  ["/competitor-finder", "Competitor finder"],
  ["/keywords", "Keywords"],
  ["/qa", "Store Doctor"],
  ["/pythago", "Pythago"],
];

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChaimGeneralStoresPage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [newStore, setNewStore] = useState({ name: "", domain: "", market: "" });
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    fetch("/api/general-stores")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        setState(j.state);
      })
      .catch((e) => setError(`Laden mislukt: ${String(e.message || e)}`));
  }, []);

  // Meteen op het scherm, daarna opslaan; opslaan gaat één voor één, zodat
  // twee snelle klikken elkaar niet overschrijven.
  function update(fn) {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      setSaving(true);
      queue.current = queue.current
        .then(() =>
          fetch("/api/general-stores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: next }),
          })
        )
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setError("");
        })
        .catch((e) => setError(`Opslaan mislukt: ${String(e.message || e)}`))
        .finally(() => setSaving(false));
      return next;
    });
  }

  const toggleStep = (id) => update((s) => ({ ...s, done: { ...s.done, [id]: !s.done[id] } }));
  const cycleMarket = (code) =>
    update((s) => {
      const cur = s.markets[code] || "";
      const nxt = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % STATUS_ORDER.length];
      const markets = { ...s.markets };
      if (nxt) markets[code] = nxt;
      else delete markets[code];
      return { ...s, markets };
    });
  function addNote(e) {
    e.preventDefault();
    const text = note.trim();
    if (!text) return;
    update((s) => ({ ...s, log: [{ id: newId(), at: new Date().toISOString(), text }, ...s.log] }));
    setNote("");
  }
  const removeNote = (id) => update((s) => ({ ...s, log: s.log.filter((x) => x.id !== id) }));
  function addStore(e) {
    e.preventDefault();
    if (!newStore.name.trim() && !newStore.domain.trim()) return;
    update((s) => ({ ...s, stores: [...s.stores, { ...newStore, currency: "EUR" }] }));
    setNewStore({ name: "", domain: "", market: "" });
  }
  const removeStore = (i) => {
    if (!window.confirm("Store uit dit overzicht halen?")) return;
    update((s) => ({ ...s, stores: s.stores.filter((_, n) => n !== i) }));
  };

  function addLink(e) {
    e.preventDefault();
    let url = newLink.url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    update((s) => ({ ...s, links: [...(s.links || []), { label: newLink.label.trim() || url, url }] }));
    setNewLink({ label: "", url: "" });
  }
  const removeLink = (i) => update((s) => ({ ...s, links: (s.links || []).filter((_, n) => n !== i) }));

  const allSteps = PHASES.flatMap((p) => p.steps);
  const doneCount = state ? allSteps.filter(([id]) => state.done[id]).length : 0;
  const pct = allSteps.length ? Math.round((doneCount / allSteps.length) * 100) : 0;

  return (
    <main className="cgs">
      <Header icon="C" title="Chaim General Stores" subtitle="Main unit · Sa Collective" />
      <div className="cgs-wrap">
        <section className="cgs-hero">
          <div>
            <div className="cgs-eyebrow">Main unit</div>
            <h1>Chaim General Stores</h1>
            <p>Start in Frankrijk, bij tractie uitbreiden binnen de EU. Alles rond deze store staat hier.</p>
          </div>
          <div className="cgs-progress">
            <div className="cgs-pct">{pct}%</div>
            <div className="cgs-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="cgs-sub">
              {doneCount} van {allSteps.length} stappen · {saving ? "opslaan…" : "opgeslagen"}
            </div>
          </div>
        </section>

        {error && <div className="cgs-error">{error}</div>}
        {!state && !error && <div className="cgs-loading">Laden…</div>}

        {state && (
          <>
            <section className="cgs-block">
              <h2>Stores</h2>
              <div className="cgs-stores">
                {state.stores.map((s, i) => {
                  const handle = s.domain.replace(/\.myshopify\.com$/, "");
                  return (
                    <div className="cgs-store" key={s.domain + i}>
                      <div className="cgs-store-top">
                        <span className="cgs-dot" />
                        <b>{s.name || s.domain}</b>
                        {s.market && <span className="cgs-chip">{s.market}</span>}
                        {s.currency && <span className="cgs-chip ghost">{s.currency}</span>}
                      </div>
                      <div className="cgs-store-dom">{s.domain}</div>
                      <div className="cgs-store-links">
                        {s.domain.endsWith(".myshopify.com") && (
                          <a href={`https://admin.shopify.com/store/${handle}`} target="_blank" rel="noreferrer">
                            Shopify admin
                          </a>
                        )}
                        {s.domain && (
                          <a href={`https://${s.domain}`} target="_blank" rel="noreferrer">
                            Store bekijken
                          </a>
                        )}
                        <button type="button" onClick={() => removeStore(i)}>
                          Verwijderen
                        </button>
                      </div>
                    </div>
                  );
                })}
                <form className="cgs-store add" onSubmit={addStore}>
                  <input type="text" placeholder="Naam" value={newStore.name} onChange={(e) => setNewStore({ ...newStore, name: e.target.value })} />
                  <input type="text" placeholder="Domein (xxx.myshopify.com)" value={newStore.domain} onChange={(e) => setNewStore({ ...newStore, domain: e.target.value })} />
                  <input type="text" placeholder="Markt (FR)" value={newStore.market} onChange={(e) => setNewStore({ ...newStore, market: e.target.value })} />
                  <button type="submit" className="cgs-btn">
                    Store toevoegen
                  </button>
                </form>
              </div>
            </section>

            <section className="cgs-block">
              <h2>Werkproces</h2>
              <div className="cgs-phases">
                {PHASES.map((p) => {
                  const n = p.steps.filter(([id]) => state.done[id]).length;
                  return (
                    <div className={"cgs-phase" + (n === p.steps.length ? " complete" : "")} key={p.id}>
                      <div className="cgs-phase-head">
                        <span className="cgs-n">{p.n}</span>
                        <b>{p.title}</b>
                        <span className="cgs-count">
                          {n}/{p.steps.length}
                        </span>
                      </div>
                      {p.steps.map(([id, label]) => (
                        <label className={"cgs-step" + (state.done[id] ? " on" : "")} key={id}>
                          <input type="checkbox" checked={!!state.done[id]} onChange={() => toggleStep(id)} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="cgs-block">
              <h2>
                Markten <small>klik om de status te wisselen</small>
              </h2>
              <div className="cgs-markets">
                {MARKETS.map(([code, name]) => {
                  const st = state.markets[code] || "";
                  return (
                    <button type="button" key={code} className={"cgs-market s-" + (st || "none")} onClick={() => cycleMarket(code)}>
                      <b>{code}</b>
                      <span>{name}</span>
                      <em>{STATUS_LABEL[st]}</em>
                    </button>
                  );
                })}
              </div>
              <p className="cgs-hint">Alleen EU. Het Verenigd Koninkrijk, Zwitserland en Noorwegen horen er niet bij.</p>
            </section>

            <section className="cgs-block cgs-two">
              <div>
                <h2>Logboek</h2>
                <form className="cgs-note" onSubmit={addNote}>
                  <textarea rows={3} placeholder="Besluit, afspraak met Chaim, idee…" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button type="submit" className="cgs-btn">
                    Opslaan
                  </button>
                </form>
                <div className="cgs-log">
                  {state.log.length === 0 && <div className="cgs-empty">Nog niets genoteerd.</div>}
                  {state.log.map((x) => (
                    <div className="cgs-log-item" key={x.id}>
                      <time>{new Date(x.at).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                      <p>{x.text}</p>
                      <button type="button" onClick={() => removeNote(x.id)} aria-label="Notitie verwijderen">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2>Bronnen</h2>
                <div className="cgs-links">
                  {(state.links || []).map((l, i) => (
                    <div className="cgs-link" key={l.url + i}>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.label} <span>↗</span>
                      </a>
                      <button type="button" onClick={() => removeLink(i)} aria-label="Bron verwijderen">
                        ×
                      </button>
                    </div>
                  ))}
                  <form className="cgs-link-add" onSubmit={addLink}>
                    <input type="text" placeholder="Naam" value={newLink.label} onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} />
                    <input type="text" placeholder="Link" value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
                    <button type="submit" className="cgs-btn">
                      Bron toevoegen
                    </button>
                  </form>
                </div>
                <h2 className="cgs-h2-gap">Tools</h2>
                <div className="cgs-tools">
                  {TOOLS.map(([href, label]) => (
                    <Link href={href} key={href}>
                      {label} <span>→</span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
