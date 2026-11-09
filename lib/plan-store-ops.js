/* WIJZIGINGSPLAN · STORE-STAPPEN (09-11-2026)
   Justin (EMC): "zorg dat er via de Store Doctor changes een smart collectie
   wordt aangemaakt … en zet ze ook correct in de navigatiebar. Dubbele
   collecties: noteer het in de collectienaam en dan verwijder ik ze."

   Dit bestand voert de store-brede stappen van een wijzigingsplan uit
   (formaat: zie lib/change-plan.js):
     collecties  create · rename · rules     (REST, write_products)
     menu        menu-add                    (GraphQL menus/menuUpdate,
                                              scopes read_/write_online_store_navigation)
   dryRun = alleen kijken en vertellen wat er zou gebeuren.
   revert = terug: naam/regels terug naar "from", menu-items weer weg.
   Een collectie die het plan heeft aangemaakt wordt NOOIT automatisch
   verwijderd — dat doe je zelf in Shopify (veiliger, en vaak wil je hem houden). */
import { storeRequest, storeGraphql } from "./shopify";
import { sameRules } from "./change-plan";

const MENU_API = "2025-01"; // menu-API zit niet in de vaste 2024-07 van de rest
const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();
const RULE_KEYS = ["column", "relation", "condition"];
const cleanRules = (rules) => (rules || []).map((r) => Object.fromEntries(RULE_KEYS.map((k) => [k, String(r[k])])));

/** Collectie op handle: smart of handmatig. → {kind, c} | null */
async function findCollection(store, handle) {
  const h = encodeURIComponent(String(handle || "").trim());
  if (!h) return null;
  const s = await storeRequest(store, `/smart_collections.json?handle=${h}&fields=id,handle,title,rules,disjunctive,sort_order,published_at`);
  if (!s.ok) throw new Error(`collectie ${handle}: ${s.error}`);
  const sc = ((s.data && s.data.smart_collections) || []).find((c) => lc(c.handle) === lc(handle));
  if (sc) return { kind: "smart", c: sc };
  const m = await storeRequest(store, `/custom_collections.json?handle=${h}&fields=id,handle,title`);
  if (!m.ok) throw new Error(`collectie ${handle}: ${m.error}`);
  const cc = ((m.data && m.data.custom_collections) || []).find((c) => lc(c.handle) === lc(handle));
  return cc ? { kind: "custom", c: cc } : null;
}

/* ---------- collecties ---------- */
async function collectionOp(store, op, ctx) {
  const { dryRun, revert } = ctx;
  const found = await findCollection(store, op.handle);
  if (found) ctx.ids.set(lc(op.handle), found.c.id);

  if (op.op === "create") {
    if (revert) {
      return found
        ? { st: "skip", line: `"${found.c.title}" (/collections/${op.handle}) blijft staan — verwijder hem zelf in Shopify als je hem niet wilt` }
        : { st: "skip", line: `/collections/${op.handle} bestaat niet (meer)` };
    }
    if (found) {
      const same = found.kind === "smart" && sameRules(found.c, op);
      return { st: "skip", line: `"${found.c.title}" (/collections/${op.handle}) bestaat al${same ? "" : " — met andere regels, niets veranderd"}` };
    }
    if (dryRun) {
      ctx.planned.add(lc(op.handle));
      return { st: "do", line: `zou collectie "${op.title}" aanmaken (/collections/${op.handle})` };
    }
    const body = {
      smart_collection: {
        title: op.title,
        handle: op.handle,
        rules: cleanRules(op.rules),
        disjunctive: !!op.disjunctive,
        published: op.published !== false,
        ...(op.sort_order ? { sort_order: op.sort_order } : {}),
      },
    };
    const r = await storeRequest(store, "/smart_collections.json", "POST", body);
    if (!r.ok) throw new Error(`"${op.title}" aanmaken: ${r.error}`);
    const c = r.data.smart_collection;
    ctx.ids.set(lc(op.handle), c.id);
    const moved = lc(c.handle) !== lc(op.handle) ? ` (Shopify gaf handle /collections/${c.handle})` : "";
    return { st: "do", line: `collectie "${c.title}" aangemaakt${moved}` };
  }

  if (!found) return { st: "fail", line: `/collections/${op.handle} niet gevonden` };

  if (op.op === "rename") {
    const target = revert ? op.from : op.set;
    const expect = revert ? op.set : op.from;
    const cur = String(found.c.title || "");
    if (lc(cur) === lc(target)) return { st: "skip", line: `/collections/${op.handle} heet al "${cur}"` };
    if (expect != null && lc(cur) !== lc(expect)) return { st: "skip", line: `/collections/${op.handle} overgeslagen: heet intussen "${cur}" (plan verwachtte "${expect}")` };
    if (dryRun) return { st: "do", line: `zou /collections/${op.handle} hernoemen: "${cur}" → "${target}"` };
    const key = found.kind === "smart" ? "smart_collection" : "custom_collection";
    const r = await storeRequest(store, `/${key}s/${found.c.id}.json`, "PUT", { [key]: { id: found.c.id, title: target } });
    if (!r.ok) throw new Error(`hernoemen ${op.handle}: ${r.error}`);
    return { st: "do", line: `/collections/${op.handle}: "${cur}" → "${target}"` };
  }

  if (op.op === "rules") {
    if (found.kind !== "smart") return { st: "fail", line: `/collections/${op.handle} is handmatig — heeft geen regels` };
    const target = revert ? op.from : op.set;
    const expect = revert ? op.set : op.from;
    if (!target) return { st: "skip", line: `/collections/${op.handle}: geen oude regels bekend` };
    if (sameRules(found.c, target)) return { st: "skip", line: `/collections/${op.handle} heeft de regels al` };
    if (expect && !sameRules(found.c, expect)) return { st: "skip", line: `/collections/${op.handle} overgeslagen: de regels zijn intussen veranderd` };
    if (dryRun) return { st: "do", line: `zou de regels van /collections/${op.handle} aanpassen${op.why ? ` (${op.why})` : ""}` };
    const r = await storeRequest(store, `/smart_collections/${found.c.id}.json`, "PUT", {
      smart_collection: { id: found.c.id, rules: cleanRules(target.rules), disjunctive: !!target.disjunctive },
    });
    if (!r.ok) throw new Error(`regels ${op.handle}: ${r.error}`);
    return { st: "do", line: `/collections/${op.handle}: regels aangepast` };
  }
  return { st: "fail", line: `onbekende stap "${op.op}"` };
}

/* ---------- menu ---------- */
const ITEM = "id title type url resourceId tags";
const MENUS_Q = `query { menus(first: 50) { nodes { id handle title items { ${ITEM} items { ${ITEM} items { ${ITEM} } } } } } }`;
const MENU_U = `mutation U($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, items: $items) { menu { id handle } userErrors { field message } }
}`;

function navError(e) {
  const s = String(e || "");
  if (/access|denied|scope|navigation/i.test(s)) {
    return "de app mist de scopes read_online_store_navigation + write_online_store_navigation (Dev Dashboard → app → Versions → scopes erbij → opnieuw installeren). Tot die tijd: zet de menu-items met de hand (lijst hieronder).";
  }
  return s.slice(0, 200);
}

// Bestaand item → MenuItemUpdateInput (id blijft, dus niets verandert eraan)
function toInput(it) {
  const o = { id: it.id, title: it.title, type: it.type };
  if (it.resourceId) o.resourceId = it.resourceId;
  else if (it.url) o.url = it.url;
  if (it.tags && it.tags.length) o.tags = it.tags;
  o.items = (it.items || []).map(toInput);
  return o;
}
const byTitle = (list, t) => (list || []).find((x) => lc(x.title) === lc(t));

async function collectionGid(store, handle, ctx) {
  const key = lc(handle);
  if (!ctx.ids.has(key)) {
    const f = await findCollection(store, handle);
    if (f) ctx.ids.set(key, f.c.id);
  }
  const id = ctx.ids.get(key);
  return id ? `gid://shopify/Collection/${id}` : null;
}

async function newItem(store, spec, ctx) {
  const gid = await collectionGid(store, spec.collection, ctx);
  if (!gid && !(ctx.dryRun && ctx.planned.has(lc(spec.collection)))) throw new Error(`collectie /collections/${spec.collection} bestaat niet`);
  const o = { title: spec.title, type: "COLLECTION", resourceId: gid || "gid://shopify/Collection/0", items: [] };
  for (const k of spec.children || []) o.items.push(await newItem(store, k, ctx));
  return o;
}

async function menuOps(store, ops, ctx) {
  const lines = [];
  const res = { done: 0, skipped: 0, failed: 0 };
  const manual = () =>
    ops.forEach((op) => lines.push(`   met de hand: ${[op.menu, ...(op.parent || [])].join(" › ")} → "${op.title}" (/collections/${op.collection})${op.after ? ` na "${op.after}"` : ""}`));
  const q = await storeGraphql(store, MENUS_Q, {}, { version: MENU_API });
  if (!q.ok) {
    res.failed += ops.length;
    lines.push(`MISLUKT menu: ${navError(q.error)}`);
    manual();
    return { lines, ...res };
  }
  const menus = (q.data && q.data.menus && q.data.menus.nodes) || [];
  const byMenu = new Map();
  for (const op of ops) {
    if (!byMenu.has(op.menu)) byMenu.set(op.menu, []);
    byMenu.get(op.menu).push(op);
  }
  for (const [handle, list] of byMenu) {
    const menu = menus.find((m) => lc(m.handle) === lc(handle));
    if (!menu) {
      res.failed += list.length;
      lines.push(`MISLUKT menu "${handle}" niet gevonden`);
      continue;
    }
    const tree = (menu.items || []).map(toInput);
    let changed = 0;
    for (const op of list) {
      const path = [handle, ...(op.parent || [])].join(" › ");
      // ouder zoeken op titel
      let kids = tree;
      let ok = true;
      for (const t of op.parent || []) {
        const hit = byTitle(kids, t);
        if (!hit) {
          ok = false;
          break;
        }
        hit.items = hit.items || [];
        kids = hit.items;
      }
      if (!ok) {
        res.failed++;
        lines.push(`MISLUKT ${path}: menu-item niet gevonden`);
        continue;
      }
      const there = byTitle(kids, op.title);
      try {
        if (ctx.revert) {
          if (!there) {
            res.skipped++;
            lines.push(`${path}: "${op.title}" staat er al niet meer`);
            continue;
          }
          const gid = await collectionGid(store, op.collection, ctx);
          if (gid && there.resourceId && there.resourceId !== gid) {
            res.skipped++;
            lines.push(`${path}: "${op.title}" wijst intussen ergens anders heen — blijft staan`);
            continue;
          }
          kids.splice(kids.indexOf(there), 1);
          changed++;
          res.done++;
          lines.push(`${ctx.dryRun ? "zou weghalen" : "weggehaald"}: ${path} › "${op.title}"`);
          continue;
        }
        if (there) {
          // ontbrekende sub-items wel aanvullen
          const missing = (op.children || []).filter((k) => !byTitle(there.items, k.title));
          if (!missing.length) {
            res.skipped++;
            lines.push(`${path}: "${op.title}" staat er al`);
            continue;
          }
          there.items = there.items || [];
          for (const k of missing) there.items.push(await newItem(store, k, ctx));
          changed++;
          res.done++;
          lines.push(`${ctx.dryRun ? "zou aanvullen" : "aangevuld"}: ${path} › "${op.title}" + ${missing.map((k) => k.title).join(", ")}`);
          continue;
        }
        const item = await newItem(store, op, ctx);
        const after = op.after ? byTitle(kids, op.after) : null;
        if (after) kids.splice(kids.indexOf(after) + 1, 0, item);
        else kids.push(item);
        changed++;
        res.done++;
        const sub = (op.children || []).length ? ` (met ${op.children.map((k) => k.title).join(", ")})` : "";
        lines.push(`${ctx.dryRun ? "zou toevoegen" : "toegevoegd"}: ${path} › "${op.title}"${after ? ` na "${after.title}"` : " (achteraan)"}${sub}`);
      } catch (e) {
        res.failed++;
        lines.push(`MISLUKT ${path} › "${op.title}": ${String(e.message || e).slice(0, 160)}`);
      }
    }
    if (!changed || ctx.dryRun) continue;
    const u = await storeGraphql(store, MENU_U, { id: menu.id, title: menu.title, items: tree }, { version: MENU_API });
    const ue = (u.ok && u.data && u.data.menuUpdate && u.data.menuUpdate.userErrors) || [];
    if (!u.ok || ue.length) {
      res.failed += changed;
      res.done -= changed;
      lines.push(`MISLUKT menu "${handle}" opslaan: ${navError(u.ok ? ue.map((x) => x.message).join("; ") : u.error)}`);
      manual();
    } else {
      lines.push(`menu "${menu.title}" opgeslagen`);
    }
  }
  return { lines, ...res };
}

/**
 * ops = { collections: [...], menus: [...] } (al gefilterd op groep, zie storeOpsOf)
 * → { ok, done, skipped, failed, lines[] }
 */
export async function runPlanStoreOps(store, ops, { dryRun = false, revert = false } = {}) {
  const ctx = { dryRun, revert, ids: new Map(), planned: new Set() };
  const lines = [];
  const tot = { done: 0, skipped: 0, failed: 0 };
  const cols = (ops && ops.collections) || [];
  const menus = (ops && ops.menus) || [];

  async function runCols() {
    for (const op of cols) {
      try {
        const r = await collectionOp(store, op, ctx);
        tot[r.st === "do" ? "done" : r.st === "fail" ? "failed" : "skipped"]++;
        lines.push(r.st === "fail" ? `MISLUKT ${r.line}` : r.line);
      } catch (e) {
        tot.failed++;
        lines.push(`MISLUKT ${String(e.message || e).slice(0, 200)}`);
      }
    }
  }
  async function runMenus() {
    if (!menus.length) return;
    const m = await menuOps(store, menus, ctx);
    lines.push(...m.lines);
    tot.done += m.done;
    tot.skipped += m.skipped;
    tot.failed += m.failed;
  }
  // vooruit: eerst collecties (het menu wijst ernaar) · terug: eerst het menu
  if (revert) {
    await runMenus();
    await runCols();
  } else {
    await runCols();
    await runMenus();
  }
  return { ok: true, ...tot, lines };
}
