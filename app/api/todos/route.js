import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listTodosForUser, addTodo } from "@/lib/todos";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  try {
    const todos = await listTodosForUser(session.user.email);
    return NextResponse.json({ todos });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { title, desc, images, bucket, date } = body || {};
  if (!title || !String(title).trim()) {
    return NextResponse.json({ error: "Titel mag niet leeg zijn" }, { status: 400 });
  }
  if (!["today", "tomorrow", "thisweek", "later"].includes(bucket)) {
    return NextResponse.json({ error: "Ongeldige lijst" }, { status: 400 });
  }
  try {
    const result = await addTodo(session.user.email, { title, desc, images, bucket, date });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
