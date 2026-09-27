import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { addressGeocodes, feedMeetings, feeds, meetingLocation, meetings } from "@/db/schema";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

describe("meetings.location", () => {
  it("is generated from latitude and longitude and supports radius queries", async () => {
    const [near] = await db
      .insert(meetings)
      .values({ day: 1, time: "12:00", latitude: 36.17, longitude: -86.78 })
      .returning();
    await db.insert(meetings).values({ day: 1, time: "12:00", latitude: 40.0, longitude: -86.78 });
    await db.insert(meetings).values({ day: 1, time: "12:00" });

    const center = sql`ST_SetSRID(ST_MakePoint(-86.78, 36.16), 4326)::geography`;
    const rows = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(sql`ST_DWithin(${meetingLocation}, ${center}, 5000)`);

    expect(rows).toEqual([{ id: near?.id }]);
  });
});

describe("feeds table", () => {
  const feed = {
    slug: "x",
    name: "X",
    entityType: "intergroup",
    state: "TN",
    url: "https://x.org/f",
    priority: 10,
  } as const;

  it("rejects a lowercase or long state code", async () => {
    const insert = db.insert(feeds).values({ ...feed, state: "tn" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "feeds_state_check" } });
  });

  it("rejects an unknown entity type", async () => {
    // @ts-expect-error -- deliberately invalid entity type, to exercise the database constraint
    const insert = db.insert(feeds).values({ ...feed, entityType: "club" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "feeds_entity_type_check" } });
  });
});

describe("feed_meetings table", () => {
  async function source() {
    const feedId = await seedFeed("a");
    const [meeting] = await db.insert(meetings).values({ day: 1, time: "12:00" }).returning();
    if (meeting === undefined) throw new Error("no meeting");
    return { ...feedMeeting(), feedId, meetingId: meeting.id, seenAt: new Date() };
  }

  it("rejects a day outside 0-6", async () => {
    const insert = db.insert(feedMeetings).values({ ...(await source()), day: 7 });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "feed_meetings_day_check" } });
  });

  it("rejects an unknown attendance", async () => {
    // @ts-expect-error -- deliberately invalid attendance, to exercise the database constraint
    const insert = db.insert(feedMeetings).values({ ...(await source()), attendance: "zoom" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "feed_meetings_attendance_check" } });
  });
});

describe("address_geocodes table", () => {
  it("rejects an unknown status", async () => {
    // @ts-expect-error -- deliberately invalid status, to exercise the database constraint
    const insert = db.insert(addressGeocodes).values({ addressKey: "1 main st", status: "maybe" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "address_geocodes_status_check" } });
  });
});
