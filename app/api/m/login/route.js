import { NextResponse } from "next/server";
import { getDashSession } from "@/lib/dash-session";
import { tokenMark, dashByToken, dashFail, dashFailCount, dashFailReset, dashTouch } from "@/lib/dash-ext";

// Dashboard Mobiel — inloggen met de telefoonlink (token) + het e-mailadres
// dat bij die link hoort. Geen wachtwoord: de link is het geheim.
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { token, email } = await req.json().catch(() => ({}));
  const t = String(token || "").trim();
  const e = String(email || "").trim().toLowerCase();
  if (!t) return NextResponse.json({ error: "Open je dashboard-link opnieuw." }, { status: 400 });
  if (!e) return NextResponse.json({ error: "Vul je e-mailadres in." }, { status: 400 });
  if ((await dashFailCount(t)) >= 8) return NextResponse.json({ error: "Te veel pogingen. Probeer het over 15 minuten opnieuw." }, { status: 429 });

  const u = await dashByToken(t);
  if (!u || u.email !== e) {
    await dashFail(t);
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Dit e-mailadres hoort niet bij deze link." }, { status: 401 });
  }
  await dashFailReset(t);
  const session = await getDashSession();
  session.user = { id: u.id, email: u.email, mark: tokenMark(u.token) };
  await session.save();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  await dashTouch({ ...u, lastSeen: "" }, ip);
  return NextResponse.json({ ok: true });
}
