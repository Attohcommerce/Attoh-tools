// Live extra's per bestemming, zonder API-keys:
//  - wisselkoers euro → lokale munt (open.er-api.com, 12 uur cache)
//  - weersverwachting zodra de reis binnen 16 dagen begint (Open-Meteo)
import { DEST_BY_ID } from "./destinations.js";
import { countryInfo } from "./countryinfo.js";
import { cached } from "./store.js";

async function getJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function rates() {
  return cached("fx:eur", 60 * 60 * 12, async () => {
    const j = await getJson("https://open.er-api.com/v6/latest/EUR");
    return j && j.rates ? j.rates : null;
  });
}

async function coords(dest) {
  return cached(`geo:${dest.id}`, 60 * 60 * 24 * 90, async () => {
    const q = new URLSearchParams({ name: dest.lite, count: "1", language: "nl", countryCode: dest.cc });
    const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
    const r = j && j.results && j.results[0];
    return r ? { lat: r.latitude, lng: r.longitude } : null;
  });
}

// WMO-weercodes → korte Nederlandse omschrijving + icoon
function wmo(code) {
  if (code === 0) return ["Zonnig", "☀"];
  if (code <= 2) return ["Licht bewolkt", "🌤"];
  if (code === 3) return ["Bewolkt", "☁"];
  if (code <= 48) return ["Mist", "🌫"];
  if (code <= 67) return ["Regen", "🌧"];
  if (code <= 77) return ["Sneeuw", "❄"];
  if (code <= 82) return ["Buien", "🌦"];
  return ["Onweer", "⛈"];
}

export async function liveInfo(destId, depart, ret) {
  const dest = DEST_BY_ID[destId];
  if (!dest) throw new Error("Onbekende bestemming");
  const out = { rate: null, forecast: null };
  const info = countryInfo(dest, depart);
  const m = info && String(info.currency).match(/\(([A-Z]{3})\)/);
  const code = m ? m[1] : null;
  if (code) {
    try {
      const r = await rates();
      if (r && r[code]) out.rate = { code, perEur: r[code] };
    } catch {}
  }
  if (depart) {
    const days = Math.round((new Date(depart + "T12:00:00Z") - Date.now()) / 86400000);
    if (days <= 15 && days >= -30) {
      try {
        const c = await coords(dest);
        if (c) {
          const start = new Date(Math.max(Date.now(), new Date(depart + "T00:00:00Z").getTime())).toISOString().slice(0, 10);
          const endLimit = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
          const end = ret && ret < endLimit ? ret : endLimit;
          if (start <= end) {
            const q = new URLSearchParams({
              latitude: c.lat, longitude: c.lng, timezone: "auto", start_date: start, end_date: end,
              daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
            });
            const j = await cached(`wx:${dest.id}:${start}:${end}`, 60 * 60 * 3, () => getJson(`https://api.open-meteo.com/v1/forecast?${q}`));
            const d = j && j.daily;
            if (d && d.time) {
              out.forecast = d.time.map((date, i) => {
                const [label, icon] = wmo(d.weather_code[i]);
                return { date, max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max[i], label, icon };
              });
            }
          }
        }
      } catch {}
    }
  }
  return out;
}
