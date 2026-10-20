import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions } from "./lib/session";
import { ORG_COOKIE, normOrg, toolAllowed } from "./lib/org";

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

  // Organisatie (20-10-2026): in Sa Collective bestaan Bills, Niche kiezen,
  // Size Guide, GMC Checklist enz. niet — een directe link erheen gaat naar
  // de homepage. Cookie `sa_org` wordt gezet door de switch in de topbar.
  const orgCookie = req.cookies.get(ORG_COOKIE);
  const org = normOrg(orgCookie && orgCookie.value);
  if (!pathname.startsWith("/api/") && !toolAllowed(org, pathname)) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
