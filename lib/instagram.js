// Instagram volgers-tracker — snapshots in Redis, alleen voor USER1 (Justin).
// Per gevolgd account: lijst snapshots [{ts, followers[]}] (max 30 bewaard).
// De diff (wie erbij, wie weg) wordt berekend tussen twee snapshots.
import { createClient } from "redis";

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL env var ontbreekt");
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => console.error("Redis error:", err));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

const INDEX_KEY = "ig:accounts";
const MAX_SNAPSHOTS = 30;

function accKey(account) {
  return `ig:acc:${account}`;
}

export function cleanAccountName(name) {
  return String(name || "")
    .trim()
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

// Geplakte tekst → lijst usernames. Snapt losse regels, komma's, en de
// rommel die meekomt als je de volgers-dialoog van Instagram kopieert
// ("naam", "Follow"-knoppen, "profile picture"-regels).
export function parseFollowers(text) {
  const NOISE = new Set([
    "follow", "following", "remove", "volgen", "volgend", "verwijderen",
    "followers", "volgers", "search", "zoeken", "verified", "geverifieerd",
  ]);
  const out = [];
  const seen = new Set();
  for (let raw of String(text || "").split(/[\n,;]+/)) {
    let t = raw.trim().replace(/^@/, "");
    if (!t || /profile picture/i.test(raw) || /profielfoto/i.test(raw)) continue;
    t = t.toLowerCase();
    if (NOISE.has(t)) continue;
    // Instagram-usernames: letters/cijfers/punt/underscore, 1-30 tekens
    if (!/^[a-z0-9._]{1,30}$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

async function readIndex(client) {
  const raw = await client.get(INDEX_KEY);
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function listAccounts() {
  const client = await getClient();
  const names = await readIndex(client);
  const out = [];
  for (const name of names) {
    const raw = await client.get(accKey(name));
    let snaps = [];
    try {
      snaps = JSON.parse(raw || "[]");
    } catch {}
    const last = snaps[snaps.length - 1];
    out.push({
      account: name,
      snapshots: snaps.length,
      lastTs: last ? last.ts : null,
      lastCount: last ? last.followers.length : 0,
    });
  }
  return out;
}

export async function getAccount(account) {
  const client = await getClient();
  const name = cleanAccountName(account);
  const raw = await client.get(accKey(name));
  let snaps = [];
  try {
    snaps = JSON.parse(raw || "[]");
  } catch {}
  return { account: name, snapshots: snaps };
}

export async function addSnapshot(account, followers) {
  const client = await getClient();
  const name = cleanAccountName(account);
  if (!name) throw new Error("Geen accountnaam");
  if (!followers.length) throw new Error("Geen geldige usernames gevonden in de geplakte tekst");

  const { snapshots } = await getAccount(name);
  const prev = snapshots[snapshots.length - 1] || null;
  snapshots.push({ ts: Date.now(), followers });
  while (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
  await client.set(accKey(name), JSON.stringify(snapshots));

  const index = await readIndex(client);
  if (!index.includes(name)) {
    index.push(name);
    await client.set(INDEX_KEY, JSON.stringify(index));
  }

  // Diff t.o.v. de vorige snapshot direct meegeven
  let diff = null;
  if (prev) {
    const prevSet = new Set(prev.followers);
    const nowSet = new Set(followers);
    diff = {
      added: followers.filter((f) => !prevSet.has(f)),
      removed: prev.followers.filter((f) => !nowSet.has(f)),
      prevTs: prev.ts,
      prevCount: prev.followers.length,
    };
  }
  return { account: name, count: followers.length, snapshots: snapshots.length, diff };
}

export function diffSnapshots(a, b) {
  // a = ouder, b = nieuwer
  const aSet = new Set(a.followers);
  const bSet = new Set(b.followers);
  return {
    added: b.followers.filter((f) => !aSet.has(f)),
    removed: a.followers.filter((f) => !bSet.has(f)),
  };
}

export async function deleteAccount(account) {
  const client = await getClient();
  const name = cleanAccountName(account);
  await client.del(accKey(name));
  const index = await readIndex(client);
  await client.set(INDEX_KEY, JSON.stringify(index.filter((n) => n !== name)));
  return { ok: true };
}
