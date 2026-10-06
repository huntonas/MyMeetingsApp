import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { rateLimits } from "@/db/schema";
import { utcToday } from "@/db/sql";
import { proxy } from "@/proxy";

import { resetDb } from "./db";

// base64("owner:correct-horse-battery-staple"), base64("owner:wrong-password-guess-123") and base64("owner:short"),
// computed independently.
const OWNER = "Basic b3duZXI6Y29ycmVjdC1ob3JzZS1iYXR0ZXJ5LXN0YXBsZQ==";
const WRONG = "Basic b3duZXI6d3JvbmctcGFzc3dvcmQtZ3Vlc3MtMTIz";
const SHORT = "Basic b3duZXI6c2hvcnQ=";
const SITE = "https://mymeetingapp.test";
const CHALLENGE = 'Basic realm="mymeetingapp admin", charset="UTF-8"';

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("METRICS_USER", "owner");
  vi.stubEnv("METRICS_PASSWORD", "correct-horse-battery-staple");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

function request(init: { method?: string; headers?: Record<string, string>; path?: string } = {}) {
  return new NextRequest(`${SITE}${init.path ?? "/metrics"}`, {
    method: init.method ?? "GET",
    headers: { host: "mymeetingapp.test", ...init.headers },
  });
}

async function failedSignIns(): Promise<number> {
  const rows = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(eq(rateLimits.bucket, "metrics_login"));
  return rows.reduce((sum, row) => sum + row.count, 0);
}

// Today's site-wide count of failed sign-ins, as if that many had already happened.
async function seedFailedSignIns(count: number): Promise<void> {
  await db
    .insert(rateLimits)
    .values({ deviceHash: "metrics-login", bucket: "metrics_login", windowStart: utcToday, count });
}

// NextResponse.next() marks a response that lets the request continue to the page.
const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy for /metrics (spec §10)", () => {
  it("asks for credentials without counting that as a failed sign-in", async () => {
    const res = await proxy(request());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await failedSignIns()).toBe(0);
  });

  it("lets the owner through, marked never to be cached or indexed", async () => {
    const res = await proxy(request({ headers: { authorization: OWNER } }));
    expect(passesThrough(res)).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it.each([WRONG, "Basic", `Bearer ${OWNER.slice("Basic ".length)}`])(
    "refuses %j and counts it as a failed sign-in",
    async (authorization) => {
      const res = await proxy(request({ headers: { authorization } }));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
      expect(await failedSignIns()).toBe(1);
    },
  );

  it("still lets the owner in after 199 failed sign-ins today", async () => {
    await seedFailedSignIns(199);
    expect(passesThrough(await proxy(request({ headers: { authorization: OWNER } })))).toBe(true);
  });

  it("refuses everyone, the owner included, once 200 sign-ins have failed today", async () => {
    await seedFailedSignIns(199);
    expect((await proxy(request({ headers: { authorization: WRONG } }))).status).toBe(401);
    expect(await failedSignIns()).toBe(200);
    const res = await proxy(request({ headers: { authorization: OWNER } }));
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await failedSignIns()).toBe(200);
  });

  it("refuses everyone while the password is unset or shorter than 16 characters", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("METRICS_PASSWORD", "short");
    expect((await proxy(request({ headers: { authorization: SHORT } }))).status).toBe(401);
    vi.stubEnv("METRICS_PASSWORD", undefined);
    expect((await proxy(request({ headers: { authorization: OWNER } }))).status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "[admin] METRICS_USER and METRICS_PASSWORD (at least 16 characters) must be set; refusing every sign-in",
    );
  });

  it("refuses a post from another site, with no Origin or with a null one, before checking credentials", async () => {
    const crossSite: Record<string, string>[] = [
      { authorization: OWNER, origin: "https://evil.example" },
      { authorization: OWNER },
      { authorization: OWNER, origin: "null" },
    ];
    for (const headers of crossSite) {
      const res = await proxy(request({ method: "POST", headers }));
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(await failedSignIns()).toBe(0);
  });

  it("lets the owner's own form post (a Server Action) through", async () => {
    const res = await proxy(request({ method: "POST", headers: { authorization: OWNER, origin: SITE } }));
    expect(passesThrough(res)).toBe(true);
  });

  it("compares the Origin with the forwarded host Vercel sets", async () => {
    const res = await proxy(
      request({
        method: "POST",
        headers: {
          authorization: OWNER,
          origin: "https://mymeetings.app",
          "x-forwarded-host": "mymeetings.app",
        },
      }),
    );
    expect(passesThrough(res)).toBe(true);
  });
});

describe("proxy for the rest of the site (everything but /api/)", () => {
  it("refuses a post to a public page from another site, or with no Origin, and logs nothing", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const crossSite: Record<string, string>[] = [{ origin: "https://evil.example" }, {}];
    for (const headers of crossSite) {
      const res = await proxy(request({ method: "POST", path: "/", headers }));
      expect(res.status).toBe(403);
    }
    expect([log, warn, error].flatMap((spy) => spy.mock.calls)).toEqual([]);
  });

  it("lets a same-site post to a public page through without asking for credentials", async () => {
    const res = await proxy(request({ method: "POST", path: "/support", headers: { origin: SITE } }));
    expect(passesThrough(res)).toBe(true);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("serves public pages to anyone, without asking for credentials", async () => {
    expect(passesThrough(await proxy(request({ path: "/privacy" })))).toBe(true);
  });

  it("still asks for credentials on a path under /metrics", async () => {
    expect((await proxy(request({ path: "/metrics/opt-outs" }))).status).toBe(401);
  });
});

// Owner decision, 2026-10-06: until launch, no page is indexed, production included.
describe("indexing", () => {
  it.each(["production", "staging", "preview", undefined])(
    "marks public pages noindex when the target is %j",
    async (target) => {
      vi.stubEnv("VERCEL_TARGET_ENV", target);
      const res = await proxy(request({ path: "/privacy" }));
      expect(passesThrough(res)).toBe(true);
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    },
  );
});
