import { type NextRequest, NextResponse } from "next/server";

import { readEnv } from "@/env";
import { checkAdminLogin } from "@/server/admin/login-guard";

// Spec §10: nothing under /metrics is ever cached or indexed, whatever the answer.
const PRIVATE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const CHALLENGE = 'Basic realm="mymeetingapp admin", charset="UTF-8"';

// Anything but a read to the site (not /api/) must come from a page on this host. Browsers attach /metrics' Basic
// credentials to any request for this site, even one another site triggers, so this is the admin views' CSRF
// protection. Next.js checks Server Actions too, but it logs the request when it refuses one, on any page; refusing
// here first keeps requests out of the logs (spec §2). The app calls /api/ with no Origin, and crons use GET.
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin === null || host === null) return false;
  return URL.parse(origin)?.host === host;
}

// Search engines index production only. Staging is public so TestFlight builds can reach it (Vercel drops its own
// preview noindex once a domain is attached), so its pages say noindex. It fails closed: anything not exactly
// production, a deployment missing its target or a local build included, says noindex.
function publicHeaders(): Record<string, string> {
  return readEnv("VERCEL_TARGET_ENV") === "production" ? {} : { "X-Robots-Tag": "noindex, nofollow" };
}

// Spec §10: HTTP Basic Auth for /metrics and its admin views. Failed sign-ins count toward a site-wide backstop of 200
// a UTC day in Postgres; there is no per-visitor limit (no paid Vercel Firewall rule, owner decision 2026-10-04), and
// the app stores no IP. Nothing about a request is logged. Vercel serves only HTTPS, so the credentials never travel in the
// clear.
export async function proxy(request: NextRequest): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return new Response("Requests from other sites aren't allowed here.", { status: 403, headers: PRIVATE });
  }
  const { pathname } = request.nextUrl;
  if (pathname !== "/metrics" && !pathname.startsWith("/metrics/")) {
    return NextResponse.next({ headers: publicHeaders() });
  }
  switch (await checkAdminLogin(request.headers.get("authorization"))) {
    case "allowed":
      return NextResponse.next({ headers: PRIVATE });
    case "locked":
      return new Response("Too many failed sign-ins today. Try again after midnight UTC.", {
        status: 429,
        headers: PRIVATE,
      });
    case "denied":
      return new Response("Sign in to see the metrics.", {
        status: 401,
        headers: { ...PRIVATE, "WWW-Authenticate": CHALLENGE },
      });
  }
}

// Everything but the API and Next's built assets.
export const config = { matcher: ["/((?!api/|_next/static/|_next/image).*)"] };
