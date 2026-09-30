import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("robots.txt", () => {
  it("keeps crawlers out of /metrics and the API, and names the sitemap (spec §9)", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/metrics", "/api/"] },
      sitemap: "https://mymeetingapp.test/sitemap.xml",
    });
  });
});

describe("the sitemap", () => {
  it("lists the four public pages at the site URL", () => {
    expect(sitemap()).toEqual([
      { url: "https://mymeetingapp.test/" },
      { url: "https://mymeetingapp.test/privacy" },
      { url: "https://mymeetingapp.test/terms" },
      { url: "https://mymeetingapp.test/support" },
    ]);
  });
});
