import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions } from "./lib/session";
import { reisSessionOptions } from "./lib/reis/session";
import { TP_VERIFY_HTML } from "./lib/tp-verify";
import { ORG_COOKIE, normOrg, toolAllowed } from "./lib/org";

// /kw = statische keyword-CSV's die Google Sheets via IMPORTDATA mag ophalen
// /api/size-guide/job/tick = cloud-run van de Size Guide roept zichzelf aan
// (server → server, geen sessie); de route eist zelf het job-geheim.
// /tp = lege verificatiepagina voor Travelpayouts (vluchtprijzen reisplanner)
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/kw", "/api/size-guide/job/tick", "/tp"];

// Reisplanner (27-10-2026): /reis + /api/reis hebben een EIGEN login
// (cookie attoh_reis_session, gebruikers Justin + Quinty) en staan los van
// de store-tools. Open: de loginpagina, de login-API en de dagelijkse cron
// (die eist zelf CRON_SECRET).
const REIS_PUBLIC = ["/reis/login", "/api/reis/login", "/api/reis/cron"];
const isReis = (p) => p === "/reis" || p.startsWith("/reis/") || p.startsWith("/api/reis/");

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  // Travelpayouts-verificatie: kale HTML met hun script in de <head>
  if (pathname === "/tp") {
    return new NextResponse(TP_VERIFY_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // App-icoon + manifest van de reisplanner (beginscherm telefoon) zijn openbaar
  if (pathname === "/reis-manifest.json" || pathname.startsWith("/reis-icon-")) return NextResponse.next();

  if (isReis(pathname)) {
    if (REIS_PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
    const res = NextResponse.next();
    const rs = await getIronSession(req, res, reisSessionOptions);
    if (!rs.user) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
      return NextResponse.redirect(new URL("/reis/login", req.url));
    }
    return res;
  }

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
