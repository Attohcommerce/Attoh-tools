// THEMABESTANDEN BEKIJKEN EN AANPASSEN OP DE SERVER (26-11-2026) — voor werk aan meerdere stores
// tegelijk zonder hele bestanden heen en weer te sturen. Achter de gewone login (/api/theme-edit).
// ops: files (lijst + grootte) · grep (regels die matchen) · lines (stukje bestand) · blocks
// (bloktypes uit {% schema %}) · replace (zoek/vervang, ook regex) · write (heel bestand) · delete.
// Nooit naar een live (MAIN) thema schrijven.
import { findStore } from "./claude-link";
import { storeGraphql } from "./shopify";

const themeGid = (v) => {
  const t = String(v || "").trim();
  if (/^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/.test(t)) return t;
  if (/^\d+$/.test(t)) return `gid://shopify/OnlineStoreTheme/${t}`;
  return "";
};
const Q_THEME = `query($id: ID!) { theme(id: $id) { id name role } }`;
const Q_LIST = `query($id: ID!, $after: String) { theme(id: $id) { files(first: 250, after: $after) { nodes { filename size } pageInfo { hasNextPage endCursor } } } }`;
const Q_FILE = `query($id: ID!, $names: [String!]!) { theme(id: $id) { files(filenames: $names) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`;
const M_UPSERT = `mutation($t: ID!, $f: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $t, files: $f) { upsertedThemeFiles { filename } userErrors { field message code filename } } }`;
const M_DELETE = `mutation($t: ID!, $f: [String!]!) { themeFilesDelete(themeId: $t, files: $f) { deletedThemeFiles { filename } userErrors { field message } } }`;

const fail = (message) => ({ ok: false, error: message });

async function readText(store, id, file) {
  const r = await storeGraphql(store, Q_FILE, { id, names: [file] });
  if (!r.ok) throw new Error(r.error || "lezen mislukt");
  const n = r.data && r.data.theme && r.data.theme.files && r.data.theme.files.nodes && r.data.theme.files.nodes[0];
  if (!n || !n.body || typeof n.body.content !== "string") return null;
  return n.body.content;
}

export async function themeEdit(a, stores) {
  const store = findStore(stores, a.store);
  if (!store) return fail(`Store "${a.store}" niet gevonden`);
  const id = themeGid(a.theme);
  if (!id) return fail("Geef een geldig thema-id");
  const op = String(a.op || "");
  const t = await storeGraphql(store, Q_THEME, { id });
  if (!t.ok || !t.data || !t.data.theme) return fail("Thema niet gevonden");
  const theme = t.data.theme;
  const writes = ["replace", "write", "delete"].includes(op);
  if (writes && theme.role === "MAIN") return fail("Dit is het live thema. Werk in een niet-gepubliceerde kopie.");

  if (op === "files") {
    const out = [];
    let after = null;
    for (let i = 0; i < 8; i++) {
      const r = await storeGraphql(store, Q_LIST, { id, after });
      if (!r.ok) return fail(r.error || "lijst mislukt");
      const f = r.data.theme.files;
      for (const n of f.nodes) if (!a.prefix || n.filename.startsWith(a.prefix)) out.push(`${n.filename} ${n.size}`);
      if (!f.pageInfo.hasNextPage) break;
      after = f.pageInfo.endCursor;
    }
    return { ok: true, theme: theme.name, files: out };
  }

  const files = (Array.isArray(a.files) ? a.files : [a.file]).filter(Boolean).slice(0, 40);
  if (!files.length) return fail("Geen bestand opgegeven");

  if (op === "grep") {
    const re = new RegExp(String(a.pattern || ""), a.flags || "i");
    const ctx = Math.max(0, Math.min(5, Number(a.context) || 0));
    const max = Math.max(1, Math.min(400, Number(a.max) || 120));
    const res = {};
    for (const f of files) {
      const c = await readText(store, id, f);
      if (c == null) { res[f] = "(niet gevonden of geen tekst)"; continue; }
      const lines = c.split("\n");
      const hits = [];
      lines.forEach((l, i) => {
        if (hits.length < max && re.test(l)) {
          for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) hits.push(`${k + 1}: ${lines[k].slice(0, 400)}`);
          if (ctx) hits.push("--");
        }
      });
      res[f] = hits;
    }
    return { ok: true, theme: theme.name, results: res };
  }

  if (op === "lines") {
    const c = await readText(store, id, files[0]);
    if (c == null) return fail("Bestand niet gevonden");
    const lines = c.split("\n");
    const from = Math.max(1, Number(a.from) || 1);
    const to = Math.min(lines.length, Number(a.to) || from + 80);
    return { ok: true, file: files[0], total: lines.length, text: lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join("\n") };
  }

  if (op === "blocks") {
    const res = {};
    for (const f of files) {
      const c = await readText(store, id, f);
      const m = c && c.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
      if (!m) { res[f] = "(geen schema)"; continue; }
      try {
        const s = JSON.parse(m[1]);
        res[f] = { name: s.name, settings: (s.settings || []).map((x) => x.id).filter(Boolean), blocks: (s.blocks || []).map((b) => `${b.type}${b.name ? " (" + b.name + ")" : ""}: ${(b.settings || []).map((x) => x.id).filter(Boolean).join(",")}`) };
      } catch (e) {
        res[f] = `(schema niet te lezen: ${e.message})`;
      }
    }
    return { ok: true, theme: theme.name, results: res };
  }

  if (op === "replace") {
    const f = files[0];
    let c = await readText(store, id, f);
    if (c == null) return fail("Bestand niet gevonden");
    const report = [];
    for (const e of Array.isArray(a.edits) ? a.edits : []) {
      const before = c;
      if (e.regex) {
        const re = new RegExp(e.find, e.flags || "g");
        let n = 0;
        c = c.replace(re, (...m) => { n++; return String(e.replace).replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? ""); });
        report.push({ find: String(e.find).slice(0, 60), count: n });
      } else {
        const parts = before.split(e.find);
        c = parts.join(String(e.replace));
        report.push({ find: String(e.find).slice(0, 60), count: parts.length - 1 });
      }
    }
    if (a.dry_run) return { ok: true, file: f, report, dry_run: true };
    const r = await storeGraphql(store, M_UPSERT, { t: id, f: [{ filename: f, body: { type: "TEXT", value: c } }] });
    const errs = (r.ok && r.data && r.data.themeFilesUpsert && r.data.themeFilesUpsert.userErrors) || [];
    if (!r.ok || errs.length) return fail(`Opslaan mislukt: ${r.error || errs.map((x) => x.message).join("; ")}`);
    return { ok: true, file: f, size: c.length, report };
  }

  if (op === "write") {
    const list = Array.isArray(a.write) ? a.write : [{ file: files[0], content: a.content }];
    const r = await storeGraphql(store, M_UPSERT, { t: id, f: list.map((x) => ({ filename: x.file, body: { type: "TEXT", value: String(x.content ?? "") } })) });
    const errs = (r.ok && r.data && r.data.themeFilesUpsert && r.data.themeFilesUpsert.userErrors) || [];
    if (!r.ok || errs.length) return fail(`Opslaan mislukt: ${r.error || errs.map((x) => `${x.filename}: ${x.message}`).join("; ")}`);
    return { ok: true, written: list.map((x) => x.file) };
  }

  if (op === "delete") {
    const r = await storeGraphql(store, M_DELETE, { t: id, f: files });
    if (!r.ok) return fail(r.error || "verwijderen mislukt");
    return { ok: true, deleted: ((r.data.themeFilesDelete && r.data.themeFilesDelete.deletedThemeFiles) || []).map((x) => x.filename) };
  }

  return fail("Onbekende op (files, grep, lines, blocks, replace, write, delete)");
}
