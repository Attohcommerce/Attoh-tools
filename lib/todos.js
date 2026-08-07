// To-do board — opgeslagen in Vercel KV (Redis), geen Sheet nodig.
// Elke user heeft één key ("todos:<email>") met daarin de hele lijst als JSON.
// Zet dit werkend door in Vercel: Storage → Create Database → KV, en
// connect 'm aan dit project. Vercel zet de env vars daarna zelf klaar.
import { kv } from "@vercel/kv";

function key(email) {
  return `todos:${String(email || "").toLowerCase().trim()}`;
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readAll(email) {
  const list = await kv.get(key(email));
  return Array.isArray(list) ? list : [];
}

async function writeAll(email, list) {
  await kv.set(key(email), list);
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
