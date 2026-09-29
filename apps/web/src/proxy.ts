import { type NextRequest, NextResponse } from "next/server";

import { checkAdminLogin } from "@/server/admin/login-guard";

// Spec §10: nothing under /metrics is ever cached or indexed, whatever the answer.
const PRIVATE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const CHALLENGE = 'Basic realm="mymeetingapp admin", charset="UTF-8"';

// Browsers attach Basic credentials to any request for this site, even one another site triggers, so anything but
// a read must come from a page on this host. Next.js checks Server Actions the same way, but logs the mismatched
// header values when it refuses one; refusing here first keeps them out of the logs (spec §2).
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin === null || host === null) return false;
  return URL.parse(origin)?.host === host;
}

// Spec §10: HTTP Basic Auth for /metrics and its admin views. A Vercel Firewall rule on /metrics limits each
// visitor, so the app stores no IP; failed sign-ins also count toward a site-wide backstop of 200 a UTC day in
// Postgres. Nothing about a request is logged. Vercel serves only HTTPS, so the credentials never travel in the
// clear.
export async function proxy(request: NextRequest): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return new Response("Requests from other sites aren't allowed here.", { status: 403, headers: PRIVATE });
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

export const config = { matcher: ["/metrics", "/metrics/:path*"] };
