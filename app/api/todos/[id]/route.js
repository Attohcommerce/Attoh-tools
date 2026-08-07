import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { setTodoDone, updateTodo, deleteTodo } from "@/lib/todos";

export const dynamic = "force-dynamic";

// PATCH doet twee dingen: {done} togglet afvinken; {title/desc/images}
// werkt de inhoud van de taak bij. Mag ook gecombineerd.
export async function PATCH(req, { params }) {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.title !== undefined || body.desc !== undefined || body.images !== undefined) {
      await updateTodo(session.user.email, params.id, {
        title: body.title,
        desc: body.desc,
        images: body.images,
      });
    }
    if (body.done !== undefined) {
      await setTodoDone(session.user.email, params.id, Boolean(body.done));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}

export async function DELETE(req, { params }) {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  try {
    await deleteTodo(session.user.email, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}
