import { NextResponse } from "next/server";
import { getShopInfo, resolveToken, cleanDomain } from "@/lib/shopify";
import { storeProfile } from "@/lib/verdeling";

export const maxDuration = 60;

/* STORE DOCTOR — "Alle stores" voorcontrole (31-10-2026).
   Per store: werkt de koppeling, welke valuta en welk domein meldt Shopify
   zelf, welk store-profiel (markt, geslacht, schoenmaten) hoort erbij en
   welke rechten heeft de app. Er wordt NIETS aangepast. */

const PROFILE_MARKET = { USA: "USA", UK: "UK", AUS: "AUS+NZ", "AUS+NZ": "AUS+NZ", CAN: "CAN" };

async function accessScopes(store) {
  try {
    const t = await resolveToken(store);
    if (!t.ok) return [];
    const res = await fetch(`https://${cleanDomain(store.domain)}/admin/oauth/access_scopes.json`, {
      headers: { "X-Shopify-Access-Token": t.token },
    });
    const data = await res.json().catch(() => null);
    return data && Array.isArray(data.access_scopes) ? data.access_scopes.map((x) => x.handle) : [];
  } catch {
    return []; // onbekend = niet blokkeren
  }
}

async function checkOne(store) {
  const out = { domain: store.domain, ok: false, name: store.name || "", currency: store.currency || "", publicDomain: "", profile: null, scopes: [], problems: [] };
  try {
    const info = await getShopInfo(store);
    if (!info.ok) {
      out.problems.push({ level: "block", text: `koppeling werkt niet (${String(info.error || "").slice(0, 120)})` });
      return out;
    }
    out.ok = true;
    out.name = info.shop.name || out.name;
    out.currency = info.shop.currency || out.currency;
    out.publicDomain = info.shop.domain || "";
    const prof = storeProfile(out.publicDomain) || storeProfile(store.domain) || storeProfile(info.shop.myshopifyDomain);
    if (prof) {
      out.profile = {
        domain: prof.domain,
        market: PROFILE_MARKET[prof.market] || prof.market || "",
        genders: prof.genders || "",
        shoeLabels: prof.shoeLabels || "",
      };
    }
    // access_scopes staat NIET onder /admin/api/<versie>, dus zelf ophalen
    out.scopes = await accessScopes(store);
  } catch (e) {
    out.problems.push({ level: "block", text: String((e && e.message) || e).slice(0, 160) });
  }
  return out;
}

export async function POST(req) {
  const { stores } = await req.json().catch(() => ({}));
  if (!Array.isArray(stores) || !stores.length) {
    return NextResponse.json({ error: "Geen stores opgegeven" }, { status: 400 });
  }
  const results = [];
  // een paar tegelijk — snel, maar zonder Shopify's rate limit te raken
  for (let i = 0; i < stores.length; i += 4) {
    const part = await Promise.all(stores.slice(i, i + 4).map((s) => checkOne(s)));
    results.push(...part);
  }
  return NextResponse.json({ ok: true, stores: results });
}
