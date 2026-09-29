import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { tagSwings, tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";

import { resetDb } from "./db";
import {
  deviceHeaders,
  insertSubmission,
  seedDuplicateCopies,
  seedMeetingStarted,
  testDevice,
} from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

const DAY_MS = 86_400_000;

async function tagFromDevices(meetingId: string, from: number, count: number, tagsToAdd: string[]) {
  for (let n = from; n < from + count; n++) {
    const res = await POST(
      new Request("http://test/api/v1/tags", {
        method: "POST",
        headers: deviceHeaders(testDevice(n)),
        body: JSON.stringify({ meetingId, tags: tagsToAdd }),
      }),
    );
    expect(res.status).toBe(201);
  }
}

async function openFlags() {
  return db
    .select({
      meetingId: tagSwings.meetingId,
      slug: tags.slug,
      newDevices: tagSwings.newDevices,
      prior: tagSwings.priorDevices,
    })
    .from(tagSwings)
    .innerJoin(tags, eq(tags.id, tagSwings.tagId));
}

async function priorSubmissions(meetingId: string, count: number) {
  for (let n = 0; n < count; n++) {
    await insertSubmission(meetingId, ["welcoming"], { confirmedAt: new Date(Date.now() - 3 * DAY_MS) });
  }
}

describe("swing flags", () => {
  it("flags a tag that gains 5 devices in 48 hours on a meeting that had fewer than 10", async () => {
    const meetingId = await seedMeetingStarted(1);
    await priorSubmissions(meetingId, 9);
    await tagFromDevices(meetingId, 1, 5, ["serious-tone"]);
    expect(await openFlags()).toEqual([{ meetingId, slug: "serious-tone", newDevices: 5, prior: 9 }]);
  });

  it("doesn't flag 4 new devices", async () => {
    const meetingId = await seedMeetingStarted(1);
    await tagFromDevices(meetingId, 1, 4, ["serious-tone"]);
    expect(await openFlags()).toEqual([]);
  });

  it("doesn't flag a meeting that already had 10 devices", async () => {
    const meetingId = await seedMeetingStarted(1);
    await priorSubmissions(meetingId, 10);
    await tagFromDevices(meetingId, 1, 5, ["serious-tone"]);
    expect(await openFlags()).toEqual([]);
  });

  it("keeps one open flag per meeting and tag", async () => {
    const meetingId = await seedMeetingStarted(1);
    await tagFromDevices(meetingId, 1, 6, ["serious-tone"]);
    expect(await openFlags()).toEqual([{ meetingId, slug: "serious-tone", newDevices: 5, prior: 0 }]);
  });

  it("moves a merged meeting's flags to the survivor, keeping one open flag per tag", async () => {
    const { older, newer } = await seedDuplicateCopies();
    await tagFromDevices(older, 1, 5, ["serious-tone"]);
    await tagFromDevices(newer, 6, 5, ["serious-tone", "lively"]);
    await db.transaction((tx) => mergeDuplicateMeetings([newer], tx));
    const flags = await openFlags();
    expect(flags.map((flag) => [flag.meetingId, flag.slug]).sort()).toEqual([
      [older, "lively"],
      [older, "serious-tone"],
    ]);
  });
});
