import { addressKey } from "@mymeetingapp/feed-kit";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { recomputeMeetings } from "@/server/meetings/recompute";

import { resetDb } from "./db";
import { feedMeeting, insertMeetingWithSources, seedFeed } from "./feed-fixtures";

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

const online = {
  attendance: "online",
  formattedAddress: null,
  addressKey: null,
  latitude: null,
  longitude: null,
  conferenceUrl: "https://zoom.us/j/1",
} as const;

// A degree of latitude is about 111 km, so this is a point the given distance due north of another.
function northOf(latitude: number, meters: number) {
  return latitude + meters / 111_000;
}

function listing(name: string, formattedAddress: string, latitude: number, longitude: number) {
  return { name, formattedAddress, addressKey: addressKey(formattedAddress), latitude, longitude };
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

  it.each([
    {
      meters: 82,
      first: ["Heritage", "1177 Gregorie Ferry Rd, Mt Pleasant, SC 29466, USA", 32.8468, -79.8231],
      second: ["Heritage", "1177 Gregorie Ferry Rd, Mount Pleasant, SC 29466, USA"],
    },
    {
      meters: 128,
      first: ["DOUGLASTON FRESH START", "243-01 Northern Blvd, Douglaston, NY 11363, USA", 40.7627, -73.744],
      second: ["Douglaston Fresh Start", "243-1 Northern Blvd, Little Neck, NY 11362, USA"],
    },
    {
      meters: 83,
      first: ["Central", "117 W Calhoun Street, Anderson, SC 29621, USA", 34.5034, -82.6501],
      second: ["Central Group - Anderson", "117 W Calhoun St, Anderson, SC 29625, USA"],
    },
    {
      meters: 61,
      first: ["Belleville Sunday 11th Step", "373 W Columbia Ave, Belleville, MI 48111", 42.2048, -83.4852],
      second: ["Sunday 11th Step", "409 W Columbia Ave, Belleville, MI 48111"],
    },
    {
      meters: 79,
      first: [
        "Rockaway Big Book Group",
        "100 Beach 116th St, Rockaway Park, NY 11694, USA",
        40.5795,
        -73.837,
      ],
      second: ["ROCKAWAY BIG BOOK", "100 Beach 116th St, Queens, NY 11694, USA"],
    },
  ] as const)(
    "joins $second.0 to $first.0 $meters m away at the same time",
    async ({ meters, first, second }) => {
      const [name, address, latitude, longitude] = first;
      const [otherName, otherAddress] = second;
      const a = await seedFeed("a");
      const b = await seedFeed("b");
      await applyFeedSnapshot(a, [feedMeeting(listing(name, address, latitude, longitude))]);
      await applyFeedSnapshot(b, [
        feedMeeting({
          sourceSlug: "b",
          ...listing(otherName, otherAddress, northOf(latitude, meters), longitude),
        }),
      ]);
      expect(await activeMeetings()).toHaveLength(1);
    },
  );

  it.each([
    ["Stepping Stones", "Steping Stones", 1],
    ["The Big Book", "Big Book Meeting", 1],
    ["Joy", "Joyful Living", 2],
  ])("matches %j and %j 100 m apart into %i meeting(s)", async (first, second, expected) => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [
      feedMeeting(listing(first, "500 E Main St, Nashville, TN 37206, USA", 36.17, -86.78)),
    ]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        sourceSlug: "b",
        ...listing(second, "520 E Main St, Nashville, TN 37206, USA", northOf(36.17, 100), -86.78),
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(expected);
  });

  it("keeps the same name apart more than 150 m away", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [
      feedMeeting(
        listing("Heritage", "1177 Gregorie Ferry Rd, Mt Pleasant, SC 29466, USA", 32.8468, -79.8231),
      ),
    ]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        sourceSlug: "b",
        ...listing(
          "Heritage",
          "1250 Gregorie Ferry Rd, Mt Pleasant, SC 29466, USA",
          northOf(32.8468, 160),
          -79.8231,
        ),
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("keeps different names at the same time within 150 m apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [
      feedMeeting(listing("Men's Stag", "500 E Main St, Nashville, TN 37206, USA", 36.17, -86.78)),
    ]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        sourceSlug: "b",
        ...listing(
          "Women's Serenity",
          "520 E Main St, Nashville, TN 37206, USA",
          northOf(36.17, 100),
          -86.78,
        ),
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("keeps meetings in one building apart when their start times differ", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const lansing = listing("12 X 12", "2909 W Genesee St, Lansing, MI 48917, USA", 42.7432, -84.5917);
    await applyFeedSnapshot(a, [feedMeeting({ ...lansing, day: 0, time: "10:00" })]);
    await applyFeedSnapshot(b, [
      feedMeeting({ ...lansing, sourceSlug: "b", name: "Sunday Morning Live", day: 0, time: "10:30" }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
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
    await applyFeedSnapshot(a, [feedMeeting({ ...online })]);
    await applyFeedSnapshot(b, [feedMeeting({ ...online, sourceSlug: "b" })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it.each([
    ["https://us02web.zoom.us/j/740716108", "https://zoom.us/j/740716108"],
    ["https://zoom.us/j/139383779", "https://zoom.us/j/139383779%20"],
    ["https://us02web.zoom.us/j/2014115493?pwd=Y0sy#success", "https://us02web.zoom.us/j/2014115493"],
    ["https://us04web.zoom.us/j/83492157355", "https://zoom.us/j/83492157355"],
    ["https://us06web.zoom.us/my/Serenity.Now", "https://zoom.us/my/serenity.now"],
    ["https://meet.google.com/abc-defg-hij?authuser=0", " HTTPS://Meet.Google.com/abc-defg-hij/ "],
  ])("joins online meetings whose conference URLs %s and %s name the same room", async (first, second) => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ ...online, conferenceUrl: first })]);
    await applyFeedSnapshot(b, [feedMeeting({ ...online, sourceSlug: "b", conferenceUrl: second })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps online meetings with different Zoom ids at the same time apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ ...online, conferenceUrl: "https://zoom.us/j/740716108" })]);
    await applyFeedSnapshot(b, [
      feedMeeting({ ...online, sourceSlug: "b", conferenceUrl: "https://us02web.zoom.us/j/740716109" }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("merges one conference URL listed under two slugs in one feed at the same day and time", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({ ...online, sourceSlug: "listing-a" }),
      feedMeeting({ ...online, sourceSlug: "listing-b" }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
    expect(await meetingIdOf(feedId, "listing-b")).toBe(await meetingIdOf(feedId, "listing-a"));
  });

  it("merges two slugs in one feed whose Zoom URLs differ only in host", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({
        ...online,
        sourceSlug: "listing-a",
        conferenceUrl: "https://us02web.zoom.us/j/740716108",
      }),
      feedMeeting({ ...online, sourceSlug: "listing-b", conferenceUrl: "https://zoom.us/j/740716108" }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("merges a meeting one feed calls online and another calls hybrid, by conference URL", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ ...online })]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        sourceSlug: "b",
        attendance: "hybrid",
        addressKey: "somewhere else entirely",
        latitude: 40,
        longitude: -80,
        conferenceUrl: "https://zoom.us/j/1",
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("joins an active meeting rather than an older archived one at the same place and time", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const archived = await insertMeetingWithSources([
      { feedId: a, row: feedMeeting({ sourceSlug: "gone" }), archived: true },
    ]);
    const active = await insertMeetingWithSources([{ feedId: b, row: feedMeeting({ sourceSlug: "live" }) }]);
    await recomputeMeetings([archived, active]);
    const c = await seedFeed("c");
    await applyFeedSnapshot(c, [feedMeeting({ sourceSlug: "new" })]);
    expect(await meetingIdOf(c, "new")).toBe(active);
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
