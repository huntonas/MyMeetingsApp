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

// Whether the server finishes closing in time: it can't while a response it is still streaming is
// being held open by a client that neither read nor cancelled the body.
async function closesPromptly(server: { close(): Promise<void> }): Promise<boolean> {
  return Promise.race([
    server.close().then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 1000);
    }),
  ]);
}

const bigStream = { chunk: "x".repeat(65_536), count: 2000 };

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

  it("treats a robots.txt server error as disallowing everything (RFC 9309)", async () => {
    const server = await serve({
      "/robots.txt": { status: 503 },
      "/page": { status: 200, body: "hello" },
    });
    const result = await createCrawler().get(`${server.baseUrl}/page`);
    expect(result).toEqual({ kind: "blocked_by_robots", url: `${server.baseUrl}/page` });
    expect(server.requests.map((r) => r.path)).toEqual(["/robots.txt"]);
  });

  it("treats an unreachable robots.txt as disallowing everything", async () => {
    const server = await startServer(() => ({ status: 200 }));
    await server.close();
    expect(await createCrawler().get(`${server.baseUrl}/page`)).toEqual({
      kind: "blocked_by_robots",
      url: `${server.baseUrl}/page`,
    });
  });

  it("treats a robots.txt body that fails mid-read as disallowing everything", async () => {
    const server = await serve({
      "/robots.txt": { status: 200, body: "not gzip", headers: { "Content-Encoding": "gzip" } },
      "/page": { status: 200, body: "hello" },
    });
    expect(await createCrawler().get(`${server.baseUrl}/page`)).toEqual({
      kind: "blocked_by_robots",
      url: `${server.baseUrl}/page`,
    });
  });

  it("follows a redirected robots.txt and honours the file it lands on", async () => {
    const server = await serve({
      "/robots.txt": { status: 301, headers: { Location: "/real-robots.txt" } },
      "/real-robots.txt": { status: 200, body: "User-agent: *\nDisallow: /private" },
      "/private/feed": { status: 200, body: "[]" },
    });
    const result = await createCrawler().get(`${server.baseUrl}/private/feed`);
    expect(result).toEqual({ kind: "blocked_by_robots", url: `${server.baseUrl}/private/feed` });
    expect(server.requests.map((r) => r.path)).toEqual(["/robots.txt", "/real-robots.txt"]);
  });

  it("treats robots.txt as unavailable, allowing everything, after five redirects", async () => {
    const server = await serve({
      "/robots.txt": { status: 302, headers: { Location: "/robots.txt" } },
      "/page": { status: 200, body: "hello" },
    });
    expect(await createCrawler().get(`${server.baseUrl}/page`)).toMatchObject({
      kind: "response",
      body: "hello",
    });
    expect(server.requests.filter((r) => r.path === "/robots.txt")).toHaveLength(6);
  });

  it("treats a robots.txt redirect to a malformed Location as unavailable, allowing everything", async () => {
    const server = await serve({
      "/robots.txt": { status: 301, headers: { Location: "http://bad host/robots.txt" } },
      "/page": { status: 200, body: "hello" },
    });
    expect(await createCrawler().get(`${server.baseUrl}/page`)).toMatchObject({
      kind: "response",
      body: "hello",
    });
  });

  it("reports a redirect to a malformed Location as an error instead of throwing", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/start": { status: 301, headers: { Location: "http://bad host/feed" } },
    });
    expect(await createCrawler().get(`${server.baseUrl}/start`)).toEqual({
      kind: "error",
      message: "bad redirect",
    });
  });

  it("reports a body that fails mid-read as an error instead of throwing", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      // Claims gzip but isn't, so decoding the body fails after the response has arrived.
      "/broken": { status: 200, body: "not gzip", headers: { "Content-Encoding": "gzip" } },
    });
    expect(await createCrawler().get(`${server.baseUrl}/broken`)).toEqual({
      kind: "error",
      message: "could not read the response",
    });
  });

  it("cancels a redirect's unread body before following it", async () => {
    const server = await startServer((path) =>
      path === "/start"
        ? { status: 301, headers: { Location: "/end" }, stream: bigStream }
        : { status: path === "/end" ? 200 : 404, body: "done" },
    );
    servers.push(server);
    expect(await createCrawler().get(`${server.baseUrl}/start`)).toMatchObject({ body: "done" });
    expect(await closesPromptly(server)).toBe(true);
  });

  it("cancels a robots.txt redirect's unread body before following it", async () => {
    const server = await startServer((path) =>
      path === "/robots.txt"
        ? { status: 301, headers: { Location: "/real-robots.txt" }, stream: bigStream }
        : { status: path === "/page" ? 200 : 404, body: "done" },
    );
    servers.push(server);
    expect(await createCrawler().get(`${server.baseUrl}/page`)).toMatchObject({ body: "done" });
    expect(await closesPromptly(server)).toBe(true);
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
