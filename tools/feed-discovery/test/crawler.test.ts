import { startServer } from "@mymeetingapp/test-server";
import { USER_AGENT } from "@mymeetingapp/feed-kit";
import { afterEach, describe, expect, it } from "vitest";

import { createCrawler } from "../src/crawler";

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function serve(
  routes: Record<string, { status: number; body?: string; headers?: Record<string, string> }>,
) {
  const server = await startServer((path) => routes[path] ?? { status: 404, body: "not found" });
  servers.push(server);
  return server;
}

describe("createCrawler", () => {
  it("fetches an allowed page with the project User-Agent", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/page": { status: 200, body: "hello", headers: { "Content-Type": "text/html" } },
    });
    const result = await createCrawler().get(`${server.baseUrl}/page`);
    expect(result).toEqual({
      kind: "response",
      status: 200,
      url: `${server.baseUrl}/page`,
      contentType: "text/html",
      body: "hello",
    });
    expect(server.requests.find((r) => r.path === "/page")?.headers["user-agent"]).toBe(USER_AGENT);
  });

  it("never requests a path robots.txt disallows", async () => {
    const server = await serve({
      "/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /wp-json/" },
      "/wp-json/tsml/meetings": { status: 200, body: "[]" },
    });
    const result = await createCrawler().get(`${server.baseUrl}/wp-json/tsml/meetings`);
    expect(result).toEqual({ kind: "blocked_by_robots", url: `${server.baseUrl}/wp-json/tsml/meetings` });
    expect(server.requests.map((r) => r.path)).toEqual(["/robots.txt"]);
  });

  it("checks robots.txt again for every redirect hop", async () => {
    const server = await serve({
      "/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /private" },
      "/start": { status: 301, headers: { Location: "/private/feed" } },
      "/private/feed": { status: 200, body: "[]" },
    });
    const result = await createCrawler().get(`${server.baseUrl}/start`);
    expect(result).toEqual({ kind: "blocked_by_robots", url: `${server.baseUrl}/private/feed` });
    expect(server.requests.map((r) => r.path)).not.toContain("/private/feed");
  });

  it("follows allowed redirects and reports the final URL", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/old": { status: 301, headers: { Location: "/new" } },
      "/new": { status: 200, body: "ok" },
    });
    expect(await createCrawler().get(`${server.baseUrl}/old`)).toMatchObject({
      kind: "response",
      url: `${server.baseUrl}/new`,
      body: "ok",
    });
  });

  it("stops after five redirects", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/loop": { status: 302, headers: { Location: "/loop" } },
    });
    expect(await createCrawler().get(`${server.baseUrl}/loop`)).toEqual({
      kind: "error",
      message: "too many redirects",
    });
  });

  it("refuses a body declared larger than 50 MB without downloading it", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/huge": { status: 200, body: "[]", headers: { "Content-Length": String(60 * 1024 * 1024) } },
    });
    expect(await createCrawler().get(`${server.baseUrl}/huge`)).toEqual({
      kind: "error",
      message: "too large",
    });
  });

  it("spaces concurrent requests to one host a second apart, counting the robots.txt request", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/a": { status: 200, body: "a" },
      "/b": { status: 200, body: "b" },
    });
    const crawler = createCrawler();
    await Promise.all([crawler.get(`${server.baseUrl}/a`), crawler.get(`${server.baseUrl}/b`)]);
    const times = server.requests.map((r) => r.at);
    expect(server.requests.map((r) => r.path).sort()).toEqual(["/a", "/b", "/robots.txt"]);
    for (let i = 1; i < times.length; i += 1) {
      expect((times[i] ?? 0) - (times[i - 1] ?? Infinity)).toBeGreaterThanOrEqual(990);
    }
  });

  it("fetches robots.txt only once per origin", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/a": { status: 200, body: "a" },
      "/b": { status: 200, body: "b" },
    });
    const crawler = createCrawler();
    await crawler.get(`${server.baseUrl}/a`);
    await crawler.get(`${server.baseUrl}/b`);
    expect(server.requests.filter((r) => r.path === "/robots.txt")).toHaveLength(1);
  });
});
