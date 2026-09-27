import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { addressGeocodes, feedMeetings, feeds, meetings } from "@/db/schema";
import { recomputeMeetings } from "@/server/meetings/recompute";

import { resetDb } from "./db";
import { feedMeeting, insertMeetingWithSources, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

async function meeting(id: string) {
  const [row] = await db.select().from(meetings).where(eq(meetings.id, id));
  return row;
}

async function sourceId(feedId: number) {
  const [row] = await db
    .select({ id: feedMeetings.id })
    .from(feedMeetings)
    .where(eq(feedMeetings.feedId, feedId));
  return row?.id;
}

describe("recomputeMeetings", () => {
  it("takes day, time, coordinates and time zone from the highest-priority active source", async () => {
    const area = await seedFeed("area-feed", "area");
    const intergroup = await seedFeed("intergroup-feed", "intergroup");
    const id = await insertMeetingWithSources([
      { feedId: area, row: feedMeeting({ time: "12:00", latitude: 36.1, timezone: "America/New_York" }) },
      {
        feedId: intergroup,
        row: feedMeeting({ time: "12:15", latitude: 36.2, timezone: "America/Chicago" }),
      },
    ]);
    await recomputeMeetings([id]);
    expect(await meeting(id)).toMatchObject({
      primaryFeedMeetingId: await sourceId(intergroup),
      time: "12:15",
      latitude: 36.2,
      timezone: "America/Chicago",
      archivedAt: null,
    });
  });

  it("skips archived sources and sources from opted-out feeds", async () => {
    const intergroup = await seedFeed("intergroup-feed");
    const optedOut = await seedFeed("opted-out-feed");
    const area = await seedFeed("area-feed", "area");
    await db.update(feeds).set({ optedOut: true }).where(eq(feeds.id, optedOut));
    const id = await insertMeetingWithSources([
      { feedId: intergroup, row: feedMeeting(), archived: true },
      { feedId: optedOut, row: feedMeeting() },
      { feedId: area, row: feedMeeting({ time: "12:30" }) },
    ]);
    await recomputeMeetings([id]);
    expect(await meeting(id)).toMatchObject({ primaryFeedMeetingId: await sourceId(area), time: "12:30" });
  });

  it("archives a meeting with no active source and restores it when one returns", async () => {
    const feedId = await seedFeed("intergroup-feed");
    const id = await insertMeetingWithSources([{ feedId, row: feedMeeting(), archived: true }]);
    await recomputeMeetings([id]);
    expect((await meeting(id))?.archivedAt).toBeInstanceOf(Date);
    await db.update(feedMeetings).set({ archivedAt: null }).where(eq(feedMeetings.feedId, feedId));
    await recomputeMeetings([id]);
    expect((await meeting(id))?.archivedAt).toBeNull();
  });

  it("uses a stored geocode when the source has no coordinates", async () => {
    const feedId = await seedFeed("intergroup-feed");
    const id = await insertMeetingWithSources([
      { feedId, row: feedMeeting({ latitude: null, longitude: null }) },
    ]);
    await db.insert(addressGeocodes).values({
      addressKey: "1 main st nashville tn 37203",
      status: "matched",
      latitude: 36.16,
      longitude: -86.78,
    });
    await recomputeMeetings([id]);
    expect(await meeting(id)).toMatchObject({ latitude: 36.16, longitude: -86.78 });
  });

  it("looks up the time zone from the coordinates when the source has none", async () => {
    const feedId = await seedFeed("intergroup-feed");
    const id = await insertMeetingWithSources([
      { feedId, row: feedMeeting({ timezone: null, latitude: 33.45, longitude: -112.07 }) },
    ]);
    await recomputeMeetings([id]);
    expect((await meeting(id))?.timezone).toBe("America/Phoenix");
  });
});
