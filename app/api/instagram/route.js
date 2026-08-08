import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  listAccounts,
  getAccount,
  addSnapshot,
  deleteAccount,
  parseFollowers,
  diffSnapshots,
  cleanAccountName,
} from "@/lib/instagram";

export const dynamic = "force-dynamic";

// Alleen Justin (USER1) — de module bestaat voor niemand anders.
async function guard() {
  const session = await getSession();
  if (!session.user) return null;
  const owner = String(process.env.USER1_EMAIL || "").toLowerCase().trim();
  if (!owner || session.user.email !== owner) return null;
  return session;
}

export async function GET(req) {
  if (!(await guard())) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const account = searchParams.get("account");
  try {
    if (account) {
      const data = await getAccount(account);
      // Diff tussen de twee gekozen snapshots (of laatste twee)
      const a = Number(searchParams.get("a"));
      const b = Number(searchParams.get("b"));
      const snaps = data.snapshots;
      let diff = null;
      if (snaps.length >= 2) {
        const older = Number.isInteger(a) && snaps[a] ? snaps[a] : snaps[snaps.length - 2];
        const newer = Number.isInteger(b) && snaps[b] ? snaps[b] : snaps[snaps.length - 1];
        diff = { ...diffSnapshots(older, newer), olderTs: older.ts, newerTs: newer.ts };
      }
      return NextResponse.json({
        account: data.account,
        snapshots: snaps.map((s, i) => ({ i, ts: s.ts, count: s.followers.length })),
        diff,
      });
    }
    return NextResponse.json({ accounts: await listAccounts() });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function POST(req) {
  if (!(await guard())) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const followers = parseFollowers(body.text);
    const result = await addSnapshot(cleanAccountName(body.account), followers);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await guard())) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  try {
    await deleteAccount(searchParams.get("account") || "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}
