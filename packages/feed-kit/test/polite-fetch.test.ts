import { afterEach, describe, expect, it } from "vitest";

import { startServer } from "@mymeetingapp/test-server";

import { createHostThrottle, FEED_TIMEOUT_MS, politeFetch } from "../src/index";

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(...args: Parameters<typeof startServer>) {
  const server = await startServer(...args);
  servers.push(server);
  return server;
}

describe("politeFetch", () => {
  it("sends the project User-Agent alongside the caller's headers and returns the response", async () => {
    const server = await serve(() => ({ status: 200, body: "ok" }));
    const result = await politeFetch(new URL(`${server.baseUrl}/feed`), createHostThrottle(), {
      headers: { Accept: "application/json" },
      timeoutMs: FEED_TIMEOUT_MS,
    });
    expect(result).toBeInstanceOf(Response);
    expect(server.requests[0]?.headers).toMatchObject({
      "user-agent": "mymeetingapp/1.0 (+https://mymeetingapp.com; admin@goodersoftwarellc.com)",
      accept: "application/json",
    });
  });

  it("reports a server slower than the timeout as timed out", async () => {
    const server = await serve(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ status: 200, body: "late" });
          }, 500);
        }),
    );
    expect(
      await politeFetch(new URL(`${server.baseUrl}/feed`), createHostThrottle(), { timeoutMs: 50 }),
    ).toEqual({ kind: "error", message: "timed out" });
  });

  it("reports a host that refuses connections as could not connect", async () => {
    const server = await startServer(() => ({ status: 200 }));
    await server.close();
    expect(
      await politeFetch(new URL(`${server.baseUrl}/feed`), createHostThrottle(), {
        timeoutMs: FEED_TIMEOUT_MS,
      }),
    ).toEqual({ kind: "error", message: "could not connect" });
  });
});
