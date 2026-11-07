"use client";
// Kleine helpers voor de Pokémon-tool (browserkant).
import { orgLS } from "@/lib/org-client";

export const LS_STORES = "sa_stores"; // dezelfde Shopify-koppelingen als de Importer
export const LS_PICK = "pk_store";

export function loadStores() {
  try {
    return JSON.parse(orgLS.getItem(LS_STORES) || "[]") || [];
  } catch {
    return [];
  }
}
export function saveStores(list) {
  try {
    orgLS.setItem(LS_STORES, JSON.stringify(list));
  } catch {}
}
export function lsGet(k, fb) {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fb : JSON.parse(v);
  } catch {
    return fb;
  }
}
export function lsSet(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

/** Alleen de koppelgegevens (geen naam e.d.) naar de server. */
export function creds(s) {
  if (!s) return null;
  return { domain: s.domain, token: s.token || undefined, clientId: s.clientId || undefined, clientSecret: s.clientSecret || undefined };
}

/** POST met JSON, herkansing bij 502/503/504 of netwerkfout. */
export async function postJSON(url, body, { tries = 3 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const txt = await res.text();
      let data = null;
      try {
        data = JSON.parse(txt);
      } catch {
        data = null;
      }
      if (data && res.ok) return data;
      if (data && data.error && ![502, 503, 504].includes(res.status)) throw new Error(data.error);
      last = new Error(data && data.error ? data.error : `HTTP ${res.status}${res.status === 504 ? " (time-out)" : ""}`);
    } catch (e) {
      last = e;
      if (!/HTTP 50|time-out|fetch|network/i.test(String(e.message))) throw e;
    }
    await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
  }
  throw last || new Error("Mislukt");
}

export const money = (n, cur) => {
  const v = Number(n) || 0;
  if (!v) return "—";
  const sym = { EUR: "€", USD: "$", GBP: "£", AUD: "A$", CAD: "C$", NZD: "NZ$" }[cur] || (cur ? cur + " " : "");
  return sym + v.toFixed(2);
};

export const ago = (ts) => {
  if (!ts) return "nooit";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "net";
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} u geleden`;
  return `${Math.round(h / 24)} d geleden`;
};
