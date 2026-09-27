import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

async function activeMeetings() {
  return db.select().from(meetings).where(isNull(meetings.archivedAt));
}

async function meetingIdOf(feedId: number, sourceSlug: string) {
  const [row] = await db
    .select({ meetingId: feedMeetings.meetingId })
    .from(feedMeetings)
    .where(and(eq(feedMeetings.feedId, feedId), eq(feedMeetings.sourceSlug, sourceSlug)));
  return row?.meetingId;
}

describe("applyFeedSnapshot", () => {
  it("creates one canonical meeting per row", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "other", day: 2 })]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("is idempotent", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    expect(await activeMeetings()).toHaveLength(1);
    expect(await db.select().from(feedMeetings)).toHaveLength(1);
  });

  it("joins the same meeting from another feed by normalized address", async () => {
    const intergroup = await seedFeed("intergroup");
    const area = await seedFeed("area", "area");
    await applyFeedSnapshot(intergroup, [feedMeeting()]);
    await applyFeedSnapshot(area, [
      feedMeeting({ sourceSlug: "area-slug", latitude: null, longitude: null }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
    expect(await meetingIdOf(area, "area-slug")).toBe(await meetingIdOf(intergroup, "nooners"));
  });

  it("joins by coordinates within 50 m when the addresses differ", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting()]);
    await applyFeedSnapshot(b, [
      feedMeeting({ sourceSlug: "b", addressKey: "different", latitude: 36.1702, longitude: -86.78 }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps meetings apart when the time differs or they are more than 50 m apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting()]);
    await applyFeedSnapshot(b, [
      feedMeeting({ sourceSlug: "later", time: "12:30" }),
      feedMeeting({ sourceSlug: "far", addressKey: "elsewhere", latitude: 36.18, longitude: -86.78 }),
    ]);
    expect(await activeMeetings()).toHaveLength(3);
  });

  it("joins online-only meetings by conference URL", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const online = {
      attendance: "online",
      formattedAddress: null,
      addressKey: null,
      latitude: null,
      longitude: null,
      conferenceUrl: "https://zoom.us/j/1",
    } as const;
    await applyFeedSnapshot(a, [feedMeeting({ ...online })]);
    await applyFeedSnapshot(b, [feedMeeting({ ...online, sourceSlug: "b" })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps a renamed meeting (new slug) on the same canonical meeting", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ sourceSlug: "old-name" })]);
    const before = await meetingIdOf(feedId, "old-name");
    await applyFeedSnapshot(feedId, [feedMeeting({ sourceSlug: "new-name" })]);
    expect(await meetingIdOf(feedId, "new-name")).toBe(before);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps two rooms at one address and time apart when the feed lists both", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({ sourceSlug: "room-a" }),
      feedMeeting({ sourceSlug: "room-b" }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("archives rows missing from the snapshot and restores them when they return", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "gone", day: 3 })]);
    const goneId = await meetingIdOf(feedId, "gone");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    expect(await activeMeetings()).toHaveLength(1);
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "gone", day: 3 })]);
    expect(await meetingIdOf(feedId, "gone")).toBe(goneId);
    expect(await activeMeetings()).toHaveLength(2);
  });
});
