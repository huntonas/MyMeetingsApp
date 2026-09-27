import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/sync-feeds/route";
import { pool } from "@/db/client";

import { resetDb } from "./db";

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => pool.end());

function call(authorization?: string) {
  return GET(
    new Request("http://test/api/cron/sync-feeds", {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    }),
  );
}

describe("GET /api/cron/sync-feeds", () => {
  it.each([undefined, "Bearer wrong-secret-value", "wrong", "Bearer "])(
    "refuses %j",
    async (authorization) => {
      vi.stubEnv("CRON_SECRET", "a-long-random-cron-secret");
      const res = await call(authorization);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
    },
  );

  it("refuses every request when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("runs the sync for Vercel Cron", async () => {
    vi.stubEnv("CRON_SECRET", "a-long-random-cron-secret");
    const res = await call("Bearer a-long-random-cron-secret");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "done", synced: 0, unchanged: 0, failed: 0, geocoded: 0 });
  });
});
