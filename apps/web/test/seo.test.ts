import { describe, expect, it } from "vitest";

import robots from "@/app/robots";

// Owner decision, 2026-10-06: until launch, no crawler reads any page.
describe("robots.txt", () => {
  it("keeps every crawler out of the whole site, with no sitemap", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
