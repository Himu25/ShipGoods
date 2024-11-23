import { NextResponse } from "next/server";

export function middleware(request) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get("token")?.value;
  const role = request.cookies.get("role")?.value;

  if (pathname === "/login") {
    if (token && role) {
      let redirectUrl;
      if (role === "admin") {
        redirectUrl = new URL("/admin/fleet", request.url);
      } else if (role === "driver") {
        redirectUrl = new URL("/driver/jobs", request.url);
      } else if (role === "user") {
        redirectUrl = new URL("/", request.url);
      }
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  if (!token || !role) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/" && role !== "user") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/admin") && role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/driver") && role !== "driver") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/user") && role !== "user") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/driver/:path*", "/user/:path*", "/", "/login"],
};
