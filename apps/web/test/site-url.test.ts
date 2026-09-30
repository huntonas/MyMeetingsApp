import { afterEach, describe, expect, it, vi } from "vitest";

import { siteUrl } from "@/lib/site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("is the configured origin", () => {
    vi.stubEnv("SITE_URL", "https://mymeetingapp.vercel.app");
    expect(siteUrl()).toBe("https://mymeetingapp.vercel.app");
  });

  it("drops a trailing slash", () => {
    vi.stubEnv("SITE_URL", "https://mymeetingapp.vercel.app/");
    expect(siteUrl()).toBe("https://mymeetingapp.vercel.app");
  });

  it.each([
    undefined,
    "mymeetingapp.vercel.app",
    "ftp://mymeetingapp.vercel.app",
    "https://mymeetingapp.vercel.app/app",
    "https://mymeetingapp.vercel.app/?ref=x",
  ])("refuses a value that isn't an http(s) origin: %j", (value) => {
    vi.stubEnv("SITE_URL", value);
    expect(() => siteUrl()).toThrow(
      "SITE_URL must be an http(s) origin such as https://mymeetingapp.vercel.app",
    );
  });
});
