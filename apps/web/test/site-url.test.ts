import { afterEach, describe, expect, it, vi } from "vitest";

import { siteUrl } from "@/lib/site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("is the configured origin", () => {
    vi.stubEnv("SITE_URL", "https://mymeetings.app");
    expect(siteUrl()).toBe("https://mymeetings.app");
  });

  it("drops a trailing slash", () => {
    vi.stubEnv("SITE_URL", "https://mymeetings.app/");
    expect(siteUrl()).toBe("https://mymeetings.app");
  });

  it.each([
    undefined,
    "mymeetings.app",
    "ftp://mymeetings.app",
    "https://mymeetings.app/app",
    "https://mymeetings.app/?ref=x",
  ])("refuses a value that isn't an http(s) origin: %j", (value) => {
    vi.stubEnv("SITE_URL", value);
    expect(() => siteUrl()).toThrow("SITE_URL must be an http(s) origin such as https://mymeetings.app");
  });
});
