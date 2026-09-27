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
});
