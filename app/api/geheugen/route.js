import { NextResponse } from "next/server";
import {
  allStatus, setAllSheet, allPrepare, allCommit, allLink,
  storeList, storeSave, storeSnapshot,
} from "@/lib/geheugen";

// Een gekoppeld All keywords-tabblad (±100k rijen) en een store-snapshot
// (tot 5000 producten + collecties) lezen — ruim de tijd geven.
export const maxDuration = 300;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "status") {
      const [all, stores] = await Promise.all([allStatus(), storeList()]);
      return NextResponse.json({ ok: true, all, stores });
    }
    if (action === "allSheet") {
      return NextResponse.json({ ok: true, saved: await setAllSheet(body.market, body.link) });
    }
    if (action === "allPrepare") {
      return NextResponse.json(await allPrepare(body));
    }
    if (action === "allCommit") {
      return NextResponse.json(await allCommit(body));
    }
    if (action === "allLink") {
      return NextResponse.json(await allLink(body));
    }
    if (action === "storeSave") {
      return NextResponse.json({ ok: true, entry: await storeSave(body) });
    }
    if (action === "storeSnapshot") {
      return NextResponse.json(await storeSnapshot(body));
    }
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (e) {
    console.error("[geheugen]", e && e.stack ? e.stack : e);
    return NextResponse.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
