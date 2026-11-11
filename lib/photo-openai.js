// OPENAI-MOTOR voor AI-modelfoto's (10-11-2026, projectdoc 137/138).
// De tool maakt de foto's zelf: bronfoto ophalen → gpt-image via /v1/images/edits →
// vision-controle tegen de bronfoto → vooraan op het product. Geen chat nodig.
// Staat aan zodra OPENAI_API_KEY in Vercel staat. Instellingen (optioneel, env):
//   OPENAI_IMAGE_MODEL   (standaard gpt-image-2)
//   OPENAI_IMAGE_SIZE    (standaard 1024x1024; 2048x2048 kan, kost meer)
//   OPENAI_IMAGE_QUALITY (standaard medium)
import { getRedis } from "./kw-memory";
import { buildPrompt, productNoun } from "./photo-brain";
import { checkGarmentMatch } from "./ai";
import { engineItems, patchItem, placeResult, QUEUE_ORGS } from "./photo-queue";

export const openaiReady = () => !!process.env.OPENAI_API_KEY;
export function openaiSettings() {
  return {
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    size: process.env.OPENAI_IMAGE_SIZE || "1024x1024",
    quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
  };
}

// Schatting van de kosten uit het token-verbruik dat OpenAI teruggeeft ($ per miljoen tokens, gpt-image-2).
const PRICE = { textIn: 5, imageIn: 8, imageOut: 30 };
function usdOf(usage) {
  if (!usage) return 0;
  const d = usage.input_tokens_details || {};
  const textIn = Number(d.text_tokens) || 0;
  const imageIn = Number(d.image_tokens) || Math.max(0, (Number(usage.input_tokens) || 0) - textIn);
  const out = Number(usage.output_tokens) || 0;
  return (textIn * PRICE.textIn + imageIn * PRICE.imageIn + out * PRICE.imageOut) / 1e6;
}

async function fetchImage(url, width) {
  let u = String(url);
  try {
    const x = new URL(u);
    if (x.hostname === "cdn.shopify.com" && width) x.searchParams.set("width", String(width));
    u = x.toString();
  } catch {}
  const res = await fetch(u);
  if (!res.ok) throw new Error(`foto ophalen mislukt (${res.status})`);
  const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  return { buf: Buffer.from(await res.arrayBuffer()), type };
}
const extOf = (type) => (/png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg");

/** Eén beeld maken. images: [{buf,type}] (eerste = bronfoto, tweede = eerdere modelfoto voor hetzelfde gezicht). */
export async function openaiEdit({ prompt, images }) {
  const st = openaiSettings();
  const form = new FormData();
  form.append("model", st.model);
  form.append("prompt", prompt);
  form.append("size", st.size);
  form.append("quality", st.quality);
  form.append("output_format", "jpeg");
  form.append("output_compression", "92");
  form.append("n", "1");
  images.forEach((im, i) => form.append("image[]", new Blob([im.buf], { type: im.type }), `ref${i + 1}.${extOf(im.type)}`));
  const res = await fetch(`${process.env.OPENAI_BASE_URL || "https://api.openai.com"}/v1/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(170000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `OpenAI ${res.status}`;
    const e = new Error(String(msg).slice(0, 240));
    e.status = res.status;
    throw e;
  }
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error("OpenAI gaf geen beeld terug");
  return { b64, usd: usdOf(data.usage) };
}

/** Eén opdracht: maken → controleren → (1× opnieuw bij afkeur) → plaatsen. */
async function processItem(org, it, frontUrlOf) {
  await patchItem(org, it.id, { status: "working", startedAt: Date.now() });
  let usd = 0;
  try {
    const src = await fetchImage(it.sourceImage, 1536);
    const images = [src];
    const shot = it.shotType || "front";
    let hasModelRef = false;
    if (shot === "angle" || shot === "detail") {
      const fu = frontUrlOf(it);
      if (fu) {
        try {
          images.push(await fetchImage(fu, 1024));
          hasModelRef = true;
        } catch {}
      }
    }
    const prompt = buildPrompt({ ...it, hasModelRef });
    let last = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await openaiEdit({ prompt, images });
      usd += out.usd;
      let chk = { ok: true, score: 0, issues: ["controle overgeslagen"] };
      try {
        chk = await checkGarmentMatch({ sourceUrl: it.sourceImage, resultB64: out.b64, noun: productNoun(it), shotType: shot });
        usd += chk.ai.usd || 0;
      } catch (e) {
        chk = { ok: true, score: 0, issues: [`controle mislukt: ${String(e.message || e).slice(0, 80)}`] };
      }
      last = { out, chk, attempt };
      if (chk.ok) break;
    }
    if (!last.chk.ok) {
      await patchItem(org, it.id, { status: "failed", reason: `Afgekeurd na 2 pogingen (cijfer ${last.chk.score}): ${last.chk.issues.join("; ").slice(0, 200)}`, scores: { check: last.chk.score, issues: last.chk.issues, attempts: 2 }, usd: Math.round(usd * 1000) / 1000, doneAt: Date.now() });
      return { id: it.id, ok: false };
    }
    const placed = await placeResult({ org, id: it.id, attachmentB64: last.out.b64, ext: "jpg", scores: { check: last.chk.score, issues: last.chk.issues, attempts: last.attempt }, usd: Math.round(usd * 1000) / 1000 });
    return { id: it.id, ok: !!placed.ok };
  } catch (e) {
    // 429 / tijdelijke fout: terug in de rij (max 3 keer), anders mislukt
    const tries = (it.tries || 0) + 1;
    const temp = e.status === 429 || e.status >= 500 || /timeout|aborted|fetch failed/i.test(String(e.message || e));
    if (temp && tries < 3) await patchItem(org, it.id, { status: "pending", tries, usd: Math.round(usd * 1000) / 1000 });
    else await patchItem(org, it.id, { status: "failed", reason: `OpenAI: ${String(e.message || e).slice(0, 220)}`, tries, usd: Math.round(usd * 1000) / 1000, doneAt: Date.now() });
    return { id: it.id, ok: false, error: String(e.message || e) };
  }
}

const LOCK = "photo:worklock";
/** Werkt de OpenAI-opdrachten af tot de tijd op is. → { ran, left, busy } */
export async function runOpenAi({ maxMs = 230000, parallel = 3 } = {}) {
  if (!openaiReady()) return { ran: 0, left: 0, off: true };
  const r = await getRedis();
  const got = await r.set(LOCK, String(Date.now()), { NX: true, EX: 290 });
  if (!got) return { ran: 0, left: -1, busy: true };
  const t0 = Date.now();
  let ran = 0;
  try {
    for (;;) {
      const all = [];
      for (const org of QUEUE_ORGS) for (const it of await engineItems(org)) all.push({ org, it });
      // vastgelopen "bezig"-opdrachten (ouder dan 6 minuten) terug in de rij
      for (const { org, it } of all) if (it.status === "working" && Date.now() - (it.startedAt || 0) > 360000) {
        await patchItem(org, it.id, { status: "pending" });
        it.status = "pending";
      }
      const frontUrlOf = (x) => {
        const f = all.find(({ it }) => it.domain === x.domain && it.productId === x.productId && it.color === x.color && (it.shotType || "front") === "front" && it.status === "done");
        return f ? f.it.resultUrl : "";
      };
      const frontOpen = (x) => all.some(({ it }) => it.domain === x.domain && it.productId === x.productId && it.color === x.color && (it.shotType || "front") === "front" && (it.status === "pending" || it.status === "working"));
      const pending = all.filter(({ it }) => it.status === "pending").sort((a, b) => a.it.createdAt - b.it.createdAt);
      // eerst alle vooraanzichten; schuin/detail wachten tot het vooraanzicht van die kleur klaar is (zelfde gezicht)
      const ready = pending.filter(({ it }) => (it.shotType || "front") === "front" || it.shotType === "flat" || !frontOpen(it));
      if (!ready.length) return { ran, left: pending.length };
      if (Date.now() - t0 > maxMs - 75000) return { ran, left: pending.length };
      const group = ready.slice(0, parallel);
      await Promise.all(group.map(({ org, it }) => processItem(org, it, frontUrlOf)));
      ran += group.length;
      await r.expire(LOCK, 290);
    }
  } finally {
    await r.del(LOCK).catch(() => {});
  }
}
