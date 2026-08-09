import { NextResponse } from "next/server";
import { generateListing, scoreListing } from "@/lib/ai";

export const maxDuration = 60;

export async function POST(req) {
  const { product, settings } = await req.json().catch(() => ({}));
  if (!product) return NextResponse.json({ error: "product ontbreekt" }, { status: 400 });
  try {
    const listing = await generateListing({ product, settings });
    const s = settings || {};
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
