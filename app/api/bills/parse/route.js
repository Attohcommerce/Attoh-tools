import { NextResponse } from "next/server";
import { parseKungfubuyPdf } from "@/lib/bills";

export const maxDuration = 30;

// KUNGFUBUY BILL — PARSE. Ontvangt één PDF (multipart) en geeft de
// uitgelezen orderregels terug. De client stuurt bestanden één voor één,
// zodat ook een backlog van tientallen bills nooit tegen de Vercel-
// bodylimiet (±4,5 MB per request) aanloopt.
export async function POST(req) {
  let fd;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }
  const file = fd.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Geen PDF in het verzoek" }, { status: 400 });
  }
  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json(
      { error: `${file.name || "PDF"} is groter dan 4 MB — stuur deze bill los of in delen` },
      { status: 413 }
    );
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const out = await parseKungfubuyPdf(buf);
    return NextResponse.json({ ok: true, name: file.name || "bill.pdf", ...out });
  } catch (e) {
    return NextResponse.json(
      { error: `PDF niet leesbaar (${file.name || "?"}): ${String(e.message || e)}` },
      { status: 422 }
    );
  }
}
