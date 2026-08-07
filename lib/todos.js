// To-do board — opgeslagen in Vercel's Redis (node-redis client, env var REDIS_URL).
// Elke user heeft één key ("todos:<email>") met daarin de hele lijst als JSON-string.
import { createClient } from "redis";

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    if (!process.env.REDIS_URL) {
      clientPromise = null;
      throw new Error("REDIS_URL env var ontbreekt");
    }
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => console.error("Redis error:", err));
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

function key(email) {
  return `todos:${String(email || "").toLowerCase().trim()}`;
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readAll(email) {
  const client = await getClient();
  const raw = await client.get(key(email));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeAll(email, list) {
  const client = await getClient();
  await client.set(key(email), JSON.stringify(list));
}

export async function listTodosForUser(userEmail) {
  const list = await readAll(userEmail);
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

// bucket: "today" | "tomorrow" | "thisweek" | "later"
export async function addTodo(userEmail, { text, bucket, date }) {
  const cleanText = String(text || "").trim();
  if (!cleanText) throw new Error("Tekst mag niet leeg zijn");
  const isDayType = bucket === "today" || bucket === "tomorrow";
  const item = {
    id: newId(),
    text: cleanText,
    done: false,
    date: isDayType ? date || "" : "",
    bucket: isDayType ? "" : bucket || "later",
    createdAt: new Date().toISOString(),
  };
  const list = await readAll(userEmail);
  list.push(item);
  await writeAll(userEmail, list);
  return { id: item.id };
}

export async function setTodoDone(userEmail, id, done) {
  const list = await readAll(userEmail);
  const item = list.find((t) => t.id === id);
  if (!item) throw new Error("Taak niet gevonden");
  item.done = Boolean(done);
  await writeAll(userEmail, list);
  return { ok: true };
}

// Mag alleen verwijderd worden als de taak al is afgevinkt.
export async function deleteTodo(userEmail, id) {
  const list = await readAll(userEmail);
  const item = list.find((t) => t.id === id);
  if (!item) throw new Error("Taak niet gevonden");
  if (!item.done) throw new Error("Vink de taak eerst af voor je 'm verwijdert");
  await writeAll(userEmail, list.filter((t) => t.id !== id));
  return { ok: true };
}
