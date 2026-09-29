import { describe, expect, it } from "vitest";

import { E2E_URL } from "./e2e-server";

describe("the public site", () => {
  it("serves the landing page with the footer disclaimer and a self-hosted font", async () => {
    const res = await fetch(`${E2E_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("is not affiliated with or endorsed by Alcoholics Anonymous");
    expect(html).toMatch(/<link[^>]+href="\/_next\/static\/media\/[^"]+\.woff2"/);
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("sets no cookies and loads no script from another site (spec §2)", async () => {
    const res = await fetch(`${E2E_URL}/`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).not.toMatch(/<script[^>]+src="https?:\/\//);
  });
});
