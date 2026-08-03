import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/* ------------------------------------------------------------------
   Locatie — komt van de Vercel edge headers, dus automatisch het land
   waar de gebruiker zélf zit. Lokaal (geen Vercel) valt hij terug.
------------------------------------------------------------------ */
const FALLBACK = {
  city: "Amsterdam",
  country: "NL",
  latitude: 52.37,
  longitude: 4.89,
  timezone: "Europe/Amsterdam",
  approximate: true,
};

function readGeo() {
  const h = headers();
  const lat = parseFloat(h.get("x-vercel-ip-latitude"));
  const lon = parseFloat(h.get("x-vercel-ip-longitude"));
  const country = (h.get("x-vercel-ip-country") || "").toUpperCase();

  if (!country || Number.isNaN(lat) || Number.isNaN(lon)) return FALLBACK;

  let city = h.get("x-vercel-ip-city") || "";
  try {
    city = decodeURIComponent(city);
  } catch {
    /* laat staan zoals het is */
  }

  return {
    city: city || country,
    country,
    region: h.get("x-vercel-ip-country-region") || "",
    latitude: lat,
    longitude: lon,
    timezone: h.get("x-vercel-ip-timezone") || "",
    approximate: false,
  };
}

/* ------------------------------------------------------------------
   Weer — Open-Meteo, gratis en zonder API-key
------------------------------------------------------------------ */
const WMO = {
  0: ["Clear sky", "sun"],
  1: ["Mainly clear", "sun"],
  2: ["Partly cloudy", "cloud-sun"],
  3: ["Overcast", "cloud"],
  45: ["Fog", "fog"],
  48: ["Rime fog", "fog"],
  51: ["Light drizzle", "rain"],
  53: ["Drizzle", "rain"],
  55: ["Heavy drizzle", "rain"],
  56: ["Freezing drizzle", "rain"],
  57: ["Freezing drizzle", "rain"],
  61: ["Light rain", "rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "rain"],
  66: ["Freezing rain", "rain"],
  67: ["Freezing rain", "rain"],
  71: ["Light snow", "snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "snow"],
  77: ["Snow grains", "snow"],
  80: ["Rain showers", "rain"],
  81: ["Rain showers", "rain"],
  82: ["Heavy showers", "rain"],
  85: ["Snow showers", "snow"],
  86: ["Snow showers", "snow"],
  95: ["Thunderstorm", "storm"],
  96: ["Thunderstorm", "storm"],
  99: ["Thunderstorm", "storm"],
};

async function getWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`;

  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const d = await res.json();
  const c = d.current || {};
  const code = Number(c.weather_code);
  const [label, icon] = WMO[code] || ["—", "cloud"];

  return {
    temp: Math.round(Number(c.temperature_2m)),
    feels: Math.round(Number(c.apparent_temperature)),
    wind: Math.round(Number(c.wind_speed_10m)),
    isDay: c.is_day === 1,
    label,
    icon,
    high: d.daily ? Math.round(d.daily.temperature_2m_max[0]) : null,
    low: d.daily ? Math.round(d.daily.temperature_2m_min[0]) : null,
  };
}

/* ------------------------------------------------------------------
   Nieuws — Google News RSS, per land en in de taal van dat land
------------------------------------------------------------------ */
const LANG = {
  NL: "nl", BE: "nl", DE: "de", AT: "de", CH: "de",
  FR: "fr", ES: "es", MX: "es", AR: "es", IT: "it",
  PT: "pt-PT", BR: "pt-BR", PL: "pl", SE: "sv", NO: "no",
  DK: "da", FI: "fi", TR: "tr", JP: "ja", KR: "ko",
  CN: "zh-CN", TW: "zh-TW", RU: "ru", GR: "el", CZ: "cs",
  HU: "hu", RO: "ro", UA: "uk", ID: "id", TH: "th", VN: "vi",
};

function newsUrl(country) {
  const lang = LANG[country] || "en";
  const short = lang.split("-")[0];
  const hl = lang === "en" ? `en-${country}` : lang;
  return `https://news.google.com/rss?hl=${hl}&gl=${country}&ceid=${country}:${short}`;
}

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

async function getNews(country) {
  const res = await fetch(newsUrl(country), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AttohTools/1.0)" },
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`news ${res.status}`);
  const xml = await res.text();

  const items = [];
  const blocks = xml.split("<item>").slice(1, 9);
  for (const b of blocks) {
    let title = pick(b, "title");
    const source = pick(b, "source");
    // Google zet " - Bron" achter elke titel; die halen we eraf
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3));
    }
    const link = pick(b, "link");
    const pub = pick(b, "pubDate");
    if (title) items.push({ title, source, link, publishedAt: pub });
    if (items.length >= 6) break;
  }
  return items;
}

/* ------------------------------------------------------------------ */

export async function GET() {
  const location = readGeo();

  const [weather, news] = await Promise.all([
    getWeather(location.latitude, location.longitude).catch(() => null),
    getNews(location.country).catch(() => []),
  ]);

  return NextResponse.json({ location, weather, news });
}
