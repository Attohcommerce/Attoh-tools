import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions } from "./lib/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

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
