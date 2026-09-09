import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions } from "./lib/session";

// /kw = statische keyword-CSV's die Google Sheets via IMPORTDATA mag ophalen
// /api/size-guide/job/tick = cloud-run van de Size Guide roept zichzelf aan
// (server → server, geen sessie); de route eist zelf het job-geheim.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/kw", "/api/size-guide/job/tick"];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const session = await getIronSession(req, res, sessionOptions);

  if (!session.user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
