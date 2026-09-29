import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/maintenance/route";
import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { devices, rateLimits, suggestions, tagAudit, tagCounts } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { runMaintenance } from "@/server/maintenance";

import { resetDb } from "./db";
import {
  countsOf,
  DEVICE_A_HASH,
  deviceHeaders,
  elsewhere,
  insertSubmission,
  seedMeetingStarted,
} from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => pool.end());

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const utcDate = (date: Date) => date.toISOString().slice(0, 10);

function cron(authorization?: string) {
  return GET(
    new Request("http://test/api/cron/maintenance", {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    }),
  );
}

describe("runMaintenance", () => {
  it("recounts every meeting, expiring submissions over 180 days old and applying exclusions", async () => {
    const meetingId = await seedMeetingStarted(1);
    await insertSubmission(meetingId, ["quiet"]);
    await insertSubmission(meetingId, ["quiet"], { confirmedAt: daysAgo(181) });
    await insertSubmission(meetingId, ["lively"], { excluded: true });
    await db.insert(tagCounts).values({ meetingId, tagId: 1, deviceCount: 9, verifiedCount: 9 });
    expect((await runMaintenance()).meetingsWithTags).toBe(1);
    expect(await countsOf(meetingId)).toEqual([["quiet", 1, 0]]);
  });

  it("purges audit rows older than 7 days", async () => {
    const meetingId = await seedMeetingStarted(1);
    await db.insert(tagAudit).values([
      { deviceHash: DEVICE_A_HASH, meetingId, action: "submit", at: daysAgo(8) },
      { deviceHash: DEVICE_A_HASH, meetingId, action: "edit", at: daysAgo(6) },
    ]);
    expect((await runMaintenance()).auditRowsPurged).toBe(1);
    expect((await db.select().from(tagAudit)).map((row) => row.action)).toEqual(["edit"]);
  });

  it("keeps today's and yesterday's rate-limit rows and purges older ones", async () => {
    await db.insert(rateLimits).values(
      [0, 1, 2].map((days) => ({
        deviceHash: DEVICE_A_HASH,
        bucket: "tag_submission" as const,
        windowStart: utcDate(daysAgo(days)),
        count: 1,
      })),
    );
    expect((await runMaintenance()).rateLimitRowsPurged).toBe(1);
    expect((await db.select().from(rateLimits)).map((row) => row.windowStart).sort()).toEqual(
      [utcDate(daysAgo(1)), utcDate(daysAgo(0))].sort(),
    );
  });

  it("unlinks devices from suggestions older than 30 days", async () => {
    await db.insert(suggestions).values([
      { text: "Old idea", deviceHash: DEVICE_A_HASH, createdAt: daysAgo(31) },
      { text: "New idea", deviceHash: DEVICE_A_HASH, createdAt: daysAgo(29) },
    ]);
    expect((await runMaintenance()).suggestionsUnlinked).toBe(1);
    expect((await db.select().from(suggestions)).map((row) => [row.text, row.deviceHash]).sort()).toEqual([
      ["New idea", DEVICE_A_HASH],
      ["Old idea", null],
    ]);
  });

  it("deletes devices inactive for 13 months", async () => {
    await db.insert(devices).values([
      { deviceHash: "a".repeat(64), platform: "ios", lastSeenDate: utcDate(daysAgo(400)) },
      { deviceHash: "b".repeat(64), platform: "android", lastSeenDate: utcDate(daysAgo(360)) },
    ]);
    expect((await runMaintenance()).devicesPurged).toBe(1);
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual(["b".repeat(64)]);
  });

  it("leaves no table linking a device to the meetings it tagged once 7 days pass", async () => {
    const first = await seedMeetingStarted(1, elsewhere(1));
    const second = await seedMeetingStarted(1, elsewhere(2));
    for (const meetingId of [first, second]) {
      await POST(
        new Request("http://test/api/v1/tags", {
          method: "POST",
          headers: deviceHeaders(),
          body: JSON.stringify({ meetingId, tags: ["quiet"] }),
        }),
      );
    }
    await db.update(tagAudit).set({ at: daysAgo(8) });
    await runMaintenance();
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'spatial_ref_sys'`,
    );
    for (const { table_name } of tables.rows) {
      const rows = await db.execute<{ row: string }>(
        sql`select row_to_json(t)::text as row from ${sql.identifier(table_name)} t`,
      );
      for (const { row } of rows.rows) {
        if (row.includes(DEVICE_A_HASH)) {
          expect([table_name, row.includes(first) || row.includes(second)]).toEqual([table_name, false]);
        }
      }
    }
  });
});

describe("GET /api/cron/maintenance", () => {
  it("refuses a request without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "a-long-random-cron-secret");
    expect((await cron("Bearer wrong")).status).toBe(401);
  });

  it("runs for Vercel Cron and reports counts only", async () => {
    vi.stubEnv("CRON_SECRET", "a-long-random-cron-secret");
    const res = await cron("Bearer a-long-random-cron-secret");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      meetingsWithTags: 0,
      auditRowsPurged: 0,
      rateLimitRowsPurged: 0,
      suggestionsUnlinked: 0,
      devicesPurged: 0,
    });
  });
});
