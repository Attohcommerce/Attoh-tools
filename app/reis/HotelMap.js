"use client";

// Kaart met hotels (Leaflet + OpenStreetMap/CARTO-kaart, gratis, geen key).
// Leaflet wordt pas geladen als er een kaart op het scherm komt.
import { useEffect, useRef, useState } from "react";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
let loading = null;

function loadLeaflet() {
  if (typeof window === "undefined") return Promise.reject(new Error("server"));
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = LEAFLET_JS;
    js.async = true;
    js.onload = () => resolve(window.L);
    js.onerror = () => { loading = null; reject(new Error("Kaart kon niet laden")); };
    document.head.appendChild(js);
  });
  return loading;
}

const eur = (n) => "€" + Math.round(n || 0).toLocaleString("nl-NL");

// hotels: [{id, name, lat, lng, price}] · single = één hotel, dichter ingezoomd
export default function HotelMap({ hotels, selectedId, hoverId, onPick, height = 320, single = false }) {
  const box = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const [err, setErr] = useState("");
  const pts = (hotels || []).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && (h.lat || h.lng));

  // kaart opbouwen
  useEffect(() => {
    let off = false;
    if (!pts.length) return;
    loadLeaflet()
      .then((L) => {
        if (off || !box.current) return;
        if (!map.current) {
          map.current = L.map(box.current, { zoomControl: true, scrollWheelZoom: !single ? false : true, attributionControl: true });
          L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
            maxZoom: 19,
            subdomains: "abcd",
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
          }).addTo(map.current);
        }
        Object.values(markers.current).forEach((m) => m.remove());
        markers.current = {};
        for (const h of pts) {
          const icon = L.divIcon({
            className: "rp-pin-wrap",
            html: `<span class="rp-pin">${single ? "Hotel" : h.price ? eur(h.price) : "•"}</span>`,
            iconSize: null,
          });
          const m = L.marker([h.lat, h.lng], { icon, title: h.name, riseOnHover: true }).addTo(map.current);
          m.bindTooltip(h.name, { direction: "top", offset: [0, -14] });
          if (onPick) m.on("click", () => onPick(h));
          markers.current[h.id] = m;
        }
        if (pts.length === 1) map.current.setView([pts[0].lat, pts[0].lng], single ? 15 : 14);
        else map.current.fitBounds(L.latLngBounds(pts.map((h) => [h.lat, h.lng])).pad(0.15));
        setTimeout(() => map.current && map.current.invalidateSize(), 50);
      })
      .catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [pts.map((h) => h.id + h.price).join(",")]); // eslint-disable-line

  // geselecteerd / hover markeren
  useEffect(() => {
    for (const [id, m] of Object.entries(markers.current)) {
      const el = m.getElement && m.getElement();
      if (!el) continue;
      el.classList.toggle("on", id === selectedId);
      el.classList.toggle("hover", id === hoverId);
      if (id === hoverId || id === selectedId) m.setZIndexOffset(1000);
      else m.setZIndexOffset(0);
    }
  }, [selectedId, hoverId, pts.length]);

  useEffect(() => () => { if (map.current) { map.current.remove(); map.current = null; } }, []);

  if (!pts.length) return <p className="rp-hint">Geen locatie bekend voor deze hotels.</p>;
  return (
    <div className="rp-map-wrap">
      <div ref={box} className="rp-map" style={{ height }} />
      {err && <p className="rp-hint">{err}</p>}
    </div>
  );
}

// Links naar de kaarten-app van het toestel: iPhone/iPad/Mac → Apple Kaarten
// eerst, anders Google Maps eerst. Allebei altijd beschikbaar.
export function mapLinks(hotel, city) {
  const q = `${hotel.name}${city ? " " + city : ""}`;
  const hasLL = Number.isFinite(hotel.lat) && Number.isFinite(hotel.lng);
  // Google zoekt op hotelnaam + stad (vindt de echte hotelpagina met foto's/reviews)
  const google = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const apple = hasLL
    ? `https://maps.apple.com/?q=${encodeURIComponent(hotel.name)}&ll=${hotel.lat},${hotel.lng}&z=16`
    : `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
  const isApple = typeof navigator !== "undefined" && /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent);
  const g = { label: "Bekijk in Google Maps", url: google };
  const a = { label: "Bekijk in Apple Kaarten", url: apple };
  return isApple ? [a, g] : [g, a];
}

// Pop-up met één hotel op de kaart
export function HotelMapModal({ hotel, city, place, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const links = mapLinks(hotel, city);
  return (
    <div className="rp-mapmodal" role="dialog" aria-modal="true" aria-label={`${hotel.name} op de kaart`}>
      <div className="rp-sheet-bg" onClick={onClose} />
      <div className="rp-mapmodal-box">
        <header>
          <div style={{ minWidth: 0 }}>
            <b>{hotel.name}</b>
            <span>{[place, hotel.address].filter(Boolean).join(", ") || city}</span>
          </div>
          <button className="rp-iconbtn" onClick={onClose} aria-label="Sluiten">✕</button>
        </header>
        <HotelMap hotels={[hotel]} single height={420} />
        <footer>
          {links.map((l, i) => (
            <a key={l.url} className={"rp-btn" + (i === 0 ? " pri" : "")} href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
          ))}
        </footer>
      </div>
    </div>
  );
}

// Klikbare locatieregel ("📍 Business Bay") die de kaart-pop-up opent
export function LocationLink({ hotel, city, place, onOpen }) {
  if (!(Number.isFinite(hotel.lat) && Number.isFinite(hotel.lng)) && !hotel.address) return null;
  const label = place || (hotel.address ? String(hotel.address).split(",")[0] : city) || "Bekijk locatie";
  return (
    <button className="rp-loc" onClick={onOpen} title="Bekijk op de kaart">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
