"use client";

// Bestemmingskiezer zoals bij TUI: scrollbare lijst met landen, klik op een
// land → de gebieden klappen open. Elk gebied los aan te vinken, of het hele
// land in één keer. Zoeken filtert op land én gebied.
import { useMemo, useState } from "react";
import { countriesWithDests } from "@/lib/reis/destinations";

export default function DestPicker({ selected, onChange, month }) {
  const all = useMemo(() => countriesWithDests(), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});
  const sel = new Set(selected);
  const ql = q.trim().toLowerCase();

  const list = all
    .map((c) => {
      if (!ql) return c;
      const countryHit = c.country.toLowerCase().includes(ql);
      const dests = countryHit ? c.dests : c.dests.filter((d) => d.city.toLowerCase().includes(ql));
      return dests.length ? { ...c, dests } : null;
    })
    .filter(Boolean);

  function toggleDest(id) {
    onChange(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  function toggleCountry(c) {
    const ids = c.dests.map((d) => d.id);
    const allOn = ids.every((id) => sel.has(id));
    onChange(allOn ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])]);
  }

  const m = month != null ? month : null;

  return (
    <div className="rp-dp">
      <div className="rp-dp-search">
        <input className="rp-input" placeholder="Zoek een land of gebied" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Zoek een land of gebied" />
        {selected.length > 0 && <button className="rp-link" onClick={() => onChange([])}>Wis keuze ({selected.length})</button>}
      </div>
      <div className="rp-dp-list" role="list">
        {list.map((c) => {
          const ids = c.dests.map((d) => d.id);
          const on = ids.filter((id) => sel.has(id)).length;
          const state = on === 0 ? "none" : on === ids.length ? "all" : "some";
          const single = c.dests.length === 1;
          const isOpen = !single && (open[c.country] || Boolean(ql));
          return (
            <div key={c.country} className={"rp-dp-country" + (isOpen ? " open" : "")} role="listitem">
              <div className="rp-dp-row">
                <button className={"rp-dp-check " + state} onClick={() => (single ? toggleDest(c.dests[0].id) : toggleCountry(c))} aria-label={`${c.country} ${state === "all" ? "uitvinken" : "aanvinken"}`}>
                  <span aria-hidden="true" />
                </button>
                <button className="rp-dp-name" onClick={() => (single ? toggleDest(c.dests[0].id) : setOpen((o) => ({ ...o, [c.country]: !o[c.country] })))} aria-expanded={single ? undefined : isOpen}>
                  <b>{c.country}</b>
                  {single ? (
                    c.dests[0].city !== c.country && <span className="rp-dp-sub">{c.dests[0].city}</span>
                  ) : (
                    <span className="rp-dp-sub">{on ? `${on} van ${ids.length} gekozen` : `${ids.length} gebieden`}</span>
                  )}
                  {single && m != null && <span className="rp-dp-temp">{c.dests[0].temp[m]}°</span>}
                  {!single && <span className="rp-dp-chev" aria-hidden="true" />}
                </button>
              </div>
              {isOpen && (
                <div className="rp-dp-regions">
                  <button className={"rp-dp-all" + (state === "all" ? " on" : "")} onClick={() => toggleCountry(c)}>
                    {state === "all" ? `Heel ${c.country} gekozen` : `Kies heel ${c.country}`}
                  </button>
                  {c.dests.map((d) => (
                    <label key={d.id} className={"rp-dp-region" + (sel.has(d.id) ? " on" : "")}>
                      <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggleDest(d.id)} />
                      <span className="rp-check" aria-hidden="true" />
                      <span className="nm">{d.city}</span>
                      {m != null && <span className="rp-dp-temp">{d.temp[m]}°</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!list.length && <p className="rp-hint" style={{ padding: 12 }}>Niets gevonden voor "{q}".</p>}
      </div>
    </div>
  );
}
