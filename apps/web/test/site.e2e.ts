import { ApiErrorBody } from "@mymeetingapp/shared";
import { describe, expect, it } from "vitest";

import { E2E_URL } from "./e2e-server";
import { deviceHeaders } from "./tag-fixtures";

describe("the public site", () => {
  it("serves the landing page with the footer disclaimer and a self-hosted font", async () => {
    const res = await fetch(`${E2E_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(
      "My Meeting App<!-- --> is not affiliated with or endorsed by Alcoholics Anonymous",
    );
    expect(html).toContain('<meta name="application-name" content="My Meeting App"/>');
    expect(html).toContain('<a class="wordmark" href="/">My Meeting App</a>');
    expect(html).toMatch(/<link[^>]+href="\/_next\/static\/media\/[^"]+\.woff2"/);
    expect(html).not.toContain("fonts.googleapis.com");
  });

  // Links the visitor follows (<a href>) and the canonical URL name another site without loading anything from it.
  it.each(["/", "/privacy", "/terms", "/support"])(
    "%s sets no cookies and loads nothing from another site (spec §2)",
    async (path) => {
      const res = await fetch(`${E2E_URL}${path}`);
      expect(res.headers.get("set-cookie")).toBeNull();
      const loads = (await res.text()).replace(/<a\s[^>]*>/g, "").replace(/<link rel="canonical"[^>]*>/g, "");
      expect(loads).not.toMatch(/(src|href)="(https?:)?\/\//);
    },
  );

  it("serves the coming-soon home page, with no screenshots or structured data", async () => {
    const html = await (await fetch(`${E2E_URL}/`)).text();
    expect(html).toContain("Coming soon.");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("application/ld+json");
  });
});

describe("search engine files and links", () => {
  it("serves a robots.txt that keeps crawlers out of everything, and no sitemap", async () => {
    const robotsTxt = await (await fetch(`${E2E_URL}/robots.txt`)).text();
    expect(robotsTxt).toContain("Disallow: /");
    expect(robotsTxt).not.toContain("Sitemap:");
    expect((await fetch(`${E2E_URL}/sitemap.xml`)).status).toBe(404);
  });

  it.each(["/", "/privacy", "/terms", "/support"])(
    "gives %s its canonical link and Open Graph URL",
    async (path) => {
      const html = await (await fetch(`${E2E_URL}${path}`)).text();
      const url = `https://mymeetingapp.test${path === "/" ? "" : path}`;
      expect(html).toContain(`<link rel="canonical" href="${url}"/>`);
      expect(html).toContain(`<meta property="og:url" content="${url}"/>`);
      expect(html).toContain('<meta property="og:site_name" content="My Meeting App"/>');
    },
  );
});

describe("requests from other sites", () => {
  it.each(["/", "/support"])("refuses a cross-site post to %s", async (path) => {
    const res = await fetch(`${E2E_URL}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: "https://evil.example" },
      body: new FormData(),
    });
    expect(res.status).toBe(403);
  });

  it("still takes the app's posts to /api/, which carry no Origin", async () => {
    const res = await fetch(`${E2E_URL}/api/v1/tags`, {
      method: "POST",
      headers: deviceHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe("invalid_request");
  });

  it("serves the self-hosted font, as Next builds it", async () => {
    const html = await (await fetch(`${E2E_URL}/`)).text();
    const font = /<link[^>]+href="(\/_next\/static\/media\/[^"]+\.woff2)"/.exec(html)?.[1];
    expect(font).toBeDefined();
    expect((await fetch(`${E2E_URL}${font ?? ""}`)).status).toBe(200);
  });
});
