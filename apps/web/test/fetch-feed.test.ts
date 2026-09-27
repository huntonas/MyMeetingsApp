import { afterEach, describe, expect, it } from "vitest";

import { fetchFeed } from "@/server/feeds/fetch-feed";
import { createHostThrottle } from "@/server/feeds/throttle";

import { startServer } from "@mymeetingapp/test-server";

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
      "mymeetingapp/1.0 (+https://mymeetingapp.com; admin@goodersoftwarellc.com)",
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

  it.each([
    [403, "restricted (HTTP 403)"],
    [401, "restricted (HTTP 401)"],
    [500, "HTTP 500"],
  ])("reports HTTP %i as %j", async (status, message) => {
    const server = await serve(() => ({ status, body: "{}" }));
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message,
    });
  });

  it("reports a body that isn't JSON", async () => {
    const server = await serve(() => ({ status: 200, body: "<html>" }));
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message: "not valid JSON",
    });
  });

  it("rejects a declared Content-Length over 50 MB without reading the body", async () => {
    const declared = 60 * 1024 * 1024;
    const chunk = "x".repeat(65_536);
    const server = await serve(() => ({
      status: 200,
      headers: { "Content-Length": String(declared) },
      stream: { chunk, count: declared / 65_536 },
    }));
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message: "too large",
    });
    expect(server.requests[0]?.sentBytes).toBeLessThan(20 * 1024 * 1024);
  });

  it("stops reading a streamed body once it passes 50 MB, counting bytes rather than characters", async () => {
    // 3 bytes per character: about 131 MB on the wire but only 44 million characters.
    const chunk = "€".repeat(21_845);
    const server = await serve(() => ({ status: 200, stream: { chunk, count: 2000 } }));
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message: "too large",
    });
    expect(server.requests[0]?.sentBytes).toBeLessThan(100 * 1024 * 1024);
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

  it("waits a second between requests to the same host, but not across hosts", async () => {
    const server = await serve(() => ({ status: 200, body: "[]" }));
    const throttle = createHostThrottle();
    await fetchFeed(`${server.baseUrl}/a`, noCache, throttle);
    await fetchFeed(`http://localhost:${String(server.port)}/b`, noCache, throttle);
    await fetchFeed(`${server.baseUrl}/c`, noCache, throttle);
    const [first, otherHost, sameHost] = server.requests.map((request) => request.at);
    expect((otherHost ?? 0) - (first ?? 0)).toBeLessThan(500);
    expect((sameHost ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(990);
  });
});
