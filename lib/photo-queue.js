// FOTO-WACHTRIJ (10-11-2026, projectdoc 136) — AI-modelfoto's na import.
// De importer zet per gekozen product + kleur een opdracht klaar (Redis).
// Claude haalt de opdrachten op via /api/photo-queue/agent (sleutel), maakt
// de foto's via Higgsfield en meldt per opdracht de foto-URL terug; de tool
// zet de foto op het product bij de juiste kleurvariant + fitnote.
import crypto from "crypto";
import { storeRequest, cleanDomain, setProductMetafields } from "./shopify";
import { getRedis } from "./kw-memory";
import { nsKey, normOrg } from "./org";
import { needsModel, NS, KEY_HEIGHT, KEY_SIZE } from "./fit-note";
import { PHOTO_SETTINGS, GARMENT_RULES, PHOTO_BLOCK, PERSON_RULES, PROFILES, genderOf, framingOf } from "./photo-brain";

const K = {
  items: (org) => nsKey(org, "photo:items"), // hash: itemId → json
  stores: (org) => nsKey(org, "photo:stores"), // hash: domein → store-koppeling (alleen server)
  key: () => "photo:agentkey", // één sleutel voor Claude (niet per organisatie)
};
function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shopReq(store, path, method = "GET", body) {
  let r;
  for (let i = 0; i < 5; i++) {
    r = await storeRequest(store, path, method, body);
    if (r.ok) return r;
    if (!(r.status === 429 || /exceeded|too many|throttl/i.test(String(r.error || "")))) return r;
    await sleep(800 + i * 700);
  }
  return r;
}

export async function agentKey() {
  const r = await getRedis();
  let k = await r.get(K.key());
  if (!k) {
    k = "pq_" + crypto.randomBytes(18).toString("hex");
    await r.set(K.key(), k);
  }
  return k;
}
export async function checkAgentKey(given) {
  const k = await agentKey();
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(k);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function allItems(org) {
  const r = await getRedis();
  const h = await r.hGetAll(K.items(org));
  return Object.values(h || {}).map((v) => {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }).filter(Boolean);
}
async function saveItem(org, it) {
  const r = await getRedis();
  await r.hSet(K.items(org), it.id, JSON.stringify(it));
}

const colorOption = (p) => (p.options || []).find((o) => /^(colou?r|kleur|farbe|couleur)$/i.test(String(o.name || "").trim())) || null;

/** enqueue({ org, store, productIds, mode, per }) → { ok, added, skipped[], batch } */
export async function enqueue({ org: orgIn, store, productIds, mode = "5050", per = 1 }) {
  const org = normOrg(orgIn);
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const ids = [...new Set((productIds || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean))];
  if (!ids.length) throw httpErr(400, "Geen producten gekozen");
  if (ids.length > 150) throw httpErr(400, "Maximaal 150 producten per keer");
  const r = await getRedis();
  const domain = cleanDomain(store.domain);
  await r.hSet(K.stores(org), domain, JSON.stringify({ name: store.name || "", domain: store.domain, currency: store.currency || "", token: store.token || "", clientId: store.clientId || "", clientSecret: store.clientSecret || "" }));
  const existing = await allItems(org);
  const have = new Set(existing.filter((x) => x.status === "pending").map((x) => `${x.domain}|${x.productId}|${x.color}`));
  const batch = `${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${store.name || domain}`;
  const usedProfiles = { man: 0, vrouw: 0 };
  let added = 0;
  const skipped = [];
  for (const id of ids) {
    const g = await shopReq(store, `/products/${id}.json`);
    const p = g.ok && g.data ? g.data.product : null;
    if (!p) {
      skipped.push({ productId: id, why: g.error || "niet gevonden" });
      continue;
    }
    if (!needsModel(p)) {
      skipped.push({ productId: id, title: p.title, why: "geen modelfoto bij schoenen/tassen/accessoires" });
      continue;
    }
    const images = p.images || [];
    if (!images.length) {
      skipped.push({ productId: id, title: p.title, why: "geen bronfoto" });
      continue;
    }
    const co = colorOption(p);
    const pos = co ? co.position : 0;
    const colors = co ? co.values : [""];
    const take = mode === "all" ? colors.length : Math.max(1, Math.ceil(colors.length / 2));
    const gender = genderOf(p);
    for (const color of colors.slice(0, take)) {
      const variants = (p.variants || []).filter((v) => !co || String(v[`option${pos}`]) === String(color));
      const imgId = (variants.find((v) => v.image_id) || {}).image_id;
      const img = images.find((x) => x.id === imgId) || (co ? null : images[0]) || (colors.indexOf(color) === 0 ? images[0] : null);
      if (!img) {
        skipped.push({ productId: id, title: p.title, why: `kleur ${color}: geen eigen foto gekoppeld` });
        continue;
      }
      if (have.has(`${domain}|${id}|${color}`)) continue;
      const pool = PROFILES[gender];
      const profile = pool[(usedProfiles[gender]++ + Math.floor(Math.random() * pool.length)) % pool.length];
      for (let n = 0; n < Math.max(1, Math.min(2, per)); n++) {
        const it = {
          id: crypto.randomBytes(6).toString("hex"),
          batch, domain, storeName: store.name || domain,
          productId: String(id), title: p.title, type: p.product_type || "", handle: p.handle,
          color: String(color || ""), variantIds: variants.map((v) => v.id), sourceImage: img.src, sourceImageId: img.id, sourcePosition: img.position,
          gender, profile, framing: framingOf(p), mode, shot: n + 1,
          status: "pending", createdAt: Date.now(),
        };
        await saveItem(org, it);
        added++;
      }
    }
  }
  return { ok: true, added, skipped, batch };
}

/** Overzicht voor de UI: per batch aantallen + laatste items. */
export async function listQueue(orgIn) {
  const org = normOrg(orgIn);
  const items = (await allItems(org)).sort((a, b) => b.createdAt - a.createdAt);
  const batches = {};
  for (const it of items) {
    const b = (batches[it.batch] = batches[it.batch] || { batch: it.batch, storeName: it.storeName, pending: 0, done: 0, failed: 0, total: 0, at: it.createdAt });
    b.total++;
    b[it.status === "done" ? "done" : it.status === "failed" ? "failed" : "pending"]++;
  }
  return {
    batches: Object.values(batches).sort((a, b) => b.at - a.at).slice(0, 20),
    items: items.slice(0, 200).map((it) => ({ id: it.id, batch: it.batch, title: it.title, color: it.color, status: it.status, resultUrl: it.resultUrl || "", reason: it.reason || "", scores: it.scores || null, productId: it.productId, domain: it.domain })),
  };
}

export async function clearQueue(orgIn, { batch, onlyDone } = {}) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const items = await allItems(org);
  let n = 0;
  for (const it of items) {
    if (batch && it.batch !== batch) continue;
    if (onlyDone && it.status === "pending") continue;
    await r.hDel(K.items(org), it.id);
    n++;
  }
  return { ok: true, removed: n };
}

/* ---------- agent (Claude) ---------- */
const ORGS = ["attoh", "sacollective"];

/** Openstaande opdrachten + het brein. Geen store-koppelingen in het antwoord. */
export async function agentNext({ limit = 12, store = "" } = {}) {
  const out = [];
  for (const org of ORGS) {
    for (const it of await allItems(org)) {
      if (it.status !== "pending") continue;
      if (store && !new RegExp(store, "i").test(`${it.storeName} ${it.domain}`)) continue;
      out.push({ org, id: it.id, store: it.storeName, title: it.title, type: it.type, color: it.color, gender: it.gender, sourceImage: it.sourceImage, profile: it.profile, framing: it.framing, shot: it.shot, mode: it.mode, createdAt: it.createdAt });
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return { ok: true, pending: out.length, items: out.slice(0, Math.max(1, Math.min(50, limit))), brain: { settings: PHOTO_SETTINGS, garmentRules: GARMENT_RULES, personRules: PERSON_RULES, photoBlock: PHOTO_BLOCK } };
}

/** Foto plaatsen: als beeld vóór de bronfoto van die kleur, gekoppeld aan de varianten; fitnote erbij. */
export async function agentDone({ org: orgIn, id, imageUrl, scores }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const raw = await r.hGet(K.items(org), String(id));
  if (!raw) throw httpErr(404, "Opdracht niet gevonden");
  const it = JSON.parse(raw);
  if (!/^https:\/\//.test(String(imageUrl || ""))) throw httpErr(400, "Geen geldige foto-URL");
  const sraw = await r.hGet(K.stores(org), cleanDomain(it.domain));
  if (!sraw) throw httpErr(400, "Store-koppeling niet meer bekend — zet de batch opnieuw klaar");
  const store = JSON.parse(sraw);
  // AI-foto's staan altijd vooraan in de galerij: de eerste op plek 1, volgende kleuren direct erachter.
  const frontPos = 1 + (await allItems(org)).filter((x) => x.productId === it.productId && x.status === "done" && x.id !== it.id).length;
  const body = { image: { src: imageUrl, position: frontPos, alt: String(it.title || "").split("|")[0].trim() + (it.color ? ` in ${it.color}` : ""), variant_ids: it.shot === 1 ? it.variantIds : [] } };
  const up = await shopReq(store, `/products/${it.productId}/images.json`, "POST", body);
  if (!up.ok) {
    it.status = "failed";
    it.reason = `Shopify: ${String(up.error || "upload mislukt").slice(0, 200)}`;
    await saveItem(org, it);
    return { ok: false, error: it.reason };
  }
  // Shopify zet een nieuwe foto niet altijd op de gevraagde plek → daarna nog eens hard op de plek zetten.
  const newImgId = up.data && up.data.image ? up.data.image.id : null;
  if (newImgId && Number(up.data.image.position) !== body.image.position) {
    await shopReq(store, `/products/${it.productId}/images/${newImgId}.json`, "PUT", { image: { id: newImgId, position: body.image.position } });
  }
  let fitnote = "";
  try {
    const mf = await setProductMetafields(store, [
      { productId: it.productId, namespace: NS, key: KEY_HEIGHT, type: "number_integer", value: String(it.profile.height) },
      { productId: it.productId, namespace: NS, key: KEY_SIZE, type: "single_line_text_field", value: String(it.profile.size) },
    ]);
    fitnote = mf.ok ? `Model is ${it.profile.height} cm and wears size ${it.profile.size}` : `fitnote mislukt: ${(mf.errors || []).join("; ").slice(0, 120)}`;
  } catch (e) {
    fitnote = `fitnote mislukt: ${String(e.message || e).slice(0, 120)}`;
  }
  it.status = "done";
  it.resultUrl = imageUrl;
  it.scores = scores || null;
  it.doneAt = Date.now();
  it.shopifyImageId = up.data && up.data.image ? up.data.image.id : null;
  await saveItem(org, it);
  return { ok: true, id: it.id, title: it.title, color: it.color, fitnote, adminUrl: `https://${cleanDomain(it.domain)}/admin/products/${it.productId}` };
}

export async function agentFail({ org: orgIn, id, reason, scores }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const raw = await r.hGet(K.items(org), String(id));
  if (!raw) throw httpErr(404, "Opdracht niet gevonden");
  const it = JSON.parse(raw);
  it.status = "failed";
  it.reason = String(reason || "afgekeurd").slice(0, 300);
  it.scores = scores || null;
  it.doneAt = Date.now();
  await saveItem(org, it);
  return { ok: true };
}

/** Bronfoto van een opdracht (verkleind) — zodat Claude origineel en resultaat kan vergelijken. */
export async function agentSource({ org: orgIn, id, width = 700 }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const raw = await r.hGet(K.items(org), String(id));
  if (!raw) throw httpErr(404, "Opdracht niet gevonden");
  const it = JSON.parse(raw);
  let u;
  try {
    u = new URL(String(it.sourceImage || ""));
  } catch {
    throw httpErr(400, "Geen bronfoto");
  }
  if (u.protocol !== "https:" || u.hostname !== "cdn.shopify.com") throw httpErr(400, "Bronfoto staat niet op Shopify");
  u.searchParams.set("width", String(Math.max(200, Math.min(1400, Number(width) || 700))));
  const res = await fetch(u.toString());
  if (!res.ok) throw httpErr(502, `Bronfoto ophalen mislukt (${res.status})`);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || "image/jpeg" };
}

/** Herstel: zet al geplaatste AI-foto's vooraan in de galerij (plek 1, 2, 3… per product, in volgorde van klaarzetten). */
export async function agentRepos({ org: orgIn }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const out = [];
  const byProduct = new Map();
  for (const it of await allItems(org)) {
    if (it.status !== "done" || !it.shopifyImageId) continue;
    const k = `${cleanDomain(it.domain)}|${it.productId}`;
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k).push(it);
  }
  for (const list of byProduct.values()) {
    list.sort((a, b) => (a.createdAt - b.createdAt) || (a.shot - b.shot) || String(a.id).localeCompare(String(b.id)));
    const sraw = await r.hGet(K.stores(org), cleanDomain(list[0].domain));
    if (!sraw) continue;
    const store = JSON.parse(sraw);
    for (let n = 0; n < list.length; n++) {
      const it = list[n];
      const res = await shopReq(store, `/products/${it.productId}/images/${it.shopifyImageId}.json`, "PUT", { image: { id: it.shopifyImageId, position: n + 1 } });
      out.push({ id: it.id, color: it.color, pos: n + 1, ok: !!res.ok, error: res.ok ? undefined : String(res.error || "").slice(0, 120) });
    }
  }
  return { ok: true, fixed: out };
}
