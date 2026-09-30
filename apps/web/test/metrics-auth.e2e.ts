import { describe, expect, it } from "vitest";

import { ADMIN_AUTHORIZATION, E2E_URL } from "./e2e-server";

describe("/metrics sign-in in the built app (spec §14)", () => {
  it.each(["/metrics", "/metrics/suggestions", "/metrics/swings/1"])(
    "answers %s with 401 without credentials, never cached or indexed",
    async (path) => {
      const res = await fetch(`${E2E_URL}${path}`, { redirect: "manual" });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Basic realm="mymeetingapp admin", charset="UTF-8"');
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    },
  );

  it("never serves /metrics/ with a trailing slash to someone without credentials", async () => {
    const res = await fetch(`${E2E_URL}/metrics/`, { redirect: "manual" });
    expect([308, 401]).toContain(res.status);
  });

  it("refuses a form post from another site even with the right credentials", async () => {
    const res = await fetch(`${E2E_URL}/metrics`, {
      method: "POST",
      redirect: "manual",
      headers: { authorization: ADMIN_AUTHORIZATION, origin: "https://evil.example" },
      body: new FormData(),
    });
    expect(res.status).toBe(403);
  });
});
