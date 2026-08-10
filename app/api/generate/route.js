import { NextResponse } from "next/server";
import { generateListing, scoreListing, fallbackTitleForm } from "@/lib/ai";

export const maxDuration = 60;

export async function POST(req) {
  const { product, settings } = await req.json().catch(() => ({}));
  if (!product) return NextResponse.json({ error: "product ontbreekt" }, { status: 400 });
  try {
    const s = settings || {};
    // Vangnet: gelegenheids-keyword zonder titelvorm uit de briefing →
    // deterministische titelvorm, nooit het rauwe keyword in de titel.
    if (s.keywordType === "Gelegenheid" && !String(s.titleForm || "").trim() && s.requiredKeyword) {
      s.titleForm = fallbackTitleForm(s.requiredKeyword);
    }
    const listing = await generateListing({ product, settings: s });
    // Bij gelegenheids-keywords wordt op de TITELVORM beoordeeld (de exacte
    // long-tail hoort in de omschrijving, niet in de titel).
    const gradeKeyword =
      s.keywordType === "Gelegenheid" && s.titleForm ? s.titleForm : s.requiredKeyword || "";
    const grade = scoreListing(listing, {
      listingStyle: s.listingStyle || "stacking",
      requiredKeyword: gradeKeyword,
    });
    listing.score = grade.score;
    listing.scoreNotes = grade.notes;
    return NextResponse.json({ ok: true, listing });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
