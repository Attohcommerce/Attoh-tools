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
import { PHOTO_SETTINGS, GARMENT_RULES, PHOTO_BLOCK, PERSON_RULES, genderOf, framingOf, shotPlan, buildPrompt, profilePicker } from "./photo-brain";
import { judgeGalleryBatch, checkGarmentMatch } from "./ai";

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

/** enqueue({ org, store, productIds, mode, per, engine }) → { ok, added, skipped[], picked[], batch, judged }
    mode:   5050 | all | ai   (ai = vision geeft de galerij een cijfer; alleen cijfer ≤ 6 krijgt foto's, daarna 50-50;
            mooie sets modelfoto's worden overgeslagen, 1 foto / mockup / leveranciersfoto krijgt wel foto's — zie galleryVerdict in het brein)
    per:    1–4 foto's per kleur (indeling: zie SHOT_PLAN in het brein)
    engine: claude (Higgsfield via Claude) | openai (de tool maakt ze zelf) */
export async function enqueue({ org: orgIn, store, productIds, mode = "5050", per = 1, engine = "claude", batch: batchIn = "" }) {
  const org = normOrg(orgIn);
  if (!store || !store.domain) throw httpErr(400, "Kies een store");
  const ids = [...new Set((productIds || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean))];
  if (!ids.length) throw httpErr(400, "Geen producten gekozen");
  if (ids.length > 500) throw httpErr(400, "Maximaal 500 producten per keer");
  const T0 = Date.now();
  const timeLeft = () => 265000 - (Date.now() - T0); // de route mag 300 s duren; ruim daarvoor netjes afronden
  if (engine === "openai" && !process.env.OPENAI_API_KEY) throw httpErr(400, "OpenAI API staat nog niet aan (OPENAI_API_KEY ontbreekt in Vercel)");
  const r = await getRedis();
  const domain = cleanDomain(store.domain);
  await r.hSet(K.stores(org), domain, JSON.stringify({ name: store.name || "", domain: store.domain, currency: store.currency || "", token: store.token || "", clientId: store.clientId || "", clientSecret: store.clientSecret || "" }));
  const existing = await allItems(org);
  const have = new Set(existing.filter((x) => x.status === "pending" || x.status === "working").map((x) => `${x.domain}|${x.productId}|${x.color}`));
  // 13-11: producten/kleuren die al AI-foto's van ons hebben, nooit opnieuw doen (ook niet bij per ongeluk opnieuw selecteren)
  const madeColor = new Set(existing.filter((x) => x.status === "done").map((x) => `${x.domain}|${x.productId}|${x.color}`));
  const madeProduct = new Set(existing.filter((x) => x.status === "done").map((x) => `${x.domain}|${x.productId}`));
  // batch: de importer stuurt bij een grote selectie meerdere stukken; die horen in één batch
  const batch = String(batchIn || "").slice(0, 90) || `${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${store.name || domain}`;
  const skipped = [];
  const picked = []; // AI kiest: producten die wél foto's krijgen, met cijfer en reden
  let added = 0;

  // 1. producten ophalen: 50 per aanroep (11-11: was één voor één, bij 200+ producten te traag door de Shopify-limiet).
  //    Wat zo niet terugkomt, wordt daarna nog los opgehaald (4 tegelijk).
  const found = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const g = await shopReq(store, `/products.json?ids=${part.join(",")}&limit=250`);
    for (const p of (g.ok && g.data && g.data.products) || []) found.set(String(p.id), p);
  }
  const missing = ids.filter((id) => !found.has(id));
  const notFound = new Map();
  for (let i = 0; i < missing.length; i += 4) {
    const part = await Promise.all(missing.slice(i, i + 4).map(async (id) => ({ id, g: await shopReq(store, `/products/${id}.json`) })));
    for (const { id, g } of part) {
      if (g.ok && g.data && g.data.product) found.set(id, g.data.product);
      else notFound.set(id, g.error || "niet gevonden");
    }
  }
  const products = [];
  for (const id of ids) {
    const p = found.get(id);
    if (!p) skipped.push({ productId: id, why: notFound.get(id) || "niet gevonden" });
    else if (!needsModel(p)) skipped.push({ productId: id, title: p.title, why: "geen modelfoto bij schoenen/tassen/accessoires" });
    else if (!(p.images || []).length) skipped.push({ productId: id, title: p.title, why: "geen bronfoto" });
    else if (/data-ai-photo/i.test(String(p.body_html || "")) || madeProduct.has(`${domain}|${id}`)) skipped.push({ productId: id, title: p.title, why: "heeft al AI-foto's van ons — overgeslagen" });
    else products.push(p);
  }

  // 2. AI kiest: de hele galerij een cijfer geven; mooie set = overslaan, dunne of zwakke galerij = maken
  const judge = new Map();
  let judgeUsd = 0;
  if (mode === "ai" && products.length) {
    const groups = [];
    for (let i = 0; i < products.length; i += 5) groups.push(products.slice(i, i + 5));
    for (let i = 0; i < groups.length; i += 6) {
      if (timeLeft() < 45000) {
        // tijd bijna op: de rest krijgt geen cijfer en dus geen foto's; nog een keer klikken pakt ze alsnog
        for (const grp of groups.slice(i)) for (const p of grp) judge.set(String(p.id), { score: 0, needs: false, why: "geen cijfer: tijd op, klik nog een keer voor de rest" });
        break;
      }
      await Promise.all(groups.slice(i, i + 6).map(async (grp) => {
        try {
          const out = await judgeGalleryBatch(grp.map((p, n) => ({ index: n, title: p.title, count: (p.images || []).length, images: (p.images || []).slice(0, 6).map((im) => im.src) })));
          judgeUsd += out.ai.usd || 0;
          for (const x of out.results) if (grp[x.index]) judge.set(String(grp[x.index].id), x);
        } catch (e) {
          for (const p of grp) judge.set(String(p.id), { score: 0, needs: false, why: `cijfer mislukt: ${String(e.message || e).slice(0, 60)}` });
        }
      }));
    }
  }

  // 3. opdrachten maken
  const pick = profilePicker();
  const plan = shotPlan(per);
  for (const p of products) {
    const id = String(p.id);
    const j = judge.get(id);
    if (mode === "ai") {
      if (!j) {
        skipped.push({ productId: id, title: p.title, why: "AI kiest: geen cijfer gekregen — overgeslagen" });
        continue;
      }
      if (!j.needs) {
        skipped.push({ productId: id, title: p.title, score: j.score, why: j.score ? `AI kiest: cijfer ${j.score} — ${j.why}` : `AI kiest: ${j.why}` });
        continue;
      }
      picked.push({ productId: id, title: p.title, score: j.score, photos: j.photos, why: j.why });
    }
    const images = p.images || [];
    const co = colorOption(p);
    const pos = co ? co.position : 0;
    const colors = co ? co.values : [""];
    const take = mode === "all" ? colors.length : Math.max(1, Math.ceil(colors.length / 2));
    const gender = genderOf(p);
    const profile = pick(gender); // één model per product
    const usedImg = new Map();
    for (const color of colors.slice(0, take)) {
      const variants = (p.variants || []).filter((v) => !co || String(v[`option${pos}`]) === String(color));
      const imgId = (variants.find((v) => v.image_id) || {}).image_id;
      const img = images.find((x) => x.id === imgId) || (co ? null : images[0]) || (colors.indexOf(color) === 0 ? images[0] : null);
      if (!img) {
        skipped.push({ productId: id, title: p.title, why: `kleur ${color}: geen eigen foto gekoppeld` });
        continue;
      }
      if (usedImg.has(img.id)) {
        skipped.push({ productId: id, title: p.title, why: `kleur ${color}: zelfde foto als ${usedImg.get(img.id)} — geen eigen bronfoto` });
        continue;
      }
      usedImg.set(img.id, color || "eerste kleur");
      if (have.has(`${domain}|${id}|${color}`)) continue;
      if (madeColor.has(`${domain}|${id}|${String(color || "")}`)) {
        skipped.push({ productId: id, title: p.title, why: `kleur ${color}: heeft al een AI-foto — overgeslagen` });
        continue;
      }
      for (let n = 0; n < plan.length; n++) {
        const it = {
          id: crypto.randomBytes(6).toString("hex"),
          batch, domain, storeName: store.name || domain,
          productId: id, title: p.title, type: p.product_type || "", handle: p.handle,
          color: String(color || ""), variantIds: variants.map((v) => v.id), sourceImage: img.src, sourceImageId: img.id, sourcePosition: img.position,
          gender, profile, framing: framingOf(p), mode, engine: engine === "openai" ? "openai" : "claude",
          shot: n + 1, shotType: plan[n], photoScore: j ? j.score : null, photoWhy: j ? j.why : "",
          status: "pending", createdAt: Date.now() + added,
        };
        await saveItem(org, it);
        added++;
      }
    }
  }
  return { ok: true, added, skipped, picked, batch, judged: judge.size, judgeUsd: Math.round(judgeUsd * 1000) / 1000 };
}

/** Overzicht voor de UI: per batch aantallen + laatste items. */
export async function listQueue(orgIn) {
  const org = normOrg(orgIn);
  const items = (await allItems(org)).sort((a, b) => b.createdAt - a.createdAt);
  const batches = {};
  for (const it of items) {
    const b = (batches[it.batch] = batches[it.batch] || { batch: it.batch, storeName: it.storeName, pending: 0, done: 0, failed: 0, skipped: 0, total: 0, usd: 0, engine: "claude", at: it.createdAt });
    b.total++;
    b[it.status === "done" ? "done" : it.status === "failed" ? "failed" : it.status === "skipped" ? "skipped" : "pending"]++;
    b.usd = (b.usd || 0) + (Number(it.usd) || 0);
    if (it.engine === "openai") b.engine = "openai";
  }
  return {
    batches: Object.values(batches).sort((a, b) => b.at - a.at).slice(0, 20),
    items: items.slice(0, 200).map((it) => ({ id: it.id, batch: it.batch, title: it.title, color: it.color, status: it.status, resultUrl: it.resultUrl || "", reason: it.reason || "", scores: it.scores || null, productId: it.productId, domain: it.domain, shotType: it.shotType || "front", engine: it.engine || "claude", photoScore: it.photoScore || null })),
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
      if (it.status !== "pending" || it.engine === "openai") continue;
      if (store && !new RegExp(store, "i").test(`${it.storeName} ${it.domain}`)) continue;
      out.push({ org, id: it.id, store: it.storeName, title: it.title, type: it.type, color: it.color, gender: it.gender, sourceImage: it.sourceImage, profile: it.profile, framing: it.framing, shot: it.shot, shotType: it.shotType || "front", mode: it.mode, createdAt: it.createdAt, prompt: buildPrompt({ ...it, hasModelRef: false }) });
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return { ok: true, pending: out.length, items: out.slice(0, Math.max(1, Math.min(50, limit))), brain: { settings: PHOTO_SETTINGS, garmentRules: GARMENT_RULES, personRules: PERSON_RULES, photoBlock: PHOTO_BLOCK } };
}

/** Foto plaatsen: vooraan in de galerij, gekoppeld aan de varianten (alleen het vooraanzicht), fitnote, omschrijving.
    Bron is een URL (Higgsfield via Claude) of de bytes zelf als base64 (OpenAI). */
export async function placeResult({ org: orgIn, id, imageUrl, attachmentB64, ext = "jpg", scores, usd }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const raw = await r.hGet(K.items(org), String(id));
  if (!raw) throw httpErr(404, "Opdracht niet gevonden");
  const it = JSON.parse(raw);
  if (!attachmentB64 && !/^https:\/\//.test(String(imageUrl || ""))) throw httpErr(400, "Geen geldige foto");
  const sraw = await r.hGet(K.stores(org), cleanDomain(it.domain));
  if (!sraw) throw httpErr(400, "Store-koppeling niet meer bekend — zet de batch opnieuw klaar");
  const store = JSON.parse(sraw);
  const isFront = (it.shotType || "front") === "front" && it.shot === 1;
  // AI-foto's staan altijd vooraan in de galerij: de eerste op plek 1, volgende direct erachter.
  const frontPos = 1 + (await allItems(org)).filter((x) => x.productId === it.productId && x.domain === it.domain && x.status === "done" && x.id !== it.id).length;
  const alt = String(it.title || "").split("|")[0].trim() + (it.color ? ` in ${it.color}` : "");
  const image = { position: frontPos, alt, variant_ids: isFront ? it.variantIds : [] };
  if (attachmentB64) {
    image.attachment = attachmentB64;
    image.filename = `${String(it.handle || "product").slice(0, 60)}-${String(it.color || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${it.shotType || "front"}.${ext}`;
  } else image.src = imageUrl;
  const up = await shopReq(store, `/products/${it.productId}/images.json`, "POST", { image });
  if (!up.ok) {
    it.status = "failed";
    it.reason = `Shopify: ${String(up.error || "upload mislukt").slice(0, 200)}`;
    await saveItem(org, it);
    return { ok: false, error: it.reason };
  }
  // Shopify zet een nieuwe foto niet altijd op de gevraagde plek → daarna nog eens hard op de plek zetten.
  const newImgId = up.data && up.data.image ? up.data.image.id : null;
  const newSrc = up.data && up.data.image ? up.data.image.src : imageUrl;
  if (newImgId && Number(up.data.image.position) !== frontPos) {
    await shopReq(store, `/products/${it.productId}/images/${newImgId}.json`, "PUT", { image: { id: newImgId, position: frontPos } });
  }
  let fitnote = "";
  if (isFront) {
    try {
      const mf = await setProductMetafields(store, [
        { productId: it.productId, namespace: NS, key: KEY_HEIGHT, type: "number_integer", value: String(it.profile.height) },
        { productId: it.productId, namespace: NS, key: KEY_SIZE, type: "single_line_text_field", value: String(it.profile.size) },
      ]);
      fitnote = mf.ok ? `Model is ${it.profile.height} cm and wears size ${it.profile.size}` : `fitnote mislukt: ${(mf.errors || []).join("; ").slice(0, 120)}`;
    } catch (e) {
      fitnote = `fitnote mislukt: ${String(e.message || e).slice(0, 120)}`;
    }
  }
  let inDesc = "";
  if (isFront) {
    try {
      inDesc = await putPhotoInDescription(store, it, newSrc);
    } catch (e) {
      inDesc = `omschrijving mislukt: ${String(e.message || e).slice(0, 120)}`;
    }
  }
  it.inDesc = inDesc;
  it.status = "done";
  it.resultUrl = newSrc || imageUrl;
  it.scores = scores || null;
  if (usd) it.usd = usd;
  it.doneAt = Date.now();
  it.shopifyImageId = newImgId;
  await saveItem(org, it);
  return { ok: true, id: it.id, title: it.title, color: it.color, shotType: it.shotType || "front", fitnote, inDesc, adminUrl: `https://${cleanDomain(it.domain)}/admin/products/${it.productId}` };
}
export const agentDone = (b) => placeResult(b);

/* ---------- hulpjes voor de OpenAI-motor ---------- */
export async function engineItems(orgIn) {
  return (await allItems(normOrg(orgIn))).filter((x) => x.engine === "openai");
}
export async function patchItem(orgIn, id, patch) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const raw = await r.hGet(K.items(org), String(id));
  if (!raw) return null;
  const it = { ...JSON.parse(raw), ...patch };
  await saveItem(org, it);
  return it;
}
export const QUEUE_ORGS = ["attoh", "sacollective"];

export async function agentFail({ org: orgIn, id, reason, scores }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const raw = await r.hGet(K.items(org), String(id));
  if (!raw) throw httpErr(404, "Opdracht niet gevonden");
  const it = JSON.parse(raw);
  it.status = /^(AI kiest|Overgeslagen)/i.test(String(reason || "")) ? "skipped" : "failed";
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

/* AI-foto in de omschrijving: gecentreerd en wat kleiner, direct na de inleiding (vóór "WHY CHOOSE ...").
   Eén foto per product; staat er al een afbeelding in de omschrijving, dan blijft die zoals hij is. */
async function putPhotoInDescription(store, it, src) {
  if (!src) return "geen foto-URL";
  const g = await shopReq(store, `/products/${it.productId}.json?fields=id,body_html`);
  if (!g.ok) return `omschrijving niet gelezen: ${String(g.error || "").slice(0, 80)}`;
  const html = String((g.data && g.data.product && g.data.product.body_html) || "");
  const alt = (String(it.title || "").split("|")[0].trim() + (it.color ? ` in ${it.color}` : "")).replace(/"/g, "");
  // display:block + margin auto: staat ook in het midden als het thema plaatjes als blok toont (text-align alleen is dan niet genoeg).
  const block = `<p style="text-align: center;"><img src="${src}" alt="${alt}" style="display: block; margin: 14px auto; width: 80%; max-width: 560px; height: auto;" data-ai-photo="1"></p>\n`;
  const own = /<p[^>]*>\s*<img[^>]*data-ai-photo[^>]*>\s*<\/p>\s*/i;
  if (own.test(html)) {
    // eigen eerder geplaatste foto: opnieuw neerzetten met de huidige opmaak
    const o2 = html.replace(own, block);
    if (o2 === html) return "foto stond al goed in de omschrijving";
    const u2 = await shopReq(store, `/products/${it.productId}.json`, "PUT", { product: { id: it.productId, body_html: o2 } });
    return u2.ok ? "foto in omschrijving bijgewerkt" : `omschrijving niet opgeslagen: ${String(u2.error || "").slice(0, 80)}`;
  }
  if (/<img\b/i.test(html) || /\{\{IMAGE_/i.test(html)) return "omschrijving had al een foto";
  let out;
  const m = html.match(/<p[^>]*>\s*<strong>\s*WHY (CHOOSE|YOU)/i);
  if (m) out = html.slice(0, m.index) + block + html.slice(m.index);
  else {
    const ul = html.search(/<ul\b/i);
    if (ul < 0) return "geen plek gevonden in omschrijving";
    out = html.slice(0, ul) + block + html.slice(ul);
  }
  const u = await shopReq(store, `/products/${it.productId}.json`, "PUT", { product: { id: it.productId, body_html: out } });
  return u.ok ? "foto in omschrijving gezet" : `omschrijving niet opgeslagen: ${String(u.error || "").slice(0, 80)}`;
}

/** Herstel: zet bij producten met een geplaatste AI-foto die foto alsnog in de omschrijving (eerste kleur). */
export async function agentDesc({ org: orgIn }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const first = new Map();
  for (const it of (await allItems(org)).sort((a, b) => (a.createdAt - b.createdAt) || (a.shot - b.shot))) {
    if (it.status !== "done" || !it.shopifyImageId) continue;
    const k = `${cleanDomain(it.domain)}|${it.productId}`;
    if (!first.has(k)) first.set(k, it);
  }
  const out = [];
  for (const it of first.values()) {
    const sraw = await r.hGet(K.stores(org), cleanDomain(it.domain));
    if (!sraw) continue;
    const store = JSON.parse(sraw);
    const im = await shopReq(store, `/products/${it.productId}/images/${it.shopifyImageId}.json`);
    const src = im.ok && im.data && im.data.image ? im.data.image.src : "";
    let res;
    try {
      res = src ? await putPhotoInDescription(store, it, src) : "foto niet gevonden in Shopify";
    } catch (e) {
      res = String(e.message || e).slice(0, 120);
    }
    out.push({ title: String(it.title || "").slice(0, 50), res });
  }
  return { ok: true, done: out };
}

/* ---------- testacties voor Claude (alleen lezen + AI-oordeel, er wordt niets gewijzigd) ---------- */
/** Fotocijfer ("AI kiest") voor de producten die in de wachtrij hebben gestaan — AI-foto's zelf tellen niet mee. */
export async function agentJudge({ org: orgIn, limit = 40 }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const items = await allItems(org);
  const aiImg = new Set(items.filter((x) => x.shopifyImageId).map((x) => String(x.shopifyImageId)));
  const seen = new Map();
  for (const it of items) if (!seen.has(`${it.domain}|${it.productId}`)) seen.set(`${it.domain}|${it.productId}`, it);
  const list = [...seen.values()].slice(0, Math.max(1, Math.min(60, limit)));
  const prods = [];
  for (let i = 0; i < list.length; i += 4) {
    const part = await Promise.all(list.slice(i, i + 4).map(async (it) => {
      const sraw = await r.hGet(K.stores(org), cleanDomain(it.domain));
      if (!sraw) return null;
      const g = await shopReq(JSON.parse(sraw), `/products/${it.productId}.json?fields=id,title,images`);
      const p = g.ok && g.data ? g.data.product : null;
      if (!p) return null;
      const own = (p.images || []).filter((im) => !aiImg.has(String(im.id)));
      return { id: String(p.id), title: p.title, queue: it.status, count: own.length, images: own.slice(0, 6).map((im) => im.src) };
    }));
    prods.push(...part.filter(Boolean));
  }
  const out = [];
  let usd = 0;
  const groups = [];
  for (let i = 0; i < prods.length; i += 5) groups.push(prods.slice(i, i + 5));
  for (let i = 0; i < groups.length; i += 3) {
    await Promise.all(groups.slice(i, i + 3).map(async (grp) => {
      const res = await judgeGalleryBatch(grp.map((p, n) => ({ index: n, title: p.title, count: p.count, images: p.images })));
      usd += res.ai.usd || 0;
      for (const x of res.results) if (grp[x.index]) out.push({ title: grp[x.index].title.slice(0, 60), queue: grp[x.index].queue, score: x.score, needs: x.needs, why: x.why, photos: x.photos, worn: x.worn, full: x.full, look: x.look, rule: x.rule });
    }));
  }
  return { ok: true, usd: Math.round(usd * 1000) / 1000, results: out };
}

/** Controle van een geplaatste AI-foto tegen een bronfoto (standaard zijn eigen bron; "against" = bron van een andere opdracht). */
export async function agentCheck({ org: orgIn, id, against }) {
  const org = normOrg(orgIn);
  const r = await getRedis();
  const raw = await r.hGet(K.items(org), String(id));
  if (!raw) throw httpErr(404, "Opdracht niet gevonden");
  const it = JSON.parse(raw);
  if (!it.resultUrl) throw httpErr(400, "Opdracht heeft geen foto");
  let src = it.sourceImage;
  if (against) {
    const o = await r.hGet(K.items(org), String(against));
    if (!o) throw httpErr(404, "Vergelijk-opdracht niet gevonden");
    src = JSON.parse(o).sourceImage;
  }
  const u = new URL(it.resultUrl);
  if (u.hostname === "cdn.shopify.com") u.searchParams.set("width", "1024");
  const res = await fetch(u.toString());
  if (!res.ok) throw httpErr(502, `Foto ophalen mislukt (${res.status})`);
  const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  const noun = String(it.title || "").split("|")[0].replace(/\b(wo)?men'?s\b/gi, "").trim().toLowerCase() || "garment";
  const out = await checkGarmentMatch({ sourceUrl: src, resultB64: b64, resultType: type, noun, shotType: it.shotType || "front" });
  return { ok: true, title: it.title.slice(0, 50), color: it.color, match: out.ok, score: out.score, issues: out.issues, usd: Math.round((out.ai.usd || 0) * 1000) / 1000 };
}
