import { describe, expect, it } from "vitest";

import { createHostThrottle } from "../src/index";

describe("createHostThrottle", () => {
  it("waits a second between requests to the same host, but not across hosts", async () => {
    const throttle = createHostThrottle();
    await throttle.wait("a.example.org");

    const otherHostStart = Date.now();
    await throttle.wait("b.example.org");
    const otherHostWait = Date.now() - otherHostStart;

    const sameHostStart = Date.now();
    await throttle.wait("a.example.org");
    const sameHostWait = Date.now() - sameHostStart;

    expect(otherHostWait).toBeLessThan(50);
    expect(sameHostWait).toBeGreaterThanOrEqual(990);
  });

  it("counts a host's second from when its last request actually went, even when that went late", async () => {
    const throttle = createHostThrottle();
    await throttle.wait("a.example.org");
    const late = throttle.wait("a.example.org");
    const next = throttle.wait("a.example.org").then(() => Date.now());
    // Holds the event loop past the second request's turn, as parsing a large feed can, so it goes late.
    const busyUntil = Date.now() + 1300;
    while (Date.now() < busyUntil);
    const lateWentAfter = Date.now();
    await late;
    expect((await next) - lateWentAfter).toBeGreaterThanOrEqual(1000);
  });
});
