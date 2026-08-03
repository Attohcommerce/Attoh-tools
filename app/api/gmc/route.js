import { NextResponse } from "next/server";

export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function getPage(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status };
    const html = await res.text();
    return { ok: true, html, finalUrl: res.url };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function findLink(html, patterns) {
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const l of links) {
    const low = l.toLowerCase();
    if (patterns.some((p) => low.includes(p))) return l;
  }
  return null;
}

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export async function POST(req) {
  const { url } = await req.json().catch(() => ({}));
  if (!url) return NextResponse.json({ error: "url ontbreekt" }, { status: 400 });

  let base = String(url).trim();
  if (!/^https?:\/\//i.test(base)) base = "https://" + base;
  base = base.replace(/\/$/, "");

  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail }); // status: pass | fail | warn

  const home = await getPage(base);
  if (!home.ok) {
    return NextResponse.json({
      ok: true,
      checks: [{ name: "Site bereikbaar", status: "fail", detail: `Homepage niet te laden (${home.status || home.error})` }],
    });
  }
  add("Site bereikbaar (https)", home.finalUrl.startsWith("https") ? "pass" : "fail", home.finalUrl);

  const html = home.html;
  const text = textOf(html);

  // Policy-pagina's zoeken via footer-links
  const policyPages = {
    "Return & Refund Policy": ["return", "refund"],
    "Shipping Policy": ["shipping"],
    "Privacy Policy": ["privacy"],
    "Terms & Conditions": ["terms"],
    "Contact": ["contact"],
    "About": ["about"],
    "Track": ["track", "parcelpanel"],
  };

  const pageTexts = {};
  for (const [label, pats] of Object.entries(policyPages)) {
    const link = findLink(html, pats);
    if (!link) {
      add(`${label}-pagina gelinkt`, label === "About" || label === "Track" ? "warn" : "fail", "Geen link gevonden op de homepage");
      continue;
    }
    const full = link.startsWith("http") ? link : base + (link.startsWith("/") ? link : "/" + link);
    const page = await getPage(full);
    if (!page.ok) {
      add(`${label}-pagina gelinkt`, "fail", `Link gevonden maar pagina laadt niet (${page.status || page.error})`);
      continue;
    }
    pageTexts[label] = textOf(page.html);
    add(`${label}-pagina gelinkt`, "pass", full);
  }

  // Contactgegevens
  const allText = text + " " + Object.values(pageTexts).join(" ");
  add(
    "E-mailadres zichtbaar",
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(allText) ? "pass" : "fail",
    "GMC wil een bereikbaar contactpunt (e-mail) op de site"
  );
  add(
    "Telefoonnummer zichtbaar",
    /(\+\d{1,3}[\s\-.]?)?(\(?\d{2,4}\)?[\s\-.]?)?\d{3}[\s\-.]?\d{3,4}([\s\-.]?\d{2,4})?/.test(allText.replace(/\d{4}-\d{2}-\d{2}/g, "")) ? "pass" : "warn",
    "Aanbevolen: telefoonnummer als tweede contactpunt"
  );
  add(
    "Fysiek adres zichtbaar",
    /\d{1,5}\s+[a-z]+\s+(st|street|ave|avenue|road|rd|blvd|lane|ln|drive|dr)\b/.test(allText) || /\b\d{5}\b/.test(allText) ? "pass" : "warn",
    "Zakelijk adres hoort vindbaar te zijn (footer of contact/about)"
  );

  // Retour-inhoud
  const ret = pageTexts["Return & Refund Policy"] || "";
  add(
    "Retourtermijn in dagen genoemd",
    /\b\d{1,3}\s*(day|days|dagen)\b/.test(ret) ? "pass" : ret ? "fail" : "warn",
    ret ? "Controleer dat de termijn overal op de site gelijk is" : "Return-pagina niet gevonden/geladen"
  );

  // Shipping-inhoud
  const ship = pageTexts["Shipping Policy"] || "";
  add(
    "Levertijden genoemd in Shipping Policy",
    /\b\d{1,3}\s*(-|–|tot|to)?\s*\d{0,3}\s*(business days|werkdagen|days|dagen)\b/.test(ship) ? "pass" : ship ? "fail" : "warn",
    ship ? "Levertijd moet overeenkomen met GMC-instellingen" : "Shipping-pagina niet gevonden/geladen"
  );

  // Verboden/risico-claims
  const redFlags = [
    ["money-back guarantee", "money back guarantee"],
    ["gratis-claims", "100% free"],
    ["valse urgentie (countdown)", "countdown"],
  ];
  for (const [label, needle] of redFlags) {
    add(
      `Geen "${needle}" op homepage`,
      text.includes(needle) ? "warn" : "pass",
      text.includes(needle) ? `"${needle}" gevonden — check of dit waar/onderbouwd is` : ""
    );
  }

  // Betaalmethoden zichtbaar
  add(
    "Betaalmethoden zichtbaar op homepage",
    /(visa|mastercard|amex|american express|paypal|ideal|shop pay|apple pay|google pay|klarna)/.test(text) ? "pass" : "warn",
    "Payment-iconen in de footer worden aangeraden"
  );

  // Producten aanwezig
  const prod = await getPage(base + "/products.json?limit=1");
  let productCount = null;
  if (prod.ok) {
    try {
      const data = JSON.parse(prod.html);
      productCount = (data.products || []).length;
    } catch {}
  }
  add(
    "Producten publiek benaderbaar",
    productCount ? "pass" : "warn",
    productCount ? "products.json bereikbaar" : "Kon products.json niet lezen"
  );

  return NextResponse.json({ ok: true, checks });
}
