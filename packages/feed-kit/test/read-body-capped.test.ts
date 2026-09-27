import { afterEach, describe, expect, it } from "vitest";

import { startServer } from "@mymeetingapp/test-server";

import { readBodyCapped } from "../src/index";

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(...args: Parameters<typeof startServer>) {
  const server = await startServer(...args);
  servers.push(server);
  return server;
}

describe("readBodyCapped", () => {
  it("returns null for a declared Content-Length over 50 MB without reading the body", async () => {
    const declared = 60 * 1024 * 1024;
    const chunk = "x".repeat(65_536);
    const server = await serve(() => ({
      status: 200,
      headers: { "Content-Length": String(declared) },
      stream: { chunk, count: declared / 65_536 },
    }));
    const response = await fetch(`${server.baseUrl}/feed`);
    expect(await readBodyCapped(response)).toBeNull();
    expect(server.requests[0]?.sentBytes).toBeLessThan(20 * 1024 * 1024);
  });

  it("returns null once a streamed body passes 50 MB, counting bytes rather than characters", async () => {
    // 3 bytes per character: about 131 MB on the wire but only 44 million characters.
    const chunk = "€".repeat(21_845);
    const server = await serve(() => ({ status: 200, stream: { chunk, count: 2000 } }));
    const response = await fetch(`${server.baseUrl}/feed`);
    expect(await readBodyCapped(response)).toBeNull();
    expect(server.requests[0]?.sentBytes).toBeLessThan(100 * 1024 * 1024);
  });

  it("returns the body text when under the cap", async () => {
    const server = await serve(() => ({ status: 200, body: '[{"slug":"a"}]' }));
    const response = await fetch(`${server.baseUrl}/feed`);
    expect(await readBodyCapped(response)).toBe('[{"slug":"a"}]');
  });
});
