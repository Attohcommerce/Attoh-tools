"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";

const LS = {
  stores: "sa_stores",
  selected: "sa_selected_store",
  queue: "sa_url_queue",
  logSheet: "sa_importlog_sheet",
};

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

function parseUrls(text) {
  return String(text || "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /https?:\/\/[^\s]+\/products\/[^\s]+/i.test(s) || /^[^\s]+\.[a-z]{2,}\/products\/[^\s]+/i.test(s))
    .map((s) => (s.startsWith("http") ? s : "https://" + s));
}

export default function ImporterPage() {
  // Stores
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newStore, setNewStore] = useState({
    name: "",
    domain: "",
    clientId: "",
    clientSecret: "",
    token: "",
  });
  const [authMode, setAuthMode] = useState("client"); // client | token
  const [testing, setTesting] = useState(false);
  const [addErr, setAddErr] = useState("");

  // Input
  const [tab, setTab] = useState("urls"); // urls | sheet
  const [urlsText, setUrlsText] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [sheetTab, setSheetTab] = useState("");
  const [sheetKeywordFilter, setSheetKeywordFilter] = useState("");
  const [skipTagged, setSkipTagged] = useState(true);
  const [sheetLinks, setSheetLinks] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetMsg, setSheetMsg] = useState("");

  // Batch-instellingen
  const [requiredKeyword, setRequiredKeyword] = useState("");
  const [tags, setTags] = useState("");
  const [discount, setDiscount] = useState(50);
  const [customDiscount, setCustomDiscount] = useState("");
  const [status, setStatus] = useState("draft");
  const [listingStyle, setListingStyle] = useState("stacking");
  const [genderPrefix, setGenderPrefix] = useState(false);
  const [forceMens, setForceMens] = useState(false);
  const [currencyOverride, setCurrencyOverride] = useState(false);
  const [manualRate, setManualRate] = useState("");
  const [colorLabel, setColorLabel] = useState("Color");
  const [sizeLabel, setSizeLabel] = useState("Size");
  const [themeTemplate, setThemeTemplate] = useState("standard");

  // Import-log (werkboek-sheet, tabblad "Import-log")
  const [logSheet, setLogSheet] = useState("");

  // Import-run
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [step, setStep] = useState(""); // live stap binnen het huidige product
  const [logs, setLogs] = useState([]);

  // Queue
  const [queue, setQueue] = useState([]);
  const [queueText, setQueueText] = useState("");
  const [queueTag, setQueueTag] = useState("");
  const [queueKeyword, setQueueKeyword] = useState("");

  useEffect(() => {
    setStores(load(LS.stores, []));
    setSelected(load(LS.selected, null));
    setQueue(load(LS.queue, []));
    // Log-sheet: eigen instelling, anders de werk-sheet van de scraper overnemen
    const ls = load(LS.logSheet, "") || load("sa_sheet_work", "");
    setLogSheet(ls);
    setSheetTab(load("sa_run_tab", ""));
  }, []);

  const urls = useMemo(() => {
    if (tab === "sheet") return sheetLinks || [];
    return parseUrls(urlsText);
  }, [tab, urlsText, sheetLinks]);

  const selectedStore = stores.find((s) => s.domain === selected) || null;
  const discountPct = discount === "custom" ? Number(customDiscount) || 0 : discount;

  function pushLog(line) {
    setLogs((l) => [...l, line]);
  }

  // ---------- Stores ----------
  async function addStore() {
    setAddErr("");
    const domain = newStore.domain.trim();
    const clientId = newStore.clientId.trim();
    const clientSecret = newStore.clientSecret.trim();
    const token = newStore.token.trim();

    if (!domain) {
      setAddErr("Domein is verplicht");
      return;
    }
    if (authMode === "client" && !(clientId && clientSecret)) {
      setAddErr("Client ID en client secret zijn verplicht");
      return;
    }
    if (authMode === "token" && !token) {
      setAddErr("Admin API token is verplicht");
      return;
    }

    const creds =
      authMode === "client" ? { clientId, clientSecret } : { token };

    setTesting(true);
    try {
      const res = await fetch("/api/shopify-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, ...creds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddErr("Verbinding mislukt: " + (data.error || res.status));
        setTesting(false);
        return;
      }
      const store = {
        name: newStore.name.trim() || data.shop.name,
        domain: domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(),
        ...creds,
        currency: data.shop.currency,
      };
      const next = [...stores.filter((s) => s.domain !== store.domain), store];
      setStores(next);
      save(LS.stores, next);
      setSelected(store.domain);
      save(LS.selected, store.domain);
      setNewStore({ name: "", domain: "", clientId: "", clientSecret: "", token: "" });
      setShowAdd(false);
    } catch (e) {
      setAddErr("Er ging iets mis: " + e.message);
    } finally {
      setTesting(false);
    }
  }

  function removeStore(domain) {
    const next = stores.filter((s) => s.domain !== domain);
    setStores(next);
    save(LS.stores, next);
    if (selected === domain) {
      setSelected(null);
      save(LS.selected, null);
    }
  }

  function selectStore(domain) {
    setSelected(domain);
    save(LS.selected, domain);
  }

  // ---------- Sheet laden ----------
  async function loadSheet() {
    setSheetBusy(true);
    setSheetMsg("");
    setSheetLinks(null);
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", sheetId, range: sheetTab.trim() ? `'${sheetTab.trim()}'!A:H` : "A:H" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      const rows = (data.values || []).slice(1); // header overslaan
      let links = [];
      for (const r of rows) {
        const link = r[0];
        const kw = (r[2] || "").toLowerCase();
        const dup = r[6];
        const doubt = r[7];
        if (!link || !/products\//i.test(link)) continue;
        if (skipTagged && (dup || doubt)) continue;
        if (sheetKeywordFilter && !kw.includes(sheetKeywordFilter.toLowerCase())) continue;
        links.push(link);
      }
      setSheetLinks(links);
      setSheetMsg(`${links.length} links geladen uit de sheet`);
    } catch (e) {
      setSheetMsg("Fout: " + e.message);
    } finally {
      setSheetBusy(false);
    }
  }

  // ---------- Import-log ----------
  const LOG_HEADER = ["Datum", "Store", "Titel", "Keyword", "Status", "Admin-link", "Preview-link", "Opmerkingen"];

  async function sheetsCall(body) {
    const res = await fetch("/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  }

  // ---------- Import ----------
  async function runImport() {
    if (!selectedStore || urls.length === 0 || running) return;
    setRunning(true);
    setLogs([]);
    setProgress({ done: 0, total: urls.length });

    // Import-log-tabblad klaarzetten (één keer per run)
    let logReady = false;
    if (logSheet.trim()) {
      try {
        await sheetsCall({
          action: "createTab",
          sheetId: logSheet.trim(),
          title: "Import-log",
          header: LOG_HEADER,
        });
        logReady = true;
      } catch (e) {
        pushLog({ ok: false, text: `Import-log niet bereikbaar: ${e.message} — import gaat gewoon door.` });
      }
    }

    // Wisselkoersen één keer ophalen
    let rates = null;
    if (!currencyOverride) {
      try {
        const res = await fetch("/api/currency");
        const data = await res.json();
        if (data.ok) rates = data.rates;
      } catch {}
    }

    let okCount = 0;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const nr = `${i + 1}/${urls.length}`;
      try {
        // 1. Scrape
        setStep(`${nr} · Product scrapen…`);
        const sRes = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const sData = await sRes.json();
        if (!sRes.ok) throw new Error(sData.error || "scrape mislukt");
        const product = sData.product;

        // 2. AI Generate
        setStep(`${nr} · AI schrijft titel + omschrijving… (±20 sec)`);
        const gRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product,
            settings: {
              listingStyle,
              requiredKeyword,
              genderPrefix,
              forceMensKeywords: forceMens,
              colorLabel,
              sizeLabel,
            },
          }),
        });
        const gData = await gRes.json();
        if (!gRes.ok) throw new Error(gData.error || "AI-generatie mislukt");
        if (gData.listing && gData.listing.warnings && gData.listing.warnings.length) {
          pushLog({
            ok: false,
            text: `${nr} · LET OP: listing wijkt na 3 pogingen nog af van de formule — handmatig checken: ${gData.listing.warnings.join("; ")}`,
          });
        }

        // 3. FX-rate bepalen
        let rate = 1;
        if (currencyOverride && manualRate) {
          rate = Number(manualRate) || 1;
        } else if (rates && product.sourceCurrency && selectedStore.currency) {
          const from = rates[product.sourceCurrency];
          const to = rates[selectedStore.currency];
          if (from && to) rate = to / from;
        }

        // 4. Upload
        setStep(`${nr} · Uploaden naar ${selectedStore.name} + foto's koppelen…`);
        const iRes = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store: {
              domain: selectedStore.domain,
              token: selectedStore.token,
              clientId: selectedStore.clientId,
              clientSecret: selectedStore.clientSecret,
            },
            product,
            listing: gData.listing,
            fx: { rate },
            settings: {
              discountPct,
              status,
              tags,
              colorLabel,
              sizeLabel,
              themeTemplate,
              manualRate: currencyOverride ? manualRate : null,
              vendor: selectedStore.name,
              keyword: requiredKeyword,
              forceMens,
            },
          }),
        });
        const iData = await iRes.json();
        if (!iRes.ok) throw new Error(iData.error || "upload mislukt");
        okCount++;
        const linked = iData.linkedImages ? ` · ${iData.linkedImages} kleurfoto's gekoppeld` : "";
        const colTxt = iData.collection
          ? ` · collectie: ${iData.collection}${iData.collectionCreated ? " (nieuw aangemaakt)" : ""}`
          : "";
        pushLog({ ok: true, text: iData.product.title + linked + colTxt, href: iData.product.adminUrl });
        if (logReady) {
          try {
            const now = new Date();
            const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
            await sheetsCall({
              action: "append",
              sheetId: logSheet.trim(),
              range: "'Import-log'!A:H",
              rows: [[
                stamp,
                selectedStore.name || selectedStore.domain,
                iData.product.title,
                requiredKeyword || "",
                iData.product.status,
                iData.product.adminUrl,
                iData.product.previewUrl || "",
                "",
              ]],
            });
          } catch {
            /* log is nice-to-have */
          }
        }
        window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "ok" }));
      } catch (e) {
        pushLog({ ok: false, text: `${url} — ${e.message}` });
        window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "error" }));
      }
      setProgress({ done: i + 1, total: urls.length });
    }
    pushLog({ info: true, text: `Klaar: ${okCount}/${urls.length} producten geïmporteerd als ${status === "active" ? "Active" : "Draft"}.` });
    if (okCount > 0) window.dispatchEvent(new CustomEvent("attoh-sfx", { detail: "success" }));
    setStep("");
    setRunning(false);
  }

  // ---------- Queue ----------
  function saveToQueue() {
    const items = String(queueText || "")
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return;
    const entry = {
      id: Date.now(),
      urls: items,
      tag: queueTag.trim(),
      keyword: queueKeyword.trim(),
    };
    const next = [entry, ...queue];
    setQueue(next);
    save(LS.queue, next);
    setQueueText("");
    setQueueTag("");
    setQueueKeyword("");
  }

  function loadQueueEntry(entry) {
    setTab("urls");
    setUrlsText(entry.urls.join("\n"));
    if (entry.keyword) setRequiredKeyword(entry.keyword);
    if (entry.tag) setTags(entry.tag);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function removeQueueEntry(id) {
    const next = queue.filter((q) => q.id !== id);
    setQueue(next);
    save(LS.queue, next);
  }

  const canImport = selectedStore && urls.length > 0 && !running;

  return (
    <>
      <Header
        icon="A"
        title="Attoh Tools"
        subtitle="Scrape · AI Generate · Upload"
      />
      <div className="page">
        <div className="layout-2col">
          {/* -------- Sidebar: Stores -------- */}
          <div>
            <div className="card">
              <h2>
                ⌂ Stores
                <span style={{ marginLeft: "auto" }}>
                  <button className="btn-ghost btn-small" onClick={() => setShowAdd(!showAdd)}>
                    + Add
                  </button>
                </span>
              </h2>
              {showAdd && (
                <div style={{ marginBottom: 10 }}>
                  <div className="field-label">Naam</div>
                  <input
                    type="text"
                    placeholder="Julia Raven"
                    value={newStore.name}
                    onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                  />
                  <div className="field-label">Domein (myshopify)</div>
                  <input
                    type="text"
                    placeholder="jouwstore.myshopify.com"
                    value={newStore.domain}
                    onChange={(e) => setNewStore({ ...newStore, domain: e.target.value })}
                  />

                  <div className="field-label">Type koppeling</div>
                  <div className="seg">
                    <button
                      className={authMode === "client" ? "on" : ""}
                      onClick={() => setAuthMode("client")}
                    >
                      Dev Dashboard
                    </button>
                    <button
                      className={authMode === "token" ? "on" : ""}
                      onClick={() => setAuthMode("token")}
                    >
                      Oude app
                    </button>
                  </div>

                  {authMode === "client" ? (
                    <>
                      <div className="field-label">Client ID</div>
                      <input
                        type="text"
                        placeholder="bijv. 1a2b3c4d5e6f…"
                        value={newStore.clientId}
                        onChange={(e) => setNewStore({ ...newStore, clientId: e.target.value })}
                      />
                      <div className="field-label">Client secret</div>
                      <input
                        type="password"
                        placeholder="••••••••••••"
                        value={newStore.clientSecret}
                        onChange={(e) =>
                          setNewStore({ ...newStore, clientSecret: e.target.value })
                        }
                      />
                    </>
                  ) : (
                    <>
                      <div className="field-label">Admin API token</div>
                      <input
                        type="password"
                        placeholder="shpat_…"
                        value={newStore.token}
                        onChange={(e) => setNewStore({ ...newStore, token: e.target.value })}
                      />
                    </>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <button className="btn-ghost" onClick={addStore} disabled={testing}>
                      {testing ? "Verbinden…" : "Opslaan & testen"}
                    </button>
                  </div>
                  {addErr && <div className="hint" style={{ color: "var(--err)" }}>{addErr}</div>}
                  <div className="hint">
                    {authMode === "client"
                      ? "Voor apps uit het Shopify Dev Dashboard. De tool haalt zelf elke keer een vers token op — die verloopt na 24 uur."
                      : "Alleen voor custom apps die vóór 1 januari 2026 in de Shopify-admin zijn gemaakt."}{" "}
                    Gegevens blijven in deze browser en gaan alleen via onze eigen server naar Shopify.
                  </div>
                </div>
              )}
              {stores.length === 0 && !showAdd && <div className="center-note">No stores added yet.</div>}
              {stores.map((s) => (
                <div
                  key={s.domain}
                  className={"store-item" + (selected === s.domain ? " selected" : "")}
                  onClick={() => selectStore(s.domain)}
                >
                  <div>
                    <strong>{s.name}</strong>{" "}
                    <span className="muted small">({s.currency})</span>
                  </div>
                  <div className="dom">{s.domain}</div>
                  <div className="row-actions">
                    <button
                      className="linklike"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeStore(s.domain);
                      }}
                    >
                      verwijderen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* -------- Hoofdkolom -------- */}
          <div>
            <div className="card">
              <h2>
                ⇪ Product URLs
                <span style={{ marginLeft: "auto" }}>
                  {selectedStore ? (
                    <span className="badge badge-green">✓ {selectedStore.name}</span>
                  ) : (
                    <span className="badge badge-amber">! No store selected</span>
                  )}
                </span>
              </h2>

              <div className="seg" style={{ marginBottom: 10 }}>
                <button className={tab === "urls" ? "on" : ""} onClick={() => setTab("urls")}>
                  URL's plakken
                </button>
                <button className={tab === "sheet" ? "on" : ""} onClick={() => setTab("sheet")}>
                  Sheet plakken
                </button>
              </div>

              {tab === "urls" && (
                <>
                  <div className="field-label">Paste product URLs — one per line</div>
                  <textarea
                    placeholder={"https://yourcompetitor.com/products/example-product\nhttps://yourcompetitor.com/products/another-product"}
                    value={urlsText}
                    onChange={(e) => setUrlsText(e.target.value)}
                    rows={5}
                  />
                  <div className="hint">
                    {urls.length > 0 ? `${urls.length} geldige URLs gedetecteerd` : "No valid URLs detected"}
                  </div>
                </>
              )}

              {tab === "sheet" && (
                <>
                  <div className="field-label">Werk-sheet (van de Product Scraper)</div>
                  <input
                    type="text"
                    placeholder="Sheet ID of volledige URL"
                    value={sheetId}
                    onChange={(e) => setSheetId(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Tabblad (bv. het run-tabblad — leeg = eerste blad)"
                    value={sheetTab}
                    onChange={(e) => setSheetTab(e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                  <div className="kw-row" style={{ gridTemplateColumns: "1fr auto" }}>
                    <input
                      type="text"
                      placeholder="Filter op keyword (optioneel)"
                      value={sheetKeywordFilter}
                      onChange={(e) => setSheetKeywordFilter(e.target.value)}
                    />
                    <button className="btn-ghost btn-small" onClick={loadSheet} disabled={sheetBusy || !sheetId}>
                      {sheetBusy ? "Laden…" : "Sheet laden"}
                    </button>
                  </div>
                  <div className="toggle-row">
                    <button
                      className={"switch" + (skipTagged ? " on" : "")}
                      onClick={() => setSkipTagged(!skipTagged)}
                      type="button"
                    />
                    Rijen met Dubbel/Twijfel-tags (kolom G/H) overslaan
                  </div>
                  {sheetMsg && <div className="hint">{sheetMsg}</div>}
                </>
              )}

              <div className="field-label">
                Required keyword <span className="opt">(optional)</span>
              </div>
              <input
                type="text"
                placeholder="e.g. orthopedic sandals"
                value={requiredKeyword}
                onChange={(e) => setRequiredKeyword(e.target.value)}
              />
              <div className="hint">Forces this keyword into the title for all URLs in this batch.</div>

              <div className="field-label">
                Tags <span className="opt">(optional)</span>
              </div>
              <input
                type="text"
                placeholder="e.g. summer-sale, new-arrivals"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
              <div className="hint">Comma-separated tags applied to every product in this batch.</div>

              <div className="field-label">Discount on compare-at price</div>
              <div className="seg">
                {["None", 10, 20, 30, 40, 50].map((d) => {
                  const val = d === "None" ? 0 : d;
                  return (
                    <button
                      key={d}
                      className={discount === val ? "on" : ""}
                      onClick={() => setDiscount(val)}
                    >
                      {d === "None" ? "None" : d + "%"}
                    </button>
                  );
                })}
                <button className={discount === "custom" ? "on" : ""} onClick={() => setDiscount("custom")}>
                  Custom %
                </button>
                {discount === "custom" && (
                  <input
                    type="number"
                    style={{ width: 80 }}
                    placeholder="35"
                    value={customDiscount}
                    onChange={(e) => setCustomDiscount(e.target.value)}
                  />
                )}
              </div>
              <div className="hint">
                {discountPct > 0
                  ? `Compare-at price will be set to show ${discountPct}% off.`
                  : "Geen doorgestreepte prijs."}
              </div>

              <div className="field-label">Product status</div>
              <div className="seg">
                <button className={status === "draft" ? "on" : ""} onClick={() => setStatus("draft")}>
                  Draft
                </button>
                <button className={status === "active" ? "on" : ""} onClick={() => setStatus("active")}>
                  Active
                </button>
              </div>

              <div className="field-label">Listing stijl</div>
              <div className="seg">
                <button
                  className={listingStyle === "stacking" ? "on" : ""}
                  onClick={() => setListingStyle("stacking")}
                >
                  Keyword stacking
                </button>
                <button
                  className={listingStyle === "attribute" ? "on" : ""}
                  onClick={() => setListingStyle("attribute")}
                >
                  Attribuut stijl
                </button>
              </div>

              <div className="toggle-row">
                <button
                  className={"switch" + (genderPrefix ? " on" : "")}
                  onClick={() => setGenderPrefix(!genderPrefix)}
                  type="button"
                />
                Gender prefix in title (Women's …)
              </div>
              <div className="toggle-row">
                <button
                  className={"switch" + (forceMens ? " on" : "")}
                  onClick={() => setForceMens(!forceMens)}
                  type="button"
                />
                Force men's keywords (voor stores zonder apart men-template)
              </div>
              <div className="toggle-row">
                <button
                  className={"switch" + (currencyOverride ? " on" : "")}
                  onClick={() => setCurrencyOverride(!currencyOverride)}
                  type="button"
                />
                Manual currency override
              </div>
              {currencyOverride ? (
                <div className="kw-row" style={{ gridTemplateColumns: "220px 1fr" }}>
                  <input
                    type="number"
                    step="0.0001"
                    placeholder="Koers bron → store (bv. 0.62)"
                    value={manualRate}
                    onChange={(e) => setManualRate(e.target.value)}
                  />
                  <span className="hint">Bronprijs × deze koers = storeprijs</span>
                </div>
              ) : (
                <div className="hint">
                  Currency is auto-detected per store and converted automatically — only turn this on to force a
                  specific from/to rate if that ever goes wrong.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 6 }}>
                <div>
                  <div className="field-label">Color label</div>
                  <div className="seg">
                    <button className={colorLabel === "Color" ? "on" : ""} onClick={() => setColorLabel("Color")}>
                      Color
                    </button>
                    <button className={colorLabel === "Colour" ? "on" : ""} onClick={() => setColorLabel("Colour")}>
                      Colour
                    </button>
                  </div>
                </div>
                <div>
                  <div className="field-label">Size label</div>
                  <input type="text" value={sizeLabel} onChange={(e) => setSizeLabel(e.target.value)} />
                </div>
                <div>
                  <div className="field-label">Theme template</div>
                  <div className="seg">
                    <button
                      className={themeTemplate === "standard" ? "on" : ""}
                      onClick={() => setThemeTemplate("standard")}
                    >
                      Standard
                    </button>
                    <button className={themeTemplate === "men" ? "on" : ""} onClick={() => setThemeTemplate("men")}>
                      Men
                    </button>
                  </div>
                </div>
              </div>

              <div className="field-label" style={{ marginTop: 18 }}>
                Import-log sheet <span className="opt">(werkboek — tabblad "Import-log")</span>
              </div>
              <input
                type="text"
                placeholder="Sheet ID of volledige URL — leeg = geen log"
                value={logSheet}
                onChange={(e) => {
                  setLogSheet(e.target.value);
                  save(LS.logSheet, e.target.value);
                }}
              />
              <div className="hint">
                Na elke import schrijft de tool hier een regel bij: datum, store, titel, status en de
                admin- én preview-link (preview werkt ook voor drafts).
              </div>

              <div style={{ marginTop: 16 }}>
                <button className="btn" disabled={!canImport} onClick={runImport}>
                  {running ? step || `Bezig… ${progress.done}/${progress.total}` : "⇪ Import products"}
                </button>
                {!selectedStore && (
                  <div className="hint" style={{ textAlign: "center" }}>
                    Select a store from the sidebar to enable importing.
                  </div>
                )}
              </div>

              {(running || logs.length > 0) && (
                <div style={{ marginTop: 14 }}>
                  <div className="progressbar">
                    <div
                      style={{
                        width: progress.total ? (progress.done / progress.total) * 100 + "%" : "0%",
                      }}
                    />
                  </div>
                  <div>
                    {logs.map((l, i) => (
                      <div className="log" key={i}>
                        {l.info ? (
                          <span className="muted">{l.text}</span>
                        ) : l.ok ? (
                          <>
                            <span className="ok">✓</span>
                            <span style={{ flex: 1 }}>{l.text}</span>
                            <a className="linklike" href={l.href} target="_blank" rel="noreferrer">
                              open in Shopify
                            </a>
                          </>
                        ) : (
                          <>
                            <span className="err">✗</span>
                            <span className="err" style={{ flex: 1 }}>
                              {l.text}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* -------- URL Queue -------- */}
            <div className="card">
              <h2>≣ URL Queue</h2>
              <textarea
                placeholder="Paste URLs or collection links to save for later…"
                value={queueText}
                onChange={(e) => setQueueText(e.target.value)}
                rows={3}
              />
              <div className="kw-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <input
                  type="text"
                  placeholder="Tag (optioneel, bv. jackets&coats)"
                  value={queueTag}
                  onChange={(e) => setQueueTag(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Keyword (optioneel)"
                  value={queueKeyword}
                  onChange={(e) => setQueueKeyword(e.target.value)}
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="btn-ghost" onClick={saveToQueue} disabled={!queueText.trim()}>
                  Save to queue
                </button>
              </div>
              {queue.length === 0 ? (
                <div className="hint" style={{ textAlign: "center", marginTop: 10 }}>
                  No saved URLs yet.
                </div>
              ) : (
                <table className="mini-table" style={{ marginTop: 10 }}>
                  <tbody>
                    {queue.map((q) => (
                      <tr key={q.id}>
                        <td>
                          <strong>{q.urls.length} URLs</strong>
                          {q.tag ? ` · tag: ${q.tag}` : ""}
                          {q.keyword ? ` · keyword: ${q.keyword}` : ""}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button className="linklike" onClick={() => loadQueueEntry(q)}>
                            laden
                          </button>{" "}
                          <button className="linklike" onClick={() => removeQueueEntry(q.id)}>
                            verwijderen
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
