// THEMABESTANDEN TUSSEN STORES KOPIËREN (26-11-2026) — gebruikt door de stores-koppeling
// (MCP-tool theme_copy_files) en door /api/theme-copy (achter de gewone login).
// Leest bestanden uit thema A (store X) en schrijft ze naar thema B (store Y), op de server.
// Optionele tekstvervangingen; nooit naar een live (MAIN) thema.
import { findStore } from "./claude-link";
import { storeGraphql } from "./shopify";

const out = (obj, isError = false) => ({ ok: !isError, ...(typeof obj === "string" ? { message: obj } : obj), error: isError ? (typeof obj === "string" ? obj : "mislukt") : undefined });
/* ---------- theme_copy_files (26-11-2026) ---------- */
const themeGid = (v) => {
  const t = String(v || "").trim();
  if (/^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/.test(t)) return t;
  if (/^\d+$/.test(t)) return `gid://shopify/OnlineStoreTheme/${t}`;
  return "";
};
const Q_THEME = `query($id: ID!) { theme(id: $id) { id name role } }`;
const Q_FILES = `query($id: ID!, $names: [String!]!) { theme(id: $id) { files(filenames: $names, first: 50) { nodes { filename body { __typename ... on OnlineStoreThemeFileBodyText { content } ... on OnlineStoreThemeFileBodyBase64 { contentBase64 } ... on OnlineStoreThemeFileBodyUrl { url } } } } } }`;
const M_UPSERT = `mutation($t: ID!, $f: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $t, files: $f) { upsertedThemeFiles { filename } job { id } userErrors { field message code filename } } }`;

export async function copyThemeFiles(a, stores) {
  const from = findStore(stores, a.from_store);
  const to = findStore(stores, a.to_store);
  if (!from) return out(`Bron-store "${a.from_store}" niet gevonden`, true);
  if (!to) return out(`Doel-store "${a.to_store}" niet gevonden`, true);
  const fromId = themeGid(a.from_theme);
  const toId = themeGid(a.to_theme);
  if (!fromId || !toId) return out("Geef geldige thema-id's (getal of gid)", true);
  const list = (Array.isArray(a.files) ? a.files : [])
    .map((f) => (typeof f === "string" ? { from: f, to: f } : { from: String(f.from || ""), to: String(f.to || f.from || "") }))
    .filter((f) => f.from && f.to)
    .slice(0, 60);
  if (!list.length) return out("Geen bestanden opgegeven", true);
  const reps = (Array.isArray(a.replace) ? a.replace : []).filter((r) => r && typeof r.find === "string" && r.find.length);

  const tt = await storeGraphql(to, Q_THEME, { id: toId });
  if (!tt.ok || !tt.data || !tt.data.theme) return out(`Doelthema niet gevonden: ${tt.error || ""}`, true);
  if (tt.data.theme.role === "MAIN") return out("Doelthema is het live thema. Kopieer naar een niet-gepubliceerde kopie.", true);

  // bron lezen in porties
  const got = {};
  const names = [...new Set(list.map((f) => f.from))];
  for (let i = 0; i < names.length; i += 20) {
    const r = await storeGraphql(from, Q_FILES, { id: fromId, names: names.slice(i, i + 20) });
    if (!r.ok) return out(`Bron lezen mislukt: ${r.error || JSON.stringify(r.errors || "")}`, true);
    for (const n of (r.data && r.data.theme && r.data.theme.files && r.data.theme.files.nodes) || []) got[n.filename] = n.body || {};
  }

  const results = [];
  const queue = [];
  for (const f of list) {
    const b = got[f.from];
    if (!b) { results.push({ file: f.to, ok: false, error: "niet gevonden in bron" }); continue; }
    if (typeof b.content === "string") {
      let c = b.content;
      for (const r of reps) c = c.split(r.find).join(String(r.replace));
      queue.push({ f, body: { type: "TEXT", value: c }, size: c.length });
    } else if (typeof b.contentBase64 === "string") {
      queue.push({ f, body: { type: "BASE64", value: b.contentBase64 }, size: b.contentBase64.length });
    } else if (b.url) {
      queue.push({ f, body: { type: "URL", value: b.url }, size: 0 });
    } else {
      results.push({ file: f.to, ok: false, error: "onbekend bestandstype" });
    }
  }

  // schrijven in porties (max ~8 bestanden of ~1,5 MB per keer)
  let batch = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const r = await storeGraphql(to, M_UPSERT, { t: toId, f: batch.map((q) => ({ filename: q.f.to, body: q.body })) });
    const errs = (r.ok && r.data && r.data.themeFilesUpsert && r.data.themeFilesUpsert.userErrors) || [];
    const done = new Set(((r.ok && r.data && r.data.themeFilesUpsert && r.data.themeFilesUpsert.upsertedThemeFiles) || []).map((x) => x.filename));
    const job = r.ok && r.data && r.data.themeFilesUpsert && r.data.themeFilesUpsert.job;
    for (const q of batch) {
      const e = errs.find((x) => x.filename === q.f.to) || (!r.ok ? { message: r.error || "mislukt" } : null);
      if (e) results.push({ file: q.f.to, ok: false, error: e.message || e.code });
      else if (done.has(q.f.to)) results.push({ file: q.f.to, ok: true, size: q.size });
      else results.push({ file: q.f.to, ok: !!job, note: job ? `job ${job.id}` : "niet bevestigd" });
    }
    batch = [];
    bytes = 0;
  };
  for (const q of queue) {
    if (batch.length >= 8 || bytes + q.size > 1500000) await flush();
    batch.push(q);
    bytes += q.size;
  }
  await flush();
  const ok = results.filter((r) => r.ok).length;
  return out({ from: `${from.name || from.domain} ${fromId.split("/").pop()}`, to: `${to.name || to.domain} ${toId.split("/").pop()}`, copied: ok, failed: results.length - ok, results });
}

