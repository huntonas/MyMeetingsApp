import { readFileSync } from "node:fs";
import path from "node:path";

import { createHostThrottle } from "@mymeetingapp/feed-kit";
import { afterEach, describe, expect, it } from "vitest";

import { fetchFeed } from "@/server/feeds/fetch-feed";

import { startServer } from "@mymeetingapp/test-server";

const fixture = (name: string) =>
  readFileSync(path.resolve(import.meta.dirname, "../../../packages/feed-kit/test/fixtures", name), "utf8");

const noCache = { etag: null, lastModified: null };
const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(...args: Parameters<typeof startServer>) {
  const server = await startServer(...args);
  servers.push(server);
  return server;
}

describe("fetchFeed", () => {
  it("returns the parsed body and caching headers, identifying itself with a contact email", async () => {
    const server = await serve(() => ({
      status: 200,
      body: '[{"slug":"a"}]',
      headers: {
        "Content-Type": "application/json",
        ETag: '"v1"',
        "Last-Modified": "Sat, 26 Sep 2026 10:00:00 GMT",
      },
    }));
    const result = await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle());
    expect(result).toEqual({
      kind: "ok",
      body: [{ slug: "a" }],
      etag: '"v1"',
      lastModified: "Sat, 26 Sep 2026 10:00:00 GMT",
    });
    expect(server.requests[0]?.headers["user-agent"]).toBe(
      "mymeetingapp/1.0 (+https://mymeetings.app; admin@goodersoftwarellc.com)",
    );
  });

  it("sends conditional headers and reports an unchanged feed", async () => {
    const server = await serve(() => ({ status: 304 }));
    const result = await fetchFeed(
      `${server.baseUrl}/feed`,
      { etag: '"v1"', lastModified: "Sat, 26 Sep 2026 10:00:00 GMT" },
      createHostThrottle(),
    );
    expect(result).toEqual({ kind: "not_modified" });
    expect(server.requests[0]?.headers).toMatchObject({
      "if-none-match": '"v1"',
      "if-modified-since": "Sat, 26 Sep 2026 10:00:00 GMT",
    });
  });

  it.each<[string, { status: number; body: string; headers?: Record<string, string> }, string]>([
    [
      "TSML's restriction",
      {
        status: 403,
        body: fixture("tsml-restricted.json"),
        headers: { "Content-Type": "application/json; charset=UTF-8" },
      },
      "restricted by the site (HTTP 403)",
    ],
    [
      "a Cloudflare challenge",
      {
        status: 403,
        body: fixture("cloudflare-challenge.html"),
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      },
      "blocked by a bot check (Cloudflare)",
    ],
    [
      "an Incapsula challenge served as a 200",
      { status: 200, body: fixture("incapsula-challenge.html"), headers: { "Content-Type": "text/html" } },
      "blocked by a bot check (Incapsula)",
    ],
    [
      "an ordinary page",
      {
        status: 200,
        body: fixture("plain-page.html"),
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      },
      "not valid JSON (text/html)",
    ],
    ["a server error", { status: 500, body: "{}" }, "HTTP 500"],
  ])("reports %s as its own error", async (_what, reply, message) => {
    const server = await serve(() => reply);
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message,
    });
  });

  // Spec §4: never past a bot check. One request, with our own User-Agent, and no second try.
  it("asks a bot-checked feed once, as itself, and never again in that run", async () => {
    const server = await serve(() => ({
      status: 403,
      body: fixture("cloudflare-challenge.html"),
      headers: { "Content-Type": "text/html" },
    }));
    await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle());
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.headers["user-agent"]).toBe(
      "mymeetingapp/1.0 (+https://mymeetings.app; admin@goodersoftwarellc.com)",
    );
  });

  it("maps a declared Content-Length over 50 MB to a 'too large' error", async () => {
    // No real body is sent: readBodyCapped's byte-counting behaviour is covered by feed-kit's own tests.
    // This just proves fetchFeed maps its null result to the right error.
    const server = await serve(() => ({
      status: 200,
      headers: { "Content-Length": String(60 * 1024 * 1024) },
    }));
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message: "too large",
    });
  });

  it("spaces requests to one host a second apart, but doesn't delay a different host", async () => {
    const first = await serve(() => ({ status: 200, body: "[]" }));
    const second = await serve(() => ({ status: 200, body: "[]" }));
    const throttle = createHostThrottle();

    const start = Date.now();
    await fetchFeed(`${first.baseUrl}/a`, noCache, throttle);
    await fetchFeed(`${second.baseUrl}/a`, noCache, throttle);
    await fetchFeed(`${first.baseUrl}/b`, noCache, throttle);

    const [firstA, firstB] = first.requests;
    const [secondA] = second.requests;
    expect((secondA?.at ?? Infinity) - (firstA?.at ?? 0)).toBeLessThan(500);
    // The first host's second request leaves no sooner than a second after its first left, which was after the start.
    // (The gap between the two arrivals would also count how much longer the first, opening the connection, took.)
    expect((firstB?.at ?? 0) - start).toBeGreaterThanOrEqual(1000);
  });

  it("reports a host that refuses connections", async () => {
    const server = await serve(() => ({ status: 200 }));
    await server.close();
    servers.pop();
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message: "could not connect",
    });
  });
});
