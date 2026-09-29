import { TagWriteResponse } from "@mymeetingapp/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { meetingAliases, meetings, tagAudit, tagSubmissions, tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";
import { recomputeMeetings } from "@/server/meetings/recompute";

import { resetDb, untilWaitingOnLock } from "./db";
import {
  countsOf,
  DEVICE_A_HASH,
  DEVICE_B,
  deviceHeaders,
  elsewhere,
  seedDuplicateCopies,
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

function post(body: unknown, headers = deviceHeaders()) {
  return POST(
    new Request("http://test/api/v1/tags", { method: "POST", headers, body: JSON.stringify(body) }),
  );
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ error: { code } });
}

async function rowsOn(meetingId: string) {
  return db.select().from(tagSubmissions).where(eq(tagSubmissions.meetingId, meetingId));
}

describe("POST /api/v1/tags", () => {
  it("records a new submission and returns the meeting's counts at once", async () => {
    const meetingId = await seedMeetingStarted(1);
    const res = await post({ meetingId, tags: ["welcoming", "laid-back"], nearMeeting: true });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(TagWriteResponse.parse(await res.json())).toEqual({
      meetingId,
      tags: [
        { slug: "laid-back", count: 1 },
        { slug: "welcoming", count: 1 },
      ],
    });
    expect(
      await db.select({ deviceHash: tagAudit.deviceHash, action: tagAudit.action }).from(tagAudit),
    ).toEqual([{ deviceHash: DEVICE_A_HASH, action: "submit" }]);
  });

  it("counts each distinct device once per tag", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post({ meetingId, tags: ["laid-back"] });
    const res = await post({ meetingId, tags: ["laid-back", "coffee"] }, deviceHeaders(DEVICE_B, "android"));
    expect(TagWriteResponse.parse(await res.json()).tags).toEqual([
      { slug: "laid-back", count: 2 },
      { slug: "coffee", count: 1 },
    ]);
  });

  it("gives one device a different submitter id on each meeting and stores no device hash with them", async () => {
    const first = await seedMeetingStarted(1, elsewhere(1));
    const second = await seedMeetingStarted(1, elsewhere(2));
    await post({ meetingId: first, tags: ["quiet"] });
    await post({ meetingId: second, tags: ["quiet"] });
    const rows = await db.select().from(tagSubmissions);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.submitterId).not.toBe(rows[1]?.submitterId);
    expect(JSON.stringify(rows)).not.toContain(DEVICE_A_HASH);
  });

  it("refuses a second submission within 7 days with already_tagged", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post({ meetingId, tags: ["quiet"] });
    await expectError(await post({ meetingId, tags: ["lively"] }), 409, "already_tagged");
    expect(await rowsOn(meetingId)).toHaveLength(1);
  });

  it("accepts a re-confirmation 7 days later, moving confirmed_at forward and keeping one row", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post({ meetingId, tags: ["quiet"] });
    const weekAgo = new Date(Date.now() - 7 * DAY_MS - 60_000);
    await db.update(tagSubmissions).set({ confirmedAt: weekAgo });
    expect((await post({ meetingId, tags: ["lively"] })).status).toBe(201);
    const rows = await rowsOn(meetingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.confirmedAt.getTime()).toBeGreaterThan(weekAgo.getTime() + DAY_MS);
  });

  it("refuses a submission outside the tagging window", async () => {
    const meetingId = await seedMeetingStarted(40);
    await expectError(await post({ meetingId, tags: ["quiet"] }), 403, "window_closed");
  });

  it("refuses unknown and retired tags", async () => {
    const meetingId = await seedMeetingStarted(1);
    await expectError(await post({ meetingId, tags: ["great-vibes"] }), 400, "unknown_tag");
    await db.update(tags).set({ status: "retired" }).where(eq(tags.slug, "coffee"));
    await expectError(await post({ meetingId, tags: ["quiet", "coffee"] }), 400, "unknown_tag");
  });

  it("refuses more than six tags, and an empty or repeated list", async () => {
    const meetingId = await seedMeetingStarted(1);
    const seven = [
      "by-the-book",
      "laid-back",
      "speaker-heavy",
      "lots-of-sharing",
      "step-study",
      "quiet",
      "coffee",
    ];
    await expectError(await post({ meetingId, tags: seven }), 400, "too_many_tags");
    await expectError(await post({ meetingId, tags: [] }), 400, "invalid_request");
    await expectError(await post({ meetingId, tags: ["quiet", "quiet"] }), 400, "invalid_request");
  });

  it("stores nearMeeting as false for an online meeting", async () => {
    const meetingId = await seedMeetingStarted(1, {
      attendance: "online",
      formattedAddress: null,
      addressKey: null,
      latitude: null,
      longitude: null,
      conferenceUrl: "https://zoom.us/j/555",
    });
    await post({ meetingId, tags: ["quiet"], nearMeeting: true });
    expect((await rowsOn(meetingId))[0]?.nearMeeting).toBe(false);
  });

  it("allows 10 new submissions per device per UTC day", async () => {
    const ids: string[] = [];
    for (let n = 0; n < 11; n++) ids.push(await seedMeetingStarted(1, elsewhere(n)));
    for (const meetingId of ids.slice(0, 10)) {
      expect((await post({ meetingId, tags: ["quiet"] })).status).toBe(201);
    }
    await expectError(await post({ meetingId: ids[10], tags: ["quiet"] }), 429, "rate_limited");
    expect(
      (await post({ meetingId: ids[10], tags: ["quiet"] }, deviceHeaders(DEVICE_B, "android"))).status,
    ).toBe(201);
  });

  it("refuses a meeting whose group opted out, and every submission while tagging is switched off", async () => {
    const meetingId = await seedMeetingStarted(1);
    vi.stubEnv("FEATURE_TAGGING", "off");
    await expectError(await post({ meetingId, tags: ["quiet"] }), 403, "tags_disabled");
    vi.stubEnv("FEATURE_TAGGING", "on");
    await db.update(meetings).set({ tagsDisabled: true });
    await expectError(await post({ meetingId, tags: ["quiet"] }), 403, "tags_disabled");
  });

  it("refuses unknown and archived meetings", async () => {
    await expectError(
      await post({ meetingId: "0f8fad5b-d9cb-469f-a165-70867728950e", tags: ["quiet"] }),
      404,
      "meeting_not_found",
    );
    const meetingId = await seedMeetingStarted(1);
    await db.update(meetings).set({ archivedAt: new Date() });
    await expectError(await post({ meetingId, tags: ["quiet"] }), 404, "meeting_not_found");
  });

  it("writes to the surviving meeting when given a merged-away id", async () => {
    const meetingId = await seedMeetingStarted(1);
    await db
      .insert(meetingAliases)
      .values({ oldMeetingId: "0f8fad5b-d9cb-469f-a165-70867728950e", meetingId });
    const res = await post({ meetingId: "0f8fad5b-d9cb-469f-a165-70867728950e", tags: ["quiet"] });
    expect(TagWriteResponse.parse(await res.json()).meetingId).toBe(meetingId);
    expect(await rowsOn(meetingId)).toHaveLength(1);
  });

  it("does not add a second row for a device that tagged a copy merged into this meeting", async () => {
    const { older, newer } = await seedDuplicateCopies();
    await post({ meetingId: newer, tags: ["quiet"] });
    await db.transaction((tx) => mergeDuplicateMeetings([newer], tx));
    await expectError(await post({ meetingId: older, tags: ["lively"] }), 409, "already_tagged");
    await expectError(await post({ meetingId: newer, tags: ["lively"] }), 409, "already_tagged");
    expect(await rowsOn(older)).toHaveLength(1);
  });

  it("refuses a write without device headers", async () => {
    const meetingId = await seedMeetingStarted(1);
    await expectError(await post({ meetingId, tags: ["quiet"] }, {}), 400, "invalid_request");
  });

  it("leaves no transaction id linking the device's record to its tag or audit rows (spec §2)", async () => {
    const meetingId = await seedMeetingStarted(1);
    expect((await post({ meetingId, tags: ["quiet"] })).status).toBe(201);
    const { rows } = await db.execute<{ linked: number }>(sql`
      select (select count(*) from devices d join tag_submissions s on s.xmin = d.xmin)::int
        + (select count(*) from devices d join tag_audit a on a.xmin = d.xmin)::int as linked
    `);
    expect(rows).toEqual([{ linked: 0 }]);
  });

  it("refuses a device blocked after it was recorded but before its write took the device lock", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post({ meetingId: await seedMeetingStarted(1, elsewhere(1)), tags: ["quiet"] });
    const admin = await pool.connect();
    await admin.query("begin");
    await admin.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [DEVICE_A_HASH]);
    let settled = false;
    const write = post({ meetingId, tags: ["quiet"] }).finally(() => (settled = true));
    await untilWaitingOnLock(() => settled);
    await admin.query("update devices set blocked = true where device_hash = $1", [DEVICE_A_HASH]);
    await admin.query("commit");
    admin.release();
    await expectError(await write, 403, "device_blocked");
    expect(await rowsOn(meetingId)).toEqual([]);
  });

  it("serializes one device's concurrent submissions", async () => {
    const meetingId = await seedMeetingStarted(1);
    const results = await Promise.all([
      post({ meetingId, tags: ["quiet"] }),
      post({ meetingId, tags: ["lively"] }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  });

  it("serializes two devices' submissions to one meeting, so both count", async () => {
    const meetingId = await seedMeetingStarted(1);
    // Hold the meeting row so both writes queue behind it, then let them go at the same moment.
    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query("select 1 from meetings where id = $1 for update", [meetingId]);
    let settled = 0;
    const writes = Promise.all(
      [
        post({ meetingId, tags: ["quiet", "coffee", "laid-back"] }),
        post({ meetingId, tags: ["quiet", "coffee", "laid-back"] }, deviceHeaders(DEVICE_B, "android")),
      ].map((write) => write.finally(() => (settled += 1))),
    );
    await untilWaitingOnLock(() => settled === 2, 2);
    await holder.query("commit");
    holder.release();
    const results = await writes;
    expect(results.map((res) => res.status)).toEqual([201, 201]);
    expect(await countsOf(meetingId)).toEqual([
      ["coffee", 2, 0],
      ["laid-back", 2, 0],
      ["quiet", 2, 0],
    ]);
  });

  it("doesn't wait for a sync that is updating the meeting", async () => {
    const meetingId = await seedMeetingStarted(1);
    await db.transaction(async (tx) => {
      await recomputeMeetings([meetingId], tx);
      expect((await post({ meetingId, tags: ["quiet"] })).status).toBe(201);
    });
  });

  describe("racing the sync's merge", () => {
    // Runs the merge in a transaction held open until `during` is waiting on one of its locks.
    async function whileMerging(meetingId: string, during: () => Promise<Response>): Promise<Response> {
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => (release = resolve));
      let merged: () => void = () => undefined;
      const mergeDone = new Promise<void>((resolve) => (merged = resolve));
      const merge = db.transaction(async (tx) => {
        await mergeDuplicateMeetings([meetingId], tx);
        merged();
        await hold;
      });
      await mergeDone;
      let settled = false;
      const pending = during().finally(() => (settled = true));
      await untilWaitingOnLock(() => settled);
      release();
      await merge;
      return pending;
    }

    it("waits for the merge, then finds the device's row it moved onto the surviving meeting", async () => {
      const { older, newer } = await seedDuplicateCopies();
      await post({ meetingId: newer, tags: ["quiet"] });
      const res = await whileMerging(newer, () => post({ meetingId: older, tags: ["lively"] }));
      await expectError(res, 409, "already_tagged");
      expect(await rowsOn(older)).toHaveLength(1);
    });

    it("follows a meeting that merged away while the write waited", async () => {
      const { older, newer } = await seedDuplicateCopies();
      const res = await whileMerging(newer, () => post({ meetingId: newer, tags: ["lively"] }));
      expect(TagWriteResponse.parse(await res.json()).meetingId).toBe(older);
      expect(await rowsOn(older)).toHaveLength(1);
    });
  });
});
