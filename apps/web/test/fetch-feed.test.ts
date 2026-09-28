import { createHostThrottle } from "@mymeetingapp/feed-kit";
import { afterEach, describe, expect, it } from "vitest";

import { fetchFeed } from "@/server/feeds/fetch-feed";

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

    await fetchFeed(`${first.baseUrl}/a`, noCache, throttle);
    await fetchFeed(`${second.baseUrl}/a`, noCache, throttle);
    await fetchFeed(`${first.baseUrl}/b`, noCache, throttle);

    const [firstA, firstB] = first.requests;
    const [secondA] = second.requests;
    expect((secondA?.at ?? Infinity) - (firstA?.at ?? 0)).toBeLessThan(500);
    expect((firstB?.at ?? 0) - (firstA?.at ?? Infinity)).toBeGreaterThanOrEqual(990);
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
