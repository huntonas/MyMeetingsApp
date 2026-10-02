import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/maintenance/route";
import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import {
  attestChallenges,
  deviceDays,
  devices,
  rateLimits,
  suggestions,
  tagAudit,
  tagCounts,
} from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { runMaintenance } from "@/server/maintenance";
import { recountTags } from "@/server/tags/counts";

import { backendPid, resetDb, untilWaitingOnLock, whileHolding } from "./db";
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

// The exact cutoff `runMaintenance` uses, straight from Postgres, so the boundary test doesn't reimplement
// calendar-month arithmetic and risk disagreeing with it.
async function purgeBoundary(): Promise<string> {
  const [row] = (
    await db.execute<{ boundary: string }>(
      sql`select ((now() at time zone 'utc') - interval '13 months')::date as boundary`,
    )
  ).rows;
  if (row === undefined) throw new Error("no boundary computed");
  return row.boundary;
}

describe("runMaintenance", () => {
  it("recounts every meeting, keeping submissions however old and applying exclusions", async () => {
    const meetingId = await seedMeetingStarted(1);
    await insertSubmission(meetingId, ["quiet"]);
    await insertSubmission(meetingId, ["quiet"], { confirmedAt: daysAgo(200) });
    await insertSubmission(meetingId, ["lively"], { excluded: true });
    await db.insert(tagCounts).values({ meetingId, tagId: 1, deviceCount: 9, verifiedCount: 9 });
    expect((await runMaintenance()).meetingsWithTags).toBe(1);
    expect(await countsOf(meetingId)).toEqual([["quiet", 2, 0]]);
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

  it("deletes a device inactive for 13 months, keeping one still exactly at the boundary", async () => {
    const boundary = await purgeBoundary();
    const dayBefore = utcDate(new Date(new Date(`${boundary}T00:00:00Z`).getTime() - DAY_MS));
    await db.insert(devices).values([
      { deviceHash: "a".repeat(64), platform: "ios", lastSeenDate: dayBefore },
      { deviceHash: "b".repeat(64), platform: "android", lastSeenDate: boundary },
    ]);
    expect((await runMaintenance()).devicesPurged).toBe(1);
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual(["b".repeat(64)]);
  });

  it("keeps a device inactive for 13 months that writes after the night's fold but before the purge", async () => {
    const stale = "a".repeat(64);
    await db
      .insert(devices)
      .values({ deviceHash: stale, platform: "ios", lastSeenDate: utcDate(daysAgo(400)) });
    // An old daily-limit row the purge deletes before it reaches devices; holding it keeps the run between the two.
    await db.insert(rateLimits).values({
      deviceHash: "c".repeat(64),
      bucket: "tag_submission",
      windowStart: utcDate(daysAgo(5)),
      count: 1,
    });
    const { run } = await whileHolding(
      "select 1 from rate_limits where device_hash = $1 for update",
      ["c".repeat(64)],
      async (holder) => {
        let settled = false;
        const run = runMaintenance().finally(() => (settled = true));
        await untilWaitingOnLock(holder.pid, () => settled);
        // The phone's write, committed after the fold and before the purge reaches its record.
        await db.insert(deviceDays).values({ deviceHash: stale, day: utcDate(new Date()), platform: "ios" });
        return { run };
      },
    );
    expect(await run).toMatchObject({ devicesFolded: 0, devicesPurged: 0 });
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual([stale]);
  });

  it("keeps a blocked device past 13 months of inactivity", async () => {
    await db.insert(devices).values([
      { deviceHash: "a".repeat(64), platform: "ios", lastSeenDate: utcDate(daysAgo(400)), blocked: true },
      { deviceHash: "b".repeat(64), platform: "android", lastSeenDate: utcDate(daysAgo(400)) },
    ]);
    expect((await runMaintenance()).devicesPurged).toBe(1);
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual(["a".repeat(64)]);
  });

  it("deletes challenges past their 5 minutes and keeps live ones", async () => {
    await db.insert(attestChallenges).values([
      { challenge: "expired", expiresAt: new Date(Date.now() - 1000) },
      { challenge: "live", expiresAt: new Date(Date.now() + 60_000) },
    ]);
    expect((await runMaintenance()).challengesPurged).toBe(1);
    expect(await db.select({ challenge: attestChallenges.challenge }).from(attestChallenges)).toEqual([
      { challenge: "live" },
    ]);
  });

  it("leaves no table linking a device to the meetings it tagged once 7 days pass", async () => {
    const first = await seedMeetingStarted(1, elsewhere(1));
    const second = await seedMeetingStarted(1, elsewhere(2));
    for (const meetingId of [first, second]) {
      const res = await POST(
        new Request("http://test/api/v1/tags", {
          method: "POST",
          headers: deviceHeaders(),
          body: JSON.stringify({ meetingId, tags: ["quiet"] }),
        }),
      );
      expect(res.status).toBe(201);
    }
    // Positive control: before the purge, tag_audit really does link this device to both meetings.
    expect(
      (
        await db
          .select({ meetingId: tagAudit.meetingId })
          .from(tagAudit)
          .where(eq(tagAudit.deviceHash, DEVICE_A_HASH))
      )
        .map((row) => row.meetingId)
        .sort(),
    ).toEqual([first, second].sort());

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

  it("lets a concurrent tag write finish while the nightly recount runs, both succeeding with correct counts", async () => {
    const meetingId = await seedMeetingStarted(1);
    await insertSubmission(meetingId, ["quiet"]);
    await runMaintenance();
    // A second device confirms; tag_counts doesn't reflect it yet.
    await insertSubmission(meetingId, ["quiet"]);

    // Hold a tag write's own recount open mid-transaction, exactly as submitTags leaves it before committing. If the
    // wait fails, it rolls back instead, so its locks never outlive the test.
    let release: (commit: boolean) => void = () => undefined;
    const hold = new Promise<boolean>((resolve) => (release = resolve));
    let ready: (pid: number) => void = () => undefined;
    const writeReady = new Promise<number>((resolve) => (ready = resolve));
    const write = db.transaction(async (tx) => {
      await recountTags([meetingId], tx);
      ready(await backendPid(tx));
      if (!(await hold)) tx.rollback();
    });
    const holder = await writeReady;

    let settled = false;
    const nightly = runMaintenance().finally(() => (settled = true));
    let commit = false;
    try {
      await untilWaitingOnLock(holder, () => settled);
      commit = true;
    } finally {
      release(commit);
      if (!commit) await Promise.allSettled([write, nightly]);
    }
    await write;
    const summary = await nightly;

    expect(summary.meetingsWithTags).toBe(1);
    expect(await countsOf(meetingId)).toEqual([["quiet", 2, 0]]);
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
      challengesPurged: 0,
      devicesFolded: 0,
      deviceDaysPurged: 0,
    });
  });
});
