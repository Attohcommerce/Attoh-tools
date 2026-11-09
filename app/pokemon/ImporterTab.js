"use client";
// 02 IMPORTER — kiezen, eigen teksten laten schrijven en op "Sold out" in de store zetten.
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../components/sfx";
import { postJSON, creds, money, lsGet, lsSet } from "./util";
import { RELEASE_DATES, CLASSIC_SETS } from "@/lib/pokemon/brain";
import { SET_NAMES, ERA_OF, SEALED_TYPES } from "@/lib/pokemon/catalog";

const TYPE_ORDER = [
  "Elite Trainer Box", "Booster Box", "Booster Bundle", "Booster Pack", "Blister", "Collection Box",
  "Ultra Premium Collection", "Tin", "Build & Battle", "Theme Deck", "Single Card", "Graded Card",
  "Accessories", "Plush & Figures", "Other",
];
const PAGE = 120;

function priceFor(g, s) {
  const base = s.priceMode === "median" ? g.medianPrice : s.priceMode === "max" ? g.maxPrice : g.minPrice;
  if (!base) return 0;
  let p = base * (Number(s.factor) || 1);
  if (s.ending === ".95" || s.ending === ".99") {
    const c = s.ending === ".95" ? 0.95 : 0.99;
    const raw = p;
    p = Math.floor(p) + c;
    if (p < raw - 0.5) p += 1;
  } else if (s.ending === "4.95/9.95") {
    const tens = Math.floor(p / 10) * 10;
    const cands = [tens - 0.05, tens + 4.95, tens + 9.95].filter((x) => x > 0);
    p = cands.reduce((b, x) => (Math.abs(x - p) < Math.abs(b - p) ? x : b), cands[0]);
  }
  return Math.round(p * 100) / 100;
}

export default function ImporterTab({ notify, store, goScraper, goDoctor }) {
  const [groups, setGroups] = useState([]);
  const [imported, setImported] = useState({});
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [setF, setSetF] = useState(() => new Set()); // gekozen sets (leeg = alle)
  const [setPanel, setSetPanel] = useState(false);
  const [sealedOnly, setSealedOnly] = useState(true);
  const [lang, setLang] = useState("");
  const [status, setStatus] = useState("new");
  const [minSrc, setMinSrc] = useState(1);
  const [sort, setSort] = useState("sources");
  const [shown, setShown] = useState(PAGE);
  const [detail, setDetail] = useState(null);
  const [preview, setPreview] = useState(null);
  const [run, setRun] = useState(null); // {done, total, ok, fail, skipped, usd}
  const [log, setLog] = useState([]);
  const stopRef = useRef(false);

  const addLog = (msg, cls = "") => setLog((l) => [...l.slice(-300), { t: new Date().toLocaleTimeString("nl-NL"), msg, cls }]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/pokemon/catalog?store=${encodeURIComponent((store && store.domain) || "")}`).then((x) => x.json());
      setGroups(r.groups || []);
      setImported(r.imported || {});
    } catch (e) {
      notify("Laden mislukt: " + e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [store && store.domain]);
  useEffect(() => {
    fetch("/api/pokemon/settings")
      .then((r) => r.json())
      .then((d) => setSettings({ ...d.settings, ...lsGet("pk_settings", {}) }))
      .catch(() => setSettings(null));
  }, []);
  function upd(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    lsSet("pk_settings", next);
  }
  function updCol(k, v) {
    upd({ collections: { ...settings.collections, [k]: v } });
  }

  const counts = useMemo(() => {
    const t = {};
    const s = {};
    const l = {};
    for (const g of groups) {
      t[g.type] = (t[g.type] || 0) + 1;
      if (g.set) s[g.set] = (s[g.set] || 0) + 1;
      l[g.lang] = (l[g.lang] || 0) + 1;
    }
    return { t, s, l };
  }, [groups]);

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let out = groups.filter((g) => {
      if (type && g.type !== type) return false;
      if (setF.size && !setF.has(g.set)) return false;
      if (sealedOnly && !SEALED_TYPES.has(g.type)) return false;
      if (lang && g.lang !== lang) return false;
      if (status === "new" && imported[g.key]) return false;
      if (status === "done" && !imported[g.key]) return false;
      if ((g.sources || []).length < minSrc) return false;
      if (qq && !`${g.title} ${g.set} ${g.type}`.toLowerCase().includes(qq)) return false;
      return true;
    });
    const by = {
      sources: (a, b) => b.sources.length - a.sources.length || b.imageCount - a.imageCount,
      priceHigh: (a, b) => b.minPrice - a.minPrice,
      priceLow: (a, b) => a.minPrice - b.minPrice,
      set: (a, b) => String(a.set || "zzz").localeCompare(String(b.set || "zzz")) || a.title.localeCompare(b.title),
      type: (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.title.localeCompare(b.title),
    };
    return out.sort(by[sort] || by.sources);
  }, [groups, q, type, setF, lang, status, minSrc, sort, imported, sealedOnly]);

  // Sets op volgorde van release (nieuwste eerst), gesplitst in Engels en Japans
  const setLists = useMemo(() => {
    const present = new Set(groups.map((g) => g.set).filter(Boolean));
    const order = (a, b) => {
      const da = RELEASE_DATES[a], db = RELEASE_DATES[b];
      if (da && db) return db.localeCompare(da);
      const ia = SET_NAMES.indexOf(a), ib = SET_NAMES.indexOf(b);
      if (da && !db) return ia - ib;
      return ia - ib;
    };
    const all = SET_NAMES.filter((n) => present.has(n)).sort(order);
    for (const n of present) if (!SET_NAMES.includes(n)) all.push(n);
    return { en: all.filter((n) => ERA_OF[n] !== "Japanese"), jp: all.filter((n) => ERA_OF[n] === "Japanese") };
  }, [groups]);
  const setCount = useMemo(() => {
    const c = {};
    for (const g of groups) if (g.set && (!sealedOnly || SEALED_TYPES.has(g.type))) c[g.set] = (c[g.set] || 0) + 1;
    return c;
  }, [groups, sealedOnly]);
  function pickSets(names, add = true) {
    setSetF((cur) => {
      const n = add ? new Set(cur) : new Set();
      for (const x of names) n.add(x);
      return n;
    });
    setShown(PAGE);
  }
  function toggleSet(name) {
    setSetF((cur) => {
      const n = new Set(cur);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
    setShown(PAGE);
  }

  function toggle(k) {
    setSel((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  }
  function selectVisible() {
    setSel((s) => {
      const n = new Set(s);
      for (const g of list) if (!imported[g.key]) n.add(g.key);
      return n;
    });
  }

  async function doPreview() {
    const keys = [...sel].slice(0, 2);
    if (!keys.length) return;
    setPreview({ loading: true });
    try {
      const r = await postJSON("/api/pokemon/import", { dryRun: true, keys, settings });
      setPreview({ items: r.previews || [], usd: r.usage && r.usage.usd });
    } catch (e) {
      setPreview(null);
      notify(e.message, true);
    }
  }

  async function doImport() {
    if (!store) {
      notify("Kies eerst rechtsboven je Pokémon-store", true);
      return;
    }
    const byKey = new Map(groups.map((g) => [g.key, g]));
    // Volgorde: oud → nieuw per set (release), binnen een set per type. Shopify toont nieuwste
    // aanmaak bovenaan, dus de nieuwste set (Delta Reign) komt zo bovenaan te staan.
    const rel = (g) => RELEASE_DATES[g.set] || (g.set && SET_NAMES.indexOf(g.set) >= 0 ? `0000-${String(999 - SET_NAMES.indexOf(g.set)).padStart(3, "0")}` : "0000-000");
    const keys = [...sel]
      .filter((k) => !imported[k] && byKey.get(k))
      .sort((a, b) => {
        const ga = byKey.get(a);
        const gb = byKey.get(b);
        return rel(ga).localeCompare(rel(gb)) || String(ga.set).localeCompare(String(gb.set)) || TYPE_ORDER.indexOf(ga.type) - TYPE_ORDER.indexOf(gb.type) || ga.title.localeCompare(gb.title);
      });
    if (!keys.length) return;
    if (!window.confirm(`${keys.length} producten importeren in ${store.name || store.domain}?\n\nZe komen op "${settings.status === "draft" ? "concept" : "actief"}" en uitverkocht (voorraad 0).`)) return;
    stopRef.current = false;
    const st = { done: 0, total: keys.length, ok: 0, fail: 0, skipped: 0, usd: 0 };
    setRun({ ...st });
    setLog([]);
    addLog(`▶ ${keys.length} producten naar ${store.domain}`);
    const chunks = [];
    // porties van 2 (AI + foto's per product duurt 20–40 s; zo blijft elke aanroep ruim onder de limiet)
    for (let i = 0; i < keys.length; i += 2) chunks.push(keys.slice(i, i + 2));
    async function worker() {
      while (chunks.length && !stopRef.current) {
        const ck = chunks.shift();
        try {
          const r = await postJSON("/api/pokemon/import", { store: creds(store), keys: ck, settings });
          for (const x of r.results || []) {
            if (x.skipped) {
              st.skipped++;
              addLog(`↷ ${x.title} — ${x.reason || "overgeslagen"}`, "dim");
              if (x.id) setImported((m) => ({ ...m, [x.key]: { id: x.id, handle: x.handle, title: x.title } }));
            } else if (x.ok) {
              st.ok++;
              sfx("ok");
              addLog(`✓ ${x.title} · ${x.price ? x.price.toFixed(2) : "geen prijs"} · ${x.images} foto's${x.removedImages ? ` (${x.removedImages} geweigerd: shopbranding)` : ""} · ${Math.round((x.copy || 0) * 100)}% overlap${x.colErrors && x.colErrors.length ? " · collectie-fout" : ""}`, x.images ? "ok" : "warn");
              setImported((m) => ({ ...m, [x.key]: { id: x.id, handle: x.handle, title: x.title } }));
            } else {
              st.fail++;
              addLog(`✕ ${x.title}: ${x.error}`, "err");
            }
          }
          st.usd += (r.usage && r.usage.usd) || 0;
        } catch (e) {
          st.fail += ck.length;
          addLog(`✕ portie mislukt: ${e.message}`, "err");
        }
        st.done += ck.length;
        setRun({ ...st });
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    setSel(new Set());
    setRun({ ...st, finished: true });
    sfx(st.fail ? "error" : "success");
    notify(`Klaar: ${st.ok} geïmporteerd, ${st.skipped} overgeslagen, ${st.fail} mislukt`, !!st.fail);
  }

  // OPNIEUW BEGINNEN: alle door de importer gemaakte producten uit de store + importlog leeg
  async function purge() {
    if (!store) {
      notify("Kies eerst rechtsboven je Pokémon-store", true);
      return;
    }
    if (!window.confirm(`Alle door de importer gemaakte producten uit ${store.name || store.domain} verwijderen?\n\nDit kan niet ongedaan worden gemaakt. Producten die je zelf hebt aangemaakt blijven staan.`)) return;
    stopRef.current = false;
    setLog([]);
    addLog(`▶ Opnieuw beginnen: producten verwijderen uit ${store.domain}`);
    let total = 0;
    try {
      for (let round = 0; round < 40; round++) {
        const r = await postJSON("/api/pokemon/catalog", { action: "purge", store: creds(store) });
        total += r.deleted || 0;
        for (const e of r.errors || []) addLog(`✕ ${e}`, "err");
        addLog(`🗑 ${total} verwijderd`, "dim");
        if (!r.more) break;
      }
      setImported({});
      notify(`${total} producten verwijderd. Je kunt opnieuw importeren.`);
      addLog(`✓ Klaar: ${total} producten verwijderd, importlog leeg`, "ok");
    } catch (e) {
      notify(e.message, true);
      addLog(`✕ ${e.message}`, "err");
    }
  }

  async function forget(key) {
    if (!store) return;
    await postJSON("/api/pokemon/catalog", { action: "forget", store: store.domain, keys: [key] });
    setImported((m) => {
      const n = { ...m };
      delete n[key];
      return n;
    });
  }

  if (!loading && !groups.length) {
    return (
      <>
        <div className="pk-hero">
          <div>
            <h1>Importer</h1>
          </div>
        </div>
        <div className="pk-empty">
          <b>Nog niets gescrapet</b>
          Voeg eerst concurrenten toe en klik op Scrape alles.
          <div style={{ marginTop: 14 }}>
            <button className="pk-btn primary" onClick={goScraper}>
              Naar de scraper
            </button>
          </div>
        </div>
      </>
    );
  }

  const nImported = Object.keys(imported).length;
  const cur = (groups[0] && groups[0].currency) || "EUR";
  const storeCurMismatch = store && store.currency && groups.some((g) => g.currency && g.currency !== store.currency);

  return (
    <>
      <div className="pk-hero">
        <div>
          <h1>Importer</h1>
          <p>
            {groups.length.toLocaleString("nl-NL")} unieke producten van al je concurrenten samen (zelfde product bij meerdere winkels = één kaart). Kies wat je wilt; de tool schrijft eigen titels ("Pokémon &lt;Set&gt; &lt;product&gt; &lt;code&gt;") en omschrijvingen in één vaste opbouw, importeert van oud naar nieuw per set, en alles komt op <b>Uitverkocht</b> in je store.
          </p>
        </div>
        <div className="pk-row">
          <span className="pk-badge good">{nImported} al in de store</span>
          <button className="pk-btn sm" onClick={load}>
            ↻ Vernieuwen
          </button>
          {store && (
            <button className="pk-btn sm danger" onClick={purge} title="Alle door de importer gemaakte producten uit de store halen en het importlog leegmaken">
              Opnieuw beginnen
            </button>
          )}
        </div>
      </div>

      <div className="pk-grid2">
        <div className="pk-sticky pk-late">
          {settings && (
            <div className="pk-card">
              <h3>Instellingen</h3>
              <div className="pk-field">
                <div className="pk-label">Taal van de teksten</div>
                <div className="pk-chips">
                  {[["nl", "Nederlands"], ["en", "English"], ["de", "Deutsch"], ["fr", "Français"]].map(([k, v]) => (
                    <button key={k} className={"pk-chip" + (settings.lang === k ? " on" : "")} onClick={() => upd({ lang: k })}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pk-field">
                <div className="pk-label">Winkelnaam (voor de toon)</div>
                <input type="text" placeholder="nog geen naam? leeg laten" value={settings.brand || ""} onChange={(e) => upd({ brand: e.target.value })} />
              </div>
              <div className="pk-field">
                <div className="pk-label">Prijs</div>
                <div className="pk-row" style={{ flexWrap: "nowrap" }}>
                  <select value={settings.priceMode} onChange={(e) => upd({ priceMode: e.target.value })}>
                    <option value="min">Laagste concurrent</option>
                    <option value="median">Middelste concurrent</option>
                    <option value="max">Hoogste concurrent</option>
                  </select>
                  <span>×</span>
                  <input type="number" step="0.01" min="0.5" max="3" style={{ width: 80 }} value={settings.factor} onChange={(e) => upd({ factor: e.target.value })} />
                </div>
                <select style={{ marginTop: 6 }} value={settings.ending} onChange={(e) => upd({ ending: e.target.value })}>
                  <option value=".95">Eindigt op ,95</option>
                  <option value=".99">Eindigt op ,99</option>
                  <option value="4.95/9.95">Eindigt op 4,95 / 9,95</option>
                  <option value="none">Niet afronden</option>
                </select>
                {storeCurMismatch && <p className="pk-hint" style={{ color: "var(--warn)", marginTop: 6 }}>Let op: concurrent rekent in een andere valuta dan je store ({store.currency}). Prijzen worden niet omgerekend.</p>}
              </div>
              <div className="pk-field">
                <div className="pk-label">Zichtbaarheid</div>
                <div className="pk-chips">
                  <button className={"pk-chip" + (settings.status === "active" ? " on" : "")} onClick={() => upd({ status: "active" })}>
                    Actief (Sold out)
                  </button>
                  <button className={"pk-chip" + (settings.status === "draft" ? " on" : "")} onClick={() => upd({ status: "draft" })}>
                    Concept
                  </button>
                </div>
              </div>
              <div className="pk-field">
                <div className="pk-label">Collecties automatisch maken</div>
                <div className="pk-col">
                  {[
                    ["type", "Per type (Elite Trainer Boxes …)"],
                    ["set", "Per set (Surging Sparks …)"],
                    ["era", "Per era (Scarlet & Violet Era)"],
                    ["lang", "Per taal (Japanse Pokémon Kaarten)"],
                    ["sealed", "Sealed Producten"],
                    ["featured", "Per Pokémon (Charizard …)"],
                  ].map(([k, v]) => (
                    <label key={k} className="pk-check">
                      <input type="checkbox" checked={!!settings.collections[k]} onChange={(e) => updCol(k, e.target.checked)} />
                      {v}
                    </label>
                  ))}
                </div>
              </div>
              <div className="pk-field">
                <div className="pk-label">Max. foto's per product</div>
                <input type="number" min="1" max="15" value={settings.maxImages} onChange={(e) => upd({ maxImages: Number(e.target.value) || 8 })} />
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="pk-toolbar">
            <input type="search" placeholder="Zoek op naam, set, type…" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
            <button type="button" className={"pk-btn sm" + (setF.size ? " dark" : "")} onClick={() => setSetPanel((v) => !v)}>
              {setF.size ? `${setF.size} sets gekozen` : "Sets kiezen"} {setPanel ? "▴" : "▾"}
            </button>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="">Alle talen</option>
              {Object.entries(counts.l).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} ({v})
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="new">Nog niet in store</option>
              <option value="done">Al in store</option>
              <option value="all">Alles</option>
            </select>
            <select value={minSrc} onChange={(e) => setMinSrc(Number(e.target.value))}>
              <option value={1}>Bij ≥ 1 concurrent</option>
              <option value={2}>Bij ≥ 2 concurrenten</option>
              <option value={3}>Bij ≥ 3 concurrenten</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="sources">Meeste concurrenten eerst</option>
              <option value="type">Op type</option>
              <option value="set">Op set</option>
              <option value="priceHigh">Duurste eerst</option>
              <option value="priceLow">Goedkoopste eerst</option>
            </select>
          </div>
                    {setPanel && (
            <div className="pk-card" style={{ marginBottom: 12 }}>
              <div className="pk-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <button className="pk-btn sm" onClick={() => pickSets(setLists.en.slice(0, 20), false)}>Laatste 20 Engelse sets</button>
                <button className="pk-btn sm" onClick={() => pickSets(setLists.en.slice(0, 10))}>+ laatste 10 Engels</button>
                <button className="pk-btn sm" onClick={() => pickSets(setLists.jp.slice(0, 10))}>+ laatste 10 Japans</button>
                <button className="pk-btn sm" onClick={() => pickSets(CLASSIC_SETS.filter((n) => setCount[n]))}>+ klassiekers (151, Prismatic, Evolving Skies …)</button>
                <button className="pk-btn sm ghost" onClick={() => pickSets([], false)} disabled={!setF.size}>Wissen</button>
                <span className="pk-spacer" />
                <label className="pk-row" style={{ gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={sealedOnly} onChange={(e) => setSealedOnly(e.target.checked)} /> Alleen sealed (geen losse kaarten, accessoires)
                </label>
                <span className="pk-hint">{setF.size ? `${setF.size} sets · ${list.length} producten` : `${setLists.en.length + setLists.jp.length} sets gevonden`}</span>
              </div>
              <p className="pk-label" style={{ margin: "6px 0" }}>Engels (nieuwste eerst)</p>
              <div className="pk-chips">
                {setLists.en.map((n) => (
                  <button key={n} className={"pk-chip" + (setF.has(n) ? " on" : "")} onClick={() => toggleSet(n)} title={RELEASE_DATES[n] || ""}>
                    {n} <span>{setCount[n] || 0}</span>{RELEASE_DATES[n] ? <small style={{ opacity: 0.6, marginLeft: 4 }}>{RELEASE_DATES[n].slice(0, 4)}</small> : null}
                  </button>
                ))}
              </div>
              <p className="pk-label" style={{ margin: "10px 0 6px" }}>Japans (nieuwste eerst)</p>
              <div className="pk-chips">
                {setLists.jp.map((n) => (
                  <button key={n} className={"pk-chip" + (setF.has(n) ? " on" : "")} onClick={() => toggleSet(n)} title={RELEASE_DATES[n] || ""}>
                    {n} <span>{setCount[n] || 0}</span>{RELEASE_DATES[n] ? <small style={{ opacity: 0.6, marginLeft: 4 }}>{RELEASE_DATES[n].slice(0, 4)}</small> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
<div className="pk-chips" style={{ marginBottom: 14 }}>
            <button className={"pk-chip" + (!type ? " on" : "")} onClick={() => setType("")}>
              Alles<span className="c">{groups.length}</span>
            </button>
            {TYPE_ORDER.filter((t) => counts.t[t]).map((t) => (
              <button key={t} className={"pk-chip" + (type === t ? " on" : "")} onClick={() => setType(type === t ? "" : t)}>
                {t}
                <span className="c">{counts.t[t]}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="pk-empty">
              <b>Laden…</b>
            </div>
          ) : list.length === 0 ? (
            <div className="pk-empty">
              <b>Niets gevonden</b>Pas de filters aan.
            </div>
          ) : (
            <div className="pk-cards">
              {list.slice(0, shown).map((g) => {
                const isSel = sel.has(g.key);
                const isDone = !!imported[g.key];
                return (
                  <div key={g.key} className={"pk-prod" + (isSel ? " sel" : "") + (isDone ? " done" : "")} onClick={() => (isDone ? setDetail(g) : toggle(g.key))}>
                    <span className="tick">✓</span>
                    <div className="corner">
                      {isDone && <span className="pk-badge good">in store</span>}
                      {g.sources.length > 1 && <span className="pk-badge yellow">{g.sources.length}×</span>}
                    </div>
                    <div className="img">{g.image ? <img src={g.image + (g.image.includes("cdn.shopify") ? "?width=360" : "")} alt="" loading="lazy" /> : <span className="pk-hint">geen foto</span>}</div>
                    <div className="body">
                      <div className="t" title={g.title}>
                        {g.title}
                      </div>
                      <div className="meta">
                        <span className="pk-badge">{g.type}</span>
                        {g.set && <span className="pk-badge">{g.set}</span>}
                        {g.lang !== "English" && <span className="pk-badge red">{g.lang}</span>}
                      </div>
                      <div className="price">
                        <span className="pk-hint">
                          {money(g.minPrice, g.currency)}
                          {g.maxPrice > g.minPrice ? `–${money(g.maxPrice, g.currency).replace(/^[^\d]+/, "")}` : ""}
                        </span>
                        {settings && <b>{money(priceFor(g, settings), g.currency)}</b>}
                      </div>
                      <button
                        className="pk-btn sm ghost"
                        style={{ alignSelf: "flex-start", padding: "4px 6px" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetail(g);
                        }}
                      >
                        Details · {g.imageCount} foto's
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {list.length > shown && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button className="pk-btn" onClick={() => setShown((n) => n + PAGE)}>
                Meer laden ({list.length - shown} over)
              </button>
            </div>
          )}

          {run && (
            <div className="pk-card" style={{ marginTop: 18 }}>
              <div className="pk-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <b>
                  {run.finished ? "Klaar" : "Importeren…"} {run.done}/{run.total}
                </b>
                <span className="pk-hint">
                  ✓ {run.ok} · ↷ {run.skipped} · ✕ {run.fail} · AI ${run.usd.toFixed(2)}
                </span>
              </div>
              <div className="pk-bar">
                <i style={{ width: (100 * run.done) / Math.max(1, run.total) + "%" }} />
              </div>
              {log.length > 0 && (
                <div className="pk-log" style={{ marginTop: 12 }}>
                  {log.map((l, i) => (
                    <div key={i} className={l.cls}>
                      <span className="dim">{l.t}</span> {l.msg}
                    </div>
                  ))}
                </div>
              )}
              {run.finished && (
                <div className="pk-row" style={{ marginTop: 12 }}>
                  <button className="pk-btn dark" onClick={goDoctor}>
                    Store Doctor draaien →
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="pk-dock">
            <div className="count">
              <span>{sel.size}</span> geselecteerd
            </div>
            <button className="pk-btn sm" onClick={selectVisible}>
              Selecteer alles hierboven ({list.filter((g) => !imported[g.key]).length})
            </button>
            {sel.size > 0 && (
              <button className="pk-btn sm" onClick={() => setSel(new Set())}>
                Wissen
              </button>
            )}
            <span className="pk-spacer" style={{ flex: 1 }} />
            {run && !run.finished ? (
              <button className="pk-btn yellow" onClick={() => (stopRef.current = true)}>
                Pauze
              </button>
            ) : (
              <>
                <button className="pk-btn" disabled={!sel.size} onClick={doPreview}>
                  👁 Voorbeeld
                </button>
                <button className="pk-btn primary" disabled={!sel.size || !store} onClick={doImport} title={!store ? "Kies eerst een store" : ""}>
                  ⚡ Importeer {sel.size || ""} {store ? `→ ${store.name || store.domain}` : "(kies store)"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {detail && (
        <div className="pk-modal-bg" onClick={() => setDetail(null)}>
          <div className="pk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pk-modal-head">
              <h3>{detail.title}</h3>
              <button className="pk-btn ghost sm" onClick={() => setDetail(null)}>
                ✕
              </button>
            </div>
            <div className="pk-modal-body">
              <div className="pk-gallery">
                {(detail.images || []).map((u) => (
                  <img key={u} src={u + (u.includes("cdn.shopify") ? "?width=300" : "")} alt="" />
                ))}
              </div>
              <div className="pk-row" style={{ margin: "12px 0" }}>
                <span className="pk-badge">{detail.type}</span>
                {detail.set && <span className="pk-badge">{detail.set}</span>}
                {detail.era && <span className="pk-badge">{detail.era}</span>}
                <span className="pk-badge">{detail.lang}</span>
              </div>
              <p className="pk-hint" style={{ marginBottom: 12 }}>
                {detail.snippet || "Geen omschrijving bij de bron."}
              </p>
              <table className="pk-table">
                <thead>
                  <tr>
                    <th>Concurrent</th>
                    <th>Prijs</th>
                    <th>Op voorraad</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sources.map((s) => (
                    <tr key={s.url}>
                      <td>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.domain}
                        </a>
                      </td>
                      <td className="pk-num">{money(s.price, s.currency)}</td>
                      <td>{s.available ? <span className="pk-badge good">ja</span> : <span className="pk-badge">uitverkocht</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pk-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                {imported[detail.key] ? (
                  <>
                    {store && (
                      <a className="pk-btn" href={`https://${store.domain}/admin/products/${imported[detail.key].id}`} target="_blank" rel="noreferrer">
                        Open in Shopify
                      </a>
                    )}
                    <button className="pk-btn" onClick={() => { forget(detail.key); setDetail(null); }} title="Uit het importlog halen, bv. als je het product in Shopify hebt verwijderd">
                      Opnieuw importeerbaar maken
                    </button>
                  </>
                ) : (
                  <button className="pk-btn primary" onClick={() => { toggle(detail.key); setDetail(null); }}>
                    {sel.has(detail.key) ? "Uit selectie" : "Selecteren"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="pk-modal-bg" onClick={() => setPreview(null)}>
          <div className="pk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pk-modal-head">
              <h3>Voorbeeld: bron ↔ onze tekst</h3>
              <button className="pk-btn ghost sm" onClick={() => setPreview(null)}>
                ✕
              </button>
            </div>
            <div className="pk-modal-body">
              {preview.loading ? (
                <p>De AI schrijft…</p>
              ) : (
                preview.items.map((it) => (
                  <div key={it.key} style={{ marginBottom: 26 }}>
                    <div className="pk-compare">
                      <div className="src">
                        <div className="pk-label" style={{ marginBottom: 6 }}>
                          Concurrent
                        </div>
                        <b>{it.source.title}</b>
                        <p style={{ marginTop: 8 }}>{it.source.text || "(geen tekst)"}</p>
                      </div>
                      <div className="ours">
                        <div className="pk-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                          <span className="pk-label">Wij</span>
                          <span className={"pk-badge " + ((it.listing.copy || 0) > 0.15 ? "bad" : "good")}>{Math.round((it.listing.copy || 0) * 100)}% overlap</span>
                        </div>
                        <b>{it.listing.title}</b>
                        <div dangerouslySetInnerHTML={{ __html: it.listing.descriptionHtml }} />
                        <p className="pk-hint" style={{ marginTop: 10 }}>
                          SEO: {it.listing.seoTitle} — {it.listing.seoDescription}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
