// Wijk/buurt van een hotel (bv. "Business Bay", "Jumeirah") via omgekeerd
// geocoderen met Photon (OpenStreetMap, gratis, geen key). 90 dagen cache.
import { cached } from "./store.js";

async function getJson(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "AttohReisplanner/1.0" }, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function placeLabel(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `place:${lat.toFixed(4)},${lng.toFixed(4)}`;
  return cached(key, 60 * 60 * 24 * 90, async () => {
    const j = await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en&limit=1`);
    const p = j && j.features && j.features[0] && j.features[0].properties;
    if (!p) return { label: "", city: "" };
    const label = p.district || p.locality || p.suburb || p.neighbourhood || p.city || p.county || "";
    return { label, city: p.city || p.county || "" };
  });
}

// meerdere tegelijk (max 4 parallel)
export async function placeLabels(points) {
  const out = {};
  const list = (points || []).slice(0, 40);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, list.length) }, async () => {
      while (i < list.length) {
        const pt = list[i++];
        try {
          const r = await placeLabel(Number(pt.lat), Number(pt.lng));
          if (r && r.label) out[pt.id] = r;
        } catch {}
      }
    })
  );
  return out;
}
