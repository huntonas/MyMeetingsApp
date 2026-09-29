import { ApiErrorBody } from "@mymeetingapp/shared";
import { describe, expect, it } from "vitest";

import { E2E_URL } from "./e2e-server";
import { deviceHeaders } from "./tag-fixtures";

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

  it("builds the structured data with the site URL", async () => {
    const html = await (await fetch(`${E2E_URL}/`)).text();
    expect(html).toContain('"@type":"MobileApplication"');
    expect(html).toContain('"url":"https://mymeetingapp.test"');
  });
});

describe("search engine files and links", () => {
  it("serves robots.txt and the sitemap built with SITE_URL", async () => {
    const robotsTxt = await (await fetch(`${E2E_URL}/robots.txt`)).text();
    expect(robotsTxt).toContain("Disallow: /metrics");
    expect(robotsTxt).toContain("Disallow: /api/");
    expect(robotsTxt).toContain("Sitemap: https://mymeetingapp.test/sitemap.xml");
    const sitemapXml = await (await fetch(`${E2E_URL}/sitemap.xml`)).text();
    expect(sitemapXml).toContain("<loc>https://mymeetingapp.test/privacy</loc>");
  });

  it.each(["/", "/privacy", "/terms", "/support"])(
    "gives %s its canonical link and Open Graph URL",
    async (path) => {
      const html = await (await fetch(`${E2E_URL}${path}`)).text();
      const url = `https://mymeetingapp.test${path === "/" ? "" : path}`;
      expect(html).toContain(`<link rel="canonical" href="${url}"/>`);
      expect(html).toContain(`<meta property="og:url" content="${url}"/>`);
      expect(html).toContain('<meta property="og:site_name" content="mymeetingapp"/>');
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
