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
    // The unread body is cancelled, so the connection is released rather than left hanging.
    expect(await closesPromptly(server)).toBe(true);
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
